import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeEqualSplit,
  computeExactSplit,
  computePercentageSplit,
  computeSharesSplit,
  convertForeignAmountToBaseMinorUnits,
  validateSplitBreakdown,
} from "@/lib/expenses/split-engine";

const getUserMock = vi.fn();

interface InMemoryDb {
  users: Array<{
    id: string;
    email: string;
    full_name: string;
  }>;
  groups: Array<{
    id: string;
    name: string;
    slug: string;
    group_type: "RESIDENTIAL" | "TRIP" | "RECURRING";
    status: "ACTIVE" | "NEEDS_RATIO_UPDATE" | "ARCHIVED";
    base_currency: string;
    default_split_mode: "EQUAL" | "PERCENTAGE" | "SHARES" | "CUSTOM" | "CUSTOM_RATIOS";
    allow_any_member_add_expense: boolean;
    require_receipt_over_100: boolean;
  }>;
  group_members: Array<{
    group_id: string;
    user_id: string;
    role: "ADMIN" | "MEMBER";
    status: "ACTIVE" | "FORMER_MEMBER";
    share_percentage: number;
    share_units: number;
    joined_at: string;
  }>;
  expenses: Array<Record<string, unknown>>;
}

function createInMemorySupabase(db: InMemoryDb) {
  type Filter = { col: string; val: unknown; op: "eq" | "in" };

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
          ...row,
        } as T;
        rows.push(stored);
        return {
          select: () => ({
            maybeSingle: async () => ({ data: { ...stored }, error: null }),
          }),
        };
      },
      update: (patch: Partial<T>) => {
        const filters: Filter[] = [];
        const apply = async () => {
          const matched = filterRows(rows, filters);
          for (const item of matched) {
            Object.assign(item, patch);
          }
          return { data: matched[0] ?? null, error: null };
        };
        const builder = {
          eq: (col: string, val: unknown) => {
            filters.push({ col, val, op: "eq" });
            return builder;
          },
          then: (onFulfilled: (val: { error: null }) => unknown) =>
            apply().then(() => onFulfilled({ error: null })),
        };
        return builder;
      },
    };
  }

  return {
    auth: { getUser: getUserMock },
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: "mock/receipt.png" }, error: null }),
        remove: async () => ({ data: [], error: null }),
        createSignedUrl: async (storagePath: string) => ({
          data: { signedUrl: `https://storage.example.test/${storagePath}?token=signed` },
          error: null,
        }),
      }),
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
      }
    },
  };
}

let activeDb: InMemoryDb;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => createInMemorySupabase(activeDb)),
}));

import { POST as expensePost } from "@/app/api/groups/[groupId]/expenses/route";
import { GET as fxGet } from "@/app/api/fx/route";
import { GET as receiptsGet, POST as receiptsPost } from "@/app/api/receipts/route";

