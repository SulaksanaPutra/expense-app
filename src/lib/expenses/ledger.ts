import { parseCycleParam } from "@/components/shell/url-state";
import {
  convertMinorUnitsToCurrency,
  formatMinorUnits,
  formatMinorUnitsDecimal,
} from "@/lib/money";
import {
  computeGroupMemberNetBalances,
  computeMemberNetBalancesFromEdges,
  computeMultiGroupDebtEdges,
  computePairwiseGroupDebtEdges,
  computePerGroupDebtEdges,
  simplifyBipartiteGroupDebts,
  type SimplifiedDebtEdge,
} from "./debt-simplification";

export {
  computeGroupMemberNetBalances,
  computeMemberNetBalancesFromEdges,
  computeMultiGroupDebtEdges,
  computePairwiseGroupDebtEdges,
  computePerGroupDebtEdges,
  simplifyBipartiteGroupDebts,
  type SimplifiedDebtEdge,
};

function getBillingCycleWindowLocal(
  cycleSlug: string,
  anchorDay = 1,
): { startMs: number; endMs: number } {
  const safeCycle = parseCycleParam(cycleSlug);
  const [yearStr, monthStr] = safeCycle.split("-");
  const year = Number.parseInt(yearStr, 10);
  const monthIdx = Number.parseInt(monthStr, 10) - 1;
  const clampedAnchor = Math.min(Math.max(Math.trunc(anchorDay), 1), 28);

  const startMs = Date.UTC(year, monthIdx, clampedAnchor, 0, 0, 0, 0);
  const endMs = Date.UTC(year, monthIdx + 1, clampedAnchor, 0, 0, 0, 0);
  return { startMs, endMs };
}
import type {
  BillingCycleStatus,
  ExpenseSplitMethod,
  GroupStatus,
  MemberRole,
  MemberStatus,
  SplitBreakdownItem,
  SplitMode,
} from "@/types/database";

export type ExpenseOwnershipFilter = "all" | "paid-by-me" | "split-with-me";

export type ExpenseStatusFilter = "all" | "settled" | "pending";

export type ExpenseLedgerTab = ExpenseOwnershipFilter;

export type ExpenseSortOption =
  | "date-desc"
  | "date-asc"
  | "amount-desc"
  | "amount-asc"
  | "share-desc";

export interface ExpenseGroupMemberInfo {
  userId: string;
  name: string;
  status: MemberStatus;
  instantSettlementTag: string | null;
}

export interface ExpenseGroupInfo {
  id: string;
  name: string;
  slug: string;
  status: GroupStatus;
  baseCurrency: string;
  defaultSplitMode: SplitMode;
  simplifyDebts: boolean;
  operationalBudgetCents: number | null;
  billingCycleAnchorDay: number;
  cycleResetDay?: number;
  autoSettleOnReset?: boolean;
  currentUserRole: MemberRole | null;
  currentUserStatus?: MemberStatus | null;
  members: ExpenseGroupMemberInfo[];
}

export interface ExpenseBillingCycleRecord {
  id: string;
  groupId: string;
  periodStart: string;
  periodEnd: string;
  status: BillingCycleStatus;
}

export interface ExpenseSettlementRecord {
  id: string;
  groupId: string;
  payerId: string;
  recipientId: string;
  amountCents: number;
  currency: string;
  settledAt: string;
}

export interface ExpenseLedgerRecord {
  id: string;
  groupId: string;
  groupName: string;
  groupBaseCurrency: string;
  groupBillingAnchorDay: number;
  createdBy: string;
  paidBy: string;
  payerName: string;
  description: string;
  category: string;
  expenseDate: string;
  amountCents: number;
  currency: string;
  originalAmountCents: number | null;
  originalCurrency: string | null;
  exchangeRate: number | null;
  exchangeRateSource: "API" | "MANUAL_OVERRIDE" | null;
  splitMethod: ExpenseSplitMethod;
  splitBreakdown: SplitBreakdownItem[];
  receiptUrl: string | null;
  isRecurringGenerated: boolean;
  recurringRuleId: string | null;
  adjustmentForExpenseId: string | null;
  isLocked: boolean;
  isCycleClosed: boolean;
  isSettledByWatermark: boolean;
  isSettledForUser: boolean;
}

