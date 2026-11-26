import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: getUserMock,
    },
  })),
}));

import {
  isProtectedRoute,
  resolveRedirectParam,
  sanitizeRedirectPath,
} from "@/lib/auth/redirects";
import { updateSession } from "@/lib/supabase/middleware";
import { proxy } from "@/proxy";

describe("Auth Redirect Sanitization & Protected Route Matching", () => {
  it("matches protected route prefixes and their sub-paths", () => {
    expect(isProtectedRoute("/dashboard")).toBe(true);
    expect(isProtectedRoute("/dashboard/overview")).toBe(true);
    expect(isProtectedRoute("/expenses")).toBe(true);
    expect(isProtectedRoute("/expenses/exp-123")).toBe(true);
    expect(isProtectedRoute("/split-groups")).toBe(true);
    expect(isProtectedRoute("/split-groups/apt-4b")).toBe(true);
    expect(isProtectedRoute("/settings")).toBe(true);
    expect(isProtectedRoute("/settings/profile")).toBe(true);

    expect(isProtectedRoute("/")).toBe(false);
    expect(isProtectedRoute("/login")).toBe(false);
    expect(isProtectedRoute("/join/apt-4b")).toBe(false);
    expect(isProtectedRoute("/dashboard-public")).toBe(false);
  });

  it("preserves safe relative redirect paths and blocks open redirects or auth loops", () => {
    expect(sanitizeRedirectPath("/expenses?cycle=2026-11")).toBe(
      "/expenses?cycle=2026-11",
    );
    expect(sanitizeRedirectPath("/join/apt-4b?token=xyz")).toBe(
      "/join/apt-4b?token=xyz",
    );

    expect(sanitizeRedirectPath("https://evil.com/phish")).toBe("/dashboard");
    expect(sanitizeRedirectPath("//evil.com/phish")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/\\evil.com")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/login")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/auth/callback?code=123")).toBe("/dashboard");
    expect(sanitizeRedirectPath(undefined)).toBe("/dashboard");
  });

  it("resolves next or redirect query parameter safely", () => {
    expect(
      resolveRedirectParam(new URLSearchParams("next=/split-groups")),
    ).toBe("/split-groups");
    expect(
      resolveRedirectParam(new URLSearchParams("redirect=/settings")),
    ).toBe("/settings");
    expect(
      resolveRedirectParam({ next: "https://attacker.example" }),
    ).toBe("/dashboard");
  });
});

describe("Middleware / Proxy Route Guards", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    getUserMock.mockReset();
  });

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    }
    if (originalKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    }
  });

  it.each([
    "/dashboard",
    "/expenses",
    "/split-groups",
    "/settings",
    "/split-groups/apt-4b?tab=members",
  ])(
    "redirects unauthenticated requests to %s -> /login preserving next",
    async (path) => {
      getUserMock.mockResolvedValueOnce({ data: { user: null } });
      const req = new NextRequest(`http://localhost:3000${path}`);
      const res = await proxy(req);

      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).not.toBeNull();
      const target = new URL(location!);
      expect(target.pathname).toBe("/login");
      expect(target.searchParams.get("next")).toBe(path);
    },
  );

  it("allows unauthenticated requests to /login and /", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const loginRes = await updateSession(
      new NextRequest("http://localhost:3000/login"),
    );
    expect(loginRes.status).toBe(200);

    const homeRes = await updateSession(
      new NextRequest("http://localhost:3000/"),
    );
    expect(homeRes.status).toBe(200);
  });

  it("redirects authenticated requests on /login to /dashboard by default", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "alex@example.com" } },
    });

    const res = await proxy(new NextRequest("http://localhost:3000/login"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/dashboard");
  });

  it("redirects authenticated requests on /login to safe next target and blocks unsafe next", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-1", email: "alex@example.com" } },
    });

    const safeRes = await proxy(
      new NextRequest(
        "http://localhost:3000/login?next=%2Fexpenses%3Fcycle%3D2026-11",
      ),
    );
    expect(safeRes.status).toBe(307);
    expect(safeRes.headers.get("location")).toBe(
      "http://localhost:3000/expenses?cycle=2026-11",
    );

    const unsafeRes = await proxy(
      new NextRequest(
        "http://localhost:3000/login?next=https%3A%2F%2Fevil.com",
      ),
    );
    expect(unsafeRes.status).toBe(307);
    expect(unsafeRes.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });

  it("allows authenticated requests to protected routes", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1", email: "alex@example.com" } },
    });

    const res = await proxy(new NextRequest("http://localhost:3000/dashboard"));
    expect(res.status).toBe(200);
  });
});
