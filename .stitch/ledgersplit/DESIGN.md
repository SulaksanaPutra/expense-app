---
name: LedgerSplit
colors:
  surface: '#f9f9fb'
  surface-dim: '#d9dadc'
  surface-bright: '#f9f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f5'
  surface-container: '#edeef0'
  surface-container-high: '#e8e8ea'
  surface-container-highest: '#e2e2e4'
  on-surface: '#1a1c1d'
  on-surface-variant: '#414753'
  inverse-surface: '#2f3132'
  inverse-on-surface: '#f0f0f2'
  outline: '#727784'
  outline-variant: '#c1c6d5'
  surface-tint: '#205daf'
  primary: '#014e9f'
  on-primary: '#ffffff'
  primary-container: '#2e67b9'
  on-primary-container: '#dfe8ff'
  inverse-primary: '#aac7ff'
  secondary: '#075cb9'
  on-secondary: '#ffffff'
  secondary-container: '#639dfe'
  on-secondary-container: '#00346e'
  tertiary: '#883700'
  on-tertiary: '#ffffff'
  tertiary-container: '#a84e19'
  on-tertiary-container: '#ffe2d6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d7e3ff'
  primary-fixed-dim: '#aac7ff'
  on-primary-fixed: '#001b3e'
  on-primary-fixed-variant: '#00458e'
  secondary-fixed: '#d7e3ff'
  secondary-fixed-dim: '#abc7ff'
  on-secondary-fixed: '#001b3f'
  on-secondary-fixed-variant: '#00458f'
  tertiary-fixed: '#ffdbcb'
  tertiary-fixed-dim: '#ffb692'
  on-tertiary-fixed: '#341100'
  on-tertiary-fixed-variant: '#793000'
  background: '#f9f9fb'
  on-background: '#1a1c1d'
  surface-variant: '#e2e2e4'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '600'
    lineHeight: 24px
  headline-sm:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

# LedgerSplit Design System & 1:1 Live App UI Contract

## 1. Color & Surface Tokens
- **Canvas & Surfaces:**
  - App background (`canvas-parchment` / `surface`): `#f9f9fb` / `#f5f5f7`
  - Outer cards / shell (`Sidebar`, `TopBar`, `surface-container-lowest`): `#ffffff`
  - Nested sub-cards / inputs (`surface-container-low`): `#f3f3f5`
  - Table header / hover tint (`surface-pearl`): `#fafafc`
- **Borders & Dividers:**
  - Hairline border (`outline-variant/60` / `#e0e0e0`): `1px solid`
  - Soft divider (`border-divider-soft`): `1px solid #f0f0f0`
- **Text Ink:**
  - Primary (`on-surface`): `#1a1c1d` / `#1d1d1f` | Variant (`on-surface-variant`): `#414753` | Muted (`outline`): `#727784` / `#7a7a7a`
- **Brand & Semantic:**
  - Primary accent (`primary-container`): `#0066cc` (hover `secondary-container` `#0372e4` / `#0071e3`)
  - Success: `emerald-50` / `emerald-700` / `emerald-200` (active switch `#22c55e`)
  - Warning: `amber-50` / `amber-800` / `amber-200`
  - Error / Danger: `#ba1a1a` / `#dc2626`

## 2. Typography Scale & Rules
- **Font Families:** `Inter` (`SF Pro Display` / `SF Pro Text` fallback).
- **Iconography:** Material Symbols Outlined (`material-symbols-outlined`) for all shell, navigation, and toolbar icons.
- **Hierarchy:**
  - **Page Eyebrow (optional):** `11px`, semibold `600`, uppercase, tracking-wider, `#0066cc`
  - **Page Title (`<h1>`):** `24px–30px` (`text-2xl sm:text-3xl`), semibold `600`, tracking-tight, `#1a1c1d`
  - **Page Subtitle:** `14px`, regular `400`, `#727784` (1 concise line)
  - **Section Heading (`<h2>` / `CardTitle`):** `17px`, semibold `600`, tracking `-0.015em`, `#1a1c1d`
  - **Sub-card / Insight Title (`<h3>`):** `14px–16px`, semibold `600`, `#1a1c1d`
  - **Form Label:** `12px`, semibold `600`, tracking-wide, `#414753`
  - **Body / Helper / Hint:** `13px` body, `12px` `#727784` hints
