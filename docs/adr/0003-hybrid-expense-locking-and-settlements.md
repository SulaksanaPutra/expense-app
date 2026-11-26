# ADR-0003: Per-Group Debt Simplification and Hybrid Expense Locking

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

Users belong to multiple unrelated groups (e.g., `Apt 4B Roommates` and `Tahoe Ski Cabin`). Cross-group debt netting would make a user owe a stranger from another group, while unguarded expense edits after partial settlements would invalidate completed payments.

## Decision

1. **First-Class Immutable Settlements:** Settlements are recorded as independent `SETTLEMENT` ledger events (`group_id`, `payer_id`, `recipient_id`, `amount_cents`, `settled_at`), supporting both full and partial payments.
2. **Strictly Per-Group Debt Simplification:** Bipartite graph resolution (`Simplify Group Debts`) runs strictly within a single `group_id`. Cross-group debt netting is prohibited.
3. **Hybrid Locking Model:**
   - **Explicit Cycle Close (Macro Lock):** When a Group Admin closes a `BillingCycle`, all Expenses in that period become `LOCKED`.
   - **Pairwise Settlement Watermark (Micro Lock):** When any participant pair records a `SETTLEMENT`, any prior Expense involving that participant pair is locked **in its entirety** (`is_locked = TRUE`), preventing partial drift of the `split_breakdown`.
4. **Immutable Corrections via Offsetting Adjustments:** Locked Expenses cannot be edited or soft-deleted. Errors are corrected by logging a new Offsetting Adjustment / Reversal entry referencing the original Expense.
5. **Pre-Lock Revisions:** Unlocked Expenses may be edited by their creator or Group Admin, recording an `ExpenseRevision` audit row and notifying affected members if any owed share changes.

## Consequences

- **Positive:** Deterministic, auditable double-entry history; uninvolved roommates are not prematurely locked out of editing separate expenses before cycle close.
- **Negative:** Locking an entire multi-party expense upon any pairwise settlement requires users to use Offsetting Adjustments for late corrections, which must be surfaced clearly in the UI.
