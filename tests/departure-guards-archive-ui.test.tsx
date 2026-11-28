// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const pushMock = vi.fn();
const refreshMock = vi.fn();
let mockPathname = "/split-groups";
let mockSearchParams = new URLSearchParams("cycle=2026-11");

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

import { AccountDangerZone } from "@/components/settings/AccountDangerZone";
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
  fullName: "Alex Rivera",
  email: "alex@example.com",
};

const ACTIVE_GROUPS_FIXTURE: SplitGroupDetail[] = [
  {
    id: "grp-apt-4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b",
    groupType: "RESIDENTIAL",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: 450000,
    billingCycleAnchorDay: 1,
    leaseEndDate: "2026-11-10",
    tripAutoArchiveEnabled: true,
    tripAutoArchiveDays: 14,
    residentialLeasePromptEnabled: true,
    zeroBalanceSince: null,
    leasePromptSnoozedUntil: null,
    shouldPromptLeaseArchive: true,
    daysSinceLeaseEnd: 16,
    archivedAt: null,
    inviteToken: "token-apt4b",
    cycleTurnoverCents: 20000,
    cycleTransactionCount: 2,
    userNetLedgerCents: 10000,
    recurringRuleCount: 1,
    isFullySettled: false,
    currentUserRole: "ADMIN",
    members: [
      {
        userId: "usr-1",
        name: "Alex Rivera",
        email: "alex@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        sharePercentage: 50,
        paidThisPeriodCents: 20000,
        netBalanceCents: 10000,
        isCurrentUser: true,
      },
      {
        userId: "usr-2",
        name: "Elena Rostova",
        email: "elena@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 50,
        paidThisPeriodCents: 0,
        netBalanceCents: -10000,
        isCurrentUser: false,
      },
    ],
  },
  {
    id: "grp-settled",
    name: "Coffee Club",
    slug: "coffee-club",
    groupType: "RECURRING",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: null,
    billingCycleAnchorDay: 1,
    leaseEndDate: null,
    tripAutoArchiveEnabled: true,
    tripAutoArchiveDays: 14,
    residentialLeasePromptEnabled: false,
    zeroBalanceSince: null,
    leasePromptSnoozedUntil: null,
    shouldPromptLeaseArchive: false,
    daysSinceLeaseEnd: null,
    archivedAt: null,
    inviteToken: "token-coffee",
    cycleTurnoverCents: 0,
    cycleTransactionCount: 0,
    userNetLedgerCents: 0,
    recurringRuleCount: 0,
    isFullySettled: true,
    currentUserRole: "MEMBER",
    members: [
      {
        userId: "usr-1",
        name: "Alex Rivera",
        email: "alex@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 50,
        paidThisPeriodCents: 0,
        netBalanceCents: 0,
        isCurrentUser: true,
      },
      {
        userId: "usr-3",
        name: "Marcus Vance",
        email: "marcus@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        sharePercentage: 50,
        paidThisPeriodCents: 0,
        netBalanceCents: 0,
        isCurrentUser: false,
      },
    ],
  },
];

const ARCHIVED_GROUP_FIXTURE: SplitGroupDetail = {
  id: "grp-italy",
  name: "Summer Italy 2025",
  slug: "summer-italy",
  groupType: "TRIP",
  status: "ARCHIVED",
  baseCurrency: "EUR",
  defaultSplitMode: "EQUAL",
  simplifyDebts: true,
  operationalBudgetCents: null,
  billingCycleAnchorDay: 1,
  leaseEndDate: null,
  tripAutoArchiveEnabled: true,
  tripAutoArchiveDays: 14,
  residentialLeasePromptEnabled: false,
  zeroBalanceSince: "2025-09-01T00:00:00.000Z",
  leasePromptSnoozedUntil: null,
  shouldPromptLeaseArchive: false,
  daysSinceLeaseEnd: null,
  archivedAt: "2025-09-16T00:00:00.000Z",
  inviteToken: "token-italy",
  cycleTurnoverCents: 0,
  cycleTransactionCount: 0,
  userNetLedgerCents: 0,
  recurringRuleCount: 0,
  isFullySettled: true,
  currentUserRole: "ADMIN",
  members: [
    {
      userId: "usr-1",
      name: "Alex Rivera",
      email: "alex@example.com",
      role: "ADMIN",
      status: "ACTIVE",
      sharePercentage: 100,
      paidThisPeriodCents: 0,
      netBalanceCents: 0,
      isCurrentUser: true,
    },
  ],
};

