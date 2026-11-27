import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeInitialNextRunDate,
  computeNextMonthlyRunDate,
  isValidIsoDateString,
  materializeDueRecurringRules,
} from "@/lib/expenses/recurring";
import type {
  ExpenseSplitMethod,
  GroupStatus,
  MemberRole,
  MemberStatus,
  RecurringFrequency,
  SplitBreakdownItem,
  SplitMode,
} from "@/types/database";

const getUserMock = vi.fn();

interface InMemoryGroupRow {
  id: string;
  name: string;
  status: GroupStatus;
  base_currency: string;
  default_split_mode: SplitMode;
}

interface InMemoryMemberRow {
  group_id: string;
  user_id: string;
  role: MemberRole;
  status: MemberStatus;
  share_percentage: number;
  joined_at: string;
}

interface InMemoryRecurringRuleRow {
  id: string;
  group_id: string;
  created_by: string | null;
  paid_by: string;
  description: string;
  category: string;
  amount_cents: number;
  currency: string;
  frequency: RecurringFrequency;
  day_of_month: number;
  split_rule: SplitMode;
  is_active: boolean;
  next_run_date: string;
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
  split_method: ExpenseSplitMethod;
  split_breakdown: SplitBreakdownItem[];
  is_recurring_generated: boolean;
  recurring_rule_id: string | null;
  recurring_occurrence_date: string | null;
  deleted_at: string | null;
}

interface InMemoryDb {
  groups: InMemoryGroupRow[];
  group_members: InMemoryMemberRow[];
  recurring_rules: InMemoryRecurringRuleRow[];
  expenses: InMemoryExpenseRow[];
}

