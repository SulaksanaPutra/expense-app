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
import {
  JoinGroupClient,
  SplitGroupsClient,
} from "@/components/split-groups";
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
    defaultSplitMode: "EQUAL",
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
    members: [
      {
        userId: "usr-1",
        name: "Alex Rivera",
        email: "alex@example.com",
        role: "MEMBER",
        status: "ACTIVE",
        sharePercentage: 50,
        paidThisPeriodCents: 60000,
        netBalanceCents: 0,
        isCurrentUser: true,
      },
      {
        userId: "usr-4",
        name: "Marcus Vance",
        email: "marcus@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        sharePercentage: 50,
        paidThisPeriodCents: 60000,
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

describe("Member Invitation Gateway & NEEDS_RATIO_UPDATE UI", () => {
  it("supports Copy link for all members, ADMIN-only Regenerate Link, and hides Regenerate Link for non-admins", async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          groupId: "grp-apt-4b",
          slug: "apt-4b",
          inviteToken: "signed-token-v2",
          inviteTokenVersion: 2,
          invitePath: "/join/apt-4b?token=signed-token-v2",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    renderSplitGroups();

    const gateway = screen.getByTestId("member-invitation-gateway");
    const linkInput = within(gateway).getByLabelText("Group invite link");
    expect(linkInput).toHaveValue(
      "http://localhost:3000/join/apt-4b?token=signed-token-v1",
    );

    // Copy invite link without disabling the Copy button
    const copyButton = within(gateway).getByRole("button", { name: "Copy" });
    await user.click(copyButton);
    expect(writeTextMock).toHaveBeenCalledWith(
      "http://localhost:3000/join/apt-4b?token=signed-token-v1",
    );
    const copiedButton = within(gateway).getByRole("button", { name: "Copied" });
    expect(copiedButton).not.toBeDisabled();

    // ADMIN clicks Regenerate Link
    const regenerateButton = within(gateway).getByRole("button", {
      name: "Regenerate Link",
    });
    await user.click(regenerateButton);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/groups/grp-apt-4b/invite/regenerate",
      { method: "POST" },
    );
    expect(linkInput).toHaveValue(
      "http://localhost:3000/join/apt-4b?token=signed-token-v2",
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // Switch to Tahoe Ski Cabin where current user is MEMBER
    await user.click(
      screen.getByRole("button", { name: "Manage Group Tahoe Ski Cabin" }),
    );
    expect(
      within(gateway).queryByRole("button", { name: "Regenerate Link" }),
    ).not.toBeInTheDocument();
    expect(within(gateway).getByText(/Member view · Copy only/i)).toBeInTheDocument();
    expect(within(gateway).getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("displays NEEDS_RATIO_UPDATE warning AlertBanner and allows ADMIN to save valid 100% custom ratios", async () => {
    const user = userEvent.setup();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          groupId: "grp-apt-4b",
          groupStatus: "ACTIVE",
          defaultSplitMode: "CUSTOM_RATIOS",
          memberShares: [
            { userId: "usr-1", sharePercentage: 50 },
            { userId: "usr-2", sharePercentage: 30 },
            { userId: "usr-3", sharePercentage: 20 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    renderSplitGroups();

    const spotlight = screen.getByTestId("spotlight-partition");
    expect(
      within(spotlight).getByText("Custom split ratios need review"),
    ).toBeInTheDocument();

    const bannerEditButton = within(
      within(spotlight).getByRole("alert"),
    ).getByRole("button", { name: "Edit Ratios" });
    await user.click(bannerEditButton);

    const dialog = screen.getByRole("dialog", {
      name: "Edit Split Rules & Ratios",
    });
    const alexInput = within(dialog).getByLabelText("Alex Rivera share percentage");
    const elenaInput = within(dialog).getByLabelText("Elena Rostova share percentage");
    const samiraInput = within(dialog).getByLabelText("Samira Patel share percentage");

    await user.clear(alexInput);
    await user.type(alexInput, "50");
    await user.clear(elenaInput);
    await user.type(elenaInput, "30");
    await user.clear(samiraInput);
    await user.type(samiraInput, "20");

    const saveButton = within(dialog).getByRole("button", {
      name: "Save Ratios",
    });
    expect(saveButton).not.toBeDisabled();
    await user.click(saveButton);

    expect(fetchSpy).toHaveBeenCalledWith("/api/groups/grp-apt-4b/ratios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_split_mode: "CUSTOM_RATIOS",
        allocations: [
          { user_id: "usr-1", share_percentage: 50 },
          { user_id: "usr-2", share_percentage: 30 },
          { user_id: "usr-3", share_percentage: 20 },
        ],
      }),
    });

    expect(
      within(spotlight).queryByText("Custom split ratios need review"),
    ).not.toBeInTheDocument();
  });
});

describe("JoinGroupClient (/join/[slug]?token=...)", () => {
  it("renders a clean rejection state for invalid or revoked invite tokens", () => {
    render(
      <JoinGroupClient
        state={{
          status: "invalid",
          code: "REVOKED",
          message:
            "This invite link has been revoked by a group admin. Ask for the latest link.",
          slug: "apt-4b",
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Invitation link revoked" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This invite link has been revoked by a group admin.",
    );
  });

  it("prompts unauthenticated user to sign in while preserving /join/[slug]?token=... redirect", () => {
    render(
      <JoinGroupClient
        state={{
          status: "valid",
          token: "signed-token-v1",
          isAuthenticated: false,
          userEmail: null,
          invite: {
            groupId: "grp-1",
            name: "Apt 4B Roommates",
            slug: "apt-4b",
            groupType: "RESIDENTIAL",
            status: "ACTIVE",
            baseCurrency: "USD",
            defaultSplitMode: "EQUAL",
            activeMemberCount: 4,
            alreadyMember: false,
            projectedSharePercentage: 20,
          },
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Join Apt 4B Roommates" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Equal Split \(EQUAL\)/i)).toBeInTheDocument();
    expect(screen.getByText(/20% across 5 members/i)).toBeInTheDocument();

    const signInLink = screen.getByRole("link", {
      name: /Sign in to Join Apt 4B Roommates/i,
    });
    expect(signInLink).toHaveAttribute(
      "href",
      "/login?next=%2Fjoin%2Fapt-4b%3Ftoken%3Dsigned-token-v1",
    );
  });

  it("allows authenticated user to accept invite and redirects to /split-groups?group=...", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          alreadyMember: false,
          groupId: "grp-custom",
          slug: "apt-4b",
          groupName: "Apt 4B Custom",
          groupStatus: "NEEDS_RATIO_UPDATE",
          defaultSplitMode: "CUSTOM_RATIOS",
          sharePercentage: 0,
          activeMemberCount: 5,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <JoinGroupClient
        state={{
          status: "valid",
          token: "signed-token-v1",
          isAuthenticated: true,
          userEmail: "samira@example.com",
          invite: {
            groupId: "grp-custom",
            name: "Apt 4B Custom",
            slug: "apt-4b",
            groupType: "RESIDENTIAL",
            status: "ACTIVE",
            baseCurrency: "USD",
            defaultSplitMode: "CUSTOM_RATIOS",
            activeMemberCount: 4,
            alreadyMember: false,
            projectedSharePercentage: 0,
          },
        }}
      />,
    );

    expect(
      screen.getByText(/Custom Ratios \(CUSTOM_RATIOS\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/0% initial share/i)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Join Apt 4B Custom" }),
    );

    expect(fetchSpy).toHaveBeenCalledWith("/api/groups/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "apt-4b", token: "signed-token-v1" }),
    });
    expect(pushMock).toHaveBeenCalledWith("/split-groups?group=grp-custom");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("handles already-a-member state cleanly", () => {
    render(
      <JoinGroupClient
        state={{
          status: "valid",
          token: "signed-token-v1",
          isAuthenticated: true,
          userEmail: "alex@example.com",
          invite: {
            groupId: "grp-apt-4b",
            name: "Apt 4B Roommates",
            slug: "apt-4b",
            groupType: "RESIDENTIAL",
            status: "ACTIVE",
            baseCurrency: "USD",
            defaultSplitMode: "EQUAL",
            activeMemberCount: 4,
            alreadyMember: true,
            projectedSharePercentage: 25,
          },
        }}
      />,
    );

    expect(screen.getByText("Already a member")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open Split Group/i }),
    ).toHaveAttribute("href", "/split-groups?group=grp-apt-4b");
  });
});
