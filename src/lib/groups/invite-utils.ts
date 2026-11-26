import type { SplitBreakdownItem, SplitMode } from "@/types/database";

export function buildInviteJoinPath(slug: string, token: string): string {
  const safeSlug = encodeURIComponent(slug);
  const safeToken = encodeURIComponent(token);
  return `/join/${safeSlug}?token=${safeToken}`;
}

export function buildInviteJoinUrl(
  slug: string,
  token: string,
  origin?: string,
): string {
  const path = buildInviteJoinPath(slug, token);
  const resolvedOrigin = (
    origin ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://ledgersplit.app"
  ).replace(/\/+$/, "");

  return `${resolvedOrigin}${path}`;
}

/**
 * Computes equal share percentages for N active members using integer basis points
 * (100.00% = 10,000 bps) so shares sum strictly to 100.00% with no floating-point drift.
 */
export function computeEqualSharePercentages(
  memberIds: readonly string[],
): Map<string, number> {
  const result = new Map<string, number>();
  const count = memberIds.length;
  if (count === 0) {
    return result;
  }

  const totalBps = 10_000;
  const baseBps = Math.floor(totalBps / count);
  const remainderBps = totalBps % count;

  memberIds.forEach((memberId, index) => {
    const memberBps = baseBps + (index < remainderBps ? 1 : 0);
    result.set(memberId, memberBps / 100);
  });

  return result;
}

export interface MemberRatioInput {
  userId: string;
  sharePercentage: number;
}

export type ValidateCustomRatiosResult =
  | { ok: true; normalized: Map<string, number> }
  | { ok: false; message: string };

/**
 * Validates that custom ratio allocations cover all active members,
 * stay within [0, 100] with at most 2 decimal places, and sum strictly to 100.00%.
 */
export function validateCustomRatios(
  allocations: readonly MemberRatioInput[],
  activeMemberIds: readonly string[],
): ValidateCustomRatiosResult {
  if (activeMemberIds.length === 0) {
    return { ok: false, message: "Group has no active members to allocate." };
  }

  const activeSet = new Set(activeMemberIds);
  const byUser = new Map<string, number>();
  let totalBps = 0;

  for (const entry of allocations) {
    if (!entry || typeof entry.userId !== "string") {
      return { ok: false, message: "Invalid member allocation entry." };
    }
    if (!activeSet.has(entry.userId)) {
      return {
        ok: false,
        message: "Allocations may only include active group members.",
      };
    }
    if (byUser.has(entry.userId)) {
      return {
        ok: false,
        message: "Duplicate member allocation provided.",
      };
    }

    const rawPct = entry.sharePercentage;
    if (typeof rawPct !== "number" || !Number.isFinite(rawPct)) {
      return {
        ok: false,
        message: "Each member share percentage must be a valid number.",
      };
    }
    if (rawPct < 0 || rawPct > 100) {
      return {
        ok: false,
        message: "Share percentages must be between 0% and 100%.",
      };
    }

    const scaled = rawPct * 100;
    const bps = Math.round(scaled);
    if (Math.abs(scaled - bps) > 1e-6) {
      return {
        ok: false,
        message: "Share percentages support up to 2 decimal places.",
      };
    }

    byUser.set(entry.userId, bps / 100);
    totalBps += bps;
  }

  for (const activeId of activeMemberIds) {
    if (!byUser.has(activeId)) {
      return {
        ok: false,
        message: "Every active group member must have an assigned share percentage.",
      };
    }
  }

  if (totalBps !== 10_000) {
    const currentTotal = (totalBps / 100).toFixed(2);
    return {
      ok: false,
      message: `Active member shares must sum to 100.00% (currently ${currentTotal}%).`,
    };
  }

  return { ok: true, normalized: byUser };
}

/**
 * Computes a deterministic integer-cents SplitBreakdownItem[] for a future expense
 * from the group's current defaultSplitMode and active member ratios.
 * Enforces Zero Penny-Bleed Conservation Law: SUM(share_cents) == amountCents.
 */
export function buildDefaultSplitBreakdownFromGroup(params: {
  amountCents: number;
  paidBy: string;
  defaultSplitMode: SplitMode;
  activeMembers: ReadonlyArray<{ userId: string; sharePercentage: number }>;
}): SplitBreakdownItem[] {
  const { amountCents, paidBy, defaultSplitMode, activeMembers } = params;
  const safeAmount = Math.trunc(amountCents);
  const count = activeMembers.length;
  if (count === 0) return [];

  const memberIds = activeMembers.map((m) => m.userId);
  const equalMap =
    defaultSplitMode === "EQUAL"
      ? computeEqualSharePercentages(memberIds)
      : null;

  const sharesBps = activeMembers.map((member) => {
    const pct =
      defaultSplitMode === "EQUAL"
        ? (equalMap?.get(member.userId) ?? 0)
        : member.sharePercentage;
    return Math.max(0, Math.round(pct * 100));
  });

  const totalBps = sharesBps.reduce((sum, bps) => sum + bps, 0) || 10_000;
  const flooredShares = sharesBps.map((bps) =>
    Math.floor((safeAmount * bps) / totalBps),
  );
  const allocatedSum = flooredShares.reduce((sum, val) => sum + val, 0);
  let remainder = safeAmount - allocatedSum;

  const payerIndex = memberIds.indexOf(paidBy);
  if (remainder !== 0 && payerIndex >= 0) {
    const step = remainder > 0 ? 1 : -1;
    flooredShares[payerIndex] += step;
    remainder -= step;
  }

  let cursor = 0;
  while (remainder !== 0) {
    const step = remainder > 0 ? 1 : -1;
    flooredShares[cursor % count] += step;
    remainder -= step;
    cursor += 1;
  }

  return activeMembers.map((member, index) => ({
    user_id: member.userId,
    share_cents: flooredShares[index],
    percentage: sharesBps[index] / 100,
  }));
}
