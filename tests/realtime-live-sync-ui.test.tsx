// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import {
  act,
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

type PostgresHandler = (payload: {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}) => void;

interface MockChannel {
  on: (
    event: string,
    filter: { event: string; schema: string; table: string; filter?: string },
    cb: PostgresHandler,
  ) => MockChannel;
  subscribe: (cb: (status: string) => void) => MockChannel;
}

const channelListeners = new Map<string, PostgresHandler[]>();
let subscribeStatusCallback: ((status: string) => void) | null = null;
const removeChannelMock = vi.fn(async () => "ok");
const setAuthMock = vi.fn();
const getSessionMock = vi.fn(async () => ({
  data: { session: { access_token: "test-jwt-token" } },
}));

function resetRealtimeMocks() {
  channelListeners.clear();
  subscribeStatusCallback = null;
  removeChannelMock.mockClear();
  setAuthMock.mockClear();
  getSessionMock.mockClear();
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
    refresh: refreshMock,
    prefetch: vi.fn(),
  }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams("group=grp-apt-4b&cycle=2026-11"),
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

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: getSessionMock },
    realtime: { setAuth: setAuthMock },
    removeChannel: removeChannelMock,
    channel: () => {
      const ch: MockChannel = {
        on: (_event, filter, cb) => {
          const list = channelListeners.get(filter.table) ?? [];
          list.push(cb);
          channelListeners.set(filter.table, list);
          return ch;
        },
        subscribe: (cb) => {
          subscribeStatusCallback = cb;
          return ch;
        },
      };
      return ch;
    },
  }),
}));

import { AppShell, REALTIME_LEDGER_CHANGE_EVENT } from "@/components/shell";
import type {
  RealtimeLedgerChangeDetail,
  ShellGroupSummary,
  ShellNotificationItem,
  ShellUserSummary,
} from "@/components/shell";

const GROUPS: ShellGroupSummary[] = [
  {
    id: "grp-apt-4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b-roommates",
    groupType: "RESIDENTIAL",
    status: "ACTIVE",
    baseCurrency: "USD",
    activeSplitCount: 3,
    members: [
      { id: "usr-elena", name: "Elena Rostova" },
      { id: "usr-alex", name: "Alex Rivera" },
    ],
  },
];

const USER: ShellUserSummary = {
  id: "usr-elena",
  fullName: "Elena Rostova",
  email: "elena@example.com",
};

function emitRealtimeTableEvent(
  table: string,
  payload: {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    new?: Record<string, unknown>;
    old?: Record<string, unknown>;
  },
) {
  const handlers = channelListeners.get(table) ?? [];
  for (const h of handlers) {
    h(payload);
  }
}

