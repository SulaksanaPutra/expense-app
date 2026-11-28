import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, hasSupabaseEnvMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  hasSupabaseEnvMock: vi.fn(() => true),
}));

vi.mock("@/lib/auth/guards", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/guards")>(
      "@/lib/auth/guards",
    );
  return {
    ...actual,
    hasSupabaseEnv: hasSupabaseEnvMock,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { PATCH as patchGroup } from "@/app/api/groups/[groupId]/route";
import { POST as sendEmailInvitePost } from "@/app/api/groups/[groupId]/invite/route";

interface MockGroupRow {
  id: string;
  name: string;
  slug: string;
  group_type: "RESIDENTIAL" | "TRIP" | "RECURRING";
  category: "HOME" | "TRIP" | "DINING" | "UTILITIES" | "OTHER";
  status: "ACTIVE" | "NEEDS_RATIO_UPDATE" | "ARCHIVED";
  base_currency: string;
  default_split_mode: "EQUAL" | "PERCENTAGE" | "SHARES" | "CUSTOM" | "CUSTOM_RATIOS";
  operational_budget_cents: number | null;
  billing_cycle_anchor_day: number;
  cycle_reset_day: number;
  auto_settle_on_reset: boolean;
  allow_any_member_add_expense: boolean;
  require_receipt_over_100: boolean;
  send_cycle_close_reminders: boolean;
  trip_auto_archive_enabled: boolean;
  trip_auto_archive_days: number;
  residential_lease_prompt_enabled: boolean;
  zero_balance_since: string | null;
  lease_prompt_snoozed_until: string | null;
  archived_at: string | null;
  invite_token: string;
  invite_token_version: number;
}

interface MockMemberRow {
  group_id: string;
  user_id: string;
  role: "ADMIN" | "MEMBER";
  status: "ACTIVE" | "FORMER_MEMBER";
  share_percentage: number;
  share_units: number;
  joined_at: string;
}

function createMockSupabase(params: {
  actorId: string;
  actorEmail?: string;
  group: MockGroupRow;
  members: MockMemberRow[];
}) {
  const state = {
    group: { ...params.group },
    members: params.members.map((m) => ({ ...m })),
    invites: [] as Array<Record<string, unknown>>,
    auditLogs: [] as Array<Record<string, unknown>>,
  };

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: {
            id: params.actorId,
            email: params.actorEmail ?? "actor@example.com",
            user_metadata: { full_name: "Actor User" },
          },
        },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table === "groups") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq: vi.fn((col: string, val: unknown) => {
                filters[col] = val;
                return chain;
              }),
              maybeSingle: vi.fn(async () => ({
                data: filters.id === state.group.id ? { ...state.group } : null,
                error: null,
              })),
            };
            return chain;
          }),
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: vi.fn(async (_col: string, val: unknown) => {
              if (val === state.group.id) {
                Object.assign(state.group, patch);
              }
              return { error: null };
            }),
          })),
        };
      }

      if (table === "group_members") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq: vi.fn((col: string, val: unknown) => {
                filters[col] = val;
                return chain;
              }),
              order: vi.fn(async () => {
                const rows = state.members.filter(
                  (m) =>
                    (!filters.group_id || m.group_id === filters.group_id) &&
                    (!filters.status || m.status === filters.status),
                );
                return { data: rows, error: null };
              }),
              maybeSingle: vi.fn(async () => {
                const match = state.members.find(
                  (m) =>
                    (!filters.group_id || m.group_id === filters.group_id) &&
                    (!filters.user_id || m.user_id === filters.user_id),
                );
                return { data: match ?? null, error: null };
              }),
            };
            return chain;
          }),
          update: vi.fn((patch: Record<string, unknown>) => {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq: vi.fn((col: string, val: unknown) => {
                filters[col] = val;
                if (filters.group_id && filters.user_id) {
                  const target = state.members.find(
                    (m) =>
                      m.group_id === filters.group_id &&
                      m.user_id === filters.user_id,
                  );
                  if (target) Object.assign(target, patch);
                }
                return chain;
              }),
              then: (resolve: (val: { error: null }) => void) =>
                resolve({ error: null }),
            };
            return chain;
          }),
        };
      }

      if (table === "users") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async (_col: string, ids: string[]) => ({
              data: ids.map((id) => ({
                id,
                full_name: id === "usr-admin" ? "Jordan Doe" : "Marcus Kim",
                email: `${id}@example.com`,
              })),
              error: null,
            })),
          })),
        };
      }

      if (table === "group_invites") {
        return {
          insert: vi.fn(async (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            state.invites.push(...arr);
            return { error: null };
          }),
        };
      }

      if (table === "group_audit_logs") {
        return {
          insert: vi.fn(async (row: Record<string, unknown>) => {
            state.auditLogs.push(row);
            return { error: null };
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { client, state };
}

const BASE_GROUP: MockGroupRow = {
  id: "grp-1",
  name: "Apartment 4B Shared",
  slug: "apt-4b-8x9k",
  group_type: "RESIDENTIAL",
  category: "HOME",
  status: "ACTIVE",
  base_currency: "USD",
  default_split_mode: "EQUAL",
  operational_budget_cents: 400000,
  billing_cycle_anchor_day: 1,
  cycle_reset_day: 1,
  auto_settle_on_reset: true,
  allow_any_member_add_expense: true,
  require_receipt_over_100: false,
  send_cycle_close_reminders: true,
  trip_auto_archive_enabled: true,
  trip_auto_archive_days: 14,
  residential_lease_prompt_enabled: true,
  zero_balance_since: null,
  lease_prompt_snoozed_until: null,
  archived_at: null,
  invite_token: "tok-v1",
  invite_token_version: 1,
};

const BASE_MEMBERS: MockMemberRow[] = [
  {
    group_id: "grp-1",
    user_id: "usr-admin",
    role: "ADMIN",
    status: "ACTIVE",
    share_percentage: 50,
    share_units: 1,
    joined_at: "2026-11-01T00:00:00.000Z",
  },
  {
    group_id: "grp-1",
    user_id: "usr-member",
    role: "MEMBER",
    status: "ACTIVE",
    share_percentage: 50,
    share_units: 1,
    joined_at: "2026-11-02T00:00:00.000Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Issue #110 — Split Rules, Policies & Email Invites API", () => {
  it("blocks non-ADMIN member from saving Split Rules & Policies (403 Forbidden)", async () => {
    const { client, state } = createMockSupabase({
      actorId: "usr-member",
      group: BASE_GROUP,
      members: BASE_MEMBERS,
    });
    createClientMock.mockResolvedValue(client);

    const req = new NextRequest("http://localhost:3000/api/groups/grp-1", {
      method: "PATCH",
      body: JSON.stringify({
        allow_any_member_add_expense: false,
        require_receipt_over_100: true,
      }),
    });

    const res = await patchGroup(req, { params: Promise.resolve({ groupId: "grp-1" }) });
    expect(res.status).toBe(403);
    expect(state.group.allow_any_member_add_expense).toBe(true);
    expect(state.group.require_receipt_over_100).toBe(false);
  });

  it("validates 100% total allocation when saving PERCENTAGE or CUSTOM mode", async () => {
    const { client } = createMockSupabase({
      actorId: "usr-admin",
      group: BASE_GROUP,
      members: BASE_MEMBERS,
    });
    createClientMock.mockResolvedValue(client);

    const req = new NextRequest("http://localhost:3000/api/groups/grp-1", {
      method: "PATCH",
      body: JSON.stringify({
        default_split_mode: "PERCENTAGE",
        allocations: [
          { user_id: "usr-admin", share_percentage: 60 },
          { user_id: "usr-member", share_percentage: 25 },
        ],
      }),
    });

    const res = await patchGroup(req, { params: Promise.resolve({ groupId: "grp-1" }) });
    const body = (await res.json()) as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/100\.00%/i);
  });

  it("persists SHARES weights, currency, cycle reset day, and 3 automation policy switches for ADMIN", async () => {
    const { client, state } = createMockSupabase({
      actorId: "usr-admin",
      group: BASE_GROUP,
      members: BASE_MEMBERS,
    });
    createClientMock.mockResolvedValue(client);

    const req = new NextRequest("http://localhost:3000/api/groups/grp-1", {
      method: "PATCH",
      body: JSON.stringify({
        default_split_mode: "SHARES",
        base_currency: "EUR",
        cycle_reset_day: 15,
        auto_settle_on_reset: false,
        allow_any_member_add_expense: false,
        require_receipt_over_100: true,
        send_cycle_close_reminders: false,
        allocations: [
          { user_id: "usr-admin", share_units: 3 },
          { user_id: "usr-member", share_units: 1 },
        ],
      }),
    });

    const res = await patchGroup(req, { params: Promise.resolve({ groupId: "grp-1" }) });
    const body = (await res.json()) as {
      group: {
        baseCurrency: string;
        defaultSplitMode: string;
        cycleResetDay: number;
        autoSettleOnReset: boolean;
        allowAnyMemberAddExpense: boolean;
        requireReceiptOver100: boolean;
        sendCycleCloseReminders: boolean;
        members: Array<{ userId: string; sharePercentage: number; shareUnits: number }>;
      };
    };

    expect(res.status).toBe(200);
    expect(state.group.base_currency).toBe("EUR");
    expect(state.group.default_split_mode).toBe("SHARES");
    expect(state.group.cycle_reset_day).toBe(15);
    expect(state.group.auto_settle_on_reset).toBe(false);
    expect(state.group.allow_any_member_add_expense).toBe(false);
    expect(state.group.require_receipt_over_100).toBe(true);
    expect(state.group.send_cycle_close_reminders).toBe(false);

    expect(body.group.members[0]?.shareUnits).toBe(3);
    expect(body.group.members[0]?.sharePercentage).toBe(75);
    expect(body.group.members[1]?.shareUnits).toBe(1);
    expect(body.group.members[1]?.sharePercentage).toBe(25);
  });

  it("blocks non-ADMIN from sending Email Invites and creates a 14-day GroupInvite for ADMIN", async () => {
    const memberCtx = createMockSupabase({
      actorId: "usr-member",
      group: BASE_GROUP,
      members: BASE_MEMBERS,
    });
    createClientMock.mockResolvedValue(memberCtx.client);

    const forbiddenReq = new NextRequest(
      "http://localhost:3000/api/groups/grp-1/invite",
      {
        method: "POST",
        body: JSON.stringify({ email: "alex.lee@example.com" }),
      },
    );
    const forbiddenRes = await sendEmailInvitePost(forbiddenReq, {
      params: Promise.resolve({ groupId: "grp-1" }),
    });
    expect(forbiddenRes.status).toBe(403);
    expect(memberCtx.state.invites).toHaveLength(0);

    const adminCtx = createMockSupabase({
      actorId: "usr-admin",
      actorEmail: "jordan@example.com",
      group: BASE_GROUP,
      members: BASE_MEMBERS,
    });
    createClientMock.mockResolvedValue(adminCtx.client);

    const okReq = new NextRequest(
      "http://localhost:3000/api/groups/grp-1/invite",
      {
        method: "POST",
        body: JSON.stringify({ email: "Alex.Lee@Example.com" }),
      },
    );
    const okRes = await sendEmailInvitePost(okReq, {
      params: Promise.resolve({ groupId: "grp-1" }),
    });
    const okBody = (await okRes.json()) as {
      invite: { invitedEmail: string; status: string; expiresAt: string };
    };

    expect(okRes.status).toBe(201);
    expect(okBody.invite.invitedEmail).toBe("alex.lee@example.com");
    expect(okBody.invite.status).toBe("PENDING");
    expect(adminCtx.state.invites).toHaveLength(1);

    const createdMs = Date.now();
    const expiresMs = Date.parse(okBody.invite.expiresAt);
    const diffDays = (expiresMs - createdMs) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(13.9);
    expect(diffDays).toBeLessThanOrEqual(14.1);
  });
});
