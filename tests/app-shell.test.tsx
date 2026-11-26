// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const pushMock = vi.fn();
let mockPathname = "/dashboard";
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
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

import {
  AppShell,
  LiveSyncPill,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  buildShellHref,
  formatCycleLabel,
  mergeShellSearchParams,
  parseCycleParam,
  parseGroupParam,
  stepCycleSlug,
} from "@/components/shell";
import type { ShellGroupSummary, ShellUserSummary } from "@/components/shell";

const TEST_GROUPS: ShellGroupSummary[] = [
  {
    id: "grp-apt-4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b-roommates",
    groupType: "RESIDENTIAL",
    status: "ACTIVE",
    baseCurrency: "USD",
    activeSplitCount: 4,
    members: [
      { id: "usr-1", name: "Jordan Davis" },
      { id: "usr-2", name: "Alex Lin" },
      { id: "usr-3", name: "Samira Patel" },
    ],
  },
  {
    id: "grp-tahoe",
    name: "Tahoe Ski Trip",
    slug: "tahoe-ski-trip",
    groupType: "TRIP",
    status: "ACTIVE",
    baseCurrency: "USD",
    activeSplitCount: 2,
    members: [
      { id: "usr-1", name: "Jordan Davis" },
      { id: "usr-4", name: "Elena Rostova" },
    ],
  },
  {
    id: "grp-archived",
    name: "Old Lease 2023",
    slug: "old-lease-2023",
    groupType: "RESIDENTIAL",
    status: "ARCHIVED",
    baseCurrency: "USD",
    activeSplitCount: 0,
    members: [{ id: "usr-1", name: "Jordan Davis" }],
  },
];

const TEST_USER: ShellUserSummary = {
  id: "usr-1",
  fullName: "Jordan Davis",
  email: "jordan@example.com",
};