describe("Supabase Realtime Notifications & Ledger Refresh", () => {
  const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
    replaceMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
    resetRealtimeMocks();
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (origUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
    if (origKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origKey;
  });

  it(
    "streams live notifications into TopBar Notification Bell with unread dot, single-item click, and Mark all read",
    { timeout: 15000 },
    async () => {
      const user = userEvent.setup();
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const initialNotifications: ShellNotificationItem[] = [
        {
          id: "notif-initial-1",
          type: "REMINDER_NUDGE",
          title: "Settlement reminder",
          description: "Alex sent you a reminder for $40.00.",
          timestamp: "Nov 27, 10:00 AM",
          createdAt: "2026-11-27T10:00:00.000Z",
          unread: true,
          href: "/dashboard?group=grp-apt-4b",
        },
      ];

      render(
        <AppShell
          groups={GROUPS}
          user={USER}
          initialNotifications={initialNotifications}
        >
          <div>Dashboard body</div>
        </AppShell>,
      );

      await waitFor(() => {
        expect(subscribeStatusCallback).not.toBeNull();
      });
      act(() => {
        subscribeStatusCallback?.("SUBSCRIBED");
      });

      expect(setAuthMock).toHaveBeenCalledWith("test-jwt-token");

      // Initially 1 unread with red indicator dot
      expect(
        screen.getByRole("button", { name: "Notifications (1 unread)" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("notification-unread-dot")).toBeInTheDocument();

      // Realtime INSERT delivers a NEW_EXPENSE and SETTLEMENT_CONFIRMATION without page reload
      act(() => {
        emitRealtimeTableEvent("notifications", {
          eventType: "INSERT",
          new: {
            id: "notif-live-expense",
            type: "NEW_EXPENSE",
            title: "New Expense Logged",
            description: 'Alex added "Whole Foods" in Apt 4B ($90.00).',
            delta_cents: 4500,
            currency: "USD",
            href: "/expenses?group=grp-apt-4b&cycle=2026-11",
            is_read: false,
            created_at: "2026-11-27T12:00:00.000Z",
          },
        });
        emitRealtimeTableEvent("notifications", {
          eventType: "INSERT",
          new: {
            id: "notif-live-settlement",
            type: "SETTLEMENT_CONFIRMATION",
            title: "Settlement confirmed",
            description: "Alex recorded a $40.00 settlement in Apt 4B.",
            delta_cents: 4000,
            currency: "USD",
            href: "/dashboard?group=grp-apt-4b",
            is_read: false,
            created_at: "2026-11-27T12:05:00.000Z",
          },
        });
      });

      const bellBtn = screen.getByRole("button", {
        name: "Notifications (3 unread)",
      });
      await user.click(bellBtn);

      const popover = screen.getByRole("region", { name: "Notifications" });
      expect(within(popover).getByText("3 unread")).toBeInTheDocument();
      expect(within(popover).getByText("New Expense Logged")).toBeInTheDocument();
      expect(within(popover).getByText("Settlement confirmed")).toBeInTheDocument();
      expect(within(popover).getByText("Settlement reminder")).toBeInTheDocument();

      // Clicking a single notification marks it read and navigates to its href
      await user.click(
        within(popover).getByRole("button", { name: /New Expense Logged/i }),
      );
      expect(pushMock).toHaveBeenCalledWith(
        "/expenses?group=grp-apt-4b&cycle=2026-11",
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ ids: ["notif-live-expense"] }),
        }),
      );

      // Reopen bell -> 2 unread remaining, click Mark all read
      await user.click(
        screen.getByRole("button", { name: "Notifications (2 unread)" }),
      );
      const reopened = screen.getByRole("region", { name: "Notifications" });
      await user.click(
        within(reopened).getByRole("button", { name: "Mark all read" }),
      );

      expect(
        screen.getByRole("button", { name: "Notifications" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("notification-unread-dot"),
      ).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/notifications",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({}),
        }),
      );
    },
  );

  it("triggers live ledger refresh and custom event when expenses, expense_revisions, or settlements arrive over Realtime", async () => {
    render(
      <AppShell groups={GROUPS} user={USER}>
        <div>Dashboard body</div>
      </AppShell>,
    );

    await waitFor(() => {
      expect(subscribeStatusCallback).not.toBeNull();
    });

    const receivedEvents: RealtimeLedgerChangeDetail[] = [];
    const listener = (e: Event) => {
      receivedEvents.push((e as CustomEvent<RealtimeLedgerChangeDetail>).detail);
    };
    window.addEventListener(REALTIME_LEDGER_CHANGE_EVENT, listener);

    act(() => {
      emitRealtimeTableEvent("expenses", {
        eventType: "INSERT",
        new: { id: "exp-new-1", group_id: "grp-apt-4b", amount_cents: 6000 },
      });
      emitRealtimeTableEvent("expense_revisions", {
        eventType: "INSERT",
        new: { id: "rev-new-1", expense_id: "exp-new-1" },
      });
      emitRealtimeTableEvent("settlements", {
        eventType: "INSERT",
        new: { id: "set-new-1", group_id: "grp-apt-4b", amount_cents: 3000 },
      });
    });

    expect(receivedEvents.map((e) => e.table)).toEqual([
      "expenses",
      "expense_revisions",
      "settlements",
    ]);

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });

    window.removeEventListener(REALTIME_LEDGER_CHANGE_EVENT, listener);
  });
});
