import { getCurrencyMinorDigits, isValidCurrencyCode } from "@/lib/money";
import type { ExpenseSplitMethod, SplitBreakdownItem } from "@/types/database";

export const EXPENSE_CATEGORIES = [
  "Groceries",
  "Housing & Utilities",
  "Dining & Social",
  "Travel & Fuel",
  "Supplies & Misc",
  "Entertainment",
  "General",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface PercentageParticipantInput {
  userId: string;
  percentage: number;
}

export interface ExactParticipantInput {
  userId: string;
  shareCents: number;
}

export interface SharesParticipantInput {
  userId: string;
  shares: number;
}

export type SplitComputationResult =
  | { ok: true; breakdown: SplitBreakdownItem[] }
  | { ok: false; code: string; message: string };

/**
 * Builds an index visitation sequence starting with payerIndex (when eligible)
 * followed by all other eligible indices in ascending order.
 */
function buildPayerFirstDistributionOrder(
  eligibleIndices: readonly number[],
  payerIndex: number,
): number[] {
  if (eligibleIndices.length === 0) return [];
  if (payerIndex >= 0 && eligibleIndices.includes(payerIndex)) {
    return [
      payerIndex,
      ...eligibleIndices.filter((idx) => idx !== payerIndex),
    ];
  }
  return [...eligibleIndices];
}

/**
 * Computes equal split in integer minor units with deterministic payer-first
 * penny-rounding. Guarantees SUM(share_cents) == amountCents.
 *
 * Example: $100.00 (10000 cents) split 3 ways assigns 3334 cents to payer and
 * 3333 cents to each non-payer.
 */
export function computeEqualSplit(params: {
  amountCents: number;
  paidBy: string;
  participantIds: readonly string[];
}): SplitBreakdownItem[] {
  const safeAmount = Math.trunc(params.amountCents);
  if (!Number.isSafeInteger(safeAmount)) {
    return [];
  }

  const seen = new Set<string>();
  const uniqueIds: string[] = [];
  for (const id of params.participantIds) {
    if (typeof id === "string" && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }

  const count = uniqueIds.length;
  if (count === 0) {
    return [];
  }

  const bigAmount = BigInt(safeAmount);
  const bigCount = BigInt(count);
  const baseShare = Number(bigAmount / bigCount);
  const shares = new Array<number>(count).fill(baseShare);
  let remainder = safeAmount - baseShare * count;

  const payerIndex = uniqueIds.indexOf(params.paidBy);
  const allIndices = uniqueIds.map((_, idx) => idx);
  const order = buildPayerFirstDistributionOrder(allIndices, payerIndex);

  let cursor = 0;
  while (remainder !== 0) {
    const step = remainder > 0 ? 1 : -1;
    const targetIdx = order[cursor % order.length];
    shares[targetIdx] += step;
    remainder -= step;
    cursor += 1;
  }

  // Deterministic 2-decimal percentages summing to 100.00% (10,000 bps)
  const baseBps = Math.floor(10_000 / count);
  const bpsShares = new Array<number>(count).fill(baseBps);
  let remBps = 10_000 - baseBps * count;
  let bpsCursor = 0;
  while (remBps > 0) {
    const targetIdx = order[bpsCursor % order.length];
    bpsShares[targetIdx] += 1;
    remBps -= 1;
    bpsCursor += 1;
  }

  return uniqueIds.map((userId, idx) => ({
    user_id: userId,
    share_cents: shares[idx],
    percentage: bpsShares[idx] / 100,
  }));
}

/**
 * Computes percentage split in integer minor units using basis points (10,000 bps = 100.00%)
 * and BigInt multiplication before division, assigning residual cent(s) to the payer
 * (if included with > 0%) or sequentially from participant index 0.
 */
export function computePercentageSplit(params: {
  amountCents: number;
  paidBy: string;
  participants: readonly PercentageParticipantInput[];
  allowNegative?: boolean;
}): SplitComputationResult {
  const safeAmount = Math.trunc(params.amountCents);
  if (
    !Number.isSafeInteger(safeAmount) ||
    safeAmount === 0 ||
    (!params.allowNegative && safeAmount < 0)
  ) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: params.allowNegative
        ? "Expense amount must be a non-zero integer in minor units."
        : "Expense amount must be a positive integer in minor units.",
    };
  }

  if (!Array.isArray(params.participants) || params.participants.length === 0) {
    return {
      ok: false,
      code: "NO_PARTICIPANTS",
      message: "Select at least one participant for the split.",
    };
  }

  const seen = new Set<string>();
  const bpsList: number[] = [];
  const cleanParticipants: PercentageParticipantInput[] = [];
  let totalBps = 0;

  for (const entry of params.participants) {
    if (!entry || typeof entry.userId !== "string" || !entry.userId) {
      return {
        ok: false,
        code: "INVALID_PARTICIPANT",
        message: "Invalid participant in split breakdown.",
      };
    }
    if (seen.has(entry.userId)) {
      return {
        ok: false,
        code: "DUPLICATE_PARTICIPANT",
        message: "Duplicate participant in split breakdown.",
      };
    }
    seen.add(entry.userId);

    const pct = entry.percentage;
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      return {
        ok: false,
        code: "INVALID_PERCENTAGE",
        message: "Percentages must be numbers between 0 and 100.",
      };
    }
    const scaled = pct * 100;
    const bps = Math.round(scaled);
    if (Math.abs(scaled - bps) > 1e-6) {
      return {
        ok: false,
        code: "INVALID_PERCENTAGE_PRECISION",
        message: "Percentages support up to 2 decimal places.",
      };
    }
    bpsList.push(bps);
    cleanParticipants.push({ userId: entry.userId, percentage: bps / 100 });
    totalBps += bps;
  }

  if (totalBps !== 10_000) {
    return {
      ok: false,
      code: "PERCENTAGE_SUM_MISMATCH",
      message: `Split percentages must sum to 100.00% (currently ${(totalBps / 100).toFixed(2)}%).`,
    };
  }

  const bigAmount = BigInt(safeAmount);
  const bigTenThousand = BigInt(10_000);
  const shares = bpsList.map((bps) =>
    Number((bigAmount * BigInt(bps)) / bigTenThousand),
  );
  const allocated = shares.reduce((sum, s) => sum + s, 0);
  let remainder = safeAmount - allocated;

  const nonZeroIndices = bpsList
    .map((bps, idx) => (bps > 0 ? idx : -1))
    .filter((idx) => idx >= 0);
  const eligibleIndices =
    nonZeroIndices.length > 0
      ? nonZeroIndices
      : cleanParticipants.map((_, idx) => idx);
  const payerIndex = cleanParticipants.findIndex(
    (p) => p.userId === params.paidBy,
  );
  const order = buildPayerFirstDistributionOrder(eligibleIndices, payerIndex);

  let cursor = 0;
  while (remainder !== 0 && order.length > 0) {
    const step = remainder > 0 ? 1 : -1;
    const targetIdx = order[cursor % order.length];
    shares[targetIdx] += step;
    remainder -= step;
    cursor += 1;
  }

  return {
    ok: true,
    breakdown: cleanParticipants.map((p, idx) => ({
      user_id: p.userId,
      share_cents: shares[idx],
      percentage: p.percentage,
    })),
  };
}

