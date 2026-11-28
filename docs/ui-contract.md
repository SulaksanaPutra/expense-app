# UI & Integration Contract

## 1. Visual Source Precedence & Resolved Contradictions

- **Governing Token & App-Shell Source:** `.stitch/ledgersplit/DESIGN.md` defines the canonical color tokens (`#f9f9fb` canvas, `#ffffff` cards/shell, `#f3f3f5` nested sub-cards/inputs, `#0066cc` primary accent, `#1a1c1d` / `#414753` / `#727784` ink), `Inter` typography scale (`tabular-nums` on all amounts/counts/percentages), Material Symbols Outlined iconography, radii (`18px` cards, `9999px` pills), and the static App Shell (`Sidebar` + `TopBar`).
- **Governing Screen & Modal Layout Sources:** The 15 `.stitch/ledgersplit_*/` screen, modal, and popover mockups (`screen.png` and `code.html`) govern exact spatial placement, visible controls, and feature scope:
  - Dashboard: `.stitch/ledgersplit_dashboard_overview/screen.png`
  - Expenses: `.stitch/ledgersplit_expenses_ledger/screen.png`
  - Split Groups (Active, Split Rules & Invite, Archived): `.stitch/ledgersplit_split_groups/screen.png`, `.stitch/ledgersplit_split_groups_split_rules_invite/screen.png`, `.stitch/ledgersplit_split_groups_archived_view/screen.png`
  - Settings: `.stitch/ledgersplit_settings/screen.png`
  - Modals & Popovers: `.stitch/ledgersplit_topbar_add_expense_modal_standalone/screen.png`, `.stitch/ledgersplit_split_groups_create_edit_group_modal_standalone/screen.png`, `.stitch/ledgersplit_split_groups_audit_log_modal_standalone/screen.png`, `.stitch/ledgersplit_split_groups_archive_group_confirmation_standalone/screen.png`, `.stitch/ledgersplit_settings_add_edit_settlement_handle_modal_standalone/screen.png`, `.stitch/ledgersplit_topbar_notifications_popover_standalone/screen.png`, `.stitch/ledgersplit_topbar_user_account_menu_standalone/screen.png`, `.stitch/ledgersplit_split_groups_group_card_menu_open_standalone/screen.png`, `.stitch/ledgersplit_settings_settlement_handle_menu_open_standalone/screen.png`
- **Strict Scope & Clean Removal Rule (`docs/adr/0007-v2-product-pivot-and-unified-stitch-spec.md`):** Features absent from the new `.stitch/ledgersplit_*/` screens are **removed** rather than hidden or kept for backward compatibility. Specifically omitted/removed: `LiveSyncPill`, Dashboard `Simplify` switch, `Recurring` tab/rules, per-expense FX rate overrides, `500 MB` receipt quota ring, and `Archive Rules` modal.
- **Real vs. Simulated Rails:** Payment handles (`Venmo`, `Zelle`, `Cash App`) display the recipient's configured handle/deep-link for "Log & Link" and record a manual `SETTLEMENT` event on `Mark Settled`; no real funds move through LedgerSplit servers.

---

## 2. Shared UI Primitive Inventory

All `(app)` pages, modals, and popovers must consume these shared primitives rather than hand-rolling raw HTML `<button>`, `<input>`, `<select>`, `<dialog>`, or `role="switch"` elements.

