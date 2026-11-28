// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const pushMock = vi.fn();
const refreshMock = vi.fn();
let mockPathname = "/dashboard";
let mockSearchParams = new URLSearchParams("cycle=2026-11&group=grp-apt-4b");

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
import { DashboardClient } from "@/components/dashboard/DashboardClient";

const THREE_MEMBER_GROUPS: ShellGroupSummary[] = [
  {
    id: "grp-apt-4b",
    name: "Apartment 4B Shared",
    slug: "apt-4b",
    groupType: "RESIDENTIAL",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    allowAnyMemberAddExpense: true,
    requireReceiptOver100: false,
    currentUserRole: "ADMIN",
    currentUserStatus: "ACTIVE",
    activeSplitCount: 2,
    members: [
      { id: "usr-alex", name: "Alex Rivera", sharePercentage: 33.34, shareUnits: 1 },
      { id: "usr-elena", name: "Elena Rostova", sharePercentage: 33.33, shareUnits: 1 },
      { id: "usr-marcus", name: "Marcus Vance", sharePercentage: 33.33, shareUnits: 1 },
    ],
  },
  {
    id: "grp-cabin",
    name: "Weekend Cabin Crew",
    slug: "weekend-cabin",
    groupType: "TRIP",
    status: "ACTIVE",
    baseCurrency: "EUR",
    defaultSplitMode: "SHARES",
    allowAnyMemberAddExpense: true,
    requireReceiptOver100: true,
    currentUserRole: "MEMBER",
    currentUserStatus: "ACTIVE",
    activeSplitCount: 0,
    members: [
      { id: "usr-alex", name: "Alex Rivera", sharePercentage: 33.34, shareUnits: 1 },
      { id: "usr-elena", name: "Elena Rostova", sharePercentage: 66.66, shareUnits: 2 },
    ],
  },
  {
    id: "grp-restricted",
    name: "Admin Only Ledger",
    slug: "admin-only",
    groupType: "RESIDENTIAL",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    allowAnyMemberAddExpense: false,
    requireReceiptOver100: false,
    currentUserRole: "MEMBER",
    currentUserStatus: "ACTIVE",
    activeSplitCount: 0,
    members: [
      { id: "usr-alex", name: "Alex Rivera", sharePercentage: 50, shareUnits: 1 },
      { id: "usr-elena", name: "Elena Rostova", sharePercentage: 50, shareUnits: 1 },
    ],
  },
];

const CURRENT_USER: ShellUserSummary = {
  id: "usr-alex",
  fullName: "Alex Rivera",
  email: "alex@example.com",
  autoIncludeInExpenses: true,
};

