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
import type { ShellGroupSummary, ShellUserSummary } from "@/components/shell";
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

const INITIAL_ACTIVE_GROUPS: SplitGroupDetail[] = [
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
    leaseEndDate: "2027-08-31",
    inviteToken: "token-apt4b",
    cycleTurnoverCents: 384250,
    cycleTransactionCount: 4,
    userNetLedgerCents: 46250,
    recurringRuleCount: 2,
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
        sharePercentage: 50,
        paidThisPeriodCents: 145875,
        netBalanceCents: -46250,
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
    baseCurrency: "EUR",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: null,
    billingCycleAnchorDay: 1,
    leaseEndDate: null,
    inviteToken: "token-tahoe",
    cycleTurnoverCents: 245000,
    cycleTransactionCount: 2,
    userNetLedgerCents: -8500,
    recurringRuleCount: 0,
    isFullySettled: false,
    currentUserRole: "MEMBER",
    members: [
      {
        userId: "usr-1",
        name: "Alex Rivera",
        email: "alex@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 50,
        paidThisPeriodCents: 114000,
        netBalanceCents: -8500,
        isCurrentUser: true,
      },
      {
        userId: "usr-3",
        name: "Marcus Vance",
        email: "marcus@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        sharePercentage: 50,
        paidThisPeriodCents: 131000,
        netBalanceCents: 8500,
        isCurrentUser: false,
      },
    ],
  },
];

