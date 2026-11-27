import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExpensesPageData } from "@/lib/expenses/queries";
import { getGroupAuditLogs } from "@/lib/groups/audit-log";
import { getUserGroupBalances } from "@/lib/groups/departure";
import { computeExpenseShareShifts } from "@/lib/groups/ledger-guards";

const getUserMock = vi.fn();

interface InMemoryUserRow {
  id: string;
  email: string;
  full_name: string;
  base_currency: string;
  personal_share_cap_cents: number | null;
  instant_settlement_tag: string | null;
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

interface InMemoryRevisionRow {
  id: string;
  expense_id: string;
  updated_by: string;
  old_snapshot: Record<string, unknown>;
  new_snapshot: Record<string, unknown>;
  created_at: string;
}

interface InMemoryNotificationRow {
  id: string;
  user_id: string;
  group_id: string | null;
  actor_id: string | null;
  expense_id: string | null;
  revision_id: string | null;
  type: string;
  title: string;
  description: string;
  delta_cents: number | null;
  currency: string | null;
  href: string | null;
  is_read: boolean;
  created_at: string;
}

interface InMemoryBillingCycleRow {
  id: string;
  group_id: string;
  period_start: string;
  period_end: string;
  status: "OPEN" | "CLOSED";
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

interface InMemoryDb {
  users: InMemoryUserRow[];
  groups: InMemoryGroupRow[];
  group_members: InMemoryMemberRow[];
  expenses: InMemoryExpenseRow[];
  expense_revisions: InMemoryRevisionRow[];
  notifications: InMemoryNotificationRow[];
  billing_cycles: InMemoryBillingCycleRow[];
  settlements: InMemorySettlementRow[];
  recurring_rules: Array<Record<string, unknown>>;
  group_audit_logs: Array<Record<string, unknown>>;
}

function createInMemorySupabase(db: InMemoryDb) {
  type Filter =
    | { op: "eq" | "neq" | "in"; col: string; val: unknown }
    | { op: "is"; col: string; val: null }
    | { op: "or"; expr: string };

  function applyFilters<T extends object>(rows: T[], filters: Filter[]): T[] {
    return rows.filter((row) =>
      filters.every((f) => {
        const rec = row as Record<string, unknown>;
        if (f.op === "eq") return rec[f.col] === f.val;
        if (f.op === "neq") return rec[f.col] !== f.val;
        if (f.op === "in" && Array.isArray(f.val)) {
          return f.val.includes(rec[f.col]);
        }
        if (f.op === "is") return rec[f.col] === f.val;
        if (f.op === "or") {
          const match = /%([^%]+)%/.exec(f.expr);
          if (!match) return true;
          const needle = match[1].toLowerCase();
          return (
            String(rec.description ?? "")
              .toLowerCase()
              .includes(needle) ||
            String(rec.category ?? "")
              .toLowerCase()
              .includes(needle)
          );
        }
        return true;
      }),
    );
  }

  function makeTable<T extends object>(rows: T[], prefix: string) {
    return {
      select: () => {
        const filters: Filter[] = [];
        let orderCol: string | null = null;
        let orderAsc = true;
        let limitCount: number | null = null;

        const run = async () => {
          let result = applyFilters(rows, filters).map((r) => ({ ...r }));
          if (orderCol) {
            const col = orderCol;
            result = result.sort((a, b) => {
              const av = String((a as Record<string, unknown>)[col] ?? "");
              const bv = String((b as Record<string, unknown>)[col] ?? "");
              return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            });
          }
          if (limitCount !== null) {
            result = result.slice(0, limitCount);
          }
          return { data: result, error: null };
        };

        const builder = {
          eq: (col: string, val: unknown) => {
            filters.push({ op: "eq", col, val });
            return builder;
          },
          neq: (col: string, val: unknown) => {
            filters.push({ op: "neq", col, val });
            return builder;
          },
          in: (col: string, val: unknown[]) => {
            filters.push({ op: "in", col, val });
            return builder;
          },
          is: (col: string, val: null) => {
            filters.push({ op: "is", col, val });
            return builder;
          },
          or: (expr: string) => {
            filters.push({ op: "or", expr });
            return builder;
          },
          order: (col: string, opts?: { ascending?: boolean }) => {
            orderCol = col;
            orderAsc = opts?.ascending ?? true;
            return builder;
          },
          limit: (n: number) => {
            limitCount = n;
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
      insert: (input: Partial<T> | Array<Partial<T>>) => {
        const items = Array.isArray(input) ? input : [input];
        const inserted: T[] = items.map((item, idx) => {
          const rec = item as Record<string, unknown>;
          const stored = {
            id: rec.id ?? `${prefix}-${rows.length + idx + 1}`,
            created_at: rec.created_at ?? new Date().toISOString(),
            ...rec,
          } as unknown as T;
          rows.push(stored);
          return { ...stored };
        });

        const selectBuilder = {
          maybeSingle: async () => ({ data: inserted[0] ?? null, error: null }),
          then: (onFulfilled: (val: { data: T[]; error: null }) => unknown) =>
            Promise.resolve({ data: inserted, error: null }).then(onFulfilled),
        };

        return {
          select: () => selectBuilder,
          then: (onFulfilled: (val: { data: T[]; error: null }) => unknown) =>
            Promise.resolve({ data: inserted, error: null }).then(onFulfilled),
        };
      },
      update: (patch: Partial<T>) => {
        const filters: Filter[] = [];
        const apply = async () => {
          const matched = applyFilters(rows, filters);
          for (const item of matched) {
            Object.assign(item, patch);
          }
          return { data: matched.map((m) => ({ ...m })), error: null };
        };
        const builder = {
          eq: (col: string, val: unknown) => {
            filters.push({ op: "eq", col, val });
            return builder;
          },
          in: (col: string, val: unknown[]) => {
            filters.push({ op: "in", col, val });
            return builder;
          },
          is: (col: string, val: null) => {
            filters.push({ op: "is", col, val });
            return builder;
          },
          select: () => ({
            maybeSingle: async () => {
              const { data } = await apply();
              return { data: data[0] ?? null, error: null };
            },
            then: (onFulfilled: (val: { data: T[]; error: null }) => unknown) =>
              apply().then(onFulfilled),
          }),
          then: (onFulfilled: (val: { error: null }) => unknown) =>
            apply().then(() => onFulfilled({ error: null })),
        };
        return builder;
      },
    };
  }

  return {
    auth: { getUser: getUserMock },
    from: (table: keyof InMemoryDb) => {
      return makeTable(db[table] as object[], table.slice(0, 3));
    },
  };
}

let activeDb: InMemoryDb;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => createInMemorySupabase(activeDb)),
}));

import {
  DELETE as expenseDelete,
  PATCH as expensePatch,
} from "@/app/api/groups/[groupId]/expenses/[expenseId]/route";
import { GET as groupExpensesGet } from "@/app/api/groups/[groupId]/expenses/route";
import {
  GET as notificationsGet,
  PATCH as notificationsPatch,
} from "@/app/api/notifications/route";
import { GET as searchGet } from "@/app/api/search/route";

describe("Pre-Lock Expense Editing (ExpenseRevision), Notifications & Soft-Delete API", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-123";
    getUserMock.mockReset();

    activeDb = {
      users: [
        {
          id: "u-alex",
          email: "alex@example.com",
          full_name: "Alex Rivera",
          base_currency: "USD",
          personal_share_cap_cents: 160000,
          instant_settlement_tag: "@alex",
        },
        {
          id: "u-elena",
          email: "elena@example.com",
          full_name: "Elena Rostova",
          base_currency: "USD",
          personal_share_cap_cents: null,
          instant_settlement_tag: "@elena",
        },
        {
          id: "u-marcus",
          email: "marcus@example.com",
          full_name: "Marcus Vance",
          base_currency: "USD",
          personal_share_cap_cents: null,
          instant_settlement_tag: "@marcus",
        },
        {
          id: "u-former",
          email: "former@example.com",
          full_name: "Former Member",
          base_currency: "USD",
          personal_share_cap_cents: null,
          instant_settlement_tag: null,
        },
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
          created_at: "2026-10-01T00:00:00.000Z",
        },
      ],
      group_members: [
        {
          group_id: "grp-apt4b",
          user_id: "u-alex",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 33.34,
          joined_at: "2026-10-01T00:00:00.000Z",
        },
        {
          group_id: "grp-apt4b",
          user_id: "u-elena",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 33.33,
          joined_at: "2026-10-02T00:00:00.000Z",
        },
        {
          group_id: "grp-apt4b",
          user_id: "u-marcus",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 33.33,
          joined_at: "2026-10-03T00:00:00.000Z",
        },
        {
          group_id: "grp-apt4b",
          user_id: "u-former",
          role: "MEMBER",
          status: "FORMER_MEMBER",
          share_percentage: 0,
          joined_at: "2026-10-04T00:00:00.000Z",
        },
      ],
      expenses: [
        {
          id: "exp-elena-1",
          group_id: "grp-apt4b",
          created_by: "u-elena",
          paid_by: "u-elena",
          description: "Trader Joe's Groceries",
          category: "Groceries & Food",
          expense_date: "2026-11-20T12:00:00.000Z",
          amount_cents: 12000,
          currency: "USD",
          original_amount_cents: null,
          original_currency: null,
          exchange_rate: null,
          exchange_rate_source: null,
          split_method: "EQUAL",
          split_breakdown: [
            { user_id: "u-alex", share_cents: 4000, percentage: 33.33 },
            { user_id: "u-elena", share_cents: 4000, percentage: 33.34 },
            { user_id: "u-marcus", share_cents: 4000, percentage: 33.33 },
          ],
          receipt_url: null,
          is_recurring_generated: false,
          recurring_rule_id: null,
          adjustment_for_expense_id: null,
          is_locked: false,
          deleted_at: null,
        },
        {
          id: "exp-locked-col",
          group_id: "grp-apt4b",
          created_by: "u-elena",
          paid_by: "u-elena",
          description: "Locked By Column",
          category: "Utilities",
          expense_date: "2026-11-18T12:00:00.000Z",
          amount_cents: 9000,
          currency: "USD",
          original_amount_cents: null,
          original_currency: null,
          exchange_rate: null,
          exchange_rate_source: null,
          split_method: "EQUAL",
          split_breakdown: [
            { user_id: "u-alex", share_cents: 3000, percentage: 33.33 },
            { user_id: "u-elena", share_cents: 3000, percentage: 33.34 },
            { user_id: "u-marcus", share_cents: 3000, percentage: 33.33 },
          ],
          receipt_url: null,
          is_recurring_generated: false,
          recurring_rule_id: null,
          adjustment_for_expense_id: null,
          is_locked: true,
          deleted_at: null,
        },
      ],
      expense_revisions: [],
      notifications: [],
      billing_cycles: [
        {
          id: "bc-oct",
          group_id: "grp-apt4b",
          period_start: "2026-10-01",
          period_end: "2026-10-31",
          status: "CLOSED",
        },
      ],
      settlements: [],
      recurring_rules: [],
      group_audit_logs: [],
    };
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });

  it("computes share shifts accurately across added, removed, modified, and unchanged participants", () => {
    const shifts = computeExpenseShareShifts(
      [
        { user_id: "u-alex", share_cents: 4000 },
        { user_id: "u-elena", share_cents: 4000 },
        { user_id: "u-marcus", share_cents: 4000 },
      ],
      [
        { user_id: "u-alex", share_cents: 4000 }, // unchanged
        { user_id: "u-elena", share_cents: 6000 }, // +2000
        { user_id: "u-sam", share_cents: 2000 }, // +2000 added
      ],
    );

    expect(shifts).toEqual([
      {
        userId: "u-elena",
        oldShareCents: 4000,
        newShareCents: 6000,
        deltaCents: 2000,
        absDeltaCents: 2000,
      },
      {
        userId: "u-marcus",
        oldShareCents: 4000,
        newShareCents: 0,
        deltaCents: -4000,
        absDeltaCents: 4000,
      },
      {
        userId: "u-sam",
        oldShareCents: 0,
        newShareCents: 2000,
        deltaCents: 2000,
        absDeltaCents: 2000,
      },
    ]);
  });

  it("enforces creator-or-ADMIN permission: non-creator MEMBER and FORMER_MEMBER cannot edit or soft-delete", async () => {
    // 1. Marcus (MEMBER, not creator of exp-elena-1) -> 403 on PATCH and DELETE
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-marcus", email: "marcus@example.com" } },
      error: null,
    });

    const marcusPatchRes = await expensePatch(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/expenses/exp-elena-1",
        {
          method: "PATCH",
          body: JSON.stringify({
            description: "Unauthorized Edit",
            category: "General",
            amount_cents: 12000,
          }),
        },
      ),
      {
        params: Promise.resolve({
          groupId: "grp-apt4b",
          expenseId: "exp-elena-1",
        }),
      },
    );
    expect(marcusPatchRes.status).toBe(403);
    expect((await marcusPatchRes.json()).code).toBe("FORBIDDEN");

    const marcusDelRes = await expenseDelete(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/expenses/exp-elena-1",
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({
          groupId: "grp-apt4b",
          expenseId: "exp-elena-1",
        }),
      },
    );
    expect(marcusDelRes.status).toBe(403);
    expect((await marcusDelRes.json()).code).toBe("FORBIDDEN");

    // 2. Former member -> 403 FORMER_MEMBER_RESTRICTED even if they created an expense
    activeDb.expenses.push({
      ...activeDb.expenses[0],
      id: "exp-former-1",
      created_by: "u-former",
    });
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-former", email: "former@example.com" } },
      error: null,
    });

    const formerPatchRes = await expensePatch(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/expenses/exp-former-1",
        {
          method: "PATCH",
          body: JSON.stringify({
            description: "Former Edit",
            category: "General",
            amount_cents: 12000,
          }),
        },
      ),
      {
        params: Promise.resolve({
          groupId: "grp-apt4b",
          expenseId: "exp-former-1",
        }),
      },
    );
    expect(formerPatchRes.status).toBe(403);
    expect((await formerPatchRes.json()).code).toBe("FORMER_MEMBER_RESTRICTED");
    expect(activeDb.expense_revisions).toHaveLength(0);
  });

  it("blocks edits and soft-deletes when expense is locked by is_locked, closed billing cycle, or settlement watermark", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });

    // 1. Locked via is_locked=true column
    const lockedPatchRes = await expensePatch(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/expenses/exp-locked-col",
        {
          method: "PATCH",
          body: JSON.stringify({
            description: "Try Edit Locked",
            category: "Utilities",
            amount_cents: 9000,
          }),
        },
      ),
      {
        params: Promise.resolve({
          groupId: "grp-apt4b",
          expenseId: "exp-locked-col",
        }),
      },
    );
    expect(lockedPatchRes.status).toBe(409);
    expect((await lockedPatchRes.json()).code).toBe("EXPENSE_LOCKED");

    const lockedDelRes = await expenseDelete(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/expenses/exp-locked-col",
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({
          groupId: "grp-apt4b",
          expenseId: "exp-locked-col",
        }),
      },
    );
    expect(lockedDelRes.status).toBe(409);

    // 2. Locked via closed billing cycle (2026-10)
    activeDb.expenses.push({
      ...activeDb.expenses[0],
      id: "exp-closed-cycle",
      expense_date: "2026-10-15T12:00:00.000Z",
      is_locked: false,
    });
    const closedCycleRes = await expensePatch(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/expenses/exp-closed-cycle",
        {
          method: "PATCH",
          body: JSON.stringify({
            description: "Try Closed Cycle",
            category: "General",
            amount_cents: 12000,
          }),
        },
      ),
      {
        params: Promise.resolve({
          groupId: "grp-apt4b",
          expenseId: "exp-closed-cycle",
        }),
      },
    );
    expect(closedCycleRes.status).toBe(409);
    expect((await closedCycleRes.json()).code).toBe("EXPENSE_LOCKED");

    // 3. Locked via pairwise settlement watermark (settled_at >= expense_date)
    activeDb.settlements.push({
      id: "set-1",
      group_id: "grp-apt4b",
      payer_id: "u-alex",
      recipient_id: "u-elena",
      amount_cents: 1000,
      currency: "USD",
      payment_rail: "VENMO",
      settled_at: "2026-11-21T00:00:00.000Z",
    });

    const watermarkDelRes = await expenseDelete(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/expenses/exp-elena-1",
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({
          groupId: "grp-apt4b",
          expenseId: "exp-elena-1",
        }),
      },
    );
    expect(watermarkDelRes.status).toBe(409);
    expect((await watermarkDelRes.json()).code).toBe("EXPENSE_LOCKED");
  });

  it("appends ExpenseRevision on creator/ADMIN edits and generates notifications only when member shares shift by > 0", async () => {
    // 1. Creator (Elena) edits description & category only -> ExpenseRevision created, 0 notifications
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-elena", email: "elena@example.com" } },
      error: null,
    });

    const descEditRes = await expensePatch(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/expenses/exp-elena-1",
        {
          method: "PATCH",
          body: JSON.stringify({
            paid_by: "u-elena",
            description: "Trader Joe's Organic Market",
            category: "Groceries & Food",
            amount_cents: 12000,
            expense_date: "2026-11-20T12:00:00.000Z",
            split_method: "EQUAL",
            split_breakdown: [
              { user_id: "u-alex", share_cents: 4000, percentage: 33.33 },
              { user_id: "u-elena", share_cents: 4000, percentage: 33.34 },
              { user_id: "u-marcus", share_cents: 4000, percentage: 33.33 },
            ],
          }),
        },
      ),
      {
        params: Promise.resolve({
          groupId: "grp-apt4b",
          expenseId: "exp-elena-1",
        }),
      },
    );
    expect(descEditRes.status).toBe(200);
    const descEditJson = await descEditRes.json();
    expect(descEditJson.expense.description).toBe("Trader Joe's Organic Market");
    expect(descEditJson.notifications).toHaveLength(0);
    expect(activeDb.expense_revisions).toHaveLength(1);
    expect(activeDb.notifications).toHaveLength(0);

    // 2. ADMIN (Alex) edits Elena's expense amount from $120.00 to $150.00 (5000 each) -> ExpenseRevision + 2 notifications (Elena & Marcus)
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });

    const adminEditRes = await expensePatch(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/expenses/exp-elena-1",
        {
          method: "PATCH",
          body: JSON.stringify({
            paid_by: "u-elena",
            description: "Trader Joe's Organic Market",
            category: "Groceries & Food",
            amount_cents: 15000,
            expense_date: "2026-11-20T12:00:00.000Z",
            split_method: "EQUAL",
            split_breakdown: [
              { user_id: "u-alex", share_cents: 5000, percentage: 33.33 },
              { user_id: "u-elena", share_cents: 5000, percentage: 33.34 },
              { user_id: "u-marcus", share_cents: 5000, percentage: 33.33 },
            ],
          }),
        },
      ),
      {
        params: Promise.resolve({
          groupId: "grp-apt4b",
          expenseId: "exp-elena-1",
        }),
      },
    );
    expect(adminEditRes.status).toBe(200);
    const adminEditJson = await adminEditRes.json();
    expect(adminEditJson.expense.amount_cents).toBe(15000);
    expect(activeDb.expense_revisions).toHaveLength(2);

    const rev = activeDb.expense_revisions[1];
    expect(rev.updated_by).toBe("u-alex");
    expect((rev.old_snapshot as { shares_by_user: Record<string, number> }).shares_by_user).toEqual({
      "u-alex": 4000,
      "u-elena": 4000,
      "u-marcus": 4000,
    });
    expect((rev.new_snapshot as { shares_by_user: Record<string, number> }).shares_by_user).toEqual({
      "u-alex": 5000,
      "u-elena": 5000,
      "u-marcus": 5000,
    });

    // Notifications generated for Elena and Marcus (share shifted +1000 > 0)
    expect(adminEditJson.notifications).toHaveLength(2);
    expect(activeDb.notifications.map((n) => n.user_id).sort()).toEqual([
      "u-elena",
      "u-marcus",
    ]);
    expect(activeDb.notifications[0].type).toBe("EXPENSE_REVISION");
    expect(activeDb.notifications[0].delta_cents).toBe(1000);
    expect(activeDb.notifications[0].description).toContain("$40.00 to $50.00");

    // Audit log includes EXPENSE_REVISION entries
    const supabase = createInMemorySupabase(activeDb) as unknown as Parameters<
      typeof getGroupAuditLogs
    >[0];
    const auditResult = await getGroupAuditLogs(supabase, "u-alex", "grp-apt4b");
    expect(auditResult.ok).toBe(true);
    if (auditResult.ok) {
      const revEntries = auditResult.entries.filter(
        (e) => e.eventType === "EXPENSE_REVISION",
      );
      expect(revEntries).toHaveLength(2);
      expect(revEntries[0].details).toContain("Total: $120.00 -> $150.00");
    }

    // Elena fetches and marks notifications read
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-elena", email: "elena@example.com" } },
      error: null,
    });
    const getNotifRes = await notificationsGet();
    expect(getNotifRes.status).toBe(200);
    const getNotifJson = await getNotifRes.json();
    expect(getNotifJson.notifications).toHaveLength(1);
    expect(getNotifJson.notifications[0].is_read).toBe(false);

    const markReadRes = await notificationsPatch(
      new NextRequest("http://localhost:3000/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
    );
    expect(markReadRes.status).toBe(200);
    expect(activeDb.notifications.find((n) => n.user_id === "u-elena")?.is_read).toBe(
      true,
    );
  });

  it("soft-deletes unlocked expense by setting deleted_at and excludes it from active balances and ledger lists", async () => {
    const supabase = createInMemorySupabase(activeDb) as unknown as Parameters<
      typeof getExpensesPageData
    >[0];

    // Before soft-delete: exp-elena-1 + exp-locked-col = 12000 + 9000 = 21000
    const beforePage = await getExpensesPageData(supabase, "u-alex");
    expect(beforePage.expenses.map((e) => e.id)).toContain("exp-elena-1");

    const beforeBal = await getUserGroupBalances(supabase, "u-elena");
    expect(beforeBal.ok).toBe(true);
    if (beforeBal.ok) {
      // Elena paid 12000 + 9000 = 21000, Elena shares 4000 + 3000 = 7000 -> net +14000
      expect(beforeBal.balances[0].netBalanceCents).toBe(14000);
    }

    // Creator soft-deletes exp-elena-1
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-elena", email: "elena@example.com" } },
      error: null,
    });
    const delRes = await expenseDelete(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/expenses/exp-elena-1",
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({
          groupId: "grp-apt4b",
          expenseId: "exp-elena-1",
        }),
      },
    );
    expect(delRes.status).toBe(200);
    const delJson = await delRes.json();
    expect(delJson.ok).toBe(true);
    expect(delJson.deletedAt).toBeTruthy();

    // Row remains in DB with deleted_at IS NOT NULL
    const storedRow = activeDb.expenses.find((e) => e.id === "exp-elena-1");
    expect(storedRow?.deleted_at).not.toBeNull();

    // Excluded from active ledger lists (getExpensesPageData, GET /expenses, /api/search)
    const afterPage = await getExpensesPageData(supabase, "u-alex");
    expect(afterPage.expenses.map((e) => e.id)).not.toContain("exp-elena-1");
    expect(afterPage.expenses.map((e) => e.id)).toEqual(["exp-locked-col"]);

    getUserMock.mockResolvedValue({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const listRes = await groupExpensesGet(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses"),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.expenses.map((e: { id: string }) => e.id)).toEqual([
      "exp-locked-col",
    ]);

    const searchRes = await searchGet(
      new NextRequest("http://localhost:3000/api/search?q=Trader"),
    );
    expect(searchRes.status).toBe(200);
    expect((await searchRes.json()).expenses).toHaveLength(0);

    // Excluded from active balances (only exp-locked-col remains: paid 9000 - share 3000 = +6000)
    const afterBal = await getUserGroupBalances(supabase, "u-elena");
    expect(afterBal.ok).toBe(true);
    if (afterBal.ok) {
      expect(afterBal.balances[0].netBalanceCents).toBe(6000);
    }

    // Re-deleting or editing a soft-deleted expense returns 404
    const secondDel = await expenseDelete(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/expenses/exp-elena-1",
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({
          groupId: "grp-apt4b",
          expenseId: "exp-elena-1",
        }),
      },
    );
    expect(secondDel.status).toBe(404);
  });
});
