// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
const replaceMock = vi.fn();
const pushMock = vi.fn();
let mockSearchParams = new URLSearchParams("group=grp-apt4b&cycle=2026-11");

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
import type { ExpenseGroupInfo, ExpenseLedgerRecord } from "@/lib/expenses/ledger";

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
      { id: "u-marcus", name: "Marcus Vance" },
    ],
  },
];

function makeInitialGroups(roleForApt4b: "ADMIN" | "MEMBER" = "ADMIN"): ExpenseGroupInfo[] {
  return [
    {
      id: "grp-apt4b",
      name: "Apt 4B Roommates",
      slug: "apt-4b",
      status: "ACTIVE",
      baseCurrency: "USD",
      defaultSplitMode: "EQUAL",
      simplifyDebts: true,
      operationalBudgetCents: 300000,
      billingCycleAnchorDay: 1,
      currentUserRole: roleForApt4b,
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
      operationalBudgetCents: null,
      billingCycleAnchorDay: 1,
      currentUserRole: "ADMIN",
      currentUserStatus: "ACTIVE",
      members: [
        { userId: "u-alex", name: "Alex Rivera", status: "ACTIVE", instantSettlementTag: "@alex" },
        { userId: "u-elena", name: "Elena Rostova", status: "ACTIVE", instantSettlementTag: "@elena" },
        { userId: "u-marcus", name: "Marcus Vance", status: "ACTIVE", instantSettlementTag: "@marcus" },
      ],
    },
  ];
}

// In Apt 4B:
// 1. Alex pays $60.00 split 3 ways (Elena owes Alex $20, Marcus owes Alex $20)
// 2. Marcus pays $90.00 split 3 ways (Alex owes Marcus $30, Elena owes Marcus $30)
// Net balances in Apt 4B:
//   Alex = +60 - 20 - 30 = +$10.00
//   Marcus = +90 - 20 - 30 = +$40.00
//   Elena = -20 - 30 = -$50.00
// Simplified (true): Elena -> Marcus $40.00, Elena -> Alex $10.00 (2 edges)
// Direct (false): Marcus -> Alex -$10.00? No: Alex paid $20 for Marcus, Marcus paid $30 for Alex => Alex -> Marcus $10.00!
//   plus Elena -> Alex $20.00, Elena -> Marcus $30.00 (3 edges!)
//
// In Tahoe Ski Trip:
// 3. Elena pays $40.00 split 2 ways with Alex (Alex owes Elena $20.00)
const SAMPLE_EXPENSES: ExpenseLedgerRecord[] = [
  {
    id: "exp-1",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-alex",
    paidBy: "u-alex",
    payerName: "Alex Rivera",
    description: "Groceries",
    category: "Groceries & Food",
    expenseDate: "2026-11-10T12:00:00.000Z",
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
    id: "exp-2",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-marcus",
    paidBy: "u-marcus",
    payerName: "Marcus Vance",
    description: "Electric & Gas",
    category: "Utilities",
    expenseDate: "2026-11-12T12:00:00.000Z",
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
    id: "exp-3",
    groupId: "grp-tahoe",
    groupName: "Tahoe Ski Trip",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-elena",
    paidBy: "u-elena",
    payerName: "Elena Rostova",
    description: "Ski Gear Rental",
    category: "Entertainment",
    expenseDate: "2026-11-15T12:00:00.000Z",
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  mockSearchParams = new URLSearchParams("group=grp-apt4b&cycle=2026-11");
  refreshMock.mockReset();
  replaceMock.mockReset();
  pushMock.mockReset();
});

