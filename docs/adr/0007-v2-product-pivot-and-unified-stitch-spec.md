# ADR-0007: LedgerSplit v2 Product Pivot, Unified Stitch Spec, and Cycle Auto-Settlement

- **Status:** Accepted
- **Date:** 2026-11-28
- **Supersedes:** ADR-0002, ADR-0004, ADR-0005

## Context

The `.stitch/` design package has been replaced by a unified 17-directory specification (`.stitch/ledgersplit/DESIGN.md` plus 16 `.stitch/ledgersplit_*/` screen, modal, and popover mockups) that removes earlier contradictions between marketing tokens and SaaS screens while introducing significant product-flow changes across Dashboard, Expenses, Split Groups, and Settings.

## Decision

1. **Unified Visual Governance (Supersedes ADR-0005):**
   - `.stitch/ledgersplit/DESIGN.md` and the 16 `.stitch/ledgersplit_*/` screens/modals are now fully aligned and jointly govern tokens, layout, components, and interactive flows.
   - `LiveSyncPill` and the Dashboard `Simplify` switch are removed; per-group debt simplification (`WHO OWES WHOM`) remains always-on.

2. **Money, Currency Rollup & Scope Simplification (Supersedes ADR-0002):**
   - All monetary values remain integer minor units (`BIGINT` cents) with deterministic penny-rounding (floor to integer cents, residual cents to Payer or sequentially from index `0`), extended to the new `SHARES` split method alongside `EQUAL`, `PERCENTAGE`, and `EXACT` / `CUSTOM`.
   - **Deferred Scope:** Foreign-currency per-expense FX overrides (`original_amount_cents`, `exchange_rate`) and `RecurringRule` schedules/cron are dropped from this release.
   - **Display Currency Rollup:** Each Group's internal ledger and settlements remain strictly in `Group.base_currency`, while `User.display_currency` performs a display-only FX rollup on `All Groups` Dashboard & Expenses totals.

3. **Cycle Reset Auto-Settlement & Group Policies (Supersedes ADR-0004):**
   - **Auto-Settle Cycle Reset:** Groups with `auto_settle_on_reset = true` automatically close their `BillingCycle` on `cycle_reset_day` (locking all period expenses) and generate `SETTLEMENT` records (`payment_rail = 'AUTO_SETTLED'`) for open simplified balances. Groups can still opt for manual cycle close.
   - **Group Policies:** Added per-group `allow_any_member_add_expense` (blocks non-Admin expense creation when `false`), `require_receipt_over_100` (enforces receipt upload in `Add Expense` when `amount_cents > 10000`), and `send_cycle_close_reminders` (48h pre-cutoff alert). The `500 MB` receipt quota ring in Settings is removed.
   - **Multi-Handle Settlements:** Replaces the single `@instant_settlement_tag` with `SettlementHandle` CRUD (`Venmo`, `Zelle`, `Cash App`) supporting `is_default` and `display_note`. `Settle now` / `Mark Settled` pre-selects the creditor's default handle.

4. **Group Archive Restore/Delete & Security Sessions:**
   - **Archive Lifecycle:** Group Owners/Admins may archive groups even with unsettled balances (displaying a warning summary), **`Restore Group`** back to `ACTIVE` anytime, or permanently **`Delete`** an archived group only when all member balances equal `$0.00`.
   - **Auth & Sessions:** Wire Supabase Auth for Google SSO, Email/Magic Link, WebAuthn Passkeys (including single-passkey invite registration with 14-day email/link invites), and `Active Devices` session revocation.

## Consequences

- **Positive:** Eliminates FX override and recurring-cron complexity, aligns all UI screens 1:1 with `.stitch/ledgersplit*/`, and introduces deterministic cycle auto-settlement, group-level expense policies, multi-handle payouts, and reversible group archiving.
- **Negative:** Breaking schema and route changes; requires dropping legacy tables/columns and removing obsolete UI/API flows cleanly.

## Clean Removal Mandate (Zero Backward Compatibility)

Per product direction, **no backward-compatibility shims, deprecated tables, or leftover flows** may remain when implementing v2. Any feature absent from the new `.stitch/ledgersplit*/` UI/UX is explicitly removed:
- **Drop Tables / Columns:** `recurring_rules` table; `expenses.original_amount_cents`, `expenses.original_currency`, `expenses.exchange_rate`, `expenses.exchange_rate_source`, `expenses.is_recurring_generated`, `expenses.recurring_rule_id`; `users.receipt_storage_used_bytes`, `users.instant_settlement_tag`; `groups.simplify_debts`, `groups.lease_end_date`.
- **Remove API Routes & Cron:** `/api/groups/[groupId]/recurring-rules`, `/api/cron/recurring-expenses`, `/api/groups/[groupId]/archive-rules`, `/api/groups/archive-check`, `/api/groups/[groupId]/simplify` (simplification is always-on), and `/api/settings/phone-verify` (if not in new Settings UI).
- **Remove UI Surfaces:** `Recurring` tab in Expenses, `500 MB` receipt quota ring in Settings, `LiveSyncPill`, Dashboard `Simplify` switch, `Archive Rules` modal, and per-expense FX rate override UI.
