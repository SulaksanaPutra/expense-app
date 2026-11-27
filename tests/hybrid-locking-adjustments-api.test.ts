import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computePerGroupDebtEdges } from "@/lib/expenses/ledger";

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

interface InMemoryBillingCycleRow {
  id: string;
  group_id: string;
  period_start: string;
  period_end: string;
  status: "OPEN" | "CLOSED";
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
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

interface Store {
  groups: InMemoryGroupRow[];
  group_members: InMemoryMemberRow[];
  expenses: InMemoryExpenseRow[];
  billing_cycles: InMemoryBillingCycleRow[];
  settlements: InMemorySettlementRow[];
  group_audit_logs: Array<Record<string, unknown>>;
  users: Array<{ id: string; full_name: string; email: string }>;
}

let store: Store;

function makeMockSupabase() {
  return {
    auth: {
      getUser: getUserMock,
    },
    from(table: keyof Store) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let pendingOp: "select" | "insert" | "update" = "select";
      let insertPayload: Record<string, unknown> | null = null;
      let updatePayload: Record<string, unknown> | null = null;

      const applyFilters = (rows: Record<string, unknown>[]) =>
        rows.filter((r) => filters.every((fn) => fn(r)));

      const execute = async () => {
        const list = store[table] as unknown as Record<string, unknown>[];
        if (pendingOp === "insert" && insertPayload) {
          const created: Record<string, unknown> = {
            id: insertPayload.id ?? crypto.randomUUID(),
            created_at: new Date().toISOString(),
            settled_at: insertPayload.settled_at ?? new Date().toISOString(),
            is_locked: insertPayload.is_locked ?? false,
            deleted_at: insertPayload.deleted_at ?? null,
            is_recurring_generated: insertPayload.is_recurring_generated ?? false,
            recurring_rule_id: insertPayload.recurring_rule_id ?? null,
            adjustment_for_expense_id:
              insertPayload.adjustment_for_expense_id ?? null,
            ...insertPayload,
          };
          list.push(created);
          return { data: created, error: null };
        }
        if (pendingOp === "update" && updatePayload) {
          const matched = applyFilters(list);
          for (const row of matched) {
            Object.assign(row, updatePayload);
          }
          return { data: matched[0] ?? null, error: null };
        }
        const matched = applyFilters(list);
        return { data: matched, error: null };
      };

      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
          pendingOp = "insert";
          insertPayload = Array.isArray(payload) ? payload[0] : payload;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          pendingOp = "update";
          updatePayload = payload;
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
        order() {
          return builder;
        },
        async maybeSingle() {
          const res = await execute();
          const row = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
          return { data: row, error: res.error };
        },
        then(
          onFulfilled: (value: { data: unknown; error: null }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return execute().then(onFulfilled, onRejected);
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
  createClient: async () => makeMockSupabase(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => false,
  createAdminClient: () => makeMockSupabase(),
}));

describe("Issue #85 — Hybrid Locking (Cycle Close + Pairwise Watermark) & Offsetting Adjustments API", () => {
  const groupId = "11111111-1111-4111-8111-111111111111";
  const aliceId = "aaaa1111-1111-4111-8111-111111111111";
  const bobId = "bbbb1111-1111-4111-8111-111111111111";
  const charlieId = "cccc1111-1111-4111-8111-111111111111";
  const liamId = "dddd1111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    store = {
      users: [
        { id: aliceId, full_name: "Alice Admin", email: "alice@test.local" },
        { id: bobId, full_name: "Bob Member", email: "bob@test.local" },
        { id: charlieId, full_name: "Charlie Member", email: "charlie@test.local" },
        { id: liamId, full_name: "Liam Member", email: "liam@test.local" },
      ],
      groups: [
        {
          id: groupId,
          name: "Apt 4B",
          slug: "apt-4b",
          group_type: "RESIDENTIAL",
          status: "ACTIVE",
          base_currency: "USD",
          default_split_mode: "EQUAL",
          simplify_debts: false,
          operational_budget_cents: 450000,
          billing_cycle_anchor_day: 1,
          created_at: "2026-10-01T00:00:00.000Z",
        },
      ],
      group_members: [
        {
          group_id: groupId,
          user_id: aliceId,
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 25,
          joined_at: "2026-10-01T00:00:00.000Z",
        },
        {
          group_id: groupId,
          user_id: bobId,
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 25,
          joined_at: "2026-10-01T00:01:00.000Z",
        },
        {
          group_id: groupId,
          user_id: charlieId,
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 25,
          joined_at: "2026-10-01T00:02:00.000Z",
        },
        {
          group_id: groupId,
          user_id: liamId,
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 25,
          joined_at: "2026-10-01T00:03:00.000Z",
        },
      ],
      expenses: [
        {
          id: "eeee1111-1111-4111-8111-111111111111",
          group_id: groupId,
          created_by: charlieId,
          paid_by: aliceId,
          description: "4-Way Utility Bill",
          category: "Utilities",
          expense_date: "2026-11-10T12:00:00.000Z",
          amount_cents: 12000,
          currency: "USD",
          original_amount_cents: null,
          original_currency: null,
          exchange_rate: null,
          exchange_rate_source: null,
          split_method: "EQUAL",
          split_breakdown: [
            { user_id: aliceId, share_cents: 3000, percentage: 25 },
            { user_id: bobId, share_cents: 3000, percentage: 25 },
            { user_id: charlieId, share_cents: 3000, percentage: 25 },
            { user_id: liamId, share_cents: 3000, percentage: 25 },
          ],
          receipt_url: null,
          is_recurring_generated: false,
          recurring_rule_id: null,
          adjustment_for_expense_id: null,
          is_locked: false,
          deleted_at: null,
        },
        {
          id: "eeee2222-2222-4222-8222-222222222222",
          group_id: groupId,
          created_by: charlieId,
          paid_by: charlieId,
          description: "Charlie & Liam Groceries",
          category: "Groceries & Food",
          expense_date: "2026-11-12T12:00:00.000Z",
          amount_cents: 4000,
          currency: "USD",
          original_amount_cents: null,
          original_currency: null,
          exchange_rate: null,
          exchange_rate_source: null,
          split_method: "EQUAL",
          split_breakdown: [
            { user_id: charlieId, share_cents: 2000, percentage: 50 },
            { user_id: liamId, share_cents: 2000, percentage: 50 },
          ],
          receipt_url: null,
          is_recurring_generated: false,
          recurring_rule_id: null,
          adjustment_for_expense_id: null,
          is_locked: false,
          deleted_at: null,
        },
      ],
      billing_cycles: [],
      settlements: [],
      group_audit_logs: [],
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enforces ADMIN-only Close & Lock Billing Cycle, locks all cycle expenses, and rejects duplicate close with 409", async () => {
    const { POST } = await import(
      "@/app/api/groups/[groupId]/billing-cycles/close/route"
    );
    const { PATCH, DELETE } = await import(
      "@/app/api/groups/[groupId]/expenses/[expenseId]/route"
    );

    // Non-admin MEMBER is rejected with 403
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: bobId } },
      error: null,
    });
    const memberRes = await POST(
      new NextRequest(`http://localhost/api/groups/${groupId}/billing-cycles/close`, {
        method: "POST",
        body: JSON.stringify({ cycle: "2026-11" }),
      }),
      { params: Promise.resolve({ groupId }) },
    );
    expect(memberRes.status).toBe(403);

