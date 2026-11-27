// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
const replaceMock = vi.fn();
const pushMock = vi.fn();
let mockSearchParams = new URLSearchParams("group=all&cycle=2026-11");

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    replace: replaceMock,
    push: pushMock,
    prefetch: vi.fn(),
  }),
  usePathname: () => "/dashboard",
  useSearchParams: () => mockSearchParams,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { AppShell, type ShellGroupSummary } from "@/components/shell";
import type {
  ExpenseBillingCycleRecord,
  ExpenseGroupInfo,
  ExpenseLedgerRecord,
  ExpenseSettlementRecord,
} from "@/lib/expenses/ledger";

const SHELL_GROUPS: ShellGroupSummary[] = [
  {
    id: "grp-apt4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b",
    groupType: "RESIDENTIAL",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    activeSplitCount: 3,
    members: [
      { id: "u-alex", name: "Alex Rivera" },
      { id: "u-elena", name: "Elena Rostova" },
      { id: "u-marcus", name: "Marcus Vance" },
    ],
  },
  {
    id: "grp-tahoe",
    name: "Tahoe Ski Trip",
    slug: "tahoe-ski",
    groupType: "TRIP",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    activeSplitCount: 1,
    members: [
      { id: "u-alex", name: "Alex Rivera" },
      { id: "u-elena", name: "Elena Rostova" },
    ],
  },
];

const INITIAL_GROUPS: ExpenseGroupInfo[] = [
  {
    id: "grp-apt4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: 300000, // $3,000.00
    billingCycleAnchorDay: 1,
    currentUserRole: "ADMIN",
    currentUserStatus: "ACTIVE",
    members: [
      { userId: "u-alex", name: "Alex Rivera", status: "ACTIVE", instantSettlementTag: "@alex" },
      { userId: "u-elena", name: "Elena Rostova", status: "ACTIVE", instantSettlementTag: "@elena" },
      { userId: "u-marcus", name: "Marcus Vance", status: "ACTIVE", instantSettlementTag: "@marcus" },
    ],
  },
  {
    id: "grp-tahoe",
    name: "Tahoe Ski Trip",
    slug: "tahoe-ski",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: 100000, // $1,000.00
    billingCycleAnchorDay: 1,
    currentUserRole: "ADMIN",
    currentUserStatus: "ACTIVE",
    members: [
      { userId: "u-alex", name: "Alex Rivera", status: "ACTIVE", instantSettlementTag: "@alex" },
      { userId: "u-elena", name: "Elena Rostova", status: "ACTIVE", instantSettlementTag: "@elena" },
    ],
  },
];

