// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
    refresh: refreshMock,
    prefetch: vi.fn(),
  }),
  usePathname: () => "/split-groups",
  useSearchParams: () => new URLSearchParams("cycle=2026-11"),
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
import type { ShellUserSummary } from "@/components/shell";
import { SplitGroupsClient } from "@/components/split-groups";
import { toShellGroupSummary } from "@/lib/groups/service";
import type {
  SplitGroupDetail,
  SplitGroupsPageData,
} from "@/lib/groups/types";

const CURRENT_USER: ShellUserSummary = {
  id: "usr-1",
  fullName: "Jordan Doe",
  email: "jordan@example.com",
};

const GROUPS_FIXTURE: SplitGroupDetail[] = [
  {
    id: "grp-apt-4b",
    name: "Apartment 4B Shared",
    slug: "apt-4b-8x9k",
    groupType: "RESIDENTIAL",
    category: "HOME",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: 400000,
    billingCycleAnchorDay: 1,
    cycleResetDay: 1,
    autoSettleOnReset: true,
    allowAnyMemberAddExpense: true,
    requireReceiptOver100: false,
    sendCycleCloseReminders: true,
    leaseEndDate: null,
    inviteToken: "signed-tok-v1",
    inviteTokenVersion: 1,
    cycleTurnoverCents: 283770,
    cycleTransactionCount: 4,
    userNetLedgerCents: 58000,
    recurringRuleCount: 0,
    isFullySettled: false,
    currentUserRole: "ADMIN",
    members: [
      {
        userId: "usr-1",
        name: "Jordan Doe",
        email: "jordan@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        sharePercentage: 50,
        shareUnits: 1,
        paidThisPeriodCents: 200000,
        netBalanceCents: 58000,
        isCurrentUser: true,
      },
      {
        userId: "usr-2",
        name: "Marcus Kim",
        email: "marcus@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 50,
        shareUnits: 1,
        paidThisPeriodCents: 83770,
        netBalanceCents: -58000,
        isCurrentUser: false,
      },
    ],
  },
  {
    id: "grp-lunch",
    name: "Friday Lunch Club",
    slug: "friday-lunch",
    groupType: "RECURRING",
    category: "DINING",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: null,
    billingCycleAnchorDay: 1,
    cycleResetDay: 1,
    autoSettleOnReset: true,
    allowAnyMemberAddExpense: true,
    requireReceiptOver100: false,
    sendCycleCloseReminders: true,
    leaseEndDate: null,
    inviteToken: "lunch-tok-v1",
    inviteTokenVersion: 1,
    cycleTurnoverCents: 34000,
    cycleTransactionCount: 2,
    userNetLedgerCents: 0,
    recurringRuleCount: 0,
    isFullySettled: true,
    currentUserRole: "MEMBER",
    members: [
      {
        userId: "usr-1",
        name: "Jordan Doe",
        email: "jordan@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 50,
        shareUnits: 1,
        paidThisPeriodCents: 17000,
        netBalanceCents: 0,
        isCurrentUser: true,
      },
      {
        userId: "usr-3",
        name: "Alex Lee",
        email: "alex@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        sharePercentage: 50,
        shareUnits: 1,
        paidThisPeriodCents: 17000,
        netBalanceCents: 0,
        isCurrentUser: false,
      },
    ],
  },
];

function renderSplitGroups(groups: SplitGroupDetail[] = GROUPS_FIXTURE) {
  const pageData: SplitGroupsPageData = {
    activeGroups: groups,
    archivedGroups: [],
    cycleSlug: "2026-11",
    loadError: null,
  };
  return render(
    <AppShell groups={groups.map(toShellGroupSummary)} user={CURRENT_USER}>
      <SplitGroupsClient initialData={pageData} defaultCurrency="USD" />
    </AppShell>,
  );
}