beforeEach(() => {
  mockPathname = "/dashboard";
  mockSearchParams = new URLSearchParams("cycle=2026-11&group=grp-apt-4b");
  replaceMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("AddEditExpenseModal v2 — SHARES, Group Policies & Clean Removal", () => {
  it("opens from TopBar, computes 3-way Equal & Shares splits with deterministic penny rounding, and omits FX override & 500 MB quota UI", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          expense: {
            id: "exp-100",
            group_id: "grp-apt-4b",
            description: "Whole Foods Market",
            amount_cents: 10000,
            currency: "USD",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <AppShell groups={THREE_MEMBER_GROUPS} user={CURRENT_USER}>
        <DashboardClient initialExpenses={[]} currentUserId="usr-alex" />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Add Expense" }));

    const dialog = screen.getByRole("dialog", { name: "Add Expense" });

    // Confirm FX override and 500 MB quota UI are completely absent
    expect(within(dialog).queryByLabelText(/Currency/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("fx-conversion-box")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/500 MB/i)).not.toBeInTheDocument();

    // Confirm v2 Split Method options: Equal | Percentage | Exact | Shares
    expect(within(dialog).getByRole("tab", { name: "Equal" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Percentage" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Exact" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Shares" })).toBeInTheDocument();

    const submitBtn = within(dialog).getByRole("button", {
      name: /Add Expense/i,
    });
    expect(submitBtn).toBeDisabled();

    // Enter $100.00 -> 3-way Equal assigns $33.34 to payer Alex and $33.33 to Elena & Marcus
    await user.type(within(dialog).getByLabelText(/Amount/i), "100.00");
    expect(within(dialog).getByTestId("split-share-usr-alex")).toHaveTextContent(
      "$33.34 (33.34%)",
    );
    expect(within(dialog).getByTestId("split-share-usr-elena")).toHaveTextContent(
      "$33.33 (33.33%)",
    );
    expect(within(dialog).getByTestId("split-share-usr-marcus")).toHaveTextContent(
      "$33.33 (33.33%)",
    );

    // Switch to Shares tab and set weights 1 : 2 : 3 (total 6 -> 1667 / 3333 / 5000 with payer Alex getting residual cent)
    await user.click(within(dialog).getByRole("tab", { name: "Shares" }));
    const elenaShares = within(dialog).getByLabelText("Elena Rostova shares");
    const marcusShares = within(dialog).getByLabelText("Marcus Vance shares");
    await user.clear(elenaShares);
    await user.type(elenaShares, "2");
    await user.clear(marcusShares);
    await user.type(marcusShares, "3");

    expect(within(dialog).getByTestId("split-share-usr-alex")).toHaveTextContent(
      "$16.67 (16.67%)",
    );
    expect(within(dialog).getByTestId("split-share-usr-elena")).toHaveTextContent(
      "$33.33 (33.33%)",
    );
    expect(within(dialog).getByTestId("split-share-usr-marcus")).toHaveTextContent(
      "$50.00 (50%)",
    );

    // Enter Merchant / Description -> submit becomes enabled
    await user.type(
      within(dialog).getByLabelText(/Merchant \/ Description/i),
      "Whole Foods Market",
    );
    expect(submitBtn).toBeEnabled();
    expect(submitBtn).toHaveTextContent("Add Expense ($100.00)");

    await user.click(submitBtn);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/groups/grp-apt-4b/expenses");
    const sentBody = JSON.parse(String(init?.body));
    expect(sentBody.amount_cents).toBe(10000);
    expect(sentBody.split_method).toBe("SHARES");
    expect(sentBody.original_amount_cents).toBeUndefined();
    expect(sentBody.exchange_rate).toBeUndefined();
    expect(sentBody.split_breakdown).toEqual([
      { user_id: "usr-alex", share_cents: 1667, shares: 1, percentage: 16.67 },
      { user_id: "usr-elena", share_cents: 3333, shares: 2, percentage: 33.33 },
      { user_id: "usr-marcus", share_cents: 5000, shares: 3, percentage: 50 },
    ]);
  });

  it("disables submit on Percentage / Exact mismatch and enables once balanced", async () => {
    const user = userEvent.setup();

    render(
      <AppShell groups={THREE_MEMBER_GROUPS} user={CURRENT_USER}>
        <div>Workspace</div>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Add Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Add Expense" });

    await user.type(within(dialog).getByLabelText(/Amount/i), "120.00");
    await user.type(
      within(dialog).getByLabelText(/Merchant \/ Description/i),
      "Utilities Bill",
    );

    const submitBtn = within(dialog).getByRole("button", {
      name: /Add Expense/i,
    });
    expect(submitBtn).toBeEnabled();

    // Switch to Exact
    await user.click(within(dialog).getByRole("tab", { name: "Exact" }));
    const alexExact = within(dialog).getByLabelText("Alex Rivera exact amount");
    await user.clear(alexExact);
    await user.type(alexExact, "50.00");

    expect(submitBtn).toBeDisabled();
    expect(within(dialog).getByTestId("split-balance-bar")).toHaveTextContent(
      "Over by $10.00",
    );

    const elenaExact = within(dialog).getByLabelText("Elena Rostova exact amount");
    await user.clear(elenaExact);
    await user.type(elenaExact, "30.00");
    expect(within(dialog).getByTestId("split-balance-bar")).toHaveTextContent(
      "Fully Balanced",
    );
    expect(submitBtn).toBeEnabled();

    // Switch to Percentage and make total != 100%
    await user.click(within(dialog).getByRole("tab", { name: "Percentage" }));
    const alexPct = within(dialog).getByLabelText("Alex Rivera percentage");
    await user.clear(alexPct);
    await user.type(alexPct, "50");
    expect(submitBtn).toBeDisabled();
    expect(within(dialog).getByTestId("split-balance-bar")).toHaveTextContent(
      "116.66% of 100.00%",
    );
  });

  it("respects User.auto_include_in_expenses = false on initial load and when switching groups", async () => {
    const user = userEvent.setup();

    render(
      <AppShell
        groups={THREE_MEMBER_GROUPS}
        user={{ ...CURRENT_USER, autoIncludeInExpenses: false }}
      >
        <div>Workspace</div>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Add Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Add Expense" });

    // Alex (current user) is pre-unchecked; Elena and Marcus are checked
    const alexCheckbox = within(dialog).getByLabelText(
      "Include Alex Rivera in split",
    ) as HTMLInputElement;
    const elenaCheckbox = within(dialog).getByLabelText(
      "Include Elena Rostova in split",
    ) as HTMLInputElement;
    const marcusCheckbox = within(dialog).getByLabelText(
      "Include Marcus Vance in split",
    ) as HTMLInputElement;

    expect(alexCheckbox.checked).toBe(false);
    expect(elenaCheckbox.checked).toBe(true);
    expect(marcusCheckbox.checked).toBe(true);

    // $100.00 splits 50/50 between Elena and Marcus
    await user.type(within(dialog).getByLabelText(/Amount/i), "100.00");
    expect(within(dialog).getByTestId("split-share-usr-alex")).toHaveTextContent("$0.00");
    expect(within(dialog).getByTestId("split-share-usr-elena")).toHaveTextContent("$50.00 (50%)");
    expect(within(dialog).getByTestId("split-share-usr-marcus")).toHaveTextContent("$50.00 (50%)");

    // Re-checking Alex recalculates 3-way split
    fireEvent.click(alexCheckbox);
    expect(alexCheckbox.checked).toBe(true);
    expect(within(dialog).getByTestId("split-share-usr-alex")).toHaveTextContent("$33.34 (33.34%)");
  });

  it("enforces Group.allow_any_member_add_expense in UI when switching to a restricted group as non-Admin", async () => {
    const user = userEvent.setup();

    render(
      <AppShell groups={THREE_MEMBER_GROUPS} user={CURRENT_USER}>
        <div>Workspace</div>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Add Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Add Expense" });

    await user.type(within(dialog).getByLabelText(/Merchant \/ Description/i), "Supplies");
    await user.type(within(dialog).getByLabelText(/Amount/i), "50.00");

    const submitBtn = within(dialog).getByRole("button", { name: /Add Expense/i });
    expect(submitBtn).toBeEnabled();

    // Switch to Admin Only Ledger where current user is MEMBER
    await user.click(within(dialog).getByRole("button", { name: /Split Group/i }));
    await user.click(within(dialog).getByRole("option", { name: /Admin Only Ledger/i }));

    expect(
      within(dialog).getByText("Only group admins can add expenses"),
    ).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();
  });

  it("enforces Group.require_receipt_over_100 conditionally when amount_cents > 10000 and uploads receipt on submit", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams("cycle=2026-11&group=grp-cabin");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            receiptUrl: "receipts://usr-alex/grp-cabin/1700000000-cabin.png",
            sizeBytes: 2048,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            expense: {
              id: "exp-cabin-1",
              group_id: "grp-cabin",
              description: "Cabin Rental Deposit",
              amount_cents: 15000,
              currency: "EUR",
              receipt_url: "receipts://usr-alex/grp-cabin/1700000000-cabin.png",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );

    render(
      <AppShell groups={THREE_MEMBER_GROUPS} user={CURRENT_USER}>
        <div>Workspace</div>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Add Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Add Expense" });

    // Weekend Cabin Crew defaults to SHARES (1 : 2) and EUR
    expect(within(dialog).getByRole("tab", { name: "Shares" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.type(
      within(dialog).getByLabelText(/Merchant \/ Description/i),
      "Cabin Rental Deposit",
    );
    const amountInput = within(dialog).getByLabelText(/Amount/i);

    // At 100.00 (10000 cents), receipt is NOT required
    await user.type(amountInput, "100.00");
    expect(
      within(dialog).queryByTestId("required-receipt-section"),
    ).not.toBeInTheDocument();
    const submitBtn = within(dialog).getByRole("button", { name: /Add Expense/i });
    expect(submitBtn).toBeEnabled();

    // At 150.00 (15000 cents > 10000), required receipt section appears and blocks submit
    await user.clear(amountInput);
    await user.type(amountInput, "150.00");
    expect(
      within(dialog).getByTestId("required-receipt-section"),
    ).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    // Upload receipt -> submit becomes enabled and sends receipt_url
    const fileInput = within(dialog).getByLabelText("Upload receipt file") as HTMLInputElement;
    await user.upload(
      fileInput,
      new File([new Uint8Array(2048)], "cabin.png", { type: "image/png" }),
    );
    expect(submitBtn).toBeEnabled();

    await user.click(submitBtn);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/receipts");
    expect(fetchSpy.mock.calls[1][0]).toBe("/api/groups/grp-cabin/expenses");
    const sentBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(sentBody.amount_cents).toBe(15000);
    expect(sentBody.split_method).toBe("SHARES");
    expect(sentBody.receipt_url).toBe(
      "receipts://usr-alex/grp-cabin/1700000000-cabin.png",
    );
  });
});
