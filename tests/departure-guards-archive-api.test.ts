import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateResidentialLeasePrompt,
  evaluateTripAutoArchive,
} from "@/lib/groups/archive";
import { buildDefaultSplitExcludingFormerMembers } from "@/lib/groups/invite-utils";

const getUserMock = vi.fn();
const deleteAuthUserMock = vi.fn();

interface InMemoryUserRow {
  id: string;
  email: string;
  full_name: string;
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
  operational_budget_cents: number | null;
  billing_cycle_anchor_day: number;
  lease_end_date: string | null;
  trip_auto_archive_enabled: boolean;
  trip_auto_archive_days: number;
  residential_lease_prompt_enabled: boolean;
  zero_balance_since: string | null;
  lease_prompt_snoozed_until: string | null;
  archived_at: string | null;
  archived_by: string | null;
  invite_token: string;
  invite_token_version: number;
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

interface InMemoryRecurringRuleRow {
  id: string;
  group_id: string;
  paid_by: string;
  description: string;
  category: string;
  amount_cents: number;
  currency: string;
  frequency: "MONTHLY";
  day_of_month: number;
  split_rule: "EQUAL" | "CUSTOM_RATIOS";
  is_active: boolean;
  next_run_date: string;
}

interface InMemoryAuditLogRow {
  id: string;
  group_id: string;
  actor_id: string | null;
  event_type: string;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface InMemoryDb {
  users: InMemoryUserRow[];
  groups: InMemoryGroupRow[];
  group_members: InMemoryMemberRow[];
  expenses: InMemoryExpenseRow[];
  settlements: InMemorySettlementRow[];
  recurring_rules: InMemoryRecurringRuleRow[];
  group_audit_logs: InMemoryAuditLogRow[];
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
        if (f.op === "in" && Array.isArray(f.val)) {
          return f.val.includes(value);
        }
        if (f.op === "neq") {
          return value !== f.val;
        }
        if (f.op === "is") {
          return value === f.val;
        }
        return value === f.val;
      }),
    );
  }

  function makeTable<T extends object>(rows: T[], defaultIdPrefix: string) {
    return {
      select: () => {
        const filters: Filter[] = [];
        let orderCol: string | null = null;
        let orderAsc = true;

        const run = async () => {
          let result = filterRows(rows, filters).map((r) => ({ ...r }));
          if (orderCol) {
            const col = orderCol;
            result = result.sort((a, b) => {
              const av = String((a as Record<string, unknown>)[col] ?? "");
              const bv = String((b as Record<string, unknown>)[col] ?? "");
              return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            });
          }
          return { data: result, error: null };
        };

        const builder = {
          eq: (col: string, val: unknown) => {
            filters.push({ col, val, op: "eq" });
            return builder;
          },
          neq: (col: string, val: unknown) => {
            filters.push({ col, val, op: "neq" });
            return builder;
          },
          in: (col: string, val: unknown[]) => {
            filters.push({ col, val, op: "in" });
            return builder;
          },
          is: (col: string, val: unknown) => {
            filters.push({ col, val, op: "is" });
            return builder;
          },
          order: (col: string, opts?: { ascending?: boolean }) => {
            orderCol = col;
            orderAsc = opts?.ascending ?? true;
            return builder;
          },
          maybeSingle: async () => {
            const { data } = await run();
            return { data: data[0] ?? null, error: null };
          },
          then: (onFulfilled: (val: { data: T[]; error: null }) => unknown) =>
            run().then(onFulfilled),
        };
        return builder;
      },
      insert: (row: Partial<T>) => {
        const stored = {
          id: `${defaultIdPrefix}-${rows.length + 1}`,
          ...row,
        } as T;
        rows.push(stored);
        return {
          select: () => ({
            maybeSingle: async () => ({ data: { ...stored }, error: null }),
          }),
          then: (onFulfilled: (val: { error: null }) => unknown) =>
            Promise.resolve({ error: null }).then(onFulfilled),
        };
      },
      update: (patch: Partial<T>) => {
        const filters: Filter[] = [];
        const apply = async () => {
          const matched = filterRows(rows, filters);
          for (const item of matched) {
            Object.assign(item, patch);
          }
          return { data: matched[0] ? { ...matched[0] } : null, error: null };
        };
        const builder = {
          eq: (col: string, val: unknown) => {
            filters.push({ col, val, op: "eq" });
            return builder;
          },
          select: () => ({
            maybeSingle: () => apply(),
          }),
          then: (onFulfilled: (val: { error: null }) => unknown) =>
            apply().then(() => onFulfilled({ error: null })),
        };
        return builder;
      },
      delete: () => {
        const filters: Filter[] = [];
        const apply = async () => {
          const toDelete = new Set(filterRows(rows, filters));
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (toDelete.has(rows[i])) {
              rows.splice(i, 1);
            }
          }
          return { error: null };
        };
        const builder = {
          eq: (col: string, val: unknown) => {
            filters.push({ col, val, op: "eq" });
            return builder;
          },
          then: (onFulfilled: (val: { error: null }) => unknown) =>
            apply().then(onFulfilled),
        };
        return builder;
      },
    };
  }

  return {
    auth: {
      getUser: getUserMock,
      admin: {
        deleteUser: deleteAuthUserMock,
      },
    },
    from: (table: keyof InMemoryDb) => {
      switch (table) {
        case "users":
          return makeTable(db.users, "usr");
        case "groups":
          return makeTable(db.groups, "grp");
        case "group_members":
          return makeTable(db.group_members, "gm");
        case "expenses":
          return makeTable(db.expenses, "exp");
        case "settlements":
          return makeTable(db.settlements, "set");
        case "recurring_rules":
          return makeTable(db.recurring_rules, "rec");
        case "group_audit_logs":
          return makeTable(db.group_audit_logs, "aud");
        default:
          return {};
      }
    },
  };
}

