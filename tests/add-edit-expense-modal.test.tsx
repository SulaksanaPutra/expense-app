// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const pushMock = vi.fn();
const refreshMock = vi.fn();
let mockPathname = "/dashboard";
let mockSearchParams = new URLSearchParams("cycle=2026-11&group=grp-apt-4b");

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
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { RECEIPT_STORAGE_QUOTA_BYTES } from "@/lib/expenses/split-engine";

const THREE_MEMBER_GROUPS: ShellGroupSummary[] = [
  {
    id: "grp-apt-4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b",
    groupType: "RESIDENTIAL",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    activeSplitCount: 2,
    members: [
      { id: "usr-alex", name: "Alex Rivera", sharePercentage: 33.34 },
      { id: "usr-elena", name: "Elena Rostova", sharePercentage: 33.33 },
      { id: "usr-marcus", name: "Marcus Vance", sharePercentage: 33.33 },
    ],
  },
  {
    id: "grp-tokyo",
    name: "Tokyo Trip",
    slug: "tokyo-trip",
    groupType: "TRIP",
    status: "ACTIVE",
    baseCurrency: "EUR",
    defaultSplitMode: "CUSTOM_RATIOS",
    activeSplitCount: 0,
    members: [
      { id: "usr-alex", name: "Alex Rivera", sharePercentage: 60 },
      { id: "usr-elena", name: "Elena Rostova", sharePercentage: 40 },
    ],
  },
];

const CURRENT_USER: ShellUserSummary = {
  id: "usr-alex",
  fullName: "Alex Rivera",
  email: "alex@example.com",
  receiptStorageUsedBytes: 0,
};