- **Numeric Rule:** All currency amounts, counts, and percentages must use `tabular-nums`.

## 3. Mandatory App Shell & Page Anatomy (Canonical Lock — Match `LedgerSplit Dashboard Overview` 1:1)
Every `(app)` screen MUST render the exact static App Shell below without adding, removing, resizing, or reordering items:

- **Fixed Left Sidebar (`w-[248px]`, `h-screen fixed left-0 top-0`, `bg-surface-container-lowest` `#ffffff`, `border-r border-outline-variant/60`, `p-4 flex flex-col justify-between z-30`):**
  - **Brand Header (`flex items-center gap-2.5 px-2 py-1`):** `28x28px` (`w-7 h-7 rounded-lg bg-primary-container text-on-primary shadow-sm`) with `account_balance_wallet` icon (`18px`) + `"LedgerSplit"` (`headline-md` `17px`). **No** extra `"SHARED"` badge or subtitle.
  - **Primary Nav (`flex flex-col gap-1`, exactly 4 pill links `h-10 px-3.5 rounded-full`):**
    1. `grid_view` (`20px`) + `"Dashboard"`
    2. `receipt_long` (`20px`) + `"Expenses"`
    3. `group` (`20px`) + `"Split Groups"` + right-aligned count pill `"4"` (`bg-surface-container-low text-on-surface-variant text-[11px] px-2 py-0.5 rounded-full border border-outline-variant/60`)
    4. `settings` (`20px`) + `"Settings"`
    - *Active state:* `bg-primary-container text-on-primary font-headline-sm`; *Inactive:* `text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface font-body-md`.
  - **Sidebar Footer (`flex flex-col`):**
    - **`ACTIVE GROUP` Sub-Card (`bg-surface-container-low border border-outline-variant/60 rounded-[14px] p-3 mb-2`):**
      - Row 1: `"ACTIVE GROUP"` (`label-sm uppercase text-outline tracking-wider mb-2`)
      - Row 2 (`flex items-center justify-between mb-3`): `"All Groups"` (`headline-sm text-on-surface`) on left + `"18 splits"` pill (`bg-surface-container-lowest border border-outline-variant/60 text-primary-container label-sm px-2 py-0.5 rounded-full`) on right
      - Row 3 (`flex items-center -space-x-2`): 2-avatar stack (`w-6 h-6 rounded-full ring-2 ring-surface-container-lowest text-[11px] font-bold`): `MK` (`bg-secondary text-on-secondary`) and `AL` (`bg-tertiary-container text-on-tertiary`)
    - **Collapse Button:** `h-9 w-full rounded-full text-outline hover:bg-surface-container-low hover:text-on-surface body-sm flex items-center justify-center gap-2` with `keyboard_double_arrow_left` (`18px`) + `"Collapse Sidebar"`.

- **Sticky TopBar (`fixed top-0 left-[248px] right-0 h-16 bg-surface-container-lowest/85 backdrop-blur-md border-b border-outline-variant/60 px-8 flex items-center justify-between z-20`):**
  - **Left:** Billing cycle pill (`rounded-full border border-outline-variant/60 bg-surface-container-lowest h-9 px-3 flex items-center gap-2 headline-sm shadow-sm`): `chevron_left` (`18px`) + `"November 2026"` + `chevron_right` (`18px`).
  - **Right (`flex items-center gap-3`):**
    1. Search bar: `h-9 w-64 rounded-full border border-outline-variant/60 bg-surface-container-low pl-9 pr-12 body-sm` with `search` icon (`18px`), placeholder `"Search transactions..."`, and right `⌘K` kbd badge (`border border-outline-variant/60 bg-surface-container-lowest rounded px-1`).
    2. Notification bell: `w-9 h-9 rounded-full border border-outline-variant/60 bg-surface-container-lowest` with `notifications` icon (`20px`) and `w-2 h-2 rounded-full bg-error ring-2 ring-surface-container-lowest` dot.
    3. Primary CTA: `h-9 px-4 rounded-full bg-primary-container hover:bg-secondary-container text-on-primary headline-sm flex items-center gap-1.5 shadow-sm` with `add` (`18px`) + `"Add Expense"`.
    4. User avatar: `w-9 h-9 rounded-full bg-primary-container text-on-primary headline-sm flex items-center justify-center` with `"JD"`.