let activeDb: InMemoryDb;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => createInMemorySupabase(activeDb)),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () =>
    Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  createAdminClient: vi.fn(() => createInMemorySupabase(activeDb)),
}));

import { DELETE as accountDelete, GET as accountGet } from "@/app/api/account/route";
import { PATCH as archiveRulesPatch } from "@/app/api/groups/[groupId]/archive-rules/route";
import { POST as expensePost } from "@/app/api/groups/[groupId]/expenses/route";
import { POST as leavePost } from "@/app/api/groups/[groupId]/leave/route";
import { DELETE as removeMemberDelete } from "@/app/api/groups/[groupId]/members/[userId]/route";
import {
  DELETE as recurringDelete,
  PATCH as recurringPatch,
  POST as recurringPost,
} from "@/app/api/groups/[groupId]/recurring-rules/route";
import { POST as settlementPost } from "@/app/api/groups/[groupId]/settlements/route";
import { POST as archiveCheckPost } from "@/app/api/groups/archive-check/route";

describe("Departure Guards (FORMER_MEMBER), Archive Rules & ARCHIVED Read-Only API", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-123";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-xyz";
    getUserMock.mockReset();
    deleteAuthUserMock.mockReset();

    const fifteenDaysAgo = new Date(
      Date.now() - 15 * 86_400_000,
    ).toISOString();
    const tenDaysAgoDate = new Date(Date.now() - 10 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    activeDb = {
      users: [
        { id: "u-admin", email: "alex@example.com", full_name: "Alex Rivera" },
        { id: "u-elena", email: "elena@example.com", full_name: "Elena Rostova" },
        { id: "u-marcus", email: "marcus@example.com", full_name: "Marcus Vance" },
        { id: "u-zero", email: "zero@example.com", full_name: "Zero Balance User" },
      ],
      groups: [
        {
          id: "grp-apt4b",
          name: "Apt 4B Roommates",
          slug: "apt-4b",
          group_type: "RESIDENTIAL",
          status: "ACTIVE",
          base_currency: "USD",
          default_split_mode: "EQUAL",
          simplify_debts: true,
          operational_budget_cents: 450000,
          billing_cycle_anchor_day: 1,
          lease_end_date: tenDaysAgoDate,
          trip_auto_archive_enabled: true,
          trip_auto_archive_days: 14,
          residential_lease_prompt_enabled: true,
          zero_balance_since: null,
          lease_prompt_snoozed_until: null,
          archived_at: null,
          archived_by: null,
          invite_token: "tok-apt4b",
          invite_token_version: 1,
          created_at: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "grp-tahoe",
          name: "Tahoe Ski Cabin",
          slug: "tahoe-ski",
          group_type: "TRIP",
          status: "ACTIVE",
          base_currency: "USD",
          default_split_mode: "EQUAL",
          simplify_debts: true,
          operational_budget_cents: null,
          billing_cycle_anchor_day: 1,
          lease_end_date: null,
          trip_auto_archive_enabled: true,
          trip_auto_archive_days: 14,
          residential_lease_prompt_enabled: true,
          zero_balance_since: fifteenDaysAgo,
          lease_prompt_snoozed_until: null,
          archived_at: null,
          archived_by: null,
          invite_token: "tok-tahoe",
          invite_token_version: 1,
          created_at: "2026-10-01T00:00:00.000Z",
        },
        {
          id: "grp-archived",
          name: "Summer Italy 2025",
          slug: "summer-italy",
          group_type: "TRIP",
          status: "ARCHIVED",
          base_currency: "EUR",
          default_split_mode: "EQUAL",
          simplify_debts: true,
          operational_budget_cents: null,
          billing_cycle_anchor_day: 1,
          lease_end_date: null,
          trip_auto_archive_enabled: true,
          trip_auto_archive_days: 14,
          residential_lease_prompt_enabled: true,
          zero_balance_since: "2025-09-01T00:00:00.000Z",
          lease_prompt_snoozed_until: null,
          archived_at: "2025-09-16T00:00:00.000Z",
          archived_by: "u-admin",
          invite_token: "tok-italy",
          invite_token_version: 1,
          created_at: "2025-08-01T00:00:00.000Z",
        },
      ],
      group_members: [
        {
          group_id: "grp-apt4b",
          user_id: "u-admin",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 33.34,
          joined_at: "2026-09-01T00:00:00.000Z",
        },
        {
          group_id: "grp-apt4b",
          user_id: "u-elena",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 33.33,
          joined_at: "2026-09-02T00:00:00.000Z",
        },
        {
          group_id: "grp-apt4b",
          user_id: "u-marcus",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 33.33,
          joined_at: "2026-09-03T00:00:00.000Z",
        },
        {
          group_id: "grp-tahoe",
          user_id: "u-admin",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2026-10-01T00:00:00.000Z",
        },
        {
          group_id: "grp-tahoe",
          user_id: "u-zero",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2026-10-02T00:00:00.000Z",
        },
        {
          group_id: "grp-archived",
          user_id: "u-admin",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2025-08-01T00:00:00.000Z",
        },
        {
          group_id: "grp-archived",
          user_id: "u-elena",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2025-08-01T00:00:00.000Z",
        },
      ],
      expenses: [
        {
          id: "exp-1",
          group_id: "grp-apt4b",
          created_by: "u-admin",
          paid_by: "u-admin",
          description: "November Rent",
          category: "Rent",
          expense_date: "2026-11-01T10:00:00.000Z",
          amount_cents: 30000,
          currency: "USD",
          split_method: "EQUAL",
          split_breakdown: [
            { user_id: "u-admin", share_cents: 10000 },
            { user_id: "u-elena", share_cents: 10000 },
            { user_id: "u-marcus", share_cents: 10000 },
          ],
          deleted_at: null,
        },
      ],
      settlements: [],
      recurring_rules: [
        {
          id: "rec-archived-1",
          group_id: "grp-archived",
          paid_by: "u-admin",
          description: "Villa Wi-Fi",
          category: "Utilities",
          amount_cents: 4500,
          currency: "EUR",
          frequency: "MONTHLY",
          day_of_month: 1,
          split_rule: "EQUAL",
          is_active: true,
          next_run_date: "2025-09-01",
        },
      ],
      group_audit_logs: [],
    };
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
    if (originalServiceKey === undefined)
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  });

  it("blocks self-leave and account deletion when net_balance_cents != 0 and allows both when balanced at zero", async () => {
    // 1. Elena owes $100.00 in grp-apt4b -> self-leave blocked with 409 and structured balance
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-elena", email: "elena@example.com" } },
      error: null,
    });
    const blockedLeaveRes = await leavePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/leave", {
        method: "POST",
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(blockedLeaveRes.status).toBe(409);
    const blockedLeaveJson = await blockedLeaveRes.json();
    expect(blockedLeaveJson.code).toBe("UNSETTLED_BALANCE");
    expect(blockedLeaveJson.netBalanceCents).toBe(-10000);
    expect(blockedLeaveJson.formattedBalance).toBe("-$100.00");

    // 2. Elena attempts account deletion while owing $100.00 -> blocked with 409
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-elena", email: "elena@example.com" } },
      error: null,
    });
    const blockedAccountGet = await accountGet();
    expect(blockedAccountGet.status).toBe(200);
    const getPayload = await blockedAccountGet.json();
    expect(getPayload.canDelete).toBe(false);
    expect(getPayload.unsettledGroups).toHaveLength(1);

    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-elena", email: "elena@example.com" } },
      error: null,
    });
    const blockedAccountDelete = await accountDelete();
    expect(blockedAccountDelete.status).toBe(409);
    const blockedDeleteJson = await blockedAccountDelete.json();
    expect(blockedDeleteJson.code).toBe("UNSETTLED_BALANCES");
    expect(blockedDeleteJson.unsettledGroups[0].netBalanceCents).toBe(-10000);

    // 3. u-zero has $0.00 balance in grp-tahoe -> self-leave succeeds and rebalances remaining active members
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-zero", email: "zero@example.com" } },
      error: null,
    });
    const allowedLeaveRes = await leavePost(
      new NextRequest("http://localhost:3000/api/groups/grp-tahoe/leave", {
        method: "POST",
      }),
      { params: Promise.resolve({ groupId: "grp-tahoe" }) },
    );
    expect(allowedLeaveRes.status).toBe(200);
    expect(
      activeDb.group_members.some(
        (m) => m.group_id === "grp-tahoe" && m.user_id === "u-zero",
      ),
    ).toBe(false);
    expect(
      activeDb.group_members.find(
        (m) => m.group_id === "grp-tahoe" && m.user_id === "u-admin",
      )?.share_percentage,
    ).toBe(100);

    // 4. u-zero now has 0 balances across all groups -> account deletion succeeds
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-zero", email: "zero@example.com" } },
      error: null,
    });
    const allowedAccountDelete = await accountDelete();
    expect(allowedAccountDelete.status).toBe(200);
    expect(activeDb.users.some((u) => u.id === "u-zero")).toBe(false);
  });

  it("transitions ADMIN force-removed member with non-zero balance to FORMER_MEMBER, excludes them from future default splits, and still permits debt settlement", async () => {
    // Non-admin cannot remove members
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-elena", email: "elena@example.com" } },
      error: null,
    });
    const forbiddenRes = await removeMemberDelete(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/members/u-marcus",
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ groupId: "grp-apt4b", userId: "u-marcus" }) },
    );
    expect(forbiddenRes.status).toBe(403);

    // ADMIN force-removes Marcus who owes $100.00 -> transitions to FORMER_MEMBER
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const removeRes = await removeMemberDelete(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/members/u-marcus",
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ groupId: "grp-apt4b", userId: "u-marcus" }) },
    );
    expect(removeRes.status).toBe(200);
    const removeJson = await removeRes.json();
    expect(removeJson.transition).toBe("FORMER_MEMBER");
    expect(removeJson.netBalanceCents).toBe(-10000);

    const marcusRow = activeDb.group_members.find(
      (m) => m.group_id === "grp-apt4b" && m.user_id === "u-marcus",
    );
    expect(marcusRow?.status).toBe("FORMER_MEMBER");
    expect(marcusRow?.share_percentage).toBe(0);

    // Remaining ACTIVE members rebalanced to 50% / 50%
    expect(
      activeDb.group_members.find(
        (m) => m.group_id === "grp-apt4b" && m.user_id === "u-admin",
      )?.share_percentage,
    ).toBe(50);
    expect(
      activeDb.group_members.find(
        (m) => m.group_id === "grp-apt4b" && m.user_id === "u-elena",
      )?.share_percentage,
    ).toBe(50);

    // Future default split excludes FORMER_MEMBER
    const futureDefault = buildDefaultSplitExcludingFormerMembers({
      amountCents: 10001,
      paidBy: "u-admin",
      defaultSplitMode: "EQUAL",
      members: activeDb.group_members
        .filter((m) => m.group_id === "grp-apt4b")
        .map((m) => ({
          userId: m.user_id,
          status: m.status,
          sharePercentage: m.share_percentage,
        })),
    });
    expect(futureDefault.map((item) => item.user_id)).toEqual([
      "u-admin",
      "u-elena",
    ]);
    expect(futureDefault.reduce((s, i) => s + i.share_cents, 0)).toBe(10001);

    // New expense via API automatically excludes FORMER_MEMBER from default split
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const newExpenseRes = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          description: "Internet Bill",
          category: "Utilities",
          amount_cents: 6000,
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(newExpenseRes.status).toBe(201);
    const newExpJson = await newExpenseRes.json();
    expect(newExpJson.expense.split_breakdown).toHaveLength(2);
    expect(
      newExpJson.expense.split_breakdown.some(
        (b: { user_id: string }) => b.user_id === "u-marcus",
      ),
    ).toBe(false);

    // FORMER_MEMBER cannot log new expenses (403)
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-marcus", email: "marcus@example.com" } },
      error: null,
    });
    const formerExpRes = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          description: "Unauthorized Coffee",
          category: "Food",
          amount_cents: 500,
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(formerExpRes.status).toBe(403);

    // FORMER_MEMBER CAN record a self-involved settlement to clear remaining debt
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-marcus", email: "marcus@example.com" } },
      error: null,
    });
    const formerSettleRes = await settlementPost(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/settlements",
        {
          method: "POST",
          body: JSON.stringify({
            payer_id: "u-marcus",
            recipient_id: "u-admin",
            amount_cents: 10000,
            payment_rail: "VENMO",
          }),
        },
      ),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(formerSettleRes.status).toBe(201);
  });

  it("evaluates Trip 14-day zero-balance auto-archive, Residential 7-day post-lease prompt, and Archive Rules updates", async () => {
    // Pure helper unit assertions
    const now = new Date("2026-11-26T12:00:00.000Z");
    expect(
      evaluateTripAutoArchive(
        {
          groupType: "TRIP",
          status: "ACTIVE",
          tripAutoArchiveEnabled: true,
          tripAutoArchiveDays: 14,
          isFullySettled: true,
          zeroBalanceSince: "2026-11-12T12:00:00.000Z",
        },
        now,
      ).shouldAutoArchive,
    ).toBe(true);

    expect(
      evaluateTripAutoArchive(
        {
          groupType: "TRIP",
          status: "ACTIVE",
          tripAutoArchiveEnabled: true,
          tripAutoArchiveDays: 14,
          isFullySettled: true,
          zeroBalanceSince: "2026-11-15T12:00:00.000Z",
        },
        now,
      ).shouldAutoArchive,
    ).toBe(false);

    expect(
      evaluateResidentialLeasePrompt(
        {
          groupType: "RESIDENTIAL",
          status: "ACTIVE",
          residentialLeasePromptEnabled: true,
          leaseEndDate: "2026-11-19",
          leasePromptSnoozedUntil: null,
        },
        now,
      ).shouldPromptLeaseArchive,
    ).toBe(true);

    // ADMIN updates archive rules on grp-apt4b
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const rulesRes = await archiveRulesPatch(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/archive-rules",
        {
          method: "PATCH",
          body: JSON.stringify({
            trip_auto_archive_enabled: false,
            trip_auto_archive_days: 21,
            residential_lease_prompt_enabled: true,
          }),
        },
      ),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(rulesRes.status).toBe(200);
    expect(activeDb.groups[0].trip_auto_archive_days).toBe(21);

    // Archive check auto-archives grp-tahoe (15 days at zero balance) and flags grp-apt4b lease prompt
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const checkRes = await archiveCheckPost();
    expect(checkRes.status).toBe(200);
    const checkJson = await checkRes.json();
    expect(checkJson.autoArchivedGroupIds).toContain("grp-tahoe");
    expect(checkJson.leasePromptGroupIds).toContain("grp-apt4b");
    expect(
      activeDb.groups.find((g) => g.id === "grp-tahoe")?.status,
    ).toBe("ARCHIVED");
  });

  it("rejects all Expense, Settlement, and RecurringRule writes on ARCHIVED groups", async () => {
    // 1. Expense write -> 409
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const expRes = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-archived/expenses", {
        method: "POST",
        body: JSON.stringify({
          description: "Late Charge",
          category: "Travel",
          amount_cents: 1500,
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-archived" }) },
    );
    expect(expRes.status).toBe(409);
    expect((await expRes.json()).code).toBe("GROUP_ARCHIVED");

    // 2. Settlement write -> 409
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const settleRes = await settlementPost(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-archived/settlements",
        {
          method: "POST",
          body: JSON.stringify({
            payer_id: "u-elena",
            recipient_id: "u-admin",
            amount_cents: 1000,
            payment_rail: "VENMO",
          }),
        },
      ),
      { params: Promise.resolve({ groupId: "grp-archived" }) },
    );
    expect(settleRes.status).toBe(409);
    expect((await settleRes.json()).code).toBe("GROUP_ARCHIVED");

    // 3. RecurringRule create -> 409
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const recCreateRes = await recurringPost(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-archived/recurring-rules",
        {
          method: "POST",
          body: JSON.stringify({
            description: "Monthly Cleaning",
            category: "Household",
            amount_cents: 5000,
            day_of_month: 1,
          }),
        },
      ),
      { params: Promise.resolve({ groupId: "grp-archived" }) },
    );
    expect(recCreateRes.status).toBe(409);
    expect((await recCreateRes.json()).code).toBe("GROUP_ARCHIVED");

    // 4. RecurringRule update -> 409
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const recPatchRes = await recurringPatch(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-archived/recurring-rules",
        {
          method: "PATCH",
          body: JSON.stringify({
            rule_id: "rec-archived-1",
            is_active: false,
          }),
        },
      ),
      { params: Promise.resolve({ groupId: "grp-archived" }) },
    );
    expect(recPatchRes.status).toBe(409);

    // 5. RecurringRule delete -> 409
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const recDelRes = await recurringDelete(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-archived/recurring-rules?rule_id=rec-archived-1",
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ groupId: "grp-archived" }) },
    );
    expect(recDelRes.status).toBe(409);
  });
});