    // ADMIN closes 2026-11 cycle
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: aliceId } },
      error: null,
    });
    const adminRes = await POST(
      new NextRequest(`http://localhost/api/groups/${groupId}/billing-cycles/close`, {
        method: "POST",
        body: JSON.stringify({ cycle: "2026-11" }),
      }),
      { params: Promise.resolve({ groupId }) },
    );
    expect(adminRes.status).toBe(200);
    const adminJson = (await adminRes.json()) as {
      ok: boolean;
      lockedExpenseCount: number;
      billingCycle: { status: string; period_start: string; period_end: string };
    };
    expect(adminJson.ok).toBe(true);
    expect(adminJson.billingCycle.status).toBe("CLOSED");
    expect(adminJson.billingCycle.period_start).toBe("2026-11-01");
    expect(adminJson.billingCycle.period_end).toBe("2026-11-30");
    expect(adminJson.lockedExpenseCount).toBe(2);
    expect(store.expenses.every((e) => e.is_locked)).toBe(true);
    expect(store.group_audit_logs.some((l) => l.event_type === "BILLING_CYCLE_CLOSED")).toBe(true);

    // Duplicate close returns 409
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: aliceId } },
      error: null,
    });
    const dupRes = await POST(
      new NextRequest(`http://localhost/api/groups/${groupId}/billing-cycles/close`, {
        method: "POST",
        body: JSON.stringify({ cycle: "2026-11" }),
      }),
      { params: Promise.resolve({ groupId }) },
    );
    expect(dupRes.status).toBe(409);

    // Editing or deleting any expense in closed cycle fails with 409 EXPENSE_LOCKED
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: charlieId } },
      error: null,
    });
    const patchRes = await PATCH(
      new NextRequest(
        `http://localhost/api/groups/${groupId}/expenses/eeee2222-2222-4222-8222-222222222222`,
        {
          method: "PATCH",
          body: JSON.stringify({
            description: "Attempt edit",
            category: "Groceries & Food",
            amount_cents: 5000,
          }),
        },
      ),
      {
        params: Promise.resolve({
          groupId,
          expenseId: "eeee2222-2222-4222-8222-222222222222",
        }),
      },
    );
    expect(patchRes.status).toBe(409);

    getUserMock.mockResolvedValueOnce({
      data: { user: { id: aliceId } },
      error: null,
    });
    const delRes = await DELETE(
      new NextRequest(
        `http://localhost/api/groups/${groupId}/expenses/eeee2222-2222-4222-8222-222222222222`,
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({
          groupId,
          expenseId: "eeee2222-2222-4222-8222-222222222222",
        }),
      },
    );
    expect(delRes.status).toBe(409);
  });

  it("locks entire 4-way expense (is_locked = true) for Charlie & Liam when Bob settles with Alice, while leaving unrelated expense unlocked", async () => {
    const { POST: postSettlement } = await import(
      "@/app/api/groups/[groupId]/settlements/route"
    );
    const { PATCH, DELETE } = await import(
      "@/app/api/groups/[groupId]/expenses/[expenseId]/route"
    );

    // Bob settles $30.00 with Alice
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: bobId } },
      error: null,
    });
    const settleRes = await postSettlement(
      new NextRequest(`http://localhost/api/groups/${groupId}/settlements`, {
        method: "POST",
        body: JSON.stringify({
          payer_id: bobId,
          recipient_id: aliceId,
          amount_cents: 3000,
          payment_rail: "VENMO",
        }),
      }),
      { params: Promise.resolve({ groupId }) },
    );
    expect(settleRes.status).toBe(201);

    // 4-way expense involving Alice & Bob is now locked in full; Charlie & Liam's separate expense stays unlocked
    expect(store.expenses[0].is_locked).toBe(true);
    expect(store.expenses[1].is_locked).toBe(false);

    // Charlie cannot edit or soft-delete the 4-way expense (409 EXPENSE_LOCKED)
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: charlieId } },
      error: null,
    });
    const charliePatch = await PATCH(
      new NextRequest(
        `http://localhost/api/groups/${groupId}/expenses/eeee1111-1111-4111-8111-111111111111`,
        {
          method: "PATCH",
          body: JSON.stringify({
            description: "Charlie tries edit",
            category: "Utilities",
            amount_cents: 10000,
          }),
        },
      ),
      {
        params: Promise.resolve({
          groupId,
          expenseId: "eeee1111-1111-4111-8111-111111111111",
        }),
      },
    );
    expect(charliePatch.status).toBe(409);

    getUserMock.mockResolvedValueOnce({
      data: { user: { id: charlieId } },
      error: null,
    });
    const charlieDel = await DELETE(
      new NextRequest(
        `http://localhost/api/groups/${groupId}/expenses/eeee1111-1111-4111-8111-111111111111`,
        { method: "DELETE" },
      ),
      {
        params: Promise.resolve({
          groupId,
          expenseId: "eeee1111-1111-4111-8111-111111111111",
        }),
      },
    );
    expect(charlieDel.status).toBe(409);
  });

  it("rejects Offsetting Adjustment on unlocked expense and allows negative Offsetting Adjustment on locked expense", async () => {
    const { POST: postExpense } = await import(
      "@/app/api/groups/[groupId]/expenses/route"
    );

    // Rejects adjustment targeting unlocked expense
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: charlieId } },
      error: null,
    });
    const unlockedAdjRes = await postExpense(
      new NextRequest(`http://localhost/api/groups/${groupId}/expenses`, {
        method: "POST",
        body: JSON.stringify({
          paid_by: charlieId,
          description: "Invalid adj",
          category: "Groceries & Food",
          amount_cents: -1000,
          adjustment_for_expense_id: "eeee2222-2222-4222-8222-222222222222",
        }),
      }),
      { params: Promise.resolve({ groupId }) },
    );
    expect(unlockedAdjRes.status).toBe(400);

    // Lock the 4-way expense
    store.expenses[0].is_locked = true;

    // Create -$40.00 offsetting adjustment referencing the locked 4-way expense
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: aliceId } },
      error: null,
    });
    const adjRes = await postExpense(
      new NextRequest(`http://localhost/api/groups/${groupId}/expenses`, {
        method: "POST",
        body: JSON.stringify({
          paid_by: aliceId,
          description: "Adjustment: 4-Way Utility Bill",
          category: "Utilities",
          amount_cents: -4000,
          split_method: "EQUAL",
          split_breakdown: [
            { user_id: aliceId, share_cents: -1000, percentage: 25 },
            { user_id: bobId, share_cents: -1000, percentage: 25 },
            { user_id: charlieId, share_cents: -1000, percentage: 25 },
            { user_id: liamId, share_cents: -1000, percentage: 25 },
          ],
          adjustment_for_expense_id: "eeee1111-1111-4111-8111-111111111111",
        }),
      }),
      { params: Promise.resolve({ groupId }) },
    );
    expect(adjRes.status).toBe(201);
    const adjJson = (await adjRes.json()) as {
      ok: boolean;
      expense: InMemoryExpenseRow;
    };
    expect(adjJson.expense.amount_cents).toBe(-4000);
    expect(adjJson.expense.adjustment_for_expense_id).toBe(
      "eeee1111-1111-4111-8111-111111111111",
    );

    // Verify net debt edge from Bob -> Alice is reduced from $30.00 to $20.00
    const edges = computePerGroupDebtEdges({
      group: {
        id: groupId,
        name: "Apt 4B",
        slug: "apt-4b",
        status: "ACTIVE",
        baseCurrency: "USD",
        defaultSplitMode: "EQUAL",
        simplifyDebts: false,
        operationalBudgetCents: null,
        billingCycleAnchorDay: 1,
        currentUserRole: "ADMIN",
        members: store.users.map((u) => ({
          userId: u.id,
          name: u.full_name,
          status: "ACTIVE",
          instantSettlementTag: null,
        })),
      },
      expenses: [store.expenses[0], adjJson.expense].map((e) => ({
        groupId: e.group_id,
        paidBy: e.paid_by,
        amountCents: e.amount_cents,
        splitBreakdown: e.split_breakdown,
      })),
      settlements: [],
    });
    const bobToAlice = edges.find(
      (edge) => edge.payerId === bobId && edge.recipientId === aliceId,
    );
    expect(bobToAlice?.amountCents).toBe(2000);
  });
});
