// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const pushMock = vi.fn();
const refreshMock = vi.fn();
let mockPathname = "/expenses";
let mockSearchParams = new URLSearchParams("cycle=2026-11");

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
    refresh: refreshMock,
    prefetch: vi.fn(),
  }),
  usePathname: () => mockPathname,
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

import { AppShell } from "@/components/shell";
import type { ShellGroupSummary, ShellUserSummary } from "@/components/shell";
import { ExpensesClient } from "@/components/expenses";
import type {
  ExpenseGroupInfo,
  ExpenseLedgerRecord,
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
    activeSplitCount: 10,
    members: [
      { id: "u-alex", name: "Alex Rivera", sharePercentage: 50 },
      { id: "u-elena", name: "Elena Rostova", sharePercentage: 50 },
    ],
  },
];

const EXPENSE_GROUPS: ExpenseGroupInfo[] = [
  {
    id: "grp-apt4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: 200000,
    billingCycleAnchorDay: 1,
    currentUserRole: "ADMIN",
    members: [
      {
        userId: "u-alex",
        name: "Alex Rivera",
        status: "ACTIVE",
        instantSettlementTag: "@alex-r",
      },
      {
        userId: "u-elena",
        name: "Elena Rostova",
        status: "ACTIVE",
        instantSettlementTag: "@elena-r",
      },
    ],
  },
];

const SHELL_USER: ShellUserSummary = {
  id: "u-alex",
  fullName: "Alex Rivera",
  email: "alex@example.com",
};

const CATEGORIES_CYCLE = [
  "Groceries",
  "Utilities",
  "Dining",
  "Travel",
] as const;