describe("Dashboard Peer Balances & Simplify Switch", () => {
  it("toggles Simplify immediately in single-group view, updates pairs without altering net balance, and persists for ADMIN", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, groupId: "grp-apt4b", simplify_debts: false }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <AppShell
        groups={SHELL_GROUPS}
        user={{ id: "u-alex", fullName: "Alex Rivera", email: "alex@example.com" }}
      >
        <DashboardClient
          initialExpenses={SAMPLE_EXPENSES}
          currentUserId="u-alex"
          userBaseCurrency="USD"
          initialGroups={makeInitialGroups("ADMIN")}
          initialSettlements={[]}
          initialBillingCycles={[]}
        />
      </AppShell>,
    );

    const peerCard = screen.getByTestId("peer-balances-card");
    const simplifySwitch = within(peerCard).getByRole("switch", {
      name: /Simplify/i,
    });
    expect(simplifySwitch).toHaveAttribute("aria-checked", "true");

    // Simplified mode: Elena -> Alex (+$10.00) and Elena -> Marcus ($40.00)
    expect(
      within(peerCard).getByTestId("peer-balance-amount-u-elena-u-alex"),
    ).toHaveTextContent("+$10.00");
    expect(
      within(peerCard).getByTestId("peer-balance-amount-u-elena-u-marcus"),
    ).toHaveTextContent("$40.00");
    expect(
      within(peerCard).queryByTestId("peer-balance-amount-u-alex-u-marcus"),
    ).not.toBeInTheDocument();

    const netFooter = screen.getByTestId("overall-net-settlement");
    expect(netFooter).toHaveTextContent("+$10.00 Net Owed to You");

    // Toggle Simplify OFF -> pairs & amounts update immediately
    await user.click(simplifySwitch);
    expect(simplifySwitch).toHaveAttribute("aria-checked", "false");

    // Direct pairwise mode: Alex -> Marcus (-$10.00), Elena -> Alex (+$20.00), Elena -> Marcus ($30.00)
    expect(
      within(peerCard).getByTestId("peer-balance-amount-u-alex-u-marcus"),
    ).toHaveTextContent("-$10.00");
    expect(
      within(peerCard).getByTestId("peer-balance-amount-u-elena-u-alex"),
    ).toHaveTextContent("+$20.00");
    expect(
      within(peerCard).getByTestId("peer-balance-amount-u-elena-u-marcus"),
    ).toHaveTextContent("$30.00");

    // Net balance before and after simplification is identical (+20 - 10 = +$10.00)
    expect(netFooter).toHaveTextContent("+$10.00 Net Owed to You");

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/groups/grp-apt4b/simplify",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ simplify_debts: false }),
        }),
      );
    });
  });

  it("allows non-admin MEMBER to preview Simplify toggle immediately without issuing ADMIN PATCH", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(
      <AppShell
        groups={SHELL_GROUPS}
        user={{ id: "u-alex", fullName: "Alex Rivera", email: "alex@example.com" }}
      >
        <DashboardClient
          initialExpenses={SAMPLE_EXPENSES}
          currentUserId="u-alex"
          userBaseCurrency="USD"
          initialGroups={makeInitialGroups("MEMBER")}
          initialSettlements={[]}
          initialBillingCycles={[]}
        />
      </AppShell>,
    );

    const peerCard = screen.getByTestId("peer-balances-card");
    const simplifySwitch = within(peerCard).getByRole("switch", {
      name: /Simplify/i,
    });
    await user.click(simplifySwitch);

    expect(simplifySwitch).toHaveAttribute("aria-checked", "false");
    expect(
      within(peerCard).getByTestId("peer-balance-amount-u-alex-u-marcus"),
    ).toHaveTextContent("-$10.00");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("isolates balances strictly per group_id in All Groups view without cross-group netting", async () => {
    mockSearchParams = new URLSearchParams("group=all&cycle=2026-11");

    render(
      <AppShell
        groups={SHELL_GROUPS}
        user={{ id: "u-alex", fullName: "Alex Rivera", email: "alex@example.com" }}
      >
        <DashboardClient
          initialExpenses={SAMPLE_EXPENSES}
          currentUserId="u-alex"
          userBaseCurrency="USD"
          initialGroups={makeInitialGroups("ADMIN")}
          initialSettlements={[]}
          initialBillingCycles={[]}
        />
      </AppShell>,
    );

    const aptGroupBox = screen.getByTestId("peer-balance-group-grp-apt4b");
    const tahoeGroupBox = screen.getByTestId("peer-balance-group-grp-tahoe");

    // Apt 4B: Elena owes Alex +$10.00
    expect(
      within(aptGroupBox).getByTestId("peer-balance-amount-u-elena-u-alex"),
    ).toHaveTextContent("+$10.00");

    // Tahoe: Alex owes Elena -$20.00 (never netted with Apt 4B's +$10.00!)
    expect(
      within(tahoeGroupBox).getByTestId("peer-balance-amount-u-alex-u-elena"),
    ).toHaveTextContent("-$20.00");

    // Net summary across groups is +10 - 20 = -$10.00
    expect(screen.getByTestId("overall-net-settlement")).toHaveTextContent(
      "-$10.00 Net You Owe",
    );
  });

  it("opens RecordSettlementModal from Peer Balances and updates balances immediately on settlement", async () => {
    mockSearchParams = new URLSearchParams("group=grp-tahoe&cycle=2026-11");
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          settlement: {
            id: "set-new",
            group_id: "grp-tahoe",
            payer_id: "u-alex",
            recipient_id: "u-elena",
            amount_cents: 2000,
            currency: "USD",
            payment_rail: "VENMO",
            settled_at: "2026-11-16T12:00:00.000Z",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <AppShell
        groups={SHELL_GROUPS}
        user={{ id: "u-alex", fullName: "Alex Rivera", email: "alex@example.com" }}
      >
        <DashboardClient
          initialExpenses={SAMPLE_EXPENSES}
          currentUserId="u-alex"
          userBaseCurrency="USD"
          initialGroups={makeInitialGroups("ADMIN")}
          initialSettlements={[]}
          initialBillingCycles={[]}
        />
      </AppShell>,
    );

    const peerCard = screen.getByTestId("peer-balances-card");
    await user.click(within(peerCard).getByRole("button", { name: "Settle Up" }));

    const dialog = screen.getByRole("dialog", { name: "Record Settlement" });
    await user.click(within(dialog).getByRole("button", { name: /Mark as Settled/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Record Settlement" })).not.toBeInTheDocument();
    });

    expect(peerCard).toHaveTextContent("All balances settled in Tahoe Ski Trip.");
    expect(screen.getByTestId("overall-net-settlement")).toHaveTextContent(
      "$0.00 All Settled",
    );
  });
});