| Primitive | Mechanism / Base | Required Variants & Accessibility | Anti-Duplication Rule |
| --- | --- | --- | --- |
| `Button` | Accessible `<button>` / link-button wrapper (`rounded-full`) | Variants: `primary` (`#0066cc` fill), `secondary` (`#ffffff` + hairline), `danger-soft`, `danger`, `ghost`, `icon-circle` (`36px`/`40px`/`44px`). Sizes: `sm` (`h-8`), `md` (`h-10`), `lg` (`h-11`). States: `disabled`, `loading` (`aria-busy`), focus-visible ring. | Zero raw `<button>` elements in `(app)` views or modals. |
| `Input` / `SearchInput` | Styled `<input>` with `label`, `hint`, `error`, `prefix`, `suffix` | `Input`: `h-11`, `11px` radius (or `9999px` pill per screen), `#ffffff` / `#f3f3f5` disabled, `aria-invalid`, `aria-describedby`. `SearchInput`: pill search bar with leading `search` icon, `⌘K` kbd badge, and clear button. | All form fields and search bars use `Input` / `SearchInput`. |
| `Select` / `Dropdown` | Accessible headless select & menu primitive | `Select`: `default`, `pill-select` (toolbars/headers), `searchable-select`. `Dropdown`: `⋮` action menus supporting `danger` items and keyboard nav (`ArrowUp/Down`, `Escape`). | Zero raw `<select>` elements in styled UI. |
| `Dialog` / `ConfirmDialog` | Accessible modal dialog wrapper | Focus trap, `Escape` & backdrop-click close, `aria-labelledby`, sticky header & footer (`Cancel` + primary/danger CTA), scrollable body. | Zero raw `<dialog>` elements; all modals & confirmations use `Dialog` / `ConfirmDialog`. |
| `Switch` | Accessible button with `role="switch"` and `aria-checked` | Tones: `success` (`#22c55e`) and `primary` (`#0066cc`); inactive `#d2d2d7`; sizes `sm` (`h-5 w-9`), `md` (`h-6 w-11`). | No raw checkbox hacks for policy or notification switches. |
| `SegmentedControl` | Accessible `tablist` / `radiogroup` (`rounded-full`) | Variants: `pill-tabs` (`Active (4)` \| `Archived (2)`, `Members & Balances` \| `Split Rules & Invite`, `All` \| `Unread (2)`) and `split-method` (`Equal`, `Percentage`, `Exact`, `Shares`). | All multi-mode toggles use `SegmentedControl`. |
| `Card` | Container primitive (`rounded-[18px]`, `1px solid` hairline) | Variants: `kpi`, `section`, `spotlight` (`#ffffff`), `sub-card` (`#f3f3f5` inset—never ad-hoc `rounded-[14px]` divs). | No ad-hoc card container styling across pages. |
| `Badge` / `StatusPill` | Inline pill (`rounded-full`) | Tones: `neutral`, `info`, `success`, `warning`, `danger`, `category` (with `dot` / `dotColor`). Sizes: `sm`, `md`. | Statuses (`Settled`, `Pending`, `Default`, `Owner`, `Verified User`) use `Badge`. |
| `Avatar` / `AvatarStack` | Circular user badge (photo or 2-letter initials) | Sizes: `sm` (`24px`), `md` (`32px`), `lg` (`48px`). `AvatarStack`: overlapping `-space-x-2` with `2px` ring and `+N` overflow. | Member chips in sidebar, tables, and cards use `Avatar` / `AvatarStack`. |
| `Table` / `Pagination` | Semantic `<table>` in `rounded-[14px] border overflow-hidden` + pill `Pagination` | Sortable `TableHead` (`aria-sort`), `TableEmpty`, row-click handler support, action slot, `Pagination` (`< 1 2 3 4 >`). | Dashboard and Expenses tables share `Table` + `Pagination`. |
| `ProgressBar` | Semantic `role="progressbar"` | Tones: `primary`, `success`, `warning`, `danger`, `auto` (`>=75%` amber, `>=90%` red); supports multi-segment category bar. | Budget utilization, category breakdown, and Monthly Cap meters use `ProgressBar`. |
| `AlertBanner` / `Toast` | `AlertBanner` + `aria-live="polite"` `Toast` stack | Tones: `info`, `warning`, `error`, `success`. | Archived read-only banners, policy warnings, and mutation feedback use `AlertBanner` / `Toast`. |

---

## 3. App Shell, Shared State & Responsive Contract

