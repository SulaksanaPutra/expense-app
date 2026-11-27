import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildExpensesCsv,
  computeExpensesKpiSummary,
  computePerGroupDebtEdges,
  evaluateExpenseLockAndSettlement,
  filterAndSortExpenses,
  getCycleSlugForDate,
  getNextGroupSettlementDate,
  type ExpenseBillingCycleRecord,
  type ExpenseGroupInfo,
  type ExpenseLedgerRecord,
  type ExpenseSettlementRecord,
} from "@/lib/expenses/ledger";

const getUserMock = vi.fn();

interface InMemorySearchDb {
  groups: Array<{
    id: string;
    name: string;
    slug: string;
    base_currency: string;
    status: "ACTIVE" | "NEEDS_RATIO_UPDATE" | "ARCHIVED";
    billing_cycle_anchor_day: number;
    created_at: string;
  }>;
  expenses: Array<{
    id: string;
    group_id: string;
    description: string;
    category: string;
    amount_cents: number;
    currency: string;
    expense_date: string;
    deleted_at: string | null;
  }>;
}

let activeDb: InMemorySearchDb;

function createInMemorySupabase(db: InMemorySearchDb) {
  function makeTable<T extends Record<string, unknown>>(rows: T[]) {
    return {
      select: () => {
        const filters: Array<
          | { op: "eq" | "neq" | "in"; col: string; val: unknown }
          | { op: "is"; col: string; val: null }
          | { op: "or"; expr: string }
        > = [];
        let orderCol: string | null = null;
        let orderAsc = true;
        let limitCount: number | null = null;

        const run = async () => {
          let result = rows.filter((row) =>
            filters.every((f) => {
              if (f.op === "eq") return row[f.col] === f.val;
              if (f.op === "neq") return row[f.col] !== f.val;
              if (f.op === "in" && Array.isArray(f.val)) {
                return f.val.includes(row[f.col]);
              }
              if (f.op === "is") return row[f.col] === f.val;
              if (f.op === "or") {
                const match = /%([^%]+)%/.exec(f.expr);
                if (!match) return true;
                const needle = match[1].toLowerCase();
                return (
                  String(row.description ?? "")
                    .toLowerCase()
                    .includes(needle) ||
                  String(row.category ?? "")
                    .toLowerCase()
                    .includes(needle)
                );
              }
              return true;
            }),
          );

          if (orderCol) {
            const col = orderCol;
            result = [...result].sort((a, b) => {
              const av = String(a[col] ?? "");
              const bv = String(b[col] ?? "");
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
          then: (onFulfilled: (val: { data: T[]; error: null }) => unknown) =>
            run().then(onFulfilled),
        };

        return builder;
      },
    };
  }

  return {
    auth: { getUser: getUserMock },
    from: (table: keyof InMemorySearchDb) => {
      if (table === "groups") return makeTable(db.groups);
      return makeTable(db.expenses);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => createInMemorySupabase(activeDb)),
}));

import { GET as searchGet } from "@/app/api/search/route";

const GROUPS: ExpenseGroupInfo[] = [
  {
    id: "grp-apt4b",
    name: "Apt 4B Roommates",
    slug: "apt-4b",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: 450000,
    billingCycleAnchorDay: 1,
    currentUserRole: "ADMIN",
    members: [
      {
        userId: "u-alex",
        name: "Alex Rivera",
        status: "ACTIVE",
        instantSettlementTag: "@alex-r",
      },
      {
        userId: "u-elena",
        name: "Elena Rostova",
        status: "ACTIVE",
        instantSettlementTag: "@elena-r",
      },
      {
        userId: "u-marcus",
        name: "Marcus Vance",
        status: "ACTIVE",
        instantSettlementTag: "@marcus-v",
      },
    ],
  },
  {
    id: "grp-tahoe",
    name: "Tahoe Ski Trip",
    slug: "tahoe-ski",
    status: "ACTIVE",
    baseCurrency: "USD",
    defaultSplitMode: "EQUAL",
    simplifyDebts: false,
    operationalBudgetCents: null,
    billingCycleAnchorDay: 15,
    currentUserRole: "MEMBER",
    members: [
      {
        userId: "u-alex",
        name: "Alex Rivera",
        status: "ACTIVE",
        instantSettlementTag: "@alex-r",
      },
      {
        userId: "u-elena",
        name: "Elena Rostova",
        status: "ACTIVE",
        instantSettlementTag: "@elena-r",
      },
    ],
  },
];

const SAMPLE_EXPENSES: ExpenseLedgerRecord[] = [
  {
    id: "exp-1",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-alex",
    paidBy: "u-alex",
    payerName: "Alex Rivera",
    description: "Trader Joe's Groceries",
    category: "Groceries & Food",
    expenseDate: "2026-11-20T12:00:00.000Z",
    amountCents: 18000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 6000 },
      { user_id: "u-elena", share_cents: 6000 },
      { user_id: "u-marcus", share_cents: 6000 },
    ],
    receiptUrl: null,
    isRecurringGenerated: false,
    recurringRuleId: null,
    adjustmentForExpenseId: null,
    isLocked: false,
    isCycleClosed: false,
    isSettledByWatermark: false,
    isSettledForUser: false,
  },
  {
    id: "exp-2",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-marcus",
    paidBy: "u-marcus",
    payerName: "Marcus Vance",
    description: "ConEd Electric Bill",
    category: "Utilities",
    expenseDate: "2026-11-18T12:00:00.000Z",
    amountCents: 24000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 8000 },
      { user_id: "u-elena", share_cents: 8000 },
      { user_id: "u-marcus", share_cents: 8000 },
    ],
    receiptUrl: null,
    isRecurringGenerated: true,
    recurringRuleId: "rec-1",
    adjustmentForExpenseId: null,
    isLocked: false,
    isCycleClosed: false,
    isSettledByWatermark: false,
    isSettledForUser: false,
  },
  {
    id: "exp-3",
    groupId: "grp-tahoe",
    groupName: "Tahoe Ski Trip",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 15,
    createdBy: "u-elena",
    paidBy: "u-elena",
    payerName: "Elena Rostova",
    description: "Cabin Lift Tickets",
    category: "Entertainment",
    expenseDate: "2026-11-16T12:00:00.000Z",
    amountCents: 30000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 15000 },
      { user_id: "u-elena", share_cents: 15000 },
    ],
    receiptUrl: null,
    isRecurringGenerated: false,
    recurringRuleId: null,
    adjustmentForExpenseId: null,
    isLocked: false,
    isCycleClosed: false,
    isSettledByWatermark: false,
    isSettledForUser: false,
  },
  {
    id: "exp-prev",
    groupId: "grp-apt4b",
    groupName: "Apt 4B Roommates",
    groupBaseCurrency: "USD",
    groupBillingAnchorDay: 1,
    createdBy: "u-alex",
    paidBy: "u-alex",
    payerName: "Alex Rivera",
    description: "October Groceries",
    category: "Groceries & Food",
    expenseDate: "2026-10-10T12:00:00.000Z",
    amountCents: 30000,
    currency: "USD",
    originalAmountCents: null,
    originalCurrency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    splitMethod: "EQUAL",
    splitBreakdown: [
      { user_id: "u-alex", share_cents: 10000 },
      { user_id: "u-elena", share_cents: 10000 },
      { user_id: "u-marcus", share_cents: 10000 },
    ],
    receiptUrl: null,
    isRecurringGenerated: false,
    recurringRuleId: null,
    adjustmentForExpenseId: null,
    isLocked: true,
    isCycleClosed: true,
    isSettledByWatermark: false,
    isSettledForUser: true,
  },
];

