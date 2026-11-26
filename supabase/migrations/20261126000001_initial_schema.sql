-- LedgerSplit Initial Schema
-- Governs: User, Group, GroupMember, BillingCycle, RecurringRule,
--          Expense, ExpenseRevision, Settlement, ReminderLog
-- Monetary rule: BIGINT integer minor units (*_cents) + VARCHAR(3) ISO-4217 codes only.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 1. User
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone_number TEXT,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  instant_settlement_tag TEXT,
  base_currency VARCHAR(3) NOT NULL DEFAULT 'USD'
    CONSTRAINT users_base_currency_iso_chk CHECK (base_currency ~ '^[A-Z]{3}$'),
  personal_share_cap_cents BIGINT
    CONSTRAINT users_personal_share_cap_non_neg_chk CHECK (
      personal_share_cap_cents IS NULL OR personal_share_cap_cents >= 0
    ),
  receipt_storage_used_bytes BIGINT NOT NULL DEFAULT 0
    CONSTRAINT users_receipt_storage_non_neg_chk CHECK (receipt_storage_used_bytes >= 0),
  notification_prefs JSONB NOT NULL DEFAULT '{
    "new_expense": true,
    "settlement_confirmation": true,
    "monthly_recap": true,
    "sms_nudges_opt_in": false
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 2. Group
CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  group_type TEXT NOT NULL
    CONSTRAINT groups_type_chk CHECK (group_type IN ('RESIDENTIAL', 'TRIP', 'RECURRING')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CONSTRAINT groups_status_chk CHECK (status IN ('ACTIVE', 'NEEDS_RATIO_UPDATE', 'ARCHIVED')),
  base_currency VARCHAR(3) NOT NULL DEFAULT 'USD'
    CONSTRAINT groups_base_currency_iso_chk CHECK (base_currency ~ '^[A-Z]{3}$'),
  default_split_mode TEXT NOT NULL DEFAULT 'EQUAL'
    CONSTRAINT groups_default_split_mode_chk CHECK (default_split_mode IN ('EQUAL', 'CUSTOM_RATIOS')),
  simplify_debts BOOLEAN NOT NULL DEFAULT TRUE,
  operational_budget_cents BIGINT
    CONSTRAINT groups_operational_budget_non_neg_chk CHECK (
      operational_budget_cents IS NULL OR operational_budget_cents >= 0
    ),
  billing_cycle_anchor_day INTEGER NOT NULL DEFAULT 1
    CONSTRAINT groups_billing_cycle_anchor_day_chk CHECK (billing_cycle_anchor_day BETWEEN 1 AND 28),
  lease_end_date DATE,
  invite_token TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON public.groups
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 3. GroupMember
CREATE TABLE public.group_members (
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'MEMBER'
    CONSTRAINT group_members_role_chk CHECK (role IN ('ADMIN', 'MEMBER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CONSTRAINT group_members_status_chk CHECK (status IN ('ACTIVE', 'FORMER_MEMBER')),
  share_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.00
    CONSTRAINT group_members_share_pct_chk CHECK (share_percentage >= 0 AND share_percentage <= 100),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_members_user_id ON public.group_members(user_id);

-- 4. BillingCycle
CREATE TABLE public.billing_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CONSTRAINT billing_cycles_status_chk CHECK (status IN ('OPEN', 'CLOSED')),
  closed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_cycles_period_order_chk CHECK (period_end >= period_start),
  CONSTRAINT billing_cycles_group_period_uniq UNIQUE (group_id, period_start, period_end)
);

CREATE INDEX idx_billing_cycles_group_id ON public.billing_cycles(group_id, period_start DESC);

-- 5. RecurringRule
CREATE TABLE public.recurring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  paid_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_cents BIGINT NOT NULL
    CONSTRAINT recurring_rules_amount_pos_chk CHECK (amount_cents > 0),
  currency VARCHAR(3) NOT NULL
    CONSTRAINT recurring_rules_currency_iso_chk CHECK (currency ~ '^[A-Z]{3}$'),
  frequency TEXT NOT NULL DEFAULT 'MONTHLY'
    CONSTRAINT recurring_rules_frequency_chk CHECK (frequency IN ('MONTHLY')),
  day_of_month INTEGER NOT NULL
    CONSTRAINT recurring_rules_day_of_month_chk CHECK (day_of_month BETWEEN 1 AND 28),
  split_rule TEXT NOT NULL DEFAULT 'EQUAL'
    CONSTRAINT recurring_rules_split_rule_chk CHECK (split_rule IN ('EQUAL', 'CUSTOM_RATIOS')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recurring_rules_group_id ON public.recurring_rules(group_id);
CREATE INDEX idx_recurring_rules_next_run ON public.recurring_rules(is_active, next_run_date);

CREATE TRIGGER trg_recurring_rules_updated_at
  BEFORE UPDATE ON public.recurring_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 6. Expense
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  paid_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amount_cents BIGINT NOT NULL
    CONSTRAINT expenses_amount_non_zero_chk CHECK (amount_cents <> 0),
  currency VARCHAR(3) NOT NULL
    CONSTRAINT expenses_currency_iso_chk CHECK (currency ~ '^[A-Z]{3}$'),
  original_amount_cents BIGINT,
  original_currency VARCHAR(3)
    CONSTRAINT expenses_original_currency_iso_chk CHECK (
      original_currency IS NULL OR original_currency ~ '^[A-Z]{3}$'
    ),
  exchange_rate NUMERIC(12, 6)
    CONSTRAINT expenses_exchange_rate_pos_chk CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  exchange_rate_source TEXT
    CONSTRAINT expenses_exchange_rate_source_chk CHECK (
      exchange_rate_source IS NULL OR exchange_rate_source IN ('API', 'MANUAL_OVERRIDE')
    ),
  split_method TEXT NOT NULL
    CONSTRAINT expenses_split_method_chk CHECK (split_method IN ('EQUAL', 'PERCENTAGE', 'EXACT')),
  split_breakdown JSONB NOT NULL,
  receipt_url TEXT,
  is_recurring_generated BOOLEAN NOT NULL DEFAULT FALSE,
  recurring_rule_id UUID REFERENCES public.recurring_rules(id) ON DELETE SET NULL,
  adjustment_for_expense_id UUID REFERENCES public.expenses(id) ON DELETE RESTRICT,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expenses_fx_audit_completeness_chk CHECK (
    (
      original_amount_cents IS NULL
      AND original_currency IS NULL
      AND exchange_rate IS NULL
      AND exchange_rate_source IS NULL
    )
    OR (
      original_amount_cents IS NOT NULL
      AND original_currency IS NOT NULL
      AND exchange_rate IS NOT NULL
      AND exchange_rate_source IS NOT NULL
    )
  )
);

CREATE INDEX idx_expenses_group_date ON public.expenses(group_id, expense_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_expenses_paid_by ON public.expenses(group_id, paid_by);
CREATE INDEX idx_expenses_adjustment_for ON public.expenses(adjustment_for_expense_id)
  WHERE adjustment_for_expense_id IS NOT NULL;

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_expense_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_currency VARCHAR(3);
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

  SELECT base_currency INTO v_group_currency
  FROM public.groups
  WHERE id = NEW.group_id;

  IF v_group_currency IS NULL THEN
    RAISE EXCEPTION 'Referenced group % does not exist', NEW.group_id;
  END IF;

  IF NEW.currency <> v_group_currency THEN
    RAISE EXCEPTION 'Expense currency (%) must match group base_currency (%)', NEW.currency, v_group_currency;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_expenses_enforce_invariants
  BEFORE INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_expense_invariants();

-- 7. ExpenseRevision
CREATE TABLE public.expense_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  updated_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  old_snapshot JSONB NOT NULL,
  new_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expense_revisions_expense_id ON public.expense_revisions(expense_id, created_at DESC);

-- 8. Settlement
CREATE TABLE public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  payer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL
    CONSTRAINT settlements_amount_pos_chk CHECK (amount_cents > 0),
  currency VARCHAR(3) NOT NULL
    CONSTRAINT settlements_currency_iso_chk CHECK (currency ~ '^[A-Z]{3}$'),
  payment_rail TEXT NOT NULL
    CONSTRAINT settlements_payment_rail_chk CHECK (payment_rail IN ('VENMO', 'APPLE_CARD', 'CASH', 'OTHER')),
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settlements_distinct_parties_chk CHECK (payer_id <> recipient_id)
);

CREATE INDEX idx_settlements_group_settled_at ON public.settlements(group_id, settled_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_settlement_currency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_currency VARCHAR(3);
BEGIN
  SELECT base_currency INTO v_group_currency
  FROM public.groups
  WHERE id = NEW.group_id;

  IF v_group_currency IS NULL THEN
    RAISE EXCEPTION 'Referenced group % does not exist', NEW.group_id;
  END IF;

  IF NEW.currency <> v_group_currency THEN
    RAISE EXCEPTION 'Settlement currency (%) must match group base_currency (%)', NEW.currency, v_group_currency;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_settlements_enforce_currency
  BEFORE INSERT ON public.settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_settlement_currency();

-- 9. ReminderLog
CREATE TABLE public.reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creditor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  debtor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  channel TEXT NOT NULL
    CONSTRAINT reminder_logs_channel_chk CHECK (channel IN ('PUSH', 'EMAIL', 'SMS')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reminder_logs_distinct_parties_chk CHECK (creditor_id <> debtor_id)
);

CREATE INDEX idx_reminder_logs_cooldown
  ON public.reminder_logs(creditor_id, debtor_id, group_id, sent_at DESC);
