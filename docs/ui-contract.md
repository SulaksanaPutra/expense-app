# UI & Integration Contract

## 1. Visual Source Precedence & Resolved Contradictions

- **Governing Layout & Theme Sources:** `.stitch/dashboard.png` (`.stitch/dashboard.html`), `.stitch/expenses.png` (`.stitch/expenses.html`), `.stitch/split-groups.png` (`.stitch/split-groups.html`), `.stitch/add-expense-modal.png` (`.stitch/add-expense-modal.html`), and `.stitch/settings.png` (`.stitch/settings.html`). *(Note: `.stitch/prototype.html` is an identical copy of `.stitch/dashboard.html`.)*
- **Governing Token Source:** `.stitch/DESIGN.md` supplies foundational tokens only: Action Blue (`#0066cc`), focus blue (`#0071e3`), light canvas parchment (`#f5f5f7`), card surface (`#ffffff`), hairlines (`#e0e0e0`), ink hierarchy (`#1d1d1f`, `#333333`, `#7a7a7a`), SF Pro / system-ui typography scale, and radii (`18px` cards, `9999px` pills).
- **Resolved Contradiction (`docs/adr/0005-visual-governance-design-tokens-vs-mockups.md`):** Marketing-specific dark museum-gallery tiles and 80px-padded hero sections in `.stitch/DESIGN.md` are **excluded**. All application views use the light-mode two-column SaaS workspace defined in the five `.stitch/*.png` / `.html` prototypes.
- **Real vs. Simulated / Decorative Chrome:**
  - **Wired:** Group/cycle filtering, expense CRUD + FX conversion + split calculations, per-group debt simplification, `SETTLEMENT` ("Log & Link" + Mark as Settled), Cycle Close locking, Offsetting Adjustments, invite link generation/joining, Web Push / opt-in SMS reminders (24h cooldown), 500 MB per-user receipt upload/quota, and CSV/JSON export.
  - **Simulated / Decorative:** Payment rails (`Venmo`, `Apple Card`) do not transfer funds; they open deep links or show `@instant_settlement_tag` and log a `SETTLEMENT` event. Decorative status labels such as `Shared Encrypted Ledger`, `100% Verified`, and `Auto-ingestion active` are replaced or backed by real group-isolation / RLS / recurring-rule status indicators.

---

## 2. Shared UI Primitive Inventory

All feature views and modals must consume these shared primitives rather than hand-rolling raw HTML `<button>`, `<input>`, `<select>`, `<dialog>`, or `role="switch"` markup.

