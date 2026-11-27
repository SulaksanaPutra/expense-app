-- Hybrid Expense Locking Triggers (Cycle Close + Pairwise Settlement Watermark)
-- Ensures expenses.is_locked = TRUE is persisted atomically in Postgres when:
--   1. A BillingCycle transitions to CLOSED (or is inserted as CLOSED).
--   2. A Settlement is recorded between any two participants of a prior Expense.

CREATE OR REPLACE FUNCTION public.lock_expenses_on_billing_cycle_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'CLOSED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'CLOSED') THEN
    UPDATE public.expenses
    SET is_locked = TRUE
    WHERE group_id = NEW.group_id
      AND deleted_at IS NULL
      AND is_locked = FALSE
      AND (expense_date AT TIME ZONE 'UTC')::date >= NEW.period_start
      AND (expense_date AT TIME ZONE 'UTC')::date <= NEW.period_end;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_cycles_lock_expenses ON public.billing_cycles;
CREATE TRIGGER trg_billing_cycles_lock_expenses
  AFTER INSERT OR UPDATE OF status ON public.billing_cycles
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_expenses_on_billing_cycle_close();

CREATE OR REPLACE FUNCTION public.lock_expenses_on_settlement_watermark()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.expenses
  SET is_locked = TRUE
  WHERE group_id = NEW.group_id
    AND deleted_at IS NULL
    AND is_locked = FALSE
    AND expense_date <= NEW.settled_at
    AND (
      paid_by = NEW.payer_id
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(split_breakdown) AS elem
        WHERE (elem->>'user_id')::uuid = NEW.payer_id
          AND COALESCE((elem->>'share_cents')::bigint, 0) <> 0
      )
    )
    AND (
      paid_by = NEW.recipient_id
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(split_breakdown) AS elem
        WHERE (elem->>'user_id')::uuid = NEW.recipient_id
          AND COALESCE((elem->>'share_cents')::bigint, 0) <> 0
      )
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settlements_lock_watermark_expenses ON public.settlements;
CREATE TRIGGER trg_settlements_lock_watermark_expenses
  AFTER INSERT ON public.settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_expenses_on_settlement_watermark();
