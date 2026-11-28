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
  fullName: "Jordan Doe",
  email: "jordan@example.com",
};

const INITIAL_ACTIVE_GROUPS: SplitGroupDetail[] = [
  {
    id: "grp-apt-4b",
    name: "Apartment 4B Shared",
    slug: "apt-4b",
    groupType: "RESIDENTIAL",
    category: "HOME",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: 450000,
    billingCycleAnchorDay: 1,
    leaseEndDate: null,
    inviteToken: "token-apt4b",
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
        sharePercentage: 33.33,
        paidThisPeriodCents: 152590,
        netBalanceCents: 58000,
        isCurrentUser: true,
      },
      {
        userId: "usr-2",
        name: "Marcus Kim",
        email: "marcus@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 33.33,
        paidThisPeriodCents: 65590,
        netBalanceCents: -29000,
        isCurrentUser: false,
      },
      {
        userId: "usr-3",
        name: "Alex Lee",
        email: "alex@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 33.34,
        paidThisPeriodCents: 65590,
        netBalanceCents: -29000,
        isCurrentUser: false,
      },
    ],
  },
  {
    id: "grp-cabin",
    name: "Weekend Cabin Crew",
    slug: "weekend-cabin",
    groupType: "TRIP",
    category: "TRIP",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "CUSTOM",
    simplifyDebts: true,
    operationalBudgetCents: null,
    billingCycleAnchorDay: 1,
    leaseEndDate: null,
    inviteToken: "token-cabin",
    cycleTurnoverCents: 124000,
    cycleTransactionCount: 2,
    userNetLedgerCents: -14540,
    recurringRuleCount: 0,
    isFullySettled: false,
    currentUserRole: "MEMBER",
    members: [
      {
        userId: "usr-1",
        name: "Jordan Doe",
        email: "jordan@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 50,
        paidThisPeriodCents: 47460,
        netBalanceCents: -14540,
        isCurrentUser: true,
      },
      {
        userId: "usr-2",
        name: "Marcus Kim",
        email: "marcus@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        sharePercentage: 50,
        paidThisPeriodCents: 76540,
        netBalanceCents: 14540,
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
    leaseEndDate: null,
    inviteToken: "token-lunch",
    cycleTurnoverCents: 34000,
    cycleTransactionCount: 1,
    userNetLedgerCents: 0,
    recurringRuleCount: 0,
    isFullySettled: true,
    currentUserRole: "ADMIN",
    members: [
      {
        userId: "usr-1",
        name: "Jordan Doe",
        email: "jordan@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        sharePercentage: 50,
        paidThisPeriodCents: 17000,
        netBalanceCents: 0,
        isCurrentUser: true,
      },
      {
        userId: "usr-2",
        name: "Marcus Kim",
        email: "marcus@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 50,
        paidThisPeriodCents: 17000,
        netBalanceCents: 0,
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

describe("Split Groups v2 Active View, 4-Column Cards, Create/Edit Modal & Card Menu", () => {
  it("renders 4-column desktop grid with category badge, split rule, AvatarStack, Cycle Spend, and Your Net", () => {
    renderSplitGroupsPage();

    const grid = screen.getByRole("region", { name: "Active split groups" });
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("xl:grid-cols-4");

    const aptCard = screen.getByTestId("group-card-grp-apt-4b");
    expect(within(aptCard).getByText("Home")).toBeInTheDocument();
    expect(within(aptCard).getByText("Apartment 4B Shared")).toBeInTheDocument();
    expect(within(aptCard).getByText("3-Way Equal (33.3%)")).toBeInTheDocument();
    expect(
      within(aptCard).getByRole("group", {
        name: /Members: Jordan Doe, Marcus Kim, Alex Lee/i,
      }),
    ).toBeInTheDocument();
    expect(within(aptCard).getByText("Cycle Spend")).toBeInTheDocument();
    expect(within(aptCard).getByText("$2,837.70")).toBeInTheDocument();
    expect(within(aptCard).getByText("Your Net")).toBeInTheDocument();
    expect(within(aptCard).getByText("+$580.00")).toBeInTheDocument();

    const cabinCard = screen.getByTestId("group-card-grp-cabin");
    expect(within(cabinCard).getByText("Trip")).toBeInTheDocument();
    expect(within(cabinCard).getByText("Itemized Custom")).toBeInTheDocument();
    expect(within(cabinCard).getByText("-$145.40")).toBeInTheDocument();

    const lunchCard = screen.getByTestId("group-card-grp-lunch");
    expect(within(lunchCard).getByText("Dining")).toBeInTheDocument();
    expect(within(lunchCard).getByText("2-Way (50/50)")).toBeInTheDocument();
    expect(within(lunchCard).getByText("Settled")).toBeInTheDocument();
  });

  it("selects a group into Spotlight and syncs Sidebar ACTIVE GROUP when clicking a group card", async () => {
    const user = userEvent.setup();
    renderSplitGroupsPage();

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const splitGroupsLink = within(nav).getByRole("link", {
      name: /Split Groups/i,
    });
    expect(within(splitGroupsLink).getByText("3")).toBeInTheDocument();

    // Click Weekend Cabin Crew card directly
    await user.click(screen.getByTestId("group-card-grp-cabin"));

    expect(replaceMock).toHaveBeenCalledWith(
      "/split-groups?cycle=2026-11&group=grp-cabin",
      { scroll: false },
    );

    // Sidebar Active Group switcher reflects Weekend Cabin Crew
    expect(
      screen.getByRole("button", { name: /Active Group/i }),
    ).toHaveTextContent("Weekend Cabin Crew");

    // Spotlight panel switches to Weekend Cabin Crew
    const spotlight = screen.getByTestId("spotlight-partition");
    expect(
      within(spotlight).getByRole("heading", { name: "Weekend Cabin Crew" }),
    ).toBeInTheDocument();
  });

  it("opens the card ⋮ menu with Edit Group, Split Rules & Invite, Audit Log, and Archive Group", async () => {
    const user = userEvent.setup();
    renderSplitGroupsPage();

    await user.click(
      screen.getByRole("button", { name: "Actions for Apartment 4B Shared" }),
    );

    expect(screen.getByRole("menuitem", { name: "Edit Group" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Split Rules & Invite" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Audit Log" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Archive Group" }),
    ).toBeInTheDocument();

    // Click Split Rules & Invite from card menu
    await user.click(
      screen.getByRole("menuitem", { name: "Split Rules & Invite" }),
    );
    expect(
      screen.getByTestId("member-invitation-gateway"),
    ).toBeInTheDocument();
  });

  it("creates a new group and edits an existing group via Create / Edit Group modal with v2 categories", async () => {
    const user = userEvent.setup();
    const createdGroup: SplitGroupDetail = {
      id: "grp-utilities",
      name: "Shared Utilities",
      slug: "shared-utilities-abc123",
      groupType: "RECURRING",
      category: "UTILITIES",
      status: "ACTIVE",
      baseCurrency: "EUR",
      defaultSplitMode: "PERCENTAGE",
      simplifyDebts: true,
      operationalBudgetCents: null,
      billingCycleAnchorDay: 1,
      leaseEndDate: null,
      inviteToken: "tok-util",
      cycleTurnoverCents: 0,
      cycleTransactionCount: 0,
      userNetLedgerCents: 0,
      recurringRuleCount: 0,
      isFullySettled: true,
      currentUserRole: "ADMIN",
      members: [
        {
          userId: "usr-1",
          name: "Jordan Doe",
          email: "jordan@example.com",
          role: "ADMIN",
          status: "ACTIVE",
          sharePercentage: 100,
          paidThisPeriodCents: 0,
          netBalanceCents: 0,
          isCurrentUser: true,
        },
      ],
    };

    const updatedGroup: SplitGroupDetail = {
      ...createdGroup,
      name: "Utilities & Fiber",
      category: "OTHER",
      defaultSplitMode: "CUSTOM",
    };

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            group: createdGroup,
            shellGroup: toShellGroupSummary(createdGroup),
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            group: updatedGroup,
            shellGroup: toShellGroupSummary(updatedGroup),
            invitedEmails: [],
            removedMemberIds: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    renderSplitGroupsPage();

    // 1. Open Create Group modal
    await user.click(screen.getByRole("button", { name: "Create Group" }));
    const createDialog = screen.getByRole("dialog", { name: "Create Group" });

    // Submit empty form to check validation
    await user.click(
      within(createDialog).getByRole("button", { name: "Create Group" }),
    );
    expect(
      within(createDialog).getByText("Please enter a group name."),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Fill fields: Name, Category=Utilities, Default Split Method=Percentage, Currency=EUR, Member email
    await user.type(
      within(createDialog).getByLabelText(/Group Name/i),
      "Shared Utilities",
    );
    await user.click(
      within(createDialog).getByRole("radio", { name: "Utilities" }),
    );
    await user.click(
      within(createDialog).getByRole("radio", { name: "Percentage" }),
    );
    await user.click(
      within(createDialog).getByRole("button", { name: /Currency/i }),
    );
    await user.click(within(createDialog).getByRole("option", { name: /EUR/i }));

    await user.type(
      within(createDialog).getByLabelText("Add member by email"),
      "alex@example.com",
    );
    await user.click(within(createDialog).getByRole("button", { name: "Add" }));
    expect(within(createDialog).getByText("alex@example.com")).toBeInTheDocument();

    await user.click(
      within(createDialog).getByRole("button", { name: "Create Group" }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({
      name: "Shared Utilities",
      category: "UTILITIES",
      default_split_mode: "PERCENTAGE",
      base_currency: "EUR",
      member_emails: ["alex@example.com"],
    });

    const newCard = screen.getByTestId("group-card-grp-utilities");
    expect(within(newCard).getByText("Shared Utilities")).toBeInTheDocument();
    expect(within(newCard).getByText("Utilities")).toBeInTheDocument();

    // 2. Edit the newly created group via card ⋮ menu -> Edit Group
    await user.click(
      screen.getByRole("button", { name: "Actions for Shared Utilities" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Edit Group" }));

    const editDialog = screen.getByRole("dialog", {
      name: "Edit Group · Shared Utilities",
    });
    const editNameInput = within(editDialog).getByLabelText(/Group Name/i);
    await user.clear(editNameInput);
    await user.type(editNameInput, "Utilities & Fiber");
    await user.click(within(editDialog).getByRole("radio", { name: "Other" }));
    await user.click(within(editDialog).getByRole("radio", { name: "Custom" }));

    await user.click(
      within(editDialog).getByRole("button", { name: "Save Group" }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe("/api/groups/grp-utilities");
    expect(fetchSpy.mock.calls[1][1]?.method).toBe("PATCH");
    expect(within(newCard).getByText("Utilities & Fiber")).toBeInTheDocument();
    expect(within(newCard).getByText("Other")).toBeInTheDocument();
  });

  it("renders empty state and error state with retry action", async () => {
    const user = userEvent.setup();

    renderSplitGroupsPage({ activeGroups: [], loadError: null }, []);
    expect(
      screen.getByText("No active split groups yet"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Create Group" }).length,
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
