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
  RecurringRuleRecord,
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
    activeSplitCount: 9,
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

function makeExpenses(count: number): ExpenseLedgerRecord[] {
  return Array.from({ length: count }, (_, idx) => {
    const num = idx + 1;
    const paidByElena = num % 2 === 0;
    const day = String(28 - idx).padStart(2, "0");
    return {
      id: `exp-${num}`,
      groupId: "grp-apt4b",
      groupName: "Apt 4B Roommates",
      groupBaseCurrency: "USD",
      groupBillingAnchorDay: 1,
      createdBy: paidByElena ? "u-elena" : "u-alex",
      paidBy: paidByElena ? "u-elena" : "u-alex",
      payerName: paidByElena ? "Elena Rostova" : "Alex Rivera",
      description: paidByElena
        ? `ConEd Utility #${num}`
        : `Trader Joe's Basket #${num}`,
      category: paidByElena ? "Utilities" : "Groceries & Food",
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

const RECURRING_RULES: RecurringRuleRecord[] = [
  {
    id: "rec-1",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    paidBy: "u-alex",
    payerName: "Alex Rivera",
    description: "Fiber Internet",
    category: "Utilities",
    amountCents: 9000,
    currency: "USD",
    frequency: "MONTHLY",
    dayOfMonth: 5,
    splitRule: "EQUAL",
    isActive: true,
    nextRunDate: "2026-12-05",
  },
];

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

describe("ExpensesClient & Global Cmd+K Search", () => {
  it(
    "renders KPI cards with Personal Share ProgressBar, filters by tab/category/search/sort, and paginates",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();
      const expenses = makeExpenses(9);

      render(
        <AppShell groups={SHELL_GROUPS} user={SHELL_USER} initialCycle="2026-11">
          <ExpensesClient
            currentUserId="u-alex"
            userBaseCurrency="USD"
            personalShareCapCents={100000} // $1,000.00 cap
            initialGroups={EXPENSE_GROUPS}
            initialExpenses={expenses}
            initialSettlements={[]}
            initialBillingCycles={[]}
            initialRecurringRules={RECURRING_RULES}
          />
        </AppShell>,
      );

      // Total group spend = 2000*(1+..+9) = 90000 ($900.00); Alex share = $450.00 (45.0% of $1,000.00)
      const totalCard = screen.getByTestId("kpi-total-group-expenses");
      expect(within(totalCard).getByText("$900.00")).toBeInTheDocument();
      expect(
        within(totalCard).getByText(/9 aggregate transactions/i),
      ).toBeInTheDocument();

      const personalCard = screen.getByTestId("kpi-personal-share");
      expect(within(personalCard).getByText("$450.00")).toBeInTheDocument();
      expect(within(personalCard).getByText("45.0%")).toBeInTheDocument();
      expect(
        within(personalCard).getByText(/Monthly limit threshold: \$1,000\.00/i),
      ).toBeInTheDocument();
      const progress = within(personalCard).getByRole("progressbar");
      expect(progress).toHaveAttribute("aria-valuenow", "45");

      const unsettledCard = screen.getByTestId("kpi-unsettled-pending");
      expect(
        within(unsettledCard).getByText(/Next group settlement:/i),
      ).toBeInTheDocument();

      // Pagination shows page 1 of 2 (7 rows on page 1, 2 on page 2)
      expect(screen.getByText("Trader Joe's Basket #1")).toBeInTheDocument();
      expect(screen.queryByText("ConEd Utility #8")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByText("ConEd Utility #8")).toBeInTheDocument();
      expect(
        screen.queryByText("Trader Joe's Basket #1"),
      ).not.toBeInTheDocument();

      // Tab filter: Paid by Me (5 odd items -> resets to page 1)
      await user.click(screen.getByRole("tab", { name: "Paid by Me" }));
      expect(screen.getByText("Trader Joe's Basket #1")).toBeInTheDocument();
      expect(screen.queryByText("ConEd Utility #2")).not.toBeInTheDocument();

      // Tab filter: Split with Me (4 even items)
      await user.click(screen.getByRole("tab", { name: "Split with Me" }));
      expect(screen.getByText("ConEd Utility #2")).toBeInTheDocument();
      expect(
        screen.queryByText("Trader Joe's Basket #1"),
      ).not.toBeInTheDocument();

      // Back to All Expenses, filter by search query
      await user.click(screen.getByRole("tab", { name: "All Expenses" }));
      const searchInput = screen.getByRole("searchbox", {
        name: "Search expenses",
      });
      await user.type(searchInput, "#9");
      expect(screen.getByText("Trader Joe's Basket #9")).toBeInTheDocument();
      expect(
        screen.queryByText("Trader Joe's Basket #1"),
      ).not.toBeInTheDocument();

      // Clear search, filter by Utilities category chip
      await user.click(screen.getByRole("button", { name: "Clear search" }));
      await user.click(screen.getByRole("button", { name: /Utilities/i }));
      expect(screen.getByText("ConEd Utility #2")).toBeInTheDocument();
      expect(
        screen.queryByText("Trader Joe's Basket #1"),
      ).not.toBeInTheDocument();

      // Recurring tab shows Fiber Internet rule
      await user.click(screen.getByRole("tab", { name: "Recurring" }));
      expect(screen.getByText("Fiber Internet")).toBeInTheDocument();
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
              description: "Trader Joe's Basket #1",
              category: "Groceries & Food",
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
            initialRecurringRules={[]}
          />
        </AppShell>,
      );

      fireEvent.keyDown(window, { key: "k", metaKey: true });
      const dialog = screen.getByRole("dialog", { name: "Quick Search" });
      const modalSearch = within(dialog).getByPlaceholderText(
        /Search expenses, merchants, or split groups/i,
      );
      await user.type(modalSearch, "Trader");

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/search?q=Trader",
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });

      const matchButton = await within(dialog).findByRole("button", {
        name: /Trader Joe's Basket #1/i,
      });
      await user.click(matchButton);

      expect(pushMock).toHaveBeenCalledWith(
        "/expenses?group=grp-apt4b&cycle=2026-11&q=Trader+Joe%27s+Basket+%231",
      );
    },
  );
});
