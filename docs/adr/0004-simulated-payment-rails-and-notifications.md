# ADR-0004: Simulated Payment Rails, Notification Cooldowns, and Receipt Quota

- **Status:** Superseded by ADR-0007 (Multi-handle settlements, Auto-settle cycle reset, and updated notification/receipt policies defined in ADR-0007)
- **Date:** 2026-11-26

## Context

The UI mockups display Venmo / Apple Card settlement rails, Push/SMS reminders, and a 500 MB cloud receipt archival quota. Direct ACH/money-transmitter facilitation introduces FinCEN/MSB compliance scope outside MVP.

## Decision

1. **"Log & Link" Settlement Rails:** Clicking a payment rail (e.g., Venmo) opens a deep link (`venmo://paycharge?...`) or displays the recipient's `instant_settlement_tag` (`@handle`), and records a manual `SETTLEMENT` event ("Mark as Settled") on the ledger. No funds move through LedgerSplit servers.
2. **Notifications & Anti-Spam:**
   - Web Push / in-app notifications are enabled by default for active members.
   - Twilio SMS nudges require explicit per-user opt-in (`sms_nudges_opt_in`) and a verified phone number.
   - A strict **24-hour cooldown** is enforced per `(creditor_id, debtor_id, group_id)` tuple.
3. **500 MB Per-User Receipt Quota:** Tracked across all Groups per user. Exhausting the quota blocks only new receipt uploads with a non-blocking warning; logging Expenses without receipts continues to succeed.

## Consequences

- **Positive:** Zero money-transmitter compliance risk for MVP, TCPA-aligned SMS opt-in, and resilient ledger writes even when media storage is full.
- **Negative:** Settlements rely on user confirmation ("Mark as Settled") rather than automated bank webhook verification.
