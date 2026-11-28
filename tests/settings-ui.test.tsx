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
let mockPathname = "/settings";
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
import type { ShellGroupSummary, ShellUserSummary } from "@/components/shell";
import { SettingsClient } from "@/components/settings";
import { ExpensesClient } from "@/components/expenses";
import type {
  ExpenseGroupInfo,
  ExpenseLedgerRecord,
} from "@/lib/expenses/ledger";
import type { SettingsUserProfile } from "@/lib/settings/service";

const INITIAL_PROFILE: SettingsUserProfile = {
  id: "u-alex",
  fullName: "Jordan Doe",
  email: "jordan.davis@fastmail.com",
  avatarUrl: null,
  phoneNumber: "+1 (415) 890-3412",
  timezone: "America/Los_Angeles",
  displayCurrency: "USD",
  personalShareCapCents: 160_000,
  autoIncludeInExpenses: true,
  notificationPrefs: {
    new_expense_added: true,
    settlement_recorded: true,
    cycle_close_reminder: true,
    monthly_summary_digest: false,
  },
  createdAt: "2024-03-15T10:00:00.000Z",
};

const SHELL_GROUPS: ShellGroupSummary[] = [
  {
    id: "grp-apt4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b-roommates",
    groupType: "RESIDENTIAL",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    activeSplitCount: 1,
    members: [
      { id: "u-alex", name: "Jordan Doe", sharePercentage: 50 },
      { id: "u-elena", name: "Elena Rostova", sharePercentage: 50 },
    ],
  },
];

const SHELL_USER: ShellUserSummary = {
  id: "u-alex",
  fullName: "Jordan Doe",
  email: "jordan.davis@fastmail.com",
  displayCurrency: "USD",
  baseCurrency: "USD",
  personalShareCapCents: 160_000,
  autoIncludeInExpenses: true,
};

const EXPENSE_GROUPS: ExpenseGroupInfo[] = [
  {
    id: "grp-apt4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b-roommates",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: 400_000,
    billingCycleAnchorDay: 1,
    currentUserRole: "ADMIN",
    currentUserStatus: "ACTIVE",
    members: [
      {
        userId: "u-alex",
        name: "Jordan Doe",
        status: "ACTIVE",
        instantSettlementTag: null,
      },
      {
        userId: "u-elena",
        name: "Elena Rostova",
        status: "ACTIVE",
        instantSettlementTag: null,
      },
    ],
  },
];

const SAMPLE_EXPENSES: ExpenseLedgerRecord[] = [
  {
    id: "exp-1",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-elena",
    paidBy: "u-elena",
    payerName: "Elena Rostova",
    description: "Monthly Rent",
    category: "Rent & Housing",
    expenseDate: "2026-11-05T12:00:00.000Z",
    amountCents: 160_000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 80_000 },
      { user_id: "u-elena", share_cents: 80_000 },
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
  window.localStorage.clear();
});

beforeEach(() => {
  mockPathname = "/settings";
  mockSearchParams = new URLSearchParams("group=grp-apt4b&cycle=2026-11");
  replaceMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
});

