import { parseCycleParam } from "@/components/shell/url-state";
import { formatMinorUnits } from "@/lib/money";

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
  ExchangeRateSource,
  ExpenseSplitMethod,
  GroupStatus,
  MemberRole,
  MemberStatus,
  RecurringFrequency,
  SplitBreakdownItem,
  SplitMode,
} from "@/types/database";

export type ExpenseLedgerTab = "all" | "paid-by-me" | "split-with-me" | "recurring";

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
  exchangeRateSource: ExchangeRateSource | null;
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

export interface RecurringRuleRecord {
  id: string;
  groupId: string;
  groupName: string;
  createdBy?: string | null;
  paidBy: string;
  payerName: string;
  description: string;
  category: string;
  amountCents: number;
  currency: string;
  frequency: RecurringFrequency;
  dayOfMonth: number;
  splitRule: SplitMode;
  isActive: boolean;
  nextRunDate: string;
}

export interface SimplifiedDebtEdge {
  groupId: string;
  groupName: string;
  currency: string;
  payerId: string;
  payerName: string;
  recipientId: string;
  recipientName: string;
  recipientInstantTag: string | null;
  amountCents: number;
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
  personalShareCapCents: number | null;
  personalCapPercent: number | null;
  unsettledTotalCents: number;
  youOweCount: number;
  youOweCents: number;
  owedToYouCount: number;
  owedToYouCents: number;
  displayCurrency: string;
  hasMixedCurrencies: boolean;
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

export function computePerGroupDebtEdges(params: {
  group: ExpenseGroupInfo;
  expenses: readonly Pick<
    ExpenseLedgerRecord,
    "groupId" | "paidBy" | "amountCents" | "splitBreakdown"
  >[];
  settlements: readonly ExpenseSettlementRecord[];
}): SimplifiedDebtEdge[] {
  const { group, expenses, settlements } = params;
  const memberById = new Map(group.members.map((m) => [m.userId, m]));

  if (group.simplifyDebts) {
    const netByUser = new Map<string, number>();
    for (const m of group.members) {
      netByUser.set(m.userId, 0);
    }

    for (const exp of expenses) {
      if (exp.groupId !== group.id) continue;
      netByUser.set(
        exp.paidBy,
        (netByUser.get(exp.paidBy) ?? 0) + Math.trunc(exp.amountCents),
      );
      for (const part of exp.splitBreakdown) {
        netByUser.set(
          part.user_id,
          (netByUser.get(part.user_id) ?? 0) - Math.trunc(part.share_cents),
        );
      }
    }

    for (const s of settlements) {
      if (s.groupId !== group.id) continue;
      const amt = Math.trunc(s.amountCents);
      netByUser.set(s.payerId, (netByUser.get(s.payerId) ?? 0) + amt);
      netByUser.set(s.recipientId, (netByUser.get(s.recipientId) ?? 0) - amt);
    }

    const debtors: Array<{ userId: string; amount: number }> = [];
    const creditors: Array<{ userId: string; amount: number }> = [];

    for (const [userId, bal] of netByUser.entries()) {
      if (bal < 0) debtors.push({ userId, amount: -bal });
      else if (bal > 0) creditors.push({ userId, amount: bal });
    }

    debtors.sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));
    creditors.sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));

    const edges: SimplifiedDebtEdge[] = [];
    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];
      const transfer = Math.min(debtor.amount, creditor.amount);

      if (transfer > 0) {
        const payerInfo = memberById.get(debtor.userId);
        const recipientInfo = memberById.get(creditor.userId);
        edges.push({
          groupId: group.id,
          groupName: group.name,
          currency: group.baseCurrency,
          payerId: debtor.userId,
          payerName: payerInfo?.name ?? "Member",
          recipientId: creditor.userId,
          recipientName: recipientInfo?.name ?? "Member",
          recipientInstantTag: recipientInfo?.instantSettlementTag ?? null,
          amountCents: transfer,
        });
      }

      debtor.amount -= transfer;
      creditor.amount -= transfer;
      if (debtor.amount === 0) dIdx += 1;
      if (creditor.amount === 0) cIdx += 1;
    }

    return edges;
  }

  // Pairwise non-simplified mode: track directed owed(A -> B)
  const pairMap = new Map<string, number>();
  const addDirected = (fromId: string, toId: string, amount: number) => {
    if (fromId === toId || amount === 0) return;
    const [a, b] = fromId < toId ? [fromId, toId] : [toId, fromId];
    const key = `${a}::${b}`;
    const signed = fromId < toId ? amount : -amount;
    pairMap.set(key, (pairMap.get(key) ?? 0) + signed);
  };

  for (const exp of expenses) {
    if (exp.groupId !== group.id) continue;
    for (const part of exp.splitBreakdown) {
      if (part.user_id !== exp.paidBy) {
        addDirected(part.user_id, exp.paidBy, Math.trunc(part.share_cents));
      }
    }
  }

  for (const s of settlements) {
    if (s.groupId !== group.id) continue;
    addDirected(s.payerId, s.recipientId, -Math.trunc(s.amountCents));
  }

  const edges: SimplifiedDebtEdge[] = [];
  for (const [key, net] of pairMap.entries()) {
    if (net === 0) continue;
    const [a, b] = key.split("::");
    const payerId = net > 0 ? a : b;
    const recipientId = net > 0 ? b : a;
    const amountCents = Math.abs(net);
    const payerInfo = memberById.get(payerId);
    const recipientInfo = memberById.get(recipientId);
    edges.push({
      groupId: group.id,
      groupName: group.name,
      currency: group.baseCurrency,
      payerId,
      payerName: payerInfo?.name ?? "Member",
      recipientId,
      recipientName: recipientInfo?.name ?? "Member",
      recipientInstantTag: recipientInfo?.instantSettlementTag ?? null,
      amountCents,
    });
  }

  return edges.sort((x, y) => y.amountCents - x.amountCents);
}