| Shell / Shared Element | Status (`Wired` / `Omit`) | State Source (URL / Context / API) | Cross-Route Behavior |
| --- | --- | --- | --- |
| Brand Header (`LedgerSplit`, `28x28px` blue icon + title; **no** `SHARED` badge) | `Wired` | Static link to `/dashboard` | Navigates to `/dashboard` preserving active group/cycle query params. |
| Sidebar Nav (`Dashboard`, `Expenses`, `Split Groups` + live count pill, `Settings`) | `Wired` | Next.js App Router pathname + active groups query | Highlights active route with `#0066cc` pill (`h-10 rounded-full`). Count pill shows live count of `ACTIVE` groups. |
| Sidebar `ACTIVE GROUP` Sub-Card (`All Groups` / selected group, `N splits` pill, `AvatarStack`) | `Wired` | URL `?group=<id\|all>` + `ActiveGroupContext` | Scopes Dashboard & Expenses across routes; selecting a group card on `/split-groups` updates `Active Group`. |
| Sidebar `Collapse Sidebar` Toggle | `Wired` | `localStorage` + `SidebarContext` | Collapses desktop sidebar (`248px` → `72px`); hidden on mobile (replaced by drawer). |
| TopBar Cycle Picker (`< November 2026 >`) | `Wired` | URL `?cycle=YYYY-MM` | Steps backward/forward across `BillingCycle` windows. Filters period spend, category breakdown, and transaction rows; never alters cumulative `Peer Balances`. |
| TopBar Global Search (`Search transactions...` + `⌘K`) | `Wired` | Command palette / `/api/search` | `⌘K` (or click) searches Expenses and Groups; selecting a result navigates to `/expenses?q=...` or `/split-groups`. |
| TopBar Notification Bell + Popover | `Wired` | Supabase Realtime + `/api/notifications` | Red dot indicates unread items (`All` \| `Unread (N)`, `Mark all read`). |
| TopBar `+ Add Expense` Primary CTA | `Wired` | Global `ModalContext` | Opens `AddEditExpenseModal` from any route, pre-selected to `Active Group` (or prompts selection if `All Groups`). |
| TopBar User Avatar (`JD`) + Account Menu | `Wired` | Supabase Auth session (`User`) | Opens popover showing name, email, `Default Currency`, `Account & Profile`, `Settings`, `Keyboard Shortcuts (⌘K)`, `Export Monthly Ledger`, and `Sign Out`. |