export interface CategoryTotalItem {
  category: string;
  amountCents: number;
  count: number;
}

export interface ExpensesKpiSummary {
  totalGroupExpensesCents: number;
  previousCycleExpensesCents: number;
  momDeltaPercent: number | null;
  transactionCount: number;
  activeMemberCount: number;
  personalShareCents: number;
  personalShareOfTotalPercent: number;
  personalShareCapCents: number | null;
  personalCapPercent: number | null;
  unsettledTotalCents: number;
  pendingItemsCount: number;
  pendingPeerCount: number;
  youOweCount: number;
  youOwePeerCount: number;
  youOweCents: number;
  owedToYouCount: number;
  owedToYouCents: number;
  netSettlementCents: number;
  operationalBudgetCents: number | null;
  budgetUtilizationPercent: number | null;
  displayCurrency: string;
  hasMixedCurrencies: boolean;
  isFxRolledUp: boolean;
  nextSettlementDateIso: string;
  nextSettlementDateLabel: string;
  categoryTotals: CategoryTotalItem[];
}

export function getCycleSlugForDate(
  isoDate: string,
  anchorDay = 1,
): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const safeAnchor = Math.min(Math.max(Math.trunc(anchorDay), 1), 28);
  let year = parsed.getUTCFullYear();
  let month = parsed.getUTCMonth(); // 0-based
  const day = parsed.getUTCDate();
  if (day < safeAnchor) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function getNextGroupSettlementDate(
  anchorDay = 1,
  referenceDate: Date = new Date(),
): { isoDate: string; label: string } {
  const safeAnchor = Math.min(Math.max(Math.trunc(anchorDay), 1), 28);
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const day = referenceDate.getUTCDate();

  let targetYear = year;
  let targetMonth = month;
  if (day >= safeAnchor) {
    targetMonth += 1;
    if (targetMonth > 11) {
      targetMonth = 0;
      targetYear += 1;
    }
  }

  const target = new Date(Date.UTC(targetYear, targetMonth, safeAnchor));
  const isoDate = target.toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(target);

  return { isoDate, label };
}

export function getBillingCycleDateRange(
  cycleSlug: string,
  anchorDay = 1,
): { periodStart: string; periodEnd: string } {
  const safeCycle = parseCycleParam(cycleSlug);
  const [yearStr, monthStr] = safeCycle.split("-");
  const year = Number.parseInt(yearStr, 10);
  const monthIdx = Number.parseInt(monthStr, 10) - 1;
  const clampedAnchor = Math.min(Math.max(Math.trunc(anchorDay), 1), 28);

  const startMs = Date.UTC(year, monthIdx, clampedAnchor, 0, 0, 0, 0);
  const endInclusiveMs = Date.UTC(
    year,
    monthIdx + 1,
    clampedAnchor - 1,
    0,
    0,
    0,
    0,
  );
  return {
    periodStart: new Date(startMs).toISOString().slice(0, 10),
    periodEnd: new Date(endInclusiveMs).toISOString().slice(0, 10),
  };
}

export function isExpenseInCycleWindow(
  expenseDateIso: string,
  cycleSlug: string,
  anchorDay = 1,
): boolean {
  const expMs = Date.parse(expenseDateIso);
  if (!Number.isFinite(expMs)) return false;
  const { startMs, endMs } = getBillingCycleWindowLocal(cycleSlug, anchorDay);
  return expMs >= startMs && expMs < endMs;
}