export function filterAndSortExpenses(params: {
  expenses: readonly ExpenseLedgerRecord[];
  activeGroupId: string;
  cycleSlug: string;
  currentUserId: string;
  tab: ExpenseLedgerTab;
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
    searchQuery,
    category,
    sortBy,
  } = params;

  const q = searchQuery.trim().toLowerCase();
  const safeCycle = parseCycleParam(cycleSlug);

  const filtered = expenses.filter((exp) => {
    if (activeGroupId !== "all" && exp.groupId !== activeGroupId) {
      return false;
    }

    if (!isExpenseInCycleWindow(exp.expenseDate, safeCycle, exp.groupBillingAnchorDay)) {
      return false;
    }

    if (tab === "paid-by-me" && exp.paidBy !== currentUserId) {
      return false;
    }

    if (tab === "split-with-me") {
      const userShare = getUserShareCents(exp, currentUserId);
      if (exp.paidBy === currentUserId || userShare === 0) {
        return false;
      }
    }

    if (category !== "all" && exp.category !== category) {
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
    referenceDate = new Date(),
  } = params;

  const scopedGroups =
    activeGroupId === "all"
      ? groups
      : groups.filter((g) => g.id === activeGroupId);

  const currencies = Array.from(new Set(scopedGroups.map((g) => g.baseCurrency)));
  const hasMixedCurrencies = currencies.length > 1;
  const displayCurrency =
    scopedGroups.length === 1
      ? scopedGroups[0].baseCurrency
      : currencies.length === 1
        ? currencies[0]
        : userBaseCurrency;

  const prevCycleSlug = stepCycleSlugSafe(cycleSlug, -1);

  let totalGroupExpensesCents = 0;
  let previousCycleExpensesCents = 0;
  let transactionCount = 0;
  let personalShareCents = 0;

  const categoryTotalsMap = new Map<string, { amountCents: number; count: number }>();

  for (const exp of expenses) {
    if (activeGroupId !== "all" && exp.groupId !== activeGroupId) continue;

    if (isExpenseInCycleWindow(exp.expenseDate, cycleSlug, exp.groupBillingAnchorDay)) {
      totalGroupExpensesCents += Math.trunc(exp.amountCents);
      transactionCount += 1;
      personalShareCents += getUserShareCents(exp, currentUserId);

      const catEntry = categoryTotalsMap.get(exp.category) ?? {
        amountCents: 0,
        count: 0,
      };
      catEntry.amountCents += Math.trunc(exp.amountCents);
      catEntry.count += 1;
      categoryTotalsMap.set(exp.category, catEntry);
    } else if (
      isExpenseInCycleWindow(exp.expenseDate, prevCycleSlug, exp.groupBillingAnchorDay)
    ) {
      previousCycleExpensesCents += Math.trunc(exp.amountCents);
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

  const personalCapPercent =
    personalShareCapCents !== null && personalShareCapCents > 0
      ? Math.round((personalShareCents / personalShareCapCents) * 1000) / 10
      : null;

  const uniqueMemberIds = new Set<string>();
  for (const g of scopedGroups) {
    for (const m of g.members) {
      if (m.status === "ACTIVE") {
        uniqueMemberIds.add(m.userId);
      }
    }
  }

  let youOweCents = 0;
  let youOweCount = 0;
  let owedToYouCents = 0;
  let owedToYouCount = 0;

  for (const group of scopedGroups) {
    const edges = computePerGroupDebtEdges({
      group,
      expenses,
      settlements,
    });
    for (const edge of edges) {
      if (edge.payerId === currentUserId) {
        youOweCents += edge.amountCents;
        youOweCount += 1;
      } else if (edge.recipientId === currentUserId) {
        owedToYouCents += edge.amountCents;
        owedToYouCount += 1;
      }
    }
  }

  const unsettledTotalCents = youOweCents + owedToYouCents;
  const anchorDay = scopedGroups[0]?.billingCycleAnchorDay ?? 1;
  const nextSettlement = getNextGroupSettlementDate(anchorDay, referenceDate);

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
    personalShareCapCents,
    personalCapPercent,
    unsettledTotalCents,
    youOweCount,
    youOweCents,
    owedToYouCount,
    owedToYouCents,
    displayCurrency,
    hasMixedCurrencies,
    nextSettlementDateIso: nextSettlement.isoDate,
    nextSettlementDateLabel: nextSettlement.label,
    categoryTotals,
  };
}

function escapeCsvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
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
    "Status",
  ];

  const rows = expenses.map((exp) => {
    const shareCents = getUserShareCents(exp, currentUserId);
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
      formatMinorUnits(shareCents, exp.currency),
      formatMinorUnits(exp.amountCents, exp.currency),
      exp.currency,
      exp.originalAmountCents !== null && exp.originalCurrency
        ? formatMinorUnits(exp.originalAmountCents, exp.originalCurrency)
        : "",
      exp.originalCurrency ?? "",
      exp.exchangeRate !== null ? String(exp.exchangeRate) : "",
      status,
    ];

    return cells.map((cell) => escapeCsvCell(cell)).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}
