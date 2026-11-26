-- LedgerSplit Member Departure Guards (FORMER_MEMBER) & Archive Rules Migration
-- Enforces:
--   1. Per-group net balance checks on self-leave and user account deletion
--   2. Configurable Trip 14-day zero-balance auto-archive & Residential 7-day lease prompt
--   3. Strict read-only enforcement for ARCHIVED groups across RLS and triggers

-- 1. Extend public.groups with Archive Rules & tracking timestamps
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS trip_auto_archive_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS trip_auto_archive_days INTEGER NOT NULL DEFAULT 14
    CONSTRAINT groups_trip_auto_archive_days_chk CHECK (trip_auto_archive_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS residential_lease_prompt_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS zero_balance_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_prompt_snoozed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- 2. Extend group_audit_logs event_type constraint for departure & archive governance events
ALTER TABLE public.group_audit_logs
  DROP CONSTRAINT IF EXISTS group_audit_logs_event_type_chk;

ALTER TABLE public.group_audit_logs
  ADD CONSTRAINT group_audit_logs_event_type_chk CHECK (
    event_type IN (
      'GROUP_CREATED',
      'RATIOS_UPDATED',
      'SPLIT_MODE_CHANGED',
      'NEEDS_RATIO_UPDATE_FLAGGED',
      'NEEDS_RATIO_UPDATE_CLEARED',
      'MEMBER_JOINED',
      'MEMBER_REJOINED',
      'MEMBER_LEFT',
      'MEMBER_REMOVED',
      'MEMBER_MARKED_FORMER',
      'MEMBER_ROLE_CHANGED',
      'INVITE_LINK_REGENERATED',
      'BILLING_CYCLE_CLOSED',
      'ARCHIVE_RULES_UPDATED',
      'GROUP_ARCHIVED',
      'GROUP_UNARCHIVED'
    )
  );

-- 3. Integer minor-unit net balance helper (BIGINT, zero floating-point)
CREATE OR REPLACE FUNCTION public.get_member_net_balance_cents(
  p_group_id UUID,
  p_user_id UUID
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(e.amount_cents)::BIGINT
      FROM public.expenses e
      WHERE e.group_id = p_group_id
        AND e.deleted_at IS NULL
        AND e.paid_by = p_user_id
    ), 0)
    - COALESCE((
      SELECT SUM((item->>'share_cents')::BIGINT)::BIGINT
      FROM public.expenses e
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(e.split_breakdown) = 'array' THEN e.split_breakdown
          ELSE '[]'::jsonb
        END
      ) AS item
      WHERE e.group_id = p_group_id
        AND e.deleted_at IS NULL
        AND item->>'user_id' = p_user_id::text
    ), 0)
    + COALESCE((
      SELECT SUM(s.amount_cents)::BIGINT
      FROM public.settlements s
      WHERE s.group_id = p_group_id
        AND s.payer_id = p_user_id
    ), 0)
    - COALESCE((
      SELECT SUM(s.amount_cents)::BIGINT
      FROM public.settlements s
      WHERE s.group_id = p_group_id
        AND s.recipient_id = p_user_id
    ), 0);
$$;

CREATE OR REPLACE FUNCTION public.user_has_unsettled_group_balance(
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.user_id = p_user_id
      AND public.get_member_net_balance_cents(gm.group_id, p_user_id) <> 0
  );
$$;

-- 4. Update RLS policies for departure balance guards & ARCHIVED read-only enforcement
DROP POLICY IF EXISTS "users_delete_self" ON public.users;
CREATE POLICY "users_delete_self"
  ON public.users
  FOR DELETE
  TO authenticated
  USING (
    id = auth.uid()
    AND NOT public.user_has_unsettled_group_balance(auth.uid())
  );

