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

import { AppShell, useActiveGroup } from "@/components/shell";
import type { ShellGroupSummary, ShellUserSummary } from "@/components/shell";
import { SettingsClient } from "@/components/settings";
import {
  ExpensesClient,
  RecordSettlementModal,
} from "@/components/expenses";
import type {
  ExpenseGroupInfo,
  ExpenseLedgerRecord,
  SimplifiedDebtEdge,
} from "@/lib/expenses/ledger";
import type {
  SettingsGroupSummary,
  SettingsUserProfile,
} from "@/lib/settings/service";

const INITIAL_PROFILE: SettingsUserProfile = {
  id: "u-alex",
  fullName: "Alex Rivera",
  email: "alex@example.com",
  avatarUrl: null,
  phoneNumber: "+1 (555) 234-8901",
  phoneVerified: false,
  instantSettlementTag: null,
  baseCurrency: "USD",
  personalShareCapCents: null,
  receiptStorageUsedBytes: 94_371_840, // 90.0 MB -> 18% of 500 MB
  receiptStorageQuotaBytes: 524_288_000,
  notificationPrefs: {
    new_expense: true,
    settlement_confirmation: true,
    monthly_recap: true,
    sms_nudges_opt_in: false,
    auto_settlement_reminders: true,
    default_split_method: "EQUAL",
    payment_methods: [],
  },
  createdAt: "2024-01-15T10:00:00.000Z",
};

const SETTINGS_GROUPS: SettingsGroupSummary[] = [
  {
    id: "grp-apt4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b-roommates",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    currentUserRole: "ADMIN",
  },
  {
    id: "grp-trip",
    name: "Tokyo Trip",
    slug: "tokyo-trip",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    currentUserRole: "MEMBER",
  },
];

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
      { id: "u-alex", name: "Alex Rivera", sharePercentage: 50 },
      { id: "u-elena", name: "Elena Rostova", sharePercentage: 50 },
    ],
  },
  {
    id: "grp-trip",
    name: "Tokyo Trip",
    slug: "tokyo-trip",
    groupType: "TRIP",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    activeSplitCount: 0,
    members: [
      { id: "u-alex", name: "Alex Rivera", sharePercentage: 50 },
      { id: "u-elena", name: "Elena Rostova", sharePercentage: 50 },
    ],
  },
];