export function isBillingCycleClosedForWindow(
  groupId: string,
  cycleSlug: string,
  anchorDay: number,
  billingCycles: readonly ExpenseBillingCycleRecord[],
): boolean {
  const { startMs, endMs } = getBillingCycleWindowLocal(cycleSlug, anchorDay);
  const windowStartIso = new Date(startMs).toISOString().slice(0, 10);
  const windowEndIso = new Date(endMs).toISOString().slice(0, 10);

  return billingCycles.some((bc) => {
    if (bc.groupId !== groupId || bc.status !== "CLOSED") return false;
    const bcStart = bc.periodStart.slice(0, 10);
    const bcEnd = bc.periodEnd.slice(0, 10);
    return (
      (bcStart <= windowStartIso && bcEnd >= windowStartIso) ||
      (bcStart < windowEndIso && bcEnd >= windowEndIso) ||
      (bcStart >= windowStartIso && bcStart < windowEndIso)
    );
  });
}

export function evaluateExpenseLockAndSettlement(params: {
  expense: {
    id: string;
    groupId: string;
    paidBy: string;
    expenseDate: string;
    isLocked: boolean;
    splitBreakdown: readonly SplitBreakdownItem[];
  };
  currentUserId: string;
  billingCycles: readonly ExpenseBillingCycleRecord[];
  settlements: readonly ExpenseSettlementRecord[];
}): {
  isCycleClosed: boolean;
  isSettledByWatermark: boolean;
  isLocked: boolean;
  isSettledForUser: boolean;
} {
  const { expense, currentUserId, billingCycles, settlements } = params;
  const expMs = Date.parse(expense.expenseDate);
  const expDateStr = Number.isFinite(expMs)
    ? new Date(expMs).toISOString().slice(0, 10)
    : "";

  const isCycleClosed = billingCycles.some((bc) => {
    if (bc.groupId !== expense.groupId || bc.status !== "CLOSED") return false;
    if (!expDateStr) return false;
    const start = bc.periodStart.slice(0, 10);
    const end = bc.periodEnd.slice(0, 10);
    return expDateStr >= start && expDateStr <= end;
  });

  const participantIds = new Set<string>([expense.paidBy]);
  for (const part of expense.splitBreakdown) {
    if (part && typeof part.user_id === "string" && part.share_cents !== 0) {
      participantIds.add(part.user_id);
    }
  }

  let isSettledByWatermark = false;
  let userWatermarkSettled = false;

  for (const s of settlements) {
    if (s.groupId !== expense.groupId) continue;
    const settledMs = Date.parse(s.settledAt);
    if (!Number.isFinite(settledMs) || !Number.isFinite(expMs)) continue;
    if (settledMs < expMs) continue;

    if (participantIds.has(s.payerId) && participantIds.has(s.recipientId)) {
      isSettledByWatermark = true;
      if (
        expense.paidBy === currentUserId ||
        s.payerId === currentUserId ||
        s.recipientId === currentUserId
      ) {
        userWatermarkSettled = true;
      }
    }
  }

  const userShare =
    expense.splitBreakdown.find((b) => b.user_id === currentUserId)
      ?.share_cents ?? 0;

  let isSettledForUser = false;
  if (isCycleClosed || userWatermarkSettled) {
    isSettledForUser = true;
  } else if (expense.paidBy !== currentUserId && userShare === 0) {
    isSettledForUser = true;
  } else if (
    expense.paidBy === currentUserId &&
    expense.splitBreakdown.every(
      (b) => b.user_id === currentUserId || b.share_cents === 0,
    )
  ) {
    isSettledForUser = true;
  }

  return {
    isCycleClosed,
    isSettledByWatermark,
    isLocked: expense.isLocked || isCycleClosed || isSettledByWatermark,
    isSettledForUser,
  };
}

export function getUserShareCents(
  expense: Pick<ExpenseLedgerRecord, "splitBreakdown">,
  userId: string,
): number {
  const entry = expense.splitBreakdown.find((item) => item.user_id === userId);
  return entry ? Math.trunc(entry.share_cents) : 0;
}