describe("Expenses Ledger Calculations, Filtering & Sorting", () => {
  it("filters accurately by group, cycle, tab, search query, category, and sort order", () => {
    // 1. All groups in 2026-11
    const novAll = filterAndSortExpenses({
      expenses: SAMPLE_EXPENSES,
      activeGroupId: "all",
      cycleSlug: "2026-11",
      currentUserId: "u-alex",
      tab: "all",
      searchQuery: "",
      category: "all",
      sortBy: "date-desc",
    });
    expect(novAll.map((e) => e.id)).toEqual(["exp-1", "exp-2", "exp-3"]);

    // 2. Group filter
    const apt4bOnly = filterAndSortExpenses({
      expenses: SAMPLE_EXPENSES,
      activeGroupId: "grp-apt4b",
      cycleSlug: "2026-11",
      currentUserId: "u-alex",
      tab: "all",
      searchQuery: "",
      category: "all",
      sortBy: "amount-desc",
    });
    expect(apt4bOnly.map((e) => e.id)).toEqual(["exp-2", "exp-1"]);

    // 3. Tab filter: paid-by-me vs split-with-me
    const paidByMe = filterAndSortExpenses({
      expenses: SAMPLE_EXPENSES,
      activeGroupId: "all",
      cycleSlug: "2026-11",
      currentUserId: "u-alex",
      tab: "paid-by-me",
      searchQuery: "",
      category: "all",
      sortBy: "date-desc",
    });
    expect(paidByMe.map((e) => e.id)).toEqual(["exp-1"]);

    const splitWithMe = filterAndSortExpenses({
      expenses: SAMPLE_EXPENSES,
      activeGroupId: "all",
      cycleSlug: "2026-11",
      currentUserId: "u-alex",
      tab: "split-with-me",
      searchQuery: "",
      category: "all",
      sortBy: "share-desc",
    });
    expect(splitWithMe.map((e) => e.id)).toEqual(["exp-3", "exp-2"]);

    // 4. Category + Search query
    const searchUtilities = filterAndSortExpenses({
      expenses: SAMPLE_EXPENSES,
      activeGroupId: "grp-apt4b",
      cycleSlug: "2026-11",
      currentUserId: "u-alex",
      tab: "all",
      searchQuery: "coned",
      category: "Utilities",
      sortBy: "date-asc",
    });
    expect(searchUtilities.map((e) => e.id)).toEqual(["exp-2"]);

    // 5. Previous cycle (2026-10)
    const octOnly = filterAndSortExpenses({
      expenses: SAMPLE_EXPENSES,
      activeGroupId: "grp-apt4b",
      cycleSlug: "2026-10",
      currentUserId: "u-alex",
      tab: "all",
      searchQuery: "",
      category: "all",
      sortBy: "date-desc",
    });
    expect(octOnly.map((e) => e.id)).toEqual(["exp-prev"]);
  });

  it("computes KPI metrics, personal share cap progress, MoM delta, and next settlement date", () => {
    const kpi = computeExpensesKpiSummary({
      expenses: SAMPLE_EXPENSES,
      groups: GROUPS,
      settlements: [],
      activeGroupId: "grp-apt4b",
      cycleSlug: "2026-11",
      currentUserId: "u-alex",
      userBaseCurrency: "USD",
      personalShareCapCents: 100000, // $1,000.00
      referenceDate: new Date("2026-11-20T00:00:00.000Z"),
    });

    // Nov Apt 4B: 18000 + 24000 = 42000; Oct Apt 4B: 30000 (+40.0%)
    expect(kpi.totalGroupExpensesCents).toBe(42000);
    expect(kpi.previousCycleExpensesCents).toBe(30000);
    expect(kpi.momDeltaPercent).toBe(40);
    expect(kpi.transactionCount).toBe(2);
    expect(kpi.activeMemberCount).toBe(3);

    // Alex's share in Nov Apt 4B: 6000 + 8000 = 14000 ($140.00 / $1000.00 = 14.0%)
    expect(kpi.personalShareCents).toBe(14000);
    expect(kpi.personalShareCapCents).toBe(100000);
    expect(kpi.personalCapPercent).toBe(14);
    expect(kpi.nextSettlementDateIso).toBe("2026-12-01");
    expect(kpi.nextSettlementDateLabel).toBe("Dec 1, 2026");

    // Category totals in cycle
    expect(kpi.categoryTotals).toEqual([
      { category: "Utilities", amountCents: 24000, count: 1 },
      { category: "Groceries & Food", amountCents: 18000, count: 1 },
    ]);
  });

  it("computes cycle-anchor settlement dates and cycle slugs accurately", () => {
    expect(getCycleSlugForDate("2026-11-10T12:00:00.000Z", 15)).toBe("2026-10");
    expect(getCycleSlugForDate("2026-11-15T12:00:00.000Z", 15)).toBe("2026-11");
    expect(
      getNextGroupSettlementDate(15, new Date("2026-11-10T00:00:00.000Z")),
    ).toEqual({ isoDate: "2026-11-15", label: "Nov 15, 2026" });
    expect(
      getNextGroupSettlementDate(15, new Date("2026-11-15T00:00:00.000Z")),
    ).toEqual({ isoDate: "2026-12-15", label: "Dec 15, 2026" });
  });

  it("evaluates hybrid Cycle Close + Pairwise Settlement Watermark locking and per-group debt simplification", () => {
    const billingCycles: ExpenseBillingCycleRecord[] = [
      {
        id: "bc-1",
        groupId: "grp-apt4b",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        status: "CLOSED",
      },
    ];
    const settlements: ExpenseSettlementRecord[] = [
      {
        id: "set-1",
        groupId: "grp-apt4b",
        payerId: "u-alex",
        recipientId: "u-marcus",
        amountCents: 2000,
        currency: "USD",
        settledAt: "2026-11-19T00:00:00.000Z",
      },
    ];

    // exp-2 (Nov 18, Alex & Marcus involved) is locked by settlement watermark on Nov 19
    const exp2Lock = evaluateExpenseLockAndSettlement({
      expense: SAMPLE_EXPENSES[1],
      currentUserId: "u-alex",
      billingCycles,
      settlements,
    });
    expect(exp2Lock.isLocked).toBe(true);
    expect(exp2Lock.isSettledByWatermark).toBe(true);

    // exp-1 (Nov 20, after Nov 19 settlement) remains unlocked
    const exp1Lock = evaluateExpenseLockAndSettlement({
      expense: SAMPLE_EXPENSES[0],
      currentUserId: "u-alex",
      billingCycles,
      settlements,
    });
    expect(exp1Lock.isLocked).toBe(false);

    // Per-group debt edges with simplifyDebts: true on Apt 4B
    const edges = computePerGroupDebtEdges({
      group: GROUPS[0],
      expenses: SAMPLE_EXPENSES,
      settlements,
    });
    // Total net in Apt 4B:
    // exp-1 (+18000 Alex, -6000 each), exp-2 (+24000 Marcus, -8000 each), exp-prev (+30000 Alex, -10000 each)
    // Alex net: +18000+30000 -24000 +2000 (paid settlement) = +26000
    // Marcus net: +24000 -24000 -2000 (received settlement) = -2000
    // Elena net: -24000
    expect(edges).toEqual([
      expect.objectContaining({
        payerId: "u-elena",
        recipientId: "u-alex",
        amountCents: 24000,
      }),
      expect.objectContaining({
        payerId: "u-marcus",
        recipientId: "u-alex",
        amountCents: 2000,
      }),
    ]);
  });

  it("escapes CSV cells against formula injection and formats amounts in Group.base_currency", () => {
    const csv = buildExpensesCsv(
      [
        {
          ...SAMPLE_EXPENSES[0],
          description: "=SUM(A1:A2), Trader Joe's",
        },
      ],
      "u-alex",
    );
    expect(csv).toContain("\"'=SUM(A1:A2), Trader Joe's\"");
    expect(csv).toContain("$60.00,$180.00,USD");
  });
});

