"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AlertBanner, Badge, Button, Card } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { buildInviteJoinPath } from "@/lib/groups/invite-utils";
import type { GroupInvitePreview } from "@/lib/groups/onboarding";
import type { GroupType } from "@/types/database";

const GROUP_TYPE_LABEL: Record<
  GroupType,
  { label: string; tone: BadgeTone }
> = {
  RESIDENTIAL: { label: "Primary Residence", tone: "info" },
  TRIP: { label: "Seasonal Trip", tone: "warning" },
  RECURRING: { label: "Recurring Flat", tone: "neutral" },
};

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

  if (state.status === "invalid") {
    const isRevoked = state.code === "REVOKED";
    const isArchived = state.code === "GROUP_ARCHIVED";
    const title = isRevoked
      ? "Invitation link revoked"
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
  const joinPath = buildInviteJoinPath(invite.slug, token);
  const loginHref = `/login?next=${encodeURIComponent(joinPath)}`;

  const handleJoin = async () => {
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
          <span className="font-semibold text-ink">
            {invite.activeMemberCount}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-hairline pt-2.5 text-[13px]">
          <span className="text-ink-muted-48">Split mode</span>
          <Badge
            tone={invite.defaultSplitMode === "EQUAL" ? "info" : "warning"}
            size="sm"
          >
            {invite.defaultSplitMode === "EQUAL"
              ? "Equal Split (EQUAL)"
              : "Custom Ratios (CUSTOM_RATIOS)"}
          </Badge>
        </div>

        <div className="border-t border-hairline pt-2.5 text-[12px] leading-relaxed text-ink-muted-80">
          {invite.defaultSplitMode === "EQUAL" ? (
            <p className="flex items-start gap-2">
              <ShieldCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-[#0066cc]"
                aria-hidden="true"
              />
              <span>
                {invite.alreadyMember
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
        <div className="mt-5 flex flex-col gap-4">
          <p className="text-[13px] leading-relaxed text-ink-muted-48">
            Sign in with Magic Link or Google to accept this invitation and join{" "}
            <span className="font-medium text-ink">{invite.name}</span>.
          </p>
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
            onClick={handleJoin}
          >
            {isJoining ? "Joining Group..." : `Join ${invite.name}`}
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
