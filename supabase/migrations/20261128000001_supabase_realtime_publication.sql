-- Enable Supabase Realtime postgres_changes on ledger and notification tables.
-- Idempotent: safely adds tables to supabase_realtime publication if not already present.

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.expenses REPLICA IDENTITY FULL;

DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'notifications',
    'expenses',
    'expense_revisions',
    'settlements',
    'billing_cycles',
    'groups',
    'group_members',
    'recurring_rules'
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