const SHELL_USER: ShellUserSummary = {
  id: "u-alex",
  fullName: "Alex Rivera",
  email: "alex@example.com",
  baseCurrency: "USD",
  instantSettlementTag: null,
  personalShareCapCents: null,
  defaultSplitMethod: "EQUAL",
  receiptStorageUsedBytes: 94_371_840,
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
        name: "Alex Rivera",
        status: "ACTIVE",
        instantSettlementTag: null,
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

function ConsumerHarness({
  showExpenses,
}: {
  showExpenses: boolean;
}) {
  const { user } = useActiveGroup();
  const [settleOpen, setSettleOpen] = React.useState(false);

  const sampleDebts: SimplifiedDebtEdge[] = [
    {
      groupId: "grp-apt4b",
      groupName: "Apt 4B Roommates",
      currency: "USD",
      payerId: "u-elena",
      payerName: "Elena Rostova",
      recipientId: "u-alex",
      recipientName: "Alex Rivera",
      recipientInstantTag: user?.instantSettlementTag ?? null,
      amountCents: 80_000,
    },
  ];

  return (
    <>
      {showExpenses ? (
        <div>
          <ExpensesClient
            currentUserId="u-alex"
            userBaseCurrency="USD"
            personalShareCapCents={null}
            initialGroups={EXPENSE_GROUPS}
            initialExpenses={SAMPLE_EXPENSES}
            initialSettlements={[]}
            initialBillingCycles={[]}
            initialRecurringRules={[]}
          />
          <button type="button" onClick={() => setSettleOpen(true)}>
            Open Test Settlement
          </button>
          <RecordSettlementModal
            open={settleOpen}
            onClose={() => setSettleOpen(false)}
            debts={sampleDebts}
            currentUserId="u-elena"
            currentUserInstantTag={user?.instantSettlementTag ?? null}
          />
        </div>
      ) : (
        <SettingsClient
          initialProfile={INITIAL_PROFILE}
          groups={SETTINGS_GROUPS}
          balances={[]}
        />
      )}
    </>
  );
}

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

describe("Settings (/settings) UI & End-to-End Consumer Wiring", () => {
  it(
    "displays accurate 500 MB Storage & Sync Quota ProgressRing, enforces ADMIN & phone-verify gates, and handles Reset to Defaults",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();
      render(
        <AppShell groups={SHELL_GROUPS} user={SHELL_USER} initialGroupId="grp-apt4b">
          <SettingsClient
            initialProfile={INITIAL_PROFILE}
            groups={SETTINGS_GROUPS}
            balances={[]}
          />
        </AppShell>,
      );

      // 90.0 MB of 500 MB -> 18%
      const quotaCard = screen.getByTestId("storage-quota-card");
      expect(quotaCard).toHaveTextContent("90.0 MB");
      expect(quotaCard).toHaveTextContent("500 MB");
      const progress = within(quotaCard).getByRole("progressbar", {
        name: "Storage & Sync Quota",
      });
      expect(progress).toHaveAttribute("aria-valuenow", "94371840");
      expect(progress).toHaveAttribute("aria-valuemax", "524288000");
      expect(quotaCard).toHaveTextContent("18%");

      // ADMIN can toggle Simplify Group Debts for grp-apt4b
      const simplifySwitch = screen.getByRole("switch", {
        name: /Simplify Group Debts/i,
      });
      expect(simplifySwitch).toBeEnabled();
      expect(simplifySwitch).toHaveAttribute("aria-checked", "true");

      // Unverified phone disables Allow SMS settlement nudges
      const smsSwitch = screen.getByRole("switch", {
        name: /Allow SMS settlement nudges/i,
      });
      expect(smsSwitch).toBeDisabled();

      // Edit preferences then Reset to Defaults restores them
      await user.click(screen.getByRole("tab", { name: "Exact Shares" }));
      const capInput = screen.getByLabelText(/Personal Share Cap/i) as HTMLInputElement;
      await user.type(capInput, "1600.00");
      expect(capInput.value).toBe("1600.00");

      await user.click(screen.getByRole("button", { name: /Reset to Defaults/i }));

      expect(capInput.value).toBe("");
      expect(screen.getByRole("tab", { name: "Equal Split" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByText(/Defaults restored/i)).toBeInTheDocument();
    },
  );

  it(
    "disables Simplify Group Debts when current user is a non-ADMIN MEMBER in active group",
    { timeout: 15000 },
    () => {
      mockSearchParams = new URLSearchParams("group=grp-trip&cycle=2026-11");
      render(
        <AppShell groups={SHELL_GROUPS} user={SHELL_USER} initialGroupId="grp-trip">
          <SettingsClient
            initialProfile={INITIAL_PROFILE}
            groups={SETTINGS_GROUPS}
            balances={[]}
          />
        </AppShell>,
      );

      const simplifySwitch = screen.getByRole("switch", {
        name: /Simplify Group Debts \(Tokyo Trip\)/i,
      });
      expect(simplifySwitch).toBeDisabled();
    },
  );

  it(
    "saves Default Split Mode, Personal Share Cap, and @instant_settlement_tag and wires them to AddEditExpenseModal, Expenses, and RecordSettlementModal",
    { timeout: 20000 },
    async () => {
      const user = userEvent.setup();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          profile: {
            ...INITIAL_PROFILE,
            instantSettlementTag: "@alex-rivera-99",
            personalShareCapCents: 160_000,
            notificationPrefs: {
              ...INITIAL_PROFILE.notificationPrefs,
              default_split_method: "PERCENTAGE",
              payment_methods: [
                {
                  id: "pm-venmo-primary",
                  label: "Venmo Settlement Rail",
                  rail: "VENMO",
                  handle: "@alex-rivera-99",
                  is_default: true,
                },
              ],
            },
          },
          updatedGroup: {
            id: "grp-apt4b",
            defaultSplitMode: "CUSTOM_RATIOS",
            simplifyDebts: true,
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
            <ConsumerHarness showExpenses={showExpenses} />
          </AppShell>
        );
      }

      render(<HarnessWrapper />);

      // Fill tag, Default Split Mode = Percentage, Personal Share Cap = 1600.00
      const tagInput = screen.getByLabelText(/Instant Settlement Tag/i);
      await user.clear(tagInput);
      await user.type(tagInput, "alex-rivera-99");

      await user.click(screen.getByRole("tab", { name: "Percentage" }));

      const capInput = screen.getByLabelText(/Personal Share Cap/i);
      await user.clear(capInput);
      await user.type(capInput, "1600.00");

      await user.click(screen.getByRole("button", { name: /Save Changes/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
      const [, init] = fetchSpy.mock.calls[0];
      const sentBody = JSON.parse(String(init?.body));
      expect(sentBody.instant_settlement_tag).toBe("@alex-rivera-99");
      expect(sentBody.personal_share_cap_cents).toBe(160_000);
      expect(sentBody.notification_prefs.default_split_method).toBe("PERCENTAGE");
      expect(screen.getByText("Settings saved")).toBeInTheDocument();

      // 1. Verify AddEditExpenseModal picks up Default Split Mode = By Percentage
      await user.click(screen.getByRole("button", { name: "Add Expense" }));
      const expenseDialog = screen.getByRole("dialog", { name: "Add Expense" });
      expect(
        within(expenseDialog).getByRole("tab", { name: "By Percentage" }),
      ).toHaveAttribute("aria-selected", "true");
      await user.click(within(expenseDialog).getByRole("button", { name: "Cancel" }));

      // 2. Switch to Expenses consumer view -> Personal Share Cap ($1,600.00, 50.0% of $800.00)
      await user.click(
        screen.getByRole("button", { name: "Switch To Consumers" }),
      );
      const personalShareCard = screen.getByTestId("kpi-personal-share");
      expect(personalShareCard).toHaveTextContent("$800.00");
      expect(personalShareCard).toHaveTextContent(
        "Monthly limit threshold: $1,600.00",
      );
      expect(personalShareCard).toHaveTextContent("50.0%");

      // 3. Open RecordSettlementModal -> displays @alex-rivera-99
      await user.click(
        screen.getByRole("button", { name: "Open Test Settlement" }),
      );
      const settleDialog = screen.getByRole("dialog", {
        name: "Record Settlement",
      });
      expect(
        within(settleDialog).getByTestId("recipient-settlement-tag"),
      ).toHaveTextContent("Recipient handle: @alex-rivera-99");
    },
  );
});
