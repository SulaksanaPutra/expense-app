import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock, getAuthenticatedUserMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((target: string): never => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
  getAuthenticatedUserMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/lib/auth/guards", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

import HomePage from "@/app/page";

describe("HomePage (/) default route redirect", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getAuthenticatedUserMock.mockReset();
  });

  it("redirects authenticated requests to /dashboard", async () => {
    getAuthenticatedUserMock.mockResolvedValueOnce({
      id: "user-1",
      email: "alex@example.com",
    });

    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects unauthenticated requests to /login", async () => {
    getAuthenticatedUserMock.mockResolvedValueOnce(null);

    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
