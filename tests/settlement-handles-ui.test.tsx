// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams("group=all&cycle=2026-11"),
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
import { SettingsClient } from "@/components/settings";
import type { SettingsUserProfile } from "@/lib/settings/service";
import type { SettlementHandleItem } from "@/lib/settings/settlement-handles";

const INITIAL_PROFILE: SettingsUserProfile = {
  id: "u-jordan",
  fullName: "Jordan Doe",
  email: "jordan.davis@fastmail.com",
  avatarUrl: null,
  phoneNumber: "+1 (415) 890-3412",
  timezone: "America/Los_Angeles",
  displayCurrency: "USD",
  personalShareCapCents: 160_000,
  autoIncludeInExpenses: true,
  notificationPrefs: {
    new_expense_added: true,
    settlement_recorded: true,
    cycle_close_reminder: true,
    monthly_summary_digest: false,
  },
  createdAt: "2024-03-15T10:00:00.000Z",
};

const INITIAL_HANDLES: SettlementHandleItem[] = [
  {
    id: "sh-venmo",
    userId: "u-jordan",
    provider: "VENMO",
    handle: "@jordan-davis",
    displayNote: "Personal Venmo",
    isDefault: true,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "sh-zelle",
    userId: "u-jordan",
    provider: "ZELLE",
    handle: "+1 (415) 890-3412",
    displayNote: null,
    isDefault: false,
    createdAt: "2026-11-02T10:00:00.000Z",
    updatedAt: "2026-11-02T10:00:00.000Z",
  },
];

const SHELL_GROUPS: ShellGroupSummary[] = [
  {
    id: "grp-apt4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b-roommates",
    groupType: "RESIDENTIAL",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    activeSplitCount: 1,
    members: [{ id: "u-jordan", name: "Jordan Doe", sharePercentage: 100 }],
  },
];

const SHELL_USER: ShellUserSummary = {
  id: "u-jordan",
  fullName: "Jordan Doe",
  email: "jordan.davis@fastmail.com",
  displayCurrency: "USD",
  baseCurrency: "USD",
  personalShareCapCents: 160_000,
  autoIncludeInExpenses: true,
};

function renderSettings(handles: SettlementHandleItem[] = INITIAL_HANDLES) {
  return render(
    <AppShell groups={SHELL_GROUPS} user={SHELL_USER} initialGroupId="all">
      <SettingsClient
        initialProfile={INITIAL_PROFILE}
        initialSettlementHandles={handles}
        groupCount={1}
        balances={[]}
      />
    </AppShell>,
  );
}