function renderShell(overrides?: Partial<React.ComponentProps<typeof AppShell>>) {
  return render(
    <AppShell
      groups={TEST_GROUPS}
      user={TEST_USER}
      initialNotifications={[
        {
          id: "notif-1",
          title: "New Expense Logged",
          description: "Alex added Trader Joe's ($46.05 your share)",
          timestamp: "2h ago",
          unread: true,
        },
      ]}
      {...overrides}
    >
      <div>Page Body Content</div>
    </AppShell>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

beforeEach(() => {
  mockPathname = "/dashboard";
  mockSearchParams = new URLSearchParams();
  replaceMock.mockReset();
  pushMock.mockReset();
  window.localStorage.clear();
});

describe("URL State Helpers", () => {
  it("steps and formats billing cycles accurately across year boundaries", () => {
    expect(stepCycleSlug("2024-01", -1)).toBe("2023-12");
    expect(stepCycleSlug("2024-12", 1)).toBe("2025-01");
    expect(stepCycleSlug("2024-10", -1)).toBe("2024-09");
    expect(formatCycleLabel("2024-10")).toBe("October 2024");
  });

  it("validates group and cycle params and builds preserved hrefs", () => {
    expect(parseGroupParam("grp-apt-4b", ["grp-apt-4b", "grp-tahoe"])).toBe(
      "grp-apt-4b",
    );
    expect(parseGroupParam("unknown", ["grp-apt-4b"])).toBe("all");
    expect(parseCycleParam("2026-11")).toBe("2026-11");
    expect(parseCycleParam("invalid", "2026-10")).toBe("2026-10");

    expect(
      buildShellHref("/expenses", { group: "grp-apt-4b", cycle: "2024-10" }),
    ).toBe("/expenses?group=grp-apt-4b&cycle=2024-10");

    expect(
      mergeShellSearchParams("/expenses", "q=coffee&group=all", {
        group: "grp-tahoe",
        cycle: "2024-10",
      }),
    ).toBe("/expenses?q=coffee&group=grp-tahoe&cycle=2024-10");
  });
});

describe("AppShell", () => {
  it("highlights the active route in #0066cc pill and shows live non-archived group count", () => {
    mockPathname = "/expenses";
    renderShell();

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const expensesLink = within(nav).getByRole("link", { name: /Expenses/i });
    const dashboardLink = within(nav).getByRole("link", { name: /Dashboard/i });
    const splitGroupsLink = within(nav).getByRole("link", {
      name: /Split Groups/i,
    });

    expect(expensesLink).toHaveAttribute("aria-current", "page");
    expect(expensesLink).toHaveClass("bg-[#0066cc]", "text-white", "rounded-pill");
    expect(dashboardLink).not.toHaveAttribute("aria-current");
    expect(dashboardLink).not.toHaveClass("bg-[#0066cc]");
    // 2 non-archived groups (ARCHIVED excluded)
    expect(within(splitGroupsLink).getByText("2")).toBeInTheDocument();
  });

  it("toggles desktop sidebar collapse state and persists it to localStorage", async () => {
    const user = userEvent.setup();
    renderShell();

    const sidebar = screen.getByTestId("desktop-sidebar");
    expect(sidebar).toHaveAttribute("data-collapsed", "false");

    const collapseBtn = screen.getByRole("button", {
      name: /Collapse Sidebar/i,
    });
    expect(collapseBtn).toHaveAttribute("aria-expanded", "true");

    await user.click(collapseBtn);

    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(
      window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY),
    ).toBe("true");

    const expandBtn = screen.getByRole("button", { name: /Expand Sidebar/i });
    expect(expandBtn).toHaveAttribute("aria-expanded", "false");

    await user.click(expandBtn);
    expect(sidebar).toHaveAttribute("data-collapsed", "false");
    expect(
      window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY),
    ).toBe("false");
  });

  it("hydrates collapsed sidebar state from localStorage on mount", () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    renderShell();

    const sidebar = screen.getByTestId("desktop-sidebar");
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(
      screen.getByRole("button", { name: /Expand Sidebar/i }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("opens and closes the mobile drawer via trigger, close button, Escape, and backdrop", async () => {
    const user = userEvent.setup();
    renderShell();

    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();

    const hamburger = screen.getByRole("button", {
      name: "Open navigation menu",
    });
    expect(hamburger).toHaveAttribute("aria-expanded", "false");

    await user.click(hamburger);

    const drawer = screen.getByRole("dialog", { name: "Mobile navigation" });
    expect(drawer).toBeInTheDocument();
    expect(hamburger).toHaveAttribute("aria-expanded", "true");
    expect(
      within(drawer).getByRole("navigation", { name: "Mobile primary" }),
    ).toBeInTheDocument();

    // Close via close button
    await user.click(
      within(drawer).getByRole("button", { name: "Close navigation menu" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();

    // Reopen and close via Escape key
    await user.click(hamburger);
    const reopenedDrawer = screen.getByRole("dialog", {
      name: "Mobile navigation",
    });
    fireEvent.keyDown(reopenedDrawer, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();

    // Reopen and close via backdrop click (clicking <dialog> element directly)
    await user.click(hamburger);
    const backdropDrawer = screen.getByRole("dialog", {
      name: "Mobile navigation",
    });
    fireEvent.click(backdropDrawer);
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
  });

  it("updates ?group= and ?cycle= URL params and preserves them across nav links", async () => {
    const user = userEvent.setup();
    mockPathname = "/dashboard";
    mockSearchParams = new URLSearchParams("cycle=2024-10&q=groceries");
    renderShell();

    // Switch Active Group in Sidebar
    const groupTrigger = screen.getByRole("button", { name: /Active Group/i });
    await user.click(groupTrigger);
    await user.click(
      screen.getByRole("option", { name: /Apt 4B Roommates/i }),
    );

    expect(replaceMock).toHaveBeenCalledWith(
      "/dashboard?cycle=2024-10&q=groceries&group=grp-apt-4b",
      { scroll: false },
    );

    // Step Cycle Picker backward (2024-10 -> 2024-09)
    await user.click(
      screen.getByRole("button", { name: "Previous billing cycle" }),
    );

    expect(replaceMock).toHaveBeenLastCalledWith(
      "/dashboard?cycle=2024-09&q=groceries&group=grp-apt-4b",
      { scroll: false },
    );

    // Verify all navigation links preserve both ?group= and ?cycle=
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: /Dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard?group=grp-apt-4b&cycle=2024-09",
    );
    expect(within(nav).getByRole("link", { name: /Expenses/i })).toHaveAttribute(
      "href",
      "/expenses?group=grp-apt-4b&cycle=2024-09",
    );
    expect(
      within(nav).getByRole("link", { name: /Split Groups/i }),
    ).toHaveAttribute("href", "/split-groups?group=grp-apt-4b&cycle=2024-09");
    expect(within(nav).getByRole("link", { name: /Settings/i })).toHaveAttribute(
      "href",
      "/settings?group=grp-apt-4b&cycle=2024-09",
    );

    // Also switch cycle via Select dropdown
    const cycleSelect = screen.getByRole("button", {
      name: /Select billing cycle/i,
    });
    await user.click(cycleSelect);
    await user.click(screen.getByRole("option", { name: "October 2024" }));

    expect(replaceMock).toHaveBeenLastCalledWith(
      "/dashboard?cycle=2024-10&q=groceries&group=grp-apt-4b",
      { scroll: false },
    );
    expect(within(nav).getByRole("link", { name: /Expenses/i })).toHaveAttribute(
      "href",
      "/expenses?group=grp-apt-4b&cycle=2024-10",
    );
  });

  it("opens User Profile menu, navigates to Settings, and submits POST /auth/signout on Sign Out", async () => {
    const user = userEvent.setup();
    renderShell();

    const signOutForm = document.querySelector(
      'form[action="/auth/signout"][method="POST"]',
    ) as HTMLFormElement | null;
    expect(signOutForm).not.toBeNull();

    const submitSpy = vi.fn();
    if (signOutForm) {
      signOutForm.requestSubmit = submitSpy;
    }

    const profileTrigger = screen.getByRole("button", {
      name: "User profile menu",
    });

    await user.click(profileTrigger);
    await user.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(pushMock).toHaveBeenCalledWith("/settings");

    await user.click(profileTrigger);
    await user.click(screen.getByRole("menuitem", { name: "Sign Out" }));
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it("supports Global Search Cmd+K trigger, Notification Bell mark-all-read, Add Expense CTA, and Page Header LiveSyncPill (not in TopBar)", async () => {
    const user = userEvent.setup();
    const onAddExpense = vi.fn();
    render(
      <AppShell
        groups={TEST_GROUPS}
        user={TEST_USER}
        onAddExpense={onAddExpense}
        initialNotifications={[
          {
            id: "notif-1",
            title: "New Expense Logged",
            description: "Alex added Trader Joe's ($46.05 your share)",
            timestamp: "2h ago",
            unread: true,
          },
        ]}
      >
        <LiveSyncPill />
      </AppShell>,
    );

    // Live Sync pill lives in page header content, NOT inside <header> TopBar
    const topBar = document.querySelector("header");
    expect(topBar).not.toBeNull();
    expect(within(topBar as HTMLElement).queryByText("Live Sync")).not.toBeInTheDocument();
    expect(screen.getByText("Live Sync")).toBeInTheDocument();

    // Notification bell
    const notifBtn = screen.getByRole("button", {
      name: "Notifications (1 unread)",
    });
    await user.click(notifBtn);
    expect(screen.getByText("New Expense Logged")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(
      screen.getByRole("button", { name: "Notifications" }),
    ).toBeInTheDocument();

    // Add Expense CTA
    await user.click(screen.getByRole("button", { name: "Add Expense" }));
    expect(onAddExpense).toHaveBeenCalledTimes(1);

    // Cmd+K Global Search
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const searchDialog = screen.getByRole("dialog", { name: "Quick Search" });
    expect(searchDialog).toBeInTheDocument();
    await user.click(
      within(searchDialog).getByRole("button", { name: /Tahoe Ski Trip/i }),
    );
    expect(pushMock).toHaveBeenCalledWith("/split-groups?group=grp-tahoe");
  });
});
