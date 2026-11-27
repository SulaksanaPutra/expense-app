import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface InMemoryUserRow {
  id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  phone_verified: boolean;
  notification_prefs: {
    new_expense: boolean;
    settlement_confirmation: boolean;
    monthly_recap: boolean;
    sms_nudges_opt_in: boolean;
  };
}

interface InMemoryGroupRow {
  id: string;
  name: string;
  status: "ACTIVE" | "NEEDS_RATIO_UPDATE" | "ARCHIVED";
  base_currency: string;
  simplify_debts: boolean;
}

interface InMemoryMemberRow {
  group_id: string;
  user_id: string;
  role: "ADMIN" | "MEMBER";
  status: "ACTIVE" | "FORMER_MEMBER";
}

interface InMemoryReminderRow {
  id: string;
  creditor_id: string;
  debtor_id: string;
  group_id: string;
  channel: "PUSH" | "EMAIL" | "SMS";
  sent_at: string;
}

interface InMemoryNotificationRow {
  id: string;
  user_id: string;
  group_id: string | null;
  actor_id: string | null;
  type: string;
  title: string;
  description: string;
  delta_cents: number | null;
  currency: string | null;
  href: string | null;
  is_read: boolean;
  created_at: string;
}

interface MockDbState {
  currentUserId: string | null;
  users: InMemoryUserRow[];
  groups: InMemoryGroupRow[];
  members: InMemoryMemberRow[];
  reminderLogs: InMemoryReminderRow[];
  notifications: InMemoryNotificationRow[];
  expenses: Array<{
    group_id: string;
    paid_by: string;
    amount_cents: number;
    split_breakdown: Array<{ user_id: string; share_cents: number }>;
    deleted_at: string | null;
  }>;
  settlements: Array<{
    group_id: string;
    payer_id: string;
    recipient_id: string;
    amount_cents: number;
  }>;
}

let mockState: MockDbState;

function createMockSupabase(state: MockDbState) {
  return {
    auth: {
      getUser: async () => {
        if (!state.currentUserId) {
          return { data: { user: null }, error: null };
        }
        return {
          data: {
            user: {
              id: state.currentUserId,
              email:
                state.users.find((u) => u.id === state.currentUserId)?.email ??
                "user@example.com",
            },
          },
          error: null,
        };
      },
    },
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitCount: number | null = null;

      const getSourceRows = (): Array<Record<string, unknown>> => {
        if (table === "users") return state.users as unknown as Array<Record<string, unknown>>;
        if (table === "groups") return state.groups as unknown as Array<Record<string, unknown>>;
        if (table === "group_members") return state.members as unknown as Array<Record<string, unknown>>;
        if (table === "reminder_logs") return state.reminderLogs as unknown as Array<Record<string, unknown>>;
        if (table === "notifications") return state.notifications as unknown as Array<Record<string, unknown>>;
        if (table === "expenses") return state.expenses as unknown as Array<Record<string, unknown>>;
        if (table === "settlements") return state.settlements as unknown as Array<Record<string, unknown>>;
        return [];
      };

      const executeQuery = () => {
        let rows = getSourceRows().filter((row) =>
          filters.every((fn) => fn(row)),
        );
        if (orderCol) {
          const col = orderCol;
          rows = [...rows].sort((a, b) => {
            const av = String(a[col] ?? "");
            const bv = String(b[col] ?? "");
            return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
          });
        }
        if (limitCount !== null) {
          rows = rows.slice(0, limitCount);
        }
        return rows;
      };

      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push((row) => row[col] === val);
          return builder;
        },
        in(col: string, vals: unknown[]) {
          filters.push((row) => vals.includes(row[col]));
          return builder;
        },
        is(col: string, val: unknown) {
          filters.push((row) => row[col] === val);
          return builder;
        },
        gte(col: string, val: string) {
          filters.push((row) => String(row[col] ?? "") >= val);
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orderCol = col;
          orderAsc = opts?.ascending ?? true;
          return builder;
        },
        limit(n: number) {
          limitCount = n;
          return builder;
        },
        async maybeSingle() {
          const rows = executeQuery();
          return { data: rows[0] ?? null, error: null };
        },
        async single() {
          const rows = executeQuery();
          return { data: rows[0] ?? null, error: null };
        },
        then(
          resolve: (val: { data: unknown[]; error: null }) => unknown,
          reject?: (err: unknown) => unknown,
        ) {
          return Promise.resolve({ data: executeQuery(), error: null }).then(
            resolve,
            reject,
          );
        },
        insert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
          const items = Array.isArray(payload) ? payload : [payload];
          const inserted: Record<string, unknown>[] = [];
          for (const item of items) {
            const row = {
              id: item.id ?? crypto.randomUUID(),
              ...item,
            };
            if (table === "reminder_logs") {
              state.reminderLogs.push(row as unknown as InMemoryReminderRow);
            } else if (table === "notifications") {
              state.notifications.push(row as unknown as InMemoryNotificationRow);
            }
            inserted.push(row);
          }

          return {
            select() {
              return {
                single: async () => ({
                  data: inserted[0] ?? null,
                  error: null,
                }),
              };
            },
            then(
              resolve: (val: { data: null; error: null }) => unknown,
              reject?: (err: unknown) => unknown,
            ) {
              return Promise.resolve({ data: null, error: null }).then(
                resolve,
                reject,
              );
            },
          };
        },
      };

      return builder;
    },
  };
}

