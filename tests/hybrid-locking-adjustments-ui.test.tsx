// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddEditExpenseModal } from "@/components/expenses/AddEditExpenseModal";
import { ExpensesClient } from "@/components/expenses/ExpensesClient";
import type { ShellGroupSummary, ShellUserSummary } from "@/components/shell/types";
import type { ExpenseGroupInfo, ExpenseLedgerRecord } from "@/lib/expenses/ledger";

const pushMock = vi.fn();
const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    refresh: refreshMock,
  }),
  usePathname: () => "/expenses",
  useSearchParams: () => new URLSearchParams("group=grp-1&cycle=2026-11"),
}));

const aliceId = "user-alice";
const bobId = "user-bob";
const charlieId = "user-charlie";

const currentUser: ShellUserSummary = {
  id: aliceId,
  fullName: "Alice Admin",
  email: "alice@test.local",
  receiptStorageUsedBytes: 0,
};

const shellGroups: ShellGroupSummary[] = [
  {
    id: "grp-1",
    name: "Apt 4B",
    slug: "apt-4b",
    status: "ACTIVE",
    groupType: "RESIDENTIAL",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    activeSplitCount: 3,
    currentUserStatus: "ACTIVE",
    members: [
      { id: aliceId, name: "Alice Admin" },
      { id: bobId, name: "Bob Member" },
      { id: charlieId, name: "Charlie Member" },
    ],
  },
];

vi.mock("@/components/shell/ActiveGroupContext", () => ({
  useActiveGroup: () => ({
    groups: shellGroups,
    activeGroupId: "grp-1",
    activeGroup: shellGroups[0],
    cycle: "2026-11",
    user: currentUser,
    updateReceiptStorageUsedBytes: vi.fn(),
    openAddExpense: vi.fn(),
  }),
}));

const lockedExpense: ExpenseLedgerRecord = {
  id: "exp-locked-1",
  groupId: "grp-1",
  groupName: "Apt 4B",
  groupBaseCurrency: "USD",
  groupBillingAnchorDay: 1,
  createdBy: aliceId,
  paidBy: aliceId,
  payerName: "Alice Admin",
  description: "Locked 3-Way Electric",
  category: "Utilities",
  expenseDate: "2026-11-10T12:00:00.000Z",
  amountCents: 9000,
  currency: "USD",
  originalAmountCents: null,
  originalCurrency: null,
  exchangeRate: null,
  exchangeRateSource: null,
  splitMethod: "EQUAL",
  splitBreakdown: [
    { user_id: aliceId, share_cents: 3000, percentage: 33.34 },
    { user_id: bobId, share_cents: 3000, percentage: 33.33 },
    { user_id: charlieId, share_cents: 3000, percentage: 33.33 },
  ],
  receiptUrl: null,
  isRecurringGenerated: false,
  recurringRuleId: null,
  adjustmentForExpenseId: null,
  isLocked: true,
  isCycleClosed: false,
  isSettledByWatermark: true,
  isSettledForUser: true,
};

const ledgerGroups: ExpenseGroupInfo[] = [
  {
    id: "grp-1",
    name: "Apt 4B",
    slug: "apt-4b",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: false,
    operationalBudgetCents: 300000,
    billingCycleAnchorDay: 1,
    currentUserRole: "ADMIN",
    currentUserStatus: "ACTIVE",
    members: [
      { userId: aliceId, name: "Alice Admin", status: "ACTIVE", instantSettlementTag: null },
      { userId: bobId, name: "Bob Member", status: "ACTIVE", instantSettlementTag: null },
      { userId: charlieId, name: "Charlie Member", status: "ACTIVE", instantSettlementTag: null },
    ],
  },
];

describe("Issue #85 — Hybrid Locking & Offsetting Adjustment UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders AddEditExpenseModal in adjustment mode and submits adjustment_for_expense_id", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          expense: {
            id: "exp-adj-1",
            group_id: "grp-1",
            created_by: aliceId,
            paid_by: aliceId,
            description: "Adjustment: Locked 3-Way Electric",
            category: "Utilities",
            expense_date: "2026-11-27T12:00:00.000Z",
            amount_cents: -3000,
            currency: "USD",
            original_amount_cents: null,
            original_currency: null,
            exchange_rate: null,
            exchange_rate_source: null,
            split_method: "EQUAL",
            split_breakdown: [
              { user_id: aliceId, share_cents: -1000, percentage: 33.34 },
              { user_id: bobId, share_cents: -1000, percentage: 33.33 },
              { user_id: charlieId, share_cents: -1000, percentage: 33.33 },
            ],
            receipt_url: null,
            is_recurring_generated: false,
            recurring_rule_id: null,
            adjustment_for_expense_id: "exp-locked-1",
            is_locked: false,
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    const onCreated = vi.fn();
    render(
      <AddEditExpenseModal
        open={true}
        onClose={vi.fn()}
        mode="adjustment"
        expense={lockedExpense}
        groups={shellGroups}
        activeGroupId="grp-1"
        currentUser={currentUser}
        cycle="2026-11"
        onCreated={onCreated}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /Log Offsetting Adjustment/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Offsetting Adjustment Mode/i)).toBeInTheDocument();

    const amountInput = screen.getByLabelText(/Amount/i);
    await user.clear(amountInput);
    await user.type(amountInput, "-30.00");

    const saveBtn = screen.getByRole("button", { name: /Save Adjustment/i });
    expect(saveBtn).toBeEnabled();
    await user.click(saveBtn);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/groups/grp-1/expenses");
    const parsedBody = JSON.parse(String(init?.body)) as {
      amount_cents: number;
      adjustment_for_expense_id: string;
    };
    expect(parsedBody.amount_cents).toBe(-3000);
    expect(parsedBody.adjustment_for_expense_id).toBe("exp-locked-1");
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("shows Log Adjustment for locked expenses and Close & Lock Cycle for ADMIN on ExpensesClient", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          lockedExpenseCount: 1,
          billingCycle: {
            id: "bc-1",
            group_id: "grp-1",
            period_start: "2026-11-01",
            period_end: "2026-11-30",
            status: "CLOSED",
            closed_by: aliceId,
            closed_at: "2026-11-27T12:00:00.000Z",
            created_at: "2026-11-27T12:00:00.000Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <ExpensesClient
        currentUserId={aliceId}
        userBaseCurrency="USD"
        personalShareCapCents={null}
        initialGroups={ledgerGroups}
        initialExpenses={[lockedExpense]}
        initialSettlements={[]}
        initialBillingCycles={[]}
      />,
    );

    // Locked expense row menu offers Log Adjustment (not Edit/Delete)
    const rowMenuTrigger = screen.getByRole("button", {
      name: /Actions for Locked 3-Way Electric/i,
    });
    await user.click(rowMenuTrigger);
    expect(screen.getByRole("menuitem", { name: /Log Adjustment/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Edit Expense/i })).not.toBeInTheDocument();

    // ADMIN sees Close & Lock Cycle button and can confirm
    const closeCycleBtn = screen.getByRole("button", {
      name: /Close & Lock Cycle/i,
    });
    await user.click(closeCycleBtn);

    const dialog = screen.getByRole("dialog");
    const confirmBtn = within(dialog).getByRole("button", {
      name: /Close & Lock Cycle/i,
    });
    await user.click(confirmBtn);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "/api/groups/grp-1/billing-cycles/close",
    );
  });
});
