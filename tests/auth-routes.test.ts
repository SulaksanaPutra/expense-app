import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSessionMock = vi.fn();
const signOutMock = vi.fn();
const upsertMock = vi.fn();
const fromMock = vi.fn(() => ({ upsert: upsertMock }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: exchangeCodeForSessionMock,
      signOut: signOutMock,
    },
    from: fromMock,
  })),
}));

import { GET as authCallbackGet } from "@/app/auth/callback/route";
import { POST as authSignoutPost } from "@/app/auth/signout/route";

describe("Auth Callback & Sign-Out Route Handlers", () => {
  beforeEach(() => {
    exchangeCodeForSessionMock.mockReset();
    signOutMock.mockReset();
    upsertMock.mockReset();
    fromMock.mockClear();
  });

  it("exchanges code for session, syncs profile, and redirects to default /dashboard", async () => {
    exchangeCodeForSessionMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "usr-1",
          email: "samira@example.com",
          user_metadata: { full_name: "Samira Patel" },
        },
      },
      error: null,
    });
    upsertMock.mockResolvedValueOnce({ error: null });

    const req = new NextRequest(
      "http://localhost:3000/auth/callback?code=oauth-code-123",
    );
    const res = await authCallbackGet(req);

    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("oauth-code-123");
    expect(fromMock).toHaveBeenCalledWith("users");
    expect(upsertMock).toHaveBeenCalledWith(
      {
        id: "usr-1",
        email: "samira@example.com",
        full_name: "Samira Patel",
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });

  it("preserves safe relative next redirect and rejects unsafe external next", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      data: { user: { id: "usr-1", email: "samira@example.com" } },
      error: null,
    });
    upsertMock.mockResolvedValue({ error: null });

    const safeReq = new NextRequest(
      "http://localhost:3000/auth/callback?code=c1&next=%2Fsplit-groups%3Fgroup%3Dapt4b",
    );
    const safeRes = await authCallbackGet(safeReq);
    expect(safeRes.headers.get("location")).toBe(
      "http://localhost:3000/split-groups?group=apt4b",
    );

    const unsafeReq = new NextRequest(
      "http://localhost:3000/auth/callback?code=c2&next=//evil.com/steal",
    );
    const unsafeRes = await authCallbackGet(unsafeReq);
    expect(unsafeRes.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });

  it("redirects to /login with error when code is missing or exchange fails", async () => {
    const missingCodeReq = new NextRequest(
      "http://localhost:3000/auth/callback?next=/expenses",
    );
    const missingCodeRes = await authCallbackGet(missingCodeReq);
    expect(missingCodeRes.status).toBe(307);
    const missingLoc = new URL(missingCodeRes.headers.get("location")!);
    expect(missingLoc.pathname).toBe("/login");
    expect(missingLoc.searchParams.get("error")).toBeTruthy();
    expect(missingLoc.searchParams.get("next")).toBe("/expenses");

    exchangeCodeForSessionMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Invalid auth code" },
    });
    const failedReq = new NextRequest(
      "http://localhost:3000/auth/callback?code=expired-code",
    );
    const failedRes = await authCallbackGet(failedReq);
    expect(failedRes.status).toBe(307);
    const failedLoc = new URL(failedRes.headers.get("location")!);
    expect(failedLoc.pathname).toBe("/login");
    expect(failedLoc.searchParams.get("error")).toContain("invalid or has expired");
  });

  it("signs out user via POST /auth/signout and redirects 303 to /login", async () => {
    signOutMock.mockResolvedValueOnce({ error: null });

    const req = new NextRequest("http://localhost:3000/auth/signout", {
      method: "POST",
    });
    const res = await authSignoutPost(req);

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });
});
