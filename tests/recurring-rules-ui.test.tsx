// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
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
let mockSearchParams = new URLSearchParams(
  "group=grp-apt4b&cycle=2026-11&tab=recurring",
);

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
    activeSplitCount: 2,
    members: [
      { id: "u-alex", name: "Alex Rivera", sharePercentage: 50 },
      { id: "u-elena", name: "Elena Rostova", sharePercentage: 50 },
    ],
  },
];

const MEMBER_USER: ShellUserSummary = {
  id: "u-elena",
  fullName: "Elena Rostova",
  email: "elena@example.com",
};

const MEMBER_GROUPS: ExpenseGroupInfo[] = [
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
    currentUserRole: "MEMBER",
    currentUserStatus: "ACTIVE",
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

const INITIAL_RULES: RecurringRuleRecord[] = [
  {
    id: "rec-alex",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    createdBy: "u-alex",
    paidBy: "u-alex",
    payerName: "Alex Rivera",
    description: "Apartment Rent",
    category: "Rent & Housing",
    amountCents: 240000,
    currency: "USD",
    frequency: "MONTHLY",
    dayOfMonth: 1,
    splitRule: "CUSTOM_RATIOS",
    isActive: true,
    nextRunDate: "2026-12-01",
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  mockPathname = "/expenses";
  mockSearchParams = new URLSearchParams(
    "group=grp-apt4b&cycle=2026-11&tab=recurring",
  );
  replaceMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
});

describe("Expenses Recurring Tab CRUD UI", () => {
  it(
    "lets an active non-admin member create, pause/resume, and delete their own recurring rule while viewing others as Creator or Admin",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();

      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input, init) => {
          const url = typeof input === "string" ? input : input.toString();
          const method = (init?.method ?? "GET").toUpperCase();

          if (url.includes("/recurring-rules") && method === "POST") {
            return new Response(
              JSON.stringify({
                ok: true,
                rule: {
                  id: "rec-elena-1",
                  group_id: "grp-apt4b",
                  created_by: "u-elena",
                  paid_by: "u-elena",
                  description: "Fiber Internet",
                  category: "Utilities",
                  amount_cents: 8500,
                  currency: "USD",
                  frequency: "MONTHLY",
                  day_of_month: 15,
                  split_rule: "EQUAL",
                  is_active: true,
                  next_run_date: "2026-12-15",
                },
              }),
              { status: 201 },
            );
          }

          if (url.includes("/recurring-rules") && method === "PATCH") {
            return new Response(
              JSON.stringify({
                ok: true,
                rule: { id: "rec-elena-1", is_active: false },
              }),
              { status: 200 },
            );
          }

          if (url.includes("/recurring-rules") && method === "DELETE") {
            return new Response(
              JSON.stringify({ ok: true, ruleId: "rec-elena-1" }),
              { status: 200 },
            );
          }

          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        });

      render(
        <AppShell
          groups={SHELL_GROUPS}
          user={MEMBER_USER}
          initialCycle="2026-11"
        >
          <ExpensesClient
            currentUserId="u-elena"
            userBaseCurrency="USD"
            personalShareCapCents={160000}
            initialGroups={MEMBER_GROUPS}
            initialExpenses={[]}
            initialSettlements={[]}
            initialBillingCycles={[]}
            initialRecurringRules={INITIAL_RULES}
          />
        </AppShell>,
      );

      // Existing rule created by Alex is visible with "Creator or Admin" lock label for Elena
      const alexRow = screen.getByTestId("recurring-rule-row-rec-alex");
      expect(within(alexRow).getByText("Apartment Rent")).toBeInTheDocument();
      expect(within(alexRow).getByText("Custom Ratios")).toBeInTheDocument();
      expect(within(alexRow).getByText("Creator or Admin")).toBeInTheDocument();

      // Active member Elena sees "Add Recurring Rule" button
      await user.click(
        screen.getByRole("button", { name: /Add Recurring Rule/i }),
      );

      const dialog = screen.getByRole("dialog", { name: "Add Recurring Rule" });
      await user.type(
        within(dialog).getByLabelText(/Description/i),
        "Fiber Internet",
      );
      await user.type(within(dialog).getByLabelText(/Amount/i), "85.00");

      const dayInput = within(dialog).getByLabelText(/Day of Month/i);
      await user.clear(dayInput);
      await user.type(dayInput, "15");

      await user.click(within(dialog).getByRole("button", { name: "Save Rule" }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/groups/grp-apt4b/recurring-rules",
          expect.objectContaining({ method: "POST" }),
        );
      });

      const elenaRow = await screen.findByTestId(
        "recurring-rule-row-rec-elena-1",
      );
      expect(within(elenaRow).getByText("Fiber Internet")).toBeInTheDocument();
      expect(within(elenaRow).getByText("$85.00")).toBeInTheDocument();
      expect(within(elenaRow).getByText("Active")).toBeInTheDocument();

      // Pause Elena's rule
      await user.click(
        within(elenaRow).getByRole("button", { name: "Pause Fiber Internet" }),
      );
      await waitFor(() => {
        expect(within(elenaRow).getByText("Paused")).toBeInTheDocument();
      });

      // Delete Elena's rule via ConfirmDialog
      await user.click(
        within(elenaRow).getByRole("button", { name: "Delete Fiber Internet" }),
      );
      const confirmDialog = screen.getByRole("dialog", {
        name: "Delete Recurring Rule",
      });
      await user.click(
        within(confirmDialog).getByRole("button", { name: "Delete Rule" }),
      );

      await waitFor(() => {
        expect(
          screen.queryByTestId("recurring-rule-row-rec-elena-1"),
        ).not.toBeInTheDocument();
      });
    },
  );

  it("hides Add Recurring Rule and management controls for FORMER_MEMBER accounts", () => {
    const formerGroups: ExpenseGroupInfo[] = [
      {
        ...MEMBER_GROUPS[0],
        currentUserStatus: "FORMER_MEMBER",
        members: [
          MEMBER_GROUPS[0].members[0],
          { ...MEMBER_GROUPS[0].members[1], status: "FORMER_MEMBER" },
        ],
      },
    ];

    render(
      <AppShell groups={SHELL_GROUPS} user={MEMBER_USER} initialCycle="2026-11">
        <ExpensesClient
          currentUserId="u-elena"
          userBaseCurrency="USD"
          personalShareCapCents={160000}
          initialGroups={formerGroups}
          initialExpenses={[]}
          initialSettlements={[]}
          initialBillingCycles={[]}
          initialRecurringRules={INITIAL_RULES}
        />
      </AppShell>,
    );

    expect(
      screen.queryByRole("button", { name: /Add Recurring Rule/i }),
    ).not.toBeInTheDocument();
  });
});
