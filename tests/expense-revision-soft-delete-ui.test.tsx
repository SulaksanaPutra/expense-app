// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const pushMock = vi.fn();
const refreshMock = vi.fn();
let mockPathname = "/expenses";
let mockSearchParams = new URLSearchParams("group=grp-apt4b&cycle=2026-11");

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
import type {
  ShellGroupSummary,
  ShellNotificationItem,
  ShellUserSummary,
} from "@/components/shell";
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
    activeSplitCount: 3,
    members: [
      { id: "u-alex", name: "Alex Rivera", sharePercentage: 50 },
      { id: "u-elena", name: "Elena Rostova", sharePercentage: 50 },
    ],
  },
];

function makeExpenseGroup(role: "ADMIN" | "MEMBER"): ExpenseGroupInfo[] {
  return [
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
      currentUserRole: role,
      members: [
        {
          userId: "u-alex",
          name: "Alex Rivera",
          status: "ACTIVE",
          instantSettlementTag: "@alex",
        },
        {
          userId: "u-elena",
          name: "Elena Rostova",
          status: "ACTIVE",
          instantSettlementTag: "@elena",
        },
      ],
    },
  ];
}

const SAMPLE_EXPENSES: ExpenseLedgerRecord[] = [
  {
    id: "exp-alex-unlocked",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-alex",
    paidBy: "u-alex",
    payerName: "Alex Rivera",
    description: "Trader Joe's Groceries",
    category: "Groceries & Food",
    expenseDate: "2026-11-20T12:00:00.000Z",
    amountCents: 10000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 5000, percentage: 50 },
      { user_id: "u-elena", share_cents: 5000, percentage: 50 },
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
    id: "exp-elena-unlocked",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-elena",
    paidBy: "u-elena",
    payerName: "Elena Rostova",
    description: "ConEd Electric Bill",
    category: "Utilities",
    expenseDate: "2026-11-18T12:00:00.000Z",
    amountCents: 8000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 4000, percentage: 50 },
      { user_id: "u-elena", share_cents: 4000, percentage: 50 },
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
    id: "exp-locked",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-alex",
    paidBy: "u-alex",
    payerName: "Alex Rivera",
    description: "Settled Coffee Run",
    category: "Dining Out",
    expenseDate: "2026-11-10T12:00:00.000Z",
    amountCents: 2000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 1000, percentage: 50 },
      { user_id: "u-elena", share_cents: 1000, percentage: 50 },
    ],
    receiptUrl: null,
    isRecurringGenerated: false,
    recurringRuleId: null,
    adjustmentForExpenseId: null,
    isLocked: true,
    isCycleClosed: false,
    isSettledByWatermark: true,
    isSettledForUser: true,
  },
];

const SHELL_USER: ShellUserSummary = {
  id: "u-alex",
  fullName: "Alex Rivera",
  email: "alex@example.com",
};