| Primitive | Mechanism / Base | Required Variants & Accessibility | Anti-Duplication Rule |
| --- | --- | --- | --- |
| `Button` | Accessible `<button>` / link-button wrapper | Variants: `primary` (`#0066cc` pill), `secondary` (white pill + `#e0e0e0` hairline), `danger-soft` (red tint pill), `ghost`, `icon-circle` (`44px` / `36px`). States: `disabled`, `loading` (`aria-busy`), focus-visible ring. | No raw `<button className="...">` styling in feature screens. |
| `Input` / `SearchInput` | Styled `<input>` with label, error, and optional prefix/suffix | Variants: `text`, `number` (minor-unit currency input), `search` (with leading icon + `⌘K` / `/` shortcut badge + clear button). `aria-invalid`, `aria-describedby` for errors. | All form fields and search bars use `Input` / `SearchInput`. |
| `Select` / `Dropdown` | Accessible headless menu / select primitive | Variants: `pill-select` (group filter, sort order, currency), `action-menu` (`⋮` row/card kebab menu), `searchable-select` (payer/category). Full keyboard nav (`ArrowUp/Down`, `Escape`). | No raw `<select>` elements in styled UI. |
| `Dialog` / `Modal` | Accessible headless dialog / native `<dialog>` wrapper | Focus trap, `Escape` & backdrop-click close, `aria-labelledby`, sticky header & footer (`Cancel` + primary CTA), scrollable body on small viewports. | All modals (`AddEditExpenseModal`, `RecordSettlementModal`, `ConfirmDialog`, etc.) use `Dialog`. |
| `Switch` / `Toggle` | Accessible button with `role="switch"` and `aria-checked` | Variants: `default` (green `#22c55e` / blue `#0066cc` active track), `disabled` (with tooltip reason). Keyboard `Space`/`Enter` toggle. | No raw checkbox hacks for switches (`Simplify`, `Notifications`, `SMS opt-in`). |
| `SegmentedControl` / `Tabs` | Accessible `tablist` / `tab` or `radiogroup` | Variants: `pill-tabs` (`All Expenses`, `Paid by Me`, `Split with Me`, `Recurring`) and `split-method` (`Split Evenly`, `By Percentage`, `Exact Amounts`). Arrow-key navigation. | All multi-mode selectors use `SegmentedControl`. |
| `Card` | Container primitive (`rounded-[18px]`, `#ffffff`, `1px solid #e0e0e0`) | Variants: `kpi`, `section`, `sub-card` (`#f5f5f7` inset), `spotlight`. Consistent `24px` desktop / `16px` mobile padding. | No ad-hoc card border/radius classes across pages. |
| `Badge` / `StatusPill` | Inline pill (`rounded-full`) | Semantic tones: `neutral`, `info` (`#0066cc`), `success` (green), `warning` (amber), `danger` (red), `category` (tinted dot + label). | Category chips, `LOCKED`/`CLOSED` badges, and `Live Sync` use `Badge`. |
| `Avatar` / `AvatarStack` | Circular user badge (image or 2-letter initials) | Sizes: `sm` (`24px`), `md` (`32px`), `lg` (`48px`). `AvatarStack` overlaps with `+N` overflow pill and `aria-label` member list. | Member chips in sidebar, tables, and group cards use `Avatar`. |
| `Table` / `Pagination` | Semantic `<table>` inside `overflow-x-auto` wrapper + `Pagination` | Sortable column headers (`aria-sort`), empty state slot, row action slot, `Previous` / page numbers / `Next`. | Both Dashboard `Recent Shared Transactions` and Expenses `Itemized Transactions` share `Table` + `Pagination`. |
| `ProgressBar` / `ProgressRing` | Semantic `role="progressbar"` (`aria-valuenow`, `aria-valuemax`) | `ProgressBar`: multi-segment category bar & personal cap bar. `ProgressRing`: circular storage quota indicator (`18%` of `500 MB`). | Budget, personal cap, and 500 MB quota meters use `ProgressBar` / `ProgressRing`. |
| `Toast` / `AlertBanner` | `aria-live="polite"` toast stack + inline `AlertBanner` | Tones: `info`, `warning` (e.g., `NEEDS_RATIO_UPDATE`, `500 MB quota full`), `error`, `success`. | All async mutation feedback, cooldown notices, and quota warnings use `Toast` / `AlertBanner`. |

---

## 3. App Shell, Shared State & Responsive Contract

| Shell / Shared Element | Status (`Wired` / `Omit`) | State Source (URL / Context / API) | Cross-Route Behavior |
| --- | --- | --- | --- |
| Brand Logo (`LedgerSplit` + `SHARED` pill) | `Wired` | Static link to `/dashboard` | Navigates to `/dashboard` preserving active group/cycle query params. |
| Sidebar Nav (`Dashboard`, `Expenses`, `Split Groups`, `Settings`) | `Wired` | Next.js App Router pathname | Highlights active route in `#0066cc` pill. `Split Groups` badge displays live count of user's non-archived groups. |
| Sidebar `Active Group` Switcher | `Wired` | URL `?group=<id|all>` + synced `ActiveGroupContext` | Switches active group across routes. Displays group name, active split count, and `AvatarStack`. |
| Sidebar `Collapse Sidebar` Toggle | `Wired` | `localStorage` + `SidebarContext` | Collapses desktop sidebar to compact icon rail (`72px`); hidden on mobile (replaced by drawer). |
| Top Bar Month / Cycle Picker (`< October 2024 >`) | `Wired` | URL `?cycle=YYYY-MM` (or group billing anchor) | Steps backward/forward across `BillingCycle` windows. Filters spend, category breakdown, and transaction lists; **never** alters cumulative `Peer Balances`. |
| Top Bar Global Search (`⌘K`) | `Wired` | Client modal/command palette + `/api/search` | `⌘K` (or click) opens quick search across Expenses (merchant/note/tag) and Groups; selecting a result navigates to `/expenses?q=...` or `/split-groups`. |
| Top Bar Notification Bell | `Wired` | Supabase Realtime + `Notification` query | Red dot indicates unread items (new expense, share revision, settlement confirmation, reminder nudge, lease archive prompt). Clicking opens notification popover with "Mark all read". |
| Top Bar `+ Add Expense` CTA | `Wired` | Global `ModalContext` | Opens `AddEditExpenseModal` from any route, pre-selected to the current `Active Group` (or prompts group selection if `All Groups` is active). |
| Top Bar User Profile Menu | `Wired` | Supabase Auth session (`User`) | Displays user avatar/initials. Dropdown links to `/settings` and `Sign Out`. |
| Page Header `Live Sync` Pill (`LiveSyncPill`) | `Wired` | Supabase Realtime channel status | Rendered in the page headers of `/dashboard` and `/expenses` only (per `.stitch/dashboard.png` and `.stitch/expenses.png`; omitted from Top Bar, `/split-groups`, and `/settings`). Green dot when subscribed (`Live Sync`), amber when reconnecting (`Syncing...`), muted when offline. |