describe("GET /api/search", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-123";
    getUserMock.mockReset();

    activeDb = {
      groups: [
        {
          id: "grp-apt4b",
          name: "Apt 4B Roommates",
          slug: "apt-4b",
          base_currency: "USD",
          status: "ACTIVE",
          billing_cycle_anchor_day: 1,
          created_at: "2026-10-01T00:00:00.000Z",
        },
        {
          id: "grp-tahoe",
          name: "Tahoe Ski Trip",
          slug: "tahoe-ski",
          base_currency: "USD",
          status: "ACTIVE",
          billing_cycle_anchor_day: 15,
          created_at: "2026-10-02T00:00:00.000Z",
        },
      ],
      expenses: [
        {
          id: "exp-1",
          group_id: "grp-apt4b",
          description: "Trader Joe's Weekly Groceries",
          category: "Groceries & Food",
          amount_cents: 18420,
          currency: "USD",
          expense_date: "2026-11-20T12:00:00.000Z",
          deleted_at: null,
        },
        {
          id: "exp-2",
          group_id: "grp-tahoe",
          description: "Tahoe Lift Passes",
          category: "Entertainment",
          amount_cents: 32000,
          currency: "USD",
          expense_date: "2026-11-10T12:00:00.000Z",
          deleted_at: null,
        },
      ],
    };
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });

  it("returns 401 when unauthenticated", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    const res = await searchGet(
      new NextRequest("http://localhost:3000/api/search?q=tahoe"),
    );
    expect(res.status).toBe(401);
  });

  it("returns matching groups and expenses with computed billing cycleSlug", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });

    const res = await searchGet(
      new NextRequest("http://localhost:3000/api/search?q=tahoe"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.groups).toHaveLength(1);
    expect(json.groups[0].id).toBe("grp-tahoe");

    expect(json.expenses).toHaveLength(1);
    expect(json.expenses[0]).toMatchObject({
      id: "exp-2",
      groupId: "grp-tahoe",
      groupName: "Tahoe Ski Trip",
      description: "Tahoe Lift Passes",
      amountCents: 32000,
      currency: "USD",
      cycleSlug: "2026-10", // Nov 10 < anchor day 15 -> 2026-10 cycle
    });
  });
});
