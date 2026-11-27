-- LedgerSplit Notifications Migration
-- Persists in-app notifications for pre-lock expense share revisions and ledger events.

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  expense_id UUID REFERENCES public.expenses(id) ON DELETE CASCADE,
  revision_id UUID REFERENCES public.expense_revisions(id) ON DELETE CASCADE,
  type TEXT NOT NULL
    CONSTRAINT notifications_type_chk CHECK (
      type IN (
        'EXPENSE_REVISION',
        'NEW_EXPENSE',
        'SETTLEMENT_CONFIRMATION',
        'REMINDER_NUDGE',
        'LEASE_ARCHIVE_PROMPT'
      )
    ),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  delta_cents BIGINT,
  currency VARCHAR(3)
    CONSTRAINT notifications_currency_iso_chk CHECK (
      currency IS NULL OR currency ~ '^[A-Z]{3}$'
    ),
  href TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, is_read, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_insert_group_member" ON public.notifications;
CREATE POLICY "notifications_insert_group_member"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    group_id IS NOT NULL
    AND public.is_group_not_archived(group_id)
    AND (public.is_active_group_member(group_id) OR public.is_group_admin(group_id))
    AND public.is_group_member(group_id, user_id)
    AND (actor_id IS NULL OR actor_id = auth.uid())
  );

DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own"
  ON public.notifications
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
