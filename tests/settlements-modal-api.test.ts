import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computePerGroupDebtEdges,
  evaluateExpenseLockAndSettlement,
  type ExpenseGroupInfo,
  type ExpenseSettlementRecord,
} from "@/lib/expenses/ledger";

const getUserMock = vi.fn();

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

interface InMemoryDb {
  groups: InMemoryGroupRow[];
  group_members: InMemoryMemberRow[];
  expenses: InMemoryExpenseRow[];
  settlements: InMemorySettlementRow[];
}

function createInMemorySupabase(db: InMemoryDb) {
  type Filter = {
    col: string;
    val: unknown;
    op: "eq" | "in" | "is";
  };

  function filterRows<T extends object>(rows: T[], filters: Filter[]): T[] {
    return rows.filter((row) =>
      filters.every((f) => {
        const value = (row as Record<string, unknown>)[f.col];
        if (f.op === "in" && Array.isArray(f.val)) {
          return f.val.includes(value);
        }
        return value === f.val;
      }),
    );
  }

  function makeTable<T extends object>(rows: T[], prefix: string) {
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
          id: `${prefix}-${rows.length + 1}`,
          settled_at: new Date().toISOString(),
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
          is: (col: string, val: unknown) => {
            filters.push({ col, val, op: "is" });
            return builder;
          },
          select: () => ({
            maybeSingle: () => apply(),
          }),
        };
        return builder;
      },
    };
  }

  return {
    auth: {
      getUser: getUserMock,
    },
    from: (table: keyof InMemoryDb) => {
      switch (table) {
        case "groups":
          return makeTable(db.groups, "grp");
        case "group_members":
          return makeTable(db.group_members, "gm");
        case "expenses":
          return makeTable(db.expenses, "exp");
        case "settlements":
          return makeTable(db.settlements, "set");
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

import { POST as expensePost } from "@/app/api/groups/[groupId]/expenses/route";
import { PATCH as expensePatch } from "@/app/api/groups/[groupId]/expenses/[expenseId]/route";
import {
  GET as settlementGet,
  POST as settlementPost,
} from "@/app/api/groups/[groupId]/settlements/route";

describe("Issue #82 — Settlement API, partial/full math, watermark locking & FORMER_MEMBER permissions", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-123";
    getUserMock.mockReset();

    activeDb = {
      groups: [
        {
          id: "grp-usd",
          name: "Apt 4B Roommates",
          slug: "apt-4b",
          group_type: "RESIDENTIAL",
          status: "ACTIVE",
          base_currency: "USD",
          default_split_mode: "EQUAL",
          simplify_debts: true,
          operational_budget_cents: 300000,
          billing_cycle_anchor_day: 1,
        },
        {
          id: "grp-jpy",
          name: "Tokyo Trip",
          slug: "tokyo-trip",
          group_type: "TRIP",
          status: "ACTIVE",
          base_currency: "JPY",
          default_split_mode: "EQUAL",
          simplify_debts: false,
          operational_budget_cents: null,
          billing_cycle_anchor_day: 1,
        },
        {
          id: "grp-archived",
          name: "Old Trip",
          slug: "old-trip",
          group_type: "TRIP",
          status: "ARCHIVED",
          base_currency: "USD",
          default_split_mode: "EQUAL",
          simplify_debts: true,
          operational_budget_cents: null,
          billing_cycle_anchor_day: 1,
        },
      ],
      group_members: [
        {
          group_id: "grp-usd",
          user_id: "u-alex",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2026-10-01T00:00:00.000Z",
        },
        {
          group_id: "grp-usd",
          user_id: "u-elena",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2026-10-02T00:00:00.000Z",
        },
        {
          group_id: "grp-usd",
          user_id: "u-marcus",
          role: "MEMBER",
          status: "FORMER_MEMBER",
          share_percentage: 0,
          joined_at: "2026-10-03T00:00:00.000Z",
        },
        {
          group_id: "grp-jpy",
          user_id: "u-alex",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2026-10-01T00:00:00.000Z",
        },
        {
          group_id: "grp-jpy",
          user_id: "u-outsider",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2026-10-02T00:00:00.000Z",
        },
        {
          group_id: "grp-archived",
          user_id: "u-alex",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 100,
          joined_at: "2026-10-01T00:00:00.000Z",
        },
      ],
      expenses: [
        {
          id: "exp-1",
          group_id: "grp-usd",
          created_by: "u-alex",
          paid_by: "u-alex",
          description: "October Utilities & Groceries",
          category: "Utilities",
          expense_date: "2026-11-05T12:00:00.000Z",
          amount_cents: 30000,
          currency: "USD",
          original_amount_cents: null,
          original_currency: null,
          exchange_rate: null,
          exchange_rate_source: null,
          split_method: "EQUAL",
          split_breakdown: [
            { user_id: "u-alex", share_cents: 10000 },
            { user_id: "u-elena", share_cents: 10000 },
            { user_id: "u-marcus", share_cents: 10000 },
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
    };
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
    vi.clearAllMocks();
  });

  it("persists partial then full settlements in Group.base_currency, updates debt math, and watermark-locks prior expenses", async () => {
    const groupInfo: ExpenseGroupInfo = {
      id: "grp-usd",
      name: "Apt 4B Roommates",
      slug: "apt-4b",
      status: "ACTIVE",
      baseCurrency: "USD",
      defaultSplitMode: "EQUAL",
      simplifyDebts: true,
      operationalBudgetCents: 300000,
      billingCycleAnchorDay: 1,
      currentUserRole: "MEMBER",
      currentUserStatus: "FORMER_MEMBER",
      members: [
        { userId: "u-alex", name: "Alex Rivera", status: "ACTIVE", instantSettlementTag: "@alex-rivera-99" },
        { userId: "u-elena", name: "Elena Rostova", status: "ACTIVE", instantSettlementTag: "@elena-r" },
        { userId: "u-marcus", name: "Marcus Vance", status: "FORMER_MEMBER", instantSettlementTag: null },
      ],
    };

    const expRecords = activeDb.expenses.map((e) => ({
      groupId: e.group_id,
      paidBy: e.paid_by,
      amountCents: e.amount_cents,
      splitBreakdown: e.split_breakdown,
    }));

    // Initial debt for Marcus -> Alex is $100.00 (10000 cents)
    const initialEdges = computePerGroupDebtEdges({
      group: groupInfo,
      expenses: expRecords,
      settlements: [],
    });
    expect(initialEdges.find((d) => d.payerId === "u-marcus")?.amountCents).toBe(10000);

    // 1. Marcus (FORMER_MEMBER) records a PARTIAL settlement of $40.00 (4000 cents)
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-marcus", email: "marcus@example.com" } },
      error: null,
    });
    const partialRes = await settlementPost(
      new NextRequest("http://localhost:3000/api/groups/grp-usd/settlements", {
        method: "POST",
        body: JSON.stringify({
          payer_id: "u-marcus",
          recipient_id: "u-alex",
          amount_cents: 4000,
          payment_rail: "VENMO",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-usd" }) },
    );
    expect(partialRes.status).toBe(201);
    const partialJson = await partialRes.json();
    expect(partialJson.settlement.amount_cents).toBe(4000);
    expect(partialJson.settlement.currency).toBe("USD");
    expect(partialJson.settlement.payment_rail).toBe("VENMO");

    const settlementRecords: ExpenseSettlementRecord[] = activeDb.settlements.map((s) => ({
      id: s.id,
      groupId: s.group_id,
      payerId: s.payer_id,
      recipientId: s.recipient_id,
      amountCents: s.amount_cents,
      currency: s.currency,
      settledAt: s.settled_at,
    }));

    // Remaining debt for Marcus -> Alex is $60.00 (6000 cents)
    const afterPartialEdges = computePerGroupDebtEdges({
      group: groupInfo,
      expenses: expRecords,
      settlements: settlementRecords,
    });
    expect(afterPartialEdges.find((d) => d.payerId === "u-marcus")?.amountCents).toBe(6000);
    expect(afterPartialEdges.find((d) => d.payerId === "u-elena")?.amountCents).toBe(10000);

    // Pairwise settlement watermark locks exp-1 against edits!
    const lockEval = evaluateExpenseLockAndSettlement({
      expense: {
        id: "exp-1",
        groupId: "grp-usd",
        paidBy: "u-alex",
        expenseDate: "2026-11-05T12:00:00.000Z",
        isLocked: false,
        splitBreakdown: activeDb.expenses[0].split_breakdown,
      },
      currentUserId: "u-alex",
      billingCycles: [],
      settlements: settlementRecords,
    });
    expect(lockEval.isSettledByWatermark).toBe(true);
    expect(lockEval.isLocked).toBe(true);

    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const editLockedRes = await expensePatch(
      new NextRequest("http://localhost:3000/api/groups/grp-usd/expenses/exp-1", {
        method: "PATCH",
        body: JSON.stringify({
          description: "Attempted Post-Settlement Edit",
          category: "Utilities",
          amount_cents: 30000,
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-usd", expenseId: "exp-1" }) },
    );
    expect(editLockedRes.status).toBe(409);
    expect((await editLockedRes.json()).code).toBe("EXPENSE_LOCKED");

    // 2. Marcus records remaining $60.00 (6000 cents) to settle in full
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-marcus", email: "marcus@example.com" } },
      error: null,
    });
    const fullRes = await settlementPost(
      new NextRequest("http://localhost:3000/api/groups/grp-usd/settlements", {
        method: "POST",
        body: JSON.stringify({
          payer_id: "u-marcus",
          recipient_id: "u-alex",
          amount_cents: 6000,
          payment_rail: "APPLE_CARD",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-usd" }) },
    );
    expect(fullRes.status).toBe(201);

    const allSettlements: ExpenseSettlementRecord[] = activeDb.settlements.map((s) => ({
      id: s.id,
      groupId: s.group_id,
      payerId: s.payer_id,
      recipientId: s.recipient_id,
      amountCents: s.amount_cents,
      currency: s.currency,
      settledAt: s.settled_at,
    }));

    const afterFullEdges = computePerGroupDebtEdges({
      group: groupInfo,
      expenses: expRecords,
      settlements: allSettlements,
    });
    expect(afterFullEdges.find((d) => d.payerId === "u-marcus")).toBeUndefined();
    expect(afterFullEdges.find((d) => d.payerId === "u-elena")?.amountCents).toBe(10000);

    // 3. GET /settlements allows FORMER_MEMBER to read settlement history for the group
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-marcus", email: "marcus@example.com" } },
      error: null,
    });
    const listRes = await settlementGet(
      new NextRequest("http://localhost:3000/api/groups/grp-usd/settlements"),
      { params: Promise.resolve({ groupId: "grp-usd" }) },
    );
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.settlements).toHaveLength(2);
  });

  it("blocks FORMER_MEMBER from logging expenses and third-party settlements, and enforces group isolation & validation", async () => {
    // 1. FORMER_MEMBER blocked from logging expenses -> 403 FORMER_MEMBER_RESTRICTED
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-marcus", email: "marcus@example.com" } },
      error: null,
    });
    const blockedExpRes = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-usd/expenses", {
        method: "POST",
        body: JSON.stringify({
          description: "Unauthorized Expense",
          category: "General",
          amount_cents: 1500,
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-usd" }) },
    );
    expect(blockedExpRes.status).toBe(403);
    expect((await blockedExpRes.json()).code).toBe("FORMER_MEMBER_RESTRICTED");

    // 2. FORMER_MEMBER blocked from recording settlement between two other members -> 403
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-marcus", email: "marcus@example.com" } },
      error: null,
    });
    const thirdPartyFormerRes = await settlementPost(
      new NextRequest("http://localhost:3000/api/groups/grp-usd/settlements", {
        method: "POST",
        body: JSON.stringify({
          payer_id: "u-elena",
          recipient_id: "u-alex",
          amount_cents: 2500,
          payment_rail: "VENMO",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-usd" }) },
    );
    expect(thirdPartyFormerRes.status).toBe(403);
    expect((await thirdPartyFormerRes.json()).code).toBe(
      "FORMER_MEMBER_RESTRICTED",
    );

    // 3. Cross-group participant rejected -> 400 INVALID_PARTIES
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const crossGroupRes = await settlementPost(
      new NextRequest("http://localhost:3000/api/groups/grp-usd/settlements", {
        method: "POST",
        body: JSON.stringify({
          payer_id: "u-outsider",
          recipient_id: "u-alex",
          amount_cents: 1000,
          payment_rail: "CASH",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-usd" }) },
    );
    expect(crossGroupRes.status).toBe(400);
    expect((await crossGroupRes.json()).code).toBe("INVALID_PARTIES");

    // 4. Non-integer amount rejected -> 400 INVALID_AMOUNT
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const floatRes = await settlementPost(
      new NextRequest("http://localhost:3000/api/groups/grp-usd/settlements", {
        method: "POST",
        body: JSON.stringify({
          payer_id: "u-elena",
          recipient_id: "u-alex",
          amount_cents: 12.5,
          payment_rail: "VENMO",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-usd" }) },
    );
    expect(floatRes.status).toBe(400);
    expect((await floatRes.json()).code).toBe("INVALID_AMOUNT");

    // 5. Invalid payment rail rejected -> 400 INVALID_PAYMENT_RAIL
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const railRes = await settlementPost(
      new NextRequest("http://localhost:3000/api/groups/grp-usd/settlements", {
        method: "POST",
        body: JSON.stringify({
          payer_id: "u-elena",
          recipient_id: "u-alex",
          amount_cents: 1000,
          payment_rail: "CRYPTO",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-usd" }) },
    );
    expect(railRes.status).toBe(400);
    expect((await railRes.json()).code).toBe("INVALID_PAYMENT_RAIL");

    // 6. Zero-decimal currency (JPY) persists in Group.base_currency = JPY
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const jpyRes = await settlementPost(
      new NextRequest("http://localhost:3000/api/groups/grp-jpy/settlements", {
        method: "POST",
        body: JSON.stringify({
          payer_id: "u-outsider",
          recipient_id: "u-alex",
          amount_cents: 4500,
          payment_rail: "CASH",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-jpy" }) },
    );
    expect(jpyRes.status).toBe(201);
    const jpyJson = await jpyRes.json();
    expect(jpyJson.settlement.currency).toBe("JPY");
    expect(jpyJson.settlement.amount_cents).toBe(4500);

    // 7. Archived group rejected -> 409 GROUP_ARCHIVED
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const archivedRes = await settlementPost(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-archived/settlements",
        {
          method: "POST",
          body: JSON.stringify({
            payer_id: "u-elena",
            recipient_id: "u-alex",
            amount_cents: 1000,
            payment_rail: "OTHER",
          }),
        },
      ),
      { params: Promise.resolve({ groupId: "grp-archived" }) },
    );
    expect(archivedRes.status).toBe(409);
    expect((await archivedRes.json()).code).toBe("GROUP_ARCHIVED");
  });
});
