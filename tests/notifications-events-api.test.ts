import { describe, expect, it } from "vitest";
import { runArchiveRulesEvaluation } from "@/lib/groups/archive";
import {
  createGroupExpense,
  createGroupSettlement,
} from "@/lib/groups/ledger-guards";

interface MockDb {
  users: Array<{
    id: string;
    full_name: string;
    email: string;
    notification_prefs: Record<string, unknown>;
  }>;
  groups: Array<Record<string, unknown>>;
  group_members: Array<{
    group_id: string;
    user_id: string;
    role: "ADMIN" | "MEMBER";
    status: "ACTIVE" | "FORMER_MEMBER";
    share_percentage: number;
    joined_at: string;
  }>;
  expenses: Array<Record<string, unknown>>;
  settlements: Array<Record<string, unknown>>;
  billing_cycles: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  group_audit_logs: Array<Record<string, unknown>>;
}

function createMockSupabase(db: MockDb) {
  type Filter = { op: "eq" | "neq" | "in" | "is"; col: string; val: unknown };

  function applyFilters<T extends object>(rows: T[], filters: Filter[]): T[] {
    return rows.filter((row) =>
      filters.every((f) => {
        const val = (row as Record<string, unknown>)[f.col];
        if (f.op === "eq") return val === f.val;
        if (f.op === "neq") return val !== f.val;
        if (f.op === "is") return val === f.val;
        if (f.op === "in" && Array.isArray(f.val)) return f.val.includes(val);
        return true;
      }),
    );
  }

  function makeTable<T extends object>(rows: T[], prefix: string) {
    return {
      select: () => {
        const filters: Filter[] = [];
        const run = async () => ({
          data: applyFilters(rows, filters).map((r) => ({ ...r })),
          error: null,
        });
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
          order: () => builder,
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
        const inserted = items.map((item, i) => {
          const rec = item as Record<string, unknown>;
          const stored = {
            id: rec.id ?? `${prefix}-${rows.length + i + 1}`,
            created_at: rec.created_at ?? new Date().toISOString(),
            settled_at: rec.settled_at ?? new Date().toISOString(),
            is_locked: rec.is_locked ?? false,
            deleted_at: rec.deleted_at ?? null,
            ...rec,
          } as unknown as T;
          rows.push(stored);
          return { ...stored };
        });

        return {
          select: () => ({
            maybeSingle: async () => ({ data: inserted[0] ?? null, error: null }),
            then: (onFulfilled: (val: { data: T[]; error: null }) => unknown) =>
              Promise.resolve({ data: inserted, error: null }).then(onFulfilled),
          }),
          then: (onFulfilled: (val: { data: T[]; error: null; error2?: null }) => unknown) =>
            Promise.resolve({ data: inserted, error: null }).then(onFulfilled),
        };
      },
      update: (patch: Partial<T>) => {
        const filters: Filter[] = [];
        const apply = async () => {
          const matched = applyFilters(rows, filters);
          for (const item of matched) Object.assign(item, patch);
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
          then: (onFulfilled: (val: { error: null }) => unknown) =>
            apply().then(() => onFulfilled({ error: null })),
        };
        return builder;
      },
    };
  }

  return {
    from: (table: keyof MockDb) => makeTable(db[table] as object[], table),
  } as unknown as Parameters<typeof createGroupExpense>[0];
}

