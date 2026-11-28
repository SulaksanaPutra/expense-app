// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
const replaceMock = vi.fn();
const pushMock = vi.fn();
let mockPathname = "/dashboard";
let mockSearchParams = new URLSearchParams("group=all&cycle=2026-11");

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    replace: replaceMock,
    push: pushMock,
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

import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { AppShell, type ShellGroupSummary } from "@/components/shell";
import { SplitGroupsClient } from "@/components/split-groups";
import type { ExpenseGroupInfo, ExpenseLedgerRecord } from "@/lib/expenses/ledger";
import type { ReminderCooldownInfo } from "@/lib/groups/reminders";
import type { SplitGroupsPageData } from "@/lib/groups/types";

const SHELL_GROUPS: ShellGroupSummary[] = [
  {
    id: "grp-apt4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b",
    groupType: "RESIDENTIAL",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    activeSplitCount: 1,
    members: [
      { id: "u-alex", name: "Alex Rivera" },
      { id: "u-elena", name: "Elena Rostova" },
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
      { id: "u-marcus", name: "Marcus Vance" },
    ],
  },
];

const GROUPS: ExpenseGroupInfo[] = [
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
    currentUserRole: "ADMIN",
    currentUserStatus: "ACTIVE",
    members: [
      { userId: "u-alex", name: "Alex Rivera", status: "ACTIVE", instantSettlementTag: "@alex" },
      { userId: "u-elena", name: "Elena Rostova", status: "ACTIVE", instantSettlementTag: "@elena" },
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
      { userId: "u-marcus", name: "Marcus Vance", status: "ACTIVE", instantSettlementTag: "@marcus" },
    ],
  },
];

const EXPENSES: ExpenseLedgerRecord[] = [
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
    amountCents: 8000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 4000 },
      { user_id: "u-elena", share_cents: 4000 },
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
    groupId: "grp-tahoe",
    groupName: "Tahoe Ski Trip",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-alex",
    paidBy: "u-alex",
    payerName: "Alex Rivera",
    description: "Lift Passes",
    category: "Entertainment",
    expenseDate: "2026-11-12T12:00:00.000Z",
    amountCents: 5000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 2500 },
      { user_id: "u-marcus", share_cents: 2500 },
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
  mockPathname = "/dashboard";
  mockSearchParams = new URLSearchParams("group=all&cycle=2026-11");
  refreshMock.mockReset();
  replaceMock.mockReset();
  pushMock.mockReset();
});