/**
 * Computes proportional shares split in integer minor units using BigInt floor
 * division (`floor(amount_cents * shares / total_shares)`) and deterministic
 * payer-first penny-rounding (assigning residual cent(s) to the payer if included
 * with > 0 shares, or sequentially from participant index 0).
 * Guarantees SUM(share_cents) == amountCents across all edge cases.
 */
export function computeSharesSplit(params: {
  amountCents: number;
  paidBy: string;
  participants: readonly SharesParticipantInput[];
  allowNegative?: boolean;
}): SplitComputationResult {
  const safeAmount = Math.trunc(params.amountCents);
  if (
    !Number.isSafeInteger(safeAmount) ||
    safeAmount === 0 ||
    (!params.allowNegative && safeAmount < 0)
  ) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: params.allowNegative
        ? "Expense amount must be a non-zero integer in minor units."
        : "Expense amount must be a positive integer in minor units.",
    };
  }

  if (!Array.isArray(params.participants) || params.participants.length === 0) {
    return {
      ok: false,
      code: "NO_PARTICIPANTS",
      message: "Select at least one participant for the split.",
    };
  }

  const SHARE_SCALE = 10_000;
  const seen = new Set<string>();
  const scaledWeights: bigint[] = [];
  const cleanParticipants: SharesParticipantInput[] = [];
  let totalWeight = BigInt(0);

  for (const entry of params.participants) {
    if (!entry || typeof entry.userId !== "string" || !entry.userId) {
      return {
        ok: false,
        code: "INVALID_PARTICIPANT",
        message: "Invalid participant in split breakdown.",
      };
    }
    if (seen.has(entry.userId)) {
      return {
        ok: false,
        code: "DUPLICATE_PARTICIPANT",
        message: "Duplicate participant in split breakdown.",
      };
    }
    seen.add(entry.userId);

    const rawShares = entry.shares;
    if (
      typeof rawShares !== "number" ||
      !Number.isFinite(rawShares) ||
      rawShares < 0
    ) {
      return {
        ok: false,
        code: "INVALID_SHARES",
        message: "Share weights must be non-negative numbers.",
      };
    }

    const scaled = rawShares * SHARE_SCALE;
    const rounded = Math.round(scaled);
    if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-4) {
      return {
        ok: false,
        code: "INVALID_SHARES_PRECISION",
        message: "Share weights support up to 4 decimal places.",
      };
    }

    const weightBig = BigInt(rounded);
    scaledWeights.push(weightBig);
    cleanParticipants.push({
      userId: entry.userId,
      shares: rounded / SHARE_SCALE,
    });
    totalWeight += weightBig;
  }

  if (totalWeight <= BigInt(0)) {
    return {
      ok: false,
      code: "INVALID_SHARES",
      message: "Total shares must be greater than zero.",
    };
  }

  const bigAmount = BigInt(safeAmount);
  const sharesCents = scaledWeights.map((weight) =>
    Number((bigAmount * weight) / totalWeight),
  );
  const allocated = sharesCents.reduce((sum, s) => sum + s, 0);
  let remainder = safeAmount - allocated;

  const nonZeroIndices = scaledWeights
    .map((weight, idx) => (weight > BigInt(0) ? idx : -1))
    .filter((idx) => idx >= 0);
  const payerIndex = cleanParticipants.findIndex(
    (p) => p.userId === params.paidBy,
  );
  const order = buildPayerFirstDistributionOrder(nonZeroIndices, payerIndex);

  let cursor = 0;
  while (remainder !== 0 && order.length > 0) {
    const step = remainder > 0 ? 1 : -1;
    const targetIdx = order[cursor % order.length];
    sharesCents[targetIdx] += step;
    remainder -= step;
    cursor += 1;
  }

  // Deterministic 2-decimal percentages summing to 100.00% (10,000 bps)
  const bigTenThousand = BigInt(10_000);
  const bpsShares = scaledWeights.map((weight) =>
    Number((bigTenThousand * weight) / totalWeight),
  );
  let remBps = 10_000 - bpsShares.reduce((sum, b) => sum + b, 0);
  let bpsCursor = 0;
  while (remBps > 0 && order.length > 0) {
    const targetIdx = order[bpsCursor % order.length];
    bpsShares[targetIdx] += 1;
    remBps -= 1;
    bpsCursor += 1;
  }

  return {
    ok: true,
    breakdown: cleanParticipants.map((p, idx) => ({
      user_id: p.userId,
      share_cents: sharesCents[idx],
      shares: p.shares,
      percentage: bpsShares[idx] / 100,
    })),
  };
}