describe("Notification persistence for NEW_EXPENSE, SETTLEMENT_CONFIRMATION, and LEASE_ARCHIVE_PROMPT", () => {
  it("persists NEW_EXPENSE and SETTLEMENT_CONFIRMATION respecting user notification_prefs", async () => {
    const db: MockDb = {
      users: [
        {
          id: "u-alex",
          full_name: "Alex Rivera",
          email: "alex@example.com",
          notification_prefs: {
            new_expense: true,
            settlement_confirmation: true,
          },
        },
        {
          id: "u-elena",
          full_name: "Elena Rostova",
          email: "elena@example.com",
          notification_prefs: {
            new_expense: true,
            settlement_confirmation: true,
          },
        },
        {
          id: "u-marcus",
          full_name: "Marcus Vance",
          email: "marcus@example.com",
          notification_prefs: {
            new_expense: false,
            settlement_confirmation: false,
          },
        },
      ],
      groups: [
        {
          id: "grp-apt4b",
          name: "Apt 4B",
          group_type: "RESIDENTIAL",
          status: "ACTIVE",
          base_currency: "USD",
          default_split_mode: "EQUAL",
          billing_cycle_anchor_day: 1,
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
      settlements: [],
      billing_cycles: [],
      notifications: [],
      group_audit_logs: [],
    };

    const supabase = createMockSupabase(db);

    const expRes = await createGroupExpense(supabase, {
      groupId: "grp-apt4b",
      userId: "u-alex",
      description: "Trader Joe's",
      category: "Groceries",
      amountCents: 9000,
      expenseDate: "2026-11-15T12:00:00.000Z",
    });
    expect(expRes.ok).toBe(true);

    // Only Elena gets NEW_EXPENSE (Alex is actor, Marcus opted out via new_expense: false)
    expect(db.notifications).toHaveLength(1);
    expect(db.notifications[0]).toMatchObject({
      user_id: "u-elena",
      type: "NEW_EXPENSE",
      title: "New Expense Logged",
      delta_cents: 3000,
      currency: "USD",
      is_read: false,
    });
    expect(String(db.notifications[0].description)).toContain("Trader Joe's");

    const setRes = await createGroupSettlement(supabase, {
      groupId: "grp-apt4b",
      userId: "u-elena",
      payerId: "u-elena",
      recipientId: "u-alex",
      amountCents: 3000,
      paymentRail: "VENMO",
    });
    expect(setRes.ok).toBe(true);

    // Alex receives SETTLEMENT_CONFIRMATION
    const settlementNotifs = db.notifications.filter(
      (n) => n.type === "SETTLEMENT_CONFIRMATION",
    );
    expect(settlementNotifs).toHaveLength(1);
    expect(settlementNotifs[0]).toMatchObject({
      user_id: "u-alex",
      type: "SETTLEMENT_CONFIRMATION",
      title: "Settlement confirmed",
      delta_cents: 3000,
      currency: "USD",
      is_read: false,
    });
  });

  it("persists deduplicated LEASE_ARCHIVE_PROMPT notifications for residential group admins", async () => {
    const db: MockDb = {
      users: [],
      groups: [
        {
          id: "grp-res",
          name: "Elm St Apt",
          group_type: "RESIDENTIAL",
          status: "ACTIVE",
          billing_cycle_anchor_day: 1,
          lease_end_date: "2026-10-31",
          trip_auto_archive_enabled: true,
          trip_auto_archive_days: 14,
          residential_lease_prompt_enabled: true,
          zero_balance_since: null,
          lease_prompt_snoozed_until: null,
        },
      ],
      group_members: [
        {
          group_id: "grp-res",
          user_id: "u-admin",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2026-01-01T00:00:00.000Z",
        },
        {
          group_id: "grp-res",
          user_id: "u-member",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2026-01-02T00:00:00.000Z",
        },
      ],
      expenses: [],
      settlements: [],
      billing_cycles: [],
      notifications: [],
      group_audit_logs: [],
    };

    const supabase = createMockSupabase(db) as unknown as Parameters<
      typeof runArchiveRulesEvaluation
    >[0];
    const now = new Date("2026-11-15T12:00:00.000Z");

    const first = await runArchiveRulesEvaluation(supabase, now);
    expect(first.ok).toBe(true);
    expect(db.notifications).toHaveLength(1);
    expect(db.notifications[0]).toMatchObject({
      user_id: "u-admin",
      group_id: "grp-res",
      type: "LEASE_ARCHIVE_PROMPT",
      title: "Lease archive prompt",
      is_read: false,
    });

    // Second evaluation does not create duplicate unread notification
    const second = await runArchiveRulesEvaluation(supabase, now);
    expect(second.ok).toBe(true);
    expect(db.notifications).toHaveLength(1);
  });
});