function createInMemorySupabase(db: InMemoryDb) {
  type Filter = {
    col: string;
    val: unknown;
    op: "eq" | "neq" | "in" | "is" | "lte";
  };

  function filterRows<T extends object>(rows: T[], filters: Filter[]): T[] {
    return rows.filter((row) =>
      filters.every((f) => {
        const value = (row as Record<string, unknown>)[f.col];
        if (f.op === "in" && Array.isArray(f.val)) return f.val.includes(value);
        if (f.op === "neq") return value !== f.val;
        if (f.op === "is") return (value ?? null) === f.val;
        if (f.op === "lte") return String(value ?? "") <= String(f.val ?? "");
        return value === f.val;
      }),
    );
  }

  function makeTable<T extends object>(
    rows: T[],
    prefix: string,
    tableName: keyof InMemoryDb,
  ) {
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
          lte: (col: string, val: unknown) => {
            filters.push({ col, val, op: "lte" });
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
        if (tableName === "expenses") {
          const candidate = row as Partial<InMemoryExpenseRow>;
          if (
            candidate.recurring_rule_id &&
            candidate.recurring_occurrence_date &&
            db.expenses.some(
              (e) =>
                e.deleted_at === null &&
                e.recurring_rule_id === candidate.recurring_rule_id &&
                e.recurring_occurrence_date ===
                  candidate.recurring_occurrence_date,
            )
          ) {
            const err = {
              code: "23505",
              message: "duplicate key value violates unique constraint",
            };
            return {
              select: () => ({
                maybeSingle: async () => ({ data: null, error: err }),
              }),
              then: (onFulfilled: (val: { error: typeof err }) => unknown) =>
                Promise.resolve({ error: err }).then(onFulfilled),
            };
          }
        }

        const stored = {
          id: `${prefix}-${rows.length + 1}`,
          ...(tableName === "expenses" ? { deleted_at: null } : {}),
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
    auth: { getUser: getUserMock },
    from: (table: keyof InMemoryDb) => {
      switch (table) {
        case "groups":
          return makeTable(db.groups, "grp", "groups");
        case "group_members":
          return makeTable(db.group_members, "gm", "group_members");
        case "recurring_rules":
          return makeTable(db.recurring_rules, "rec", "recurring_rules");
        case "expenses":
          return makeTable(db.expenses, "exp", "expenses");
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

import {
  GET as cronGet,
  POST as cronPost,
} from "@/app/api/cron/recurring-expenses/route";
import {
  DELETE as recurringDelete,
  GET as recurringGet,
  PATCH as recurringPatch,
  POST as recurringPost,
} from "@/app/api/groups/[groupId]/recurring-rules/route";

describe("Recurring Rules Date Helpers", () => {
  it("computes initial and next monthly run dates deterministically", () => {
    expect(isValidIsoDateString("2026-11-27")).toBe(true);
    expect(isValidIsoDateString("2026-02-29")).toBe(false);

    expect(
      computeInitialNextRunDate(27, new Date("2026-11-27T10:00:00.000Z")),
    ).toBe("2026-11-27");
    expect(
      computeInitialNextRunDate(5, new Date("2026-11-27T10:00:00.000Z")),
    ).toBe("2026-12-05");
    expect(
      computeInitialNextRunDate(15, new Date("2026-12-20T10:00:00.000Z")),
    ).toBe("2027-01-15");

    expect(computeNextMonthlyRunDate("2026-11-27", 27)).toBe("2026-12-27");
    expect(computeNextMonthlyRunDate("2026-12-15", 15)).toBe("2027-01-15");
  });
});

describe("Recurring Rules API & Idempotent Cron Materialization", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-123";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-xyz";
    process.env.CRON_SECRET = "cron-secret-test-token";
    getUserMock.mockReset();

    activeDb = {
      groups: [
        {
          id: "grp-apt4b",
          name: "Apt 4B Roommates",
          status: "ACTIVE",
          base_currency: "USD",
          default_split_mode: "EQUAL",
        },
        {
          id: "grp-custom",
          name: "Custom Loft",
          status: "ACTIVE",
          base_currency: "USD",
          default_split_mode: "CUSTOM_RATIOS",
        },
        {
          id: "grp-needs-ratio",
          name: "Unbalanced Loft",
          status: "NEEDS_RATIO_UPDATE",
          base_currency: "USD",
          default_split_mode: "CUSTOM_RATIOS",
        },
        {
          id: "grp-archived",
          name: "Old Trip",
          status: "ARCHIVED",
          base_currency: "USD",
          default_split_mode: "EQUAL",
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
          user_id: "u-member",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 33.33,
          joined_at: "2026-09-02T00:00:00.000Z",
        },
        {
          group_id: "grp-apt4b",
          user_id: "u-member-2",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 33.33,
          joined_at: "2026-09-03T00:00:00.000Z",
        },
        {
          group_id: "grp-apt4b",
          user_id: "u-former",
          role: "MEMBER",
          status: "FORMER_MEMBER",
          share_percentage: 0,
          joined_at: "2026-09-04T00:00:00.000Z",
        },
        {
          group_id: "grp-custom",
          user_id: "u-admin",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 60,
          joined_at: "2026-09-01T00:00:00.000Z",
        },
        {
          group_id: "grp-custom",
          user_id: "u-member",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 40,
          joined_at: "2026-09-02T00:00:00.000Z",
        },
        {
          group_id: "grp-needs-ratio",
          user_id: "u-admin",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 100,
          joined_at: "2026-09-01T00:00:00.000Z",
        },
        {
          group_id: "grp-needs-ratio",
          user_id: "u-member",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 0,
          joined_at: "2026-11-01T00:00:00.000Z",
        },
        {
          group_id: "grp-archived",
          user_id: "u-admin",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 100,
          joined_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      recurring_rules: [
        {
          id: "rec-due-equal",
          group_id: "grp-apt4b",
          created_by: "u-member",
          paid_by: "u-admin",
          description: "Fiber Internet",
          category: "Utilities",
          amount_cents: 10000, // $100.00 split 3 active ways -> 3334 (payer), 3333, 3333
          currency: "USD",
          frequency: "MONTHLY",
          day_of_month: 27,
          split_rule: "EQUAL",
          is_active: true,
          next_run_date: "2026-11-27",
        },
        {
          id: "rec-due-custom",
          group_id: "grp-custom",
          created_by: "u-admin",
          paid_by: "u-admin",
          description: "Loft Rent",
          category: "Rent & Housing",
          amount_cents: 300000, // $3,000.00 -> 60% / 40%
          currency: "USD",
          frequency: "MONTHLY",
          day_of_month: 15,
          split_rule: "CUSTOM_RATIOS",
          is_active: true,
          next_run_date: "2026-11-15",
        },
        {
          id: "rec-paused",
          group_id: "grp-apt4b",
          created_by: "u-admin",
          paid_by: "u-admin",
          description: "Paused Gym",
          category: "General",
          amount_cents: 5000,
          currency: "USD",
          frequency: "MONTHLY",
          day_of_month: 1,
          split_rule: "EQUAL",
          is_active: false,
          next_run_date: "2026-11-01",
        },
        {
          id: "rec-future",
          group_id: "grp-apt4b",
          created_by: "u-admin",
          paid_by: "u-admin",
          description: "Future Cleaning",
          category: "Household Supplies",
          amount_cents: 8000,
          currency: "USD",
          frequency: "MONTHLY",
          day_of_month: 28,
          split_rule: "EQUAL",
          is_active: true,
          next_run_date: "2026-11-28",
        },
        {
          id: "rec-needs-ratio",
          group_id: "grp-needs-ratio",
          created_by: "u-admin",
          paid_by: "u-admin",
          description: "Paused Ratio Rent",
          category: "Rent & Housing",
          amount_cents: 200000,
          currency: "USD",
          frequency: "MONTHLY",
          day_of_month: 10,
          split_rule: "CUSTOM_RATIOS",
          is_active: true,
          next_run_date: "2026-11-10",
        },
        {
          id: "rec-archived",
          group_id: "grp-archived",
          created_by: "u-admin",
          paid_by: "u-admin",
          description: "Archived Rule",
          category: "General",
          amount_cents: 2500,
          currency: "USD",
          frequency: "MONTHLY",
          day_of_month: 5,
          split_rule: "EQUAL",
          is_active: true,
          next_run_date: "2026-11-05",
        },
      ],
      expenses: [],
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
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  it("allows active members (non-admin) to create, pause, and delete their own RecurringRule templates while protecting others' rules", async () => {
    // 1. Active MEMBER creates a recurring rule
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-member", email: "member@example.com" } },
      error: null,
    });
    const createRes = await recurringPost(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/recurring-rules",
        {
          method: "POST",
          body: JSON.stringify({
            description: "Water Filter",
            category: "Household Supplies",
            amount_cents: 2400,
            frequency: "MONTHLY",
            day_of_month: 12,
            split_rule: "EQUAL",
            next_run_date: "2026-12-12",
          }),
        },
      ),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(createRes.status).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.rule).toMatchObject({
      group_id: "grp-apt4b",
      created_by: "u-member",
      paid_by: "u-member",
      description: "Water Filter",
      amount_cents: 2400,
      day_of_month: 12,
      split_rule: "EQUAL",
      is_active: true,
      next_run_date: "2026-12-12",
    });
    const createdRuleId = createJson.rule.id as string;

    // 2. Active MEMBER can list recurring rules
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-member", email: "member@example.com" } },
      error: null,
    });
    const listRes = await recurringGet(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/recurring-rules",
      ),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(
      listJson.rules.some((r: { id: string }) => r.id === createdRuleId),
    ).toBe(true);

    // 3. Active MEMBER can pause their own rule
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-member", email: "member@example.com" } },
      error: null,
    });
    const pauseRes = await recurringPatch(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/recurring-rules",
        {
          method: "PATCH",
          body: JSON.stringify({
            rule_id: createdRuleId,
            is_active: false,
          }),
        },
      ),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(pauseRes.status).toBe(200);
    expect((await pauseRes.json()).rule.is_active).toBe(false);

    // 4. Another non-admin MEMBER cannot pause or delete u-member's rule (403)
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-member-2", email: "member2@example.com" } },
      error: null,
    });
    const forbiddenPatch = await recurringPatch(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/recurring-rules",
        {
          method: "PATCH",
          body: JSON.stringify({
            rule_id: createdRuleId,
            is_active: true,
          }),
        },
      ),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(forbiddenPatch.status).toBe(403);

    // 5. FORMER_MEMBER cannot create recurring rules (403)
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-former", email: "former@example.com" } },
      error: null,
    });
    const formerRes = await recurringPost(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/recurring-rules",
        {
          method: "POST",
          body: JSON.stringify({
            description: "Unauthorized",
            category: "General",
            amount_cents: 1000,
            day_of_month: 5,
          }),
        },
      ),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(formerRes.status).toBe(403);

    // 6. Creator (u-member) can delete their own rule
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-member", email: "member@example.com" } },
      error: null,
    });
    const delRes = await recurringDelete(
      new NextRequest(
        `http://localhost:3000/api/groups/grp-apt4b/recurring-rules?rule_id=${createdRuleId}`,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(delRes.status).toBe(200);
    expect(
      activeDb.recurring_rules.some((r) => r.id === createdRuleId),
    ).toBe(false);

    // 7. Rejects invalid day_of_month (29)
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-member", email: "member@example.com" } },
      error: null,
    });
    const badDayRes = await recurringPost(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/recurring-rules",
        {
          method: "POST",
          body: JSON.stringify({
            description: "Bad Day",
            category: "General",
            amount_cents: 1000,
            day_of_month: 29,
          }),
        },
      ),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(badDayRes.status).toBe(400);
  });

  it("enforces cron authentication and materializes due rules idempotently using active members", async () => {
    // 1. Unauthenticated without Bearer secret -> 401
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    const unauthRes = await cronGet(
      new NextRequest(
        "http://localhost:3000/api/cron/recurring-expenses?date=2026-11-27",
      ),
    );
    expect(unauthRes.status).toBe(401);

    // 2. Wrong Bearer secret -> 401
    const badSecretRes = await cronGet(
      new NextRequest(
        "http://localhost:3000/api/cron/recurring-expenses?date=2026-11-27",
        {
          headers: { authorization: "Bearer wrong-secret" },
        },
      ),
    );
    expect(badSecretRes.status).toBe(401);

    // 3. Valid Vercel Cron Bearer secret runs materialization for 2026-11-27
    const run1Res = await cronGet(
      new NextRequest(
        "http://localhost:3000/api/cron/recurring-expenses?date=2026-11-27",
        {
          headers: { authorization: "Bearer cron-secret-test-token" },
        },
      ),
    );
    expect(run1Res.status).toBe(200);
    const run1Json = await run1Res.json();

    // Should materialize rec-due-equal & rec-due-custom only (skips paused, future, needs-ratio, archived)
    expect(run1Json.materializedCount).toBe(2);
    expect(activeDb.expenses).toHaveLength(2);

    const equalExp = activeDb.expenses.find(
      (e) => e.recurring_rule_id === "rec-due-equal",
    );
    expect(equalExp).toBeDefined();
    expect(equalExp?.is_recurring_generated).toBe(true);
    expect(equalExp?.recurring_occurrence_date).toBe("2026-11-27");
    expect(equalExp?.expense_date).toBe("2026-11-27T00:00:00.000Z");
    expect(equalExp?.split_method).toBe("EQUAL");
    // Excludes u-former; 10000 / 3 = 3334 (payer u-admin), 3333, 3333
    expect(equalExp?.split_breakdown).toEqual([
      { user_id: "u-admin", share_cents: 3334, percentage: 33.34 },
      { user_id: "u-member", share_cents: 3333, percentage: 33.33 },
      { user_id: "u-member-2", share_cents: 3333, percentage: 33.33 },
    ]);
    expect(
      equalExp?.split_breakdown.some((s) => s.user_id === "u-former"),
    ).toBe(false);

    const customExp = activeDb.expenses.find(
      (e) => e.recurring_rule_id === "rec-due-custom",
    );
    expect(customExp).toBeDefined();
    expect(customExp?.is_recurring_generated).toBe(true);
    expect(customExp?.split_method).toBe("PERCENTAGE");
    expect(customExp?.split_breakdown).toEqual([
      { user_id: "u-admin", share_cents: 180000, percentage: 60 },
      { user_id: "u-member", share_cents: 120000, percentage: 40 },
    ]);

    // next_run_date advanced to next month
    expect(
      activeDb.recurring_rules.find((r) => r.id === "rec-due-equal")
        ?.next_run_date,
    ).toBe("2026-12-27");
    expect(
      activeDb.recurring_rules.find((r) => r.id === "rec-due-custom")
        ?.next_run_date,
    ).toBe("2026-12-15");
    // Future & paused untouched
    expect(
      activeDb.recurring_rules.find((r) => r.id === "rec-future")?.next_run_date,
    ).toBe("2026-11-28");

    // 4. Re-running cron for the SAME date (2026-11-27) creates ZERO duplicates
    const run2Res = await cronPost(
      new NextRequest("http://localhost:3000/api/cron/recurring-expenses", {
        method: "POST",
        headers: {
          authorization: "Bearer cron-secret-test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ run_date: "2026-11-27" }),
      }),
    );
    expect(run2Res.status).toBe(200);
    const run2Json = await run2Res.json();
    expect(run2Json.materializedCount).toBe(0);
    expect(activeDb.expenses).toHaveLength(2);

    // 5. Even if next_run_date was somehow reverted back to 2026-11-27, unique occurrence guard prevents duplicate
    const recEqual = activeDb.recurring_rules.find(
      (r) => r.id === "rec-due-equal",
    )!;
    recEqual.next_run_date = "2026-11-27";

    const directResult = await materializeDueRecurringRules(
      createInMemorySupabase(activeDb) as never,
      { runDate: "2026-11-27" },
    );
    expect(directResult.ok).toBe(true);
    if (directResult.ok) {
      expect(directResult.summary.materializedCount).toBe(0);
      expect(directResult.summary.alreadyMaterializedCount).toBe(1);
    }
    expect(activeDb.expenses).toHaveLength(2);
    expect(recEqual.next_run_date).toBe("2026-12-27");
  });
});
