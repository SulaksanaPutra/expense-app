"use client";

import * as React from "react";
import { KeyRound, Mail } from "lucide-react";
import { AlertBanner, Button, Card, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_AUTH_REDIRECT,
  sanitizeRedirectPath,
} from "@/lib/auth/redirects";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Enter your email address.";
  }
  if (!EMAIL_PATTERN.test(trimmed)) {
    return "Enter an email address in the format you@example.com.";
  }
  return undefined;
}

function buildCallbackUrl(nextPath: string): string {
  const origin =
    typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : "http://localhost";
  const callbackUrl = new URL("/auth/callback", origin);
  callbackUrl.searchParams.set("next", nextPath);
  return callbackUrl.toString();
}

function GoogleMark() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export interface LoginFormProps {
  nextPath?: string;
  initialError?: string;
}

export function LoginForm({ nextPath, initialError }: LoginFormProps) {
  const safeNext = React.useMemo(
    () => sanitizeRedirectPath(nextPath, DEFAULT_AUTH_REDIRECT),
    [nextPath],
  );
  const isInviteRedirect = safeNext.startsWith("/join/");

  const emailInputRef = React.useRef<HTMLInputElement>(null);
  const [email, setEmail] = React.useState("");
  const [hasEditedEmail, setHasEditedEmail] = React.useState(false);
  const [emailError, setEmailError] = React.useState<string | undefined>();
  const [authError, setAuthError] = React.useState<string | undefined>(
    initialError || undefined,
  );
  const [magicLinkSentTo, setMagicLinkSentTo] = React.useState<
    string | undefined
  >();
  const [isSendingMagicLink, setIsSendingMagicLink] = React.useState(false);
  const [isSendingGoogle, setIsSendingGoogle] = React.useState(false);
  const [isSigningInPasskey, setIsSigningInPasskey] = React.useState(false);

  const isBusy = isSendingMagicLink || isSendingGoogle || isSigningInPasskey;

  const handleEmailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setEmail(nextValue);
    if (!hasEditedEmail) {
      setHasEditedEmail(true);
    }
    if (emailError) {
      setEmailError(undefined);
    }
    if (authError) {
      setAuthError(undefined);
    }
  };

  const handleEmailBlur = () => {
    if (!hasEditedEmail) {
      return;
    }
    setEmailError(validateEmail(email));
  };

  const handleMagicLinkSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setAuthError(undefined);

    const validationError = validateEmail(email);
    if (validationError) {
      setEmailError(validationError);
      emailInputRef.current?.focus();
      return;
    }

    const trimmedEmail = email.trim();
    setIsSendingMagicLink(true);
    setMagicLinkSentTo(undefined);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: {
          emailRedirectTo: buildCallbackUrl(safeNext),
        },
      });

      if (error) {
        setAuthError(error.message);
        return;
      }

      setMagicLinkSentTo(trimmedEmail);
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Unable to send magic link. Please try again.",
      );
    } finally {
      setIsSendingMagicLink(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(undefined);
    setIsSendingGoogle(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: buildCallbackUrl(safeNext),
        },
      });

      if (error) {
        setAuthError(error.message);
        setIsSendingGoogle(false);
      }
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "Unable to start Google sign-in. Please try again.",
      );
      setIsSendingGoogle(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setAuthError(undefined);

    if (
      typeof window === "undefined" ||
      !("PublicKeyCredential" in window)
    ) {
      setAuthError(
        "Passkeys are not supported in this browser. Sign in with Magic Link or Google instead.",
      );
      return;
    }

    setIsSigningInPasskey(true);
    try {
      const supabase = createClient() as unknown as {
        auth?: {
          signInWithPasskey?: () => Promise<{
            data?: { session?: unknown; user?: unknown } | null;
            error?: { message?: string } | null;
          }>;
        };
      };

      if (typeof supabase?.auth?.signInWithPasskey !== "function") {
        setAuthError(
          "Passkey sign-in is not configured in this environment. Use Magic Link or Google instead.",
        );
        setIsSigningInPasskey(false);
        return;
      }

      const { error } = await supabase.auth.signInWithPasskey();
      if (error) {
        setAuthError(
          error.message || "Passkey sign-in failed. Please try again.",
        );
        setIsSigningInPasskey(false);
        return;
      }

      window.location.assign(safeNext);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "NotAllowedError" || error.name === "AbortError")
      ) {
        setAuthError("Passkey sign-in was cancelled or timed out.");
      } else {
        setAuthError(
          error instanceof Error
            ? error.message
            : "Unable to sign in with passkey. Please try again.",
        );
      }
      setIsSigningInPasskey(false);
    }
  };

  return (
    <Card padding="lg" className="w-full max-w-[440px]">
      <div className="mb-6">
        <p className="font-display text-[13px] font-semibold tracking-tight text-primary">
          LedgerSplit
        </p>
        <h1 className="mt-2 font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Sign in to your ledger
        </h1>
        <p className="mt-2 text-[15px] leading-[1.47] text-ink-muted-48">
          {isInviteRedirect
            ? "Sign in with Email, Google, or a Passkey to accept your group invitation."
            : "Track shared household expenses and settle up with your group."}
        </p>
      </div>

      {authError && (
        <AlertBanner
          tone="error"
          title="Sign-in failed"
          description={authError}
          onDismiss={() => setAuthError(undefined)}
          className="mb-5"
        />
      )}

      {magicLinkSentTo && (
        <AlertBanner
          tone="success"
          title="Check your email"
          description={`We sent a magic sign-in link to ${magicLinkSentTo}. Open the link in your inbox to continue.`}
          className="mb-5"
        />
      )}

      <form
        noValidate
        onSubmit={handleMagicLinkSubmit}
        className="flex flex-col gap-4"
        aria-label="Sign in with magic link"
      >
        <Input
          ref={emailInputRef}
          id="login-email"
          name="email"
          type="email"
          label="Email address"
          placeholder="you@example.com"
          hint="We will email you a one-time link for passwordless sign-in."
          autoComplete="email"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="done"
          required
          value={email}
          onChange={handleEmailChange}
          onBlur={handleEmailBlur}
          error={emailError}
          disabled={isBusy}
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={isSendingMagicLink}
          disabled={isSendingGoogle || isSigningInPasskey}
          leftIcon={<Mail className="h-4 w-4" />}
        >
          {isSendingMagicLink ? "Sending Magic Link..." : "Send Magic Link"}
        </Button>
      </form>

      <div
        className="my-5 flex items-center gap-3 text-[12px] font-medium text-ink-muted-48"
        role="separator"
        aria-orientation="horizontal"
      >
        <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
        <span>or</span>
        <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          fullWidth
          loading={isSendingGoogle}
          disabled={isSendingMagicLink || isSigningInPasskey}
          onClick={handleGoogleSignIn}
          leftIcon={<GoogleMark />}
        >
          {isSendingGoogle ? "Connecting to Google..." : "Continue with Google"}
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="lg"
          fullWidth
          loading={isSigningInPasskey}
          disabled={isSendingMagicLink || isSendingGoogle}
          onClick={handlePasskeySignIn}
          leftIcon={<KeyRound className="h-4 w-4 text-[#0066cc]" />}
        >
          {isSigningInPasskey ? "Verifying Passkey..." : "Sign in with Passkey"}
        </Button>
      </div>
    </Card>
  );
}
