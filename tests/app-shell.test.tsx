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
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  buildShellHref,
  formatCycleLabel,
  mergeShellSearchParams,
  parseCycleParam,
  parseGroupParam,
  stepCycleSlug,
} from "@/components/shell";
import type {
  ShellGroupSummary,
  ShellNotificationItem,
  ShellUserSummary,
} from "@/components/shell";

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
  fullName: "Jordan Doe",
  email: "jordan.doe@ledgersplit.app",
  displayCurrency: "USD",
};

const TEST_NOTIFICATIONS: ShellNotificationItem[] = [
  {
    id: "notif-1",
    type: "NEW_EXPENSE",
    title: 'Marcus Kim added "ConEdison Electric"',
    description: "$140.00 · Apartment 4B Shared",
    timestamp: "2h ago",
    unread: true,
    href: "/expenses?group=grp-apt-4b",
  },
  {
    id: "notif-2",
    type: "SETTLEMENT_CONFIRMATION",
    title: "Alex Lee marked $120.00 as settled",
    description: "Apartment 4B Shared",
    timestamp: "Nov 19",
    unread: false,
    href: "/dashboard?group=grp-apt-4b",
  },
];

function renderShell(overrides?: Partial<React.ComponentProps<typeof AppShell>>) {
  return render(
    <AppShell
      groups={TEST_GROUPS}
      user={TEST_USER}
      initialNotifications={TEST_NOTIFICATIONS}
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

describe("AppShell v2", () => {
  it("renders Sidebar without SHARED pill or LiveSyncPill, highlights active route, and shows live non-archived group count", () => {
    mockPathname = "/expenses";
    renderShell();

    const sidebar = screen.getByTestId("desktop-sidebar");
    expect(within(sidebar).queryByText("SHARED")).not.toBeInTheDocument();
    expect(screen.queryByText("Live Sync")).not.toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const expensesLink = within(nav).getByRole("link", { name: /Expenses/i });
    const dashboardLink = within(nav).getByRole("link", { name: /Dashboard/i });
    const splitGroupsLink = within(nav).getByRole("link", {
      name: /Split Groups/i,
    });
    const settingsLink = within(nav).getByRole("link", { name: /Settings/i });

    expect(expensesLink).toHaveAttribute("aria-current", "page");
    expect(expensesLink).toHaveClass(
      "bg-primary-container",
      "text-on-primary",
      "rounded-full",
    );
    expect(dashboardLink).not.toHaveAttribute("aria-current");
    expect(settingsLink).toBeInTheDocument();
    // 2 non-archived groups (ARCHIVED excluded)
    expect(within(splitGroupsLink).getByText("2")).toBeInTheDocument();

    // ACTIVE GROUP card shows label and live split count pill
    expect(within(sidebar).getByText("ACTIVE GROUP")).toBeInTheDocument();
    expect(within(sidebar).getByText("6 splits")).toBeInTheDocument();
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

    // Reopen and close via backdrop click
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

    // Verify both prev and next billing cycle buttons render visibly
    const cyclePickerGroup = screen.getByRole("group", {
      name: "Billing cycle picker",
    });
    const prevCycleBtn = within(cyclePickerGroup).getByRole("button", {
      name: "Previous billing cycle",
    });
    const nextCycleBtn = within(cyclePickerGroup).getByRole("button", {
      name: "Next billing cycle",
    });

    // Step Cycle Picker backward (2024-10 -> 2024-09)
    await user.click(prevCycleBtn);
    expect(replaceMock).toHaveBeenLastCalledWith(
      "/dashboard?cycle=2024-09&q=groceries&group=grp-apt-4b",
      { scroll: false },
    );

    // Step Cycle Picker forward (2024-09 -> 2024-10)
    await user.click(nextCycleBtn);
    expect(replaceMock).toHaveBeenLastCalledWith(
      "/dashboard?cycle=2024-10&q=groceries&group=grp-apt-4b",
      { scroll: false },
    );

    // Step back again so downstream nav link assertions test 2024-09
    await user.click(prevCycleBtn);

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
  });

  it("supports Notifications popover All | Unread filtering and Mark all read", async () => {
    const user = userEvent.setup();
    renderShell();

    const bellBtn = screen.getByRole("button", {
      name: "Notifications (1 unread)",
    });
    expect(screen.getByTestId("notification-unread-dot")).toBeInTheDocument();

    await user.click(bellBtn);
    const popover = screen.getByRole("region", { name: "Notifications" });

    // Both read and unread items visible under "All"
    expect(within(popover).getByText("1 unread")).toBeInTheDocument();
    expect(
      within(popover).getByText(/Marcus Kim added "ConEdison Electric"/i),
    ).toBeInTheDocument();
    expect(
      within(popover).getByText(/Alex Lee marked \$120\.00 as settled/i),
    ).toBeInTheDocument();

    // Filter to "Unread (1)" -> only unread item visible
    const unreadTab = within(popover).getByRole("tab", {
      name: "Unread (1)",
    });
    await user.click(unreadTab);
    expect(
      within(popover).getByText(/Marcus Kim added "ConEdison Electric"/i),
    ).toBeInTheDocument();
    expect(
      within(popover).queryByText(/Alex Lee marked \$120\.00 as settled/i),
    ).not.toBeInTheDocument();

    // Mark all read clears unread count, removes dot, and shows empty unread state
    await user.click(
      within(popover).getByRole("button", { name: "Mark all read" }),
    );
    expect(
      screen.getByRole("button", { name: "Notifications" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("notification-unread-dot"),
    ).not.toBeInTheDocument();
    expect(
      within(popover).getByText("No unread notifications."),
    ).toBeInTheDocument();
  });

  it("opens User Account menu with user info, Default Currency, navigation links, shortcuts, export, and Sign Out", async () => {
    const user = userEvent.setup();
    renderShell({
      user: {
        id: "usr-1",
        fullName: "Jordan Doe",
        email: "jordan.doe@ledgersplit.app",
        displayCurrency: "EUR",
      },
      initialCycle: "2026-11",
    });

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
    const menu = screen.getByRole("menu", { name: "User account menu" });

    expect(within(menu).getByText("Jordan Doe")).toBeInTheDocument();
    expect(
      within(menu).getByText("jordan.doe@ledgersplit.app"),
    ).toBeInTheDocument();
    expect(within(menu).getByText("Default Currency")).toBeInTheDocument();
    expect(within(menu).getByText("EUR (€)")).toBeInTheDocument();

    // Account & Profile navigates to /settings
    await user.click(
      within(menu).getByRole("menuitem", { name: /Account & Profile/i }),
    );
    expect(pushMock).toHaveBeenCalledWith("/settings?cycle=2026-11");

    // Reopen and click Settings
    await user.click(profileTrigger);
    const menu2 = screen.getByRole("menu", { name: "User account menu" });
    await user.click(within(menu2).getByRole("menuitem", { name: "Settings" }));
    expect(pushMock).toHaveBeenLastCalledWith("/settings?cycle=2026-11");

    // Reopen and click Keyboard Shortcuts (⌘K) -> opens Quick Search dialog
    await user.click(profileTrigger);
    const menu3 = screen.getByRole("menu", { name: "User account menu" });
    await user.click(
      within(menu3).getByRole("menuitem", { name: /Keyboard Shortcuts/i }),
    );
    expect(
      screen.getByRole("dialog", { name: "Quick Search" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close dialog" }));

    // Reopen and click Export Monthly Ledger
    await user.click(profileTrigger);
    const menu4 = screen.getByRole("menu", { name: "User account menu" });
    await user.click(
      within(menu4).getByRole("menuitem", { name: /Export Monthly Ledger/i }),
    );
    expect(screen.getByText("Export started")).toBeInTheDocument();

    // Reopen and click Sign Out
    await user.click(profileTrigger);
    const menu5 = screen.getByRole("menu", { name: "User account menu" });
    await user.click(within(menu5).getByRole("menuitem", { name: "Sign Out" }));
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it("supports Global Search Cmd+K trigger and Add Expense CTA", async () => {
    const user = userEvent.setup();
    const onAddExpense = vi.fn();
    renderShell({ onAddExpense });

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
