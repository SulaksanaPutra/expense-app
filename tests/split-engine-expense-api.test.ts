import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RECEIPT_STORAGE_QUOTA_BYTES,
  checkReceiptStorageQuota,
  computeEqualSplit,
  computeExactSplit,
  computePercentageSplit,
  convertForeignAmountToBaseMinorUnits,
  validateSplitBreakdown,
} from "@/lib/expenses/split-engine";

const getUserMock = vi.fn();

interface InMemoryDb {
  users: Array<{
    id: string;
    email: string;
    full_name: string;
    receipt_storage_used_bytes: number;
  }>;
  groups: Array<{
    id: string;
    name: string;
    slug: string;
    group_type: "RESIDENTIAL" | "TRIP" | "RECURRING";
    status: "ACTIVE" | "NEEDS_RATIO_UPDATE" | "ARCHIVED";
    base_currency: string;
    default_split_mode: "EQUAL" | "CUSTOM_RATIOS";
  }>;
  group_members: Array<{
    group_id: string;
    user_id: string;
    role: "ADMIN" | "MEMBER";
    status: "ACTIVE" | "FORMER_MEMBER";
    share_percentage: number;
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
import { POST as receiptsPost } from "@/app/api/receipts/route";

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
    // 100 = 16 * 6 + 4; payer u-3 gets +1, then u-1, u-2, u-4 get +1
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

  it("validates exact splits and rejects mismatched sums or former members", () => {
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

  it("converts foreign-currency minor units (including 0-decimal JPY) using 1e6 fixed-point rate scaling", () => {
    const usdFromEur = convertForeignAmountToBaseMinorUnits({
      originalAmountCents: 10000, // €100.00
      originalCurrency: "EUR",
      exchangeRate: 1.085,
      baseCurrency: "USD",
    });
    expect(usdFromEur).toBe(10850);

    const usdFromJpy = convertForeignAmountToBaseMinorUnits({
      originalAmountCents: 94500, // ¥94,500
      originalCurrency: "JPY",
      exchangeRate: 0.006667,
      baseCurrency: "USD",
    });
    expect(usdFromJpy).toBe(63003);
  });

  it("checks 500 MB receipt storage quota accurately", () => {
    expect(
      checkReceiptStorageQuota(RECEIPT_STORAGE_QUOTA_BYTES - 1024, 1024).allowed,
    ).toBe(true);
    expect(
      checkReceiptStorageQuota(RECEIPT_STORAGE_QUOTA_BYTES - 1024, 1025).allowed,
    ).toBe(false);
  });
});

describe("Expense Create API, FX Audit & Receipt Quota", () => {
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
          receipt_storage_used_bytes: 0,
        },
        {
          id: "u-elena",
          email: "elena@example.com",
          full_name: "Elena Rostova",
          receipt_storage_used_bytes: RECEIPT_STORAGE_QUOTA_BYTES,
        },
        {
          id: "u-marcus",
          email: "marcus@example.com",
          full_name: "Marcus Vance",
          receipt_storage_used_bytes: 0,
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
          category: "Groceries & Food",
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

  it("persists foreign-currency FX audit fields alongside converted Group.base_currency amount", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });

    const baseAmountCents = convertForeignAmountToBaseMinorUnits({
      originalAmountCents: 10000,
      originalCurrency: "EUR",
      exchangeRate: 1.1,
      baseCurrency: "USD",
    })!;

    const breakdown = computeEqualSplit({
      amountCents: baseAmountCents,
      paidBy: "u-alex",
      participantIds: ["u-alex", "u-elena", "u-marcus"],
    });

    const res = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          paid_by: "u-alex",
          description: "Euro Train Ticket",
          category: "Transit & Travel",
          amount_cents: baseAmountCents,
          split_method: "EQUAL",
          split_breakdown: breakdown,
          original_amount_cents: 10000,
          original_currency: "EUR",
          exchange_rate: 1.1,
          exchange_rate_source: "MANUAL_OVERRIDE",
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.expense.amount_cents).toBe(11000);
    expect(json.expense.currency).toBe("USD");
    expect(json.expense.original_amount_cents).toBe(10000);
    expect(json.expense.original_currency).toBe("EUR");
    expect(json.expense.exchange_rate).toBe(1.1);
    expect(json.expense.exchange_rate_source).toBe("MANUAL_OVERRIDE");
  });

  it("enforces 500 MB receipt storage quota while keeping expense logging non-blocking", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-elena", email: "elena@example.com" } },
      error: null,
    });

    const formData = new FormData();
    formData.append(
      "file",
      new File([new Uint8Array([1, 2, 3, 4])], "receipt.png", {
        type: "image/png",
      }),
    );
    formData.append("groupId", "grp-apt4b");

    const uploadRes = await receiptsPost(
      new NextRequest("http://localhost:3000/api/receipts", {
        method: "POST",
        body: formData,
      }),
    );
    expect(uploadRes.status).toBe(413);
    const uploadJson = await uploadRes.json();
    expect(uploadJson.code).toBe("RECEIPT_QUOTA_EXCEEDED");

    // Logging expense without receipt still succeeds
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-elena", email: "elena@example.com" } },
      error: null,
    });
    const expRes = await expensePost(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/expenses", {
        method: "POST",
        body: JSON.stringify({
          paid_by: "u-elena",
          description: "Dinner Without Receipt",
          category: "Dining Out",
          amount_cents: 6000,
          split_method: "EQUAL",
          receipt_url: null,
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(expRes.status).toBe(201);
  });

  it("returns FX spot rate for valid currency pairs", async () => {
    const res = await fxGet(
      new NextRequest("http://localhost:3000/api/fx?from=USD&to=USD"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rate).toBe(1);
    expect(json.source).toBe("API");
  });
});
