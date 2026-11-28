import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSignedInviteToken,
  INVITE_TOKEN_TTL_MS,
  verifySignedInviteToken,
} from "@/lib/groups/invite-token";
import { acceptGroupInvite } from "@/lib/groups/onboarding";

const getUserMock = vi.fn();
const getSessionMock = vi.fn();
const updateUserMock = vi.fn();
const signOutMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: getUserMock,
      getSession: getSessionMock,
      updateUser: updateUserMock,
      signOut: signOutMock,
    },
  })),
}));

import {
  DELETE as sessionsDelete,
  GET as sessionsGet,
} from "@/app/api/settings/sessions/route";
import {
  DELETE as passkeysDelete,
  GET as passkeysGet,
  POST as passkeysPost,
} from "@/app/api/settings/passkeys/route";

function makeJwtWithSessionId(sessionId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "usr-1", session_id: sessionId }),
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("Issue #113 — Active Devices Session Revocation, Passkeys & 14-Day Invite APIs", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    getUserMock.mockReset();
    getSessionMock.mockReset();
    updateUserMock.mockReset();
    signOutMock.mockReset();
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalAnon === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnon;
  });

  it("GET /api/settings/sessions lists current and remote devices and DELETE revokes selected session", async () => {
    const mockUser = {
      id: "usr-1",
      email: "jordan.davis@fastmail.com",
      app_metadata: { provider: "google", providers: ["google"] },
      identities: [{ provider: "google" }],
      user_metadata: {
        active_sessions: [
          {
            id: "sess-iphone-16",
            deviceLabel: "iPhone 16 Pro · Safari Mobile",
            browser: "Safari Mobile",
            os: "iOS",
            deviceType: "mobile",
            location: "San Francisco, CA",
            ipAddress: "73.189.24.99",
            createdAt: "2026-11-28T05:00:00.000Z",
            lastActiveAt: "2026-11-28T06:00:00.000Z",
          },
        ],
        passkeys: [],
      },
    };

    getUserMock.mockResolvedValue({ data: { user: mockUser }, error: null });
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: makeJwtWithSessionId("sess-mac-1") } },
    });
    updateUserMock.mockResolvedValue({ data: { user: mockUser }, error: null });
    signOutMock.mockResolvedValue({ error: null });

    const getReq = new NextRequest("http://localhost:3000/api/settings/sessions", {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
        "x-forwarded-for": "73.189.24.12",
      },
    });

    const getRes = await sessionsGet(getReq);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      ok: boolean;
      sso: { googleConnected: boolean; statusLabel: string };
      sessions: Array<{ id: string; isCurrent: boolean; deviceLabel: string }>;
    };
    expect(getBody.ok).toBe(true);
    expect(getBody.sso.googleConnected).toBe(true);
    expect(getBody.sso.statusLabel).toBe("Active");
    expect(getBody.sessions).toHaveLength(2);
    expect(getBody.sessions[0]).toMatchObject({
      id: "sess-mac-1",
      isCurrent: true,
    });
    expect(getBody.sessions[1]).toMatchObject({
      id: "sess-iphone-16",
      isCurrent: false,
    });

    const delReq = new NextRequest("http://localhost:3000/api/settings/sessions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "sess-iphone-16" }),
    });
    const delRes = await sessionsDelete(delReq);
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as {
      ok: boolean;
      revokedSessionId: string;
      sessions: Array<{ id: string }>;
    };
    expect(delBody.ok).toBe(true);
    expect(delBody.revokedSessionId).toBe("sess-iphone-16");
    expect(delBody.sessions.map((s) => s.id)).toEqual(["sess-mac-1"]);
    expect(updateUserMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledWith({ scope: "others" });
  });

  it("returns 404 when revoking an unknown session and 401 when unauthenticated", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    getSessionMock.mockResolvedValueOnce({ data: { session: null } });

    const unauthRes = await sessionsDelete(
      new NextRequest("http://localhost:3000/api/settings/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "sess-unknown" }),
      }),
    );
    expect(unauthRes.status).toBe(401);

    getUserMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "usr-1",
          email: "alex@example.com",
          app_metadata: {},
          user_metadata: { active_sessions: [] },
        },
      },
      error: null,
    });
    getSessionMock.mockResolvedValueOnce({
      data: { session: { access_token: makeJwtWithSessionId("sess-current") } },
    });

    const missingRes = await sessionsDelete(
      new NextRequest("http://localhost:3000/api/settings/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "sess-does-not-exist" }),
      }),
    );
    expect(missingRes.status).toBe(404);
  });

  it("issues WebAuthn challenge, enrolls passkey, and deletes passkey via /api/settings/passkeys", async () => {
    const userState = {
      id: "usr-1",
      email: "jordan@example.com",
      user_metadata: { full_name: "Jordan Doe", passkeys: [] as unknown[] },
    };

    getUserMock.mockImplementation(async () => ({
      data: { user: userState },
      error: null,
    }));
    updateUserMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      userState.user_metadata = {
        ...userState.user_metadata,
        ...(data as typeof userState.user_metadata),
      };
      return { data: { user: userState }, error: null };
    });

    const getRes = await passkeysGet(
      new NextRequest("http://localhost:3000/api/settings/passkeys"),
    );
    expect(getRes.status).toBe(200);
    const challengeBody = (await getRes.json()) as {
      ok: boolean;
      challenge: string;
      rp: { name: string };
    };
    expect(challengeBody.ok).toBe(true);
    expect(challengeBody.challenge.length).toBeGreaterThan(20);
    expect(challengeBody.rp.name).toBe("LedgerSplit");

    const postRes = await passkeysPost(
      new NextRequest("http://localhost:3000/api/settings/passkeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialId: "cred-touchid-001",
          name: "MacBook Pro Touch ID",
          provider: "webauthn",
        }),
      }),
    );
    expect(postRes.status).toBe(201);
    const postBody = (await postRes.json()) as {
      ok: boolean;
      passkey: { id: string; name: string };
      passkeys: Array<{ id: string }>;
    };
    expect(postBody.ok).toBe(true);
    expect(postBody.passkey.name).toBe("MacBook Pro Touch ID");
    expect(postBody.passkeys).toHaveLength(1);

    const delRes = await passkeysDelete(
      new NextRequest("http://localhost:3000/api/settings/passkeys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passkeyId: postBody.passkey.id }),
      }),
    );
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { ok: boolean; passkeys: unknown[] };
    expect(delBody.passkeys).toHaveLength(0);
  });

  it("enforces 14-day invite token expiry and binds PERCENTAGE/CUSTOM to NEEDS_RATIO_UPDATE while SHARES auto-joins ACTIVE", async () => {
    const nowMs = Date.now();
    const expiredToken = createSignedInviteToken({
      groupId: "grp-pct",
      slug: "apt-pct",
      version: 1,
      issuedAtMs: nowMs - INVITE_TOKEN_TTL_MS - 60_000,
      secret: "test-secret",
    });

    const expiredCheck = verifySignedInviteToken({
      token: expiredToken,
      expectedSlug: "apt-pct",
      nowMs,
      maxAgeMs: INVITE_TOKEN_TTL_MS,
      secret: "test-secret",
    });
    expect(expiredCheck).toMatchObject({ ok: false, code: "EXPIRED" });

    // In-memory mock for acceptGroupInvite in PERCENTAGE and SHARES modes
    const makeMockAdmin = (
      mode: "PERCENTAGE" | "CUSTOM" | "SHARES",
      groupId: string,
      slug: string,
    ) => {
      const groupRow = {
        id: groupId,
        name: `Group ${mode}`,
        slug,
        status: "ACTIVE",
        default_split_mode: mode,
        invite_token_version: 1,
      };
      const members = [
        {
          group_id: groupId,
          user_id: "usr-owner",
          role: "ADMIN",
          status: "ACTIVE",
          share_percentage: 100,
          joined_at: "2026-11-01T00:00:00.000Z",
        },
      ];
      return {
        groupRow,
        members,
        client: {
          from: (table: string) => {
            if (table === "groups") {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { ...groupRow }, error: null }),
                  }),
                }),
                update: (patch: Partial<typeof groupRow>) => ({
                  eq: async () => {
                    Object.assign(groupRow, patch);
                    return { error: null };
                  },
                }),
              };
            }
            if (table === "users") {
              return { upsert: async () => ({ error: null }) };
            }
            if (table === "group_members") {
              return {
                select: () => ({
                  eq: () => ({
                    order: async () => ({ data: members.map((m) => ({ ...m })), error: null }),
                  }),
                }),
                insert: async (row: (typeof members)[number]) => {
                  members.push({ ...row, joined_at: new Date().toISOString() });
                  return { error: null };
                },
                update: (patch: Partial<(typeof members)[number]>) => {
                  const filters: Record<string, unknown> = {};
                  const builder = {
                    eq: (col: string, val: unknown) => {
                      filters[col] = val;
                      return builder;
                    },
                    then: (cb: (res: { error: null }) => unknown) => {
                      for (const m of members) {
                        if (m.user_id === filters.user_id) {
                          Object.assign(m, patch);
                        }
                      }
                      return Promise.resolve({ error: null }).then(cb);
                    },
                  };
                  return builder;
                },
              };
            }
            if (table === "group_audit_logs") {
              return { insert: async () => ({ error: null }) };
            }
            return {
              update: () => ({ eq: async () => ({ error: null }) }),
            };
          },
        },
      };
    };

    const pctMock = makeMockAdmin("PERCENTAGE", "grp-pct", "apt-pct");
    const pctToken = createSignedInviteToken({
      groupId: "grp-pct",
      slug: "apt-pct",
      version: 1,
      expiresInMs: INVITE_TOKEN_TTL_MS,
    });
    const pctResult = await acceptGroupInvite(pctMock.client as never, {
      slug: "apt-pct",
      token: pctToken,
      authUser: { id: "usr-new", email: "new@example.com", fullName: "New Member" },
    });
    expect(pctResult).toMatchObject({
      ok: true,
      groupStatus: "NEEDS_RATIO_UPDATE",
      defaultSplitMode: "PERCENTAGE",
      sharePercentage: 0,
    });

    const sharesMock = makeMockAdmin("SHARES", "grp-shares", "apt-shares");
    const sharesToken = createSignedInviteToken({
      groupId: "grp-shares",
      slug: "apt-shares",
      version: 1,
      expiresInMs: INVITE_TOKEN_TTL_MS,
    });
    const sharesResult = await acceptGroupInvite(sharesMock.client as never, {
      slug: "apt-shares",
      token: sharesToken,
      authUser: { id: "usr-new", email: "new@example.com", fullName: "New Member" },
    });
    expect(sharesResult).toMatchObject({
      ok: true,
      groupStatus: "ACTIVE",
      defaultSplitMode: "SHARES",
      sharePercentage: 50,
    });
  });
});
