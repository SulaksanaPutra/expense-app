# LedgerSplit Domain Model

## 1. Core Entities & Relationships

```
User (1) ────────< GroupMember >──────── (1) Group
  │                                            │
  │ (payer / creator / recipient)              ├──< BillingCycle
  │                                            ├──< Expense ──< ExpenseRevision
  │                                            ├──< RecurringRule
  └────────────────────────────────────────────┴──< Settlement
```

### `User`
- `id`: UUID (Supabase Auth user ID)
- `full_name`: string
- `email`: string (unique)
- `phone_number`: string (nullable, verified for SMS opt-in)
- `instant_settlement_tag`: string (nullable, e.g., `@alex-rivera-99`)
- `base_currency`: ISO-4217 `VARCHAR(3)` (personal default)
- `personal_share_cap_cents`: `BIGINT` (nullable, e.g., `160000` for `$1,600.00`)
- `receipt_storage_used_bytes`: `BIGINT` (quota limit: `500 MB` = `524,288,000` bytes)
- `notification_prefs`: `{ new_expense: boolean, settlement_confirmation: boolean, monthly_recap: boolean, sms_nudges_opt_in: boolean }`

### `Group`
- `id`: UUID
- `name`: string (e.g., `Apt 4B Roommates`)
- `slug`: string (unique, e.g., `apt4b`)
- `group_type`: `'RESIDENTIAL' | 'TRIP' | 'RECURRING'`
- `status`: `'ACTIVE' | 'NEEDS_RATIO_UPDATE' | 'ARCHIVED'`
- `base_currency`: ISO-4217 `VARCHAR(3)` (canonical currency for all ledger arithmetic in this group)
- `default_split_mode`: `'EQUAL' | 'CUSTOM_RATIOS'`
- `simplify_debts`: boolean (per-group bipartite graph resolution toggle)
- `operational_budget_cents`: `BIGINT` (nullable, e.g., `450000`)
- `billing_cycle_anchor_day`: integer (`1..28`, default `1` for calendar month)
- `lease_end_date`: date (nullable, used for residential archival prompt)
- `invite_token`: signed token for `/join/[slug]?token=...`

### `GroupMember`
- `group_id`: UUID
- `user_id`: UUID
- `role`: `'ADMIN' | 'MEMBER'`
- `status`: `'ACTIVE' | 'FORMER_MEMBER'`
- `share_percentage`: numeric (`0..100`, sum of active members = `100.00` when `CUSTOM_RATIOS` is valid)
- `joined_at`: timestamp

### `Expense`
- `id`: UUID
- `group_id`: UUID
- `created_by`: UUID
- `paid_by`: UUID (single payer)
- `description`: string
- `category`: string
- `expense_date`: timestamp
- `amount_cents`: `BIGINT NOT NULL` (converted to `Group.base_currency`)
- `currency`: `VARCHAR(3) NOT NULL` (must equal `Group.base_currency`)
- `original_amount_cents`: `BIGINT` (nullable, present when logged in foreign currency)
- `original_currency`: `VARCHAR(3)` (nullable)
- `exchange_rate`: `NUMERIC(12, 6)` (nullable)
- `exchange_rate_source`: `'API' | 'MANUAL_OVERRIDE'` (nullable)
- `split_method`: `'EQUAL' | 'PERCENTAGE' | 'EXACT'`
- `split_breakdown`: JSONB array `[{ user_id, share_cents, percentage? }]` (immutable snapshot at write time)
- `receipt_url`: string (nullable)
- `is_recurring_generated`: boolean
- `recurring_rule_id`: UUID (nullable)
- `adjustment_for_expense_id`: UUID (nullable, for Offsetting Adjustments)
- `is_locked`: boolean (computed/persisted lock state)
- `deleted_at`: timestamp (nullable, soft delete)

### `ExpenseRevision`
- `id`: UUID
- `expense_id`: UUID
- `updated_by`: UUID
- `old_snapshot`: JSONB (including `old_share` per member)
- `new_snapshot`: JSONB (including `new_share` per member)
- `created_at`: timestamp

### `Settlement`
- `id`: UUID
- `group_id`: UUID
- `payer_id`: UUID (debtor paying)
- `recipient_id`: UUID (creditor receiving)
- `amount_cents`: `BIGINT NOT NULL` (`> 0`, in `Group.base_currency`, supports partial payments)
- `payment_rail`: `'VENMO' | 'APPLE_CARD' | 'CASH' | 'OTHER'`
- `settled_at`: timestamp (immutable ledger event)

### `BillingCycle`
- `id`: UUID
- `group_id`: UUID
- `period_start`: date
- `period_end`: date
- `status`: `'OPEN' | 'CLOSED'`
- `closed_by`: UUID (nullable)
- `closed_at`: timestamp (nullable)

### `RecurringRule`
- `id`: UUID
- `group_id`: UUID
- `paid_by`: UUID
- `description`: string
- `category`: string
- `amount_cents`: `BIGINT` (in `Group.base_currency`)
- `frequency`: `'MONTHLY'` (extensible)
- `day_of_month`: integer (`1..28`)
- `split_rule`: `'EQUAL' | 'CUSTOM_RATIOS'`
- `is_active`: boolean
- `next_run_date`: date

