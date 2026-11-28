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

import { AppShell } from "@/components/shell";
import type { ShellUserSummary } from "@/components/shell";
import { SplitGroupsClient } from "@/components/split-groups";
import type { GroupAuditLogEntry } from "@/lib/groups/audit-log";
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

const INITIAL_AUDIT_LOGS: GroupAuditLogEntry[] = [
  {
    id: "audit-1",
    groupId: "grp-apt-4b",
    category: "GOVERNANCE",
    eventType: "MEMBER_JOINED",
    actorId: "usr-3",
    actorName: "Samira Patel",
    summary: "Samira Patel joined in CUSTOM_RATIOS mode (0% initial share; review required)",
    details: [
      "Assigned initial share: 0%",
      "Flagged group status as NEEDS_RATIO_UPDATE",
    ],
    createdAt: "2026-11-20T12:00:00.000Z",
  },
  {
    id: "audit-2",
    groupId: "grp-apt-4b",
    category: "RATIOS",
    eventType: "RATIOS_UPDATED",
    actorId: "usr-1",
    actorName: "Alex Rivera",
    summary: "Updated household split ratios (Custom Ratios)",
    details: [
      "Alex Rivera: 50% -> 60%",
      "Elena Rostova: 50% -> 40%",
      "Existing Expense.split_breakdown snapshots remain untouched.",
    ],
    createdAt: "2026-11-15T10:00:00.000Z",
  },
];