### Canonical Shared Modals
- **`AddEditExpenseModal`**:
  - **Triggers:** Top Bar `+ Add Expense`, Dashboard `Quick Add`, Expenses row `Edit` (if unlocked) or `Log Adjustment` (if locked).
  - **Modes:** `create` | `edit` (records `ExpenseRevision`, disabled if `is_locked`) | `adjustment` (creates Offsetting Adjustment referencing `adjustment_for_expense_id`).
  - **Behavior:** Single `Paid by` selector; currency selector defaulting to `Group.base_currency` with live FX spot-rate fetch + editable `Exchange Rate` override; `SegmentedControl` for `Split Evenly` / `By Percentage` / `Exact Amounts` using deterministic penny-rounding (`docs/adr/0002-money-representation-and-fx-audit.md`); live balance check (`$120.00 of $120.00 assigned (100%)`); receipt attachment checked against 500 MB per-user quota (non-blocking if full).
- **`RecordSettlementModal`**:
  - **Triggers:** Dashboard `Quick Settle` / `Settle Up` / `Settle`, Expenses `Settle now →`, Split Groups `Request` / `Remind` context.
  - **Behavior:** Scoped to a single `group_id` and `(payer_id, recipient_id)` pair. Pre-fills full owed balance in minor units; editable numeric input allows partial payments (`> 0`). Displays Venmo deep-link (`venmo://paycharge?...`) + recipient `@instant_settlement_tag` ("Log & Link"), and commits immutable `SETTLEMENT` event on `Mark as Settled`.
- **`ConfirmDialog`**:
  - **Triggers:** Close & Lock Billing Cycle (`ADMIN`), Remove Member (`ADMIN`, warns on `FORMER_MEMBER` transition if `net_balance != 0`), Self-Leave / Delete Account blocked modal (`net_balance != 0`), Archive Group, Soft-Delete Unlocked Expense.

### Responsive Rules
- **Desktop (`>= 1024px`):** Fixed left sidebar (`248px` expanded / `72px` collapsed), sticky `64px` top bar, 3-column KPI grids, 2-column Dashboard mid-row (`Monthly Category Breakdown` + `Peer Balances`), 3-column `Split Groups` grid.
- **Tablet & Mobile (`< 1024px`):**
  - Left sidebar converts to an off-canvas slide-over `Drawer` opened via a top-left menu button; `Active Group` switcher remains accessible inside the drawer.
  - Top bar wraps/condenses cleanly: search collapses to icon button, `+ Add Expense` stays visible, cycle picker remains centered/accessible.
  - Multi-column KPI, Bento, and `Settings` grids stack to `1` column (`grid-cols-1`).
  - All data tables (`Recent Shared Transactions`, `Itemized Transactions`) sit inside `overflow-x-auto` containers so `document.documentElement.scrollWidth <= window.innerWidth` (zero horizontal page overflow).

---

## 4. Screen & Modal Parity Checklists

### Dashboard (ref: `.stitch/dashboard.png`, `.stitch/dashboard.html`)
- **Layout:** Page header (`Dashboard Overview` + `Live Sync` + Group Filter dropdown `All Groups` / specific group + `Export CSV` + Refresh button) → 3-column KPI row (`Total Spent This Month`, `You Are Owed`, `You Owe`) → 2-column mid-row (`Monthly Category Breakdown` + `Peer Balances`) → full-width `Recent Shared Transactions` table.
- **Required Widgets & Interactions:**
  - Group Filter switches between `All Groups` aggregate and single-group view (syncing with `Active Group` when a specific group is chosen).
  - `Total Spent This Month` shows cycle total, MoM delta pill, user's share, and transaction count.
  - `You Are Owed` / `You Owe` show **cumulative** unsettled balances; `Send N reminders` / `Quick Settle` trigger reminder batch (respecting 24h cooldown) or `RecordSettlementModal`.
  - `Monthly Category Breakdown` shows cycle spend vs. `Group.operational_budget_cents`, segmented multi-color `ProgressBar`, up to 6 category tiles + `Budget Buffer`, and `Edit Default Ratios` link (`/split-groups`).
  - `Peer Balances` has `Simplify` `Switch` (wired to per-group `simplify_debts` when single group selected; per-group breakdown when `All Groups` is active), per-person `Remind` (disabled with remaining hours during 24h cooldown) / `Settle Up` / `Settle` pills, and `Overall Net Settlement`.
  - `Recent Shared Transactions` includes merchant search input, category `Select`, `Quick Add` button, receipt/note icon, `⋮` row action menu (`Edit`, `Log Adjustment`, `Delete`), and `Pagination`.
  - **Closed Period State:** Viewing a closed historical cycle displays a `Settled / Closed Period` `Badge` in the header while `Peer Balances` remain live cumulative.
