import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildExpensesCsv } from "@/lib/expenses/ledger";
import { formatMinorUnits, formatMinorUnitsDecimal } from "@/lib/money";

const getUserMock = vi.fn();

interface InMemoryUserRow {
  id: string;
  full_name: string;
}

interface InMemoryGroupRow {
  id: string;
  name: string;
  slug: string;
  group_type: "RESIDENTIAL" | "TRIP" | "RECURRING";
  status: "ACTIVE" | "NEEDS_RATIO_UPDATE" | "ARCHIVED";
  base_currency: string;
  billing_cycle_anchor_day: number;
  created_at: string;
}

interface InMemoryMemberRow {
  group_id: string;
  user_id: string;
  role: "ADMIN" | "MEMBER";
  status: "ACTIVE" | "FORMER_MEMBER";
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
    };
  }

  return {
    auth: {
      getUser: getUserMock,
    },
    from(table: keyof InMemoryDb) {
      return makeTable(db[table] as unknown as object[]);
    },
  };
}

function parseRfc4180Csv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && input[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

let activeDb: InMemoryDb;

vi.mock("@/lib/auth/guards", () => ({
  hasSupabaseEnv: () => true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createInMemorySupabase(activeDb),
}));

import { GET as exportScopedExpenses } from "@/app/api/expenses/export/route";
import { GET as exportSettingsHistory } from "@/app/api/settings/export/route";

describe("Issue #89 — CSV & JSON Ledger Export APIs, Scoping & Integer Minor-Unit Formatting", () => {
  beforeEach(() => {
    activeDb = {
      users: [
        { id: "u-alex", full_name: "Alex Rivera" },
        { id: "u-elena", full_name: "Elena Rostova" },
        { id: "u-outsider", full_name: "Outsider User" },
      ],
      groups: [
        {
          id: "grp-usd",
          name: "Apt 4B, Roommates",
          slug: "apt-4b",
          group_type: "RESIDENTIAL",
          status: "ACTIVE",
          base_currency: "USD",
          billing_cycle_anchor_day: 1,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "grp-tokyo",
          name: "Tokyo Trip",
          slug: "tokyo-trip",
          group_type: "TRIP",
          status: "ACTIVE",
          base_currency: "JPY",
          billing_cycle_anchor_day: 15,
          created_at: "2026-02-01T00:00:00.000Z",
        },
        {
          id: "grp-archived",
          name: "Euro Summer 2025",
          slug: "euro-summer",
          group_type: "TRIP",
          status: "ARCHIVED",
          base_currency: "EUR",
          billing_cycle_anchor_day: 1,
          created_at: "2025-06-01T00:00:00.000Z",
        },
        {
          id: "grp-other",
          name: "Private Group",
          slug: "private-group",
          group_type: "RESIDENTIAL",
          status: "ACTIVE",
          base_currency: "GBP",
          billing_cycle_anchor_day: 1,
          created_at: "2026-03-01T00:00:00.000Z",
        },
      ],
      group_members: [
        { group_id: "grp-usd", user_id: "u-alex", role: "ADMIN", status: "ACTIVE" },
        { group_id: "grp-usd", user_id: "u-elena", role: "MEMBER", status: "ACTIVE" },
        { group_id: "grp-tokyo", user_id: "u-alex", role: "ADMIN", status: "ACTIVE" },
        { group_id: "grp-tokyo", user_id: "u-elena", role: "MEMBER", status: "ACTIVE" },
        { group_id: "grp-archived", user_id: "u-alex", role: "ADMIN", status: "ACTIVE" },
        { group_id: "grp-other", user_id: "u-outsider", role: "ADMIN", status: "ACTIVE" },
      ],
      expenses: [
        // 1. USD group in 2026-11 with FX conversion metadata + quotes in description
        {
          id: "exp-usd-nov",
          group_id: "grp-usd",
          created_by: "u-alex",
          paid_by: "u-alex",
          description: 'Coffee "Special", Roast',
          category: "Groceries & Food",
          expense_date: "2026-11-18T12:00:00.000Z",
          amount_cents: 18250, // $182.50
          currency: "USD",
          original_amount_cents: 16820, // EUR 168.20
          original_currency: "EUR",
          exchange_rate: 1.085018,
          exchange_rate_source: "MANUAL_OVERRIDE",
          split_method: "EQUAL",
          split_breakdown: [
            { user_id: "u-alex", share_cents: 9125 },
            { user_id: "u-elena", share_cents: 9125 },
          ],
          receipt_url: "u-alex/receipt-1.jpg",
          is_recurring_generated: false,
          recurring_rule_id: null,
          adjustment_for_expense_id: null,
          is_locked: false,
          deleted_at: null,
        },
        // 2. USD group in 2026-10 (closed historical cycle, negative adjustment)
        {
          id: "exp-usd-oct",
          group_id: "grp-usd",
          created_by: "u-elena",
          paid_by: "u-elena",
          description: "Utility Credit Adjustment",
          category: "Utilities",
          expense_date: "2026-10-12T12:00:00.000Z",
          amount_cents: -2550,
          currency: "USD",
          original_amount_cents: null,
          original_currency: null,
          exchange_rate: null,
          exchange_rate_source: null,
          split_method: "EXACT",
          split_breakdown: [
            { user_id: "u-alex", share_cents: -1275 },
            { user_id: "u-elena", share_cents: -1275 },
          ],
          receipt_url: null,
          is_recurring_generated: false,
          recurring_rule_id: null,
          adjustment_for_expense_id: null,
          is_locked: false,
          deleted_at: null,
        },
        // 3. Tokyo group (JPY 0-decimal currency, anchor day 15: 2026-11-16 belongs to 2026-11)
        {
          id: "exp-tokyo-nov",
          group_id: "grp-tokyo",
          created_by: "u-alex",
          paid_by: "u-alex",
          description: "Shinkansen Tickets",
          category: "Transit & Travel",
          expense_date: "2026-11-16T09:00:00.000Z",
          amount_cents: 28400, // ¥28,400 (0 minor digits)
          currency: "JPY",
          original_amount_cents: 19000, // $190.00 USD
          original_currency: "USD",
          exchange_rate: 149.473684,
          exchange_rate_source: "API",
          split_method: "EQUAL",
          split_breakdown: [
            { user_id: "u-alex", share_cents: 14200 },
            { user_id: "u-elena", share_cents: 14200 },
          ],
          receipt_url: null,
          is_recurring_generated: false,
          recurring_rule_id: null,
          adjustment_for_expense_id: null,
          is_locked: false,
          deleted_at: null,
        },
        // 4. Archived EUR group (excluded from Dashboard/Expenses "all", INCLUDED in Settings full history)
        {
          id: "exp-archived-eur",
          group_id: "grp-archived",
          created_by: "u-alex",
          paid_by: "u-alex",
          description: "Paris Hotel",
          category: "Transit & Travel",
          expense_date: "2025-06-10T10:00:00.000Z",
          amount_cents: 45075, // €450.75
          currency: "EUR",
          original_amount_cents: null,
          original_currency: null,
          exchange_rate: null,
          exchange_rate_source: null,
          split_method: "EQUAL",
          split_breakdown: [{ user_id: "u-alex", share_cents: 45075 }],
          receipt_url: null,
          is_recurring_generated: false,
          recurring_rule_id: null,
          adjustment_for_expense_id: null,
          is_locked: true,
          deleted_at: null,
        },
        // 5. Soft-deleted expense (must never be exported)
        {
          id: "exp-deleted",
          group_id: "grp-usd",
          created_by: "u-alex",
          paid_by: "u-alex",
          description: "Deleted Mistake",
          category: "General",
          expense_date: "2026-11-19T10:00:00.000Z",
          amount_cents: 9999,
          currency: "USD",
          original_amount_cents: null,
          original_currency: null,
          exchange_rate: null,
          exchange_rate_source: null,
          split_method: "EQUAL",
          split_breakdown: [{ user_id: "u-alex", share_cents: 9999 }],
          receipt_url: null,
          is_recurring_generated: false,
          recurring_rule_id: null,
          adjustment_for_expense_id: null,
          is_locked: false,
          deleted_at: "2026-11-20T00:00:00.000Z",
        },
        // 6. Outsider group expense (must never be exported for u-alex)
        {
          id: "exp-outsider",
          group_id: "grp-other",
          created_by: "u-outsider",
          paid_by: "u-outsider",
          description: "Secret Expense",
          category: "General",
          expense_date: "2026-11-19T10:00:00.000Z",
          amount_cents: 5000,
          currency: "GBP",
          original_amount_cents: null,
          original_currency: null,
          exchange_rate: null,
          exchange_rate_source: null,
          split_method: "EQUAL",
          split_breakdown: [{ user_id: "u-outsider", share_cents: 5000 }],
          receipt_url: null,
          is_recurring_generated: false,
          recurring_rule_id: null,
          adjustment_for_expense_id: null,
          is_locked: false,
          deleted_at: null,
        },
      ],
      settlements: [
        {
          id: "set-1",
          group_id: "grp-usd",
          payer_id: "u-elena",
          recipient_id: "u-alex",
          amount_cents: 5000,
          currency: "USD",
          payment_rail: "VENMO",
          settled_at: "2026-11-19T15:00:00.000Z",
        },
      ],
      billing_cycles: [
        {
          id: "bc-oct",
          group_id: "grp-usd",
          period_start: "2026-10-01",
          period_end: "2026-10-31",
          status: "CLOSED",
        },
      ],
    };

    getUserMock.mockResolvedValue({
      data: { user: { id: "u-alex", email: "alex@example.com" } },
      error: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("formats integer minor units in Group.base_currency without IEEE 754 float drift", () => {
    expect(formatMinorUnitsDecimal(18250, "USD")).toBe("182.50");
    expect(formatMinorUnitsDecimal(28400, "JPY")).toBe("28400");
    expect(formatMinorUnitsDecimal(-2550, "EUR")).toBe("-25.50");
    expect(formatMinorUnitsDecimal(BigInt("9007199254740991"), "USD")).toBe(
      "90071992547409.91",
    );
    expect(formatMinorUnits(BigInt("9007199254740991"), "USD")).toBe(
      "$90,071,992,547,409.91",
    );
    expect(formatMinorUnits(28400, "JPY")).toBe("¥28,400");
  });

  it("produces RFC-4180 CSV with CRLF endings, proper quoting, formula protection, and integer minor units", () => {
    const csv = buildExpensesCsv(
      [
        {
          id: "exp-1",
          groupId: "grp-1",
          groupName: 'Roommates, "4B"',
          groupBaseCurrency: "EUR",
          groupBillingAnchorDay: 1,
          createdBy: "u-alex",
          paidBy: "u-alex",
          payerName: "Alex",
          description: "=HYPERLINK(\"http://bad\")\nLine2",
          category: "General",
          expenseDate: "2026-11-10T10:00:00.000Z",
          amountCents: -2550,
          currency: "USD", // intentionally mismatched; Group.base_currency ("EUR") must govern
          originalAmountCents: 3000,
          originalCurrency: "USD",
          exchangeRate: 0.85,
          exchangeRateSource: "MANUAL_OVERRIDE",
          splitMethod: "EXACT",
          splitBreakdown: [{ user_id: "u-alex", share_cents: -1275 }],
          receiptUrl: null,
          isRecurringGenerated: false,
          recurringRuleId: null,
          adjustmentForExpenseId: null,
          isLocked: false,
          isCycleClosed: false,
          isSettledByWatermark: false,
          isSettledForUser: false,
        },
      ],
      "u-alex",
    );

    // Must use CRLF line endings per RFC-4180
    expect(csv).toContain("\r\n");

    const parsed = parseRfc4180Csv(csv);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toContain("Exchange Rate Source");
    expect(parsed[0]).toContain("Total Amount (Minor Units)");

    const row = parsed[1];
    expect(row).toHaveLength(parsed[0].length);
    expect(row[1]).toBe('Roommates, "4B"');
    expect(row[2]).toBe('\'=HYPERLINK("http://bad")\nLine2');
    // Formatted in Group.base_currency (EUR) without quote-prefixing negative money
    expect(row[6]).toBe("-€12.75");
    expect(row[7]).toBe("-€25.50");
    expect(row[8]).toBe("EUR");
    expect(row[9]).toBe("$30.00");
    expect(row[10]).toBe("USD");
    expect(row[11]).toBe("0.85");
    expect(row[12]).toBe("MANUAL_OVERRIDE");
    expect(row[14]).toBe("-2550");
    expect(row[15]).toBe("-1275");
    expect(row[16]).toBe("3000");
  });

  it("GET /api/expenses/export scopes RFC-4180 CSV to ?group= and ?cycle= with FX metadata and Group.base_currency", async () => {
    // 1. All active groups in 2026-11
    const allNovRes = await exportScopedExpenses(
      new NextRequest(
        "http://localhost:3000/api/expenses/export?group=all&cycle=2026-11&format=csv",
      ),
    );
    expect(allNovRes.status).toBe(200);
    expect(allNovRes.headers.get("content-type")).toContain("text/csv");
    expect(allNovRes.headers.get("content-disposition")).toBe(
      'attachment; filename="ledgersplit-all-groups-2026-11.csv"',
    );

    const allNovCsv = await allNovRes.text();
    expect(allNovCsv).toContain("\r\n");
    const allRows = parseRfc4180Csv(allNovCsv);
    // Header + 2 expenses in 2026-11 (USD + Tokyo JPY); excludes Oct, Archived, Deleted, Outsider
    expect(allRows).toHaveLength(3);
    expect(allNovCsv).toContain('Coffee ""Special"", Roast');
    expect(allNovCsv).toContain("Shinkansen Tickets");
    expect(allNovCsv).not.toContain("Utility Credit Adjustment");
    expect(allNovCsv).not.toContain("Paris Hotel");
    expect(allNovCsv).not.toContain("Deleted Mistake");
    expect(allNovCsv).not.toContain("Secret Expense");

    // 2. Single group (grp-tokyo) in 2026-11 -> JPY 0-decimal formatting + FX audit
    const tokyoRes = await exportScopedExpenses(
      new NextRequest(
        "http://localhost:3000/api/expenses/export?group=grp-tokyo&cycle=2026-11&format=csv",
      ),
    );
    expect(tokyoRes.status).toBe(200);
    expect(tokyoRes.headers.get("content-disposition")).toBe(
      'attachment; filename="ledgersplit-tokyo-trip-2026-11.csv"',
    );
    const tokyoRows = parseRfc4180Csv(await tokyoRes.text());
    expect(tokyoRows).toHaveLength(2);
    expect(tokyoRows[1]).toContain("¥14,200");
    expect(tokyoRows[1]).toContain("¥28,400");
    expect(tokyoRows[1]).toContain("JPY");
    expect(tokyoRows[1]).toContain("28400");

    // 3. Closed historical cycle 2026-10 on grp-usd -> LOCKED status & negative adjustment
    const octUsdRes = await exportScopedExpenses(
      new NextRequest(
        "http://localhost:3000/api/expenses/export?group=grp-usd&cycle=2026-10&format=json",
      ),
    );
    expect(octUsdRes.status).toBe(200);
    const octJson = (await octUsdRes.json()) as {
      scope: { group: string; cycle: string };
      expenses: Array<{
        id: string;
        base_currency: string;
        amount_cents: number;
        amount_formatted: string;
        amount_decimal: string;
        status: string;
      }>;
    };
    expect(octJson.scope).toEqual({ group: "grp-usd", cycle: "2026-10" });
    expect(octJson.expenses).toHaveLength(1);
    expect(octJson.expenses[0]).toMatchObject({
      id: "exp-usd-oct",
      base_currency: "USD",
      amount_cents: -2550,
      amount_formatted: "-$25.50",
      amount_decimal: "-25.50",
      status: "LOCKED",
    });
  });

  it("enforces auth, membership, and query validation on export endpoints", async () => {
    // Unauthenticated -> 401
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    const unauthRes = await exportScopedExpenses(
      new NextRequest("http://localhost:3000/api/expenses/export?group=all&cycle=2026-11"),
    );
    expect(unauthRes.status).toBe(401);

    // Non-member group -> 403
    const forbiddenRes = await exportScopedExpenses(
      new NextRequest("http://localhost:3000/api/expenses/export?group=grp-other&cycle=2026-11"),
    );
    expect(forbiddenRes.status).toBe(403);

    // Missing group -> 404
    const notFoundRes = await exportScopedExpenses(
      new NextRequest("http://localhost:3000/api/expenses/export?group=grp-missing&cycle=2026-11"),
    );
    expect(notFoundRes.status).toBe(404);

    // Invalid cycle -> 400
    const badCycleRes = await exportScopedExpenses(
      new NextRequest("http://localhost:3000/api/expenses/export?group=all&cycle=2026-99"),
    );
    expect(badCycleRes.status).toBe(400);

    // Invalid format -> 400
    const badFormatRes = await exportSettingsHistory(
      new NextRequest("http://localhost:3000/api/settings/export?format=xml"),
    );
    expect(badFormatRes.status).toBe(400);
  });

  it("GET /api/settings/export exports full user history across active & archived groups in CSV and JSON", async () => {
    const csvRes = await exportSettingsHistory(
      new NextRequest("http://localhost:3000/api/settings/export?format=csv"),
    );
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    const csvText = await csvRes.text();
    const rows = parseRfc4180Csv(csvText);
    // Header + 4 user expenses (incl. archived EUR group) + 1 settlement = 6 lines
    expect(rows).toHaveLength(6);
    expect(csvText).toContain("Paris Hotel");
    expect(csvText).toContain("€450.75");
    expect(csvText).toContain("SETTLEMENT");
    expect(csvText).not.toContain("Secret Expense");

    const jsonRes = await exportSettingsHistory(
      new NextRequest("http://localhost:3000/api/settings/export?format=json"),
    );
    expect(jsonRes.status).toBe(200);
    const jsonBody = (await jsonRes.json()) as {
      groups: Array<{ id: string }>;
      expenses: Array<{
        id: string;
        base_currency: string;
        amount_cents: number;
        amount_formatted: string;
        amount_decimal: string;
        fx_audit: {
          original_amount_cents: number;
          original_currency: string;
          exchange_rate: number;
          exchange_rate_source: string;
        } | null;
      }>;
      settlements: Array<{
        id: string;
        base_currency: string;
        amount_cents: number;
        amount_formatted: string;
      }>;
    };

    expect(jsonBody.groups.map((g) => g.id)).toEqual([
      "grp-usd",
      "grp-tokyo",
      "grp-archived",
    ]);
    expect(jsonBody.expenses).toHaveLength(4);
    const usdExp = jsonBody.expenses.find((e) => e.id === "exp-usd-nov");
    expect(usdExp).toMatchObject({
      base_currency: "USD",
      amount_cents: 18250,
      amount_formatted: "$182.50",
      amount_decimal: "182.50",
      fx_audit: null,
    });
    expect(jsonBody.settlements).toHaveLength(1);
    expect(jsonBody.settlements[0]).toMatchObject({
      id: "set-1",
      base_currency: "USD",
      amount_cents: 5000,
      amount_formatted: "$50.00",
    });
  });
});