function makeExpenses(count: number): ExpenseLedgerRecord[] {
  return Array.from({ length: count }, (_, idx) => {
    const num = idx + 1;
    const paidByElena = num % 2 === 0;
    const day = String(28 - idx).padStart(2, "0");
    const cat = CATEGORIES_CYCLE[idx % CATEGORIES_CYCLE.length];
    return {
      id: `exp-${num}`,
      groupId: "grp-apt4b",
      groupName: "Apt 4B Roommates",
      groupBaseCurrency: "USD",
      groupBillingAnchorDay: 1,
      createdBy: paidByElena ? "u-elena" : "u-alex",
      paidBy: paidByElena ? "u-elena" : "u-alex",
      payerName: paidByElena ? "Elena Rostova" : "Alex Rivera",
      description: `${cat} Entry #${num}`,
      category: cat,
      expenseDate: `2026-11-${day}T12:00:00.000Z`,
      amountCents: num * 2000,
      currency: "USD",
      originalAmountCents: null,
      originalCurrency: null,
      exchangeRate: null,
      exchangeRateSource: null,
      splitMethod: "EQUAL",
      splitBreakdown: [
        { user_id: "u-alex", share_cents: num * 1000 },
        { user_id: "u-elena", share_cents: num * 1000 },
      ],
      receiptUrl: null,
      isRecurringGenerated: false,
      recurringRuleId: null,
      adjustmentForExpenseId: null,
      isLocked: false,
      isCycleClosed: false,
      isSettledByWatermark: false,
      isSettledForUser: false,
    };
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  mockPathname = "/expenses";
  mockSearchParams = new URLSearchParams("group=grp-apt4b&cycle=2026-11");
  replaceMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
});

describe("ExpensesClient v2 & Global Cmd+K Search", () => {
  it(
    "renders v2 KPIs with Monthly Cap ProgressBar, Category pills, Ownership/Status/Sort dropdowns, 8-column Table + Pagination, CSV export, and removes Recurring & insight cards",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();
      // 10 expenses: total = 2000*(1+..+10) = 110000 ($1,100.00); Alex share = $550.00 (50.0% of total, 55.0% of $1,000.00 cap)
      // Settle up to Nov 22 -> exp-7..10 (Nov 22, 21, 20, 19) become settled/locked; exp-1..6 remain pending
      const expenses = makeExpenses(10);
      const settlements = [
        {
          id: "set-1",
          groupId: "grp-apt4b",
          payerId: "u-alex",
          recipientId: "u-elena",
          amountCents: 1000,
          currency: "USD",
          settledAt: "2026-11-22T18:00:00.000Z",
        },
      ];

      const clickedLinks: Array<{ href: string; download: string }> = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        clickedLinks.push({
          href: this.getAttribute("href") ?? "",
          download: this.getAttribute("download") ?? "",
        });
      });

      render(
        <AppShell groups={SHELL_GROUPS} user={SHELL_USER} initialCycle="2026-11">
          <ExpensesClient
            currentUserId="u-alex"
            userBaseCurrency="USD"
            personalShareCapCents={100000} // $1,000.00 cap
            initialGroups={EXPENSE_GROUPS}
            initialExpenses={expenses}
            initialSettlements={settlements}
            initialBillingCycles={[]}
          />
        </AppShell>,
      );

      // Legacy Recurring tab & bottom insight cards are completely removed
      expect(
        screen.queryByRole("tab", { name: /Recurring/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Household Run-Rate Analysis/i),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Smart Split Recommendation/i),
      ).not.toBeInTheDocument();

      // KPI 1: TOTAL GROUP EXPENSES
      const totalCard = screen.getByTestId("kpi-total-group-expenses");
      expect(within(totalCard).getByText("$1,100.00")).toBeInTheDocument();
      expect(
        within(totalCard).getByText(/10 filtered expenses/i),
      ).toBeInTheDocument();

      // KPI 2: YOUR PERSONAL SHARE + % of total + Monthly Cap ProgressBar
      const personalCard = screen.getByTestId("kpi-personal-share");
      expect(within(personalCard).getByText("$550.00")).toBeInTheDocument();
      expect(within(personalCard).getByText("50.0% of total")).toBeInTheDocument();
      expect(
        within(personalCard).getByText("Monthly Cap ($1,000.00)"),
      ).toBeInTheDocument();
      expect(within(personalCard).getByText("55.0%")).toBeInTheDocument();
      const progress = within(personalCard).getByRole("progressbar", {
        name: "Monthly Cap",
      });
      expect(progress).toHaveAttribute("aria-valuenow", "55");

      // KPI 3: UNSETTLED / PENDING
      const unsettledCard = screen.getByTestId("kpi-unsettled-pending");
      expect(within(unsettledCard).getByText("Action needed")).toBeInTheDocument();
      expect(
        within(unsettledCard).getByText(/6 pending items · 1 peer/i),
      ).toBeInTheDocument();

      // 8-column Table headers
      const table = screen.getByRole("table", { name: "Expenses Ledger" });
      const headers = within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent?.trim());
      expect(headers).toEqual([
        "DATE",
        "MERCHANT & GROUP",
        "CATEGORY",
        "PAID BY",
        "SPLIT",
        "YOUR SHARE",
        "STATUS",
        "ACTION",
      ]);

      // Pagination: 8 rows on page 1, 2 rows on page 2
      expect(screen.getByText("Groceries Entry #1")).toBeInTheDocument();
      expect(screen.getByText("Travel Entry #8")).toBeInTheDocument();
      expect(screen.queryByText("Groceries Entry #9")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByText("Groceries Entry #9")).toBeInTheDocument();
      expect(screen.queryByText("Groceries Entry #1")).not.toBeInTheDocument();

      // Category quick-filter pills: All (10), Groceries, Utilities, Dining, Travel
      const categoryGroup = screen.getByRole("group", {
        name: "Filter by category",
      });
      expect(
        within(categoryGroup).getByRole("button", { name: "All (10)" }),
      ).toBeInTheDocument();
      await user.click(
        within(categoryGroup).getByRole("button", { name: "Utilities" }),
      );
      expect(screen.getByText("Utilities Entry #2")).toBeInTheDocument();
      expect(screen.getByText("Utilities Entry #6")).toBeInTheDocument();
      expect(screen.getByText("Utilities Entry #10")).toBeInTheDocument();
      expect(screen.queryByText("Groceries Entry #1")).not.toBeInTheDocument();

      // Reset to All (10)
      await user.click(
        within(categoryGroup).getByRole("button", { name: "All (10)" }),
      );

      // Ownership dropdown: Paid by Me (odd entries)
      await user.click(screen.getByRole("button", { name: "Ownership" }));
      await user.click(screen.getByRole("option", { name: "Paid by Me" }));
      expect(screen.getByText("Groceries Entry #1")).toBeInTheDocument();
      expect(screen.queryByText("Utilities Entry #2")).not.toBeInTheDocument();

      // Ownership back to All Expenses
      await user.click(screen.getByRole("button", { name: "Ownership" }));
      await user.click(screen.getByRole("option", { name: "All Expenses" }));

      // Status dropdown: Pending vs Settled
      await user.click(screen.getByRole("button", { name: "Status" }));
      await user.click(screen.getByRole("option", { name: "Settled" }));
      expect(screen.getByText("Dining Entry #7")).toBeInTheDocument();
      expect(screen.queryByText("Groceries Entry #1")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Status" }));
      await user.click(screen.getByRole("option", { name: "Pending" }));
      expect(screen.getByText("Groceries Entry #1")).toBeInTheDocument();
      expect(screen.queryByText("Dining Entry #7")).not.toBeInTheDocument();

      // Sort dropdown: Amount (Highest) -> Utilities Entry #6 ($120.00) is first among pending 1..6
      await user.click(screen.getByRole("button", { name: "Sort" }));
      await user.click(screen.getByRole("option", { name: "Amount (Highest)" }));
      const bodyRows = within(table).getAllByRole("row").slice(1);
      expect(bodyRows[0]).toHaveTextContent("Utilities Entry #6");

      // Export CSV includes active filters (status=pending, sort=amount-desc)
      await user.click(screen.getByRole("button", { name: /Export CSV/i }));
      expect(clickedLinks).toEqual([
        {
          href: "/api/expenses/export?group=grp-apt4b&cycle=2026-11&format=csv&status=pending&sort=amount-desc",
          download: "ledgersplit-apt-4b-2026-11.csv",
        },
      ]);
    },
  );

  it(
    "opens Cmd+K Global Search, queries /api/search, and navigates to matching expense record",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          groups: [
            {
              id: "grp-apt4b",
              name: "Apt 4B Roommates",
              slug: "apt-4b",
              baseCurrency: "USD",
              status: "ACTIVE",
            },
          ],
          expenses: [
            {
              id: "exp-1",
              groupId: "grp-apt4b",
              groupName: "Apt 4B Roommates",
              description: "Groceries Entry #1",
              category: "Groceries",
              amountCents: 2000,
              currency: "USD",
              expenseDate: "2026-11-28T12:00:00.000Z",
              cycleSlug: "2026-11",
            },
          ],
        }),
      } as Response);

      render(
        <AppShell groups={SHELL_GROUPS} user={SHELL_USER} initialCycle="2026-11">
          <ExpensesClient
            currentUserId="u-alex"
            userBaseCurrency="USD"
            personalShareCapCents={100000}
            initialGroups={EXPENSE_GROUPS}
            initialExpenses={makeExpenses(2)}
            initialSettlements={[]}
            initialBillingCycles={[]}
          />
        </AppShell>,
      );

      fireEvent.keyDown(window, { key: "k", metaKey: true });
      const dialog = screen.getByRole("dialog", { name: "Quick Search" });
      const modalSearch = within(dialog).getByPlaceholderText(
        /Search expenses, merchants, or split groups/i,
      );
      await user.type(modalSearch, "Groceries");

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/search?q=Groceries",
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });

      const matchButton = await within(dialog).findByRole("button", {
        name: /Groceries Entry #1/i,
      });
      await user.click(matchButton);

      expect(pushMock).toHaveBeenCalledWith(
        "/expenses?group=grp-apt4b&cycle=2026-11&q=Groceries+Entry+%231",
      );
    },
  );
});
