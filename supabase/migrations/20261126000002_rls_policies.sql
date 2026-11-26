-- LedgerSplit Row-Level Security (RLS) Policies
-- Enforces strict per-group membership isolation (ACTIVE & FORMER_MEMBER)
-- and ADMIN-only mutations at the database layer.

-- Helper functions (SECURITY DEFINER avoids recursive RLS evaluation on group_members)
CREATE OR REPLACE FUNCTION public.is_group_member(
  p_group_id UUID,
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
    WHERE gm.group_id = p_group_id
      AND gm.user_id = p_user_id
      AND gm.status IN ('ACTIVE', 'FORMER_MEMBER')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_group_member(
  p_group_id UUID,
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
    WHERE gm.group_id = p_group_id
      AND gm.user_id = p_user_id
      AND gm.status = 'ACTIVE'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_admin(
  p_group_id UUID,
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
    WHERE gm.group_id = p_group_id
      AND gm.user_id = p_user_id
      AND gm.role = 'ADMIN'
      AND gm.status = 'ACTIVE'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_not_archived(
  p_group_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.groups g
    WHERE g.id = p_group_id
      AND g.status <> 'ARCHIVED'
  );
$$;

-- Enable Row-Level Security on all 9 tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;

-- 1. users policies
CREATE POLICY "users_select_self_or_shared_group"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.group_members gm_self
      JOIN public.group_members gm_peer
        ON gm_self.group_id = gm_peer.group_id
      WHERE gm_self.user_id = auth.uid()
        AND gm_peer.user_id = users.id
    )
  );

CREATE POLICY "users_insert_self"
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "users_update_self"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "users_delete_self"
  ON public.users
  FOR DELETE
  TO authenticated
  USING (id = auth.uid());

-- 2. groups policies
CREATE POLICY "groups_select_members"
  ON public.groups
  FOR SELECT
  TO authenticated
  USING (public.is_group_member(id));

CREATE POLICY "groups_insert_authenticated"
  ON public.groups
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (created_by IS NULL OR created_by = auth.uid())
  );

CREATE POLICY "groups_update_admin_only"
  ON public.groups
  FOR UPDATE
  TO authenticated
  USING (public.is_group_admin(id))
  WITH CHECK (public.is_group_admin(id));

CREATE POLICY "groups_delete_admin_only"
  ON public.groups
  FOR DELETE
  TO authenticated
  USING (public.is_group_admin(id));

-- 3. group_members policies
CREATE POLICY "group_members_select_members"
  ON public.group_members
  FOR SELECT
  TO authenticated
  USING (public.is_group_member(group_id));

CREATE POLICY "group_members_insert_admin_or_creator"
  ON public.group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
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
  );

CREATE POLICY "group_members_update_admin_only"
  ON public.group_members
  FOR UPDATE
  TO authenticated
  USING (public.is_group_admin(group_id))
  WITH CHECK (public.is_group_admin(group_id));

CREATE POLICY "group_members_delete_admin_or_self_leave"
  ON public.group_members
  FOR DELETE
  TO authenticated
  USING (
    public.is_group_admin(group_id)
    OR (user_id = auth.uid() AND status = 'ACTIVE')
  );

-- 4. billing_cycles policies (ADMIN-only mutations)
CREATE POLICY "billing_cycles_select_members"
  ON public.billing_cycles
  FOR SELECT
  TO authenticated
  USING (public.is_group_member(group_id));

CREATE POLICY "billing_cycles_insert_admin_only"
  ON public.billing_cycles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_group_admin(group_id));

CREATE POLICY "billing_cycles_update_admin_only"
  ON public.billing_cycles
  FOR UPDATE
  TO authenticated
  USING (public.is_group_admin(group_id))
  WITH CHECK (public.is_group_admin(group_id));

CREATE POLICY "billing_cycles_delete_admin_only"
  ON public.billing_cycles
  FOR DELETE
  TO authenticated
  USING (public.is_group_admin(group_id));

-- 5. recurring_rules policies (ADMIN-only mutations, non-archived)
CREATE POLICY "recurring_rules_select_members"
  ON public.recurring_rules
  FOR SELECT
  TO authenticated
  USING (public.is_group_member(group_id));

CREATE POLICY "recurring_rules_insert_admin_only"
  ON public.recurring_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_group_admin(group_id)
    AND public.is_group_not_archived(group_id)
  );

CREATE POLICY "recurring_rules_update_admin_only"
  ON public.recurring_rules
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

CREATE POLICY "recurring_rules_delete_admin_only"
  ON public.recurring_rules
  FOR DELETE
  TO authenticated
  USING (public.is_group_admin(group_id));

-- 6. expenses policies
CREATE POLICY "expenses_select_members"
  ON public.expenses
  FOR SELECT
  TO authenticated
  USING (public.is_group_member(group_id));

CREATE POLICY "expenses_insert_active_member"
  ON public.expenses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_group_member(group_id)
    AND public.is_group_not_archived(group_id)
    AND created_by = auth.uid()
  );

CREATE POLICY "expenses_update_creator_or_admin_unlocked"
  ON public.expenses
  FOR UPDATE
  TO authenticated
  USING (
    public.is_group_not_archived(group_id)
    AND is_locked = FALSE
    AND (
      public.is_group_admin(group_id)
      OR (public.is_active_group_member(group_id) AND created_by = auth.uid())
    )
  )
  WITH CHECK (
    public.is_group_not_archived(group_id)
    AND (
      public.is_group_admin(group_id)
      OR (public.is_active_group_member(group_id) AND created_by = auth.uid())
    )
  );

CREATE POLICY "expenses_delete_admin_only_unlocked"
  ON public.expenses
  FOR DELETE
  TO authenticated
  USING (
    public.is_group_admin(group_id)
    AND public.is_group_not_archived(group_id)
    AND is_locked = FALSE
  );

-- 7. expense_revisions policies (append-only audit trail)
CREATE POLICY "expense_revisions_select_members"
  ON public.expense_revisions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.expenses e
      WHERE e.id = expense_id
        AND public.is_group_member(e.group_id)
    )
  );

CREATE POLICY "expense_revisions_insert_editor"
  ON public.expense_revisions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    updated_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.expenses e
      WHERE e.id = expense_id
        AND public.is_group_not_archived(e.group_id)
        AND (
          public.is_group_admin(e.group_id)
          OR (public.is_active_group_member(e.group_id) AND e.created_by = auth.uid())
        )
    )
  );

-- 8. settlements policies (immutable ledger events; ACTIVE & FORMER_MEMBER allowed for self-involved)
CREATE POLICY "settlements_select_members"
  ON public.settlements
  FOR SELECT
  TO authenticated
  USING (public.is_group_member(group_id));

CREATE POLICY "settlements_insert_member_self_involved"
  ON public.settlements
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_group_member(group_id)
    AND public.is_group_not_archived(group_id)
    AND (
      payer_id = auth.uid()
      OR recipient_id = auth.uid()
      OR public.is_group_admin(group_id)
    )
  );

-- 9. reminder_logs policies (ACTIVE members only; FORMER_MEMBER blocked)
CREATE POLICY "reminder_logs_select_members"
  ON public.reminder_logs
  FOR SELECT
  TO authenticated
  USING (
    public.is_group_member(group_id)
    AND (
      creditor_id = auth.uid()
      OR debtor_id = auth.uid()
      OR public.is_group_admin(group_id)
    )
  );

CREATE POLICY "reminder_logs_insert_active_creditor"
  ON public.reminder_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_group_member(group_id)
    AND public.is_group_not_archived(group_id)
    AND creditor_id = auth.uid()
  );
