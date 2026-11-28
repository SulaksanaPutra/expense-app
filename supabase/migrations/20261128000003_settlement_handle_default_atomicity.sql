-- Issue #112: Atomic single-default enforcement for public.settlement_handles
-- Ensures that inserting or updating a SettlementHandle with is_default = TRUE
-- atomically clears is_default on all other handles belonging to the same user
-- within the same statement transaction (compatible with idx_settlement_handles_user_default).

CREATE OR REPLACE FUNCTION public.ensure_single_default_settlement_handle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.settlement_handles
    SET is_default = FALSE
    WHERE user_id = NEW.user_id
      AND is_default = TRUE
      AND id IS DISTINCT FROM NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settlement_handles_single_default ON public.settlement_handles;

CREATE TRIGGER trg_settlement_handles_single_default
  BEFORE INSERT OR UPDATE OF is_default ON public.settlement_handles
  FOR EACH ROW
  WHEN (NEW.is_default = TRUE)
  EXECUTE FUNCTION public.ensure_single_default_settlement_handle();
