import {
  computeEqualSplit,
  computePercentageSplit,
} from "@/lib/expenses/split-engine";
import type { MemberStatus, SplitBreakdownItem, SplitMode } from "@/types/database";

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

  if (defaultSplitMode === "EQUAL") {
    return computeEqualSplit({
      amountCents: safeAmount,
      paidBy,
      participantIds: activeMembers.map((m) => m.userId),
    });
  }

  const pctResult = computePercentageSplit({
    amountCents: safeAmount,
    paidBy,
    participants: activeMembers.map((m) => ({
      userId: m.userId,
      percentage: m.sharePercentage,
    })),
  });
  if (pctResult.ok) {
    return pctResult.breakdown;
  }

  return computeEqualSplit({
    amountCents: safeAmount,
    paidBy,
    participantIds: activeMembers.map((m) => m.userId),
  });
}

export interface GroupMemberSplitCandidate {
  userId: string;
  status: MemberStatus;
  sharePercentage: number;
}

/**
 * Filters out FORMER_MEMBER accounts so they are strictly excluded from all
 * future default expense splits and recurring rule participant defaults.
 */
export function filterEligibleSplitMembers<
  T extends { status: MemberStatus },
>(members: readonly T[]): T[] {
  return members.filter((member) => member.status === "ACTIVE");
}

/**
 * Computes default expense/recurring split breakdown from full group membership,
 * guaranteeing FORMER_MEMBER entries are excluded while preserving Zero Penny-Bleed.
 */
export function buildDefaultSplitExcludingFormerMembers(params: {
  amountCents: number;
  paidBy: string;
  defaultSplitMode: SplitMode;
  members: readonly GroupMemberSplitCandidate[];
}): SplitBreakdownItem[] {
  const activeMembers = filterEligibleSplitMembers(params.members);
  return buildDefaultSplitBreakdownFromGroup({
    amountCents: params.amountCents,
    paidBy: params.paidBy,
    defaultSplitMode: params.defaultSplitMode,
    activeMembers,
  });
}

export interface MemberShareUnitsInput {
  userId: string;
  shareUnits: number;
}

export type ValidateShareUnitsResult =
  | {
      ok: true;
      unitsByUser: Map<string, number>;
      percentagesByUser: Map<string, number>;
    }
  | { ok: false; message: string };

/**
 * Validates proportional share units across all active members (non-negative,
 * positive total) and computes normalized share percentages summing strictly
 * to 100.00% using integer basis points.
 */
export function validateShareUnits(
  allocations: readonly MemberShareUnitsInput[],
  activeMemberIds: readonly string[],
): ValidateShareUnitsResult {
  if (activeMemberIds.length === 0) {
    return { ok: false, message: "Group has no active members to allocate." };
  }

  const activeSet = new Set(activeMemberIds);
  const unitsByUser = new Map<string, number>();

  for (const entry of allocations) {
    if (!entry || typeof entry.userId !== "string") {
      return { ok: false, message: "Invalid member share allocation entry." };
    }
    if (!activeSet.has(entry.userId)) {
      return {
        ok: false,
        message: "Allocations may only include active group members.",
      };
    }
    if (unitsByUser.has(entry.userId)) {
      return {
        ok: false,
        message: "Duplicate member share allocation provided.",
      };
    }

    const rawUnits = entry.shareUnits;
    if (typeof rawUnits !== "number" || !Number.isFinite(rawUnits)) {
      return {
        ok: false,
        message: "Each member share weight must be a valid number.",
      };
    }
    if (rawUnits < 0) {
      return {
        ok: false,
        message: "Share weights must be zero or greater.",
      };
    }
    unitsByUser.set(entry.userId, Math.round(rawUnits * 10000) / 10000);
  }

  for (const activeId of activeMemberIds) {
    if (!unitsByUser.has(activeId)) {
      return {
        ok: false,
        message: "Every active group member must have an assigned share weight.",
      };
    }
  }

  let totalUnits = 0;
  for (const activeId of activeMemberIds) {
    totalUnits += unitsByUser.get(activeId) ?? 0;
  }

  if (totalUnits <= 0) {
    return {
      ok: false,
      message: "Total share weights must be greater than zero.",
    };
  }

  const totalBps = 10_000;
  const percentagesByUser = new Map<string, number>();
  let assignedBps = 0;

  activeMemberIds.forEach((memberId) => {
    const units = unitsByUser.get(memberId) ?? 0;
    const bps = Math.floor((totalBps * units) / totalUnits);
    percentagesByUser.set(memberId, bps);
    assignedBps += bps;
  });

  let remainder = totalBps - assignedBps;
  for (const memberId of activeMemberIds) {
    if (remainder <= 0) break;
    if ((unitsByUser.get(memberId) ?? 0) > 0) {
      percentagesByUser.set(
        memberId,
        (percentagesByUser.get(memberId) ?? 0) + 1,
      );
      remainder -= 1;
    }
  }

  for (const memberId of activeMemberIds) {
    percentagesByUser.set(
      memberId,
      (percentagesByUser.get(memberId) ?? 0) / 100,
    );
  }

  return { ok: true, unitsByUser, percentagesByUser };
}
