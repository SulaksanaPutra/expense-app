-- LedgerSplit v2 Clean Schema Migration
-- Implements Issue #104 & ADR-0007:
--   1. Cleanly drops recurring_rules table and deprecated v1 columns/RPCs (zero backward-compatibility shims)
--   2. Adds v2 tables: settlement_handles, group_invites (with RLS policies)
--   3. Adds v2 columns on users, groups, group_members, and settlements
--   4. Enables SHARES split method and enforces Group expense policies in RLS & triggers

-- ============================================================================
-- 1. Drop legacy recurring_rules cron, RPC, indexes, columns, and table
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('ledgersplit_materialize_recurring_rules')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'ledgersplit_materialize_recurring_rules'
    );
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_table THEN
    NULL;
END;
$$;

DROP FUNCTION IF EXISTS public.materialize_due_recurring_rules(DATE);
DROP INDEX IF EXISTS public.idx_expenses_recurring_rule_occurrence_uniq;

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_fx_audit_completeness_chk,
  DROP CONSTRAINT IF EXISTS expenses_original_currency_iso_chk,
  DROP CONSTRAINT IF EXISTS expenses_exchange_rate_pos_chk,
  DROP CONSTRAINT IF EXISTS expenses_exchange_rate_source_chk,
  DROP COLUMN IF EXISTS original_amount_cents,
  DROP COLUMN IF EXISTS original_currency,
  DROP COLUMN IF EXISTS exchange_rate,
  DROP COLUMN IF EXISTS exchange_rate_source,
  DROP COLUMN IF EXISTS is_recurring_generated,
  DROP COLUMN IF EXISTS recurring_rule_id,
  DROP COLUMN IF EXISTS recurring_occurrence_date;

DROP TABLE IF EXISTS public.recurring_rules CASCADE;

-- ============================================================================
-- 2. Drop deprecated v1 columns & RPCs on users and groups
-- ============================================================================

DROP FUNCTION IF EXISTS public.reserve_receipt_storage_bytes(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS public.release_receipt_storage_bytes(BIGINT);

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_receipt_storage_non_neg_chk,
  DROP COLUMN IF EXISTS receipt_storage_used_bytes,
  DROP COLUMN IF EXISTS instant_settlement_tag;

ALTER TABLE public.groups
  DROP COLUMN IF EXISTS simplify_debts,
  DROP COLUMN IF EXISTS lease_end_date;

-- ============================================================================
-- 3. Add v2 columns on public.users
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS display_currency VARCHAR(3) NOT NULL DEFAULT 'USD'
    CONSTRAINT users_display_currency_iso_chk CHECK (display_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN IF NOT EXISTS auto_include_in_expenses BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.users
SET display_currency = base_currency
WHERE display_currency IS DISTINCT FROM base_currency;

-- ============================================================================
-- 4. Create public.settlement_handles + RLS policies
-- ============================================================================

CREATE TABLE public.settlement_handles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CONSTRAINT settlement_handles_provider_chk CHECK (provider IN ('VENMO', 'ZELLE', 'CASH_APP')),
  handle TEXT NOT NULL
    CONSTRAINT settlement_handles_handle_non_empty_chk CHECK (btrim(handle) <> ''),
  display_note TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_settlement_handles_user_id
  ON public.settlement_handles(user_id);

CREATE UNIQUE INDEX idx_settlement_handles_user_default
  ON public.settlement_handles(user_id)
  WHERE is_default = TRUE;

CREATE TRIGGER trg_settlement_handles_updated_at
  BEFORE UPDATE ON public.settlement_handles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.settlement_handles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settlement_handles_select_self_or_shared_group"
  ON public.settlement_handles
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.group_members gm_self
      JOIN public.group_members gm_peer
        ON gm_self.group_id = gm_peer.group_id
      WHERE gm_self.user_id = auth.uid()
        AND gm_peer.user_id = settlement_handles.user_id
    )
  );

CREATE POLICY "settlement_handles_insert_own"
  ON public.settlement_handles
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "settlement_handles_update_own"
  ON public.settlement_handles
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "settlement_handles_delete_own"
  ON public.settlement_handles
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================================
-- 5. Add v2 policy, category, and auto-settle columns on public.groups
--    and share_units on public.group_members
-- ============================================================================

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'OTHER'
    CONSTRAINT groups_category_chk CHECK (category IN ('HOME', 'TRIP', 'DINING', 'UTILITIES', 'OTHER')),
  ADD COLUMN IF NOT EXISTS cycle_reset_day INTEGER NOT NULL DEFAULT 1
    CONSTRAINT groups_cycle_reset_day_chk CHECK (cycle_reset_day BETWEEN 1 AND 28),
  ADD COLUMN IF NOT EXISTS auto_settle_on_reset BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_any_member_add_expense BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS require_receipt_over_100 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS send_cycle_close_reminders BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.groups
