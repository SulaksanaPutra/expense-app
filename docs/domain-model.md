# LedgerSplit Domain Model

## 1. Core Entities & Relationships

```
User (1) ────────< GroupMember >──────── (1) Group
  │                                            │
  ├──< SettlementHandle                        ├──< BillingCycle
  ├──< UserSession (Active Devices)            ├──< Expense ──< ExpenseRevision
  │                                            ├──< GroupInvite
  └────────────────────────────────────────────┴──< Settlement
```

### `User`
- `id`: UUID (Supabase Auth user ID)
- `full_name`: string
- `email`: string (unique, managed via Google SSO / Email)
- `phone_number`: string (nullable, used for Zelle settlement identity & SMS reminders)
- `timezone`: string (IANA timezone, e.g., `America/Los_Angeles`)
- `display_currency`: ISO-4217 `VARCHAR(3)` (rollup currency for `All Groups` Dashboard & Expenses totals)
- `personal_share_cap_cents`: `BIGINT` (nullable, e.g., `160000` for `$1,600.00`)
- `auto_include_in_expenses`: boolean (default `true`; pre-selects user in new expense splits)
- `notification_prefs`: `{ new_expense_added: boolean, settlement_recorded: boolean, cycle_close_reminder: boolean, monthly_summary_digest: boolean }`

### `SettlementHandle`
- `id`: UUID
- `user_id`: UUID (references `User.id`)
- `provider`: `'VENMO' | 'ZELLE' | 'CASH_APP'`
- `handle`: string (username, phone number, email, or `$cashtag`)
- `display_note`: string (nullable, e.g., `"Personal Venmo"`)
- `is_default`: boolean (at most one default handle per user; pre-selected when peers settle up)
- `created_at`: timestamp

### `Group`
- `id`: UUID
- `name`: string (e.g., `Apartment 4B Shared`)
- `slug`: string (unique, e.g., `apt-4b-8x9k`)
- `category`: `'HOME' | 'TRIP' | 'DINING' | 'UTILITIES' | 'OTHER'`
- `status`: `'ACTIVE' | 'NEEDS_RATIO_UPDATE' | 'ARCHIVED'`
- `archived_at`: timestamp (nullable)
- `base_currency`: ISO-4217 `VARCHAR(3)` (canonical currency for all ledger arithmetic in this group)
- `default_split_mode`: `'EQUAL' | 'PERCENTAGE' | 'SHARES' | 'CUSTOM'`
- `operational_budget_cents`: `BIGINT` (nullable, e.g., `400000`)
- `cycle_reset_day`: integer (`1..28`, default `1`)
- `auto_settle_on_reset`: boolean (default `true`; when `true`, cycle reset auto-closes and auto-creates `SETTLEMENT` records)
- `allow_any_member_add_expense`: boolean (default `true`; when `false`, only `ADMIN`/`OWNER` can log expenses)
- `require_receipt_over_100`: boolean (default `false`; requires receipt attachment when `amount_cents > 10000`)
- `send_cycle_close_reminders`: boolean (default `true`; triggers notification 48h prior to cycle cut-off)
- `invite_token`: signed token for `/join/[slug]?token=...` (14-day expiry, regenerable by Owner/Admin)

### `GroupMember`
- `group_id`: UUID
- `user_id`: UUID
- `role`: `'ADMIN' | 'MEMBER'` (`ADMIN` is displayed as `Owner` / `Primary Organizer` for group creator)
- `status`: `'ACTIVE' | 'FORMER_MEMBER'`
- `share_percentage`: numeric (`0..100`, sum of active members = `100.00` when `PERCENTAGE` / `CUSTOM` is active)
- `share_units`: numeric (`>= 0`, used when `default_split_mode = 'SHARES'`)
- `joined_at`: timestamp

### `GroupInvite`
- `id`: UUID
- `group_id`: UUID
- `invited_email`: string
- `invited_by`: UUID
- `token`: string (signed, 14-day expiry)
- `status`: `'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED'`
- `created_at`: timestamp

