// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const pushMock = vi.fn();
const refreshMock = vi.fn();
let mockPathname = "/dashboard";
let mockSearchParams = new URLSearchParams("group=grp-apt4b&cycle=2026-10");

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

import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { ExpensesClient } from "@/components/expenses";
import { SettingsClient } from "@/components/settings";
import { AppShell, type ShellGroupSummary } from "@/components/shell";
import type { ExpenseGroupInfo } from "@/lib/expenses/ledger";
import type { SettingsUserProfile } from "@/lib/settings/service";

const SHELL_GROUPS: ShellGroupSummary[] = [
  {
    id: "grp-apt4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b",
    groupType: "RESIDENTIAL",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    activeSplitCount: 1,
    members: [{ id: "u-alex", name: "Alex Rivera" }],
  },
];

const EXPENSE_GROUPS: ExpenseGroupInfo[] = [
  {
    id: "grp-apt4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: 300_000,
    billingCycleAnchorDay: 1,
    currentUserRole: "ADMIN",
    currentUserStatus: "ACTIVE",
    members: [
      {
        userId: "u-alex",
        name: "Alex Rivera",
        status: "ACTIVE",
        instantSettlementTag: null,
      },
    ],
  },
];

const SETTINGS_PROFILE: SettingsUserProfile = {
  id: "u-alex",
  fullName: "Alex Rivera",
  email: "alex@example.com",
  avatarUrl: null,
  phoneNumber: null,
  timezone: "America/Los_Angeles",
  displayCurrency: "USD",
  personalShareCapCents: null,
  autoIncludeInExpenses: true,
  notificationPrefs: {
    new_expense_added: true,
    settlement_recorded: true,
    cycle_close_reminder: true,
    monthly_summary_digest: false,
  },
  createdAt: "2024-01-15T10:00:00.000Z",
};

describe("Issue #89 — Export UI Triggers across Dashboard, Expenses, and Settings", () => {
  let clickedLinks: Array<{ href: string; download: string }> = [];

  beforeEach(() => {
    clickedLinks = [];
    mockPathname = "/dashboard";
    mockSearchParams = new URLSearchParams("group=grp-apt4b&cycle=2026-10");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedLinks.push({
        href: this.getAttribute("href") ?? "",
        download: this.getAttribute("download") ?? "",
      });
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("triggers scoped /api/expenses/export CSV download from Dashboard", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        groups={SHELL_GROUPS}
        user={{ id: "u-alex", fullName: "Alex Rivera", email: "alex@example.com" }}
      >
        <DashboardClient
          initialExpenses={[]}
          currentUserId="u-alex"
          userBaseCurrency="USD"
          initialGroups={EXPENSE_GROUPS}
        />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: /Export CSV/i }));
    expect(clickedLinks).toEqual([
      {
        href: "/api/expenses/export?group=grp-apt4b&cycle=2026-10&format=csv",
        download: "ledgersplit-apt-4b-2026-10.csv",
      },
    ]);
  });

  it("triggers scoped /api/expenses/export CSV download from Expenses", async () => {
    const user = userEvent.setup();
    mockPathname = "/expenses";
    mockSearchParams = new URLSearchParams("group=all&cycle=2026-11");

    render(
      <AppShell
        groups={SHELL_GROUPS}
        user={{ id: "u-alex", fullName: "Alex Rivera", email: "alex@example.com" }}
      >
        <ExpensesClient
          currentUserId="u-alex"
          userBaseCurrency="USD"
          personalShareCapCents={null}
          initialGroups={EXPENSE_GROUPS}
          initialExpenses={[]}
          initialSettlements={[]}
          initialBillingCycles={[]}
        />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: /Export CSV/i }));
    expect(clickedLinks).toEqual([
      {
        href: "/api/expenses/export?group=all&cycle=2026-11&format=csv",
        download: "ledgersplit-all-groups-2026-11.csv",
      },
    ]);
  });

  it("triggers full-history CSV and JSON downloads from Settings", async () => {
    const user = userEvent.setup();
    mockPathname = "/settings";

    render(
      <AppShell
        groups={SHELL_GROUPS}
        user={{ id: "u-alex", fullName: "Alex Rivera", email: "alex@example.com" }}
      >
        <SettingsClient
          initialProfile={SETTINGS_PROFILE}
          groupCount={1}
          balances={[]}
        />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "CSV" }));
    await user.click(screen.getByRole("button", { name: "JSON" }));

    expect(clickedLinks).toEqual([
      {
        href: "/api/settings/export?format=csv",
        download: "ledgersplit-full-ledger-history.csv",
      },
      {
        href: "/api/settings/export?format=json",
        download: "ledgersplit-full-ledger-history.json",
      },
    ]);
  });
});