/**
 * Validates and builds an exact minor-unit split breakdown.
 * Guarantees SUM(share_cents) == amountCents.
 */
export function computeExactSplit(params: {
  amountCents: number;
  participants: readonly ExactParticipantInput[];
  allowNegative?: boolean;
}): SplitComputationResult {
  const safeAmount = Math.trunc(params.amountCents);
  if (
    !Number.isSafeInteger(safeAmount) ||
    safeAmount === 0 ||
    (!params.allowNegative && safeAmount < 0)
  ) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: params.allowNegative
        ? "Expense amount must be a non-zero integer in minor units."
        : "Expense amount must be a positive integer in minor units.",
    };
  }

  if (!Array.isArray(params.participants) || params.participants.length === 0) {
    return {
      ok: false,
      code: "NO_PARTICIPANTS",
      message: "Select at least one participant for the split.",
    };
  }

  const seen = new Set<string>();
  const breakdown: SplitBreakdownItem[] = [];
  let sumCents = 0;

  for (const entry of params.participants) {
    if (!entry || typeof entry.userId !== "string" || !entry.userId) {
      return {
        ok: false,
        code: "INVALID_PARTICIPANT",
        message: "Invalid participant in split breakdown.",
      };
    }
    if (seen.has(entry.userId)) {
      return {
        ok: false,
        code: "DUPLICATE_PARTICIPANT",
        message: "Duplicate participant in split breakdown.",
      };
    }
    seen.add(entry.userId);

    const shareCents = entry.shareCents;
    if (
      !Number.isSafeInteger(shareCents) ||
      (safeAmount > 0 && shareCents < 0) ||
      (safeAmount < 0 && shareCents > 0)
    ) {
      return {
        ok: false,
        code: "INVALID_SHARE",
        message:
          safeAmount < 0
            ? "Exact split amounts for negative adjustments must be zero or negative integer minor units."
            : "Exact split amounts must be non-negative integer minor units.",
      };
    }

    sumCents += shareCents;
    breakdown.push({
      user_id: entry.userId,
      share_cents: shareCents,
    });
  }

  if (sumCents !== safeAmount) {
    return {
      ok: false,
      code: "SPLIT_SUM_MISMATCH",
      message: `Split breakdown (${sumCents}) must equal amount_cents (${safeAmount}).`,
    };
  }

  return { ok: true, breakdown };
}

