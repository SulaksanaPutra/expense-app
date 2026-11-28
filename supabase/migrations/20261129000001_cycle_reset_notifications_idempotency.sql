-- LedgerSplit Cycle Reset & 48h Pre-Close Reminder Migration (Issue #116)
-- Idempotently extends public.notifications to support CYCLE_CLOSE_REMINDER
-- notifications with database-enforced deduplication keys.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_chk;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_chk CHECK (
    type IN (
      'EXPENSE_REVISION',
      'NEW_EXPENSE',
      'SETTLEMENT_CONFIRMATION',
      'REMINDER_NUDGE',
      'LEASE_ARCHIVE_PROMPT',
      'CYCLE_CLOSE_REMINDER'
    )
  );

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_key_uniq
  ON public.notifications(dedupe_key)
  WHERE dedupe_key IS NOT NULL;