- **Intentional Prototype Omissions / Replacements:**
  - `View Full Report →` navigates to `/expenses` with the current group & cycle filters preserved.

### Expenses (ref: `.stitch/expenses.png`, `.stitch/expenses.html`)
- **Layout:** Header (`Expenses Ledger` + `Live Sync` + `SegmentedControl` [`All Expenses`, `Paid by Me`, `Split with Me`, `Recurring`] + `Export CSV`) → 3-column KPI row (`Total Group Expenses`, `Your Personal Share`, `Unsettled / Pending`) → Filter toolbar (search input, `All` + category quick-filter pills, sort `Select`) → `Itemized Transactions` table → 2-column bottom insight cards (`Household Run-Rate Analysis`, `Smart Split Recommendation`).
- **Required Widgets & Interactions:**
  - Scoped to `Active Group` (or `All Groups` if selected) and selected `BillingCycle`.
  - `Your Personal Share` tracks user's cycle liability against `User.personal_share_cap_cents` using `ProgressBar`.
  - `Unsettled / Pending` shows `Next group settlement` date (derived from `billing_cycle_anchor_day`) and `Settle now →` action opening `RecordSettlementModal`.
  - `Recurring` tab lists active `RecurringRule` templates for the group with create/pause/delete controls (Admin or creator).
  - Table rows show lock badge (`LOCKED`) when covered by Cycle Close or Pairwise Watermark; `⋮` menu enforces lock & role rules (unlocked → `Edit` / `Delete`; locked → `Log Adjustment`).
  - `Export CSV` downloads cycle transactions in `Group.base_currency`.
- **Intentional Prototype Omissions / Replacements:**
  - `Shared Encrypted Ledger` decorative badge is replaced by an informative group-isolation / cycle-status `Badge` (`Open Cycle` / `Closed Period`).

### Split Groups (ref: `.stitch/split-groups.png`, `.stitch/split-groups.html`)
- **Layout:** Header (`Split Groups` + `Archive Rules` button + `+ Create New Group` primary CTA) → 3-column active group cards → `Spotlight Partition: Household Split Rules & Ratios` panel for the selected group → 3-column summary strip (`Monthly Logged Vouchers`, `Auto-Debit / Recurring Rules`, `Ledger Consensus`).
- **Required Widgets & Interactions:**
  - Group cards show type badge (`PRIMARY RESIDENCE`, `SEASONAL TRIP`, `RECURRING FLAT`), `⋮` menu, member `AvatarStack`, cycle turnover, user's net ledger, `Manage Group >` (selects group into Spotlight & sets `Active Group`), and `Quick Split` (opens `AddEditExpenseModal` for that group).
  - Collapsible `Archived Ledgers` section below active groups for `ARCHIVED` read-only groups.
  - Spotlight panel shows `Edit Ratios` (`ADMIN` only; view-only for `MEMBER`) + `Log` (revision/settlement audit drawer), per-member cards (`Paid This Period`, `Owed`/`Due`, `Remind` / `Request` actions, `FORMER_MEMBER` badge if removed with debt), `Assigned Habitat` / `Lease ends` info, and `Member Invitation Gateway` (`Copy` link for all members; `Regenerate Link` for `ADMIN` only).
  - Banner warning when group status is `NEEDS_RATIO_UPDATE` (5th member joined in `CUSTOM_RATIOS` mode).
  - `Archive Rules` opens modal configuring Trip 14-day zero-balance auto-archive and Residential lease-end prompt; Admin can also trigger `Close & Lock Billing Cycle` from Spotlight/Manage Group.
- **Intentional Prototype Omissions / Replacements:**
  - `Auto-ingestion active` / `Auto-Debit Routing` / `100% Verified` labels map directly to active `RecurringRule` count and verified/settled ledger status rather than simulated bank auto-debit.