// Multi-cycle ledger:
// Cycle 2026-10 (historical CLOSED cycle):
//   1. Apt 4B: Alex pays $120.00 Utilities split 3 ways (Elena -$40, Marcus -$40, Alex +$80)
//   2. Tahoe: Elena pays $60.00 Transit & Travel split 2 ways (Alex -$30, Elena +$30)
//   Cycle 2026-10 Total = $180.00, Alex share = $70.00
//
// Cycle 2026-11 (current OPEN cycle):
//   3. Apt 4B: Marcus pays $90.00 Groceries & Food split 3 ways (Alex -$30, Elena -$30, Marcus +$60)
//   4. Apt 4B: Alex pays $60.00 Dining Out split 3 ways (Elena -$20, Marcus -$20, Alex +$40)
//   5. Tahoe: Elena pays $40.00 Entertainment split 2 ways (Alex -$20, Elena +$20)
//   Cycle 2026-11 Total = $190.00, Alex share = $70.00
//
// Cumulative all-time net per group (zero settlements):
//   Apt 4B:
//     Alex   = +120 - 40 - 30 + 60 - 20 = +$90.00
//     Marcus = -40 + 90 - 30 - 20       =   $0.00
//     Elena  = -40 - 30 - 20            = -$90.00
//     Simplified Apt 4B edge: Elena -> Alex +$90.00
//   Tahoe:
//     Alex   = -30 - 20 = -$50.00
//     Elena  = +30 + 20 = +$50.00
//     Simplified Tahoe edge: Alex -> Elena -$50.00
//
// All Groups cumulative (NEVER netted across groups):
//   You Are Owed = +$90.00 (Apt 4B)
//   You Owe      = -$50.00 (Tahoe)
//   Overall Net Settlement = +$40.00 Net Owed to You
const EXPENSES: ExpenseLedgerRecord[] = [
  {
    id: "exp-oct-1",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-alex",
    paidBy: "u-alex",
    payerName: "Alex Rivera",
    description: "October ConEd Power",
    category: "Utilities",
    expenseDate: "2026-10-14T15:00:00.000Z",
    amountCents: 12000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 4000 },
      { user_id: "u-elena", share_cents: 4000 },
      { user_id: "u-marcus", share_cents: 4000 },
    ],
    receiptUrl: null,
    isRecurringGenerated: false,
    recurringRuleId: null,
    adjustmentForExpenseId: null,
    isLocked: true,
    isCycleClosed: true,
    isSettledByWatermark: false,
    isSettledForUser: true,
  },
  {
    id: "exp-oct-2",
    groupId: "grp-tahoe",
    groupName: "Tahoe Ski Trip",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-elena",
    paidBy: "u-elena",
    payerName: "Elena Rostova",
    description: "October Rental Car",
    category: "Transit & Travel",
    expenseDate: "2026-10-20T18:30:00.000Z",
    amountCents: 6000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 3000 },
      { user_id: "u-elena", share_cents: 3000 },
    ],
    receiptUrl: null,
    isRecurringGenerated: false,
    recurringRuleId: null,
    adjustmentForExpenseId: null,
    isLocked: true,
    isCycleClosed: true,
    isSettledByWatermark: false,
    isSettledForUser: true,
  },
  {
    id: "exp-nov-1",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-marcus",
    paidBy: "u-marcus",
    payerName: "Marcus Vance",
    description: "November Trader Joe's",
    category: "Groceries & Food",
    expenseDate: "2026-11-05T14:00:00.000Z",
    amountCents: 9000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 3000 },
      { user_id: "u-elena", share_cents: 3000 },
      { user_id: "u-marcus", share_cents: 3000 },
    ],
    receiptUrl: null,
    isRecurringGenerated: false,
    recurringRuleId: null,
    adjustmentForExpenseId: null,
    isLocked: false,
    isCycleClosed: false,
    isSettledByWatermark: false,
    isSettledForUser: false,
  },
  {
    id: "exp-nov-2",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-alex",
    paidBy: "u-alex",
    payerName: "Alex Rivera",
    description: "November House Pizza",
    category: "Dining Out",
    expenseDate: "2026-11-11T20:00:00.000Z",
    amountCents: 6000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 2000 },
      { user_id: "u-elena", share_cents: 2000 },
      { user_id: "u-marcus", share_cents: 2000 },
    ],
    receiptUrl: null,
    isRecurringGenerated: false,
    recurringRuleId: null,
    adjustmentForExpenseId: null,
    isLocked: false,
    isCycleClosed: false,
    isSettledByWatermark: false,
    isSettledForUser: false,
  },
  {
    id: "exp-nov-3",
    groupId: "grp-tahoe",
    groupName: "Tahoe Ski Trip",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-elena",
    paidBy: "u-elena",
    payerName: "Elena Rostova",
    description: "November Gondola Tickets",
    category: "Entertainment",
    expenseDate: "2026-11-16T10:00:00.000Z",
    amountCents: 4000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 2000 },
      { user_id: "u-elena", share_cents: 2000 },
    ],
    receiptUrl: null,
    isRecurringGenerated: false,
    recurringRuleId: null,
    adjustmentForExpenseId: null,
    isLocked: false,
    isCycleClosed: false,
    isSettledByWatermark: false,
    isSettledForUser: false,
  },
];

