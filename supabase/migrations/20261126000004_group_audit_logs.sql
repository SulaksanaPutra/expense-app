-- LedgerSplit Group Audit Logs Migration
-- Tracks ratio updates, split rule changes, and member governance history per group.

CREATE TABLE public.group_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL
    CONSTRAINT group_audit_logs_event_type_chk CHECK (
      event_type IN (
        'GROUP_CREATED',
        'RATIOS_UPDATED',
        'SPLIT_MODE_CHANGED',
        'NEEDS_RATIO_UPDATE_FLAGGED',
        'NEEDS_RATIO_UPDATE_CLEARED',
        'MEMBER_JOINED',
        'MEMBER_REJOINED',
        'MEMBER_REMOVED',
        'MEMBER_ROLE_CHANGED',
        'INVITE_LINK_REGENERATED',
        'BILLING_CYCLE_CLOSED',
        'GROUP_ARCHIVED'
      )
    ),
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_group_audit_logs_group_created
  ON public.group_audit_logs(group_id, created_at DESC);

ALTER TABLE public.group_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_audit_logs_select_members"
  ON public.group_audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_group_member(group_id));

CREATE POLICY "group_audit_logs_insert_members"
  ON public.group_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_group_member(group_id)
    AND public.is_group_not_archived(group_id)
    AND (actor_id IS NULL OR actor_id = auth.uid())
  );
