# ADR-0002: Integer Minor-Unit Money Representation and FX Audit Trail

- **Status:** Superseded by ADR-0007 (FX audit trail removed; integer minor-unit & rounding rules carried forward in ADR-0007)
- **Date:** 2026-11-26

## Context

Shared expense ledgers fail in production when floating-point arithmetic introduces IEEE 754 precision drift ("penny bleed") or when multi-currency expenses mix denominations inside balance queries.

## Decision

1. **Minor Units (`BIGINT`) Only:** All monetary columns in Postgres and all API/UI calculation pipelines must use integer minor units (`BIGINT` cents, e.g., `$182.50` = `18250`) paired with an ISO-4217 currency code (`VARCHAR(3)`). `FLOAT` and `DOUBLE` are prohibited for monetary values.
2. **Single Group Base Currency:** Each Group has one canonical `base_currency`. All ledger aggregations, peer balances, budgets, and CSV/JSON exports operate strictly in that currency.
3. **Foreign-Currency Conversion at Write Time:** When an Expense is logged in a foreign currency, the client fetches a spot rate (with an editable manual override for actual card/receipt rates) and converts to `Group.base_currency` before persistence. Both the converted amount and original FX audit fields (`original_amount_cents`, `original_currency`, `exchange_rate`, `exchange_rate_source`) are stored on the Expense row.
4. **Deterministic Penny-Rounding:** Equal and percentage splits floor each participant's share to integer minor units and assign any residual cent(s) to the Payer (or sequentially starting at participant index `0` if the Payer is excluded from the split), guaranteeing `SUM(split_breakdown) == amount_cents`.

## Consequences

- **Positive:** Exact cent-level conservation across all splits, settlements, and debt simplification graphs; full auditability for international travel expenses.
- **Negative:** Changing a Group's `base_currency` after transactions exist requires explicit migration/re-denomination rules or restricting currency changes once expenses are logged.