beforeEach(() => {
  mockPathname = "/dashboard";
  mockSearchParams = new URLSearchParams("cycle=2026-11&group=grp-apt-4b");
  replaceMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("AddEditExpenseModal (create mode) & Entry Point Triggers", () => {
  it("opens from Dashboard Quick Add, assigns $100.00 3 ways as 3334/3333/3333 cents, and keeps Save Expense disabled until valid", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          expense: {
            id: "exp-100",
            group_id: "grp-apt-4b",
            description: "Whole Foods Market",
            amount_cents: 10000,
            currency: "USD",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <AppShell groups={THREE_MEMBER_GROUPS} user={CURRENT_USER}>
        <DashboardClient initialExpenses={[]} currentUserId="usr-alex" />
      </AppShell>,
    );

    await user.click(screen.getAllByRole("button", { name: /Quick Add/i })[0]);

    const dialog = screen.getByRole("dialog", { name: "Add Expense" });
    expect(dialog).toHaveTextContent("Logging to Apt 4B Roommates");

    const saveBtn = within(dialog).getByRole("button", {
      name: /Save Expense/i,
    });
    expect(saveBtn).toBeDisabled();

    // Enter $100.00
    const amountInput = within(dialog).getByLabelText(/Total Bill Amount/i);
    await user.type(amountInput, "100.00");

    // Verify deterministic payer-first penny rounding: payer Alex = $33.34 (33.34%), Elena & Marcus = $33.33 (33.33%)
    expect(within(dialog).getByTestId("split-share-usr-alex")).toHaveTextContent(
      "$33.34 (33.34%)",
    );
    expect(
      within(dialog).getByTestId("split-share-usr-elena"),
    ).toHaveTextContent("$33.33 (33.33%)");
    expect(
      within(dialog).getByTestId("split-share-usr-marcus"),
    ).toHaveTextContent("$33.33 (33.33%)");

    // Still disabled without description
    expect(saveBtn).toBeDisabled();

    // Enter description -> Save Expense becomes enabled
    await user.type(
      within(dialog).getByLabelText(/Description/i),
      "Whole Foods Market",
    );
    expect(saveBtn).toBeEnabled();
    expect(saveBtn).toHaveTextContent("Save Expense ($100.00)");

    await user.click(saveBtn);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/groups/grp-apt-4b/expenses");
    const sentBody = JSON.parse(String(init?.body));
    expect(sentBody.amount_cents).toBe(10000);
    expect(sentBody.split_method).toBe("EQUAL");
    expect(sentBody.split_breakdown).toEqual([
      { user_id: "usr-alex", share_cents: 3334, percentage: 33.34 },
      { user_id: "u-elena".replace("u-", "usr-"), share_cents: 3333, percentage: 33.33 },
      { user_id: "usr-marcus", share_cents: 3333, percentage: 33.33 },
    ]);
  });

  it("disables Save Expense on By Percentage / Exact Amounts mismatch and enables once balanced", async () => {
    const user = userEvent.setup();

    render(
      <AppShell groups={THREE_MEMBER_GROUPS} user={CURRENT_USER}>
        <div>Workspace</div>
      </AppShell>,
    );

    // Open via Top Bar + Add Expense CTA
    await user.click(screen.getByRole("button", { name: "Add Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Add Expense" });

    await user.type(within(dialog).getByLabelText(/Total Bill Amount/i), "120.00");
    await user.type(
      within(dialog).getByLabelText(/Description/i),
      "Utilities Bill",
    );

    const saveBtn = within(dialog).getByRole("button", {
      name: /Save Expense/i,
    });
    expect(saveBtn).toBeEnabled();

    // Switch to Exact Amounts
    await user.click(within(dialog).getByRole("tab", { name: "Exact Amounts" }));
    const alexExact = within(dialog).getByLabelText("Alex Rivera exact amount");
    await user.clear(alexExact);
    await user.type(alexExact, "50.00");

    // Seeded was 40/40/40 -> now 50 + 40 + 40 = 130 != 120 -> Save Expense must be disabled
    expect(saveBtn).toBeDisabled();
    expect(within(dialog).getByTestId("split-balance-bar")).toHaveTextContent(
      "Over by $10.00",
    );

    // Balance Elena to 30.00 (50 + 30 + 40 = 120.00) -> Save Expense re-enables
    const elenaExact = within(dialog).getByLabelText("Elena Rostova exact amount");
    await user.clear(elenaExact);
    await user.type(elenaExact, "30.00");
    expect(within(dialog).getByTestId("split-balance-bar")).toHaveTextContent(
      "Fully Balanced",
    );
    expect(saveBtn).toBeEnabled();

    // Switch to By Percentage and make total != 100%
    await user.click(within(dialog).getByRole("tab", { name: "By Percentage" }));
    const alexPct = within(dialog).getByLabelText("Alex Rivera percentage");
    await user.clear(alexPct);
    await user.type(alexPct, "50");
    expect(saveBtn).toBeDisabled();
    expect(within(dialog).getByTestId("split-balance-bar")).toHaveTextContent(
      "116.66% of 100.00%",
    );
  });

  it("prompts group selection when All Groups is active and shows non-blocking 500 MB receipt warning", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams("cycle=2026-11&group=all");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          expense: {
            id: "exp-101",
            group_id: "grp-apt-4b",
            description: "Hardware Store",
            amount_cents: 5000,
            currency: "USD",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <AppShell
        groups={THREE_MEMBER_GROUPS}
        user={{
          ...CURRENT_USER,
          receiptStorageUsedBytes: RECEIPT_STORAGE_QUOTA_BYTES,
        }}
      >
        <div>Workspace</div>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Add Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Add Expense" });
    expect(dialog).toHaveTextContent("Select a split group to log an expense");

    // Choose Apt 4B Roommates
    await user.click(within(dialog).getByRole("button", { name: /Split Group/i }));
    await user.click(
      within(dialog).getByRole("option", { name: /Apt 4B Roommates/i }),
    );
    expect(dialog).toHaveTextContent("Logging to Apt 4B Roommates");

    // Click Attach Receipt when storage is full -> non-blocking warning banner
    await user.click(within(dialog).getByRole("button", { name: /Attach Receipt/i }));
    expect(
      within(dialog).getByText(
        "Receipt storage full (500 MB). Expense will be logged without receipt.",
      ),
    ).toBeInTheDocument();

    // User can still log expense without receipt
    await user.type(within(dialog).getByLabelText(/Total Bill Amount/i), "50.00");
    await user.type(
      within(dialog).getByLabelText(/Description/i),
      "Hardware Store",
    );
    const saveBtn = within(dialog).getByRole("button", {
      name: /Save Expense/i,
    });
    expect(saveBtn).toBeEnabled();
    await user.click(saveBtn);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(String(init?.body)).receipt_url).toBeNull();
  });

  it("supports toggling member checkboxes to recalculate shares in real time and foreign-currency override", async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, from: "EUR", to: "USD", rate: 1.08, source: "API" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <AppShell groups={THREE_MEMBER_GROUPS} user={CURRENT_USER}>
        <div>Workspace</div>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Add Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Add Expense" });

    await user.type(within(dialog).getByLabelText(/Total Bill Amount/i), "100.00");

    // Uncheck Marcus -> 2-way split ($50.00 each)
    const marcusCheckbox = within(dialog).getByLabelText(
      "Include Marcus Vance in split",
    );
    fireEvent.click(marcusCheckbox);
    expect(within(dialog).getByTestId("split-share-usr-alex")).toHaveTextContent(
      "$50.00 (50%)",
    );
    expect(
      within(dialog).getByTestId("split-share-usr-elena"),
    ).toHaveTextContent("$50.00 (50%)");

    // Switch currency to EUR and verify FX conversion preview
    await user.click(within(dialog).getByRole("button", { name: /Currency/i }));
    await user.click(within(dialog).getByRole("option", { name: /EUR/i }));

    expect(
      await within(dialog).findByText("$108.00 USD"),
    ).toBeInTheDocument();
  });

  it("fetches spot rate on foreign currency, switches to MANUAL_OVERRIDE on edit, recalculates splits, and submits FX audit fields", async () => {
    const user = userEvent.setup();

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/api/fx")) {
          return new Response(
            JSON.stringify({ ok: true, from: "EUR", to: "USD", rate: 1.08, source: "API" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            expense: {
              id: "exp-fx-1",
              group_id: "grp-apt-4b",
              description: "Paris Hotel",
              amount_cents: 12500,
              currency: "USD",
              original_amount_cents: 10000,
              original_currency: "EUR",
              exchange_rate: 1.25,
              exchange_rate_source: "MANUAL_OVERRIDE",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      });

    render(
      <AppShell groups={THREE_MEMBER_GROUPS} user={CURRENT_USER}>
        <div>Workspace</div>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Add Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Add Expense" });

    await user.type(within(dialog).getByLabelText(/Total Bill Amount/i), "100.00");
    await user.type(within(dialog).getByLabelText(/Description/i), "Paris Hotel");

    // Select EUR -> fetches spot rate 1.08, marks API Spot Rate, previews $108.00 USD
    await user.click(within(dialog).getByRole("button", { name: /Currency/i }));
    await user.click(within(dialog).getByRole("option", { name: /EUR/i }));

    expect(await within(dialog).findByText("$108.00 USD")).toBeInTheDocument();
    expect(within(dialog).getByTestId("fx-rate-source-badge")).toHaveTextContent(
      "API Spot Rate",
    );
    expect(within(dialog).getByTestId("split-share-usr-alex")).toHaveTextContent(
      "$36.00 (33.34%)",
    );

    // Edit Exchange Rate -> marks Manual Override & recalculates 3-way splits ($125.00 -> 4167 / 4167 / 4166)
    const rateInput = within(dialog).getByRole("textbox", {
      name: /Exchange Rate/i,
    });
    await user.clear(rateInput);
    await user.type(rateInput, "1.25");

    expect(within(dialog).getByTestId("fx-rate-source-badge")).toHaveTextContent(
      "Manual Override",
    );
    expect(within(dialog).getByTestId("fx-base-total")).toHaveTextContent(
      "$125.00 USD",
    );
    expect(within(dialog).getByTestId("split-share-usr-alex")).toHaveTextContent(
      "$41.67 (33.34%)",
    );
    expect(within(dialog).getByTestId("split-share-usr-elena")).toHaveTextContent(
      "$41.67 (33.33%)",
    );
    expect(within(dialog).getByTestId("split-share-usr-marcus")).toHaveTextContent(
      "$41.66 (33.33%)",
    );

    const saveBtn = within(dialog).getByRole("button", {
      name: /Save Expense/i,
    });
    expect(saveBtn).toHaveTextContent("Save Expense ($125.00)");
    await user.click(saveBtn);

    const postCall = fetchSpy.mock.calls.find(([u]) =>
      String(u).includes("/expenses"),
    );
    expect(postCall).toBeDefined();
    const sentBody = JSON.parse(String(postCall?.[1]?.body));
    expect(sentBody.amount_cents).toBe(12500);
    expect(sentBody.original_amount_cents).toBe(10000);
    expect(sentBody.original_currency).toBe("EUR");
    expect(sentBody.exchange_rate).toBe(1.25);
    expect(sentBody.exchange_rate_source).toBe("MANUAL_OVERRIDE");
    expect(sentBody.split_breakdown).toEqual([
      { user_id: "usr-alex", share_cents: 4167, percentage: 33.34 },
      { user_id: "usr-elena", share_cents: 4167, percentage: 33.33 },
      { user_id: "usr-marcus", share_cents: 4166, percentage: 33.33 },
    ]);
  });

  it("handles FX API failure gracefully, validates manual exchange rate, and restores API rate on refresh", async () => {
    const user = userEvent.setup();
    let fxAttempt = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/api/fx")) {
        fxAttempt += 1;
        if (fxAttempt === 1) {
          return new Response(JSON.stringify({ error: "Upstream unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ ok: true, from: "JPY", to: "USD", rate: 0.0067, source: "API" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "Unexpected call" }), {
        status: 500,
      });
    });

    render(
      <AppShell groups={THREE_MEMBER_GROUPS} user={CURRENT_USER}>
        <div>Workspace</div>
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Add Expense" }));
    const dialog = screen.getByRole("dialog", { name: "Add Expense" });

    await user.type(within(dialog).getByLabelText(/Total Bill Amount/i), "10000");
    await user.click(within(dialog).getByRole("button", { name: /Currency/i }));
    await user.click(within(dialog).getByRole("option", { name: /JPY/i }));

    expect(
      await within(dialog).findByText(
        "Live spot rate unavailable. Enter an exchange rate manually.",
      ),
    ).toBeInTheDocument();

    const saveBtn = within(dialog).getByRole("button", {
      name: /Save Expense/i,
    });
    expect(saveBtn).toBeDisabled();

    // Enter invalid rate 0 and blur -> validation message shown
    const rateInput = within(dialog).getByRole("textbox", {
      name: /Exchange Rate/i,
    });
    await user.type(rateInput, "0");
    fireEvent.blur(rateInput);
    expect(
      within(dialog).getByText("Enter a positive exchange rate (e.g. 1.085)."),
    ).toBeInTheDocument();
    expect(saveBtn).toBeDisabled();

    // Click refresh button -> restores API Spot Rate for JPY -> USD
    await user.click(
      within(dialog).getByRole("button", { name: "Refresh spot exchange rate" }),
    );
    expect(await within(dialog).findByText("$67.00 USD")).toBeInTheDocument();
    expect(within(dialog).getByTestId("fx-rate-source-badge")).toHaveTextContent(
      "API Spot Rate",
    );
  });
});
