// @vitest-environment jsdom
import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtpMock = vi.fn();
const signInWithOAuthMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithOtp: signInWithOtpMock,
      signInWithOAuth: signInWithOAuthMock,
    },
  })),
}));

import { LoginForm } from "@/components/auth/LoginForm";

afterEach(() => {
  cleanup();
});

describe("LoginForm", () => {
  beforeEach(() => {
    signInWithOtpMock.mockReset();
    signInWithOAuthMock.mockReset();
  });

  it("renders centered login card with email input, Magic Link CTA, and Google OAuth CTA", () => {
    render(<LoginForm />);

    expect(
      screen.getByRole("heading", { name: "Sign in to your ledger" }),
    ).toBeInTheDocument();

    const emailInput = screen.getByLabelText(/Email address/i);
    expect(emailInput).toHaveAttribute("type", "email");
    expect(emailInput).toHaveAttribute("autocomplete", "email");
    expect(emailInput).toBeRequired();
    expect(emailInput).not.toHaveAttribute("aria-invalid");

    expect(
      screen.getByRole("button", { name: "Send Magic Link" }),
    ).toHaveAttribute("type", "submit");
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toHaveAttribute("type", "button");
  });

  it("validates email after interaction/submit, focuses invalid field, and clears error on input", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/Email address/i);
    const submitBtn = screen.getByRole("button", { name: "Send Magic Link" });

    // Submit empty -> validates, shows alert, focuses email input
    await user.click(submitBtn);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter your email address.",
    );
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    expect(emailInput).toHaveFocus();
    expect(signInWithOtpMock).not.toHaveBeenCalled();

    // Typing clears existing error immediately
    await user.type(emailInput, "not-an-email");
    expect(emailInput).not.toHaveAttribute("aria-invalid");

    // Blurring invalid edited value shows format error
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter an email address in the format you@example.com.",
    );
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
  });

  it("submits Magic Link OTP with preserved next redirect and shows confirmation banner", async () => {
    const user = userEvent.setup();
    signInWithOtpMock.mockResolvedValueOnce({ error: null });

    render(<LoginForm nextPath="/split-groups?group=apt4b" />);

    const emailInput = screen.getByLabelText(/Email address/i);
    await user.type(emailInput, "  alex@example.com ");
    await user.click(screen.getByRole("button", { name: "Send Magic Link" }));

    await waitFor(() => {
      expect(signInWithOtpMock).toHaveBeenCalledWith({
        email: "alex@example.com",
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=%2Fsplit-groups%3Fgroup%3Dapt4b`,
        },
      });
    });

    expect(screen.getByRole("status")).toHaveTextContent("Check your email");
    expect(screen.getByRole("status")).toHaveTextContent("alex@example.com");
  });

  it("displays error alert when Magic Link request fails", async () => {
    const user = userEvent.setup();
    signInWithOtpMock.mockResolvedValueOnce({
      error: { message: "Rate limit exceeded" },
    });

    render(<LoginForm />);

    await user.type(screen.getByLabelText(/Email address/i), "alex@example.com");
    await user.click(screen.getByRole("button", { name: "Send Magic Link" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Rate limit exceeded");
    });
  });

  it("triggers Google OAuth sign-in with safe callback redirect and handles errors", async () => {
    const user = userEvent.setup();
    signInWithOAuthMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "OAuth provider unavailable" } });

    render(<LoginForm nextPath="/expenses" />);

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await waitFor(() => {
      expect(signInWithOAuthMock).toHaveBeenCalledWith({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=%2Fexpenses`,
        },
      });
    });
  });

  it("renders initialError from callback failure and handles Google OAuth error", async () => {
    const user = userEvent.setup();
    signInWithOAuthMock.mockResolvedValueOnce({
      error: { message: "OAuth provider unavailable" },
    });

    render(<LoginForm initialError="Your sign-in link has expired." />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your sign-in link has expired.",
    );

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "OAuth provider unavailable",
      );
    });
  });
});
