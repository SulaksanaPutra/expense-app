// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const signInWithPasskeyMock = vi.fn();
const registerPasskeyMock = vi.fn();
const signInWithOAuthMock = vi.fn();
const signInWithOtpMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPasskey: signInWithPasskeyMock,
      registerPasskey: registerPasskeyMock,
      signInWithOAuth: signInWithOAuthMock,
      signInWithOtp: signInWithOtpMock,
    },
  })),
}));

import { LoginForm } from "@/components/auth/LoginForm";
import { SecuritySessionsCard } from "@/components/settings";
import { JoinGroupClient } from "@/components/split-groups";
import type { SecuritySessionsData } from "@/lib/settings/security";

const SECURITY_FIXTURE: SecuritySessionsData = {
  sso: {
    googleConnected: true,
    email: "jordan.davis@fastmail.com",
    providerLabel: "Google Workspace SSO",
    statusLabel: "Active",
    twoFactorEnforced: true,
  },
  passkeys: [],
  sessions: [
    {
      id: "sess-mac-1",
      deviceLabel: "MacBook Pro 16″ · Chrome (macOS)",
      browser: "Chrome",
      os: "macOS",
      deviceType: "desktop",
      location: "San Francisco, CA",
      ipAddress: "73.189.24.12",
      createdAt: "2026-11-28T01:00:00.000Z",
      lastActiveAt: "2026-11-28T09:00:00.000Z",
      isCurrent: true,
    },
    {
      id: "sess-iphone-2",
      deviceLabel: "iPhone 16 Pro · Safari Mobile",
      browser: "Safari Mobile",
      os: "iOS",
      deviceType: "mobile",
      location: "San Francisco, CA",
      ipAddress: "73.189.24.99",
      createdAt: "2026-11-28T02:00:00.000Z",
      lastActiveAt: "2026-11-28T06:00:00.000Z",
      isCurrent: false,
    },
  ],
};

describe("Issue #113 — Security & Active Sessions, Passkey /login, and /join UI", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    signInWithPasskeyMock.mockReset();
    registerPasskeyMock.mockReset();
    signInWithOAuthMock.mockReset();
    signInWithOtpMock.mockReset();
    vi.restoreAllMocks();

    Object.defineProperty(window, "PublicKeyCredential", {
      value: class PublicKeyCredentialMock {},
      configurable: true,
    });
    Object.defineProperty(navigator, "credentials", {
      value: {
        create: vi.fn(),
        get: vi.fn(),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Security & Active Sessions, enrolls a passkey via + Add Passkey, and revokes a remote device session", async () => {
    const user = userEvent.setup();
    const toastSpy = vi.fn();

    registerPasskeyMock.mockResolvedValueOnce({
      data: { passkey: { id: "pk-sb-1", friendly_name: "Mac Touch ID Passkey" } },
      error: null,
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            passkeys: [
              {
                id: "pk-sb-1",
                credentialId: "pk-sb-1",
                name: "Mac Touch ID Passkey",
                createdAt: "2026-11-28T09:30:00.000Z",
                lastUsedAt: "2026-11-28T09:30:00.000Z",
                provider: "supabase",
              },
            ],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            revokedSessionId: "sess-iphone-2",
            sessions: [SECURITY_FIXTURE.sessions[0]],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    render(
      <SecuritySessionsCard
        initialData={SECURITY_FIXTURE}
        onToast={toastSpy}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Security & Active Sessions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Google Workspace SSO")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(
      screen.getByText("iPhone 16 Pro · Safari Mobile"),
    ).toBeInTheDocument();

    // Enroll passkey
    await user.click(screen.getByRole("button", { name: /Add Passkey/i }));
    await waitFor(() => {
      expect(registerPasskeyMock).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Mac Touch ID Passkey")).toBeInTheDocument();

    // Revoke remote device
    const remoteRow = screen.getByTestId("active-device-sess-iphone-2");
    await user.click(within(remoteRow).getByRole("button", { name: "Revoke" }));

    const confirmDialog = screen.getByRole("dialog", {
      name: "Revoke Active Session?",
    });
    await user.click(
      within(confirmDialog).getByRole("button", { name: "Revoke Session" }),
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/settings/sessions",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ sessionId: "sess-iphone-2" }),
        }),
      );
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("active-device-sess-iphone-2"),
      ).not.toBeInTheDocument();
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Session revoked" }),
    );
  });

  it("supports Passkey sign-in on /login and handles passkey auth errors cleanly", async () => {
    const user = userEvent.setup();
    signInWithPasskeyMock.mockResolvedValueOnce({
      data: null,
      error: { message: "No passkey found for this device." },
    });

    render(<LoginForm nextPath="/join/apt-4b?token=abc" />);

    expect(
      screen.getByText(/accept your group invitation/i),
    ).toBeInTheDocument();

    const passkeyBtn = screen.getByRole("button", {
      name: "Sign in with Passkey",
    });
    await user.click(passkeyBtn);

    await waitFor(() => {
      expect(signInWithPasskeyMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No passkey found for this device.",
    );
  });

  it("renders expired invite state and passkey/SSO/Magic Link onboarding on /join/[slug]", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <JoinGroupClient
        state={{
          status: "invalid",
          code: "EXPIRED",
          message:
            "This 14-day invite link has expired. Ask a group admin for a new link.",
          slug: "apt-4b",
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Invitation link expired" }),
    ).toBeInTheDocument();

    signInWithPasskeyMock.mockResolvedValueOnce({
      data: { user: { id: "usr-new" } },
      error: null,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          groupId: "grp-pct",
          groupStatus: "NEEDS_RATIO_UPDATE",
          defaultSplitMode: "PERCENTAGE",
          sharePercentage: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    rerender(
      <JoinGroupClient
        state={{
          status: "valid",
          token: "signed-14d-token",
          isAuthenticated: false,
          userEmail: null,
          invite: {
            groupId: "grp-pct",
            name: "Apartment 4B Shared",
            slug: "apt-4b",
            groupType: "RESIDENTIAL",
            status: "ACTIVE",
            baseCurrency: "USD",
            defaultSplitMode: "PERCENTAGE",
            activeMemberCount: 3,
            alreadyMember: false,
            projectedSharePercentage: 0,
          },
        }}
      />,
    );

    expect(
      screen.getByText(/Percentage Split \(PERCENTAGE\)/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue with Passkey" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send Magic Link" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Continue with Passkey" }),
    );

    await waitFor(() => {
      expect(signInWithPasskeyMock).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/groups/join",
        expect.objectContaining({ method: "POST" }),
      );
      expect(pushMock).toHaveBeenCalledWith("/split-groups?group=grp-pct");
    });
  });
});