### `ReminderLog`
- `creditor_id`: UUID
- `debtor_id`: UUID
- `group_id`: UUID
- `channel`: `'PUSH' | 'EMAIL' | 'SMS'`
- `sent_at`: timestamp

---

## 2. State Lifecycles

### Expense Lifecycle
1. **Unlocked (`is_locked = FALSE`, `deleted_at IS NULL`)**:
   - Creator or Group Admin may edit fields/splits (recording an `ExpenseRevision`; notifying any member whose owed share changes by `> 0`) or soft-delete (`deleted_at = NOW()`).
2. **Locked (`is_locked = TRUE`)**:
   - Triggered when **either**:
     - The Expense's `BillingCycle` transitions to `CLOSED`, **OR**
     - Any `Settlement` exists in the same `group_id` with `settled_at >= expense.expense_date` between any pair of participants involved in that Expense (`paid_by` and any member in `split_breakdown`, or any two participants whose pairwise balance is affected).
   - **Terminal immutability:** Locked Expenses cannot be edited or soft-deleted. Discrepancies must be resolved via a new Expense with `adjustment_for_expense_id` set (Offsetting Adjustment).

### Group Lifecycle
- `ACTIVE` → `NEEDS_RATIO_UPDATE`: When a new member joins a Group in `CUSTOM_RATIOS` mode (new member gets `share_percentage = 0%`; ratio-based splits pause until Admin saves a valid 100% allocation).
- `ACTIVE` → `ARCHIVED`:
  - `TRIP` group: Automatically after all pairwise balances remain `0` for 14 consecutive days.
  - `RESIDENTIAL` group: Admin confirms archival (prompted 7 days post-`lease_end_date`).
- `ARCHIVED`: Strictly read-only (no new Expenses, Settlements, or Recurring Rule executions).

### Member Lifecycle
- `ACTIVE` → Self-Leave **Blocked** if `net_balance_cents != 0` in the Group (or account deletion blocked if any Group has `net_balance_cents != 0`).
- `ACTIVE` → `FORMER_MEMBER`: Admin forcefully removes a member with `net_balance_cents != 0`. Excluded from future default splits; retains ability to record Settlements to clear remaining debt.

---

## 3. Domain Invariants (Must Hold at All Times)

1. **Integer Minor Units Only:** Every monetary value in storage, APIs, and calculations is `BIGINT` minor units (`cents`). Floating-point arithmetic is forbidden for balances and splits.
2. **Zero Penny-Bleed Conservation Law:** For every Expense, `SUM(split_breakdown[].share_cents) == amount_cents`. For equal/percentage divisions with remainders, floor to integer cents and assign residual cent(s) to `paid_by` (if in the split) or sequentially from participant index `0`.
3. **Group Isolation Boundary:** Debt simplification, settlements, balances, and expense locking operate strictly within a single `group_id`. Cross-group netting is forbidden.
4. **Single-Currency Ledger Arithmetic:** All `Expense.amount_cents`, `Settlement.amount_cents`, and balance queries for a Group operate strictly in `Group.base_currency`. Foreign-currency inputs convert at write time and preserve `original_*` + `exchange_rate` audit fields.
5. **Point-in-Time Snapshot Integrity:** Updating `GroupMember.share_percentage`, changing `default_split_mode`, or onboarding a new member never mutates existing `Expense.split_breakdown` rows.
6. **Whole-Expense Lock Integrity:** Once any participant pair on an Expense is covered by a `Settlement` watermark or `BillingCycle.status == 'CLOSED'`, the entire Expense is immutable.
7. **Month Picker vs. Cumulative Balance Separation:** Period KPIs (Total Spent, Category Breakdown, Transaction Table) filter to the selected `BillingCycle` window; Peer Balances (`You Are Owed`, `You Owe`, `Overall Net Settlement`) always reflect all-time cumulative unsettled balances across open/unsettled items.
8. **Quota Non-Blocking:** Exhausting the `500 MB` per-user `receipt_storage_used_bytes` limit rejects only the file upload; logging an Expense without a receipt must still succeed.
9. **Reminder Rate Limit & SMS Consent:** At most 1 reminder per `(creditor_id, debtor_id, group_id)` per 24 hours. SMS delivery requires `User.notification_prefs.sms_nudges_opt_in == true` and a verified `phone_number`.

---

## 4. Role Permission Matrix

| Capability | Group Admin (`ADMIN`) | Active Member (`MEMBER`) | Former Member (`FORMER_MEMBER`) |
| --- | :---: | :---: | :---: |
| Log New Expense | Yes | Yes | No |
| Edit / Soft-Delete Own Unlocked Expense | Yes | Yes | No |
| Edit / Soft-Delete Any Member's Unlocked Expense | Yes | No | No |
| Record Settlement (Self-involved) | Yes | Yes | Yes (clearing debt/payouts only) |
| Send Nudge / Reminder (24h cooldown) | Yes | Yes | No |
| Edit Household Split Ratios & Default Mode | Yes | No (View only) | No |
| Regenerate / Revoke Invite Link | Yes | No (Copy only) | No |
| Close & Lock Billing Cycle | Yes | No | No |
| Remove Member / Transition to `FORMER_MEMBER` | Yes | No | No |
| Configure Base Currency, Budget & Archive Rules | Yes | No | No |
