import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationPrefs } from "@/types/database";

const getUserMock = vi.fn();
const updateUserAuthMock = vi.fn();

interface InMemoryUserRow {
  id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  timezone: string;
  base_currency: string;
  display_currency: string;
  personal_share_cap_cents: number | null;
  auto_include_in_expenses: boolean;
  notification_prefs: NotificationPrefs;
  created_at: string;
}

interface InMemoryGroupRow {
  id: string;
  name: string;
  slug: string;
  group_type: "RESIDENTIAL" | "TRIP" | "RECURRING";
  status: "ACTIVE" | "NEEDS_RATIO_UPDATE" | "ARCHIVED";
  base_currency: string;
  default_split_mode: "EQUAL" | "CUSTOM_RATIOS";
  billing_cycle_anchor_day: number;
  created_at: string;
}

interface InMemoryMemberRow {
  group_id: string;
  user_id: string;
  role: "ADMIN" | "MEMBER";
  status: "ACTIVE" | "FORMER_MEMBER";
  share_percentage: number;
  joined_at: string;
}

interface InMemoryExpenseRow {
  id: string;
  group_id: string;
  created_by: string;
  paid_by: string;
  description: string;
  category: string;
  expense_date: string;
  amount_cents: number;
  currency: string;
  split_method: "EQUAL" | "PERCENTAGE" | "EXACT";
  split_breakdown: Array<{
    user_id: string;
    share_cents: number;
    percentage?: number;
  }>;
  receipt_url: string | null;
  adjustment_for_expense_id: string | null;
  is_locked: boolean;
  deleted_at: string | null;
}

interface InMemorySettlementRow {
  id: string;
  group_id: string;
  payer_id: string;
  recipient_id: string;
  amount_cents: number;
  currency: string;
  payment_rail: "VENMO" | "ZELLE" | "CASH_APP" | "CASH" | "OTHER";
  settled_at: string;
}

interface InMemoryBillingCycleRow {
  id: string;
  group_id: string;
  period_start: string;
  period_end: string;
  status: "OPEN" | "CLOSED";
}

interface InMemoryDb {
  users: InMemoryUserRow[];
  groups: InMemoryGroupRow[];
  group_members: InMemoryMemberRow[];
  expenses: InMemoryExpenseRow[];
  settlements: InMemorySettlementRow[];
  billing_cycles: InMemoryBillingCycleRow[];
}

