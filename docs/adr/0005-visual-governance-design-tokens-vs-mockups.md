# ADR-0005: Visual Governance — Screen Mockups vs. DESIGN.md Tokens

- **Status:** Superseded by ADR-0007 (Unified `.stitch/ledgersplit/` DESIGN.md and 16 screen/modal mockups govern)
- **Date:** 2026-11-26

## Context

The `.stitch/` directory contains two conflicting visual sources: `.stitch/DESIGN.md` describes a dark/light alternating Apple marketing gallery with 80px-padded product tiles, while the five `.html`/`.png` screen mockups (`.stitch/dashboard.png`, `.stitch/expenses.png`, `.stitch/split-groups.png`, `.stitch/add-expense-modal.png`, `.stitch/settings.png`) define a light-mode SaaS workspace (**LedgerSplit**) with a persistent left sidebar, top bar, KPI cards, and itemized tables.

## Decision

1. **Screen Mockups Govern Layout & Components:** The five `.html`/`.png` screens govern all application layout, navigation chrome, light-mode theming, and interactive patterns.
2. **DESIGN.md Governs Base Tokens Only:** `.stitch/DESIGN.md` serves strictly as the foundational token dictionary (Action Blue `#0066cc`, SF Pro / Inter typography scale, border radii such as `18px` cards / `9999px` pills, and light neutrals `#f5f5f7`, `#ffffff`, `#e0e0e0`). Marketing-specific dark tiles and 80px hero sections do not apply.

## Consequences

- **Positive:** Eliminates visual ambiguity between marketing tokens and SaaS application chrome before `/ui-contract` and implementation.
- **Negative:** None; future UI contract work can reference `.stitch/*.png` directly for layout parity and `.stitch/DESIGN.md` for token values.
