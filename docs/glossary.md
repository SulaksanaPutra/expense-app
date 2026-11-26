# LedgerSplit Glossary (Ubiquitous Language)

Canonical domain terminology for **LedgerSplit**, shared across architecture docs, code, and tests.

## Core Entities & Concepts

- **Group (Split Group):** An isolated shared-expense ledger (e.g., `Apt 4B Roommates`, `Tahoe Ski Cabin`, `Co-working & Coffee`) with its own members, canonical base currency, billing cycle, operational budget, and debt-simplification setting.
- **Member:** A user's membership within a specific Group, carrying a role (`ADMIN`, `MEMBER`, or `FORMER_MEMBER`) and a default split ratio (`share_percentage`).
- **Former Member (`FORMER_MEMBER`):** A member removed by a Group Admin while carrying a non-zero balance, or otherwise deactivated from future splits. Excluded from new default splits while retaining settlement capability until their historical balance reaches zero.
- **Group Admin (`ADMIN`):** A Group member authorized to edit Household Split Ratios, close/lock billing cycles, remove members, regenerate/revoke invite links, and configure group base currency, billing cycle, budget, and archive rules.
- **Expense:** A shared financial charge logged in a Group by a single **Payer**, carrying an immutable point-in-time `split_breakdown` in integer minor units (`BIGINT` cents) in the Group's base currency.
- **Payer:** The single Group member who fronted the money for an Expense (`paid_by`).
- **Split Breakdown:** The immutable point-in-time JSON/record allocation on an Expense specifying each participating member's exact owed share in minor units, summing exactly to the Expense's `amount_cents`.
- **Offsetting Adjustment / Reversal:** A new corrective ledger entry (e.g., negative or compensating amount) used to fix a discrepancy on a **Locked** Expense without mutating historical records.
- **Settlement:** A first-class immutable ledger event (`transaction_type: 'SETTLEMENT'`) recording a payment from a debtor (`payer_id`) to a creditor (`recipient_id`) within a single Group (`group_id`). Supports both full and partial payments.
- **Log & Link:** The MVP settlement workflow: generating a payment deep link (e.g., `venmo://paycharge?...`) or displaying the recipient's Instant Settlement Tag, followed by recording a `SETTLEMENT` event ("Mark as Settled").

## Time, Locking & Lifecycle

- **Billing Cycle:** The recurring accounting window for a Group (default: Calendar Month, e.g., Oct 1–31; configurable to lease-aligned dates such as 15th-to-15th). Scopes period spend, category breakdowns, and transaction lists.
- **Cycle Close (Macro Lock):** An explicit Group Admin action closing a Billing Cycle (e.g., month-end settlement), transitioning all Expenses in that cycle window to `LOCKED` (`is_locked = TRUE`).
- **Pairwise Settlement Watermark (Micro Lock):** A timestamp boundary created when member A records a `SETTLEMENT` with member B in a Group. Any Expense prior to that timestamp involving that participant pair becomes **Locked** in full (`is_locked = TRUE`).
- **Locked Expense:** An Expense frozen by either a Cycle Close or a Pairwise Settlement Watermark. Cannot be edited or soft-deleted; corrections require an Offsetting Adjustment.
- **Recurring Rule:** A scheduled template (`frequency`, `day_of_month`, `split_rule`) that a background job materializes into concrete `RECURRING`-flagged Expense rows on its trigger date.
- **Archive Rules:** Automated group lifecycle rules:
  - *Trip Auto-Archive:* Transitions trip groups to `ARCHIVED` after all pairwise balances remain `0` for 14 consecutive days.
  - *Lease Expiration Prompt:* Prompts the Group Admin 7 days after the configured lease end date to archive a residential group.
- **Archived Group:** A strictly read-only Group (`ARCHIVED` status). No new Expenses or Settlements can be logged.

## Money, Splits & Budgets

- **Minor Units (`amount_cents`):** Integer representation (`BIGINT`) of currency in its smallest unit (e.g., cents for USD: `$182.50` = `18250`). Floating-point types are prohibited.
- **Group Base Currency:** The single ISO-4217 currency code (e.g., `USD`) in which a Group's ledger, balances, and exports operate.
- **FX Audit Trail:** Metadata stored on foreign-currency Expenses (`original_amount_cents`, `original_currency`, `exchange_rate`, `exchange_rate_source`: `'API' | 'MANUAL_OVERRIDE'`) alongside the converted `amount_cents` in Group Base Currency.
- **Deterministic Penny-Rounding:** Floor division to 2 decimal places (`floor(total / n)`) with any residual cent(s) assigned to the Payer (or sequentially to participant index `0, 1, ...` if the Payer is not in the split).
- **Group Operational Budget:** The monthly spending target configured per Group (e.g., `$4,500.00` for `Apt 4B Roommates`).
- **Personal Share Cap:** An individual user's personal monthly liability threshold (e.g., `$1,600.00`) tracked on the Expenses view.
- **Debt Simplification:** Per-group bipartite graph resolution that consolidates multi-person debts within a single `group_id` to minimize the number of settlement transfers without changing any member's net balance.

## Quotas & Notifications

- **Receipt Storage Quota:** A per-user `500 MB` cloud storage allocation across all Groups for uploaded receipt attachments. Reaching the limit degrades gracefully (expenses log without attachments) without blocking ledger writes.
- **Reminder Cooldown:** A strict 24-hour rate limit per `(creditor_id, debtor_id, group_id)` tuple governing settlement nudges.
- **Instant Settlement Tag:** A user's configured handle (e.g., `@alex-rivera-99`) used for Log & Link deep-linking.