function createInMemorySupabase(db: InMemoryDb) {
  type Filter = {
    col: string;
    val: unknown;
    op: "eq" | "neq" | "in" | "is";
  };

  function filterRows<T extends object>(rows: T[], filters: Filter[]): T[] {
    return rows.filter((row) =>
      filters.every((f) => {
        const value = (row as Record<string, unknown>)[f.col];
        if (f.op === "neq") return value !== f.val;
        if (f.op === "in" && Array.isArray(f.val)) {
          return f.val.includes(value);
        }
        return value === f.val;
      }),
    );
  }

  function makeTable<T extends object>(rows: T[]) {
    return {
      select() {
        const filters: Filter[] = [];
        const builder = {
          eq(col: string, val: unknown) {
            filters.push({ col, val, op: "eq" });
            return builder;
          },
          neq(col: string, val: unknown) {
            filters.push({ col, val, op: "neq" });
            return builder;
          },
          in(col: string, val: unknown[]) {
            filters.push({ col, val, op: "in" });
            return builder;
          },
          is(col: string, val: unknown) {
            filters.push({ col, val, op: "is" });
            return builder;
          },
          order() {
            return builder;
          },
          async maybeSingle() {
            const matched = filterRows(rows, filters);
            return { data: matched[0] ?? null, error: null };
          },
          then<TResult1 = { data: T[]; error: null }>(
            onfulfilled?:
              | ((value: {
                  data: T[];
                  error: null;
                }) => TResult1 | PromiseLike<TResult1>)
              | null,
          ) {
            const matched = filterRows(rows, filters);
            return Promise.resolve({ data: matched, error: null }).then(
              onfulfilled,
            );
          },
        };
        return builder;
      },
      update(patch: Record<string, unknown>) {
        const filters: Filter[] = [];
        const applyUpdate = () => {
          const matched = filterRows(rows, filters);
          for (const item of matched) {
            Object.assign(item, patch);
          }
          return matched;
        };

        const builder = {
          eq(col: string, val: unknown) {
            filters.push({ col, val, op: "eq" });
            return builder;
          },
          select() {
            return {
              async maybeSingle() {
                const matched = applyUpdate();
                return { data: matched[0] ?? null, error: null };
              },
            };
          },
          then<TResult1 = { data: T[]; error: null }>(
            onfulfilled?:
              | ((value: {
                  data: T[];
                  error: null;
                }) => TResult1 | PromiseLike<TResult1>)
              | null,
          ) {
            const matched = applyUpdate();
            return Promise.resolve({ data: matched, error: null }).then(
              onfulfilled,
            );
          },
        };
        return builder;
      },
      delete() {
        const filters: Filter[] = [];
        const applyDelete = () => {
          const matched = filterRows(rows, filters);
          const matchedSet = new Set(matched);
          const remaining = rows.filter((r) => !matchedSet.has(r));
          rows.splice(0, rows.length, ...remaining);
          return matched;
        };
        const builder = {
          eq(col: string, val: unknown) {
            filters.push({ col, val, op: "eq" });
            return builder;
          },
          then<TResult1 = { data: T[]; error: null }>(
            onfulfilled?:
              | ((value: {
                  data: T[];
                  error: null;
                }) => TResult1 | PromiseLike<TResult1>)
              | null,
          ) {
            const matched = applyDelete();
            return Promise.resolve({ data: matched, error: null }).then(
              onfulfilled,
            );
          },
        };
        return builder;
      },
    };
  }

  return {
    auth: {
      getUser: getUserMock,
      updateUser: updateUserAuthMock,
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from(table: keyof InMemoryDb) {
      return makeTable(db[table] as unknown as object[]);
    },
  };
}

let activeDb: InMemoryDb;

vi.mock("@/lib/auth/guards", () => ({
  hasSupabaseEnv: () => true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createInMemorySupabase(activeDb),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => false,
  createAdminClient: () => null,
}));

import {
  GET as getSettings,
  PATCH as patchSettings,
} from "@/app/api/settings/route";
import { GET as exportLedger } from "@/app/api/settings/export/route";
import { DELETE as deleteAccount } from "@/app/api/account/route";

describe("Settings v2 API & Account Guard Integration", () => {
  beforeEach(() => {
    activeDb = {
      users: [
        {
          id: "u-alex",
          full_name: "Alex Rivera",
          email: "alex@example.com",
          phone_number: "+1 (415) 890-3412",
          timezone: "America/Los_Angeles",
          base_currency: "USD",
          display_currency: "USD",
          personal_share_cap_cents: 160000,
          auto_include_in_expenses: true,
          notification_prefs: {
            new_expense_added: true,
            settlement_recorded: true,
            cycle_close_reminder: true,
            monthly_summary_digest: false,
          },
          created_at: "2024-03-15T10:00:00.000Z",
        },
        {
          id: "u-elena",
          full_name: "Elena Rostova",
          email: "elena@example.com",
          phone_number: null,
          timezone: "UTC",
          base_currency: "USD",
          display_currency: "USD",
          personal_share_cap_cents: null,
          auto_include_in_expenses: true,
          notification_prefs: {
            new_expense_added: true,
            settlement_recorded: true,
            cycle_close_reminder: true,
            monthly_summary_digest: false,
          },
          created_at: "2024-02-01T10:00:00.000Z",
        },
      ],
      groups: [
        {
          id: "grp-apt4b",
          name: "Apt 4B Roommates",
          slug: "apt-4b-roommates",
          group_type: "RESIDENTIAL",
          status: "ACTIVE",
          base_currency: "USD",
          default_split_mode: "EQUAL",
          billing_cycle_anchor_day: 1,
          created_at: "2024-01-15T10:00:00.000Z",
        },
        {
          id: "grp-trip",
          name: "Tokyo Trip",
          slug: "tokyo-trip",
          group_type: "TRIP",
          status: "ACTIVE",
          base_currency: "USD",
          default_split_mode: "EQUAL",
          billing_cycle_anchor_day: 1,
          created_at: "2024-03-01T10:00:00.000Z",
        },
      ],
      group_members: [
        {
          group_id: "grp-apt4b",
          user_id: "u-alex",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2024-01-15T10:00:00.000Z",
        },
        {
          group_id: "grp-apt4b",
          user_id: "u-elena",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2024-01-16T10:00:00.000Z",
        },
        {
          group_id: "grp-trip",
          user_id: "u-alex",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2024-03-01T10:00:00.000Z",
        },
        {
          group_id: "grp-trip",
          user_id: "u-elena",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2024-03-01T10:00:00.000Z",
        },
      ],
      expenses: [
        {
          id: "exp-1",
          group_id: "grp-apt4b",
          created_by: "u-alex",
          paid_by: "u-alex",
          description: "Trader Joe's",
          category: "Groceries & Food",
          expense_date: "2026-11-10T12:00:00.000Z",
          amount_cents: 12000,
          currency: "USD",
          split_method: "EQUAL",
          split_breakdown: [
            { user_id: "u-alex", share_cents: 6000 },
            { user_id: "u-elena", share_cents: 6000 },
          ],
          receipt_url: null,
          adjustment_for_expense_id: null,
          is_locked: false,
          deleted_at: null,
        },
      ],
      settlements: [],
      billing_cycles: [],
    };

    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "u-alex",
          email: "alex@example.com",
          user_metadata: { full_name: "Alex Rivera" },
        },
      },
      error: null,
    });
    updateUserAuthMock.mockResolvedValue({ data: { user: {} }, error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads v2 profile fields and active group count via GET /api/settings", async () => {
    const res = await getSettings();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      profile: {
        fullName: string;
        phoneNumber: string | null;
        timezone: string;
        displayCurrency: string;
        personalShareCapCents: number | null;
        autoIncludeInExpenses: boolean;
        notificationPrefs: {
          new_expense_added: boolean;
          settlement_recorded: boolean;
          cycle_close_reminder: boolean;
          monthly_summary_digest: boolean;
        };
      };
      groupCount: number;
    };

    expect(body.ok).toBe(true);
    expect(body.profile.fullName).toBe("Alex Rivera");
    expect(body.profile.phoneNumber).toBe("+1 (415) 890-3412");
    expect(body.profile.timezone).toBe("America/Los_Angeles");
    expect(body.profile.displayCurrency).toBe("USD");
    expect(body.profile.personalShareCapCents).toBe(160000);
    expect(body.profile.autoIncludeInExpenses).toBe(true);
    expect(body.profile.notificationPrefs).toEqual({
      new_expense_added: true,
      settlement_recorded: true,
      cycle_close_reminder: true,
      monthly_summary_digest: false,
    });
    expect(body.groupCount).toBe(2);
  });

  it("persists all v2 settings fields via PATCH /api/settings and reloads cleanly via GET", async () => {
    const req = new NextRequest("http://localhost:3000/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: "Jordan Doe",
        phone_number: "+1 (415) 555-0199",
        timezone: "America/New_York",
        display_currency: "EUR",
        personal_share_cap_cents: 245000,
        auto_include_in_expenses: false,
        notification_prefs: {
          new_expense_added: false,
          settlement_recorded: true,
          cycle_close_reminder: false,
          monthly_summary_digest: true,
        },
      }),
    });

    const patchRes = await patchSettings(req);
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as {
      ok: boolean;
      profile: {
        fullName: string;
        phoneNumber: string | null;
        timezone: string;
        displayCurrency: string;
        personalShareCapCents: number | null;
        autoIncludeInExpenses: boolean;
        notificationPrefs: {
          new_expense_added: boolean;
          settlement_recorded: boolean;
          cycle_close_reminder: boolean;
          monthly_summary_digest: boolean;
        };
      };
    };

    expect(patchBody.ok).toBe(true);
    expect(patchBody.profile).toMatchObject({
      fullName: "Jordan Doe",
      phoneNumber: "+1 (415) 555-0199",
      timezone: "America/New_York",
      displayCurrency: "EUR",
      personalShareCapCents: 245000,
      autoIncludeInExpenses: false,
      notificationPrefs: {
        new_expense_added: false,
        settlement_recorded: true,
        cycle_close_reminder: false,
        monthly_summary_digest: true,
      },
    });

    // Reload via GET /api/settings and confirm persisted state matches
    const getRes = await getSettings();
    expect(getRes.status).toBe(200);
    const reloaded = (await getRes.json()) as {
      ok: boolean;
      profile: typeof patchBody.profile;
    };
    expect(reloaded.profile).toMatchObject(patchBody.profile);
    expect(activeDb.users[0].display_currency).toBe("EUR");
    expect(activeDb.users[0].auto_include_in_expenses).toBe(false);
    expect(activeDb.users[0].timezone).toBe("America/New_York");
  });

  it("rejects invalid timezone, currency, and personal_share_cap_cents on PATCH /api/settings", async () => {
    const badTz = await patchSettings(
      new NextRequest("http://localhost:3000/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: "Mars/Olympus_Mons" }),
      }),
    );
    expect(badTz.status).toBe(400);

    const badCur = await patchSettings(
      new NextRequest("http://localhost:3000/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_currency: "ZZ" }),
      }),
    );
    expect(badCur.status).toBe(400);

    const badCap = await patchSettings(
      new NextRequest("http://localhost:3000/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personal_share_cap_cents: -500 }),
      }),
    );
    expect(badCap.status).toBe(400);
  });

  it("exports full ledger history across all groups in CSV and JSON", async () => {
    const csvReq = new NextRequest(
      "http://localhost:3000/api/settings/export?format=csv",
    );
    const csvRes = await exportLedger(csvReq);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    const csvText = await csvRes.text();
    expect(csvText).toContain("Trader Joe's");
    expect(csvText).toContain("Apt 4B Roommates");

    const jsonReq = new NextRequest(
      "http://localhost:3000/api/settings/export?format=json",
    );
    const jsonRes = await exportLedger(jsonReq);
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.headers.get("content-type")).toContain("application/json");
    const jsonBody = JSON.parse(await jsonRes.text()) as {
      groups: unknown[];
      expenses: unknown[];
    };
    expect(jsonBody.groups).toHaveLength(2);
    expect(jsonBody.expenses).toHaveLength(1);
  });

  it("blocks DELETE /api/account when user has a non-zero net balance in any group", async () => {
    // u-alex paid $120.00 split 50/50 -> +$60.00 net balance in grp-apt4b
    const blockedRes = await deleteAccount();
    expect(blockedRes.status).toBe(409);
    const blockedBody = (await blockedRes.json()) as {
      code?: string;
      unsettledGroups?: Array<{ groupId: string; netBalanceCents: number }>;
    };
    expect(blockedBody.code).toBe("UNSETTLED_BALANCES");
    expect(blockedBody.unsettledGroups).toHaveLength(1);
    expect(blockedBody.unsettledGroups?.[0]?.netBalanceCents).toBe(6000);
  });
});