### `Expense`
- `id`: UUID
- `group_id`: UUID
- `created_by`: UUID
- `paid_by`: UUID (single payer)
- `description`: string (merchant / description)
- `category`: string (e.g., `Groceries`, `Utilities`, `Dining`, `Travel`, `Entertainment`, `Supplies`)
- `expense_date`: timestamp
- `amount_cents`: `BIGINT NOT NULL` (in `Group.base_currency`)
- `currency`: `VARCHAR(3) NOT NULL` (must equal `Group.base_currency`)
- `split_method`: `'EQUAL' | 'PERCENTAGE' | 'EXACT' | 'SHARES'`
- `split_breakdown`: JSONB array `[{ user_id, share_cents, percentage?, shares? }]` (immutable snapshot at write time)
- `receipt_url`: string (nullable; required when `Group.require_receipt_over_100 == true` and `amount_cents > 10000`)
- `adjustment_for_expense_id`: UUID (nullable, for Offsetting Adjustments)
- `is_locked`: boolean (computed/persisted lock state)
- `deleted_at`: timestamp (nullable, soft delete)

### `ExpenseRevision`
- `id`: UUID
- `expense_id`: UUID
- `updated_by`: UUID
- `old_snapshot`: JSONB
- `new_snapshot`: JSONB
- `created_at`: timestamp

### `Settlement`
- `id`: UUID
- `group_id`: UUID
- `payer_id`: UUID (debtor paying)
- `recipient_id`: UUID (creditor receiving)
- `amount_cents`: `BIGINT NOT NULL` (`> 0`, in `Group.base_currency`, supports partial payments)
- `payment_rail`: `'VENMO' | 'ZELLE' | 'CASH_APP' | 'CASH' | 'BANK_SETTLEMENT' | 'AUTO_SETTLED' | 'OTHER'`
- `settlement_handle_id`: UUID (nullable, references `SettlementHandle.id` when settled via a configured handle)
- `settled_at`: timestamp (immutable ledger event)

### `BillingCycle`
- `id`: UUID
- `group_id`: UUID
- `period_start`: date
- `period_end`: date
- `status`: `'OPEN' | 'CLOSED'`
- `closed_by`: UUID (nullable; `NULL` when auto-closed by cycle reset job)
- `closed_at`: timestamp (nullable)

### `ReminderLog`
- `creditor_id`: UUID
- `debtor_id`: UUID
- `group_id`: UUID
- `channel`: `'PUSH' | 'EMAIL'`
- `sent_at`: timestamp

---

## 2. State Lifecycles

### Expense Lifecycle
1. **Unlocked (`is_locked = FALSE`, `deleted_at IS NULL`)**:
   - Creator or Group Owner/Admin may edit fields/splits (recording an `ExpenseRevision`; notifying affected members) or soft-delete (`deleted_at = NOW()`).
2. **Locked (`is_locked = TRUE`)**:
   - Triggered when **either**:
     - The Expense's `BillingCycle` transitions to `CLOSED`, **OR**
     - Any `Settlement` exists in the same `group_id` with `settled_at >= expense.expense_date` between any pair of participants involved in that Expense (`paid_by` and any member in `split_breakdown`).
   - **Terminal immutability:** Locked Expenses cannot be edited or soft-deleted. Discrepancies must be resolved via a new Expense with `adjustment_for_expense_id` set (Offsetting Adjustment).

### Group Lifecycle
- `ACTIVE` → `NEEDS_RATIO_UPDATE`: When a new member joins a Group in `PERCENTAGE` or `CUSTOM` mode (new member gets `0%`; ratio-based splits pause until Owner/Admin saves a valid 100% allocation).
- `ACTIVE` → `ARCHIVED`: Owner/Admin archives the group (permitted even if unsettled balances exist; confirmation modal displays current net ledger and unsettled balance count). Group becomes strictly read-only.
- `ARCHIVED` → `ACTIVE`: Owner/Admin clicks **`Restore Group`** from the Archived view, resuming expense entry and split rule edits.
- `ARCHIVED` → **Permanently Deleted**: Owner/Admin clicks **`Delete`** on an archived group. **Blocked** if any member has a non-zero unsettled balance (`net_balance_cents != 0`); requires explicit confirmation when all balances are `$0.00`.

