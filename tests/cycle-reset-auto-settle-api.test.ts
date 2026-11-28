import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeGroupMemberNetBalances } from "@/lib/expenses/debt-simplification";
import {
  buildCycleCloseReminderDedupeKey,
  getCycleClosingOnResetDate,
  getPreCloseReminderTarget,
  isCycleResetDay,
  runCycleResetAndReminders,
} from "@/lib/groups/cycle-reset";

const mockCreateClient = vi.fn();
const mockCreateAdminClient = vi.fn();
const mockHasSupabaseEnv = vi.fn(() => true);
const mockHasSupabaseAdminEnv = vi.fn(() => true);

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockCreateAdminClient(),
  hasSupabaseAdminEnv: () => mockHasSupabaseAdminEnv(),
}));

vi.mock("@/lib/auth/guards", () => ({
  hasSupabaseEnv: () => mockHasSupabaseEnv(),
}));

import { GET, POST } from "@/app/api/cron/cycle-reset/route";

interface MockDb {
  users: Array<{
    id: string;
    full_name: string;
    email: string;
    notification_prefs: Record<string, unknown>;
  }>;
  groups: Array<{
    id: string;
    name: string;
    status: "ACTIVE" | "NEEDS_RATIO_UPDATE" | "ARCHIVED";
    base_currency: string;
    billing_cycle_anchor_day: number;
    cycle_reset_day: number;
    auto_settle_on_reset: boolean;
    send_cycle_close_reminders: boolean;
  }>;
  group_members: Array<{
    group_id: string;
    user_id: string;
    role: "ADMIN" | "MEMBER";
    status: "ACTIVE" | "FORMER_MEMBER";
  }>;
  expenses: Array<{
    id: string;
    group_id: string;
    paid_by: string;
    amount_cents: number;
    expense_date: string;
    split_breakdown: Array<{ user_id: string; share_cents: number }>;
    is_locked: boolean;
    deleted_at: string | null;
  }>;
  settlements: Array<{
    id: string;
    group_id: string;
    payer_id: string;
    recipient_id: string;
    amount_cents: number;
    currency: string;
    payment_rail: string;
    settlement_handle_id: string | null;
    settled_at: string;
  }>;
  billing_cycles: Array<{
    id: string;
    group_id: string;
    period_start: string;
    period_end: string;
    status: "OPEN" | "CLOSED";
    closed_by: string | null;
    closed_at: string | null;
    created_at: string;
  }>;
  notifications: Array<{
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
    dedupe_key: string | null;
    is_read: boolean;
    created_at: string;
  }>;
  group_audit_logs: Array<{
    id: string;
    group_id: string;
    actor_id: string | null;
    event_type: string;
    summary: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
}

function createMockSupabase(
  db: MockDb,
  authUser: { id: string } | null = null,
) {
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

  function makeTable<T extends object>(tableName: keyof MockDb, rows: T[]) {
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

        // Enforce DB unique constraints in mock
        if (tableName === "billing_cycles") {
          for (const item of items) {
            const rec = item as Record<string, unknown>;
            const dup = db.billing_cycles.some(
              (bc) =>
                bc.group_id === rec.group_id &&
                bc.period_start === rec.period_start &&
                bc.period_end === rec.period_end,
            );
            if (dup) {
              const dupErr = {
                code: "23505",
                message: "duplicate key value violates unique constraint",
              };
              return {
                select: () => ({
                  maybeSingle: async () => ({ data: null, error: dupErr }),
                  then: (onFulfilled: (val: { data: null; error: typeof dupErr }) => unknown) =>
                    Promise.resolve({ data: null, error: dupErr }).then(onFulfilled),
                }),
                then: (onFulfilled: (val: { data: null; error: typeof dupErr }) => unknown) =>
                  Promise.resolve({ data: null, error: dupErr }).then(onFulfilled),
              };
            }
          }
        }

        if (tableName === "notifications") {
          for (const item of items) {
            const rec = item as Record<string, unknown>;
            if (
              typeof rec.dedupe_key === "string" &&
              db.notifications.some((n) => n.dedupe_key === rec.dedupe_key)
            ) {
              const dupErr = {
                code: "23505",
                message: "duplicate key value violates unique constraint idx_notifications_dedupe_key_uniq",
              };
              return {
                select: () => ({
                  maybeSingle: async () => ({ data: null, error: dupErr }),
                  then: (onFulfilled: (val: { data: null; error: typeof dupErr }) => unknown) =>
                    Promise.resolve({ data: null, error: dupErr }).then(onFulfilled),
                }),
                then: (onFulfilled: (val: { data: null; error: typeof dupErr }) => unknown) =>
                  Promise.resolve({ data: null, error: dupErr }).then(onFulfilled),
              };
            }
          }
        }

        const inserted = items.map((item, i) => {
          const rec = item as Record<string, unknown>;
          const stored = {
            id: rec.id ?? `${tableName}-${rows.length + i + 1}`,
            created_at: rec.created_at ?? new Date().toISOString(),
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
          then: (onFulfilled: (val: { data: T[]; error: null }) => unknown) =>
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
          select: () => ({
            maybeSingle: async () => {
              const { data } = await apply();
              return { data: data[0] ?? null, error: null };
            },
            then: (onFulfilled: (val: { data: T[]; error: null }) => unknown) =>
              apply().then(onFulfilled),
          }),
          then: (onFulfilled: (val: { data: T[]; error: null }) => unknown) =>
            apply().then(onFulfilled),
        };
        return builder;
      },
    };
  }

  return {
    auth: {
      getUser: async () => ({
        data: { user: authUser },
        error: null,
      }),
    },
    from: (table: keyof MockDb) => makeTable(table, db[table] as object[]),
  } as unknown as Parameters<typeof runCycleResetAndReminders>[0];
}

function createSeedDb(): MockDb {
  return {
    users: [
      {
        id: "u-alex",
        full_name: "Alex Rivera",
        email: "alex@example.com",
        notification_prefs: { cycle_close_reminder: true },
      },
      {
        id: "u-elena",
        full_name: "Elena Rostova",
        email: "elena@example.com",
        notification_prefs: { cycle_close_reminder: true },
      },
      {
        id: "u-marcus",
        full_name: "Marcus Vance",
        email: "marcus@example.com",
        notification_prefs: { cycle_close_reminder: false },
      },
    ],
    groups: [
      {
        id: "grp-auto",
        name: "Apartment 4B Shared",
        status: "ACTIVE",
        base_currency: "USD",
        billing_cycle_anchor_day: 1,
        cycle_reset_day: 1,
        auto_settle_on_reset: true,
        send_cycle_close_reminders: true,
      },
      {
        id: "grp-manual",
        name: "Weekend Cabin Crew",
        status: "ACTIVE",
        base_currency: "USD",
        billing_cycle_anchor_day: 1,
        cycle_reset_day: 1,
        auto_settle_on_reset: false,
        send_cycle_close_reminders: false,
      },
      {
        id: "grp-archived",
        name: "Old Trip Archive",
        status: "ARCHIVED",
        base_currency: "USD",
        billing_cycle_anchor_day: 1,
        cycle_reset_day: 1,
        auto_settle_on_reset: true,
        send_cycle_close_reminders: true,
      },
    ],
    group_members: [
      { group_id: "grp-auto", user_id: "u-alex", role: "ADMIN", status: "ACTIVE" },
      { group_id: "grp-auto", user_id: "u-elena", role: "MEMBER", status: "ACTIVE" },
      { group_id: "grp-auto", user_id: "u-marcus", role: "MEMBER", status: "ACTIVE" },
      { group_id: "grp-manual", user_id: "u-alex", role: "ADMIN", status: "ACTIVE" },
      { group_id: "grp-manual", user_id: "u-elena", role: "MEMBER", status: "ACTIVE" },
      { group_id: "grp-archived", user_id: "u-alex", role: "ADMIN", status: "ACTIVE" },
      { group_id: "grp-archived", user_id: "u-elena", role: "MEMBER", status: "ACTIVE" },
    ],
    expenses: [
      // grp-auto: Nov 2026 expenses -> net: Alex +6000, Elena +1000, Marcus -7000
      {
        id: "exp-auto-1",
        group_id: "grp-auto",
        paid_by: "u-alex",
        amount_cents: 9000,
        expense_date: "2026-11-10T12:00:00.000Z",
        split_breakdown: [
          { user_id: "u-alex", share_cents: 3000 },
          { user_id: "u-elena", share_cents: 3000 },
          { user_id: "u-marcus", share_cents: 3000 },
        ],
        is_locked: false,
        deleted_at: null,
      },
      {
        id: "exp-auto-2",
        group_id: "grp-auto",
        paid_by: "u-elena",
        amount_cents: 6000,
        expense_date: "2026-11-20T15:30:00.000Z",
        split_breakdown: [
          { user_id: "u-elena", share_cents: 2000 },
          { user_id: "u-marcus", share_cents: 4000 },
        ],
        is_locked: false,
        deleted_at: null,
      },
      // grp-auto: Dec 1 expense (belongs to NEXT cycle, must NOT be locked or auto-settled on Dec 1 reset!)
      {
        id: "exp-auto-next-cycle",
        group_id: "grp-auto",
        paid_by: "u-marcus",
        amount_cents: 3000,
        expense_date: "2026-12-01T00:05:00.000Z",
        split_breakdown: [
          { user_id: "u-alex", share_cents: 1000 },
          { user_id: "u-elena", share_cents: 1000 },
          { user_id: "u-marcus", share_cents: 1000 },
        ],
        is_locked: false,
        deleted_at: null,
      },
      // grp-manual: Nov 2026 expense (must stay unlocked & unsettled on Dec 1!)
      {
        id: "exp-manual-1",
        group_id: "grp-manual",
        paid_by: "u-alex",
        amount_cents: 10000,
        expense_date: "2026-11-18T18:00:00.000Z",
        split_breakdown: [
          { user_id: "u-alex", share_cents: 5000 },
          { user_id: "u-elena", share_cents: 5000 },
        ],
        is_locked: false,
        deleted_at: null,
      },
    ],
    settlements: [
      // Partial manual settlement in grp-auto: Marcus already paid Alex $10.00
      // Remaining open net in grp-auto through Nov 30: Alex +5000, Elena +1000, Marcus -6000
      {
        id: "set-manual-1",
        group_id: "grp-auto",
        payer_id: "u-marcus",
        recipient_id: "u-alex",
        amount_cents: 1000,
        currency: "USD",
        payment_rail: "VENMO",
        settlement_handle_id: null,
        settled_at: "2026-11-25T10:00:00.000Z",
      },
    ],
    billing_cycles: [],
    notifications: [],
    group_audit_logs: [],
  };
}

describe("Issue #116 — Cycle Reset Auto-Settle Engine & 48h Pre-Close Reminder Trigger", () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasSupabaseEnv.mockReturnValue(true);
    mockHasSupabaseAdminEnv.mockReturnValue(true);
    process.env.CRON_SECRET = "test-cron-secret-116";
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  describe("Date & cycle window math (UTC, month boundaries, leap years)", () => {
    it("computes closing cycle windows and 48h pre-close reminder dates accurately across month boundaries", () => {
      // Nov 29 is 48h before Dec 1 (resetDay = 1)
      expect(getPreCloseReminderTarget("2026-11-29", 1)).toEqual({
        periodStart: "2026-11-01",
        periodEnd: "2026-11-30",
        cycleSlug: "2026-11",
        resetDateIso: "2026-12-01",
      });
      expect(getPreCloseReminderTarget("2026-11-30", 1)).toBeNull();

      // Feb 27, 2026 (non-leap) is 48h before Mar 1
      expect(getPreCloseReminderTarget("2026-02-27", 1)).toEqual({
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
        cycleSlug: "2026-02",
        resetDateIso: "2026-03-01",
      });

      // Feb 28, 2028 (leap year) is 48h before Mar 1
      expect(getPreCloseReminderTarget("2028-02-28", 1)).toEqual({
        periodStart: "2028-02-01",
        periodEnd: "2028-02-29",
        cycleSlug: "2028-02",
        resetDateIso: "2028-03-01",
      });

      // Mid-month resetDay = 15: Nov 13 is 48h before Nov 15
      expect(getPreCloseReminderTarget("2026-11-13", 15)).toEqual({
        periodStart: "2026-10-15",
        periodEnd: "2026-11-14",
        cycleSlug: "2026-10",
        resetDateIso: "2026-11-15",
      });

      // Reset day detection & year rollover
      expect(isCycleResetDay("2027-01-01", 1)).toBe(true);
      expect(getCycleClosingOnResetDate("2027-01-01", 1)).toEqual({
        periodStart: "2026-12-01",
        periodEnd: "2026-12-31",
        cycleSlug: "2026-12",
        resetDateIso: "2027-01-01",
      });
    });
  });

  describe("48h pre-close reminder trigger (idempotent & policy-gated)", () => {
    it("emits CYCLE_CLOSE_REMINDER idempotently only for non-archived groups with send_cycle_close_reminders = true", async () => {
      const db = createSeedDb();
      const supabase = createMockSupabase(db);

      // Run 1: 2026-11-29 (48h before 2026-12-01 reset)
      const firstRun = await runCycleResetAndReminders(supabase, {
        runDate: "2026-11-29",
        nowIso: "2026-11-29T00:00:00.000Z",
      });
      expect(firstRun.ok).toBe(true);
      if (!firstRun.ok) return;

      // Only grp-auto & grp-manual are active (grp-archived excluded)
      expect(firstRun.summary.evaluatedGroups).toBe(2);
      expect(firstRun.summary.reminderGroupsNotified).toBe(1);
      expect(firstRun.summary.reminderGroupsSkippedDisabled).toBe(1);
      // Alex & Elena get reminders in grp-auto; Marcus opted out via notification_prefs.cycle_close_reminder = false
      expect(firstRun.summary.remindersSent).toBe(2);
      expect(firstRun.summary.cyclesClosed).toBe(0);
      expect(firstRun.summary.autoSettlementsCreated).toBe(0);

      expect(db.notifications).toHaveLength(2);
      expect(db.notifications.map((n) => n.user_id).sort()).toEqual([
        "u-alex",
        "u-elena",
      ]);
      for (const notif of db.notifications) {
        expect(notif.type).toBe("CYCLE_CLOSE_REMINDER");
        expect(notif.group_id).toBe("grp-auto");
        expect(notif.actor_id).toBeNull();
        expect(notif.title).toBe("Billing cycle closes in 48 hours");
        expect(notif.description).toContain("2026-12-01");
        expect(notif.dedupe_key).toBe(
          buildCycleCloseReminderDedupeKey("grp-auto", "2026-11-30", notif.user_id),
        );
      }

      // grp-manual (send_cycle_close_reminders = false) received zero notifications
      expect(
        db.notifications.filter((n) => n.group_id === "grp-manual"),
      ).toHaveLength(0);
      // grp-archived received zero notifications
      expect(
        db.notifications.filter((n) => n.group_id === "grp-archived"),
      ).toHaveLength(0);

      // Run 2 (same day — idempotency check): zero duplicate notifications created
      const secondRun = await runCycleResetAndReminders(supabase, {
        runDate: "2026-11-29",
        nowIso: "2026-11-29T06:00:00.000Z",
      });
      expect(secondRun.ok).toBe(true);
      if (!secondRun.ok) return;

      expect(secondRun.summary.remindersSent).toBe(0);
      expect(secondRun.summary.reminderGroupsSkippedAlreadySent).toBe(1);
      expect(db.notifications).toHaveLength(2);
    });
  });

  describe("Cycle reset auto-close & AUTO_SETTLED settlement generation", () => {
    it("closes BillingCycle, locks period expenses, generates AUTO_SETTLED settlements, is idempotent, and leaves manual-close groups open", async () => {
      const db = createSeedDb();
      const supabase = createMockSupabase(db);

      // Run 1: 2026-12-01 (cycle_reset_day = 1)
      const firstRun = await runCycleResetAndReminders(supabase, {
        runDate: "2026-12-01",
        nowIso: "2026-12-01T00:00:00.000Z",
      });
      expect(firstRun.ok).toBe(true);
      if (!firstRun.ok) return;

      expect(firstRun.summary.evaluatedGroups).toBe(2);
      expect(firstRun.summary.cyclesClosed).toBe(1);
      expect(firstRun.summary.manualGroupsLeftOpen).toBe(1);
      expect(firstRun.summary.lockedExpenses).toBe(2);
      // Open balances in grp-auto through Nov 30: Alex +5000, Elena +1000, Marcus -6000
      // Simplified pairwise transfers: Marcus -> Alex ($50.00), Marcus -> Elena ($10.00)
      expect(firstRun.summary.autoSettlementsCreated).toBe(2);
      expect(firstRun.summary.autoSettledTotalCents).toBe(6000);

      // Verify BillingCycle row for grp-auto
      const autoCycles = db.billing_cycles.filter(
        (bc) => bc.group_id === "grp-auto",
      );
      expect(autoCycles).toHaveLength(1);
      expect(autoCycles[0]).toMatchObject({
        group_id: "grp-auto",
        period_start: "2026-11-01",
        period_end: "2026-11-30",
        status: "CLOSED",
        closed_by: null,
        closed_at: "2026-12-01T00:00:00.000Z",
      });

      // Verify period expenses in grp-auto are locked, while Dec 1 expense remains unlocked
      expect(db.expenses.find((e) => e.id === "exp-auto-1")?.is_locked).toBe(true);
      expect(db.expenses.find((e) => e.id === "exp-auto-2")?.is_locked).toBe(true);
      expect(
        db.expenses.find((e) => e.id === "exp-auto-next-cycle")?.is_locked,
      ).toBe(false);

      // Verify AUTO_SETTLED settlement records
      const autoSettlements = db.settlements.filter(
        (s) => s.payment_rail === "AUTO_SETTLED",
      );
      expect(autoSettlements).toHaveLength(2);
      expect(autoSettlements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            group_id: "grp-auto",
            payer_id: "u-marcus",
            recipient_id: "u-alex",
            amount_cents: 5000,
            currency: "USD",
            payment_rail: "AUTO_SETTLED",
            settlement_handle_id: null,
          }),
          expect.objectContaining({
            group_id: "grp-auto",
            payer_id: "u-marcus",
            recipient_id: "u-elena",
            amount_cents: 1000,
            currency: "USD",
            payment_rail: "AUTO_SETTLED",
            settlement_handle_id: null,
          }),
        ]),
      );

      // Verify post-auto-settle net balances through Nov 30 are strictly $0.00 for every member
      const postNet = computeGroupMemberNetBalances({
        groupId: "grp-auto",
        memberIds: ["u-alex", "u-elena", "u-marcus"],
        expenses: db.expenses
          .filter((e) => e.group_id === "grp-auto" && e.expense_date <= "2026-11-30T23:59:59.999Z")
          .map((e) => ({
            groupId: e.group_id,
            paidBy: e.paid_by,
            amountCents: e.amount_cents,
            splitBreakdown: e.split_breakdown,
          })),
        settlements: db.settlements
          .filter((s) => s.group_id === "grp-auto")
          .map((s) => ({
            groupId: s.group_id,
            payerId: s.payer_id,
            recipientId: s.recipient_id,
            amountCents: s.amount_cents,
          })),
      });
      expect(postNet.get("u-alex")).toBe(0);
      expect(postNet.get("u-elena")).toBe(0);
      expect(postNet.get("u-marcus")).toBe(0);

      // Verify manual-close group (grp-manual) remained completely open & unsettled
      expect(
        db.billing_cycles.filter((bc) => bc.group_id === "grp-manual"),
      ).toHaveLength(0);
      expect(db.expenses.find((e) => e.id === "exp-manual-1")?.is_locked).toBe(
        false,
      );
      expect(
        db.settlements.filter((s) => s.group_id === "grp-manual"),
      ).toHaveLength(0);

      // Verify audit log recorded BILLING_CYCLE_CLOSED for grp-auto only
      expect(db.group_audit_logs).toHaveLength(1);
      expect(db.group_audit_logs[0]).toMatchObject({
        group_id: "grp-auto",
        actor_id: null,
        event_type: "BILLING_CYCLE_CLOSED",
      });

      // Run 2 (idempotency check on same reset day): zero duplicate settlements or audit logs
      const secondRun = await runCycleResetAndReminders(supabase, {
        runDate: "2026-12-01",
        nowIso: "2026-12-01T01:00:00.000Z",
      });
      expect(secondRun.ok).toBe(true);
      if (!secondRun.ok) return;

      expect(secondRun.summary.cyclesClosed).toBe(0);
      expect(secondRun.summary.cyclesAlreadyClosed).toBe(1);
      expect(secondRun.summary.manualGroupsLeftOpen).toBe(1);
      expect(secondRun.summary.autoSettlementsCreated).toBe(0);
      expect(
        db.settlements.filter((s) => s.payment_rail === "AUTO_SETTLED"),
      ).toHaveLength(2);
      expect(db.group_audit_logs).toHaveLength(1);
    });
  });

  describe("/api/cron/cycle-reset HTTP endpoint auth & routing", () => {
    it("rejects invalid CRON_SECRET bearer token with 401 and invalid date with 400", async () => {
      const badAuthReq = new NextRequest(
        "http://localhost:3000/api/cron/cycle-reset?date=2026-12-01",
        {
          method: "GET",
          headers: { authorization: "Bearer wrong-secret" },
        },
      );
      const badAuthRes = await GET(badAuthReq);
      expect(badAuthRes.status).toBe(401);

      const badDateReq = new NextRequest(
        "http://localhost:3000/api/cron/cycle-reset?date=2026-02-30",
        {
          method: "GET",
          headers: { authorization: "Bearer test-cron-secret-116" },
        },
      );
      const badDateRes = await GET(badDateReq);
      expect(badDateRes.status).toBe(400);
    });

    it("executes via GET with valid CRON_SECRET bearer token and via POST for authenticated group ADMIN", async () => {
      const db = createSeedDb();
      mockCreateAdminClient.mockReturnValue(createMockSupabase(db));

      // Cron GET on 48h pre-close reminder day
      const cronReq = new NextRequest(
        "http://localhost:3000/api/cron/cycle-reset?date=2026-11-29",
        {
          method: "GET",
          headers: { authorization: "Bearer test-cron-secret-116" },
        },
      );
      const cronRes = await GET(cronReq);
      expect(cronRes.status).toBe(200);
      const cronBody = (await cronRes.json()) as {
        ok: boolean;
        remindersSent: number;
      };
      expect(cronBody.ok).toBe(true);
      expect(cronBody.remindersSent).toBe(2);

      // Non-admin MEMBER attempting POST for grp-auto -> 403 Forbidden
      mockCreateClient.mockResolvedValue(
        createMockSupabase(db, { id: "u-elena" }),
      );
      const memberReq = new NextRequest(
        "http://localhost:3000/api/cron/cycle-reset",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ date: "2026-12-01", group_id: "grp-auto" }),
        },
      );
      const memberRes = await POST(memberReq);
      expect(memberRes.status).toBe(403);

      // Active ADMIN executing POST for grp-auto on reset day -> 200 OK
      mockCreateClient.mockResolvedValue(
        createMockSupabase(db, { id: "u-alex" }),
      );
      const adminReq = new NextRequest(
        "http://localhost:3000/api/cron/cycle-reset",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ date: "2026-12-01", group_id: "grp-auto" }),
        },
      );
      const adminRes = await POST(adminReq);
      expect(adminRes.status).toBe(200);
      const adminBody = (await adminRes.json()) as {
        ok: boolean;
        cyclesClosed: number;
        autoSettlementsCreated: number;
      };
      expect(adminBody.ok).toBe(true);
      expect(adminBody.cyclesClosed).toBe(1);
      expect(adminBody.autoSettlementsCreated).toBe(2);
    });
  });

  describe("SQL migration & Vercel Cron configuration", () => {
    it("adds CYCLE_CLOSE_REMINDER and dedupe_key unique index in migration and schedules /api/cron/cycle-reset", () => {
      const migrationSql = fs.readFileSync(
        path.resolve(
          __dirname,
          "../supabase/migrations/20261129000001_cycle_reset_notifications_idempotency.sql",
        ),
        "utf8",
      );
      expect(migrationSql).toContain("'CYCLE_CLOSE_REMINDER'");
      expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS dedupe_key TEXT/i);
      expect(migrationSql).toMatch(
        /CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_key_uniq/i,
      );

      const vercelJson = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, "../vercel.json"), "utf8"),
      ) as { crons: Array<{ path: string; schedule: string }> };
      expect(vercelJson.crons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "/api/cron/cycle-reset" }),
        ]),
      );
    });
  });
});