describe("BIGINT Minor-Unit Split Engine", () => {
  it("splits $100.00 (10000 cents) 3 ways assigning 3334 to payer and 3333 to non-payers", () => {
    const breakdown = computeEqualSplit({
      amountCents: 10000,
      paidBy: "u-elena",
      participantIds: ["u-alex", "u-elena", "u-marcus"],
    });

    expect(breakdown).toEqual([
      { user_id: "u-alex", share_cents: 3333, percentage: 33.33 },
      { user_id: "u-elena", share_cents: 3334, percentage: 33.34 },
      { user_id: "u-marcus", share_cents: 3333, percentage: 33.33 },
    ]);
    expect(breakdown.reduce((s, b) => s + b.share_cents, 0)).toBe(10000);
  });

  it("assigns residual cents sequentially from index 0 when payer is excluded from equal split", () => {
    const breakdown = computeEqualSplit({
      amountCents: 10000,
      paidBy: "u-alex",
      participantIds: ["u-elena", "u-marcus", "u-sam"],
    });

    expect(breakdown).toEqual([
      { user_id: "u-elena", share_cents: 3334, percentage: 33.34 },
      { user_id: "u-marcus", share_cents: 3333, percentage: 33.33 },
      { user_id: "u-sam", share_cents: 3333, percentage: 33.33 },
    ]);
    expect(breakdown.reduce((s, b) => s + b.share_cents, 0)).toBe(10000);
  });

  it("conserves integer cents across multi-cent remainders (100 cents / 6 ways)", () => {
    const breakdown = computeEqualSplit({
      amountCents: 100,
      paidBy: "u-3",
      participantIds: ["u-1", "u-2", "u-3", "u-4", "u-5", "u-6"],
    });
    const byId = new Map(breakdown.map((b) => [b.user_id, b.share_cents]));
    expect(byId.get("u-3")).toBe(17);
    expect(byId.get("u-1")).toBe(17);
    expect(byId.get("u-2")).toBe(17);
    expect(byId.get("u-4")).toBe(17);
    expect(byId.get("u-5")).toBe(16);
    expect(byId.get("u-6")).toBe(16);
    expect(breakdown.reduce((s, b) => s + b.share_cents, 0)).toBe(100);
  });

  it("computes deterministic percentage splits with payer-first penny rounding and rejects totals != 100%", () => {
    const okResult = computePercentageSplit({
      amountCents: 101,
      paidBy: "u-elena",
      participants: [
        { userId: "u-alex", percentage: 50 },
        { userId: "u-elena", percentage: 50 },
      ],
    });
    expect(okResult.ok).toBe(true);
    if (okResult.ok) {
      expect(okResult.breakdown).toEqual([
        { user_id: "u-alex", share_cents: 50, percentage: 50 },
        { user_id: "u-elena", share_cents: 51, percentage: 50 },
      ]);
    }

    const badResult = computePercentageSplit({
      amountCents: 10000,
      paidBy: "u-alex",
      participants: [
        { userId: "u-alex", percentage: 60 },
        { userId: "u-elena", percentage: 30 },
      ],
    });
    expect(badResult.ok).toBe(false);
    if (!badResult.ok) {
      expect(badResult.code).toBe("PERCENTAGE_SUM_MISMATCH");
    }
  });

  it("computes SHARES splits with floor(amount_cents * shares / total_shares) and payer-first penny rounding", () => {
    // $100.00 (10000 cents) split 1:2:3 (total 6) -> floors 1666, 3333, 5000 (sum 9999, remainder 1 -> payer u-elena)
    const res1 = computeSharesSplit({
      amountCents: 10000,
      paidBy: "u-elena",
      participants: [
        { userId: "u-alex", shares: 1 },
        { userId: "u-elena", shares: 2 },
        { userId: "u-marcus", shares: 3 },
      ],
    });
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.breakdown).toEqual([
        { user_id: "u-alex", share_cents: 1666, shares: 1, percentage: 16.66 },
        { user_id: "u-elena", share_cents: 3334, shares: 2, percentage: 33.34 },
        { user_id: "u-marcus", share_cents: 5000, shares: 3, percentage: 50 },
      ]);
      expect(res1.breakdown.reduce((s, b) => s + b.share_cents, 0)).toBe(10000);
    }

    // Payer excluded from split -> residual cents go sequentially from index 0
    const resExcludedPayer = computeSharesSplit({
      amountCents: 10000,
      paidBy: "u-outside",
      participants: [
        { userId: "u-alex", shares: 1 },
        { userId: "u-elena", shares: 1 },
        { userId: "u-marcus", shares: 1 },
      ],
    });
    expect(resExcludedPayer.ok).toBe(true);
    if (resExcludedPayer.ok) {
      expect(resExcludedPayer.breakdown.map((b) => b.share_cents)).toEqual([
        3334, 3333, 3333,
      ]);
      expect(resExcludedPayer.breakdown.reduce((s, b) => s + b.share_cents, 0)).toBe(10000);
    }

    // Payer has 0 shares -> 0-share payer receives 0 cents; remainder goes to index 0 with > 0 shares
    const resZeroPayer = computeSharesSplit({
      amountCents: 10000,
      paidBy: "u-alex",
      participants: [
        { userId: "u-alex", shares: 0 },
        { userId: "u-elena", shares: 1 },
        { userId: "u-marcus", shares: 2 },
      ],
    });
    expect(resZeroPayer.ok).toBe(true);
    if (resZeroPayer.ok) {
      expect(resZeroPayer.breakdown.map((b) => b.share_cents)).toEqual([
        0, 3334, 6666,
      ]);
      expect(resZeroPayer.breakdown.reduce((s, b) => s + b.share_cents, 0)).toBe(10000);
    }

    // Decimal shares + 1-cent edge case + negative adjustment
    const resDecimal = computeSharesSplit({
      amountCents: 10001,
      paidBy: "u-marcus",
      participants: [
        { userId: "u-alex", shares: 1.5 },
        { userId: "u-elena", shares: 2.5 },
        { userId: "u-marcus", shares: 1 },
      ],
    });
    expect(resDecimal.ok).toBe(true);
    if (resDecimal.ok) {
      expect(resDecimal.breakdown.reduce((s, b) => s + b.share_cents, 0)).toBe(10001);
      // 10001 * 1.5/5 = 3000.3 -> 3000, 10001 * 2.5/5 = 5000.5 -> 5000, 10001 * 1/5 = 2000.2 -> 2000; rem 1 -> payer u-marcus
      expect(resDecimal.breakdown.map((b) => b.share_cents)).toEqual([
        3000, 5000, 2001,
      ]);
    }

    const resOneCent = computeSharesSplit({
      amountCents: 1,
      paidBy: "u-elena",
      participants: [
        { userId: "u-alex", shares: 1 },
        { userId: "u-elena", shares: 1 },
        { userId: "u-marcus", shares: 1 },
      ],
    });
    expect(resOneCent.ok).toBe(true);
    if (resOneCent.ok) {
      expect(resOneCent.breakdown.map((b) => b.share_cents)).toEqual([0, 1, 0]);
    }

    const resNeg = computeSharesSplit({
      amountCents: -10000,
      paidBy: "u-alex",
      participants: [
        { userId: "u-alex", shares: 1 },
        { userId: "u-elena", shares: 2 },
      ],
      allowNegative: true,
    });
    expect(resNeg.ok).toBe(true);
    if (resNeg.ok) {
      expect(resNeg.breakdown.map((b) => b.share_cents)).toEqual([-3334, -6666]);
      expect(resNeg.breakdown.reduce((s, b) => s + b.share_cents, 0)).toBe(-10000);
    }

    // Rejects all-zero shares & negative shares
    expect(
      computeSharesSplit({
        amountCents: 1000,
        paidBy: "u-alex",
        participants: [
          { userId: "u-alex", shares: 0 },
          { userId: "u-elena", shares: 0 },
        ],
      }).ok,
    ).toBe(false);

    expect(
      computeSharesSplit({
        amountCents: 1000,
        paidBy: "u-alex",
        participants: [
          { userId: "u-alex", shares: -1 },
          { userId: "u-elena", shares: 2 },
        ],
      }).ok,
    ).toBe(false);
  });

  it("validates exact and SHARES splits and rejects mismatched sums or former members", () => {
    const exactOk = computeExactSplit({
      amountCents: 12000,
      participants: [
        { userId: "u-alex", shareCents: 7000 },
        { userId: "u-elena", shareCents: 5000 },
      ],
    });
    expect(exactOk.ok).toBe(true);

    const exactMismatch = computeExactSplit({
      amountCents: 12000,
      participants: [
        { userId: "u-alex", shareCents: 7000 },
        { userId: "u-elena", shareCents: 4999 },
      ],
    });
    expect(exactMismatch.ok).toBe(false);

    const sharesValidated = validateSplitBreakdown({
      amountCents: 10000,
      splitMethod: "SHARES",
      splitBreakdown: [
        { user_id: "u-alex", share_cents: 3334, shares: 1, percentage: 33.34 },
        { user_id: "u-elena", share_cents: 6666, shares: 2, percentage: 66.66 },
      ],
      activeMemberIds: ["u-alex", "u-elena"],
    });
    expect(sharesValidated.ok).toBe(true);

    const formerBlocked = validateSplitBreakdown({
      amountCents: 10000,
      splitMethod: "EXACT",
      splitBreakdown: [
        { user_id: "u-alex", share_cents: 5000 },
        { user_id: "u-former", share_cents: 5000 },
      ],
      activeMemberIds: ["u-alex", "u-elena"],
    });
    expect(formerBlocked.ok).toBe(false);
    if (!formerBlocked.ok) {
      expect(formerBlocked.code).toBe("INVALID_SPLIT_PARTICIPANT");
    }
  });

  it("converts display-only rollup minor units (including 0-decimal JPY and half-up rounding)", () => {
    expect(
      convertForeignAmountToBaseMinorUnits({
        originalAmountCents: 10000,
        originalCurrency: "EUR",
        exchangeRate: 1.085,
        baseCurrency: "USD",
      }),
    ).toBe(10850);

    expect(
      convertForeignAmountToBaseMinorUnits({
        originalAmountCents: 94500,
        originalCurrency: "JPY",
        exchangeRate: 0.006667,
        baseCurrency: "USD",
      }),
    ).toBe(63003);

    expect(
      convertForeignAmountToBaseMinorUnits({
        originalAmountCents: 10000,
        originalCurrency: "USD",
        exchangeRate: 150.25,
        baseCurrency: "JPY",
      }),
    ).toBe(15025);

    expect(
      convertForeignAmountToBaseMinorUnits({
        originalAmountCents: 1000,
        originalCurrency: "EUR",
        exchangeRate: 0,
        baseCurrency: "USD",
      }),
    ).toBeNull();
  });
});