/**
 * Server- and client-shared invariant validator for split_breakdown payloads.
 */
export function validateSplitBreakdown(params: {
  amountCents: number;
  splitMethod: ExpenseSplitMethod;
  splitBreakdown: readonly SplitBreakdownItem[];
  activeMemberIds: readonly string[];
  allowNegative?: boolean;
}): SplitComputationResult {
  const safeAmount = Math.trunc(params.amountCents);
  if (
    !Number.isSafeInteger(safeAmount) ||
    safeAmount === 0 ||
    (!params.allowNegative && safeAmount < 0)
  ) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      message: params.allowNegative
        ? "Expense amount_cents must be a non-zero integer."
        : "Expense amount_cents must be a positive integer.",
    };
  }

  if (
    params.splitMethod !== "EQUAL" &&
    params.splitMethod !== "PERCENTAGE" &&
    params.splitMethod !== "EXACT" &&
    params.splitMethod !== "SHARES"
  ) {
    return {
      ok: false,
      code: "INVALID_SPLIT_METHOD",
      message: "Split method must be EQUAL, PERCENTAGE, EXACT, or SHARES.",
    };
  }

  if (!Array.isArray(params.splitBreakdown) || params.splitBreakdown.length === 0) {
    return {
      ok: false,
      code: "NO_PARTICIPANTS",
      message: "Split breakdown must include at least one active group member.",
    };
  }

  const activeSet = new Set(params.activeMemberIds);
  const seen = new Set<string>();
  const normalized: SplitBreakdownItem[] = [];
  let sumCents = 0;
  let totalBps = 0;
  let hasPercentages = false;
  let totalShares = 0;
  let hasShares = false;

  for (const item of params.splitBreakdown) {
    if (!item || typeof item.user_id !== "string" || !item.user_id) {
      return {
        ok: false,
        code: "INVALID_SPLIT_PARTICIPANT",
        message: "Each split entry must reference a valid user_id.",
      };
    }

    if (!activeSet.has(item.user_id)) {
      return {
        ok: false,
        code: "INVALID_SPLIT_PARTICIPANT",
        message:
          "Former or non-group members cannot be included in new expense splits.",
      };
    }

    if (seen.has(item.user_id)) {
      return {
        ok: false,
        code: "DUPLICATE_PARTICIPANT",
        message: "Duplicate user_id in split breakdown.",
      };
    }
    seen.add(item.user_id);

    if (
      typeof item.share_cents !== "number" ||
      !Number.isSafeInteger(item.share_cents)
    ) {
      return {
        ok: false,
        code: "INVALID_SHARE",
        message: "Each share_cents value must be a safe integer.",
      };
    }

    if (safeAmount > 0 && item.share_cents < 0) {
      return {
        ok: false,
        code: "INVALID_SHARE",
        message: "Share amounts cannot be negative for standard expenses.",
      };
    }
    if (safeAmount < 0 && item.share_cents > 0) {
      return {
        ok: false,
        code: "INVALID_SHARE",
        message: "Share amounts cannot be positive for negative adjustments.",
      };
    }

    sumCents += item.share_cents;

    const normalizedItem: SplitBreakdownItem = {
      user_id: item.user_id,
      share_cents: item.share_cents,
    };

    if (item.percentage !== undefined) {
      hasPercentages = true;
      if (
        typeof item.percentage !== "number" ||
        !Number.isFinite(item.percentage) ||
        item.percentage < 0 ||
        item.percentage > 100
      ) {
        return {
          ok: false,
          code: "INVALID_PERCENTAGE",
          message: "Split percentages must be between 0 and 100.",
        };
      }
      totalBps += Math.round(item.percentage * 100);
      normalizedItem.percentage = Math.round(item.percentage * 100) / 100;
    }

    if (item.shares !== undefined) {
      hasShares = true;
      if (
        typeof item.shares !== "number" ||
        !Number.isFinite(item.shares) ||
        item.shares < 0
      ) {
        return {
          ok: false,
          code: "INVALID_SHARES",
          message: "Split shares must be non-negative numbers.",
        };
      }
      const cleanShares = Math.round(item.shares * 10_000) / 10_000;
      totalShares += cleanShares;
      normalizedItem.shares = cleanShares;
    }

    normalized.push(normalizedItem);
  }

  if (sumCents !== safeAmount) {
    return {
      ok: false,
      code: "SPLIT_SUM_MISMATCH",
      message: `Split breakdown (${sumCents}) must equal amount_cents (${safeAmount}).`,
    };
  }

  if (params.splitMethod === "PERCENTAGE" && hasPercentages && totalBps !== 10_000) {
    return {
      ok: false,
      code: "PERCENTAGE_SUM_MISMATCH",
      message: `Percentage split must sum to 100.00% (currently ${(totalBps / 100).toFixed(2)}%).`,
    };
  }

  if (params.splitMethod === "SHARES" && hasShares && totalShares <= 0) {
    return {
      ok: false,
      code: "INVALID_SHARES",
      message: "Total shares must be greater than zero.",
    };
  }

  return { ok: true, breakdown: normalized };
}

