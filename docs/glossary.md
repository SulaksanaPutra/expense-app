# LedgerSplit Glossary (Ubiquitous Language)

Canonical domain terminology for **LedgerSplit**, shared across architecture docs, code, and tests.

## Core Entities & Concepts

- **Group (Split Group):** An isolated shared-expense ledger (e.g., `Apartment 4B Shared`, `Weekend Cabin Crew`, `Iceland Roadtrip`) with a category (`Home`, `Trip`, `Dining`, `Utilities`, `Other`), members, canonical `base_currency`, billing cycle reset day, automation policies, and always-on per-group debt simplification.
- **Member:** A user's membership within a specific Group, carrying a role (`OWNER` / `ADMIN`, `MEMBER`, or `FORMER_MEMBER`) and a default split weight/percentage (`share_percentage` or `share_units`).
- **Former Member (`FORMER_MEMBER`):** A member removed by a Group Owner/Admin while carrying a non-zero balance, or otherwise deactivated from future splits. Excluded from new default splits while retaining settlement capability until their historical balance reaches zero.
- **Group Owner / Admin (`ADMIN`):** A Group member authorized to edit Group Split Rules & Invite settings, toggle automation policies, close/lock or auto-settle billing cycles, remove members, regenerate/revoke invite links, send email invites, and archive, restore, or permanently delete a group.
- **Expense:** A shared financial charge logged in a Group by a single **Payer**, carrying an immutable point-in-time `split_breakdown` in integer minor units (`BIGINT` cents) in the Group's `base_currency`.
- **Payer:** The single Group member who fronted the money for an Expense (`paid_by`).
- **Split Breakdown:** The immutable point-in-time JSON/record allocation on an Expense specifying each participating member's exact owed share in minor units, summing exactly to the Expense's `amount_cents`.
- **Split Method:** One of four allocation modes for Expenses and Group defaults: `EQUAL`, `PERCENTAGE`, `SHARES` (proportional integer/decimal weights), or `EXACT` / `CUSTOM`.
- **Offsetting Adjustment / Reversal:** A new corrective ledger entry (e.g., negative or compensating amount) used to fix a discrepancy on a **Locked** Expense without mutating historical records.
- **Settlement:** A first-class immutable ledger event (`transaction_type: 'SETTLEMENT'`) recording a payment from a debtor (`payer_id`) to a creditor (`recipient_id`) within a single Group (`group_id`). Supports both manual full/partial payments ("Log & Link" + `Mark Settled`) and `AUTO_SETTLED` cycle-reset settlements.
- **Settlement Handle:** A user's configured payout destination (`Venmo`, `Zelle`, `Cash App`) with a handle/account tag, optional display note, and `is_default` flag used to pre-select and deep-link payments when peers settle up.
- **Log & Link:** The manual settlement workflow: displaying the recipient's default (or chosen) `SettlementHandle` and opening a payment deep link where supported, followed by recording a `SETTLEMENT` event (`Mark Settled`).

## Time, Locking & Lifecycle

- **Billing Cycle:** The recurring accounting window for a Group, governed by `cycle_reset_day` (default: `1` / 1st of month). Scopes period spend, category breakdowns, and transaction lists.
- **Cycle Close (Macro Lock) & Auto-Settle:** Closing a Billing Cycle transitions all Expenses in that cycle window to `LOCKED` (`is_locked = TRUE`). When a group's cycle reset policy is set to **Auto-settle**, the cycle reset job automatically closes the cycle and generates `SETTLEMENT` records (`payment_rail = 'AUTO_SETTLED'`) for all open pairwise balances in that cycle.
- **Pairwise Settlement Watermark (Micro Lock):** A timestamp boundary created when member A records a `SETTLEMENT` with member B in a Group. Any Expense prior to that timestamp involving that participant pair becomes **Locked** in full (`is_locked = TRUE`).
- **Locked Expense:** An Expense frozen by either a Cycle Close or a Pairwise Settlement Watermark. Cannot be edited or soft-deleted; corrections require an Offsetting Adjustment.
- **Group Policies (Automation & Policies):** Per-group toggles governing member behavior:
  - *Allow any member to add expenses:* When `false`, only Group Owners/Admins can log new expenses.
  - *Require receipt for expenses over $100:* Enforces a receipt attachment before saving an expense when `amount_cents > 10000` (in group base currency).
  - *Send reminders when cycle closes:* Triggers an automated notification 48 hours prior to the monthly cycle cut-off.
- **Archived Group:** A read-only Group (`ARCHIVED` status). No new Expenses or Settlements can be logged. Can be **Restored** back to `ACTIVE` by an Owner/Admin, or permanently **Deleted** once all member balances are `$0.00` (with confirmation).

## Money, Splits & Budgets

- **Minor Units (`amount_cents`):** Integer representation (`BIGINT`) of currency in its smallest unit (e.g., cents for USD: `$182.50` = `18250`). Floating-point types are prohibited.
- **Group Base Currency:** The single ISO-4217 currency code (e.g., `USD`) in which a Group's ledger, expenses, and settlements operate.
- **Display Currency:** A user-level preference (`User.display_currency`) used as the display-only rollup currency for cross-group Dashboard & Expenses totals when `All Groups` is selected.
- **Deterministic Penny-Rounding:** Floor division (`floor(total * weight / total_weight)`) to integer minor units with any residual cent(s) assigned to the Payer (if in the split) or sequentially to participant index `0, 1, ...`.
- **Group Operational Budget:** The monthly spending target configured per Group (e.g., `$4,000.00`).
- **Personal Monthly Share Cap:** An individual user's personal monthly liability threshold (e.g., `$1,600.00`) tracked on the Expenses Ledger.
- **Debt Simplification:** Always-on per-group bipartite graph resolution (`WHO OWES WHOM`) that consolidates multi-person debts within a single `group_id` to minimize the number of settlement transfers without changing any member's net balance.

## Security & Notifications

- **Passkey & Active Sessions:** WebAuthn passkey enrollment (and single-passkey invite registration) paired with Google SSO and an Active Devices session list supporting per-device revocation.
- **Reminder Cooldown:** A strict 24-hour rate limit per `(creditor_id, debtor_id, group_id)` tuple governing manual settlement nudges.
