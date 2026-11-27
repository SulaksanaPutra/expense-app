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
  phone_verified: boolean;
  instant_settlement_tag: string | null;
  base_currency: string;
  personal_share_cap_cents: number | null;
  receipt_storage_used_bytes: number;
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
  simplify_debts: boolean;
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
  original_amount_cents: number | null;
  original_currency: string | null;
  exchange_rate: number | null;
  exchange_rate_source: "API" | "MANUAL_OVERRIDE" | null;
  split_method: "EQUAL" | "PERCENTAGE" | "EXACT";
  split_breakdown: Array<{
    user_id: string;
    share_cents: number;
    percentage?: number;
  }>;
  receipt_url: string | null;
  is_recurring_generated: boolean;
  recurring_rule_id: string | null;
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
  payment_rail: "VENMO" | "APPLE_CARD" | "CASH" | "OTHER";
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
              | ((value: { data: T[]; error: null }) => TResult1 | PromiseLike<TResult1>)
              | null,
          ) {
            const matched = filterRows(rows, filters);
            return Promise.resolve({ data: matched, error: null }).then(onfulfilled);
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
              | ((value: { data: T[]; error: null }) => TResult1 | PromiseLike<TResult1>)
              | null,
          ) {
            const matched = applyUpdate();
            return Promise.resolve({ data: matched, error: null }).then(onfulfilled);
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

import { GET as getSettings, PATCH as patchSettings } from "@/app/api/settings/route";
import { POST as postPhoneVerify } from "@/app/api/settings/phone-verify/route";
import { GET as exportLedger } from "@/app/api/settings/export/route";

describe("Settings API & Consumer Persistence Integration", () => {
  beforeEach(() => {
    activeDb = {
      users: [
        {
          id: "u-alex",
          full_name: "Alex Rivera",
          email: "alex@example.com",
          phone_number: null,
          phone_verified: false,
          instant_settlement_tag: null,
          base_currency: "USD",
          personal_share_cap_cents: null,
          receipt_storage_used_bytes: 94_371_840, // 90 MB (18% of 500 MB)
          notification_prefs: {
            new_expense: true,
            settlement_confirmation: true,
            monthly_recap: true,
            sms_nudges_opt_in: false,
          },
          created_at: "2024-01-15T10:00:00.000Z",
        },
        {
          id: "u-elena",
          full_name: "Elena Rostova",
          email: "elena@example.com",
          phone_number: null,
          phone_verified: false,
          instant_settlement_tag: "@elena-r",
          base_currency: "USD",
          personal_share_cap_cents: null,
          receipt_storage_used_bytes: 0,
          notification_prefs: {
            new_expense: true,
            settlement_confirmation: true,
            monthly_recap: true,
            sms_nudges_opt_in: false,
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
          simplify_debts: true,
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
          simplify_debts: true,
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
          original_amount_cents: null,
          original_currency: null,
          exchange_rate: null,
          exchange_rate_source: null,
          split_method: "EQUAL",
          split_breakdown: [
            { user_id: "u-alex", share_cents: 6000 },
            { user_id: "u-elena", share_cents: 6000 },
          ],
          receipt_url: null,
          is_recurring_generated: false,
          recurring_rule_id: null,
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

  it("loads profile, storage quota, and active groups with role via GET /api/settings", async () => {
    const res = await getSettings();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      profile: {
        receiptStorageUsedBytes: number;
        receiptStorageQuotaBytes: number;
        baseCurrency: string;
      };
      groups: Array<{ id: string; currentUserRole: string }>;
    };

    expect(body.ok).toBe(true);
    expect(body.profile.receiptStorageUsedBytes).toBe(94_371_840);
    expect(body.profile.receiptStorageQuotaBytes).toBe(524_288_000);
    expect(body.profile.baseCurrency).toBe("USD");
    expect(body.groups).toHaveLength(2);
    expect(body.groups.find((g) => g.id === "grp-apt4b")?.currentUserRole).toBe(
      "ADMIN",
    );
    expect(body.groups.find((g) => g.id === "grp-trip")?.currentUserRole).toBe(
      "MEMBER",
    );
  });

  it("persists @instant_settlement_tag, personal_share_cap_cents, default split mode, and ADMIN group rules via PATCH /api/settings", async () => {
    const req = new NextRequest("http://localhost:3000/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: "Alex M. Rivera",
        instant_settlement_tag: "alex-rivera-99",
        base_currency: "EUR",
        personal_share_cap_cents: 160000,
        notification_prefs: {
          new_expense: false,
          settlement_confirmation: true,
          monthly_recap: false,
          auto_settlement_reminders: false,
          default_split_method: "PERCENTAGE",
          payment_methods: [
            {
              id: "pm-apple",
              label: "Apple Card / Debit",
              rail: "APPLE_CARD",
              handle: "•••• 4281",
              is_default: true,
            },
          ],
        },
        active_group_id: "grp-apt4b",
        group_simplify_debts: false,
        group_default_split_mode: "CUSTOM_RATIOS",
      }),
    });

    const res = await patchSettings(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      profile: {
        fullName: string;
        instantSettlementTag: string;
        baseCurrency: string;
        personalShareCapCents: number;
        notificationPrefs: {
          default_split_method: string;
          auto_settlement_reminders: boolean;
          payment_methods: Array<{ id: string; handle: string }>;
        };
      };
      updatedGroup: {
        id: string;
        defaultSplitMode: string;
        simplifyDebts: boolean;
      };
    };

    expect(body.ok).toBe(true);
    expect(body.profile.fullName).toBe("Alex M. Rivera");
    expect(body.profile.instantSettlementTag).toBe("@alex-rivera-99");
    expect(body.profile.baseCurrency).toBe("EUR");
    expect(body.profile.personalShareCapCents).toBe(160000);
    expect(body.profile.notificationPrefs.default_split_method).toBe(
      "PERCENTAGE",
    );
    expect(body.profile.notificationPrefs.auto_settlement_reminders).toBe(false);
    expect(
      body.profile.notificationPrefs.payment_methods.some(
        (pm) => pm.handle === "@alex-rivera-99",
      ),
    ).toBe(true);

    // Verify DB state updated
    expect(activeDb.users[0].instant_settlement_tag).toBe("@alex-rivera-99");
    expect(activeDb.users[0].personal_share_cap_cents).toBe(160000);
    expect(activeDb.groups[0].simplify_debts).toBe(false);
    expect(activeDb.groups[0].default_split_mode).toBe("CUSTOM_RATIOS");
    expect(body.updatedGroup).toEqual({
      id: "grp-apt4b",
      defaultSplitMode: "CUSTOM_RATIOS",
      simplifyDebts: false,
    });
  });

  it("blocks non-ADMIN MEMBER from updating group_simplify_debts or group_default_split_mode (403)", async () => {
    const req = new NextRequest("http://localhost:3000/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        active_group_id: "grp-trip",
        group_simplify_debts: false,
      }),
    });

    const res = await patchSettings(req);
    expect(res.status).toBe(403);
    expect(activeDb.groups[1].simplify_debts).toBe(true);
  });

  it("enforces phone verification before allowing sms_nudges_opt_in", async () => {
    // 1. Reject sms_nudges_opt_in before phone verification
    const blockedReq = new NextRequest("http://localhost:3000/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone_number: "+1 (555) 234-8901",
        notification_prefs: {
          sms_nudges_opt_in: true,
        },
      }),
    });
    const blockedRes = await patchSettings(blockedReq);
    expect(blockedRes.status).toBe(400);

    // 2. Send phone OTP
    const sendReq = new NextRequest(
      "http://localhost:3000/api/settings/phone-verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          phone_number: "+1 (555) 234-8901",
        }),
      },
    );
    const sendRes = await postPhoneVerify(sendReq);
    expect(sendRes.status).toBe(200);
    const sendBody = (await sendRes.json()) as {
      challengeToken: string;
      sandboxCode: string;
    };
    expect(sendBody.sandboxCode).toMatch(/^\d{6}$/);

    // 3. Verify phone OTP
    const verifyReq = new NextRequest(
      "http://localhost:3000/api/settings/phone-verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          phone_number: "+1 (555) 234-8901",
          code: sendBody.sandboxCode,
          challengeToken: sendBody.challengeToken,
        }),
      },
    );
    const verifyRes = await postPhoneVerify(verifyReq);
    expect(verifyRes.status).toBe(200);
    expect(activeDb.users[0].phone_verified).toBe(true);

    // 4. Now sms_nudges_opt_in: true succeeds
    const optInReq = new NextRequest("http://localhost:3000/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notification_prefs: {
          sms_nudges_opt_in: true,
        },
      }),
    });
    const optInRes = await patchSettings(optInReq);
    expect(optInRes.status).toBe(200);
    expect(activeDb.users[0].notification_prefs.sms_nudges_opt_in).toBe(true);
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
});
