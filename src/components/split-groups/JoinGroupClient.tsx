"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Mail,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AlertBanner, Badge, Button, Card, Input } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { buildInviteJoinPath } from "@/lib/groups/invite-utils";
import type { GroupInvitePreview } from "@/lib/groups/onboarding";
import { createClient } from "@/lib/supabase/client";
import type { GroupType, SplitMode } from "@/types/database";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GROUP_TYPE_LABEL: Record<
  GroupType,
  { label: string; tone: BadgeTone }
> = {
  RESIDENTIAL: { label: "Primary Residence", tone: "info" },
  TRIP: { label: "Seasonal Trip", tone: "warning" },
  RECURRING: { label: "Recurring Flat", tone: "neutral" },
};

function getSplitModeMeta(mode: SplitMode): {
  label: string;
  tone: BadgeTone;
  requiresRatioReview: boolean;
} {
  switch (mode) {
    case "EQUAL":
      return {
        label: "Equal Split (EQUAL)",
        tone: "info",
        requiresRatioReview: false,
      };
    case "SHARES":
      return {
        label: "Proportional Shares (SHARES)",
        tone: "info",
        requiresRatioReview: false,
      };
    case "PERCENTAGE":
      return {
        label: "Percentage Split (PERCENTAGE)",
        tone: "warning",
        requiresRatioReview: true,
      };
    case "CUSTOM":
      return {
        label: "Custom Split (CUSTOM)",
        tone: "warning",
        requiresRatioReview: true,
      };
    case "CUSTOM_RATIOS":
    default:
      return {
        label: "Custom Ratios (CUSTOM_RATIOS)",
        tone: "warning",
        requiresRatioReview: true,
      };
  }
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

export type JoinGroupPageState =
  | {
      status: "invalid";
      code: string;
      message: string;
      slug: string;
    }
  | {
      status: "valid";
      invite: GroupInvitePreview;
      token: string;
      isAuthenticated: boolean;
      userEmail: string | null;
    };

export interface JoinGroupClientProps {
  state: JoinGroupPageState;
}

export function JoinGroupClient({ state }: JoinGroupClientProps) {
  const router = useRouter();
  const [isJoining, setIsJoining] = React.useState(false);
  const [joinError, setJoinError] = React.useState<string | null>(null);
  const [authEmail, setAuthEmail] = React.useState("");
  const [magicLinkSentTo, setMagicLinkSentTo] = React.useState<string | null>(
    null,
  );
  const [isSendingMagicLink, setIsSendingMagicLink] = React.useState(false);
  const [isSendingGoogle, setIsSendingGoogle] = React.useState(false);
  const [isPasskeyBusy, setIsPasskeyBusy] = React.useState(false);
  const [passkeyRegisteredNotice, setPasskeyRegisteredNotice] = React.useState<
    string | null
  >(null);

  if (state.status === "invalid") {
    const isRevoked = state.code === "REVOKED";
    const isExpired = state.code === "EXPIRED";
    const isArchived = state.code === "GROUP_ARCHIVED";
    const title = isRevoked
      ? "Invitation link revoked"
      : isExpired
        ? "Invitation link expired"
        : isArchived
          ? "Group is archived"
          : "Invalid invitation link";

    return (
      <Card padding="lg" className="w-full max-w-[460px]">
        <div className="mb-5 flex items-center justify-between">
          <span className="font-display text-[13px] font-semibold tracking-tight text-[#0066cc]">
            LedgerSplit
          </span>
          <Badge tone="danger" size="sm">
            Invite Rejected
          </Badge>
        </div>

        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-muted-48">
          We could not validate your invitation for{" "}
          <span className="font-mono text-ink">{state.slug}</span>.
        </p>

        <AlertBanner
          tone="error"
          title={title}
          description={state.message}
          className="mt-5"
        />

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/split-groups"
            className="inline-flex h-10 flex-1 items-center justify-center rounded-pill bg-primary px-5 text-[14px] font-medium text-on-primary transition-colors hover:bg-primary-focus focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
          >
            Go to Split Groups
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-pill border border-hairline bg-canvas px-5 text-[14px] font-medium text-ink transition-colors hover:bg-surface-pearl focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
          >
            Sign In
          </Link>
        </div>
      </Card>
    );
  }

  const { invite, token, isAuthenticated, userEmail } = state;
  const typeMeta = GROUP_TYPE_LABEL[invite.groupType];
  const splitModeMeta = getSplitModeMeta(invite.defaultSplitMode);
  const joinPath = buildInviteJoinPath(invite.slug, token);
  const loginHref = `/login?next=${encodeURIComponent(joinPath)}`;
  const isAuthBusy = isSendingMagicLink || isSendingGoogle || isPasskeyBusy;

  const submitJoinGroup = async () => {
    setJoinError(null);
    setIsJoining(true);

    try {
      const response = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: invite.slug,
          token,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        groupId?: string;
      };

      if (!response.ok || !payload.groupId) {
        setJoinError(
          payload.error || "Unable to join this group. Please try again.",
        );
        setIsJoining(false);
        return;
      }

      router.push(`/split-groups?group=${encodeURIComponent(payload.groupId)}`);
      router.refresh();
    } catch {
      setJoinError("Network error while joining group. Please try again.");
      setIsJoining(false);
    }
  };

  const handleGoogleOnboarding = async () => {
    setJoinError(null);
    setIsSendingGoogle(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: buildCallbackUrl(joinPath),
        },
      });
      if (error) {
        setJoinError(error.message);
        setIsSendingGoogle(false);
      }
    } catch (error) {
      setJoinError(
        error instanceof Error
          ? error.message
          : "Unable to start Google sign-in.",
      );
      setIsSendingGoogle(false);
    }
  };

  const handleMagicLinkOnboarding = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setJoinError(null);
    const trimmed = authEmail.trim();
    if (!trimmed || !EMAIL_PATTERN.test(trimmed)) {
      setJoinError("Enter a valid email address to receive your join link.");
      return;
    }

    setIsSendingMagicLink(true);
    setMagicLinkSentTo(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: buildCallbackUrl(joinPath),
        },
      });
      if (error) {
        setJoinError(error.message);
        return;
      }
      setMagicLinkSentTo(trimmed);
    } catch (error) {
      setJoinError(
        error instanceof Error
          ? error.message
          : "Unable to send magic sign-in link.",
      );
    } finally {
      setIsSendingMagicLink(false);
    }
  };

  const handlePasskeyOnboarding = async () => {
    setJoinError(null);
    setPasskeyRegisteredNotice(null);

    if (
      typeof window === "undefined" ||
      !("PublicKeyCredential" in window)
    ) {
      setJoinError(
        "Passkeys are not supported in this browser. Continue with Google or Email Magic Link instead.",
      );
      return;
    }

    setIsPasskeyBusy(true);
    try {
      const supabase = createClient() as unknown as {
        auth?: {
          signInWithPasskey?: () => Promise<{
            data?: { session?: unknown; user?: unknown } | null;
            error?: { message?: string } | null;
          }>;
          registerPasskey?: (opts?: { friendlyName?: string }) => Promise<{
            data?: { passkey?: { id?: string } } | null;
            error?: { message?: string } | null;
          }>;
        };
      };

      if (isAuthenticated) {
        if (typeof supabase?.auth?.registerPasskey !== "function") {
          setJoinError("Passkey registration is unavailable in this session.");
          setIsPasskeyBusy(false);
          return;
        }
        const { error } = await supabase.auth.registerPasskey({
          friendlyName: "Invite Onboarding Passkey",
        });
        if (error) {
          setJoinError(error.message || "Unable to register passkey.");
          setIsPasskeyBusy(false);
          return;
        }
        setPasskeyRegisteredNotice(
          "Passkey registered for your account. Joining group...",
        );
        setIsPasskeyBusy(false);
        await submitJoinGroup();
        return;
      }

      if (typeof supabase?.auth?.signInWithPasskey !== "function") {
        setJoinError(
          "Passkey sign-in is not configured in this environment. Use Google or Email Magic Link.",
        );
        setIsPasskeyBusy(false);
        return;
      }

      const { error } = await supabase.auth.signInWithPasskey();
      if (error) {
        setJoinError(
          error.message ||
            "No passkey matched. Sign in with Google or Magic Link to create one.",
        );
        setIsPasskeyBusy(false);
        return;
      }

      setIsPasskeyBusy(false);
      await submitJoinGroup();
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "NotAllowedError" || error.name === "AbortError")
      ) {
        setJoinError("Passkey verification was cancelled or timed out.");
      } else {
        setJoinError(
          error instanceof Error
            ? error.message
            : "Unable to complete passkey authentication.",
        );
      }
      setIsPasskeyBusy(false);
    }
  };

  return (
    <Card padding="lg" className="w-full max-w-[460px]">
      <div className="mb-5 flex items-center justify-between gap-2">
        <span className="font-display text-[13px] font-semibold tracking-tight text-[#0066cc]">
          LedgerSplit
        </span>
        <Badge tone={typeMeta.tone} size="sm" dot>
          {typeMeta.label}
        </Badge>
      </div>

      <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        Join {invite.name}
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-muted-48">
        You have been invited to collaborate on shared expenses in{" "}
        <span className="font-medium text-ink">{invite.baseCurrency}</span>.
      </p>

      <Card variant="sub-card" padding="md" className="mt-5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 text-[13px]">
          <span className="inline-flex items-center gap-1.5 text-ink-muted-48">
            <Users className="h-4 w-4" aria-hidden="true" />
            Active members
          </span>
          <span className="font-semibold text-ink tabular-nums">
            {invite.activeMemberCount}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-hairline pt-2.5 text-[13px]">
          <span className="text-ink-muted-48">Split mode</span>
          <Badge tone={splitModeMeta.tone} size="sm">
            {splitModeMeta.label}
          </Badge>
        </div>

        <div className="border-t border-hairline pt-2.5 text-[12px] leading-relaxed text-ink-muted-80">
          {!splitModeMeta.requiresRatioReview ? (
            <p className="flex items-start gap-2">
              <ShieldCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-[#0066cc]"
                aria-hidden="true"
              />
              <span>
                {invite.defaultSplitMode === "SHARES"
                  ? invite.alreadyMember
                    ? `Your current proportional share is ${invite.projectedSharePercentage}%.`
                    : `Joining assigns 1 default share (${invite.projectedSharePercentage}% projected) across ${invite.activeMemberCount + 1} members. Past expenses stay untouched.`
                  : invite.alreadyMember
                    ? `Your current equal share is ${invite.projectedSharePercentage}%.`
                    : `Joining recalculates active member shares to ${invite.projectedSharePercentage}% across ${invite.activeMemberCount + 1} members. Past expenses stay untouched.`}
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                aria-hidden="true"
              />
              <span>
                {invite.alreadyMember
                  ? `You are an active member with a ${invite.projectedSharePercentage}% ratio.`
                  : "Joining assigns a 0% initial share and flags the group for ratio review until an admin updates allocations to 100%."}
              </span>
            </p>
          )}
        </div>
      </Card>

      {joinError && (
        <AlertBanner
          tone="error"
          title="Could not join group"
          description={joinError}
          className="mt-5"
        />
      )}

      {magicLinkSentTo && (
        <AlertBanner
          tone="success"
          title="Check your email"
          description={`We sent a magic sign-in link to ${magicLinkSentTo}. Open it to return here and join ${invite.name}.`}
          className="mt-5"
        />
      )}

      {passkeyRegisteredNotice && (
        <AlertBanner
          tone="success"
          title="Passkey ready"
          description={passkeyRegisteredNotice}
          className="mt-5"
        />
      )}

      {invite.alreadyMember ? (
        <div className="mt-5 flex flex-col gap-4">
          <AlertBanner
            tone="info"
            title="Already a member"
            description={`You are already an active member of ${invite.name}.`}
          />
          <Link
            href={`/split-groups?group=${encodeURIComponent(invite.groupId)}`}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-primary px-6 text-[15px] font-medium text-on-primary transition-colors hover:bg-primary-focus focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
          >
            <span>Open Split Group</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      ) : !isAuthenticated ? (
        <div className="mt-5 flex flex-col gap-3.5">
          <p className="text-[13px] leading-relaxed text-ink-muted-48">
            Sign in with a Passkey, Google, or Magic Link to accept this
            14-day invitation and join{" "}
            <span className="font-medium text-ink">{invite.name}</span>.
          </p>

          <Button
            type="button"
            variant="secondary"
            size="md"
            fullWidth
            loading={isPasskeyBusy}
            disabled={isSendingGoogle || isSendingMagicLink}
            onClick={handlePasskeyOnboarding}
            leftIcon={<KeyRound className="h-4 w-4 text-[#0066cc]" />}
          >
            {isPasskeyBusy
              ? "Verifying Passkey..."
              : "Continue with Passkey"}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="md"
            fullWidth
            loading={isSendingGoogle}
            disabled={isPasskeyBusy || isSendingMagicLink}
            onClick={handleGoogleOnboarding}
            leftIcon={<GoogleMark />}
          >
            {isSendingGoogle
              ? "Connecting to Google..."
              : "Continue with Google"}
          </Button>

          <form
            noValidate
            onSubmit={handleMagicLinkOnboarding}
            className="flex flex-col gap-2.5 border-t border-hairline pt-3"
          >
            <Input
              id="join-magic-email"
              name="email"
              type="email"
              label="Email for Magic Link"
              placeholder="you@example.com"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              disabled={isAuthBusy}
            />
            <Button
              type="submit"
              variant="secondary"
              size="md"
              fullWidth
              loading={isSendingMagicLink}
              disabled={isPasskeyBusy || isSendingGoogle}
              leftIcon={<Mail className="h-4 w-4" />}
            >
              {isSendingMagicLink ? "Sending Magic Link..." : "Send Magic Link"}
            </Button>
          </form>

          <Link
            href={loginHref}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-primary px-6 text-[15px] font-medium text-on-primary transition-colors hover:bg-primary-focus focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
          >
            <span>Sign in to Join {invite.name}</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          {userEmail && (
            <p className="flex items-center gap-2 text-[12px] text-ink-muted-48">
              <CheckCircle2
                className="h-4 w-4 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
              <span>
                Signed in as{" "}
                <strong className="font-medium text-ink">{userEmail}</strong>
              </span>
            </p>
          )}
          <Button
            type="button"
            variant="primary"
            size="lg"
            fullWidth
            loading={isJoining}
            disabled={isPasskeyBusy}
            onClick={submitJoinGroup}
          >
            {isJoining ? "Joining Group..." : `Join ${invite.name}`}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            fullWidth
            loading={isPasskeyBusy}
            disabled={isJoining}
            onClick={handlePasskeyOnboarding}
            leftIcon={<KeyRound className="h-4 w-4 text-[#0066cc]" />}
          >
            {isPasskeyBusy
              ? "Registering Passkey..."
              : "Register Passkey & Join"}
          </Button>
          <Link
            href="/split-groups"
            className="inline-flex h-10 w-full items-center justify-center rounded-pill border border-hairline bg-canvas px-5 text-[14px] font-medium text-ink transition-colors hover:bg-surface-pearl focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
          >
            Cancel
          </Link>
        </div>
      )}
    </Card>
  );
}