const BILLING_CYCLES: ExpenseBillingCycleRecord[] = [
  {
    id: "bc-apt-oct",
    groupId: "grp-apt4b",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    status: "CLOSED",
  },
  {
    id: "bc-tahoe-oct",
    groupId: "grp-tahoe",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    status: "CLOSED",
  },
];

const SETTLEMENTS: ExpenseSettlementRecord[] = [];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  mockSearchParams = new URLSearchParams("group=all&cycle=2026-11");
  refreshMock.mockReset();
  replaceMock.mockReset();
  pushMock.mockReset();
});

describe("Issue #84 — Dashboard overview: cycle-scoped spend vs cumulative balances", () => {
  it("updates Total Spent, Category Breakdown, Recent Shared Transactions & Closed Period badge on ?cycle= switch while Peer Balances remain cumulative", async () => {
    const user = userEvent.setup();

    render(
      <AppShell
        groups={SHELL_GROUPS}
        user={{ id: "u-alex", fullName: "Alex Rivera", email: "alex@example.com" }}
      >
        <DashboardClient
          initialExpenses={EXPENSES}
          currentUserId="u-alex"
          userBaseCurrency="USD"
          initialGroups={INITIAL_GROUPS}
          initialSettlements={SETTLEMENTS}
          initialBillingCycles={BILLING_CYCLES}
        />
      </AppShell>,
    );

    // 1. Open cycle (2026-11) in All Groups mode
    expect(screen.queryByTestId("settled-closed-period-badge")).not.toBeInTheDocument();

    const totalCard = screen.getByTestId("kpi-total-spent");
    expect(totalCard).toHaveTextContent("$190.00"); // 90 + 60 + 40
    expect(totalCard).toHaveTextContent("Your share: $70.00");
    expect(totalCard).toHaveTextContent("3 transactions");

    // All Groups combined operational budget ($3,000 + $1,000 = $4,000)
    const catCard = screen.getByTestId("category-breakdown-card");
    expect(catCard).toHaveTextContent("$190.00 / $4,000.00 target budget");
    expect(catCard).toHaveTextContent("Groceries & Food");
    expect(catCard).toHaveTextContent("Dining Out");
    expect(catCard).toHaveTextContent("Entertainment");
    expect(catCard).toHaveTextContent("Budget Buffer");
    expect(catCard).not.toHaveTextContent("Utilities");

    // Cumulative balances (never netted across groups): +$90.00 owed, -$50.00 owe, +$40.00 net
    expect(screen.getByTestId("kpi-you-are-owed")).toHaveTextContent("+$90.00");
    expect(screen.getByTestId("kpi-you-owe")).toHaveTextContent("-$50.00");
    expect(screen.getByTestId("overall-net-settlement")).toHaveTextContent(
      "+$40.00 Net Owed to You",
    );

    // Peer Balances shows per-group cards without cross-group netting
    const aptGroupBox = screen.getByTestId("peer-balance-group-grp-apt4b");
    const tahoeGroupBox = screen.getByTestId("peer-balance-group-grp-tahoe");
    expect(
      within(aptGroupBox).getByTestId("peer-balance-amount-u-elena-u-alex"),
    ).toHaveTextContent("+$90.00");
    expect(
      within(tahoeGroupBox).getByTestId("peer-balance-amount-u-alex-u-elena"),
    ).toHaveTextContent("-$50.00");

    // Recent Shared Transactions shows 2026-11 rows only
    const txCard = screen.getByTestId("recent-shared-transactions-card");
    expect(within(txCard).getByText("November Trader Joe's")).toBeInTheDocument();
    expect(within(txCard).getByText("November House Pizza")).toBeInTheDocument();
    expect(within(txCard).getByText("November Gondola Tickets")).toBeInTheDocument();
    expect(within(txCard).queryByText("October ConEd Power")).not.toBeInTheDocument();

    // 2. Step back to closed historical cycle (2026-10) via TopBar cycle picker
    await user.click(screen.getByRole("button", { name: "Previous billing cycle" }));

    expect(replaceMock).toHaveBeenCalledWith(
      "/dashboard?group=all&cycle=2026-10",
      { scroll: false },
    );

    // Settled / Closed Period badge appears in header
    expect(screen.getByTestId("settled-closed-period-badge")).toHaveTextContent(
      "Settled / Closed Period",
    );

    // Cycle-scoped Total Spent & Category Breakdown update to 2026-10 ($180.00)
    expect(totalCard).toHaveTextContent("$180.00");
    expect(totalCard).toHaveTextContent("2 transactions");
    expect(catCard).toHaveTextContent("$180.00 / $4,000.00 target budget");
    expect(catCard).toHaveTextContent("Utilities");
    expect(catCard).toHaveTextContent("Transit & Travel");
    expect(catCard).not.toHaveTextContent("Groceries & Food");

    // Recent Shared Transactions updates to 2026-10 rows
    expect(within(txCard).getByText("October ConEd Power")).toBeInTheDocument();
    expect(within(txCard).getByText("October Rental Car")).toBeInTheDocument();
    expect(within(txCard).queryByText("November Trader Joe's")).not.toBeInTheDocument();

    // Cumulative Peer Balances, You Are Owed, You Owe, and Overall Net Settlement remain unchanged
    expect(screen.getByTestId("kpi-you-are-owed")).toHaveTextContent("+$90.00");
    expect(screen.getByTestId("kpi-you-owe")).toHaveTextContent("-$50.00");
    expect(screen.getByTestId("overall-net-settlement")).toHaveTextContent(
      "+$40.00 Net Owed to You",
    );
    expect(
      within(aptGroupBox).getByTestId("peer-balance-amount-u-elena-u-alex"),
    ).toHaveTextContent("+$90.00");
    expect(
      within(tahoeGroupBox).getByTestId("peer-balance-amount-u-alex-u-elena"),
    ).toHaveTextContent("-$50.00");
  });

  it("filters Recent Shared Transactions by merchant/category and enforces locked vs unlocked row actions", async () => {
    const user = userEvent.setup();

    render(
      <AppShell
        groups={SHELL_GROUPS}
        user={{ id: "u-alex", fullName: "Alex Rivera", email: "alex@example.com" }}
      >
        <DashboardClient
          initialExpenses={EXPENSES}
          currentUserId="u-alex"
          userBaseCurrency="USD"
          initialGroups={INITIAL_GROUPS}
          initialSettlements={SETTLEMENTS}
          initialBillingCycles={BILLING_CYCLES}
        />
      </AppShell>,
    );

    const txCard = screen.getByTestId("recent-shared-transactions-card");
    const searchInput = within(txCard).getByPlaceholderText("Filter by merchant...");
    await user.type(searchInput, "Pizza");

    expect(within(txCard).getByText("November House Pizza")).toBeInTheDocument();
    expect(within(txCard).queryByText("November Trader Joe's")).not.toBeInTheDocument();

    // Unlocked expense row menu allows Edit Expense & Delete Expense
    await user.click(
      within(txCard).getByRole("button", {
        name: "Actions for November House Pizza",
      }),
    );
    expect(screen.getByRole("menuitem", { name: "View Split Details" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit Expense" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete Expense" })).toBeInTheDocument();

    // Clear search and switch to closed cycle 2026-10
    await user.click(within(txCard).getByRole("button", { name: "Clear search" }));
    await user.click(screen.getByRole("button", { name: "Previous billing cycle" }));

    // Locked expense in closed cycle offers Log Adjustment, never Edit or Delete
    await user.click(
      within(txCard).getByRole("button", {
        name: "Actions for October ConEd Power",
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Log Adjustment" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("menuitem", { name: "Edit Expense" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete Expense" })).not.toBeInTheDocument();
  });
});