vi.mock("@/lib/auth/guards", () => ({
  hasSupabaseEnv: () => true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createMockSupabase(mockState),
}));

import {
  GET as groupRemindersGet,
  POST as groupRemindersPost,
} from "@/app/api/groups/[groupId]/reminders/route";
import {
  GET as batchRemindersGet,
  POST as batchRemindersPost,
} from "@/app/api/reminders/route";
import {
  computeReminderCooldown,
  sendSettlementReminder,
} from "@/lib/groups/reminders";

beforeEach(() => {
  mockState = {
    currentUserId: "u-alex",
    users: [
      {
        id: "u-alex",
        full_name: "Alex Rivera",
        email: "alex@example.com",
        phone_number: "+14155550101",
        phone_verified: true,
        notification_prefs: {
          new_expense: true,
          settlement_confirmation: true,
          monthly_recap: true,
          sms_nudges_opt_in: false,
        },
      },
      {
        id: "u-elena",
        full_name: "Elena Rostova",
        email: "elena@example.com",
        phone_number: "+14155550102",
        phone_verified: true,
        notification_prefs: {
          new_expense: true,
          settlement_confirmation: true,
          monthly_recap: true,
          sms_nudges_opt_in: false,
        },
      },
      {
        id: "u-marcus",
        full_name: "Marcus Vance",
        email: "marcus@example.com",
        phone_number: "+14155550103",
        phone_verified: true,
        notification_prefs: {
          new_expense: true,
          settlement_confirmation: true,
          monthly_recap: true,
          sms_nudges_opt_in: true,
        },
      },
      {
        id: "u-sam",
        full_name: "Samira Patel",
        email: "sam@example.com",
        phone_number: "+14155550104",
        phone_verified: false,
        notification_prefs: {
          new_expense: true,
          settlement_confirmation: true,
          monthly_recap: true,
          sms_nudges_opt_in: true,
        },
      },
    ],
    groups: [
      {
        id: "grp-apt4b",
        name: "Apt 4B Roommates",
        status: "ACTIVE",
        base_currency: "USD",
        simplify_debts: true,
      },
      {
        id: "grp-tahoe",
        name: "Tahoe Ski Trip",
        status: "ACTIVE",
        base_currency: "USD",
        simplify_debts: true,
      },
      {
        id: "grp-archived",
        name: "Old Lease 2024",
        status: "ARCHIVED",
        base_currency: "USD",
        simplify_debts: true,
      },
    ],
    members: [
      { group_id: "grp-apt4b", user_id: "u-alex", role: "ADMIN", status: "ACTIVE" },
      { group_id: "grp-apt4b", user_id: "u-elena", role: "MEMBER", status: "ACTIVE" },
      { group_id: "grp-apt4b", user_id: "u-marcus", role: "MEMBER", status: "ACTIVE" },
      { group_id: "grp-apt4b", user_id: "u-sam", role: "MEMBER", status: "ACTIVE" },
      { group_id: "grp-tahoe", user_id: "u-alex", role: "ADMIN", status: "ACTIVE" },
      { group_id: "grp-tahoe", user_id: "u-elena", role: "MEMBER", status: "ACTIVE" },
      { group_id: "grp-archived", user_id: "u-alex", role: "ADMIN", status: "ACTIVE" },
      { group_id: "grp-archived", user_id: "u-elena", role: "MEMBER", status: "ACTIVE" },
    ],
    reminderLogs: [],
    notifications: [],
    expenses: [
      {
        group_id: "grp-apt4b",
        paid_by: "u-alex",
        amount_cents: 12000,
        split_breakdown: [
          { user_id: "u-alex", share_cents: 4000 },
          { user_id: "u-elena", share_cents: 4000 },
          { user_id: "u-marcus", share_cents: 4000 },
        ],
        deleted_at: null,
      },
    ],
    settlements: [],
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Settlement Reminders API & Domain (24h Cooldown + SMS Opt-In Gating)", () => {
  it("dispatches Push/in-app by default and rejects second reminder within 24h with 429 + Retry-After", async () => {
    const req1 = new NextRequest("http://localhost/api/groups/grp-apt4b/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debtor_id: "u-elena" }),
    });

    const res1 = await groupRemindersPost(req1, {
      params: Promise.resolve({ groupId: "grp-apt4b" }),
    });
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1.ok).toBe(true);
    expect(body1.channel).toBe("PUSH");
    expect(body1.deliveryMode).toBe("push");
    expect(body1.cooldown.remainingHours).toBe(24);
    expect(mockState.reminderLogs).toHaveLength(1);
    expect(mockState.notifications).toHaveLength(1);
    expect(mockState.notifications[0]).toMatchObject({
      user_id: "u-elena",
      group_id: "grp-apt4b",
      actor_id: "u-alex",
      type: "REMINDER_NUDGE",
      delta_cents: 4000,
      currency: "USD",
    });

    // Second reminder within 24h for same (creditor_id, debtor_id, group_id) -> 429
    const req2 = new NextRequest("http://localhost/api/groups/grp-apt4b/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debtor_id: "u-elena" }),
    });
    const res2 = await groupRemindersPost(req2, {
      params: Promise.resolve({ groupId: "grp-apt4b" }),
    });
    expect(res2.status).toBe(429);
    expect(Number(res2.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body2 = await res2.json();
    expect(body2.code).toBe("REMINDER_COOLDOWN");
    expect(body2.remaining_hours).toBe(24);
    expect(mockState.reminderLogs).toHaveLength(1);

    // Same (creditor_id, debtor_id) in a DIFFERENT group_id succeeds (201)
    const reqDiffGroup = new NextRequest(
      "http://localhost/api/groups/grp-tahoe/reminders",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debtor_id: "u-elena" }),
      },
    );
    const resDiffGroup = await groupRemindersPost(reqDiffGroup, {
      params: Promise.resolve({ groupId: "grp-tahoe" }),
    });
    expect(resDiffGroup.status).toBe(201);
    expect(mockState.reminderLogs).toHaveLength(2);
  });

  it("enforces exact 24h boundary and computes remaining hours accurately", async () => {
    const supabase = createMockSupabase(mockState) as unknown as Parameters<
      typeof sendSettlementReminder
    >[0];
    const t0 = Date.UTC(2026, 10, 27, 12, 0, 0);

    const first = await sendSettlementReminder(supabase, {
      groupId: "grp-apt4b",
      creditorId: "u-alex",
      debtorId: "u-elena",
      nowMs: t0,
    });
    expect(first.ok).toBe(true);

    // 10 hours later -> 14h remaining
    const at10h = await sendSettlementReminder(supabase, {
      groupId: "grp-apt4b",
      creditorId: "u-alex",
      debtorId: "u-elena",
      nowMs: t0 + 10 * 3_600_000,
    });
    expect(at10h.ok).toBe(false);
    if (!at10h.ok) {
      expect(at10h.status).toBe(429);
      expect(at10h.cooldown?.remainingHours).toBe(14);
    }

    // 23h 30m later -> rounds up to 1h remaining (never 0h while locked)
    const at23h30m = await sendSettlementReminder(supabase, {
      groupId: "grp-apt4b",
      creditorId: "u-alex",
      debtorId: "u-elena",
      nowMs: t0 + 23.5 * 3_600_000,
    });
    expect(at23h30m.ok).toBe(false);
    if (!at23h30m.ok) {
      expect(at23h30m.status).toBe(429);
      expect(at23h30m.cooldown?.remainingHours).toBe(1);
    }

    // Exactly 24h later -> allowed
    const at24h = await sendSettlementReminder(supabase, {
      groupId: "grp-apt4b",
      creditorId: "u-alex",
      debtorId: "u-elena",
      nowMs: t0 + 24 * 3_600_000,
    });
    expect(at24h.ok).toBe(true);

    expect(
      computeReminderCooldown({
        groupId: "grp-apt4b",
        debtorId: "u-elena",
        creditorId: "u-alex",
        channel: "PUSH",
        sentAt: new Date(t0).toISOString(),
        nowMs: t0 + 24 * 3_600_000,
      }),
    ).toBeNull();
  });

  it("gates Twilio SMS strictly on sms_nudges_opt_in == true AND phone_verified == true", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sid: "SM_TWILIO_123" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_TEST_123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "auth_secret");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+15005550006");

    // 1. u-sam has sms_nudges_opt_in=true BUT phone_verified=false -> falls back to PUSH, Twilio not called
    const samReq = new NextRequest("http://localhost/api/groups/grp-apt4b/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debtor_id: "u-sam" }),
    });
    const samRes = await groupRemindersPost(samReq, {
      params: Promise.resolve({ groupId: "grp-apt4b" }),
    });
    expect(samRes.status).toBe(201);
    const samBody = await samRes.json();
    expect(samBody.channel).toBe("PUSH");
    expect(samBody.deliveryMode).toBe("push");
    expect(fetchSpy).not.toHaveBeenCalled();

    // 2. u-elena has phone_verified=true BUT sms_nudges_opt_in=false -> falls back to PUSH, Twilio not called
    const elenaReq = new NextRequest("http://localhost/api/groups/grp-apt4b/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debtor_id: "u-elena" }),
    });
    const elenaRes = await groupRemindersPost(elenaReq, {
      params: Promise.resolve({ groupId: "grp-apt4b" }),
    });
    expect(elenaRes.status).toBe(201);
    const elenaBody = await elenaRes.json();
    expect(elenaBody.channel).toBe("PUSH");
    expect(fetchSpy).not.toHaveBeenCalled();

    // 3. u-marcus has sms_nudges_opt_in=true AND phone_verified=true -> dispatches Twilio SMS!
    const marcusReq = new NextRequest("http://localhost/api/groups/grp-apt4b/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debtor_id: "u-marcus" }),
    });
    const marcusRes = await groupRemindersPost(marcusReq, {
      params: Promise.resolve({ groupId: "grp-apt4b" }),
    });
    expect(marcusRes.status).toBe(201);
    const marcusBody = await marcusRes.json();
    expect(marcusBody.channel).toBe("SMS");
    expect(marcusBody.deliveryMode).toBe("sms");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC_TEST_123/Messages.json",
    );
    expect(mockState.reminderLogs.find((r) => r.debtor_id === "u-marcus")?.channel).toBe(
      "SMS",
    );
  });

  it("supports sandbox SMS when Twilio credentials are absent and falls back to PUSH on Twilio HTTP failure", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_FROM_NUMBER", "");

    const sandboxReq = new NextRequest("http://localhost/api/groups/grp-apt4b/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debtor_id: "u-marcus" }),
    });
    const sandboxRes = await groupRemindersPost(sandboxReq, {
      params: Promise.resolve({ groupId: "grp-apt4b" }),
    });
    expect(sandboxRes.status).toBe(201);
    const sandboxBody = await sandboxRes.json();
    expect(sandboxBody.channel).toBe("SMS");
    expect(sandboxBody.deliveryMode).toBe("sandbox_sms");

    // Clear logs & test Twilio failure fallback
    mockState.reminderLogs = [];
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_FAIL");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "bad_token");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+15005550006");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Twilio Error", { status: 500 }),
    );

    const failReq = new NextRequest("http://localhost/api/groups/grp-apt4b/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debtor_id: "u-marcus" }),
    });
    const failRes = await groupRemindersPost(failReq, {
      params: Promise.resolve({ groupId: "grp-apt4b" }),
    });
    expect(failRes.status).toBe(201);
    const failBody = await failRes.json();
    expect(failBody.channel).toBe("PUSH");
    expect(failBody.deliveryMode).toBe("push");
  });

  it("handles batch reminders across groups, active cooldown GET endpoints, and FORMER_MEMBER/ARCHIVED guards", async () => {
    // Batch across Apt 4B (Elena, Marcus) + Tahoe (Elena)
    const batchReq = new NextRequest("http://localhost/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targets: [
          { group_id: "grp-apt4b", debtor_id: "u-elena", amount_cents: 4000 },
          { group_id: "grp-apt4b", debtor_id: "u-marcus", amount_cents: 4000 },
          { group_id: "grp-tahoe", debtor_id: "u-elena", amount_cents: 2500 },
        ],
      }),
    });
    const batchRes = await batchRemindersPost(batchReq);
    expect(batchRes.status).toBe(201);
    const batchBody = await batchRes.json();
    expect(batchBody.sent).toHaveLength(3);
    expect(batchBody.rateLimited).toHaveLength(0);

    // Repeating same batch -> 429
    const batchReq2 = new NextRequest("http://localhost/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targets: [
          { group_id: "grp-apt4b", debtor_id: "u-elena" },
          { group_id: "grp-tahoe", debtor_id: "u-elena" },
        ],
      }),
    });
    const batchRes2 = await batchRemindersPost(batchReq2);
    expect(batchRes2.status).toBe(429);

    // GET cooldowns (global & per-group)
    const getAllRes = await batchRemindersGet();
    expect(getAllRes.status).toBe(200);
    const getAllBody = await getAllRes.json();
    expect(getAllBody.cooldowns).toHaveLength(3);

    const getGroupRes = await groupRemindersGet(
      new NextRequest("http://localhost/api/groups/grp-tahoe/reminders"),
      { params: Promise.resolve({ groupId: "grp-tahoe" }) },
    );
    expect(getGroupRes.status).toBe(200);
    const getGroupBody = await getGroupRes.json();
    expect(getGroupBody.cooldowns).toHaveLength(1);
    expect(getGroupBody.cooldowns[0].debtorId).toBe("u-elena");

    // ARCHIVED group rejected with 409
    const archReq = new NextRequest("http://localhost/api/groups/grp-archived/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debtor_id: "u-elena" }),
    });
    const archRes = await groupRemindersPost(archReq, {
      params: Promise.resolve({ groupId: "grp-archived" }),
    });
    expect(archRes.status).toBe(409);

    // FORMER_MEMBER creditor rejected with 403
    mockState.members[0].status = "FORMER_MEMBER";
    const formerReq = new NextRequest("http://localhost/api/groups/grp-apt4b/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debtor_id: "u-sam" }),
    });
    const formerRes = await groupRemindersPost(formerReq, {
      params: Promise.resolve({ groupId: "grp-apt4b" }),
    });
    expect(formerRes.status).toBe(403);
  });
});
