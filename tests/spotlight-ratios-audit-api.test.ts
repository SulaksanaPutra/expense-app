import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignedInviteToken } from "@/lib/groups/invite-token";
import { buildDefaultSplitBreakdownFromGroup } from "@/lib/groups/invite-utils";

const getUserMock = vi.fn();

interface InMemoryUserRow {
  id: string;
  email: string;
  full_name: string;
}

interface InMemoryGroupRow {
  id: string;
  name: string;
  slug: string;
  group_type: "RESIDENTIAL" | "TRIP" | "RECURRING";
  status: "ACTIVE" | "NEEDS_RATIO_UPDATE" | "ARCHIVED";
  base_currency: string;
  default_split_mode: "EQUAL" | "CUSTOM_RATIOS";
  invite_token: string;
  invite_token_version: number;
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
  amount_cents: number;
  split_breakdown: Array<{ user_id: string; share_cents: number; percentage?: number }>;
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

interface InMemoryAuditLogRow {
  id: string;
  group_id: string;
  actor_id: string | null;
  event_type: string;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface InMemoryDb {
  users: InMemoryUserRow[];
  groups: InMemoryGroupRow[];
  group_members: InMemoryMemberRow[];
  expenses: InMemoryExpenseRow[];
  settlements: InMemorySettlementRow[];
  group_audit_logs: InMemoryAuditLogRow[];
}

function createInMemorySupabase(db: InMemoryDb) {
  function filterRows<T extends object>(
    rows: T[],
    filters: Array<{ col: string; val: unknown; op: "eq" | "in" }>,
  ): T[] {
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

  return {
    auth: {
      getUser: getUserMock,
    },
    from: (table: keyof InMemoryDb) => {
      if (table === "users") {
        return {
          select: () => {
            const filters: Array<{ col: string; val: unknown; op: "eq" | "in" }> = [];
            const execute = async () => ({
              data: filterRows(db.users, filters).map((u) => ({ ...u })),
              error: null,
            });
            const builder = {
              eq: (col: string, val: unknown) => {
                filters.push({ col, val, op: "eq" });
                return builder;
              },
              in: (col: string, val: unknown[]) => {
                filters.push({ col, val, op: "in" });
                return execute();
              },
              then: (onFulfilled: (val: { data: InMemoryUserRow[]; error: null }) => unknown) =>
                execute().then(onFulfilled),
            };
            return builder;
          },
          upsert: vi.fn(async (row: InMemoryUserRow) => {
            if (!db.users.some((u) => u.id === row.id)) {
              db.users.push({ ...row });
            }
            return { error: null };
          }),
        };
      }

      if (table === "groups") {
        return {
          select: () => {
            const filters: Array<{ col: string; val: unknown; op: "eq" | "in" }> = [];
            const builder = {
              eq: (col: string, val: unknown) => {
                filters.push({ col, val, op: "eq" });
                return builder;
              },
              maybeSingle: async () => {
                const matched = filterRows(db.groups, filters)[0] ?? null;
                return {
                  data: matched ? { ...matched } : null,
                  error: null,
                };
              },
            };
            return builder;
          },
          update: (patch: Partial<InMemoryGroupRow>) => ({
            eq: async (col: string, val: unknown) => {
              for (const row of db.groups) {
                if ((row as unknown as Record<string, unknown>)[col] === val) {
                  Object.assign(row, patch);
                }
              }
              return { error: null };
            },
          }),
        };
      }

      if (table === "group_members") {
        return {
          select: () => {
            const filters: Array<{ col: string; val: unknown; op: "eq" | "in" }> = [];
            const execute = async () => ({
              data: filterRows(db.group_members, filters).map((r) => ({ ...r })),
              error: null,
            });
            const builder = {
              eq: (col: string, val: unknown) => {
                filters.push({ col, val, op: "eq" });
                return builder;
              },
              order: async () => {
                const sorted = filterRows(db.group_members, filters)
                  .slice()
                  .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
                  .map((r) => ({ ...r }));
                return { data: sorted, error: null };
              },
              maybeSingle: async () => {
                const matched = filterRows(db.group_members, filters)[0] ?? null;
                return {
                  data: matched ? { ...matched } : null,
                  error: null,
                };
              },
              then: (onFulfilled: (val: { data: InMemoryMemberRow[]; error: null }) => unknown) =>
                execute().then(onFulfilled),
            };
            return builder;
          },
          insert: async (row: Omit<InMemoryMemberRow, "joined_at">) => {
            db.group_members.push({
              ...row,
              joined_at: new Date(
                Date.UTC(2026, 10, 26, 0, 0, db.group_members.length + 1),
              ).toISOString(),
            });
            return { error: null };
          },
          update: (patch: Partial<InMemoryMemberRow>) => {
            const filters: Array<{ col: string; val: unknown; op: "eq" | "in" }> = [];
            const builder = {
              eq: (col: string, val: unknown) => {
                filters.push({ col, val, op: "eq" });
                return builder;
              },
              then: (onFulfilled: (val: { error: null }) => unknown) => {
                for (const row of filterRows(db.group_members, filters)) {
                  Object.assign(row, patch);
                }
                return Promise.resolve({ error: null }).then(onFulfilled);
              },
            };
            return builder;
          },
        };
      }

      if (table === "settlements") {
        return {
          select: () => {
            const filters: Array<{ col: string; val: unknown; op: "eq" | "in" }> = [];
            const builder = {
              eq: (col: string, val: unknown) => {
                filters.push({ col, val, op: "eq" });
                return builder;
              },
              order: async () => {
                const sorted = filterRows(db.settlements, filters)
                  .slice()
                  .sort((a, b) => b.settled_at.localeCompare(a.settled_at));
                return { data: sorted, error: null };
              },
            };
            return builder;
          },
        };
      }

      if (table === "group_audit_logs") {
        return {
          select: () => {
            const filters: Array<{ col: string; val: unknown; op: "eq" | "in" }> = [];
            const builder = {
              eq: (col: string, val: unknown) => {
                filters.push({ col, val, op: "eq" });
                return builder;
              },
              order: async () => {
                const sorted = filterRows(db.group_audit_logs, filters)
                  .slice()
                  .sort((a, b) => b.created_at.localeCompare(a.created_at));
                return { data: sorted, error: null };
              },
            };
            return builder;
          },
          insert: (row: InMemoryAuditLogRow) => {
            const stored = { ...row };
            db.group_audit_logs.push(stored);
            return {
              select: () => ({
                maybeSingle: async () => ({ data: { ...stored }, error: null }),
              }),
              then: (onFulfilled: (val: { error: null }) => unknown) =>
                Promise.resolve({ error: null }).then(onFulfilled),
            };
          },
        };
      }

      return {};
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

import { GET as auditLogGet } from "@/app/api/groups/[groupId]/audit-log/route";
import { POST as regeneratePost } from "@/app/api/groups/[groupId]/invite/regenerate/route";
import { PATCH as ratiosPatch } from "@/app/api/groups/[groupId]/ratios/route";
import { POST as joinPost } from "@/app/api/groups/join/route";

describe("Edit Ratios Authorization, Snapshot Immutability & Audit Log API", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-123";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-xyz";
    getUserMock.mockReset();

    const token = createSignedInviteToken({
      groupId: "grp-apt4b",
      slug: "apt-4b",
      version: 1,
    });

    activeDb = {
      users: [
        { id: "u-admin", email: "alex@example.com", full_name: "Alex Rivera" },
        { id: "u-member", email: "elena@example.com", full_name: "Elena Rostova" },
        { id: "u-new", email: "samira@example.com", full_name: "Samira Patel" },
      ],
      groups: [
        {
          id: "grp-apt4b",
          name: "Apt 4B Roommates",
          slug: "apt-4b",
          group_type: "RESIDENTIAL",
          status: "NEEDS_RATIO_UPDATE",
          base_currency: "USD",
          default_split_mode: "CUSTOM_RATIOS",
          invite_token: token,
          invite_token_version: 1,
        },
      ],
      group_members: [
        {
          group_id: "grp-apt4b",
          user_id: "u-admin",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 60,
          joined_at: "2026-10-01T00:00:00.000Z",
        },
        {
          group_id: "grp-apt4b",
          user_id: "u-member",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 40,
          joined_at: "2026-10-02T00:00:00.000Z",
        },
        {
          group_id: "grp-apt4b",
          user_id: "u-new",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 0,
          joined_at: "2026-11-20T00:00:00.000Z",
        },
      ],
      expenses: [
        {
          id: "exp-hist-1",
          group_id: "grp-apt4b",
          amount_cents: 10000,
          split_breakdown: [
            { user_id: "u-admin", share_cents: 6000, percentage: 60 },
            { user_id: "u-member", share_cents: 4000, percentage: 40 },
          ],
        },
      ],
      settlements: [
        {
          id: "set-1",
          group_id: "grp-apt4b",
          payer_id: "u-member",
          recipient_id: "u-admin",
          amount_cents: 2500,
          currency: "USD",
          payment_rail: "VENMO",
          settled_at: "2026-11-10T10:00:00.000Z",
        },
      ],
      group_audit_logs: [],
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
  });

  it("enforces ADMIN-only Edit Ratios, rejects totals != 100%, clears NEEDS_RATIO_UPDATE, and keeps historical Expense.split_breakdown snapshots untouched", async () => {
    const historicalSnapshotBefore = structuredClone(
      activeDb.expenses[0].split_breakdown,
    );

    // 1. MEMBER is rejected with 403 and cannot mutate ratios or write audit logs
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-member", email: "elena@example.com" } },
      error: null,
    });
    const memberRes = await ratiosPatch(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/ratios", {
        method: "PATCH",
        body: JSON.stringify({
          default_split_mode: "CUSTOM_RATIOS",
          allocations: [
            { user_id: "u-admin", share_percentage: 50 },
            { user_id: "u-member", share_percentage: 30 },
            { user_id: "u-new", share_percentage: 20 },
          ],
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(memberRes.status).toBe(403);
    expect(activeDb.groups[0].status).toBe("NEEDS_RATIO_UPDATE");
    expect(activeDb.group_audit_logs).toHaveLength(0);

    // 2. ADMIN submitting custom ratios totaling 95% (sum != 100%) is rejected with 400
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const invalidSumRes = await ratiosPatch(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/ratios", {
        method: "PATCH",
        body: JSON.stringify({
          default_split_mode: "CUSTOM_RATIOS",
          allocations: [
            { user_id: "u-admin", share_percentage: 50 },
            { user_id: "u-member", share_percentage: 30 },
            { user_id: "u-new", share_percentage: 15 },
          ],
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(invalidSumRes.status).toBe(400);
    const invalidPayload = await invalidSumRes.json();
    expect(invalidPayload.error).toMatch(/100\.00%/);
    expect(activeDb.groups[0].status).toBe("NEEDS_RATIO_UPDATE");
    expect(activeDb.group_audit_logs).toHaveLength(0);

    // 3. ADMIN submitting valid 100.00% custom ratios succeeds, clears NEEDS_RATIO_UPDATE, and records audit log
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const validRes = await ratiosPatch(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/ratios", {
        method: "PATCH",
        body: JSON.stringify({
          default_split_mode: "CUSTOM_RATIOS",
          allocations: [
            { user_id: "u-admin", share_percentage: 50 },
            { user_id: "u-member", share_percentage: 30 },
            { user_id: "u-new", share_percentage: 20 },
          ],
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(validRes.status).toBe(200);
    const validPayload = await validRes.json();
    expect(validPayload.groupStatus).toBe("ACTIVE");
    expect(validPayload.defaultSplitMode).toBe("CUSTOM_RATIOS");
    expect(validPayload.auditEntry).toBeDefined();
    expect(validPayload.auditEntry.eventType).toBe("NEEDS_RATIO_UPDATE_CLEARED");

    // Verify group & member ratios updated
    expect(activeDb.groups[0].status).toBe("ACTIVE");
    expect(
      activeDb.group_members.find((m) => m.user_id === "u-admin")?.share_percentage,
    ).toBe(50);
    expect(
      activeDb.group_members.find((m) => m.user_id === "u-member")?.share_percentage,
    ).toBe(30);
    expect(
      activeDb.group_members.find((m) => m.user_id === "u-new")?.share_percentage,
    ).toBe(20);

    // 4. Historical Expense.split_breakdown snapshot remains completely untouched
    expect(activeDb.expenses[0].split_breakdown).toEqual(historicalSnapshotBefore);

    // 5. Future expenses computed from updated group config use the new 50/30/20 ratios
    const futureBreakdown = buildDefaultSplitBreakdownFromGroup({
      amountCents: 10001,
      paidBy: "u-admin",
      defaultSplitMode: activeDb.groups[0].default_split_mode,
      activeMembers: activeDb.group_members.map((m) => ({
        userId: m.user_id,
        sharePercentage: m.share_percentage,
      })),
    });
    expect(futureBreakdown).toEqual([
      { user_id: "u-admin", share_cents: 5001, percentage: 50 },
      { user_id: "u-member", share_cents: 3000, percentage: 30 },
      { user_id: "u-new", share_cents: 2000, percentage: 20 },
    ]);
    expect(
      futureBreakdown.reduce((sum, item) => sum + item.share_cents, 0),
    ).toBe(10001);
  });

  it("records ratio updates, invite regenerations, and member joins in the audit log API and enforces membership isolation", async () => {
    // 1. Admin regenerates invite link
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const regenRes = await regeneratePost(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-apt4b/invite/regenerate",
        { method: "POST" },
      ),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(regenRes.status).toBe(200);
    const regenPayload = await regenRes.json();

    // 2. New 4th member joins using regenerated link
    getUserMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "u-4th",
          email: "liam@example.com",
          user_metadata: { full_name: "Liam Chen" },
        },
      },
      error: null,
    });
    const joinRes = await joinPost(
      new NextRequest("http://localhost:3000/api/groups/join", {
        method: "POST",
        body: JSON.stringify({
          slug: "apt-4b",
          token: regenPayload.inviteToken,
        }),
      }),
    );
    expect(joinRes.status).toBe(200);

    // 3. Admin switches group to EQUAL mode (4 active members -> 25% each)
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-admin", email: "alex@example.com" } },
      error: null,
    });
    const equalRes = await ratiosPatch(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/ratios", {
        method: "PATCH",
        body: JSON.stringify({
          default_split_mode: "EQUAL",
          allocations: [],
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(equalRes.status).toBe(200);

    // 4. Non-member cannot read audit log -> 403
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-outsider", email: "stranger@example.com" } },
      error: null,
    });
    const outsiderRes = await auditLogGet(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/audit-log"),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(outsiderRes.status).toBe(403);

    // 5. Group MEMBER can read audit log -> 200 with ratio, governance, and settlement events
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u-member", email: "elena@example.com" } },
      error: null,
    });
    const memberAuditRes = await auditLogGet(
      new NextRequest("http://localhost:3000/api/groups/grp-apt4b/audit-log"),
      { params: Promise.resolve({ groupId: "grp-apt4b" }) },
    );
    expect(memberAuditRes.status).toBe(200);
    const auditPayload = await memberAuditRes.json();

    expect(auditPayload.entries.length).toBeGreaterThanOrEqual(4);
    const eventTypes = auditPayload.entries.map(
      (e: { eventType: string }) => e.eventType,
    );
    expect(eventTypes).toContain("INVITE_LINK_REGENERATED");
    expect(eventTypes).toContain("MEMBER_JOINED");
    expect(eventTypes).toContain("NEEDS_RATIO_UPDATE_CLEARED");
    expect(eventTypes).toContain("SETTLEMENT_RECORDED");
  });
});