export function matchesExpenseCategory(
  expenseCategory: string,
  selectedCategory: string,
): boolean {
  if (!selectedCategory || selectedCategory === "all") return true;
  const expLower = expenseCategory.trim().toLowerCase();
  const selLower = selectedCategory.trim().toLowerCase();
  if (expLower === selLower) return true;
  if (selLower === "groceries") return expLower.includes("grocer");
  if (selLower === "utilities") return expLower.includes("utilit");
  if (selLower === "dining") {
    return expLower.includes("dining") || expLower.includes("food & drink");
  }
  if (selLower === "travel") {
    return (
      expLower.includes("travel") ||
      expLower.includes("transit") ||
      expLower.includes("transport")
    );
  }
  return false;
}

export function filterAndSortExpenses(params: {
  expenses: readonly ExpenseLedgerRecord[];
  activeGroupId: string;
  cycleSlug: string;
  currentUserId: string;
  tab?: ExpenseLedgerTab;
  ownership?: ExpenseOwnershipFilter;
  status?: ExpenseStatusFilter;
  searchQuery: string;
  category: string;
  sortBy: ExpenseSortOption;
}): ExpenseLedgerRecord[] {
  const {
    expenses,
    activeGroupId,
    cycleSlug,
    currentUserId,
    tab,
    ownership,
    status = "all",
    searchQuery,
    category,
    sortBy,
  } = params;

  const effectiveOwnership: ExpenseOwnershipFilter = ownership ?? tab ?? "all";
  const q = searchQuery.trim().toLowerCase();
  const safeCycle = parseCycleParam(cycleSlug);

  const filtered = expenses.filter((exp) => {
    if (activeGroupId !== "all" && exp.groupId !== activeGroupId) {
      return false;
    }

    if (!isExpenseInCycleWindow(exp.expenseDate, safeCycle, exp.groupBillingAnchorDay)) {
      return false;
    }

    if (effectiveOwnership === "paid-by-me" && exp.paidBy !== currentUserId) {
      return false;
    }

    if (effectiveOwnership === "split-with-me") {
      const userShare = getUserShareCents(exp, currentUserId);
      if (exp.paidBy === currentUserId || userShare === 0) {
        return false;
      }
    }

    const isSettled = exp.isSettledForUser || exp.isLocked;
    if (status === "settled" && !isSettled) {
      return false;
    }
    if (status === "pending" && isSettled) {
      return false;
    }

    if (!matchesExpenseCategory(exp.category, category)) {
      return false;
    }

    if (q) {
      const haystack = [
        exp.description,
        exp.category,
        exp.payerName,
        exp.groupName,
        exp.originalCurrency ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) {
        return false;
      }
    }

    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case "date-asc": {
        return Date.parse(a.expenseDate) - Date.parse(b.expenseDate) || a.id.localeCompare(b.id);
      }
      case "amount-desc": {
        return b.amountCents - a.amountCents || Date.parse(b.expenseDate) - Date.parse(a.expenseDate);
      }
      case "amount-asc": {
        return a.amountCents - b.amountCents || Date.parse(b.expenseDate) - Date.parse(a.expenseDate);
      }
      case "share-desc": {
        const shareA = getUserShareCents(a, currentUserId);
        const shareB = getUserShareCents(b, currentUserId);
        return shareB - shareA || Date.parse(b.expenseDate) - Date.parse(a.expenseDate);
      }
      case "date-desc":
      default: {
        return Date.parse(b.expenseDate) - Date.parse(a.expenseDate) || b.id.localeCompare(a.id);
      }
    }
  });

  return sorted;
}

