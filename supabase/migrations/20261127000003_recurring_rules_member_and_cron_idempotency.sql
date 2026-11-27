-- LedgerSplit Recurring Rules: Active Member Creation, Creator/Admin Management, and Cron Idempotency
-- 1. Track rule creator so active members can create & manage their own RecurringRule templates (in addition to Group Admins).
-- 2. Add recurring_occurrence_date + partial unique index on expenses to guarantee idempotent cron materialization.
-- 3. Provide Postgres materialize_due_recurring_rules(p_run_date DATE) function (and schedule pg_cron when available).

ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE public.recurring_rules
SET created_by = paid_by
WHERE created_by IS NULL;

-- Replace ADMIN-only recurring_rules RLS policies with active-member create & Admin-or-creator manage policies
DROP POLICY IF EXISTS "recurring_rules_insert_admin_only" ON public.recurring_rules;
CREATE POLICY "recurring_rules_insert_active_member"
  ON public.recurring_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_group_member(group_id)
    AND public.is_group_not_archived(group_id)
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "recurring_rules_update_admin_only" ON public.recurring_rules;
CREATE POLICY "recurring_rules_update_admin_or_creator"
  ON public.recurring_rules
  FOR UPDATE
  TO authenticated
  USING (
    public.is_group_not_archived(group_id)
    AND (
      public.is_group_admin(group_id)
      OR (
        public.is_active_group_member(group_id)
        AND COALESCE(created_by, paid_by) = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.is_group_not_archived(group_id)
    AND (
      public.is_group_admin(group_id)
      OR (
        public.is_active_group_member(group_id)
        AND COALESCE(created_by, paid_by) = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "recurring_rules_delete_admin_only" ON public.recurring_rules;
CREATE POLICY "recurring_rules_delete_admin_or_creator"
  ON public.recurring_rules
  FOR DELETE
  TO authenticated
  USING (
    public.is_group_not_archived(group_id)
    AND (
      public.is_group_admin(group_id)
      OR (
        public.is_active_group_member(group_id)
        AND COALESCE(created_by, paid_by) = auth.uid()
      )
    )
  );

-- Idempotency guard for materialized recurring expenses
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS recurring_occurrence_date DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_recurring_rule_occurrence_uniq
  ON public.expenses(recurring_rule_id, recurring_occurrence_date)
  WHERE recurring_rule_id IS NOT NULL
    AND recurring_occurrence_date IS NOT NULL
    AND deleted_at IS NULL;

-- Deterministic integer minor-unit materialization function for pg_cron / SQL invocation
CREATE OR REPLACE FUNCTION public.materialize_due_recurring_rules(
  p_run_date DATE DEFAULT CURRENT_DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_group RECORD;
  v_occurrence DATE;
  v_next_occurrence DATE;
  v_active_ids UUID[];
  v_active_bps INTEGER[];
  v_count INTEGER;
  v_total_bps INTEGER;
  v_use_custom BOOLEAN;
  v_shares BIGINT[];
  v_base_share BIGINT;
  v_rem BIGINT;
  v_payer_idx INTEGER;
  v_order INTEGER[];
  v_idx INTEGER;
  v_cursor INTEGER;
  v_breakdown JSONB;
  v_split_method TEXT;
  v_inserted_count INTEGER := 0;
  v_iterations INTEGER;
  v_next_month_first DATE;
BEGIN
  FOR v_rule IN
    SELECT rr.*
    FROM public.recurring_rules rr
    JOIN public.groups g ON g.id = rr.group_id
    WHERE rr.is_active = TRUE
      AND rr.next_run_date <= p_run_date
      AND g.status <> 'ARCHIVED'
    ORDER BY rr.next_run_date ASC, rr.id ASC
  LOOP
    SELECT id, status, base_currency
    INTO v_group
    FROM public.groups
    WHERE id = v_rule.group_id;

    IF v_group IS NULL OR v_group.status = 'ARCHIVED' THEN
      CONTINUE;
    END IF;

    -- Ensure payer is still an active member
    IF NOT EXISTS (
      SELECT 1
      FROM public.group_members gm
      WHERE gm.group_id = v_rule.group_id
        AND gm.user_id = v_rule.paid_by
        AND gm.status = 'ACTIVE'
    ) THEN
      CONTINUE;
    END IF;

    -- Load current active members ordered deterministically by joined_at, user_id
    SELECT
      ARRAY_AGG(gm.user_id ORDER BY gm.joined_at ASC, gm.user_id ASC),
      ARRAY_AGG(ROUND(gm.share_percentage * 100)::INTEGER ORDER BY gm.joined_at ASC, gm.user_id ASC)
    INTO v_active_ids, v_active_bps
    FROM public.group_members gm
    WHERE gm.group_id = v_rule.group_id
      AND gm.status = 'ACTIVE';

    v_count := COALESCE(ARRAY_LENGTH(v_active_ids, 1), 0);
    IF v_count = 0 THEN
      CONTINUE;
    END IF;

    v_total_bps := 0;
    FOR v_idx IN 1..v_count LOOP
      v_total_bps := v_total_bps + COALESCE(v_active_bps[v_idx], 0);
    END LOOP;

    v_use_custom := (v_rule.split_rule = 'CUSTOM_RATIOS');
    IF v_use_custom AND (v_group.status = 'NEEDS_RATIO_UPDATE' OR v_total_bps <> 10000) THEN
      CONTINUE;
    END IF;

    -- Find payer index (1-based)
    v_payer_idx := 0;
    FOR v_idx IN 1..v_count LOOP
      IF v_active_ids[v_idx] = v_rule.paid_by THEN
        v_payer_idx := v_idx;
        EXIT;
      END IF;
    END LOOP;

    v_shares := ARRAY_FILL(0::BIGINT, ARRAY[v_count]);
    IF v_use_custom THEN
      v_split_method := 'PERCENTAGE';
      v_rem := v_rule.amount_cents;
      FOR v_idx IN 1..v_count LOOP
        v_shares[v_idx] := (v_rule.amount_cents * v_active_bps[v_idx]::BIGINT) / 10000::BIGINT;
        v_rem := v_rem - v_shares[v_idx];
      END LOOP;

      v_order := ARRAY[]::INTEGER[];
      IF v_payer_idx > 0 AND v_active_bps[v_payer_idx] > 0 THEN
        v_order := ARRAY_APPEND(v_order, v_payer_idx);
      END IF;
      FOR v_idx IN 1..v_count LOOP
        IF v_active_bps[v_idx] > 0 AND v_idx <> v_payer_idx THEN
          v_order := ARRAY_APPEND(v_order, v_idx);
        END IF;
      END LOOP;
      IF COALESCE(ARRAY_LENGTH(v_order, 1), 0) = 0 THEN
        FOR v_idx IN 1..v_count LOOP
          v_order := ARRAY_APPEND(v_order, v_idx);
        END LOOP;
      END IF;

      v_cursor := 1;
      WHILE v_rem <> 0 LOOP
        v_idx := v_order[((v_cursor - 1) % ARRAY_LENGTH(v_order, 1)) + 1];
        IF v_rem > 0 THEN
          v_shares[v_idx] := v_shares[v_idx] + 1;
          v_rem := v_rem - 1;
        ELSE
          v_shares[v_idx] := v_shares[v_idx] - 1;
          v_rem := v_rem + 1;
        END IF;
        v_cursor := v_cursor + 1;
      END LOOP;

      v_breakdown := '[]'::jsonb;
      FOR v_idx IN 1..v_count LOOP
        v_breakdown := v_breakdown || jsonb_build_array(
          jsonb_build_object(
            'user_id', v_active_ids[v_idx],
            'share_cents', v_shares[v_idx],
            'percentage', ROUND(v_active_bps[v_idx]::NUMERIC / 100.0, 2)
          )
        );
      END LOOP;
    ELSE
      v_split_method := 'EQUAL';
      v_base_share := v_rule.amount_cents / v_count::BIGINT;
      v_rem := v_rule.amount_cents - (v_base_share * v_count::BIGINT);
      FOR v_idx IN 1..v_count LOOP
        v_shares[v_idx] := v_base_share;
      END LOOP;

      v_order := ARRAY[]::INTEGER[];
      IF v_payer_idx > 0 THEN
        v_order := ARRAY_APPEND(v_order, v_payer_idx);
      END IF;
      FOR v_idx IN 1..v_count LOOP
        IF v_idx <> v_payer_idx THEN
          v_order := ARRAY_APPEND(v_order, v_idx);
        END IF;
      END LOOP;

      v_cursor := 1;
      WHILE v_rem <> 0 LOOP
        v_idx := v_order[((v_cursor - 1) % ARRAY_LENGTH(v_order, 1)) + 1];
        IF v_rem > 0 THEN
          v_shares[v_idx] := v_shares[v_idx] + 1;
          v_rem := v_rem - 1;
        ELSE
          v_shares[v_idx] := v_shares[v_idx] - 1;
          v_rem := v_rem + 1;
        END IF;
        v_cursor := v_cursor + 1;
      END LOOP;

      v_breakdown := '[]'::jsonb;
      FOR v_idx IN 1..v_count LOOP
        v_breakdown := v_breakdown || jsonb_build_array(
          jsonb_build_object(
            'user_id', v_active_ids[v_idx],
            'share_cents', v_shares[v_idx]
          )
        );
      END LOOP;
    END IF;

    v_occurrence := v_rule.next_run_date;
    v_iterations := 0;
    WHILE v_occurrence <= p_run_date AND v_iterations < 24 LOOP
      INSERT INTO public.expenses (
        group_id,
        created_by,
        paid_by,
        description,
        category,
        expense_date,
        amount_cents,
        currency,
        split_method,
        split_breakdown,
        is_recurring_generated,
        recurring_rule_id,
        recurring_occurrence_date
      )
      VALUES (
        v_rule.group_id,
        COALESCE(v_rule.created_by, v_rule.paid_by),
        v_rule.paid_by,
        v_rule.description,
        v_rule.category,
        (v_occurrence::TEXT || 'T00:00:00.000Z')::TIMESTAMPTZ,
        v_rule.amount_cents,
        v_group.base_currency,
        v_split_method,
        v_breakdown,
        TRUE,
        v_rule.id,
        v_occurrence
      )
      ON CONFLICT (recurring_rule_id, recurring_occurrence_date)
      WHERE recurring_rule_id IS NOT NULL
        AND recurring_occurrence_date IS NOT NULL
        AND deleted_at IS NULL
      DO NOTHING;

      IF FOUND THEN
        v_inserted_count := v_inserted_count + 1;
      END IF;

      v_next_month_first := (DATE_TRUNC('month', v_occurrence) + INTERVAL '1 month')::DATE;
      v_next_occurrence := v_next_month_first + (LEAST(GREATEST(v_rule.day_of_month, 1), 28) - 1);
      v_occurrence := v_next_occurrence;
      v_iterations := v_iterations + 1;
    END LOOP;

    IF v_occurrence <> v_rule.next_run_date THEN
      UPDATE public.recurring_rules
      SET next_run_date = v_occurrence
      WHERE id = v_rule.id;
    END IF;
  END LOOP;

  RETURN v_inserted_count;
END;
$$;

-- Schedule daily pg_cron execution when pg_cron extension is installed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('ledgersplit_materialize_recurring_rules')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'ledgersplit_materialize_recurring_rules'
    );

    PERFORM cron.schedule(
      'ledgersplit_materialize_recurring_rules',
      '0 6 * * *',
      'SELECT public.materialize_due_recurring_rules(CURRENT_DATE);'
    );
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_table THEN
    NULL;
END;
$$;