/**
 * Converts minor units between currencies using 1e6 fixed-point rate scaling
 * (used for display-only rollups in All Groups views).
 */
export function convertForeignAmountToBaseMinorUnits(params: {
  originalAmountCents: number;
  originalCurrency: string;
  exchangeRate: number;
  baseCurrency: string;
}): number | null {
  const { originalAmountCents, originalCurrency, exchangeRate, baseCurrency } =
    params;

  if (
    !Number.isSafeInteger(originalAmountCents) ||
    originalAmountCents <= 0 ||
    typeof exchangeRate !== "number" ||
    !Number.isFinite(exchangeRate) ||
    exchangeRate <= 0
  ) {
    return null;
  }

  const origCode = originalCurrency.trim().toUpperCase();
  const baseCode = baseCurrency.trim().toUpperCase();
  if (!isValidCurrencyCode(origCode) || !isValidCurrencyCode(baseCode)) {
    return null;
  }

  if (origCode === baseCode) {
    return originalAmountCents;
  }

  const rateScaled = Math.round(exchangeRate * 1_000_000);
  if (!Number.isSafeInteger(rateScaled) || rateScaled <= 0) {
    return null;
  }

  const origDigits = getCurrencyMinorDigits(origCode);
  const baseDigits = getCurrencyMinorDigits(baseCode);

  const bigTen = BigInt(10);
  const numerator =
    BigInt(originalAmountCents) *
    BigInt(rateScaled) *
    bigTen ** BigInt(baseDigits);
  const denominator = BigInt(1_000_000) * bigTen ** BigInt(origDigits);

  const rounded = (numerator + denominator / BigInt(2)) / denominator;
  const result = Number(rounded);
  if (!Number.isSafeInteger(result) || result <= 0) {
    return null;
  }
  return result;
}