export function stepCycleSlugSafe(cycleSlug: string, deltaMonths: number): string {
  const safe = parseCycleParam(cycleSlug);
  const [yStr, mStr] = safe.split("-");
  const d = new Date(
    Date.UTC(Number.parseInt(yStr, 10), Number.parseInt(mStr, 10) - 1 + deltaMonths, 1),
  );
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function computeExpensesKpiSummary(params: {
  expenses: readonly ExpenseLedgerRecord[];
  groups: readonly ExpenseGroupInfo[];
  settlements: readonly ExpenseSettlementRecord[];
  activeGroupId: string;
  cycleSlug: string;
  currentUserId: string;
  userBaseCurrency: string;
  personalShareCapCents: number | null;
  fxRates?: Readonly<Record<string, number>>;
  referenceDate?: Date;
}): ExpensesKpiSummary {
  const {
    expenses,
    groups,
    settlements,
    activeGroupId,
    cycleSlug,
    currentUserId,
    userBaseCurrency,
    personalShareCapCents,
    fxRates,
    referenceDate = new Date(),
  } = params;

  const isAllGroups = activeGroupId === "all";
  const scopedGroups = isAllGroups
    ? groups
    : groups.filter((g) => g.id === activeGroupId);

  const normalizedUserCurrency = (userBaseCurrency || "USD").trim().toUpperCase();
  const currencies = Array.from(
    new Set(scopedGroups.map((g) => (g.baseCurrency || "USD").trim().toUpperCase())),
  );
  const hasMixedCurrencies = currencies.length > 1;
  const displayCurrency = isAllGroups
    ? normalizedUserCurrency
    : (scopedGroups[0]?.baseCurrency || normalizedUserCurrency).trim().toUpperCase();
  const isFxRolledUp =
    isAllGroups && currencies.some((code) => code !== displayCurrency);

  const toDisplayMinorUnits = (amountMinor: number, sourceCurrency: string): number => {
    if (!isAllGroups) return Math.trunc(amountMinor);
    return convertMinorUnitsToCurrency(
      amountMinor,
      sourceCurrency || displayCurrency,
      displayCurrency,
      fxRates,
    );
  };

  const prevCycleSlug = stepCycleSlugSafe(cycleSlug, -1);

  let totalGroupExpensesCents = 0;
  let previousCycleExpensesCents = 0;
  let transactionCount = 0;
  let personalShareCents = 0;
  let pendingItemsCount = 0;
  const pendingExpensePeers = new Set<string>();

  const categoryTotalsMap = new Map<string, { amountCents: number; count: number }>();

  for (const exp of expenses) {
    if (!isAllGroups && exp.groupId !== activeGroupId) continue;

    const expCurrency = (exp.groupBaseCurrency || exp.currency || displayCurrency)
      .trim()
      .toUpperCase();

    if (isExpenseInCycleWindow(exp.expenseDate, cycleSlug, exp.groupBillingAnchorDay)) {
      const convertedAmount = toDisplayMinorUnits(exp.amountCents, expCurrency);
      const convertedShare = toDisplayMinorUnits(
        getUserShareCents(exp, currentUserId),
        expCurrency,
      );
      totalGroupExpensesCents += convertedAmount;
      transactionCount += 1;
      personalShareCents += convertedShare;
      if (!exp.isSettledForUser && !exp.isLocked) {
        pendingItemsCount += 1;
        if (exp.paidBy !== currentUserId) {
          pendingExpensePeers.add(exp.paidBy);
        } else {
          for (const part of exp.splitBreakdown) {
            if (part.user_id !== currentUserId && part.share_cents !== 0) {
              pendingExpensePeers.add(part.user_id);
            }
          }
        }
      }

      const catEntry = categoryTotalsMap.get(exp.category) ?? {
        amountCents: 0,
        count: 0,
      };
      catEntry.amountCents += convertedAmount;
      catEntry.count += 1;
      categoryTotalsMap.set(exp.category, catEntry);
    } else if (
      isExpenseInCycleWindow(exp.expenseDate, prevCycleSlug, exp.groupBillingAnchorDay)
    ) {
      previousCycleExpensesCents += toDisplayMinorUnits(exp.amountCents, expCurrency);
    }
  }

  const momDeltaPercent =
    previousCycleExpensesCents > 0
      ? Math.round(
          ((totalGroupExpensesCents - previousCycleExpensesCents) /
            previousCycleExpensesCents) *
            1000,
        ) / 10
      : null;

  const personalShareOfTotalPercent =
    totalGroupExpensesCents > 0
      ? Math.round((personalShareCents / totalGroupExpensesCents) * 1000) / 10
      : 0;

  const personalCapPercent =
    personalShareCapCents !== null && personalShareCapCents > 0
      ? Math.round((personalShareCents / personalShareCapCents) * 1000) / 10
      : null;

  const uniqueMemberIds = new Set<string>();
  let totalOperationalBudgetCents = 0;
  let hasAnyOperationalBudget = false;
  for (const g of scopedGroups) {
    if (g.operationalBudgetCents !== null && g.operationalBudgetCents > 0) {
      hasAnyOperationalBudget = true;
      totalOperationalBudgetCents += toDisplayMinorUnits(
        g.operationalBudgetCents,
        g.baseCurrency,
      );
    }
    for (const m of g.members) {
      if (m.status === "ACTIVE") {
        uniqueMemberIds.add(m.userId);
      }
    }
  }

  const operationalBudgetCents = hasAnyOperationalBudget
    ? totalOperationalBudgetCents
    : null;
  const budgetUtilizationPercent =
    operationalBudgetCents !== null && operationalBudgetCents > 0
      ? Math.round((totalGroupExpensesCents / operationalBudgetCents) * 1000) / 10
      : null;

  let youOweCents = 0;
  let youOweCount = 0;
  let owedToYouCents = 0;
  let owedToYouCount = 0;
  const youOwePeers = new Set<string>();
  const pendingDebtPeers = new Set<string>();

  for (const group of scopedGroups) {
    const edges = computePerGroupDebtEdges({
      group,
      expenses,
      settlements,
    });
    for (const edge of edges) {
      const convertedEdgeCents = toDisplayMinorUnits(
        edge.amountCents,
        edge.currency || group.baseCurrency,
      );
      if (edge.payerId === currentUserId) {
        youOweCents += convertedEdgeCents;
        youOweCount += 1;
        youOwePeers.add(edge.recipientId);
        pendingDebtPeers.add(edge.recipientId);
      } else if (edge.recipientId === currentUserId) {
        owedToYouCents += convertedEdgeCents;
        owedToYouCount += 1;
        pendingDebtPeers.add(edge.payerId);
      }
    }
  }

  const netSettlementCents = owedToYouCents - youOweCents;
  const unsettledTotalCents = youOweCents + owedToYouCents;
  const resolvedPendingItemsCount =
    pendingItemsCount > 0 ? pendingItemsCount : youOweCount + owedToYouCount;
  const pendingPeerCount =
    pendingDebtPeers.size > 0 ? pendingDebtPeers.size : pendingExpensePeers.size;

  const autoSettleGroups = scopedGroups.filter(
    (g) => g.autoSettleOnReset !== false,
  );
  const candidateResetGroups =
    autoSettleGroups.length > 0 ? autoSettleGroups : scopedGroups;
  const nextSettlement =
    candidateResetGroups.length > 0
      ? candidateResetGroups
          .map((g) =>
            getNextGroupSettlementDate(
              g.cycleResetDay ?? g.billingCycleAnchorDay ?? 1,
              referenceDate,
            ),
          )
          .sort((a, b) => a.isoDate.localeCompare(b.isoDate))[0]
      : getNextGroupSettlementDate(1, referenceDate);

  const categoryTotals = Array.from(categoryTotalsMap.entries())
    .map(([category, data]) => ({
      category,
      amountCents: data.amountCents,
      count: data.count,
    }))
    .sort((a, b) => b.amountCents - a.amountCents || a.category.localeCompare(b.category));

  return {
    totalGroupExpensesCents,
    previousCycleExpensesCents,
    momDeltaPercent,
    transactionCount,
    activeMemberCount: uniqueMemberIds.size,
    personalShareCents,
    personalShareOfTotalPercent,
    personalShareCapCents,
    personalCapPercent,
    unsettledTotalCents,
    pendingItemsCount: resolvedPendingItemsCount,
    pendingPeerCount,
    youOweCount,
    youOwePeerCount: youOwePeers.size,
    youOweCents,
    owedToYouCount,
    owedToYouCents,
    netSettlementCents,
    operationalBudgetCents,
    budgetUtilizationPercent,
    displayCurrency,
    hasMixedCurrencies,
    isFxRolledUp,
    nextSettlementDateIso: nextSettlement.isoDate,
    nextSettlementDateLabel: nextSettlement.label,
    categoryTotals,
  };
}

export function escapeCsvCell(value: string): string {
  const isSafeNegativeNumberOrCurrency =
    /^-\d+(?:\.\d+)?$/.test(value) ||
    /^-(?:[$€£¥₹]|CA\$|A\$|CHF\s?)\d/.test(value);
  const safe =
    !isSafeNegativeNumberOrCurrency && /^[=+\-@\t\r]/.test(value)
      ? `'${value}`
      : value;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

export function buildExpensesCsv(
  expenses: readonly ExpenseLedgerRecord[],
  currentUserId: string,
): string {
  const headers = [
    "Date",
    "Group",
    "Description",
    "Category",
    "Paid By",
    "Split Method",
    "Your Share",
    "Total Amount",
    "Currency",
    "Original Amount",
    "Original Currency",
    "Exchange Rate",
    "Exchange Rate Source",
    "Status",
    "Total Amount (Minor Units)",
    "Your Share (Minor Units)",
    "Original Amount (Minor Units)",
    "Receipt URL",
  ];

  const rows = expenses.map((exp) => {
    const baseCurrency = (exp.groupBaseCurrency || exp.currency || "USD").toUpperCase();
    const totalMinor = Math.trunc(exp.amountCents);
    const shareMinor = getUserShareCents(exp, currentUserId);
    const origMinor =
      exp.originalAmountCents !== null ? Math.trunc(exp.originalAmountCents) : null;
    const origCurrency = exp.originalCurrency ? exp.originalCurrency.toUpperCase() : "";
    const status = exp.isLocked
      ? "LOCKED"
      : exp.isSettledForUser
        ? "Settled"
        : "Pending";

    const cells = [
      exp.expenseDate.slice(0, 10),
      exp.groupName,
      exp.description,
      exp.category,
      exp.paidBy === currentUserId ? `You (${exp.payerName})` : exp.payerName,
      exp.splitMethod,
      formatMinorUnits(shareMinor, baseCurrency),
      formatMinorUnits(totalMinor, baseCurrency),
      baseCurrency,
      origMinor !== null && origCurrency
        ? formatMinorUnits(origMinor, origCurrency)
        : "",
      origCurrency,
      exp.exchangeRate !== null ? String(exp.exchangeRate) : "",
      exp.exchangeRateSource ?? "",
      status,
      String(totalMinor),
      String(shareMinor),
      origMinor !== null ? String(origMinor) : "",
      exp.receiptUrl ?? "",
    ];

    return cells.map((cell) => escapeCsvCell(cell)).join(",");
  });

  const headerLine = headers.map((h) => escapeCsvCell(h)).join(",");
  return [headerLine, ...rows].join("\r\n");
}

export interface FullLedgerCsvSettlementItem {
  id: string;
  groupId: string;
  groupName: string;
  groupBaseCurrency: string;
  payerId: string;
  payerName: string;
  recipientId: string;
  recipientName: string;
  amountCents: number;
  paymentRail: string;
  settledAt: string;
}

export function buildFullLedgerCsv(params: {
  expenses: readonly ExpenseLedgerRecord[];
  settlements: readonly FullLedgerCsvSettlementItem[];
  currentUserId: string;
}): string {
  const { expenses, settlements, currentUserId } = params;
  const headers = [
    "Date",
    "Group",
    "Record Type",
    "Description",
    "Category",
    "Paid By",
    "Split Method",
    "Your Share",
    "Total Amount",
    "Currency",
    "Original Amount",
    "Original Currency",
    "Exchange Rate",
    "Exchange Rate Source",
    "Status",
    "Total Amount (Decimal)",
    "Total Amount (Minor Units)",
    "Your Share (Minor Units)",
    "Original Amount (Minor Units)",
    "Receipt URL",
  ];

  type SortableEntry = {
    sortMs: number;
    sortId: string;
    cells: string[];
  };

  const entries: SortableEntry[] = [];

  for (const exp of expenses) {
    const baseCurrency = (exp.groupBaseCurrency || exp.currency || "USD").toUpperCase();
    const totalMinor = Math.trunc(exp.amountCents);
    const shareMinor = getUserShareCents(exp, currentUserId);
    const origMinor =
      exp.originalAmountCents !== null ? Math.trunc(exp.originalAmountCents) : null;
    const origCurrency = exp.originalCurrency ? exp.originalCurrency.toUpperCase() : "";
    const status = exp.isLocked
      ? "LOCKED"
      : exp.isSettledForUser
        ? "Settled"
        : "Pending";

    entries.push({
      sortMs: Date.parse(exp.expenseDate) || 0,
      sortId: exp.id,
      cells: [
        exp.expenseDate.slice(0, 10),
        exp.groupName,
        "EXPENSE",
        exp.description,
        exp.category,
        exp.paidBy === currentUserId ? `You (${exp.payerName})` : exp.payerName,
        exp.splitMethod,
        formatMinorUnits(shareMinor, baseCurrency),
        formatMinorUnits(totalMinor, baseCurrency),
        baseCurrency,
        origMinor !== null && origCurrency
          ? formatMinorUnits(origMinor, origCurrency)
          : "",
        origCurrency,
        exp.exchangeRate !== null ? String(exp.exchangeRate) : "",
        exp.exchangeRateSource ?? "",
        status,
        formatMinorUnitsDecimal(totalMinor, baseCurrency),
        String(totalMinor),
        String(shareMinor),
        origMinor !== null ? String(origMinor) : "",
        exp.receiptUrl ?? "",
      ],
    });
  }

  for (const s of settlements) {
    const baseCurrency = (s.groupBaseCurrency || "USD").toUpperCase();
    const totalMinor = Math.trunc(s.amountCents);
    const userImpactMinor =
      s.payerId === currentUserId
        ? -totalMinor
        : s.recipientId === currentUserId
          ? totalMinor
          : 0;
    const payerLabel =
      s.payerId === currentUserId ? `You (${s.payerName})` : s.payerName;
    const recipientLabel =
      s.recipientId === currentUserId ? `You (${s.recipientName})` : s.recipientName;

    entries.push({
      sortMs: Date.parse(s.settledAt) || 0,
      sortId: s.id,
      cells: [
        s.settledAt.slice(0, 10),
        s.groupName,
        "SETTLEMENT",
        `Settlement: ${payerLabel} -> ${recipientLabel}`,
        "Settlement",
        payerLabel,
        s.paymentRail,
        formatMinorUnits(userImpactMinor, baseCurrency),
        formatMinorUnits(totalMinor, baseCurrency),
        baseCurrency,
        "",
        "",
        "",
        "",
        "Settled",
        formatMinorUnitsDecimal(totalMinor, baseCurrency),
        String(totalMinor),
        String(userImpactMinor),
        "",
        "",
      ],
    });
  }

  entries.sort((a, b) => b.sortMs - a.sortMs || b.sortId.localeCompare(a.sortId));

  const headerLine = headers.map((h) => escapeCsvCell(h)).join(",");
  const rows = entries.map((entry) =>
    entry.cells.map((cell) => escapeCsvCell(cell)).join(","),
  );
  return [headerLine, ...rows].join("\r\n");
}