describe("Expense Create API, SHARES & Group Policy Enforcement", () => {
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
        },
        {
          id: "u-elena",
          email: "elena@example.com",
          full_name: "Elena Rostova",
        },
        {
          id: "u-marcus",
          email: "marcus@example.com",
          full_name: "Marcus Vance",
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
          allow_any_member_add_expense: true,
          require_receipt_over_100: false,
        },
      ],
      group_members: [
        {
          group_id: "grp-apt4b",
          user_id: "u-alex",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 33.34,
          share_units: 1,
          joined_at: "2026-10-01T00:00:00.000Z",
        },
        {
          group_id: "grp-apt4b",
          user_id: "u-elena",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 33.33,
          share_units: 2,
          joined_at: "2026-10-02T00:00:00.000Z",
        },
        {
          group_id: "grp-apt4b",
          user_id: "u-marcus",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 33.33,
          share_units: 3,
          joined_at: "2026-10-03T00:00:00.000Z",
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
  });

  it("persists $100.00 split 3 ways with 3334 payer share and 3333 non-payer shares in Group.base_currency", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });

    const breakdown = computeEqualSplit({
      amountCents: 10000,
      paidBy: "u-alex",
      participantIds: ["u-alex", "u-elena", "u-marcus"],
    });

    const res = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          paid_by: "u-alex",
          description: "Trader Joe's Groceries",
          category: "Groceries",
          amount_cents: 10000,
          expense_date: "2026-11-27T12:00:00.000Z",
          split_method: "EQUAL",
          split_breakdown: breakdown,
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.expense.currency).toBe("USD");
    expect(json.expense.amount_cents).toBe(10000);
    expect(json.expense.split_breakdown).toEqual([
      { user_id: "u-alex", share_cents: 3334, percentage: 33.34 },
      { user_id: "u-elena", share_cents: 3333, percentage: 33.33 },
      { user_id: "u-marcus", share_cents: 3333, percentage: 33.33 },
    ]);
  });

  it("persists SHARES expense with deterministic penny-rounding", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });

    const sharesCalc = computeSharesSplit({
      amountCents: 10000,
      paidBy: "u-elena",
      participants: [
        { userId: "u-alex", shares: 1 },
        { userId: "u-elena", shares: 2 },
        { userId: "u-marcus", shares: 3 },
      ],
    });
    expect(sharesCalc.ok).toBe(true);

    const res = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          paid_by: "u-elena",
          description: "Shared Rent",
          category: "Housing & Utilities",
          amount_cents: 10000,
          split_method: "SHARES",
          split_breakdown: sharesCalc.ok ? sharesCalc.breakdown : [],
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.expense.split_method).toBe("SHARES");
    expect(json.expense.split_breakdown).toEqual([
      { user_id: "u-alex", share_cents: 1666, shares: 1, percentage: 16.66 },
      { user_id: "u-elena", share_cents: 3334, shares: 2, percentage: 33.34 },
      { user_id: "u-marcus", share_cents: 5000, shares: 3, percentage: 50 },
    ]);
  });

  it("enforces Group.allow_any_member_add_expense: 403 for non-Admin when false, 201 for Admin", async () => {
    activeDb.groups[0].allow_any_member_add_expense = false;

    // Non-Admin (u-elena) -> 403 Forbidden
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-elena", email: "elena@example.com" } },
      error: null,
    });

    const memberRes = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          paid_by: "u-elena",
          description: "Member Expense",
          category: "Groceries",
          amount_cents: 3000,
          split_method: "EQUAL",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(memberRes.status).toBe(403);
    expect((await memberRes.json()).code).toBe("EXPENSE_CREATION_RESTRICTED");

    // Admin (u-alex) -> 201 Created
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });

    const adminRes = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          paid_by: "u-alex",
          description: "Admin Expense",
          category: "Groceries",
          amount_cents: 3000,
          split_method: "EQUAL",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(adminRes.status).toBe(201);
  });

  it("enforces Group.require_receipt_over_100: 400 when > 10000 cents without receipt, 201 at <= 10000 or with receipt", async () => {
    activeDb.groups[0].require_receipt_over_100 = true;

    // 1. Exactly $100.00 (10000 cents) without receipt -> 201 allowed
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const atThresholdRes = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          paid_by: "u-alex",
          description: "Exactly 100",
          category: "Groceries",
          amount_cents: 10000,
          split_method: "EQUAL",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(atThresholdRes.status).toBe(201);

    // 2. $100.01 (10001 cents) without receipt -> 400 RECEIPT_REQUIRED
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const missingReceiptRes = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          paid_by: "u-alex",
          description: "Over 100 No Receipt",
          category: "Groceries",
          amount_cents: 10001,
          split_method: "EQUAL",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(missingReceiptRes.status).toBe(400);
    expect((await missingReceiptRes.json()).code).toBe("RECEIPT_REQUIRED");

    // 3. $150.00 (15000 cents) WITH receipt_url -> 201 Created
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const withReceiptRes = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          paid_by: "u-alex",
          description: "Over 100 With Receipt",
          category: "Groceries",
          amount_cents: 15000,
          split_method: "EQUAL",
          receipt_url: "receipts://u-alex/grp-apt4b/1700000000-receipt.png",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(withReceiptRes.status).toBe(201);
    expect((await withReceiptRes.json()).expense.receipt_url).toBe(
      "receipts://u-alex/grp-apt4b/1700000000-receipt.png",
    );
  });

  it("rejects SUM(split_breakdown) != amount_cents and missing description", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });

    const mismatchRes = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          paid_by: "u-alex",
          description: "Bad Split",
          category: "General",
          amount_cents: 10000,
          split_method: "EXACT",
          split_breakdown: [
            { user_id: "u-alex", share_cents: 3333 },
            { user_id: "u-elena", share_cents: 3333 },
            { user_id: "u-marcus", share_cents: 3333 },
          ],
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(mismatchRes.status).toBe(400);
    expect((await mismatchRes.json()).code).toBe("SPLIT_SUM_MISMATCH");

    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const emptyDescRes = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          paid_by: "u-alex",
          description: "   ",
          category: "General",
          amount_cents: 3000,
          split_method: "EQUAL",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(emptyDescRes.status).toBe(400);
    expect((await emptyDescRes.json()).code).toBe("INVALID_DESCRIPTION");
  });

  it("returns FX spot rate for display-only rollup currency pairs and rejects invalid currency codes", async () => {
    const sameRes = await fxGet(
      new NextRequest("http://localhost:3000/api/fx?from=USD&to=USD"),
    );
    expect(sameRes.status).toBe(200);
    const sameJson = await sameRes.json();
    expect(sameJson.rate).toBe(1);
    expect(sameJson.source).toBe("API");

    const badRes = await fxGet(
      new NextRequest("http://localhost:3000/api/fx?from=US&to=USD"),
    );
    expect(badRes.status).toBe(400);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ amount: 1, base: "EUR", rates: { USD: 1.0925 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const liveRes = await fxGet(
      new NextRequest("http://localhost:3000/api/fx?from=EUR&to=USD"),
    );
    expect(liveRes.status).toBe(200);
    const liveJson = await liveRes.json();
    expect(liveJson.rate).toBe(1.0925);
    expect(liveJson.source).toBe("API");
    fetchSpy.mockRestore();
  });

  it("uploads receipts without 500 MB quota blocking and authorizes signed downloads by group membership", async () => {
    const sharedGroupUuid = "11111111-1111-4111-8111-111111111111";
    const privateGroupUuid = "22222222-2222-4222-8222-222222222222";
    activeDb.groups.push(
      {
        id: sharedGroupUuid,
        name: "Shared Apt",
        slug: "shared-apt",
        group_type: "RESIDENTIAL",
        status: "ACTIVE",
        base_currency: "USD",
        default_split_mode: "EQUAL",
        allow_any_member_add_expense: true,
        require_receipt_over_100: false,
      },
      {
        id: privateGroupUuid,
        name: "Tokyo Trip",
        slug: "tokyo-trip",
        group_type: "TRIP",
        status: "ACTIVE",
        base_currency: "USD",
        default_split_mode: "EQUAL",
        allow_any_member_add_expense: true,
        require_receipt_over_100: false,
      },
    );
    activeDb.group_members.push(
      {
        group_id: sharedGroupUuid,
        user_id: "u-alex",
        role: "ADMIN",
        status: "ACTIVE",
        share_percentage: 50,
        share_units: 1,
        joined_at: "2026-10-04T00:00:00.000Z",
      },
      {
        group_id: sharedGroupUuid,
        user_id: "u-elena",
        role: "MEMBER",
        status: "ACTIVE",
        share_percentage: 50,
        share_units: 1,
        joined_at: "2026-10-04T00:00:00.000Z",
      },
      {
        group_id: privateGroupUuid,
        user_id: "u-alex",
        role: "ADMIN",
        status: "ACTIVE",
        share_percentage: 100,
        share_units: 1,
        joined_at: "2026-10-04T00:00:00.000Z",
      },
    );

    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const fd1 = new FormData();
    fd1.append(
      "file",
      new File([new Uint8Array(1200)], "groceries.png", { type: "image/png" }),
    );
    fd1.append("groupId", sharedGroupUuid);
    const res1 = await receiptsPost(
      new NextRequest("http://localhost:3000/api/receipts", {
        method: "POST",
        body: fd1,
      }),
    );
    expect(res1.status).toBe(201);
    const json1 = await res1.json();
    expect(json1.sizeBytes).toBe(1200);
    expect(json1.receiptUrl).toMatch(
      new RegExp(`^receipts://u-alex/${sharedGroupUuid}/`),
    );

    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
    const fd2 = new FormData();
    fd2.append(
      "file",
      new File([new Uint8Array(800)], "train.pdf", { type: "application/pdf" }),
    );
    fd2.append("groupId", privateGroupUuid);
    const res2 = await receiptsPost(
      new NextRequest("http://localhost:3000/api/receipts", {
        method: "POST",
        body: fd2,
      }),
    );
    expect(res2.status).toBe(201);
    const json2 = await res2.json();

    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-elena", email: "elena@example.com" } },
      error: null,
    });
    const allowedGet = await receiptsGet(
      new NextRequest(
        `http://localhost:3000/api/receipts?format=json&path=${encodeURIComponent(json1.receiptUrl)}`,
      ),
    );
    expect(allowedGet.status).toBe(200);
    expect((await allowedGet.json()).signedUrl).toContain("token=signed");

    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-elena", email: "elena@example.com" } },
      error: null,
    });
    const forbiddenGet = await receiptsGet(
      new NextRequest(
        `http://localhost:3000/api/receipts?format=json&path=${encodeURIComponent(json2.receiptUrl)}`,
      ),
    );
    expect(forbiddenGet.status).toBe(403);
  });
});