beforeEach(() => {
  replaceMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("Issue #110 — Split Rules & Invite Tab UI", () => {
  it("validates 100% total in Percentage mode and saves Shares, policies, and currency for ADMIN", async () => {
    const user = userEvent.setup({ delay: null });

    const updatedGroup: SplitGroupDetail = {
      ...GROUPS_FIXTURE[0],
      baseCurrency: "EUR",
      defaultSplitMode: "SHARES",
      cycleResetDay: 15,
      autoSettleOnReset: false,
      allowAnyMemberAddExpense: false,
      requireReceiptOver100: true,
      sendCycleCloseReminders: false,
      members: [
        { ...GROUPS_FIXTURE[0].members[0], sharePercentage: 75, shareUnits: 3 },
        { ...GROUPS_FIXTURE[0].members[1], sharePercentage: 25, shareUnits: 1 },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          group: updatedGroup,
          shellGroup: toShellGroupSummary(updatedGroup),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    renderSplitGroups();

    const spotlight = screen.getByTestId("spotlight-partition");
    await user.click(
      within(spotlight).getByRole("tab", { name: "Split Rules & Invite" }),
    );

    // 1. Switch to Percentage (%) and test 100% validation
    await user.click(
      within(spotlight).getByRole("radio", { name: "Percentage (%)" }),
    );
    const jordanPct = within(spotlight).getByLabelText(
      "Jordan Doe split percentage",
    );
    await user.clear(jordanPct);
    await user.type(jordanPct, "70");

    await user.click(
      within(spotlight).getByRole("button", { name: "Save Rules" }),
    );
    expect(
      within(spotlight).getByText(/must sum to 100\.00%/i),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    // 2. Switch to Shares and set 3x / 1x
    await user.click(within(spotlight).getByRole("radio", { name: "Shares" }));
    const jordanShares = within(spotlight).getByLabelText(
      "Jordan Doe split shares",
    );
    await user.clear(jordanShares);
    await user.type(jordanShares, "3");

    // 3. Toggle Automation & Policies switches
    await user.click(
      within(spotlight).getByRole("switch", {
        name: "Allow any member to add expenses",
      }),
    );
    await user.click(
      within(spotlight).getByRole("switch", {
        name: "Require receipt for expenses over $100",
      }),
    );

    await user.click(
      within(spotlight).getByRole("button", { name: "Save Rules" }),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/groups/grp-apt-4b",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string,
    );
    expect(body.default_split_mode).toBe("SHARES");
    expect(body.allow_any_member_add_expense).toBe(false);
    expect(body.require_receipt_over_100).toBe(true);
    expect(body.allocations).toEqual([
      { user_id: "usr-1", share_units: 3, share_percentage: 75 },
      { user_id: "usr-2", share_units: 1, share_percentage: 25 },
    ]);
  });

  it("allows ADMIN to send Email Invites and enforces MEMBER view-only gates", async () => {
    const user = userEvent.setup({ delay: null });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          invite: {
            id: "inv-1",
            groupId: "grp-apt-4b",
            invitedEmail: "alex.lee@example.com",
            status: "PENDING",
            expiresAt: "2026-12-13T00:00:00.000Z",
            createdAt: "2026-11-29T00:00:00.000Z",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    renderSplitGroups();

    const spotlight = screen.getByTestId("spotlight-partition");
    await user.click(
      within(spotlight).getByRole("tab", { name: "Split Rules & Invite" }),
    );

    const emailInput = within(spotlight).getByLabelText("Invite by email");
    await user.type(emailInput, "alex.lee@example.com");
    await user.click(
      within(spotlight).getByRole("button", { name: "Send Invite" }),
    );

    expect(fetchSpy).toHaveBeenCalledWith("/api/groups/grp-apt-4b/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alex.lee@example.com" }),
    });
    expect(
      within(spotlight).getByText(
        /Invitation sent to alex\.lee@example\.com \(14-day expiry\)/i,
      ),
    ).toBeInTheDocument();

    // Switch to Friday Lunch Club where current user is MEMBER
    await user.click(screen.getByTestId("group-card-grp-lunch"));
    expect(
      within(spotlight).queryByRole("button", { name: "Save Rules" }),
    ).not.toBeInTheDocument();
    expect(
      within(spotlight).getByLabelText("Invite by email"),
    ).toBeDisabled();
    expect(
      within(spotlight).getByRole("button", { name: "Send Invite" }),
    ).toBeDisabled();
    expect(
      within(spotlight).queryByRole("button", { name: /Remove/i }),
    ).not.toBeInTheDocument();
  });
});