### Add / Edit Expense Modal (ref: `.stitch/add-expense-modal.png`, `.stitch/add-expense-modal.html`)
- **Layout:** Centered `Dialog` with amount & currency header, `Description`, `Category` + `Date` 2-column row, `Paid by` card with `Change payer`, `Split Method` `SegmentedControl` (`Split Evenly`, `By Percentage`, `Exact Amounts`), `Split Breakdown` member checklist with live per-person minor-unit preview, balance validation bar, and sticky footer (`Attach Receipt`, `Cancel`, `Save Expense ($X)`).
- **Required Widgets & Interactions:**
  - Selecting a foreign currency displays live FX spot rate + editable `Exchange Rate` override input and previews converted `Group.base_currency` total.
  - Toggling member checkboxes recalculates shares in real time using deterministic penny-rounding (`docs/adr/0002-money-representation-and-fx-audit.md`).
  - `Save Expense` is disabled until `SUM(split_breakdown) == amount_cents` and required fields are valid.
  - `Attach Receipt` checks `User.receipt_storage_used_bytes` against `500 MB`; if full, displays non-blocking `AlertBanner` ("Receipt storage full (500 MB). Expense will be logged without receipt.") and allows saving without attachment.
- **Intentional Prototype Omissions / Replacements:**
  - None; all visible controls are wired.

### Settings (ref: `.stitch/settings.png`, `.stitch/settings.html`)
- **Layout:** Header (`Settings` + `Auto-sync active` / connected tag badge) → 2-column grid: Left (`Profile & Identity`, `Default Split & Settlement Rules` + sticky `Reset to Defaults` / `Save Changes` bar) and Right (`Payment Methods`, `Notifications`, `Storage & Sync Quota`).
- **Required Widgets & Interactions:**
  - `Profile & Identity`: Avatar upload, `Legal Full Name`, `Primary Email` (read-only/verified), `Phone Number` (verification flow for SMS), `Instant Settlement Tag` (`@handle`).
  - `Default Split & Settlement Rules`: `Default Split Mode` `SegmentedControl`, `Base Currency` `Select`, `Simplify Group Debts` `Switch` (scoped to active group for `ADMIN`), `Automatic Settlement Reminders` `Switch`, `Personal Share Cap` input.
  - `Payment Methods`: Lists saved settlement tags/handles (`Venmo Settlement Rail`, `Apple Card / Debit` label) for "Log & Link" deep-linking; `Add` opens handle modal.
  - `Notifications`: `New Expense Logged`, `Settlement Confirmation`, `Monthly Recap & Digest`, and explicit `Allow SMS settlement nudges` opt-in `Switch`. `Export Ledger History` (`CSV / JSON`) triggers full-history download.
  - `Storage & Sync Quota`: `ProgressRing` showing `X MB of 500 MB` used across all user receipts.
- **Intentional Prototype Omissions / Replacements:**
  - `Payment Methods` stores settlement handles/preferences for "Log & Link" rather than real card tokenization or ACH debiting.

### Auth & Group Invite Onboarding (`/login`, `/join/[slug]?token=...`)
- **Layout:** Clean centered `Card` on `#f5f5f7` canvas using `#0066cc` primary pill CTA (no sidebar chrome).
- **Required Widgets & Interactions:**
  - `/login`: Passwordless Magic Link email input + Google OAuth button via Supabase Auth.
  - `/join/[slug]?token=...`: Validates signed invite token, shows group name & current split mode (`EQUAL` or `CUSTOM_RATIOS`), authenticates user if needed, and binds membership (`100/N%` in `EQUAL` mode, or `0%` + `NEEDS_RATIO_UPDATE` in `CUSTOM_RATIOS` mode).

---

## 5. Enduring UI & Integration Invariants

1. **Primitives & Shell First:** Shared UI primitives (Section 2) and the responsive App Shell (Section 3) must be implemented before feature views so no screen duplicates raw controls or navigation chrome.
2. **End-to-End Preference Wiring:** Every persisted setting (`Group.base_currency`, `Group.default_split_mode`, `Group.simplify_debts`, `User.personal_share_cap_cents`, `User.instant_settlement_tag`, `User.notification_prefs.sms_nudges_opt_in`) must visibly drive every consuming screen, calculation, and modal.
3. **Minor-Unit UI Formatting & Validation:** All UI inputs and displays format `BIGINT` minor units via a single shared currency formatter; client-side split math uses integer cents exclusively so UI previews match server invariants to the exact cent.
4. **Interactive Desktop & Mobile Verification:** Verification must exercise live interactive flows (switching groups/cycles, opening modals, toggling splits/switches, submitting forms, checking `scrollWidth <= innerWidth`) across both desktop (`>= 1280px`) and mobile (`375px`) viewports.