describe("Settings (/settings) v2 Core Cards UI", () => {
  it("renders v2 core cards and completely removes 500 MB quota ring, Simplify toggle, and SMS/phone-verify UI", () => {
    render(
      <AppShell groups={SHELL_GROUPS} user={SHELL_USER} initialGroupId="grp-apt4b">
        <SettingsClient
          initialProfile={INITIAL_PROFILE}
          groupCount={4}
          balances={[]}
        />
      </AppShell>,
    );

    // Core v2 cards present
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Profile & Identity" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Display Currency & Personal Budget",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Notifications" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Data & Account" }),
    ).toBeInTheDocument();

    // 4 v2 notification switches + auto-include switch
    expect(
      screen.getByRole("switch", { name: /Auto-include me in new expenses/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("switch", { name: /New expense added/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("switch", { name: /Settlement recorded/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("switch", { name: /Cycle close reminder/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("switch", { name: /Monthly summary digest/i }),
    ).toHaveAttribute("aria-checked", "false");

    // Removed v1 UI surfaces MUST be completely absent
    expect(screen.queryByTestId("storage-quota-card")).not.toBeInTheDocument();
    expect(screen.queryByText(/500 MB/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /Simplify Group Debts/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /Allow SMS settlement nudges/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Verify Phone/i }),
    ).not.toBeInTheDocument();
  });

  it("discards unsaved edits back to last saved snapshot", async () => {
    const user = userEvent.setup();
    render(
      <AppShell groups={SHELL_GROUPS} user={SHELL_USER} initialGroupId="grp-apt4b">
        <SettingsClient
          initialProfile={INITIAL_PROFILE}
          groupCount={4}
          balances={[]}
        />
      </AppShell>,
    );

    const discardBtn = screen.getByRole("button", { name: "Discard Changes" });
    expect(discardBtn).toBeDisabled();

    const nameInput = screen.getByLabelText(/Full Name/i) as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, "Temporary Name");
    expect(nameInput.value).toBe("Temporary Name");

    const digestSwitch = screen.getByRole("switch", {
      name: /Monthly summary digest/i,
    });
    await user.click(digestSwitch);
    expect(digestSwitch).toHaveAttribute("aria-checked", "true");
    expect(discardBtn).toBeEnabled();

    await user.click(discardBtn);

    expect(nameInput.value).toBe("Jordan Doe");
    expect(digestSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Changes discarded/i)).toBeInTheDocument();
  });

  it(
    "saves all v2 settings fields and syncs personalShareCapCents & autoIncludeInExpenses to consumers",
    { timeout: 20000 },
    async () => {
      const user = userEvent.setup();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          profile: {
            ...INITIAL_PROFILE,
            fullName: "Jordan M. Doe",
            phoneNumber: "+1 (415) 555-0199",
            timezone: "America/New_York",
            displayCurrency: "EUR",
            personalShareCapCents: 200_000,
            autoIncludeInExpenses: false,
            notificationPrefs: {
              new_expense_added: true,
              settlement_recorded: false,
              cycle_close_reminder: true,
              monthly_summary_digest: true,
            },
          },
        }),
      } as Response);

      function HarnessWrapper() {
        const [showExpenses, setShowExpenses] = React.useState(false);
        return (
          <AppShell groups={SHELL_GROUPS} user={SHELL_USER} initialGroupId="grp-apt4b">
            <button type="button" onClick={() => setShowExpenses(true)}>
              Switch To Consumers
            </button>
            {showExpenses ? (
              <ExpensesClient
                currentUserId="u-alex"
                userBaseCurrency="USD"
                personalShareCapCents={null}
                initialGroups={EXPENSE_GROUPS}
                initialExpenses={SAMPLE_EXPENSES}
                initialSettlements={[]}
                initialBillingCycles={[]}
              />
            ) : (
              <SettingsClient
                initialProfile={INITIAL_PROFILE}
                groupCount={1}
                balances={[]}
              />
            )}
          </AppShell>
        );
      }

      render(<HarnessWrapper />);

      const nameInput = screen.getByLabelText(/Full Name/i);
      await user.clear(nameInput);
      await user.type(nameInput, "Jordan M. Doe");

      const phoneInput = screen.getByLabelText(/Phone Number/i);
      await user.clear(phoneInput);
      await user.type(phoneInput, "+1 (415) 555-0199");

      const capInput = screen.getByLabelText(/Personal Monthly Share Cap/i);
      await user.clear(capInput);
      await user.type(capInput, "2000.00");

      await user.click(
        screen.getByRole("switch", { name: /Auto-include me in new expenses/i }),
      );
      await user.click(
        screen.getByRole("switch", { name: /Settlement recorded/i }),
      );
      await user.click(
        screen.getByRole("switch", { name: /Monthly summary digest/i }),
      );

      await user.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      const [, init] = fetchSpy.mock.calls[0];
      const sentBody = JSON.parse(String(init?.body));
      expect(sentBody).toMatchObject({
        full_name: "Jordan M. Doe",
        phone_number: "+1 (415) 555-0199",
        timezone: "America/Los_Angeles",
        display_currency: "USD",
        personal_share_cap_cents: 200_000,
        auto_include_in_expenses: false,
        notification_prefs: {
          new_expense_added: true,
          settlement_recorded: false,
          cycle_close_reminder: true,
          monthly_summary_digest: true,
        },
      });
      expect(screen.getByText("Settings saved")).toBeInTheDocument();

      // Switch to Expenses consumer view -> Personal Share Cap ($2,000.00, 40.0% of $800.00)
      await user.click(
        screen.getByRole("button", { name: "Switch To Consumers" }),
      );
      const personalShareCard = screen.getByTestId("kpi-personal-share");
      expect(personalShareCard).toHaveTextContent("$800.00");
      expect(personalShareCard).toHaveTextContent("40.0%");
    },
  );

  it("blocks Delete Account inside Data & Account when a non-zero group balance exists", async () => {
    const user = userEvent.setup();
    render(
      <AppShell groups={SHELL_GROUPS} user={SHELL_USER} initialGroupId="grp-apt4b">
        <SettingsClient
          initialProfile={INITIAL_PROFILE}
          groupCount={1}
          balances={[
            {
              groupId: "grp-apt4b",
              groupName: "Apt 4B Roommates",
              groupStatus: "ACTIVE",
              baseCurrency: "USD",
              memberStatus: "ACTIVE",
              role: "ADMIN",
              netBalanceCents: -4500,
              formattedBalance: "-$45.00",
            },
          ]}
        />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    const dialog = screen.getByRole("dialog", {
      name: "Delete LedgerSplit Account?",
    });
    expect(within(dialog).getByText("Action Blocked")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Delete Account" }),
    ).toBeDisabled();
  });
});