DROP POLICY IF EXISTS "group_members_insert_admin_or_creator" ON public.group_members;
CREATE POLICY "group_members_insert_admin_or_creator"
  ON public.group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_group_not_archived(group_id)
    AND (
      public.is_group_admin(group_id)
      OR (
        user_id = auth.uid()
        AND role = 'ADMIN'
        AND status = 'ACTIVE'
        AND EXISTS (
          SELECT 1
          FROM public.groups g
          WHERE g.id = group_id
            AND g.created_by = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "group_members_update_admin_only" ON public.group_members;
CREATE POLICY "group_members_update_admin_only"
  ON public.group_members
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

DROP POLICY IF EXISTS "group_members_delete_admin_or_self_leave" ON public.group_members;
CREATE POLICY "group_members_delete_admin_or_self_leave"
  ON public.group_members
  FOR DELETE
  TO authenticated
  USING (
    public.is_group_not_archived(group_id)
    AND public.get_member_net_balance_cents(group_id, user_id) = 0
    AND (
      public.is_group_admin(group_id)
      OR (user_id = auth.uid() AND status = 'ACTIVE')
    )
  );

DROP POLICY IF EXISTS "billing_cycles_insert_admin_only" ON public.billing_cycles;
CREATE POLICY "billing_cycles_insert_admin_only"
  ON public.billing_cycles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_group_admin(group_id)
    AND public.is_group_not_archived(group_id)
  );

DROP POLICY IF EXISTS "billing_cycles_update_admin_only" ON public.billing_cycles;
CREATE POLICY "billing_cycles_update_admin_only"
  ON public.billing_cycles
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

DROP POLICY IF EXISTS "billing_cycles_delete_admin_only" ON public.billing_cycles;
CREATE POLICY "billing_cycles_delete_admin_only"
  ON public.billing_cycles
  FOR DELETE
  TO authenticated
  USING (
    public.is_group_admin(group_id)
    AND public.is_group_not_archived(group_id)
  );

DROP POLICY IF EXISTS "recurring_rules_delete_admin_only" ON public.recurring_rules;
CREATE POLICY "recurring_rules_delete_admin_only"
  ON public.recurring_rules
  FOR DELETE
  TO authenticated
  USING (
    public.is_group_admin(group_id)
    AND public.is_group_not_archived(group_id)
  );

DROP POLICY IF EXISTS "group_audit_logs_insert_members" ON public.group_audit_logs;
CREATE POLICY "group_audit_logs_insert_members"
  ON public.group_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_group_member(group_id)
    AND (
      public.is_group_not_archived(group_id)
      OR (
        public.is_group_admin(group_id)
        AND event_type IN ('GROUP_ARCHIVED', 'GROUP_UNARCHIVED')
      )
    )
    AND (actor_id IS NULL OR actor_id = auth.uid())
  );

-- 5. Database triggers enforcing ARCHIVED read-only invariant & member departure balance guard
-- Covers Expense, Settlement, and RecurringRule writes even when executed via service role or background jobs.
CREATE OR REPLACE FUNCTION public.reject_writes_to_archived_group()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_id UUID;
  v_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Allow cascading deletes when parent group row itself is being deleted
    IF pg_trigger_depth() > 0 THEN
      RETURN OLD;
    END IF;
    v_group_id := OLD.group_id;
  ELSE
    v_group_id := NEW.group_id;
  END IF;

  SELECT status INTO v_status
  FROM public.groups
  WHERE id = v_group_id;

  IF v_status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'Group % is ARCHIVED and read-only; % on % is rejected',
      v_group_id, TG_OP, TG_TABLE_NAME;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expenses_reject_archived ON public.expenses;
CREATE TRIGGER trg_expenses_reject_archived
  BEFORE INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_writes_to_archived_group();

DROP TRIGGER IF EXISTS trg_settlements_reject_archived ON public.settlements;
CREATE TRIGGER trg_settlements_reject_archived
  BEFORE INSERT OR UPDATE OR DELETE ON public.settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_writes_to_archived_group();

DROP TRIGGER IF EXISTS trg_recurring_rules_reject_archived ON public.recurring_rules;
CREATE TRIGGER trg_recurring_rules_reject_archived
  BEFORE INSERT OR UPDATE OR DELETE ON public.recurring_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_writes_to_archived_group();

CREATE OR REPLACE FUNCTION public.enforce_member_departure_balance_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  IF pg_trigger_depth() > 0 THEN
    RETURN OLD;
  END IF;

  v_balance := public.get_member_net_balance_cents(OLD.group_id, OLD.user_id);
  IF v_balance <> 0 THEN
    RAISE EXCEPTION 'Cannot delete membership for user % in group % with non-zero balance (% cents); transition to FORMER_MEMBER instead',
      OLD.user_id, OLD.group_id, v_balance;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_group_members_departure_guard ON public.group_members;
CREATE TRIGGER trg_group_members_departure_guard
  BEFORE DELETE ON public.group_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_member_departure_balance_guard();
