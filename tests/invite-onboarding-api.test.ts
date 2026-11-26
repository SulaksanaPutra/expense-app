import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSignedInviteToken,
  verifySignedInviteToken,
} from "@/lib/groups/invite-token";
import {
  buildInviteJoinPath,
  buildInviteJoinUrl,
  computeEqualSharePercentages,
  validateCustomRatios,
} from "@/lib/groups/invite-utils";

const getUserMock = vi.fn();

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
  split_breakdown: Array<{ user_id: string; share_cents: number }>;
}

interface InMemoryDb {
  users: Array<{ id: string; email: string; full_name: string }>;
  groups: InMemoryGroupRow[];
  group_members: InMemoryMemberRow[];
  expenses: InMemoryExpenseRow[];
}

function createInMemorySupabase(db: InMemoryDb) {
  function filterRows<T extends object>(
    rows: T[],
    filters: Array<{ col: string; val: unknown }>,
  ): T[] {
    return rows.filter((row) =>
      filters.every(
        (f) => (row as Record<string, unknown>)[f.col] === f.val,
      ),
    );
  }

  return {
    auth: {
      getUser: getUserMock,
    },
    from: (table: keyof InMemoryDb) => {
      if (table === "users") {
        return {
          upsert: vi.fn(
            async (row: { id: string; email: string; full_name: string }) => {
              if (!db.users.some((u) => u.id === row.id)) {
                db.users.push({ ...row });
              }
              return { error: null };
            },
          ),
        };
      }

      if (table === "groups") {
        return {
          select: () => {
            const filters: Array<{ col: string; val: unknown }> = [];
            const builder = {
              eq: (col: string, val: unknown) => {
                filters.push({ col, val });
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
            const filters: Array<{ col: string; val: unknown }> = [];
            const execute = async () => ({
              data: filterRows(db.group_members, filters).map((r) => ({ ...r })),
              error: null,
            });
            const builder = {
              eq: (col: string, val: unknown) => {
                filters.push({ col, val });
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
                const matched =
                  filterRows(db.group_members, filters)[0] ?? null;
                return {
                  data: matched ? { ...matched } : null,
                  error: null,
                };
              },
              then: (
                onFulfilled: (val: {
                  data: InMemoryMemberRow[];
                  error: null;
                }) => unknown,
              ) => execute().then(onFulfilled),
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
            const filters: Array<{ col: string; val: unknown }> = [];
            const builder = {
              eq: (col: string, val: unknown) => {
                filters.push({ col, val });
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

import { POST as regeneratePost } from "@/app/api/groups/[groupId]/invite/regenerate/route";
import { PATCH as ratiosPatch } from "@/app/api/groups/[groupId]/ratios/route";
import { POST as joinPost } from "@/app/api/groups/join/route";

describe("Signed Invite Token Helpers & Share Allocation Math", () => {
  it("creates and verifies HMAC-signed invite tokens and builds join URLs", () => {
    const token = createSignedInviteToken({
      groupId: "grp-1",
      slug: "apt-4b",
      version: 2,
      issuedAtMs: 1_700_000_000_000,
      secret: "test-secret",
    });

    const verified = verifySignedInviteToken({
      token,
      expectedSlug: "apt-4b",
      currentVersion: 2,
      secret: "test-secret",
    });
    expect(verified).toEqual({
      ok: true,
      payload: {
        g: "grp-1",
        s: "apt-4b",
        v: 2,
        iat: 1_700_000_000_000,
      },
    });

    expect(buildInviteJoinPath("apt-4b", token)).toBe(
      `/join/apt-4b?token=${encodeURIComponent(token)}`,
    );
    expect(buildInviteJoinUrl("apt-4b", token, "https://ledgersplit.app/")).toBe(
      `https://ledgersplit.app/join/apt-4b?token=${encodeURIComponent(token)}`,
    );
  });

  it("rejects missing, malformed, tampered, mismatched-slug, expired, and revoked tokens", () => {
    const validToken = createSignedInviteToken({
      groupId: "grp-1",
      slug: "apt-4b",
      version: 1,
      issuedAtMs: 1_700_000_000_000,
      expiresInMs: 60_000,
      secret: "test-secret",
    });

    expect(
      verifySignedInviteToken({ token: "", expectedSlug: "apt-4b" }),
    ).toMatchObject({ ok: false, code: "MISSING_TOKEN" });

    expect(
      verifySignedInviteToken({ token: "not-a-jwt", expectedSlug: "apt-4b" }),
    ).toMatchObject({ ok: false, code: "MALFORMED_TOKEN" });

    const [payloadPart, sigPart] = validToken.split(".");
    const tamperedSig = `${sigPart.slice(0, -1)}${sigPart.endsWith("A") ? "B" : "A"}`;
    expect(
      verifySignedInviteToken({
        token: `${payloadPart}.${tamperedSig}`,
        expectedSlug: "apt-4b",
        secret: "test-secret",
      }),
    ).toMatchObject({ ok: false, code: "INVALID_SIGNATURE" });

    expect(
      verifySignedInviteToken({
        token: validToken,
        expectedSlug: "wrong-slug",
        secret: "test-secret",
      }),
    ).toMatchObject({ ok: false, code: "MISMATCHED_SLUG" });

    expect(
      verifySignedInviteToken({
        token: validToken,
        expectedSlug: "apt-4b",
        nowMs: 1_700_000_120_000,
        secret: "test-secret",
      }),
    ).toMatchObject({ ok: false, code: "EXPIRED" });

    expect(
      verifySignedInviteToken({
        token: validToken,
        expectedSlug: "apt-4b",
        currentVersion: 2,
        nowMs: 1_700_000_010_000,
        secret: "test-secret",
      }),
    ).toMatchObject({ ok: false, code: "REVOKED" });
  });

  it("computes equal share percentages cleanly for N members summing to 100.00%", () => {
    const fiveWay = computeEqualSharePercentages(["u1", "u2", "u3", "u4", "u5"]);
    expect(Array.from(fiveWay.values())).toEqual([20, 20, 20, 20, 20]);

    const threeWay = computeEqualSharePercentages(["u1", "u2", "u3"]);
    expect(Array.from(threeWay.values())).toEqual([33.34, 33.33, 33.33]);
    const totalBps = Array.from(threeWay.values()).reduce(
      (acc, pct) => acc + Math.round(pct * 100),
      0,
    );
    expect(totalBps).toBe(10_000);
  });

  it("validates custom ratios strictly to 100.00%", () => {
    const invalidSum = validateCustomRatios(
      [
        { userId: "u1", sharePercentage: 50 },
        { userId: "u2", sharePercentage: 40 },
      ],
      ["u1", "u2"],
    );
    expect(invalidSum.ok).toBe(false);

    const invalidPrecision = validateCustomRatios(
      [
        { userId: "u1", sharePercentage: 33.333 },
        { userId: "u2", sharePercentage: 66.667 },
      ],
      ["u1", "u2"],
    );
    expect(invalidPrecision.ok).toBe(false);

    const valid = validateCustomRatios(
      [
        { userId: "u1", sharePercentage: 35.5 },
        { userId: "u2", sharePercentage: 64.5 },
      ],
      ["u1", "u2"],
    );
    expect(valid.ok).toBe(true);
  });
});

describe("Invite Onboarding & Split Mode Allocation APIs", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-123";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-xyz";
    getUserMock.mockReset();
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

  it("EQUAL mode 5th-member onboarding recalculates all active shares to 20% and keeps Expense.split_breakdown untouched", async () => {
    const token = createSignedInviteToken({
      groupId: "grp-equal",
      slug: "apt-4b-equal",
      version: 1,
    });
    const historicalBreakdown = [
      { user_id: "u1", share_cents: 2500 },
      { user_id: "u2", share_cents: 2500 },
      { user_id: "u3", share_cents: 2500 },
      { user_id: "u4", share_cents: 2500 },
    ];

    activeDb = {
      users: [
        { id: "u1", email: "u1@example.com", full_name: "Alex" },
        { id: "u2", email: "u2@example.com", full_name: "Elena" },
        { id: "u3", email: "u3@example.com", full_name: "Marcus" },
        { id: "u4", email: "u4@example.com", full_name: "Liam" },
      ],
      groups: [
        {
          id: "grp-equal",
          name: "Apt 4B Equal",
          slug: "apt-4b-equal",
          group_type: "RESIDENTIAL",
          status: "ACTIVE",
          base_currency: "USD",
          default_split_mode: "EQUAL",
          invite_token: token,
          invite_token_version: 1,
        },
      ],
      group_members: [
        {
          group_id: "grp-equal",
          user_id: "u1",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 25,
          joined_at: "2026-10-01T00:00:00.000Z",
        },
        {
          group_id: "grp-equal",
          user_id: "u2",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 25,
          joined_at: "2026-10-02T00:00:00.000Z",
        },
        {
          group_id: "grp-equal",
          user_id: "u3",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 25,
          joined_at: "2026-10-03T00:00:00.000Z",
        },
        {
          group_id: "grp-equal",
          user_id: "u4",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 25,
          joined_at: "2026-10-04T00:00:00.000Z",
        },
      ],
      expenses: [
        {
          id: "exp-hist-1",
          group_id: "grp-equal",
          amount_cents: 10000,
          split_breakdown: structuredClone(historicalBreakdown),
        },
      ],
    };

    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "u5",
          email: "samira@example.com",
          user_metadata: { full_name: "Samira Patel" },
        },
      },
      error: null,
    });

    const req = new NextRequest("http://localhost:3000/api/groups/join", {
      method: "POST",
      body: JSON.stringify({ slug: "apt-4b-equal", token }),
    });

    const res = await joinPost(req);
    expect(res.status).toBe(200);

    const payload = await res.json();
    expect(payload.alreadyMember).toBe(false);
    expect(payload.groupStatus).toBe("ACTIVE");
    expect(payload.sharePercentage).toBe(20);
    expect(payload.activeMemberCount).toBe(5);

    expect(activeDb.group_members).toHaveLength(5);
    for (const member of activeDb.group_members) {
      expect(member.share_percentage).toBe(20);
    }

    // Historical Expense.split_breakdown must remain completely untouched
    expect(activeDb.expenses[0].split_breakdown).toEqual(historicalBreakdown);

    // Re-submitting join for the same user is idempotent
    const repeatReq = new NextRequest("http://localhost:3000/api/groups/join", {
      method: "POST",
      body: JSON.stringify({ slug: "apt-4b-equal", token }),
    });
    const repeatRes = await joinPost(repeatReq);
    expect(repeatRes.status).toBe(200);
    const repeatPayload = await repeatRes.json();
    expect(repeatPayload.alreadyMember).toBe(true);
    expect(repeatPayload.sharePercentage).toBe(20);
    expect(activeDb.group_members).toHaveLength(5);
  });

  it("CUSTOM_RATIOS mode 5th-member onboarding sets 0%, flags NEEDS_RATIO_UPDATE, and resolves when Admin saves 100% allocation", async () => {
    const token = createSignedInviteToken({
      groupId: "grp-custom",
      slug: "apt-4b-custom",
      version: 1,
    });
    const historicalBreakdown = [
      { user_id: "u1", share_cents: 4000 },
      { user_id: "u2", share_cents: 3000 },
      { user_id: "u3", share_cents: 2000 },
      { user_id: "u4", share_cents: 1000 },
    ];

    activeDb = {
      users: [
        { id: "u1", email: "u1@example.com", full_name: "Alex" },
        { id: "u2", email: "u2@example.com", full_name: "Elena" },
        { id: "u3", email: "u3@example.com", full_name: "Marcus" },
        { id: "u4", email: "u4@example.com", full_name: "Liam" },
      ],
      groups: [
        {
          id: "grp-custom",
          name: "Apt 4B Custom",
          slug: "apt-4b-custom",
          group_type: "RESIDENTIAL",
          status: "ACTIVE",
          base_currency: "USD",
          default_split_mode: "CUSTOM_RATIOS",
          invite_token: token,
          invite_token_version: 1,
        },
      ],
      group_members: [
        {
          group_id: "grp-custom",
          user_id: "u1",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 40,
          joined_at: "2026-10-01T00:00:00.000Z",
        },
        {
          group_id: "grp-custom",
          user_id: "u2",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 30,
          joined_at: "2026-10-02T00:00:00.000Z",
        },
        {
          group_id: "grp-custom",
          user_id: "u3",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 20,
          joined_at: "2026-10-03T00:00:00.000Z",
        },
        {
          group_id: "grp-custom",
          user_id: "u4",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 10,
          joined_at: "2026-10-04T00:00:00.000Z",
        },
      ],
      expenses: [
        {
          id: "exp-hist-custom",
          group_id: "grp-custom",
          amount_cents: 10000,
          split_breakdown: structuredClone(historicalBreakdown),
        },
      ],
    };

    // 5th member joins
    getUserMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "u5",
          email: "samira@example.com",
          user_metadata: { full_name: "Samira Patel" },
        },
      },
      error: null,
    });

    const joinRes = await joinPost(
      new NextRequest("http://localhost:3000/api/groups/join", {
        method: "POST",
        body: JSON.stringify({ slug: "apt-4b-custom", token }),
      }),
    );

    expect(joinRes.status).toBe(200);
    const joinPayload = await joinRes.json();
    expect(joinPayload.groupStatus).toBe("NEEDS_RATIO_UPDATE");
    expect(joinPayload.sharePercentage).toBe(0);
    expect(activeDb.groups[0].status).toBe("NEEDS_RATIO_UPDATE");
    expect(
      activeDb.group_members.find((m) => m.user_id === "u5")?.share_percentage,
    ).toBe(0);
    expect(activeDb.expenses[0].split_breakdown).toEqual(historicalBreakdown);

    // Non-admin cannot update ratios -> 403
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u2", email: "u2@example.com" } },
      error: null,
    });
    const nonAdminRes = await ratiosPatch(
      new NextRequest("http://localhost:3000/api/groups/grp-custom/ratios", {
        method: "PATCH",
        body: JSON.stringify({
          default_split_mode: "CUSTOM_RATIOS",
          allocations: [
            { user_id: "u1", share_percentage: 35 },
            { user_id: "u2", share_percentage: 25 },
            { user_id: "u3", share_percentage: 15 },
            { user_id: "u4", share_percentage: 10 },
            { user_id: "u5", share_percentage: 15 },
          ],
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-custom" }) },
    );
    expect(nonAdminRes.status).toBe(403);
    expect(activeDb.groups[0].status).toBe("NEEDS_RATIO_UPDATE");

    // Admin submitting non-100% allocation -> 400
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u1", email: "u1@example.com" } },
      error: null,
    });
    const invalidSumRes = await ratiosPatch(
      new NextRequest("http://localhost:3000/api/groups/grp-custom/ratios", {
        method: "PATCH",
        body: JSON.stringify({
          default_split_mode: "CUSTOM_RATIOS",
          allocations: [
            { user_id: "u1", share_percentage: 35 },
            { user_id: "u2", share_percentage: 25 },
            { user_id: "u3", share_percentage: 15 },
            { user_id: "u4", share_percentage: 10 },
            { user_id: "u5", share_percentage: 10 },
          ],
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-custom" }) },
    );
    expect(invalidSumRes.status).toBe(400);
    expect(activeDb.groups[0].status).toBe("NEEDS_RATIO_UPDATE");

    // Admin saves valid 100% allocation -> status restores to ACTIVE
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u1", email: "u1@example.com" } },
      error: null,
    });
    const validSaveRes = await ratiosPatch(
      new NextRequest("http://localhost:3000/api/groups/grp-custom/ratios", {
        method: "PATCH",
        body: JSON.stringify({
          default_split_mode: "CUSTOM_RATIOS",
          allocations: [
            { user_id: "u1", share_percentage: 35 },
            { user_id: "u2", share_percentage: 25 },
            { user_id: "u3", share_percentage: 15 },
            { user_id: "u4", share_percentage: 10 },
            { user_id: "u5", share_percentage: 15 },
          ],
        }),
      }),
      { params: Promise.resolve({ groupId: "grp-custom" }) },
    );

    expect(validSaveRes.status).toBe(200);
    const validSavePayload = await validSaveRes.json();
    expect(validSavePayload.groupStatus).toBe("ACTIVE");
    expect(activeDb.groups[0].status).toBe("ACTIVE");
    expect(
      activeDb.group_members.find((m) => m.user_id === "u5")?.share_percentage,
    ).toBe(15);
    expect(activeDb.expenses[0].split_breakdown).toEqual(historicalBreakdown);
  });

  it("rejects non-admin invite regeneration with 403 and invalidates prior tokens when ADMIN regenerates", async () => {
    const initialToken = createSignedInviteToken({
      groupId: "grp-rev",
      slug: "tahoe-rev",
      version: 1,
    });

    activeDb = {
      users: [
        { id: "u1", email: "u1@example.com", full_name: "Alex" },
        { id: "u2", email: "u2@example.com", full_name: "Elena" },
      ],
      groups: [
        {
          id: "grp-rev",
          name: "Tahoe Cabin",
          slug: "tahoe-rev",
          group_type: "TRIP",
          status: "ACTIVE",
          base_currency: "USD",
          default_split_mode: "EQUAL",
          invite_token: initialToken,
          invite_token_version: 1,
        },
      ],
      group_members: [
        {
          group_id: "grp-rev",
          user_id: "u1",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2026-10-01T00:00:00.000Z",
        },
        {
          group_id: "grp-rev",
          user_id: "u2",
          role: "MEMBER",
          status: "ACTIVE",
          share_percentage: 50,
          joined_at: "2026-10-02T00:00:00.000Z",
        },
      ],
      expenses: [],
    };

    // Unauthenticated -> 401
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    const unauthRes = await regeneratePost(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-rev/invite/regenerate",
        { method: "POST" },
      ),
      { params: Promise.resolve({ groupId: "grp-rev" }) },
    );
    expect(unauthRes.status).toBe(401);

    // Non-admin MEMBER -> 403
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u2", email: "u2@example.com" } },
      error: null,
    });
    const memberRes = await regeneratePost(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-rev/invite/regenerate",
        { method: "POST" },
      ),
      { params: Promise.resolve({ groupId: "grp-rev" }) },
    );
    expect(memberRes.status).toBe(403);
    expect(activeDb.groups[0].invite_token_version).toBe(1);

    // ADMIN -> 200, increments invite_token_version to 2
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u1", email: "u1@example.com" } },
      error: null,
    });
    const adminRes = await regeneratePost(
      new NextRequest(
        "http://localhost:3000/api/groups/grp-rev/invite/regenerate",
        { method: "POST" },
      ),
      { params: Promise.resolve({ groupId: "grp-rev" }) },
    );
    expect(adminRes.status).toBe(200);
    const regenPayload = await adminRes.json();
    expect(regenPayload.inviteTokenVersion).toBe(2);
    expect(regenPayload.inviteToken).not.toBe(initialToken);
    expect(activeDb.groups[0].invite_token_version).toBe(2);

    // Prior token (v=1) is rejected as REVOKED on join
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u3", email: "u3@example.com" } },
      error: null,
    });
    const oldTokenRes = await joinPost(
      new NextRequest("http://localhost:3000/api/groups/join", {
        method: "POST",
        body: JSON.stringify({ slug: "tahoe-rev", token: initialToken }),
      }),
    );
    expect(oldTokenRes.status).toBe(403);
    const oldTokenPayload = await oldTokenRes.json();
    expect(oldTokenPayload.code).toBe("REVOKED");

    // Tampered token is rejected
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u3", email: "u3@example.com" } },
      error: null,
    });
    const tamperedRes = await joinPost(
      new NextRequest("http://localhost:3000/api/groups/join", {
        method: "POST",
        body: JSON.stringify({
          slug: "tahoe-rev",
          token: `${regenPayload.inviteToken}tamper`,
        }),
      }),
    );
    expect(tamperedRes.status).toBe(403);

    // New token (v=2) succeeds
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "u3", email: "u3@example.com" } },
      error: null,
    });
    const newTokenRes = await joinPost(
      new NextRequest("http://localhost:3000/api/groups/join", {
        method: "POST",
        body: JSON.stringify({
          slug: "tahoe-rev",
          token: regenPayload.inviteToken,
        }),
      }),
    );
    expect(newTokenRes.status).toBe(200);
    const newTokenPayload = await newTokenRes.json();
    expect(newTokenPayload.activeMemberCount).toBe(3);
  });
});