### Canonical Shared Modals
- **`AddEditExpenseModal`** (ref: `.stitch/ledgersplit_topbar_add_expense_modal_standalone/screen.png`):
  - **Triggers:** TopBar `+ Add Expense`, Expenses row `⋮` (`Edit`), Dashboard row click (`View / Edit` when unlocked).
  - **Behavior:** Fields for `Merchant / Description`, `Amount` (in selected group's `base_currency`), `Date`, `Split Group`, `Category`, `Paid By`, and `Split Method` (`Equal`, `Percentage`, `Exact`, `Shares`) with live `SPLIT DISTRIBUTION` member list using integer-cent rounding.
  - **Policy Gates:** When `Group.allow_any_member_add_expense == false`, non-Admin members are blocked from creating expenses. When `Group.require_receipt_over_100 == true` and `amount_cents > 10000`, displays a required receipt upload field and blocks submit until attached. Respects `User.auto_include_in_expenses` on creation.
- **`RecordSettlementModal`**:
  - **Triggers:** Dashboard `Peer Balances` `Settle now`, Split Groups `WHO OWES WHOM` `Mark Settled`.
  - **Behavior:** Scoped to a single `group_id` and `(payer_id, recipient_id)` pair. Pre-fills owed balance in minor units (allows partial payments `> 0`), pre-selects creditor's `Default` `SettlementHandle` (`Venmo`, `Zelle`, `Cash App`) with handle switcher & "Log & Link" info, and records an immutable `SETTLEMENT` on `Mark Settled`.
- **`ConfirmDialog`**:
  - **Triggers:** `Archive Group` (shows `Current Net Ledger` and unsettled balance count), permanent `Delete` of archived group (blocked if any balance != `$0.00`), `Remove` member (`FORMER_MEMBER` warning if balance != `$0.00`), `Leave Group` / `Delete Account` (blocked if balance != `$0.00`), `Revoke` active device session, and soft-delete unlocked expense.

### Responsive Rules
- **Desktop (`>= 1024px`):** Fixed left sidebar (`248px` expanded / `72px` collapsed), sticky `64px` TopBar (`left-[248px]`), 3-column KPI grids, 2-column Dashboard mid-row (`Monthly Category Breakdown` + `Peer Balances`), 4-column `Split Groups` card grid, 2-column `Settings` grid.
- **Tablet & Mobile (`< 1024px`):** Sidebar converts to an off-canvas slide-over `Drawer` opened from TopBar; TopBar search collapses to icon button while `+ Add Expense` and cycle picker remain accessible; multi-column grids stack to `1` column; all tables sit inside `overflow-x-auto` containers with `document.documentElement.scrollWidth <= window.innerWidth` (zero horizontal page overflow).

---

## 4. Screen & Modal Parity Checklists

### Dashboard Overview (ref: `.stitch/ledgersplit_dashboard_overview/screen.png`, `.stitch/ledgersplit_dashboard_overview/code.html`)
- **Layout:** `<PageHeader />` (`Dashboard Overview`, subtitle `All active groups · November 2026`, `Export CSV`, Refresh icon button) → 3-column KPI row (`NET SETTLEMENT BALANCE`, `TOTAL SPENT (NOV 2026)`, `YOU OWE`) → 2-column mid-row (`Monthly Category Breakdown` + `Peer Balances`) → full-width `Recent Shared Transactions` card.
- **Required Widgets & Interactions:**
  - When `All Groups` is active, KPIs and `TOTAL SPENT` roll up into `User.display_currency` (display-only FX conversion); `NET SETTLEMENT BALANCE` shows `You are owed $X · You owe $Y` and verified group count.
  - `TOTAL SPENT` shows cycle total, MoM delta pill, `Your share`, expense count, and `BUDGET UTILIZATION: X%`.
  - `YOU OWE` shows pending balance total, pending count + peer count, and `Next auto-reconciliation` date (from next active group `cycle_reset_day`).
  - `Monthly Category Breakdown` shows `Cycle: Nov 1-30` pill, spend vs. target progress bar, and up to 6 category rows with dot, label, amount, and `%`.
  - `Peer Balances` lists active peers across groups with `Remind` (24h cooldown) for positive balances, `Settle now` (opens `RecordSettlementModal`) for negative balances, and `Overall Net Settlement` footer.
  - `Recent Shared Transactions` displays the latest 5 expenses; clicking a row opens split details (`AddEditExpenseModal` / detail view); `View all N in Expenses →` preserves active group & cycle filters.
- **Intentional Prototype Omissions / Replacements:** `LiveSyncPill`, header group-filter dropdown, and `Simplify` switch are omitted per v2 spec (per-group simplification is always-on; group switching lives in Sidebar `ACTIVE GROUP`).

### Expenses Ledger (ref: `.stitch/ledgersplit_expenses_ledger/screen.png`, `.stitch/ledgersplit_expenses_ledger/code.html`)
- **Layout:** `<PageHeader />` (`Expenses Ledger`, subtitle `N shared expenses · All active groups · November 2026`, `Export CSV`) → 3-column KPI row (`TOTAL GROUP EXPENSES`, `YOUR PERSONAL SHARE`, `UNSETTLED / PENDING`) → Filter toolbar (Category quick-filter pills `All (N)`, `Groceries`, `Utilities`, `Dining`, `Travel` + `Ownership` `Select`, `Status` `Select`, `Sort` `Select`) → 8-column `Table` + `Pagination`.
- **Required Widgets & Interactions:**
  - `YOUR PERSONAL SHARE` displays `% of total` pill and `Monthly Cap ($X)` `ProgressBar` wired to `User.personal_share_cap_cents`.
  - `UNSETTLED / PENDING` shows pending total, item/peer count, and `Action needed` badge.
  - Table columns: `DATE`, `MERCHANT & GROUP`, `CATEGORY`, `PAID BY`, `SPLIT`, `YOUR SHARE`, `STATUS` (`Settled` / `Pending`), `ACTION` (`⋮` menu for `Edit` / `Delete` when unlocked, or view details when locked).
  - `Export CSV` downloads filtered cycle transactions.
- **Intentional Prototype Omissions / Replacements:** `Recurring` tab and bottom insight cards from v1 are omitted.

### Split Groups — Active, Split Rules & Invite, Archived (ref: `.stitch/ledgersplit_split_groups/screen.png`, `.stitch/ledgersplit_split_groups_split_rules_invite/screen.png`, `.stitch/ledgersplit_split_groups_archived_view/screen.png`)
- **Layout:** `<PageHeader />` (`Split Groups`, `Active (N) | Archived (M)` `SegmentedControl`, `+ Create Group` primary CTA) → 4-column active group cards → Selected group Spotlight (`Members & Balances` \| `Split Rules & Invite`, `Audit Log` button, `Edit Group` button).
- **Required Widgets & Interactions:**
  - **Active Cards:** Category badge (`Home`, `Trip`, `Dining`, `Utilities`, `Other`), `⋮` menu (`Edit Group`, `Split Rules & Invite`, `Audit Log`, `Archive Group`), split rule summary, `AvatarStack`, `Cycle Spend`, and `Your Net`. Clicking a card selects it into Spotlight and syncs `Active Group`.
  - **`Members & Balances` Tab:** `GROUP MEMBERS` cards (`Paid`, `Share`, `Net Position`, `Owed to you` / `Owes group` badge, `Remind` button) + `WHO OWES WHOM` always-on simplified transfer list with `Remind` and `Mark Settled`.
  - **`Split Rules & Invite` Tab (`Save Rules` CTA for Admin):**
    - Left: `SPLIT CALCULATION METHOD` (`Equal`, `Percentage (%)`, `Shares`, `Custom`) with per-member weights/percentages, `GROUP CURRENCY` `Select`, `CYCLE RESET DAY` `Select` (`1st of month (Auto-settle)` vs. manual), and `AUTOMATION & POLICIES` switches (`Allow any member to add expenses`, `Require receipt for expenses over $100`, `Send reminders when cycle closes`).
    - Right: `SHAREABLE INVITE LINK` (`Copy Link` + regenerate icon, 14-day expiry), `INVITE BY EMAIL` input + `Send Invite` button, `GROUP MEMBERS` list with `Owner` / `Member` badge + `Remove` action, and `GROUP MAINTENANCE` (`Archive Group`, `Leave Group`).
  - **Modals:** `Create / Edit Group` (`Group Name`, `Category` pills, `Default Split Method`, `Currency`, `Members` email add/remove), `Audit Log` (`All Events | Expenses | Rules | Settlements`, filter input, `Export Log`), and `Archive Group` confirmation (shows `Current Net Ledger`).
  - **`Archived` View:** Info `AlertBanner`, archived group cards (`TOTAL SETTLED`, `FINAL BALANCE`, `Restore Group`, `View Final Ledger`, `Delete`), and `Final Settlement History` table.
- **Intentional Prototype Omissions / Replacements:** `Archive Rules` modal and `Auto-ingestion` labels are omitted.

### Settings (ref: `.stitch/ledgersplit_settings/screen.png`, `.stitch/ledgersplit_settings/code.html`)
- **Layout:** `<PageHeader />` (`Settings`, `Discard Changes` + `Save Changes` CTAs) → 2-column grid: Left (`Profile & Identity`, `Display Currency & Personal Budget`, `Security & Active Sessions`) and Right (`Settlement Handles`, `Notifications`, `Data & Account`).
- **Required Widgets & Interactions:**
  - `Profile & Identity`: Avatar + `Change Photo`, `Full Name`, `Primary Email` (read-only, `Managed via Google SSO`), `Phone Number`, `Timezone` `Select`.
  - `Display Currency & Personal Budget`: `Display Currency` `Select`, `Personal Monthly Share Cap` input, `Auto-include me in new expenses` `Switch`.
  - `Security & Active Sessions`: `+ Add Passkey` (WebAuthn enrollment), `Google Workspace SSO` status, `ACTIVE DEVICES` list with `This device` badge and `Revoke` action.
  - `Settlement Handles`: `+ Add Handle` + list of handles (`Venmo`, `Zelle`, `Cash App`) with `Default` badge and `⋮` menu (`Set as Default`, `Edit Handle`, `Delete`) + `Add / Edit Settlement Handle` modal (`Provider`, `Handle / Account Tag`, `Display Note`, `Set as default handle` `Switch`, `Delete`).
  - `Notifications`: `New expense added`, `Settlement recorded`, `Cycle close reminder`, `Monthly summary digest` switches.
  - `Data & Account`: `Export Ledger Archive` (`CSV`, `JSON`) + `DANGER ZONE` `Delete Account` (blocked if net balance != `$0.00` across any group).
- **Intentional Prototype Omissions / Replacements:** `500 MB` receipt storage quota ring, `Simplify Group Debts` toggle, and `Allow SMS settlement nudges` toggle are omitted.

### Auth & Group Invite Onboarding (`/login`, `/join/[slug]?token=...`)
- **Layout:** Centered `Card` on `#f9f9fb` canvas using `#0066cc` primary pill CTA (no sidebar/topbar chrome).
- **Required Widgets & Interactions:**
  - `/login`: Google SSO button, Email/Magic Link input, and Passkey sign-in option via Supabase Auth.
  - `/join/[slug]?token=...`: Validates 14-day signed invite token, supports single-passkey registration/auth, and binds membership (`EQUAL` / `SHARES` auto-join, or `0%` + `NEEDS_RATIO_UPDATE` in `PERCENTAGE` / `CUSTOM` mode).

---

## 5. Enduring UI & Integration Invariants

1. **Primitives & Shell First:** Shared UI primitives (Section 2) and the static App Shell (Section 3) must be implemented before feature views so zero raw `<button>`, `<input>`, `<select>`, or `<dialog>` elements exist in `(app)` pages or modals.
2. **End-to-End Preference & Policy Wiring:** Every persisted setting (`User.display_currency`, `User.personal_share_cap_cents`, `User.auto_include_in_expenses`, `SettlementHandle.is_default`, `Group.base_currency`, `Group.default_split_mode`, `Group.cycle_reset_day`, `Group.auto_settle_on_reset`, `Group.allow_any_member_add_expense`, `Group.require_receipt_over_100`, `Group.send_cycle_close_reminders`) must visibly drive every consuming screen, calculation, and modal.
3. **Minor-Unit UI Formatting & Validation:** All UI inputs and displays format `BIGINT` minor units via a single shared currency formatter with `tabular-nums`; client-side split math (`EQUAL`, `PERCENTAGE`, `EXACT`, `SHARES`) uses integer cents exclusively so UI previews match server invariants to the exact cent.
4. **Interactive Desktop & Mobile Verification:** Verification must exercise live interactive flows (switching groups/cycles, opening modals/popovers, toggling switches, submitting forms, checking `scrollWidth <= innerWidth`) across both desktop (`>= 1280px`) and mobile (`375px`) viewports.