function renderSplitGroupsPage(
  dataOverrides?: Partial<SplitGroupsPageData>,
  shellGroups?: ShellGroupSummary[],
) {
  const pageData: SplitGroupsPageData = {
    activeGroups: INITIAL_ACTIVE_GROUPS,
    archivedGroups: [],
    cycleSlug: "2026-11",
    loadError: null,
    ...dataOverrides,
  };

  const groupsForShell =
    shellGroups ?? pageData.activeGroups.map(toShellGroupSummary);

  return render(
    <AppShell groups={groupsForShell} user={CURRENT_USER}>
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

describe("Split Groups Page, Create Modal & Active Group Sync", () => {
  it("renders active group cards with type badge, AvatarStack, formatted turnover/net ledger, Manage Group, and Quick Split", () => {
    renderSplitGroupsPage();

    const aptCard = screen.getByTestId("group-card-grp-apt-4b");
    expect(within(aptCard).getByText("Primary Residence")).toBeInTheDocument();
    expect(within(aptCard).getByText("Apt 4B Roommates")).toBeInTheDocument();
    expect(
      within(aptCard).getByRole("group", {
        name: /Members: Alex Rivera, Elena Rostova/i,
      }),
    ).toBeInTheDocument();
    expect(within(aptCard).getByText("$3,842.50")).toBeInTheDocument();
    expect(within(aptCard).getByText("+$462.50")).toBeInTheDocument();

    const tahoeCard = screen.getByTestId("group-card-grp-tahoe");
    expect(within(tahoeCard).getByText("Seasonal Trip")).toBeInTheDocument();
    expect(within(tahoeCard).getByText("€2,450.00")).toBeInTheDocument();
    expect(within(tahoeCard).getByText("-€85.00")).toBeInTheDocument();
  });

  it("synchronizes ?group= URL param, Spotlight panel, and Sidebar Active Group switcher on Manage Group and Quick Split", async () => {
    const user = userEvent.setup();
    renderSplitGroupsPage();

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const splitGroupsLink = within(nav).getByRole("link", {
      name: /Split Groups/i,
    });
    expect(within(splitGroupsLink).getByText("2")).toBeInTheDocument();

    // Click Manage Group on Tahoe Ski Cabin
    await user.click(
      screen.getByRole("button", { name: "Manage Group Tahoe Ski Cabin" }),
    );

    expect(replaceMock).toHaveBeenCalledWith(
      "/split-groups?cycle=2026-11&group=grp-tahoe",
      { scroll: false },
    );

    // Sidebar Active Group switcher reflects Tahoe Ski Cabin
    expect(
      screen.getByRole("button", { name: /Active Group/i }),
    ).toHaveTextContent("Tahoe Ski Cabin");

    // Spotlight Partition switches to Tahoe Ski Cabin
    const spotlight = screen.getByTestId("spotlight-partition");
    expect(
      within(spotlight).getByRole("heading", {
        name: /Tahoe Ski Cabin · Split Rules & Ratios/i,
      }),
    ).toBeInTheDocument();

    // Quick Split on Apt 4B selects Apt 4B and opens the Add Expense dialog scoped to it
    await user.click(
      screen.getByRole("button", { name: "Quick Split for Apt 4B Roommates" }),
    );
    expect(replaceMock).toHaveBeenLastCalledWith(
      "/split-groups?cycle=2026-11&group=grp-apt-4b",
      { scroll: false },
    );
    expect(
      screen.getByRole("dialog", { name: "Add Expense" }),
    ).toHaveTextContent("Logging to Apt 4B Roommates");
  });

  it("validates fields, creates a new group via modal, assigns creator as ADMIN, and syncs Sidebar & ?group=", async () => {
    const user = userEvent.setup();
    const createdGroup: SplitGroupDetail = {
      id: "grp-berlin",
      name: "Berlin Studio",
      slug: "berlin-studio-abc123",
      groupType: "RECURRING",
      status: "ACTIVE",
      baseCurrency: "EUR",
      defaultSplitMode: "EQUAL",
      simplifyDebts: true,
      operationalBudgetCents: 125050,
      billingCycleAnchorDay: 15,
      leaseEndDate: null,
      inviteToken: "tok-berlin",
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

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          group: createdGroup,
          shellGroup: toShellGroupSummary(createdGroup),
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    renderSplitGroupsPage();

    await user.click(screen.getByRole("button", { name: "Create New Group" }));

    const dialog = screen.getByRole("dialog", { name: "Create New Group" });
    expect(dialog).toBeInTheDocument();

    // Submit empty form to check validation
    await user.click(within(dialog).getByRole("button", { name: "Create Group" }));
    expect(
      within(dialog).getByText("Please enter a group name."),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Fill out form fields
    const nameInput = within(dialog).getByLabelText(/Group Name/i);
    await user.type(nameInput, "Berlin Studio");

    // Select Group Type -> Recurring Flat
    await user.click(within(dialog).getByRole("button", { name: /Group Type/i }));
    await user.click(within(dialog).getByRole("option", { name: /Recurring Flat/i }));

    // Select Base Currency -> EUR
    await user.click(
      within(dialog).getByRole("button", { name: /Base Currency/i }),
    );
    await user.click(within(dialog).getByRole("option", { name: /EUR/i }));

    // Operational Budget -> 1250.50 (converts to 125050 minor units)
    const budgetInput = within(dialog).getByLabelText(/Operational Budget/i);
    await user.type(budgetInput, "1250.50");

    // Billing Cycle Anchor Day -> 15
    const anchorInput = within(dialog).getByLabelText(
      /Billing Cycle Anchor Day/i,
    );
    await user.clear(anchorInput);
    await user.type(anchorInput, "15");

    // Submit valid form (leaving optional lease_end_date empty)
    await user.click(within(dialog).getByRole("button", { name: "Create Group" }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchInit] = fetchSpy.mock.calls[0];
    expect(fetchUrl).toBe("/api/groups");
    expect(JSON.parse(String(fetchInit?.body))).toEqual({
      name: "Berlin Studio",
      group_type: "RECURRING",
      base_currency: "EUR",
      operational_budget_cents: 125050,
      billing_cycle_anchor_day: 15,
      lease_end_date: null,
    });

    // Modal closes and new group appears immediately
    expect(
      screen.queryByRole("dialog", { name: "Create New Group" }),
    ).not.toBeInTheDocument();

    const newCard = screen.getByTestId("group-card-grp-berlin");
    expect(within(newCard).getByText("Berlin Studio")).toBeInTheDocument();
    expect(within(newCard).getByText("Recurring Flat")).toBeInTheDocument();

    // Sidebar Split Groups badge increments from 2 to 3 & Active Group switches to Berlin Studio
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const splitGroupsLink = within(nav).getByRole("link", {
      name: /Split Groups/i,
    });
    expect(within(splitGroupsLink).getByText("3")).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /Active Group/i }),
    ).toHaveTextContent("Berlin Studio");

    expect(replaceMock).toHaveBeenCalledWith(
      "/split-groups?cycle=2026-11&group=grp-berlin",
      { scroll: false },
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("renders empty state and error state with retry action", async () => {
    const user = userEvent.setup();

    renderSplitGroupsPage({ activeGroups: [], loadError: null }, []);
    expect(
      screen.getByText("No active split groups yet"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Create New Group" }).length,
    ).toBeGreaterThanOrEqual(1);

    cleanup();

    renderSplitGroupsPage(
      { activeGroups: [], loadError: "Database connection timed out." },
      [],
    );
    expect(
      screen.getByText("Could not load split groups"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Database connection timed out."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