beforeEach(() => {
  replaceMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Settings — Settlement Handles CRUD UI, Modal & Default Menu", () => {
  it("renders Settlement Handles card with Default badge only on the active default handle", () => {
    renderSettings();

    const card = screen.getByTestId("settlement-handles-card");
    expect(
      within(card).getByRole("heading", { name: "Settlement Handles" }),
    ).toBeInTheDocument();

    const venmoRow = screen.getByTestId("settlement-handle-row-sh-venmo");
    const zelleRow = screen.getByTestId("settlement-handle-row-sh-zelle");

    expect(venmoRow).toHaveAttribute("data-default", "true");
    expect(within(venmoRow).getByText("Venmo")).toBeInTheDocument();
    expect(within(venmoRow).getByText("Default")).toBeInTheDocument();
    expect(within(venmoRow).getByText("@jordan-davis")).toBeInTheDocument();

    expect(zelleRow).toHaveAttribute("data-default", "false");
    expect(within(zelleRow).getByText("Zelle")).toBeInTheDocument();
    expect(within(zelleRow).queryByText("Default")).not.toBeInTheDocument();
    expect(within(zelleRow).getByText("+1 (415) 890-3412")).toBeInTheDocument();
  });

  it("adds a new Cash App handle via Add Settlement Handle modal and moves Default badge when toggled on", async () => {
    const user = userEvent.setup();
    const createdHandle: SettlementHandleItem = {
      id: "sh-cashapp",
      userId: "u-jordan",
      provider: "CASH_APP",
      handle: "$jordandavis",
      displayNote: "Main Cash App",
      isDefault: true,
      createdAt: "2026-11-03T10:00:00.000Z",
      updatedAt: "2026-11-03T10:00:00.000Z",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        handle: createdHandle,
        handles: [
          createdHandle,
          { ...INITIAL_HANDLES[0], isDefault: false },
          INITIAL_HANDLES[1],
        ],
      }),
    } as Response);

    renderSettings();

    await user.click(screen.getByRole("button", { name: /Add Handle/i }));

    const dialog = screen.getByRole("dialog", {
      name: "Add Settlement Handle",
    });
    expect(dialog).toBeInTheDocument();

    // Select Cash App provider
    const providerTrigger = within(dialog).getByRole("button", {
      name: /Provider/i,
    });
    await user.click(providerTrigger);
    await user.click(within(dialog).getByRole("option", { name: "Cash App" }));

    // Fill Handle / Account Tag & Display Note
    await user.type(
      within(dialog).getByLabelText(/Handle \/ Account Tag/i),
      "$jordandavis",
    );
    await user.type(
      within(dialog).getByLabelText(/Display Note/i),
      "Main Cash App",
    );

    // Toggle Set as default handle ON
    const defaultSwitch = within(dialog).getByRole("switch", {
      name: /Set as default handle/i,
    });
    expect(defaultSwitch).toHaveAttribute("aria-checked", "false");
    await user.click(defaultSwitch);
    expect(defaultSwitch).toHaveAttribute("aria-checked", "true");

    // Delete button should not appear in Add mode
    expect(
      within(dialog).queryByRole("button", { name: /^Delete$/i }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Save Handle" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/settings/settlement-handles",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    const sentBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(sentBody).toEqual({
      provider: "CASH_APP",
      handle: "$jordandavis",
      display_note: "Main Cash App",
      is_default: true,
    });

    // Cash App row now carries the exclusive Default badge
    const cashAppRow = screen.getByTestId("settlement-handle-row-sh-cashapp");
    const venmoRow = screen.getByTestId("settlement-handle-row-sh-venmo");
    expect(within(cashAppRow).getByText("Default")).toBeInTheDocument();
    expect(within(venmoRow).queryByText("Default")).not.toBeInTheDocument();
  });

  it("switches default handle via ⋮ menu Set as Default action", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        handle: { ...INITIAL_HANDLES[1], isDefault: true },
        handles: [
          { ...INITIAL_HANDLES[1], isDefault: true },
          { ...INITIAL_HANDLES[0], isDefault: false },
        ],
      }),
    } as Response);

    renderSettings();

    const zelleTrigger = screen.getByRole("button", {
      name: "Actions for Zelle +1 (415) 890-3412",
    });
    await user.click(zelleTrigger);

    const setDefaultItem = screen.getByRole("menuitem", {
      name: "Set as Default",
    });
    await user.click(setDefaultItem);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/settings/settlement-handles/sh-zelle",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ is_default: true }),
        }),
      );
    });

    const zelleRow = screen.getByTestId("settlement-handle-row-sh-zelle");
    const venmoRow = screen.getByTestId("settlement-handle-row-sh-venmo");
    expect(within(zelleRow).getByText("Default")).toBeInTheDocument();
    expect(within(venmoRow).queryByText("Default")).not.toBeInTheDocument();
  });

  it("edits and deletes a handle via ⋮ menu and Edit Settlement Handle modal", async () => {
    const user = userEvent.setup();
    const updatedVenmo: SettlementHandleItem = {
      ...INITIAL_HANDLES[0],
      handle: "@jordan-updated",
    };

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          handle: updatedVenmo,
          handles: [updatedVenmo, INITIAL_HANDLES[1]],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          deletedId: "sh-venmo",
          handles: [INITIAL_HANDLES[1]],
        }),
      } as Response);

    renderSettings();

    // Open Edit Handle via ⋮ menu
    await user.click(
      screen.getByRole("button", { name: "Actions for Venmo @jordan-davis" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Edit Handle" }));

    const dialog = screen.getByRole("dialog", {
      name: "Edit Settlement Handle",
    });
    const handleInput = within(dialog).getByLabelText(
      /Handle \/ Account Tag/i,
    ) as HTMLInputElement;
    expect(handleInput.value).toBe("@jordan-davis");

    await user.clear(handleInput);
    await user.type(handleInput, "@jordan-updated");
    await user.click(within(dialog).getByRole("button", { name: "Save Handle" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/settings/settlement-handles/sh-venmo",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    expect(screen.getByText("@jordan-updated")).toBeInTheDocument();

    // Re-open Edit Handle modal and click Delete inside modal footer
    await user.click(
      screen.getByRole("button", { name: "Actions for Venmo @jordan-updated" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Edit Handle" }));

    const editDialog = screen.getByRole("dialog", {
      name: "Edit Settlement Handle",
    });
    await user.click(within(editDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/settings/settlement-handles/sh-venmo",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    expect(
      screen.queryByTestId("settlement-handle-row-sh-venmo"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("settlement-handle-row-sh-zelle"),
    ).toBeInTheDocument();
  });

  it("deletes a handle directly from the ⋮ menu and renders empty state when none remain", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        deletedId: "sh-venmo",
        handles: [],
      }),
    } as Response);

    renderSettings([INITIAL_HANDLES[0]]);

    await user.click(
      screen.getByRole("button", { name: "Actions for Venmo @jordan-davis" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/settings/settlement-handles/sh-venmo",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    expect(
      screen.getByText(/No settlement handles configured yet/i),
    ).toBeInTheDocument();
  });
});