const GROUPS_FIXTURE: SplitGroupDetail[] = [
  {
    id: "grp-apt-4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b",
    groupType: "RESIDENTIAL",
    status: "NEEDS_RATIO_UPDATE",
    baseCurrency: "USD",
    defaultSplitMode: "CUSTOM_RATIOS",
    simplifyDebts: true,
    operationalBudgetCents: 450000,
    billingCycleAnchorDay: 1,
    leaseEndDate: "2027-08-31",
    inviteToken: "signed-token-v1",
    inviteTokenVersion: 1,
    cycleTurnoverCents: 384250,
    cycleTransactionCount: 4,
    userNetLedgerCents: 46250,
    recurringRuleCount: 2,
    isFullySettled: false,
    currentUserRole: "ADMIN",
    auditLogs: INITIAL_AUDIT_LOGS,
    members: [
      {
        userId: "usr-1",
        name: "Alex Rivera",
        email: "alex@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        sharePercentage: 60,
        paidThisPeriodCents: 238375,
        netBalanceCents: 46250,
        isCurrentUser: true,
      },
      {
        userId: "usr-2",
        name: "Elena Rostova",
        email: "elena@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 40,
        paidThisPeriodCents: 145875,
        netBalanceCents: -46250,
        isCurrentUser: false,
      },
      {
        userId: "usr-3",
        name: "Samira Patel",
        email: "samira@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 0,
        paidThisPeriodCents: 0,
        netBalanceCents: 0,
        isCurrentUser: false,
      },
    ],
  },
  {
    id: "grp-tahoe",
    name: "Tahoe Ski Cabin",
    slug: "tahoe-ski",
    groupType: "TRIP",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "CUSTOM_RATIOS",
    simplifyDebts: true,
    operationalBudgetCents: null,
    billingCycleAnchorDay: 1,
    leaseEndDate: null,
    inviteToken: "tahoe-token-v1",
    inviteTokenVersion: 1,
    cycleTurnoverCents: 120000,
    cycleTransactionCount: 2,
    userNetLedgerCents: 0,
    recurringRuleCount: 0,
    isFullySettled: true,
    currentUserRole: "MEMBER",
    auditLogs: [
      {
        id: "audit-tahoe-1",
        groupId: "grp-tahoe",
        category: "GOVERNANCE",
        eventType: "GROUP_CREATED",
        actorId: "usr-4",
        actorName: "Marcus Vance",
        summary: "Created Tahoe Ski Cabin (TRIP) with Marcus Vance as Admin",
        details: ["Base currency: USD"],
        createdAt: "2026-11-01T09:00:00.000Z",
      },
    ],
    members: [
      {
        userId: "usr-1",
        name: "Alex Rivera",
        email: "alex@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 35,
        paidThisPeriodCents: 42000,
        netBalanceCents: 0,
        isCurrentUser: true,
      },
      {
        userId: "usr-4",
        name: "Marcus Vance",
        email: "marcus@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        sharePercentage: 65,
        paidThisPeriodCents: 78000,
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

describe("Spotlight Partition, ADMIN Edit Ratios Modal & Audit Log Drawer", () => {
  it("renders Spotlight Partition with Group Members Paid/Share/Net Position and Who Owes Whom transfers", () => {
    renderSplitGroups();

    const spotlight = screen.getByTestId("spotlight-partition");
    expect(within(spotlight).getByText("GROUP MEMBERS (3)")).toBeInTheDocument();
    expect(within(spotlight).getAllByText("Paid:").length).toBe(3);
    expect(within(spotlight).getAllByText("Share:").length).toBe(3);
    expect(within(spotlight).getAllByText("Net Position").length).toBe(3);
    expect(within(spotlight).getByText("+$462.50")).toBeInTheDocument();
    expect(within(spotlight).getByText("-$462.50")).toBeInTheDocument();
    expect(within(spotlight).getByText("Settled")).toBeInTheDocument();
    expect(within(spotlight).getByText("WHO OWES WHOM")).toBeInTheDocument();
    expect(within(spotlight).getByText("1 transfer to zero balances")).toBeInTheDocument();
  });

  it("enforces view-only ratio display for MEMBER role and prevents saving changes", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    renderSplitGroups();

    // Switch to Tahoe Ski Cabin where current user is MEMBER
    await user.click(screen.getByTestId("group-card-grp-tahoe"));

    const spotlight = screen.getByTestId("spotlight-partition");
    expect(within(spotlight).getByText("View-only")).toBeInTheDocument();
    await user.click(
      within(spotlight).getByRole("tab", { name: "Split Rules & Invite" }),
    );
    expect(
      within(spotlight).queryByRole("button", { name: "Edit Ratios" }),
    ).not.toBeInTheDocument();

    // Save Rules CTA is hidden for MEMBER role and inline controls are disabled
    expect(
      within(spotlight).queryByRole("button", { name: "Save Rules" }),
    ).not.toBeInTheDocument();

    expect(
      within(spotlight).getByLabelText("Alex Rivera split percentage"),
    ).toBeDisabled();
    expect(
      within(spotlight).getByLabelText("Marcus Vance split percentage"),
    ).toBeDisabled();
    expect(
      within(spotlight).getByRole("radio", { name: "Equal" }),
    ).toBeDisabled();
    expect(
      within(spotlight).getByRole("radio", { name: "Custom" }),
    ).toBeDisabled();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects totals != 100% in Edit Ratios modal and clears NEEDS_RATIO_UPDATE on valid ADMIN save while updating Audit Log", async () => {
    const user = userEvent.setup();
    const savedAuditEntry: GroupAuditLogEntry = {
      id: "audit-saved-1",
      groupId: "grp-apt-4b",
      category: "RATIOS",
      eventType: "NEEDS_RATIO_UPDATE_CLEARED",
      actorId: "usr-1",
      actorName: "Alex Rivera",
      summary: "Updated split ratios (Custom Ratios) and cleared review flag",
      details: [
        "Cleared NEEDS_RATIO_UPDATE flag -> Group status ACTIVE",
        "Alex Rivera: 60% -> 50%",
        "Elena Rostova: 40% -> 30%",
        "Samira Patel: 0% -> 20%",
        "Existing Expense.split_breakdown snapshots remain untouched.",
      ],
      createdAt: "2026-11-26T12:00:00.000Z",
    };

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/ratios")) {
          return new Response(
            JSON.stringify({
              ok: true,
              groupId: "grp-apt-4b",
              groupStatus: "ACTIVE",
              defaultSplitMode: "CUSTOM_RATIOS",
              memberShares: [
                { userId: "usr-1", sharePercentage: 50 },
                { userId: "usr-2", sharePercentage: 30 },
                { userId: "usr-3", sharePercentage: 20 },
              ],
              auditEntry: savedAuditEntry,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            groupId: "grp-apt-4b",
            entries: [savedAuditEntry, ...INITIAL_AUDIT_LOGS],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

    renderSplitGroups();

    const spotlight = screen.getByTestId("spotlight-partition");
    const editRatioButtons = within(spotlight).getAllByRole("button", {
      name: "Edit Ratios",
    });
    expect(editRatioButtons.length).toBeGreaterThanOrEqual(1);
    await user.click(editRatioButtons[editRatioButtons.length - 1]);

    const dialog = screen.getByRole("dialog", {
      name: "Edit Split Rules & Ratios",
    });

    const alexInput = within(dialog).getByLabelText("Alex Rivera share percentage");
    const elenaInput = within(dialog).getByLabelText("Elena Rostova share percentage");
    const samiraInput = within(dialog).getByLabelText("Samira Patel share percentage");

    // Invalid total (50 + 30 + 10 = 90%) disables Save Ratios and shows 100.00% requirement
    await user.clear(alexInput);
    await user.type(alexInput, "50");
    await user.clear(elenaInput);
    await user.type(elenaInput, "30");
    await user.clear(samiraInput);
    await user.type(samiraInput, "10");

    expect(within(dialog).getByText("90.00% of 100.00%")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Custom split ratios must sum to 100.00% before saving.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Save Ratios" }),
    ).toBeDisabled();

    // Valid total (50 + 30 + 20 = 100%)
    await user.clear(samiraInput);
    await user.type(samiraInput, "20");

    expect(within(dialog).getByText("100.00% of 100.00%")).toBeInTheDocument();
    const saveBtn = within(dialog).getByRole("button", { name: "Save Ratios" });
    expect(saveBtn).not.toBeDisabled();
    await user.click(saveBtn);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/groups/grp-apt-4b/ratios",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(
      within(spotlight).queryByText("Custom split ratios need review"),
    ).not.toBeInTheDocument();

    // Open Audit Log Drawer via "Log" button and verify recorded entries + filtering
    await user.click(within(spotlight).getByRole("button", { name: "Audit Log" }));

    const drawer = screen.getByTestId("audit-log-drawer");
    expect(
      screen.getByRole("dialog", { name: "Audit Log · Apt 4B Roommates" }),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByText(
        "Updated split ratios (Custom Ratios) and cleared review flag",
      ),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByText(
        "Samira Patel joined in CUSTOM_RATIOS mode (0% initial share; review required)",
      ),
    ).toBeInTheDocument();

    // Filter to Rules (includes ratios & governance events)
    await user.click(within(drawer).getByRole("tab", { name: "Rules" }));
    expect(
      within(drawer).getByText(
        "Updated split ratios (Custom Ratios) and cleared review flag",
      ),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByText(
        "Samira Patel joined in CUSTOM_RATIOS mode (0% initial share; review required)",
      ),
    ).toBeInTheDocument();

    // Search filter narrows events by text
    const searchInput = within(drawer).getByPlaceholderText("Filter log...");
    await user.type(searchInput, "joined in CUSTOM_RATIOS");
    expect(
      within(drawer).queryByText(
        "Updated split ratios (Custom Ratios) and cleared review flag",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(drawer).getByText(
        "Samira Patel joined in CUSTOM_RATIOS mode (0% initial share; review required)",
      ),
    ).toBeInTheDocument();
    await user.clear(searchInput);

    // Filter to Expenses and Settlements tabs
    await user.click(within(drawer).getByRole("tab", { name: "Expenses" }));
    expect(within(drawer).getByText("No matching audit events")).toBeInTheDocument();

    await user.click(within(drawer).getByRole("tab", { name: "Settlements" }));
    expect(within(drawer).getByText("No matching audit events")).toBeInTheDocument();

    await user.click(within(drawer).getByRole("tab", { name: "All Events" }));
    expect(
      screen.getByRole("button", { name: "Export Log" }),
    ).not.toBeDisabled();
  });
  it("opens RecordSettlementModal from WHO OWES WHOM Mark Settled and filters/exports Audit Log events", async () => {
    const user = userEvent.setup();
    const mixedAuditLogs: GroupAuditLogEntry[] = [
      {
        id: "exp-1",
        groupId: "grp-apt-4b",
        category: "LEDGER",
        eventType: "EXPENSE_ADDED",
        actorId: "usr-1",
        actorName: "Alex Rivera",
        summary: 'Alex Rivera added expense "Whole Foods Market"',
        details: ["$368.40 · 3-Way Equal"],
        createdAt: "2026-11-26T14:14:00.000Z",
      },
      {
        id: "settle-1",
        groupId: "grp-apt-4b",
        category: "LEDGER",
        eventType: "SETTLEMENT_RECORDED",
        actorId: "usr-2",
        actorName: "Elena Rostova",
        summary: "Elena Rostova settled $120.00 with Alex Rivera",
        details: ["Payment rail: VENMO"],
        createdAt: "2026-11-24T11:05:00.000Z",
      },
      ...INITIAL_AUDIT_LOGS,
    ];

    const groupsWithMixedLogs: SplitGroupDetail[] = GROUPS_FIXTURE.map((g, i) =>
      i === 0 ? { ...g, auditLogs: mixedAuditLogs } : g,
    );

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          groupId: "grp-apt-4b",
          entries: mixedAuditLogs,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    renderSplitGroups(groupsWithMixedLogs);

    const spotlight = screen.getByTestId("spotlight-partition");
    const markSettledBtn = within(spotlight).getByTestId(
      "who-owes-settle-usr-2-usr-1",
    );
    await user.click(markSettledBtn);

    const settleDialog = screen.getByRole("dialog", {
      name: "Record Settlement",
    });
    expect(within(settleDialog).getByDisplayValue("462.50")).toBeInTheDocument();
    await user.click(within(settleDialog).getByRole("button", { name: "Cancel" }));

    await user.click(within(spotlight).getByRole("button", { name: "Audit Log" }));
    const auditDrawer = screen.getByTestId("audit-log-drawer");

    await user.click(within(auditDrawer).getByRole("tab", { name: "Expenses" }));
    expect(
      within(auditDrawer).getByText('Alex Rivera added expense "Whole Foods Market"'),
    ).toBeInTheDocument();
    expect(
      within(auditDrawer).queryByText("Elena Rostova settled $120.00 with Alex Rivera"),
    ).not.toBeInTheDocument();

    await user.click(within(auditDrawer).getByRole("tab", { name: "Settlements" }));
    expect(
      within(auditDrawer).getByText("Elena Rostova settled $120.00 with Alex Rivera"),
    ).toBeInTheDocument();
    expect(
      within(auditDrawer).queryByText('Alex Rivera added expense "Whole Foods Market"'),
    ).not.toBeInTheDocument();
  });
});