- **Standardized `<PageHeader />` (`max-w-7xl`):**
  - Left: Optional uppercase eyebrow (`#0066cc`), `<h1>` + inline `LiveSyncPill` / cycle badge, 1-line subtitle (`#727784`)
  - Right: Page-specific `Select`, `SegmentedControl`, and `Button` actions (`whitespace-nowrap`)

## 4. Standardized UI Components & Variants
- **`Button` (`rounded-full` pill):**
  - Variants: `primary` (`#0066cc` fill, `#ffffff` text), `secondary` (`#ffffff` fill, `1px #e0e0e0`, `#1d1d1f` text), `danger-soft` (`#fef2f2` fill, `#b91c1c` text, `1px #fecaca`), `danger` (`#dc2626` fill, `#ffffff`), `ghost`, `icon-circle` (`36px`/`40px`/`44px`)
  - Sizes: `sm` (`h-8`, header/card actions), `md` (`h-10`, modal/form submit CTAs), `lg` (`h-11`)
- **`Card` (`rounded-[18px]`, `1px solid #e0e0e0`):**
  - Variants: `kpi`, `section`, `spotlight` (`#ffffff`), `sub-card` (`#f5f5f7` parchment for nested blocks—never ad-hoc `rounded-[14px]` divs)
- **`Input` & `SearchInput`:**
  - `Input`: `h-11`, `11px` radius, `1px #e0e0e0`, `#ffffff` bg (`#f5f5f7` 60% when disabled), supports `label`, `hint`, `error`, `prefix`, `suffix`
  - `SearchInput`: pill search bar (`9999px`) with `shortcut` kbd badge (`/`, `⌘K`) and clear button
- **`Select` & `Dropdown`:**
  - `Select` variants: `default` (forms), `pill-select` (toolbars/headers), `searchable-select`
  - `Dropdown`: `⋮` action menus supporting `danger` items
- **`SegmentedControl`:**
  - `pill-tabs` (page header filters) and `split-method` (form/settings mode toggle)
- **`Badge` / `StatusPill` (`rounded-full`):**
  - Tones: `neutral`, `info`, `success`, `warning`, `danger`, `category` (with optional `dot` / `dotColor`); sizes `sm`, `md`
- **`Switch`:**
  - Tones: `success` (`#22c55e`) and `primary` (`#0066cc`); inactive `#d2d2d7`; sizes `sm` (`h-5 w-9`), `md` (`h-6 w-11`)
- **`ProgressBar` & `ProgressRing`:**
  - Tones: `primary`, `success`, `warning`, `danger`, `auto` (`>=75%` amber, `>=90%` red); supports `segments`
- **`Table` & `Pagination`:**
  - `rounded-[14px] border border-hairline overflow-hidden`, sortable `TableHead`, `TableEmpty`, pill `Pagination`
- **`Avatar` & `AvatarStack`:**
  - Circular initials/photos; overlapping stack with `2px #ffffff` ring
- **`AlertBanner`, `Dialog`, `ConfirmDialog`, `Toast`:**
  - All modals, confirmations, and inline alerts must use these primitives

## 5. Enforcement Rules
1. Zero raw `<button>`, `<input>`, `<select>`, or `<dialog>` elements in `(app)` pages or modals.
2. Replace ad-hoc inline hexes (`#248a3d`, `#ff3b30`, `#22c55e`) with `Badge` tones or semantic Tailwind classes; keep `#0066cc` for primary accent.
3. All `LiveSyncPill` and `<h1>` headers must follow the unified `<PageHeader />` contract.