### Billing Cycle & Auto-Settle Lifecycle
- When `Group.auto_settle_on_reset == true`:
  - 48 hours before `cycle_reset_day` (if `send_cycle_close_reminders == true`), send a cycle-close reminder notification.
  - On `cycle_reset_day`, close the current `BillingCycle` (`status = 'CLOSED'`, locking all period expenses) AND generate `SETTLEMENT` records (`payment_rail = 'AUTO_SETTLED'`) for all open simplified pairwise balances in that cycle.
- When `Group.auto_settle_on_reset == false`:
  - Cycle closes manually by Owner/Admin; open balances remain pending until manually settled.

### Member & Account Lifecycle
- `ACTIVE` → Self-Leave **Blocked** if `net_balance_cents != 0` in the Group (and `Delete Account` in Settings is **Blocked** if any Group has `net_balance_cents != 0`).
- `ACTIVE` → `FORMER_MEMBER`: Owner/Admin removes a member with `net_balance_cents != 0`. Excluded from future default splits; retains ability to record Settlements to clear remaining debt.

---

## 3. Domain Invariants (Must Hold at All Times)

1. **Integer Minor Units Only:** Every monetary value in storage, APIs, and calculations is `BIGINT` minor units (`cents`). Floating-point arithmetic is forbidden for balances and splits.
2. **Zero Penny-Bleed Conservation Law:** For every Expense, `SUM(split_breakdown[].share_cents) == amount_cents`. For `EQUAL`, `PERCENTAGE`, and `SHARES` divisions with remainders, floor to integer cents (`floor(total * weight / total_weight)`) and assign residual cent(s) to `paid_by` (if in the split) or sequentially from participant index `0`.
3. **Group Isolation Boundary:** Debt simplification (always-on per group), settlements, balances, and expense locking operate strictly within a single `group_id`. Cross-group netting is forbidden.
4. **Single-Currency Ledger vs. Display-Only Rollup:** All `Expense.amount_cents`, `Settlement.amount_cents`, and per-group balance queries operate strictly in `Group.base_currency`. When `All Groups` is selected on Dashboard or Expenses, totals convert to `User.display_currency` at display time only without mutating group ledgers.
5. **Point-in-Time Snapshot Integrity:** Updating group split rules, changing `default_split_mode`, or onboarding a new member never mutates existing `Expense.split_breakdown` rows.
6. **Whole-Expense Lock Integrity:** Once any participant pair on an Expense is covered by a `Settlement` watermark or `BillingCycle.status == 'CLOSED'`, the entire Expense is immutable.
7. **Policy Enforcement at Write Time:**
   - If `Group.allow_any_member_add_expense == false`, `POST /api/groups/[groupId]/expenses` rejects non-Admin members with `403 Forbidden`.
   - If `Group.require_receipt_over_100 == true` and `amount_cents > 10000`, saving without a `receipt_url` is rejected with `400 Bad Request`.
8. **Reminder Rate Limit:** At most 1 manual reminder per `(creditor_id, debtor_id, group_id)` per 24 hours.
9. **Archived Group Immutability:** While `Group.status == 'ARCHIVED'`, no new Expenses, Settlements, or rule edits are permitted until restored.

---

## 4. Role Permission Matrix

| Capability | Group Owner / Admin (`ADMIN`) | Active Member (`MEMBER`) | Former Member (`FORMER_MEMBER`) |
| --- | :---: | :---: | :---: |
| Log New Expense (`allow_any_member_add_expense = true`) | Yes | Yes | No |
| Log New Expense (`allow_any_member_add_expense = false`) | Yes | No | No |
| Edit / Soft-Delete Own Unlocked Expense | Yes | Yes | No |
| Edit / Soft-Delete Any Member's Unlocked Expense | Yes | No | No |
| Record Settlement (Self-involved) | Yes | Yes | Yes (clearing debt/payouts only) |
| Send Nudge / Reminder (24h cooldown) | Yes | Yes | No |
| Edit Split Rules, Policies & Invite Settings | Yes | No (View only) | No |
| Send Email Invite / Regenerate Invite Link | Yes | No (Copy link only) | No |
| Close Billing Cycle / Archive / Restore Group | Yes | No | No |
| Permanently Delete Archived Group (`$0.00` balance) | Yes | No | No |
| Remove Member / Transition to `FORMER_MEMBER` | Yes | No | No |
