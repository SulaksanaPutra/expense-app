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
import {
  ExpensesClient,
  RecordSettlementModal,
} from "@/components/expenses";
import type {
  ExpenseGroupInfo,
  ExpenseLedgerRecord,
  SimplifiedDebtEdge,
} from "@/lib/expenses/ledger";

const DEBTS: SimplifiedDebtEdge[] = [
  {
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    currency: "USD",
    payerId: "u-marcus",
    payerName: "Marcus Vance",
    recipientId: "u-alex",
    recipientName: "Alex Rivera",
    recipientInstantTag: "alex-rivera-99",
    amountCents: 12000,
  },
  {
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    currency: "USD",
    payerId: "u-elena",
    payerName: "Elena Rostova",
    recipientId: "u-alex",
    recipientName: "Alex Rivera",
    recipientInstantTag: "@alex-rivera-99",
    amountCents: 4500,
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

describe("RecordSettlementModal & ExpensesClient FORMER_MEMBER settlement UI", () => {
  it(
    "pre-fills full owed balance, generates Venmo Log & Link deep link with @instant_settlement_tag, and submits partial settlement",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();
      const onSettled = vi.fn();
      const onClose = vi.fn();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          settlement: {
            id: "set-1",
            group_id: "grp-apt4b",
            payer_id: "u-marcus",
            recipient_id: "u-alex",
            amount_cents: 5000,
            currency: "USD",
            payment_rail: "VENMO",
            settled_at: "2026-11-27T12:00:00.000Z",
          },
        }),
      } as Response);

      render(
        <RecordSettlementModal
          open={true}
          onClose={onClose}
          debts={DEBTS}
          currentUserId="u-marcus"
          onSettled={onSettled}
        />,
      );

      const dialog = screen.getByRole("dialog", { name: "Record Settlement" });
      const amountInput = within(dialog).getByLabelText(
        /Settlement Amount \(USD\)/i,
      ) as HTMLInputElement;

      // Full owed balance pre-filled
      expect(amountInput.value).toBe("120.00");
      expect(
        within(dialog).getByTestId("recipient-settlement-tag"),
      ).toHaveTextContent("@alex-rivera-99");
      expect(
        within(dialog).getByTestId("settlement-progress-hint"),
      ).toHaveTextContent(/Full settlement: clears this balance to \$0\.00/i);

      const venmoLink = within(dialog).getByRole("link", {
        name: /Open Venmo/i,
      });
      expect(venmoLink).toHaveAttribute(
        "href",
        expect.stringContaining(
          "venmo://paycharge?txn=pay&recipients=alex-rivera-99&amount=120.00",
        ),
      );

      // Edit to partial amount ($50.00)
      await user.clear(amountInput);
      await user.type(amountInput, "50.00");

      expect(
        within(dialog).getByTestId("settlement-progress-hint"),
      ).toHaveTextContent(/Partial payment: \$70\.00 will remain unsettled/i);
      expect(
        within(dialog).getByRole("link", { name: /Open Venmo/i }),
      ).toHaveAttribute(
        "href",
        expect.stringContaining(
          "venmo://paycharge?txn=pay&recipients=alex-rivera-99&amount=50.00",
        ),
      );

      // Zero amount blocks submission
      await user.clear(amountInput);
      await user.type(amountInput, "0");
      expect(
        within(dialog).getByRole("button", { name: /Mark as Settled/i }),
      ).toBeDisabled();

      // Restore partial amount and submit
      await user.clear(amountInput);
      await user.type(amountInput, "50.00");
      const submitBtn = within(dialog).getByRole("button", {
        name: /Mark as Settled/i,
      });
      expect(submitBtn).toBeEnabled();
      await user.click(submitBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          "/api/groups/grp-apt4b/settlements",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              payer_id: "u-marcus",
              recipient_id: "u-alex",
              amount_cents: 5000,
              payment_rail: "VENMO",
            }),
          }),
        );
      });

      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it(
    "allows FORMER_MEMBER on /expenses to record partial settlement, updates KPI & watermark-locks expense, while blocking AddEditExpenseModal",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();

      const shellGroups: ShellGroupSummary[] = [
        {
          id: "grp-apt4b",
          name: "Apt 4B Roommates",
          slug: "apt-4b",
          groupType: "RESIDENTIAL",
          status: "ACTIVE",
          baseCurrency: "USD",
          defaultSplitMode: "EQUAL",
          currentUserStatus: "FORMER_MEMBER",
          activeSplitCount: 1,
          members: [
            { id: "u-alex", name: "Alex Rivera", sharePercentage: 50 },
            { id: "u-elena", name: "Elena Rostova", sharePercentage: 50 },
          ],
        },
      ];

      const expenseGroups: ExpenseGroupInfo[] = [
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
          currentUserStatus: "FORMER_MEMBER",
          members: [
            {
              userId: "u-alex",
              name: "Alex Rivera",
              status: "ACTIVE",
              instantSettlementTag: "@alex-rivera-99",
            },
            {
              userId: "u-elena",
              name: "Elena Rostova",
              status: "ACTIVE",
              instantSettlementTag: "@elena-r",
            },
            {
              userId: "u-marcus",
              name: "Marcus Vance",
              status: "FORMER_MEMBER",
              instantSettlementTag: null,
            },
          ],
        },
      ];

      const expenses: ExpenseLedgerRecord[] = [
        {
          id: "exp-1",
          groupId: "grp-apt4b",
          groupName: "Apt 4B Roommates",
          groupBaseCurrency: "USD",
          groupBillingAnchorDay: 1,
          createdBy: "u-alex",
          paidBy: "u-alex",
          payerName: "Alex Rivera",
          description: "November Rent & Internet",
          category: "Rent & Housing",
          expenseDate: "2026-11-05T12:00:00.000Z",
          amountCents: 30000,
          currency: "USD",
          originalAmountCents: null,
          originalCurrency: null,
          exchangeRate: null,
          exchangeRateSource: null,
          splitMethod: "EQUAL",
          splitBreakdown: [
            { user_id: "u-alex", share_cents: 10000 },
            { user_id: "u-elena", share_cents: 10000 },
            { user_id: "u-marcus", share_cents: 10000 },
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

      const shellUser: ShellUserSummary = {
        id: "u-marcus",
        fullName: "Marcus Vance",
        email: "marcus@example.com",
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          settlement: {
            id: "set-former-1",
            group_id: "grp-apt4b",
            payer_id: "u-marcus",
            recipient_id: "u-alex",
            amount_cents: 4000,
            currency: "USD",
            payment_rail: "VENMO",
            settled_at: "2026-11-27T12:00:00.000Z",
          },
        }),
      } as Response);

      render(
        <AppShell groups={shellGroups} user={shellUser} initialCycle="2026-11">
          <ExpensesClient
            currentUserId="u-marcus"
            userBaseCurrency="USD"
            personalShareCapCents={null}
            initialGroups={expenseGroups}
            initialExpenses={expenses}
            initialSettlements={[]}
            initialBillingCycles={[]}
            initialRecurringRules={[]}
          />
        </AppShell>,
      );

      // Former member banner is visible
      expect(screen.getByText("Former Member Access")).toBeInTheDocument();

      // Add Expense modal blocks FORMER_MEMBER from logging expenses
      await user.click(screen.getByRole("button", { name: "Add Expense" }));
      const addDialog = screen.getByRole("dialog", { name: /Add Expense/i });
      expect(
        within(addDialog).getByText("Former members cannot log expenses"),
      ).toBeInTheDocument();
      expect(
        within(addDialog).getByRole("button", { name: /Save Expense/i }),
      ).toBeDisabled();
      await user.click(within(addDialog).getByRole("button", { name: "Cancel" }));

      // Open RecordSettlementModal via Settle now
      const unsettledCard = screen.getByTestId("kpi-unsettled-pending");
      expect(within(unsettledCard).getByText("$100.00")).toBeInTheDocument();
      await user.click(
        within(unsettledCard).getByRole("button", { name: /Settle now/i }),
      );

      const settleDialog = screen.getByRole("dialog", {
        name: "Record Settlement",
      });

      // Only Marcus's self-involved pair is listed (Elena -> Alex is excluded for FORMER_MEMBER)
      await user.click(
        within(settleDialog).getByRole("button", { name: /Settlement Pair/i }),
      );
      const pairOptions = within(settleDialog).getAllByRole("option");
      expect(pairOptions).toHaveLength(1);
      expect(pairOptions[0]).toHaveTextContent(/You → Alex Rivera \(\$100\.00\)/i);
      await user.click(pairOptions[0]);

      const amountInput = within(settleDialog).getByLabelText(
        /Settlement Amount \(USD\)/i,
      ) as HTMLInputElement;
      await user.clear(amountInput);
      await user.type(amountInput, "40.00");

      await user.click(
        within(settleDialog).getByRole("button", { name: /Mark as Settled/i }),
      );

      // KPI drops from $100.00 to $60.00 and expense becomes LOCKED by watermark
      await waitFor(() => {
        expect(within(unsettledCard).getByText("$60.00")).toBeInTheDocument();
      });
      expect(screen.getByText("LOCKED")).toBeInTheDocument();
    },
  );
});