beforeEach(() => {
  mockPathname = "/expenses";
  mockSearchParams = new URLSearchParams("group=grp-apt4b&cycle=2026-11");
  replaceMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Itemized Transactions Edit Mode (ExpenseRevision), Soft-Delete & Role Gates UI", () => {
  it(
    "enforces role & lock rules in row action menu: MEMBER only modifies own unlocked expense; locked hides Edit/Delete",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();

      render(
        <AppShell groups={SHELL_GROUPS} user={SHELL_USER} initialCycle="2026-11">
          <ExpensesClient
            currentUserId="u-alex"
            userBaseCurrency="USD"
            personalShareCapCents={100000}
            initialGroups={makeExpenseGroup("MEMBER")}
            initialExpenses={SAMPLE_EXPENSES}
            initialSettlements={[]}
            initialBillingCycles={[]}
            initialRecurringRules={[]}
          />
        </AppShell>,
      );

      // 1. Own unlocked expense -> Edit Expense & Delete Expense available
      await user.click(
        screen.getByRole("button", {
          name: "Actions for Trader Joe's Groceries",
        }),
      );
      let menu = screen.getByRole("menu");
      expect(
        within(menu).getByRole("menuitem", { name: "Edit Expense" }),
      ).toBeInTheDocument();
      expect(
        within(menu).getByRole("menuitem", { name: "Delete Expense" }),
      ).toBeInTheDocument();
      await user.keyboard("{Escape}");

      // 2. Other member's unlocked expense when current user is MEMBER -> Edit/Delete hidden
      await user.click(
        screen.getByRole("button", {
          name: "Actions for ConEd Electric Bill",
        }),
      );
      menu = screen.getByRole("menu");
      expect(
        within(menu).queryByRole("menuitem", { name: "Edit Expense" }),
      ).not.toBeInTheDocument();
      expect(
        within(menu).queryByRole("menuitem", { name: "Delete Expense" }),
      ).not.toBeInTheDocument();
      expect(
        within(menu).getByRole("menuitem", { name: "View Split Details" }),
      ).toBeInTheDocument();
      await user.keyboard("{Escape}");

      // 3. Locked expense -> Edit/Delete hidden even for creator
      await user.click(
        screen.getByRole("button", {
          name: "Actions for Settled Coffee Run",
        }),
      );
      menu = screen.getByRole("menu");
      expect(
        within(menu).queryByRole("menuitem", { name: "Edit Expense" }),
      ).not.toBeInTheDocument();
      expect(
        within(menu).queryByRole("menuitem", { name: "Delete Expense" }),
      ).not.toBeInTheDocument();
    },
  );

  it(
    "allows ADMIN to edit another member's unlocked expense via AddEditExpenseModal (edit mode) and soft-delete via ConfirmDialog",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ok: true,
              expense: {
                id: "exp-elena-unlocked",
                group_id: "grp-apt4b",
                created_by: "u-elena",
                paid_by: "u-elena",
                description: "ConEd Electric & Gas",
                category: "Utilities",
                expense_date: "2026-11-18T12:00:00.000Z",
                amount_cents: 12000,
                currency: "USD",
                original_amount_cents: null,
                original_currency: null,
                exchange_rate: null,
                exchange_rate_source: null,
                split_method: "EQUAL",
                split_breakdown: [
                  { user_id: "u-alex", share_cents: 6000, percentage: 50 },
                  { user_id: "u-elena", share_cents: 6000, percentage: 50 },
                ],
                receipt_url: null,
                is_recurring_generated: false,
                recurring_rule_id: null,
                adjustment_for_expense_id: null,
                is_locked: false,
              },
              revision: { id: "rev-1" },
              notifications: [{ id: "notif-1", user_id: "u-elena" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ok: true,
              expenseId: "exp-alex-unlocked",
              groupId: "grp-apt4b",
              deletedAt: "2026-11-27T12:00:00.000Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );

      render(
        <AppShell groups={SHELL_GROUPS} user={SHELL_USER} initialCycle="2026-11">
          <ExpensesClient
            currentUserId="u-alex"
            userBaseCurrency="USD"
            personalShareCapCents={100000}
            initialGroups={makeExpenseGroup("ADMIN")}
            initialExpenses={SAMPLE_EXPENSES}
            initialSettlements={[]}
            initialBillingCycles={[]}
            initialRecurringRules={[]}
          />
        </AppShell>,
      );

      // Total initially: $100 + $80 + $20 = $200.00
      const totalCard = screen.getByTestId("kpi-total-group-expenses");
      expect(within(totalCard).getByText("$200.00")).toBeInTheDocument();

      // 1. Open Edit Expense on Elena's unlocked expense (as ADMIN)
      await user.click(
        screen.getByRole("button", {
          name: "Actions for ConEd Electric Bill",
        }),
      );
      await user.click(
        within(screen.getByRole("menu")).getByRole("menuitem", {
          name: "Edit Expense",
        }),
      );

      const editDialog = screen.getByRole("dialog", { name: "Edit Expense" });
      const amountInput = within(editDialog).getByLabelText(/Total Bill Amount/i);
      const descInput = within(editDialog).getByLabelText(/Description/i);
      expect(amountInput).toHaveValue("80.00");
      expect(descInput).toHaveValue("ConEd Electric Bill");

      await user.clear(amountInput);
      await user.type(amountInput, "120.00");
      await user.clear(descInput);
      await user.type(descInput, "ConEd Electric & Gas");

      const saveBtn = within(editDialog).getByRole("button", {
        name: /Save Changes \(\$120\.00\)/i,
      });
      await user.click(saveBtn);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/groups/grp-apt4b/expenses/exp-elena-unlocked",
          expect.objectContaining({ method: "PATCH" }),
        );
      });

      // Row and KPI update immediately ($100 + $120 + $20 = $240.00)
      await waitFor(() => {
        expect(screen.getByText("ConEd Electric & Gas")).toBeInTheDocument();
        expect(within(totalCard).getByText("$240.00")).toBeInTheDocument();
      });

      // 2. Soft-delete Trader Joe's Groceries via ConfirmDialog
      await user.click(
        screen.getByRole("button", {
          name: "Actions for Trader Joe's Groceries",
        }),
      );
      await user.click(
        within(screen.getByRole("menu")).getByRole("menuitem", {
          name: "Delete Expense",
        }),
      );

      const confirmDialog = screen.getByRole("dialog", {
        name: "Delete Expense",
      });
      expect(confirmDialog).toHaveTextContent("Trader Joe's Groceries");
      await user.click(
        within(confirmDialog).getByRole("button", { name: "Delete Expense" }),
      );

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/groups/grp-apt4b/expenses/exp-alex-unlocked",
          expect.objectContaining({ method: "DELETE" }),
        );
      });

      // Soft-deleted row removed and KPI drops by $100 ($240 -> $140.00)
      await waitFor(() => {
        expect(
          screen.queryByText("Trader Joe's Groceries"),
        ).not.toBeInTheDocument();
        expect(within(totalCard).getByText("$140.00")).toBeInTheDocument();
      });
    },
  );

  it(
    "displays unread share-shift notifications in TopBar bell and persists Mark all read",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const initialNotifications: ShellNotificationItem[] = [
        {
          id: "notif-rev-1",
          title: "Expense share updated",
          description:
            'Alex Rivera edited "ConEd Electric Bill": your share shifted from $40.00 to $60.00.',
          timestamp: "Nov 27, 12:00 PM",
          unread: true,
        },
      ];

      render(
        <AppShell
          groups={SHELL_GROUPS}
          user={SHELL_USER}
          initialCycle="2026-11"
          initialNotifications={initialNotifications}
        >
          <div>Expenses Shell</div>
        </AppShell>,
      );

      const bellBtn = screen.getByRole("button", {
        name: "Notifications (1 unread)",
      });
      await user.click(bellBtn);

      const region = screen.getByRole("region", { name: "Notifications" });
      expect(within(region).getByText("Expense share updated")).toBeInTheDocument();
      expect(within(region).getByText(/\$40\.00 to \$60\.00/)).toBeInTheDocument();

      await user.click(
        within(region).getByRole("button", { name: "Mark all read" }),
      );

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications",
        expect.objectContaining({ method: "PATCH" }),
      );
      expect(
        screen.getByRole("button", { name: "Notifications" }),
      ).toBeInTheDocument();
    },
  );
});