SET
  category = CASE group_type
    WHEN 'RESIDENTIAL' THEN 'HOME'
    WHEN 'TRIP' THEN 'TRIP'
    WHEN 'RECURRING' THEN 'UTILITIES'
    ELSE 'OTHER'
  END,
  cycle_reset_day = billing_cycle_anchor_day;

ALTER TABLE public.groups
  DROP CONSTRAINT IF EXISTS groups_default_split_mode_chk;

ALTER TABLE public.groups
  ADD CONSTRAINT groups_default_split_mode_chk CHECK (
    default_split_mode IN ('EQUAL', 'PERCENTAGE', 'SHARES', 'CUSTOM', 'CUSTOM_RATIOS')
  );

ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS share_units NUMERIC(10, 4) NOT NULL DEFAULT 1.0000
    CONSTRAINT group_members_share_units_non_neg_chk CHECK (share_units >= 0);

-- ============================================================================
-- 6. Create public.group_invites + RLS policies
-- ============================================================================

CREATE TABLE public.group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL
    CONSTRAINT group_invites_email_non_empty_chk CHECK (btrim(invited_email) <> ''),
  invited_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CONSTRAINT group_invites_status_chk CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_group_invites_group_id
  ON public.group_invites(group_id, created_at DESC);

CREATE INDEX idx_group_invites_email
  ON public.group_invites(lower(invited_email));

ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_invites_select_members"
  ON public.group_invites
  FOR SELECT
  TO authenticated
  USING (public.is_group_member(group_id));

CREATE POLICY "group_invites_insert_admin_only"
  ON public.group_invites
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_group_admin(group_id)
    AND public.is_group_not_archived(group_id)
    AND invited_by = auth.uid()
  );

CREATE POLICY "group_invites_update_admin_only"
  ON public.group_invites
  FOR UPDATE
  TO authenticated
  USING (
    public.is_group_admin(group_id)
    AND public.is_group_not_archived(group_id)
  )
  WITH CHECK (
    public.is_group_admin(group_id)
    AND public.is_group_not_archived(group_id)
  );

CREATE POLICY "group_invites_delete_admin_only"
  ON public.group_invites
  FOR DELETE
  TO authenticated
  USING (public.is_group_admin(group_id));

-- ============================================================================
-- 7. Enable SHARES split method & enforce Group policies on public.expenses
-- ============================================================================

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_split_method_chk;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_split_method_chk CHECK (
    split_method IN ('EQUAL', 'PERCENTAGE', 'EXACT', 'SHARES')
  );

DROP POLICY IF EXISTS "expenses_insert_active_member" ON public.expenses;
CREATE POLICY "expenses_insert_active_member"
  ON public.expenses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_group_member(group_id)
    AND public.is_group_not_archived(group_id)
    AND created_by = auth.uid()
    AND (
      public.is_group_admin(group_id)
      OR EXISTS (
        SELECT 1
        FROM public.groups g
        WHERE g.id = group_id
          AND g.allow_any_member_add_expense = TRUE
      )
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_expense_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_currency VARCHAR(3);
  v_require_receipt BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_locked THEN
      RAISE EXCEPTION 'Locked expenses are immutable and cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_locked THEN
    RAISE EXCEPTION 'Locked expenses are immutable and cannot be modified';
  END IF;

  SELECT base_currency, require_receipt_over_100
  INTO v_group_currency, v_require_receipt
  FROM public.groups
  WHERE id = NEW.group_id;

  IF v_group_currency IS NULL THEN
    RAISE EXCEPTION 'Referenced group % does not exist', NEW.group_id;
  END IF;

  IF NEW.currency <> v_group_currency THEN
    RAISE EXCEPTION 'Expense currency (%) must match group base_currency (%)', NEW.currency, v_group_currency;
  END IF;

  IF v_require_receipt
    AND NEW.deleted_at IS NULL
    AND NEW.adjustment_for_expense_id IS NULL
    AND ABS(NEW.amount_cents) > 10000
    AND (NEW.receipt_url IS NULL OR btrim(NEW.receipt_url) = '')
  THEN
    RAISE EXCEPTION 'Receipt attachment is required for expenses over $100 in this group';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 8. Extend public.settlements with v2 payment rails & settlement_handle_id
-- ============================================================================

ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS settlement_handle_id UUID REFERENCES public.settlement_handles(id) ON DELETE SET NULL;

ALTER TABLE public.settlements
  DROP CONSTRAINT IF EXISTS settlements_payment_rail_chk;

ALTER TABLE public.settlements
  ADD CONSTRAINT settlements_payment_rail_chk CHECK (
    payment_rail IN (
      'VENMO',
      'ZELLE',
      'CASH_APP',
      'CASH',
      'BANK_SETTLEMENT',
      'AUTO_SETTLED',
      'APPLE_CARD',
      'OTHER'
    )
  );

-- ============================================================================
-- 9. Sync supabase_realtime publication with v2 tables
-- ============================================================================

DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'settlement_handles',
    'group_invites'
  ];
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    FOREACH v_table IN ARRAY v_tables LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = v_table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    END LOOP;
  END IF;
END;
$$;