function renderSplitGroups(overrides?: Partial<SplitGroupsPageData>) {
  const pageData: SplitGroupsPageData = {
    activeGroups: ACTIVE_GROUPS_FIXTURE,
    archivedGroups: [ARCHIVED_GROUP_FIXTURE],
    cycleSlug: "2026-11",
    loadError: null,
    ...overrides,
  };
  return render(
    <AppShell
      groups={pageData.activeGroups.map(toShellGroupSummary)}
      user={CURRENT_USER}
    >
      <SplitGroupsClient initialData={pageData} defaultCurrency="USD" />
    </AppShell>,
  );
}

beforeEach(() => {
  mockPathname = "/split-groups";
  mockSearchParams = new URLSearchParams("cycle=2026-11");
  replaceMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("Departure Guards, Archive Rules & Read-Only Archived Ledgers UI", () => {
  it("blocks self-leave via ConfirmDialog with formatted unpaid balance when net_balance_cents != 0 and allows leaving when $0.00", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          groupId: "grp-settled",
          groupName: "Coffee Club",
          groupStatus: "ACTIVE",
          remainingActiveCount: 1,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    renderSplitGroups();

    // 1. In Apt 4B Roommates (userNetLedgerCents = +10000), Leave Group via Split Rules & Invite tab opens blocking ConfirmDialog
    await user.click(screen.getByRole("tab", { name: "Split Rules & Invite" }));
    await user.click(screen.getByRole("button", { name: "Leave Group" }));

    const blockedDialog = screen.getByRole("dialog", {
      name: "Leave Apt 4B Roommates",
    });
    expect(within(blockedDialog).getByText("Action Blocked")).toBeInTheDocument();
    expect(
      within(blockedDialog).getByText(/\$100\.00 \(owed to you\)/i),
    ).toBeInTheDocument();
    expect(
      within(blockedDialog).getByRole("button", { name: "Leave Group" }),
    ).toBeDisabled();

    await user.click(within(blockedDialog).getByRole("button", { name: "Cancel" }));
    expect(fetchSpy).not.toHaveBeenCalled();

    // 2. Switch to Coffee Club ($0.00 balance) -> Leave Group confirm button is enabled
    await user.click(screen.getByTestId("group-card-grp-settled"));
    await user.click(screen.getByRole("button", { name: "Leave Group" }));

    const allowedDialog = screen.getByRole("dialog", {
      name: "Leave Coffee Club",
    });
    const confirmLeaveBtn = within(allowedDialog).getByRole("button", {
      name: "Leave Group",
    });
    expect(confirmLeaveBtn).not.toBeDisabled();
    await user.click(confirmLeaveBtn);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/groups/grp-settled/leave",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      screen.queryByTestId("group-card-grp-settled"),
    ).not.toBeInTheDocument();
  });

  it("blocks Account Deletion on Settings via ConfirmDialog when unpaid balances exist and permits deletion when settled", async () => {
    const user = userEvent.setup();

    render(
      <AccountDangerZone
        balances={[
          {
            groupId: "grp-apt-4b",
            groupName: "Apt 4B Roommates",
            groupStatus: "ACTIVE",
            baseCurrency: "USD",
            memberStatus: "ACTIVE",
            role: "ADMIN",
            netBalanceCents: -8500,
            formattedBalance: "-$85.00",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    const blockedDialog = screen.getByRole("dialog", {
      name: "Delete LedgerSplit Account?",
    });
    expect(within(blockedDialog).getByText("Action Blocked")).toBeInTheDocument();
    expect(
      within(blockedDialog).getByText(/Apt 4B Roommates: \$85\.00 \(you owe\)/i),
    ).toBeInTheDocument();
    expect(
      within(blockedDialog).getByRole("button", { name: "Delete Account" }),
    ).toBeDisabled();

    cleanup();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, deletedUserId: "usr-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <AccountDangerZone
        balances={[
          {
            groupId: "grp-settled",
            groupName: "Coffee Club",
            groupStatus: "ACTIVE",
            baseCurrency: "USD",
            memberStatus: "ACTIVE",
            role: "MEMBER",
            netBalanceCents: 0,
            formattedBalance: "$0.00",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete Account" }));
    const allowedDialog = screen.getByRole("dialog", {
      name: "Delete LedgerSplit Account?",
    });
    const confirmDeleteBtn = within(allowedDialog).getByRole("button", {
      name: "Delete Account",
    });
    expect(confirmDeleteBtn).not.toBeDisabled();
    await user.click(confirmDeleteBtn);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/account",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(pushMock).toHaveBeenCalledWith("/login");
  });

  it("allows ADMIN to remove a member with non-zero balance via ConfirmDialog, transitioning to FORMER_MEMBER", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          groupId: "grp-apt-4b",
          targetUserId: "usr-2",
          transition: "FORMER_MEMBER",
          netBalanceCents: -10000,
          groupStatus: "ACTIVE",
          memberShares: [
            { userId: "usr-1", status: "ACTIVE", sharePercentage: 100 },
            { userId: "usr-2", status: "FORMER_MEMBER", sharePercentage: 0 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    renderSplitGroups();

    const spotlight = screen.getByTestId("spotlight-partition");
    await user.click(
      within(spotlight).getByRole("button", { name: "Remove Elena Rostova" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Remove Elena Rostova?",
    });
    expect(
      within(dialog).getByText(/transitions their membership to FORMER_MEMBER/i),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Mark as Former Member" }),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/groups/grp-apt-4b/members/usr-2",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(within(spotlight).getByText("Former")).toBeInTheDocument();
    expect(
      within(spotlight).getByText("Excluded from new splits"),
    ).toBeInTheDocument();
  });

  it("supports Archive Rules configuration, Residential 7-day lease prompt archival, and collapsible Archived Ledgers read-only inspection", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/archive-rules")) {
          return new Response(
            JSON.stringify({
              ok: true,
              groupId: "grp-apt-4b",
              status: "ARCHIVED",
              tripAutoArchiveEnabled: true,
              tripAutoArchiveDays: 14,
              residentialLeasePromptEnabled: true,
              leaseEndDate: "2026-11-10",
              leasePromptSnoozedUntil: null,
              archivedAt: "2026-11-26T12:00:00.000Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

    renderSplitGroups();

    // 1. Archive Group confirmation opens from card menu showing Current Net Ledger
    await user.click(
      screen.getByRole("button", { name: "Actions for Apt 4B Roommates" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Archive Group" }));
    const archiveConfirm = screen.getByRole("dialog", {
      name: "Archive Apt 4B Roommates?",
    });
    expect(
      within(archiveConfirm).getByText(/Current Net Ledger/i),
    ).toBeInTheDocument();
    await user.click(
      within(archiveConfirm).getByRole("button", { name: "Cancel" }),
    );

    // 2. Switch to Archived tab and inspect Summer Italy 2025 in read-only mode
    await user.click(screen.getByRole("tab", { name: "Archived (1)" }));
    const archivedCard = screen.getByTestId("archived-group-card-grp-italy");
    expect(within(archivedCard).getByText("Summer Italy 2025")).toBeInTheDocument();

    await user.click(
      within(archivedCard).getByRole("button", { name: "Inspect Ledger" }),
    );
    const spotlight = screen.getByTestId("spotlight-partition");
    expect(
      within(spotlight).getByText("Archived Group — Read-Only"),
    ).toBeInTheDocument();
    expect(
      within(spotlight).queryByRole("button", { name: "Log Expense" }),
    ).not.toBeInTheDocument();
    expect(
      within(spotlight).queryByRole("button", { name: "Leave Group" }),
    ).not.toBeInTheDocument();

    // 4. Switch back to Active and archive Apt 4B Roommates via card menu ConfirmDialog
    await user.click(screen.getByRole("tab", { name: "Active (2)" }));
    await user.click(
      screen.getByRole("button", { name: "Actions for Apt 4B Roommates" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Archive Group" }));
    const confirmArchive = screen.getByRole("dialog", {
      name: "Archive Apt 4B Roommates?",
    });
    await user.click(
      within(confirmArchive).getByRole("button", { name: "Archive Group" }),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/groups/grp-apt-4b/archive-rules",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(
      screen.getByRole("tab", { name: "Archived (2)" }),
    ).toBeInTheDocument();
  });
});