describe("Reminder Pills & 24h Cooldown UI", () => {
  it("dispatches single Remind and batch Send N reminders, then disables pills with Reminded today (Xh remaining)", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const elenaCooldown: ReminderCooldownInfo = {
      groupId: "grp-apt4b",
      debtorId: "u-elena",
      creditorId: "u-alex",
      channel: "PUSH",
      sentAt: new Date(now).toISOString(),
      nextAllowedAt: new Date(now + 24 * 3_600_000).toISOString(),
      remainingMs: 24 * 3_600_000,
      remainingHours: 24,
    };
    const marcusCooldown: ReminderCooldownInfo = {
      groupId: "grp-tahoe",
      debtorId: "u-marcus",
      creditorId: "u-alex",
      channel: "SMS",
      sentAt: new Date(now).toISOString(),
      nextAllowedAt: new Date(now + 24 * 3_600_000).toISOString(),
      remainingMs: 24 * 3_600_000,
      remainingHours: 24,
    };

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            channel: "PUSH",
            deliveryMode: "push",
            cooldown: elenaCooldown,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            channel: "SMS",
            deliveryMode: "sms",
            cooldown: marcusCooldown,
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
          initialExpenses={EXPENSES}
          currentUserId="u-alex"
          userBaseCurrency="USD"
          initialGroups={GROUPS}
          initialSettlements={[]}
          initialBillingCycles={[]}
          initialReminderCooldowns={[]}
        />
      </AppShell>,
    );

    const elenaRemindBtn = screen.getByTestId("remind-peer-btn-grp-apt4b-u-elena");
    expect(elenaRemindBtn).toBeEnabled();
    expect(elenaRemindBtn).toHaveTextContent("Remind");

    // Click single Remind for Elena (Push fallback)
    await user.click(elenaRemindBtn);

    await waitFor(() => {
      expect(elenaRemindBtn).toBeDisabled();
    });
    expect(elenaRemindBtn).toHaveTextContent("Reminded today (24h remaining)");
    expect(screen.getByText("Push reminder sent")).toBeInTheDocument();

    // Click single Remind for Marcus (SMS)
    const marcusRemindBtn = screen.getByTestId("remind-peer-btn-grp-tahoe-u-marcus");
    expect(marcusRemindBtn).toBeEnabled();
    await user.click(marcusRemindBtn);

    await waitFor(() => {
      expect(marcusRemindBtn).toBeDisabled();
    });
    expect(marcusRemindBtn).toHaveTextContent("Reminded today (24h remaining)");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/groups/grp-apt4b/reminders",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/groups/grp-tahoe/reminders",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          debtor_id: "u-marcus",
          amount_cents: 2500,
        }),
      }),
    );
  });

  it("renders pre-existing SSR cooldowns and syncs UI when API rejects with 429", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const initialCooldowns: ReminderCooldownInfo[] = [
      {
        groupId: "grp-apt4b",
        debtorId: "u-elena",
        creditorId: "u-alex",
        channel: "PUSH",
        sentAt: new Date(now - 7 * 3_600_000).toISOString(),
        nextAllowedAt: new Date(now + 17 * 3_600_000).toISOString(),
        remainingMs: 17 * 3_600_000,
        remainingHours: 17,
      },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "Reminder already sent within the last 24 hours (19h remaining).",
          code: "REMINDER_COOLDOWN",
          remaining_hours: 19,
          cooldown: {
            groupId: "grp-tahoe",
            debtorId: "u-marcus",
            creditorId: "u-alex",
            channel: "SMS",
            sentAt: new Date(now - 5 * 3_600_000).toISOString(),
            nextAllowedAt: new Date(now + 19 * 3_600_000).toISOString(),
            remainingMs: 19 * 3_600_000,
            remainingHours: 19,
          },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <AppShell
        groups={SHELL_GROUPS}
        user={{ id: "u-alex", fullName: "Alex Rivera", email: "alex@example.com" }}
      >
        <DashboardClient
          initialExpenses={EXPENSES}
          currentUserId="u-alex"
          userBaseCurrency="USD"
          initialGroups={GROUPS}
          initialSettlements={[]}
          initialBillingCycles={[]}
          initialReminderCooldowns={initialCooldowns}
        />
      </AppShell>,
    );

    const elenaRemindBtn = screen.getByTestId("remind-peer-btn-grp-apt4b-u-elena");
    expect(elenaRemindBtn).toBeDisabled();
    expect(elenaRemindBtn).toHaveTextContent("Reminded today (17h remaining)");

    const marcusRemindBtn = screen.getByTestId("remind-peer-btn-grp-tahoe-u-marcus");
    expect(marcusRemindBtn).toBeEnabled();
    await user.click(marcusRemindBtn);

    await waitFor(() => {
      expect(marcusRemindBtn).toBeDisabled();
    });
    expect(marcusRemindBtn).toHaveTextContent("Reminded today (19h remaining)");
    expect(screen.getByText("Reminder cooldown active")).toBeInTheDocument();


  });

  it("wires Remind pill with 24h cooldown on Split Groups Spotlight member cards", async () => {
    mockPathname = "/split-groups";
    mockSearchParams = new URLSearchParams("group=grp-apt4b&cycle=2026-11");
    const user = userEvent.setup();
    const now = Date.now();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          channel: "SMS",
          deliveryMode: "sms",
          cooldown: {
            groupId: "grp-apt4b",
            debtorId: "u-elena",
            creditorId: "u-alex",
            channel: "SMS",
            sentAt: new Date(now).toISOString(),
            nextAllowedAt: new Date(now + 24 * 3_600_000).toISOString(),
            remainingMs: 24 * 3_600_000,
            remainingHours: 24,
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    const pageData: SplitGroupsPageData = {
      cycleSlug: "2026-11",
      loadError: null,
      archivedGroups: [],
      reminderCooldowns: [],
      activeGroups: [
        {
          id: "grp-apt4b",
          name: "Apt 4B Roommates",
          slug: "apt-4b",
          groupType: "RESIDENTIAL",
          status: "ACTIVE",
          baseCurrency: "USD",
          defaultSplitMode: "EQUAL",
          simplifyDebts: true,
          operationalBudgetCents: 300000,
          billingCycleAnchorDay: 1,
          leaseEndDate: null,
          inviteToken: "tok-apt4b",
          cycleTurnoverCents: 8000,
          cycleTransactionCount: 1,
          userNetLedgerCents: 4000,
          recurringRuleCount: 0,
          isFullySettled: false,
          currentUserRole: "ADMIN",
          members: [
            {
              userId: "u-alex",
              name: "Alex Rivera",
              email: "alex@example.com",
              role: "ADMIN",
              status: "ACTIVE",
              sharePercentage: 50,
              paidThisPeriodCents: 8000,
              netBalanceCents: 4000,
              isCurrentUser: true,
            },
            {
              userId: "u-elena",
              name: "Elena Rostova",
              email: "elena@example.com",
              role: "MEMBER",
              status: "ACTIVE",
              sharePercentage: 50,
              paidThisPeriodCents: 0,
              netBalanceCents: -4000,
              isCurrentUser: false,
            },
          ],
        },
      ],
    };

    render(
      <AppShell
        groups={SHELL_GROUPS}
        user={{ id: "u-alex", fullName: "Alex Rivera", email: "alex@example.com" }}
      >
        <SplitGroupsClient initialData={pageData} defaultCurrency="USD" />
      </AppShell>,
    );

    const remindBtn = screen.getByTestId("split-group-remind-u-elena");
    expect(remindBtn).toBeEnabled();
    expect(remindBtn).toHaveTextContent("Remind");

    await user.click(remindBtn);

    await waitFor(() => {
      expect(remindBtn).toBeDisabled();
    });
    expect(remindBtn).toHaveTextContent("Reminded today (24h remaining)");
    expect(screen.getByText("SMS reminder sent")).toBeInTheDocument();
  });
});
