"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Download,
  Paperclip,
  Pencil,
  Receipt,
  RefreshCw,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  ProgressBar,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  ToastContainer,
} from "@/components/ui";
import type { ToastItem } from "@/components/ui";
import {
  AddEditExpenseModal,
  RecordSettlementModal,
  getSettlementDebtKey,
} from "@/components/expenses";
import {
  REALTIME_LEDGER_CHANGE_EVENT,
  useActiveGroup,
} from "@/components/shell";
import type {
  RealtimeLedgerChangeDetail,
  ShellGroupSummary,
} from "@/components/shell/types";
import { ALL_GROUPS_VALUE, formatCycleLabel } from "@/components/shell/url-state";
import {
  computeExpensesKpiSummary,
  computePerGroupDebtEdges,
  evaluateExpenseLockAndSettlement,
  getBillingCycleDateRange,
  getUserShareCents,
  isBillingCycleClosedForWindow,
  stepCycleSlugSafe,
  type ExpenseBillingCycleRecord,
  type ExpenseGroupInfo,
  type ExpenseLedgerRecord,
  type ExpenseSettlementRecord,
  type SimplifiedDebtEdge,
} from "@/lib/expenses/ledger";
import { cn } from "@/lib/cn";
import {
  formatCooldownLabel,
  getReminderCooldownKey,
  REMINDER_COOLDOWN_MS,
  type ReminderCooldownInfo,
} from "@/lib/groups/reminders";
import { getBillingCycleWindow } from "@/lib/groups/service";
import { formatMinorUnits } from "@/lib/money";
import type {
  Database,
  ExpenseSplitMethod,
  SplitBreakdownItem,
} from "@/types/database";

export interface DashboardExpenseItem {
  id: string;
  groupId: string;
  groupName: string;
  groupBaseCurrency: string;
  groupBillingAnchorDay: number;
  paidBy: string;
  payerName: string;
  description: string;
  category: string;
  expenseDate: string;
  amountCents: number;
  currency: string;
  originalAmountCents: number | null;
  originalCurrency: string | null;
  splitMethod: ExpenseSplitMethod;
  splitBreakdown: SplitBreakdownItem[];
  receiptUrl?: string | null;
  createdBy?: string;
  exchangeRate?: number | null;
  exchangeRateSource?: "API" | "MANUAL_OVERRIDE" | null;
  isRecurringGenerated?: boolean;
  recurringRuleId?: string | null;
  adjustmentForExpenseId?: string | null;
  isLocked?: boolean;
  isCycleClosed?: boolean;
  isSettledByWatermark?: boolean;
  isSettledForUser?: boolean;
}

export interface DashboardClientProps {
  initialExpenses: Array<DashboardExpenseItem | ExpenseLedgerRecord>;
  currentUserId: string;
  userBaseCurrency?: string;
  initialGroups?: ExpenseGroupInfo[];
  initialSettlements?: ExpenseSettlementRecord[];
  initialBillingCycles?: ExpenseBillingCycleRecord[];
  initialReminderCooldowns?: ReminderCooldownInfo[];
  loadError?: string | null;
}

const RECENT_TX_PAGE_SIZE = 5;

const CATEGORY_COLORS: Record<string, string> = {
  "Groceries & Food": "#0066cc",
  Groceries: "#0066cc",
  "Housing & Utilities": "#22c55e",
  "Rent & Housing": "#22c55e",
  Utilities: "#22c55e",
  "Dining & Social": "#f59e0b",
  "Dining Out": "#f59e0b",
  Dining: "#f59e0b",
  "Food & Drink": "#f59e0b",
  "Travel & Fuel": "#8b5cf6",
  "Transit & Travel": "#8b5cf6",
  Travel: "#8b5cf6",
  Transport: "#8b5cf6",
  Entertainment: "#ec4899",
  "Supplies & Misc": "#64748b",
  "Home Goods": "#64748b",
  "Household Supplies": "#64748b",
  General: "#64748b",
};

const CATEGORY_FALLBACK_PALETTE = [
  "#0066cc",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#64748b",
];

function getCategoryColor(category: string, index = 0): string {
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category];
  const lower = category.toLowerCase();
  if (lower.includes("grocer")) return "#0066cc";
  if (lower.includes("utilit") || lower.includes("hous") || lower.includes("rent")) {
    return "#22c55e";
  }
  if (lower.includes("dining") || lower.includes("food") || lower.includes("drink")) {
    return "#f59e0b";
  }
  if (lower.includes("travel") || lower.includes("transit") || lower.includes("fuel")) {
    return "#8b5cf6";
  }
  if (lower.includes("entertain")) return "#ec4899";
  if (lower.includes("suppl") || lower.includes("misc") || lower.includes("general")) {
    return "#64748b";
  }
  return CATEGORY_FALLBACK_PALETTE[index % CATEGORY_FALLBACK_PALETTE.length];
}

function formatShortCycleLabel(cycleSlug: string): string {
  const [yStr, mStr] = cycleSlug.split("-");
  const year = Number.parseInt(yStr, 10);
  const monthIdx = Number.parseInt(mStr, 10) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIdx)) {
    return cycleSlug;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIdx, 1)));
}

function formatCycleRangePill(cycleSlug: string, anchorDay = 1): string {
  const { periodStart, periodEnd } = getBillingCycleDateRange(cycleSlug, anchorDay);
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `Cycle: ${formatShortCycleLabel(cycleSlug)}`;
  }
  const monthFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const startMonth = monthFmt.format(start);
  const endMonth = monthFmt.format(end);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  if (startMonth === endMonth) {
    return `Cycle: ${startMonth} ${startDay}-${endDay}`;
  }
  return `Cycle: ${startMonth} ${startDay}-${endMonth} ${endDay}`;
}

function formatSplitLabel(
  method: ExpenseSplitMethod,
  splitBreakdown: readonly SplitBreakdownItem[],
  currentUserId: string,
): string {
  const count = splitBreakdown.length;
  if (method === "EQUAL") {
    if (count === 2) return "2-Way (50/50)";
    if (count > 0) {
      const pct = 100 / count;
      const pctStr = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
      return `${count}-Way Equal (${pctStr}%)`;
    }
    return "Equal Split";
  }
  if (method === "PERCENTAGE") {
    const userItem = splitBreakdown.find((b) => b.user_id === currentUserId);
    if (userItem?.percentage !== undefined) {
      return `${count}-Way Custom (${userItem.percentage}%)`;
    }
    return `${count}-Way Percentage`;
  }
  if (method === "SHARES") {
    const totalShares = splitBreakdown.reduce(
      (sum, item) => sum + (item.shares ?? 0),
      0,
    );
    const userShares = splitBreakdown.find(
      (b) => b.user_id === currentUserId,
    )?.shares;
    if (totalShares > 0 && userShares !== undefined) {
      return `${userShares}/${totalShares} Shares`;
    }
    return `${count}-Way Shares`;
  }
  return "Itemized Custom";
}

function formatDateParts(isoDate: string): { date: string; time: string } {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return { date: isoDate, time: "" };
  }
  return {
    date: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(parsed),
    time: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(parsed),
  };
}

function toLedgerRecord(
  exp: DashboardExpenseItem | ExpenseLedgerRecord,
): ExpenseLedgerRecord {
  return {
    id: exp.id,
    groupId: exp.groupId,
    groupName: exp.groupName,
    groupBaseCurrency: exp.groupBaseCurrency,
    groupBillingAnchorDay: exp.groupBillingAnchorDay,
    createdBy: exp.createdBy ?? exp.paidBy,
    paidBy: exp.paidBy,
    payerName: exp.payerName,
    description: exp.description,
    category: exp.category,
    expenseDate: exp.expenseDate,
    amountCents: exp.amountCents,
    currency: exp.currency,
    originalAmountCents: exp.originalAmountCents,
    originalCurrency: exp.originalCurrency,
    exchangeRate: exp.exchangeRate ?? null,
    exchangeRateSource: exp.exchangeRateSource ?? null,
    splitMethod: exp.splitMethod,
    splitBreakdown: exp.splitBreakdown,
    receiptUrl: exp.receiptUrl ?? null,
    isRecurringGenerated: exp.isRecurringGenerated ?? false,
    recurringRuleId: exp.recurringRuleId ?? null,
    adjustmentForExpenseId: exp.adjustmentForExpenseId ?? null,
    isLocked: exp.isLocked ?? false,
    isCycleClosed: exp.isCycleClosed ?? false,
    isSettledByWatermark: exp.isSettledByWatermark ?? false,
    isSettledForUser: exp.isSettledForUser ?? false,
  };
}

export function DashboardClient({
  initialExpenses,
  currentUserId,
  userBaseCurrency = "USD",
  initialGroups = [],
  initialSettlements = [],
  initialBillingCycles = [],
  initialReminderCooldowns = [],
  loadError = null,
}: DashboardClientProps) {
  const router = useRouter();
  const {
    groups: shellGroups,
    activeGroupId,
    activeGroup,
    cycle,
    user: shellUser,
    updateReceiptStorageUsedBytes,
    buildNavHref,
  } = useActiveGroup();

  const [addedExpenses, setAddedExpenses] = React.useState<ExpenseLedgerRecord[]>(
    [],
  );
  const [editedExpenses, setEditedExpenses] = React.useState<
    Record<string, ExpenseLedgerRecord>
  >({});
  const [deletedExpenseIds, setDeletedExpenseIds] = React.useState<string[]>([]);

  const [liveFxRatesByTarget, setLiveFxRatesByTarget] = React.useState<
    Record<string, Record<string, number>>
  >({});
  const [addedSettlements, setAddedSettlements] = React.useState<
    ExpenseSettlementRecord[]
  >([]);
  const [cooldownOverrides, setCooldownOverrides] = React.useState<
    Record<string, ReminderCooldownInfo>
  >({});
  const [sendingReminderKeys, setSendingReminderKeys] = React.useState<
    Record<string, boolean>
  >({});
  const [nowTickMs, setNowTickMs] = React.useState(() => Date.now());

  const [settlementModalOpen, setSettlementModalOpen] = React.useState(false);
  const [selectedDebtKey, setSelectedDebtKey] = React.useState<string | null>(
    null,
  );
  const [inspectExpense, setInspectExpense] =
    React.useState<ExpenseLedgerRecord | null>(null);
  const [editingExpense, setEditingExpense] =
    React.useState<ExpenseLedgerRecord | null>(null);
  const [adjustingExpense, setAdjustingExpense] =
    React.useState<ExpenseLedgerRecord | null>(null);
  const [deletingExpense, setDeletingExpense] =
    React.useState<ExpenseLedgerRecord | null>(null);
  const [isDeletingExpense, setIsDeletingExpense] = React.useState(false);
  const [deleteExpenseError, setDeleteExpenseError] = React.useState<
    string | null
  >(null);
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const pushToast = React.useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const shellInstantTag = shellUser?.instantSettlementTag;

  // Merge initialGroups with shellGroups; per-group debt simplification is always-on per v2 spec.
  const effectiveGroups = React.useMemo<ExpenseGroupInfo[]>(() => {
    const shellById = new Map(shellGroups.map((sg) => [sg.id, sg]));
    return initialGroups.length > 0
      ? initialGroups.map((g) => {
          const sg = shellById.get(g.id);
          const nextMembers =
            shellInstantTag !== undefined
              ? g.members.map((m) =>
                  m.userId === currentUserId
                    ? {
                        ...m,
                        instantSettlementTag: shellInstantTag ?? null,
                      }
                    : m,
                )
              : g.members;
          return {
            ...g,
            defaultSplitMode: sg?.defaultSplitMode ?? g.defaultSplitMode,
            simplifyDebts: true,
            members: nextMembers,
          };
        })
      : shellGroups.map((sg) => ({
          id: sg.id,
          name: sg.name,
          slug: sg.slug ?? sg.id,
          status: sg.status,
          baseCurrency: sg.baseCurrency,
          defaultSplitMode: sg.defaultSplitMode ?? "EQUAL",
          simplifyDebts: true,
          operationalBudgetCents: null,
          billingCycleAnchorDay: 1,
          cycleResetDay: 1,
          autoSettleOnReset: true,
          currentUserRole: null,
          currentUserStatus: sg.currentUserStatus ?? null,
          members: sg.members.map((m) => ({
            userId: m.id,
            name: m.name,
            status: "ACTIVE",
            instantSettlementTag:
              m.id === currentUserId ? (shellInstantTag ?? null) : null,
          })),
        }));
  }, [currentUserId, initialGroups, shellGroups, shellInstantTag]);

  const settlements = React.useMemo(() => {
    const byId = new Map<string, ExpenseSettlementRecord>();
    for (const item of addedSettlements) byId.set(item.id, item);
    for (const item of initialSettlements) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return Array.from(byId.values());
  }, [addedSettlements, initialSettlements]);

  const ledgerExpenses = React.useMemo(() => {
    const deletedSet = new Set(deletedExpenseIds);
    const byId = new Map<string, ExpenseLedgerRecord>();
    for (const item of addedExpenses) {
      if (!deletedSet.has(item.id)) byId.set(item.id, item);
    }
    for (const item of initialExpenses) {
      const normalized = toLedgerRecord(item);
      if (!deletedSet.has(normalized.id) && !byId.has(normalized.id)) {
        byId.set(normalized.id, normalized);
      }
    }
    return Array.from(byId.values())
      .map((rawItem) => {
        const item =
          rawItem.id in editedExpenses ? editedExpenses[rawItem.id] : rawItem;
        const lockEval = evaluateExpenseLockAndSettlement({
          expense: {
            id: item.id,
            groupId: item.groupId,
            paidBy: item.paidBy,
            expenseDate: item.expenseDate,
            isLocked: item.isLocked,
            splitBreakdown: item.splitBreakdown,
          },
          currentUserId,
          billingCycles: initialBillingCycles,
          settlements,
        });
        if (
          lockEval.isLocked === item.isLocked &&
          lockEval.isCycleClosed === item.isCycleClosed &&
          lockEval.isSettledByWatermark === item.isSettledByWatermark &&
          lockEval.isSettledForUser === item.isSettledForUser
        ) {
          return item;
        }
        return {
          ...item,
          isLocked: lockEval.isLocked,
          isCycleClosed: lockEval.isCycleClosed,
          isSettledByWatermark: lockEval.isSettledByWatermark,
          isSettledForUser: lockEval.isSettledForUser,
        };
      })
      .sort(
        (a, b) =>
          Date.parse(b.expenseDate) - Date.parse(a.expenseDate) ||
          b.id.localeCompare(a.id),
      );
  }, [
    addedExpenses,
    currentUserId,
    deletedExpenseIds,
    editedExpenses,
    initialBillingCycles,
    initialExpenses,
    settlements,
  ]);

  React.useEffect(() => {
    const handleCreated = (event: Event) => {
      const custom = event as CustomEvent<
        Database["public"]["Tables"]["expenses"]["Row"]
      >;
      const created = custom.detail;
      if (!created || !created.id) return;
      const group = effectiveGroups.find((g) => g.id === created.group_id);
      const payer = group?.members.find((m) => m.userId === created.paid_by);
      const newRecord: ExpenseLedgerRecord = {
        id: created.id,
        groupId: created.group_id,
        groupName: group?.name ?? "Split Group",
        groupBaseCurrency: group?.baseCurrency ?? created.currency,
        groupBillingAnchorDay: group?.billingCycleAnchorDay ?? 1,
        createdBy: created.created_by,
        paidBy: created.paid_by,
        payerName: payer?.name ?? "Member",
        description: created.description,
        category: created.category,
        expenseDate: created.expense_date,
        amountCents: Number(created.amount_cents),
        currency: created.currency,
        originalAmountCents: null,
        originalCurrency: null,
        exchangeRate: null,
        exchangeRateSource: null,
        splitMethod: created.split_method,
        splitBreakdown: Array.isArray(created.split_breakdown)
          ? created.split_breakdown
          : [],
        receiptUrl: created.receipt_url ?? null,
        isRecurringGenerated: false,
        recurringRuleId: null,
        adjustmentForExpenseId: created.adjustment_for_expense_id ?? null,
        isLocked: Boolean(created.is_locked),
        isCycleClosed: false,
        isSettledByWatermark: false,
        isSettledForUser: false,
      };
      setAddedExpenses((prev) =>
        prev.some((item) => item.id === newRecord.id)
          ? prev
          : [newRecord, ...prev],
      );
    };
    window.addEventListener("ledgersplit:expense-created", handleCreated);
    return () =>
      window.removeEventListener("ledgersplit:expense-created", handleCreated);
  }, [effectiveGroups]);

  React.useEffect(() => {
    const handleRealtimeChange = (event: Event) => {
      const detail = (event as CustomEvent<RealtimeLedgerChangeDetail>).detail;
      if (!detail) return;
      if (detail.table === "expenses") {
        const expId =
          (typeof detail.newRow?.id === "string" && detail.newRow.id) ||
          (typeof detail.oldRow?.id === "string" && detail.oldRow.id) ||
          null;
        if (!expId) return;
        const isSoftDeleted =
          detail.eventType === "DELETE" ||
          (detail.newRow?.deleted_at !== undefined &&
            detail.newRow?.deleted_at !== null);
        if (isSoftDeleted) {
          setDeletedExpenseIds((prev) =>
            prev.includes(expId) ? prev : [...prev, expId],
          );
          setAddedExpenses((prev) => prev.filter((item) => item.id !== expId));
          setEditedExpenses((prev) => {
            if (!(expId in prev)) return prev;
            const next = { ...prev };
            delete next[expId];
            return next;
          });
        } else if (detail.eventType === "UPDATE") {
          setEditedExpenses((prev) => {
            if (!(expId in prev)) return prev;
            const next = { ...prev };
            delete next[expId];
            return next;
          });
          setAddedExpenses((prev) => prev.filter((item) => item.id !== expId));
        }
      }
    };

    window.addEventListener(REALTIME_LEDGER_CHANGE_EVENT, handleRealtimeChange);
    return () =>
      window.removeEventListener(
        REALTIME_LEDGER_CHANGE_EVENT,
        handleRealtimeChange,
      );
  }, []);

  const modalGroups = React.useMemo<ShellGroupSummary[]>(() => {
    const shellById = new Map(shellGroups.map((g) => [g.id, g]));
    return effectiveGroups.map((g) => {
      const existing = shellById.get(g.id);
      if (existing) return existing;
      return {
        id: g.id,
        name: g.name,
        slug: g.slug,
        status: g.status,
        groupType: "RESIDENTIAL",
        baseCurrency: g.baseCurrency,
        defaultSplitMode: g.defaultSplitMode,
        activeSplitCount: 0,
        members: g.members
          .filter((m) => m.status === "ACTIVE")
          .map((m) => ({
            id: m.userId,
            name: m.name,
          })),
      };
    });
  }, [effectiveGroups, shellGroups]);

  const scopedGroups = React.useMemo(
    () =>
      activeGroupId === ALL_GROUPS_VALUE
        ? effectiveGroups
        : effectiveGroups.filter((g) => g.id === activeGroupId),
    [activeGroupId, effectiveGroups],
  );

  const activeLedgerGroup = React.useMemo(
    () =>
      activeGroupId === ALL_GROUPS_VALUE
        ? null
        : (effectiveGroups.find((g) => g.id === activeGroupId) ?? null),
    [activeGroupId, effectiveGroups],
  );

  const effectiveDisplayCurrency = (
    shellUser?.displayCurrency ??
    userBaseCurrency ??
    "USD"
  )
    .trim()
    .toUpperCase();

  const foreignCurrenciesKey = React.useMemo(() => {
    if (activeGroupId !== ALL_GROUPS_VALUE) return "";
    const foreign = Array.from(
      new Set(
        effectiveGroups
          .map((g) => (g.baseCurrency || "USD").trim().toUpperCase())
          .filter((code) => code !== effectiveDisplayCurrency),
      ),
    ).sort();
    return foreign.join(",");
  }, [activeGroupId, effectiveDisplayCurrency, effectiveGroups]);

  React.useEffect(() => {
    if (!foreignCurrenciesKey) {
      return;
    }
    const currenciesToFetch = foreignCurrenciesKey.split(",").filter(Boolean);
    let cancelled = false;

    void (async () => {
      const nextRates: Record<string, number> = {};
      await Promise.all(
        currenciesToFetch.map(async (fromCurrency) => {
          try {
            const res = await fetch(
              `/api/fx?from=${encodeURIComponent(fromCurrency)}&to=${encodeURIComponent(effectiveDisplayCurrency)}`,
            );
            if (!res.ok) return;
            const payload = (await res.json()) as {
              ok?: boolean;
              rate?: number;
            };
            if (
              payload.ok &&
              typeof payload.rate === "number" &&
              Number.isFinite(payload.rate) &&
              payload.rate > 0
            ) {
              nextRates[fromCurrency] = payload.rate;
            }
          } catch {
            // Deterministic fallback rates in lib/money remain active when offline.
          }
        }),
      );
      if (!cancelled && Object.keys(nextRates).length > 0) {
        setLiveFxRatesByTarget((prev) => ({
          ...prev,
          [effectiveDisplayCurrency]: {
            ...prev[effectiveDisplayCurrency],
            ...nextRates,
          },
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveDisplayCurrency, foreignCurrenciesKey]);

  const activeFxRates = foreignCurrenciesKey
    ? liveFxRatesByTarget[effectiveDisplayCurrency]
    : undefined;

  const kpi = React.useMemo(
    () =>
      computeExpensesKpiSummary({
        expenses: ledgerExpenses,
        groups: effectiveGroups,
        settlements,
        activeGroupId,
        cycleSlug: cycle,
        currentUserId,
        userBaseCurrency: effectiveDisplayCurrency,
        personalShareCapCents: null,
        fxRates: activeFxRates,
      }),
    [
      activeFxRates,
      activeGroupId,
      currentUserId,
      cycle,
      effectiveDisplayCurrency,
      effectiveGroups,
      ledgerExpenses,
      settlements,
    ],
  );

  // Strictly per-group edge computation (never nets across groups)
  const debtsByGroup = React.useMemo(
    () =>
      scopedGroups.map((group) => ({
        group,
        edges: computePerGroupDebtEdges({
          group,
          expenses: ledgerExpenses,
          settlements,
        }),
      })),
    [ledgerExpenses, scopedGroups, settlements],
  );

  const allScopedEdges = React.useMemo(
    () => debtsByGroup.flatMap((entry) => entry.edges),
    [debtsByGroup],
  );

  const settleableDebts = React.useMemo(() => {
    const allowed = debtsByGroup.flatMap(({ group, edges }) => {
      if (group.status === "ARCHIVED") return [];
      const member = group.members.find((m) => m.userId === currentUserId);
      const userStatus = group.currentUserStatus ?? member?.status ?? null;
      const isActiveAdmin =
        userStatus === "ACTIVE" && group.currentUserRole === "ADMIN";
      return isActiveAdmin
        ? edges
        : edges.filter(
            (edge) =>
              edge.payerId === currentUserId ||
              edge.recipientId === currentUserId,
          );
    });

    return allowed.sort((a, b) => {
      const rank = (edge: SimplifiedDebtEdge) =>
        edge.payerId === currentUserId
          ? 0
          : edge.recipientId === currentUserId
            ? 1
            : 2;
      return rank(a) - rank(b) || b.amountCents - a.amountCents;
    });
  }, [currentUserId, debtsByGroup]);

  const youOweEdges = React.useMemo(
    () => allScopedEdges.filter((edge) => edge.payerId === currentUserId),
    [allScopedEdges, currentUserId],
  );

  const topCreditorEdge = youOweEdges[0] ?? null;

  const isCycleClosed = React.useMemo(
    () =>
      scopedGroups.length > 0 &&
      scopedGroups.every((g) =>
        isBillingCycleClosedForWindow(
          g.id,
          cycle,
          g.billingCycleAnchorDay,
          initialBillingCycles,
        ),
      ),
    [cycle, initialBillingCycles, scopedGroups],
  );

  const cycleExpenses = React.useMemo(() => {
    return ledgerExpenses.filter((exp) => {
      if (activeGroupId !== ALL_GROUPS_VALUE && exp.groupId !== activeGroupId) {
        return false;
      }
      const { startMs, endMs } = getBillingCycleWindow(
        cycle,
        exp.groupBillingAnchorDay || 1,
      );
      const expMs = Date.parse(exp.expenseDate);
      return Number.isFinite(expMs) && expMs >= startMs && expMs < endMs;
    });
  }, [activeGroupId, cycle, ledgerExpenses]);

  const recentExpenses = React.useMemo(
    () => cycleExpenses.slice(0, RECENT_TX_PAGE_SIZE),
    [cycleExpenses],
  );

  const openSettlementForEdge = (edge?: SimplifiedDebtEdge | null) => {
    if (edge) {
      setSelectedDebtKey(getSettlementDebtKey(edge));
    } else if (topCreditorEdge) {
      setSelectedDebtKey(getSettlementDebtKey(topCreditorEdge));
    } else {
      setSelectedDebtKey(null);
    }
    setSettlementModalOpen(true);
  };

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const cooldownMap = React.useMemo(() => {
    const map: Record<string, ReminderCooldownInfo> = {};
    for (const item of initialReminderCooldowns) {
      map[getReminderCooldownKey(item.groupId, item.debtorId)] = item;
    }
    for (const [key, item] of Object.entries(cooldownOverrides)) {
      map[key] = item;
    }
    return map;
  }, [cooldownOverrides, initialReminderCooldowns]);

  const getActiveCooldown = React.useCallback(
    (groupId: string, debtorId: string): ReminderCooldownInfo | null => {
      const key = getReminderCooldownKey(groupId, debtorId);
      const info = cooldownMap[key];
      if (!info) return null;
      const nextAllowedMs = Date.parse(info.nextAllowedAt);
      if (!Number.isFinite(nextAllowedMs) || nextAllowedMs <= nowTickMs) {
        return null;
      }
      const remainingMs = nextAllowedMs - nowTickMs;
      const remainingHours = Math.max(1, Math.ceil(remainingMs / 3_600_000));
      return {
        ...info,
        remainingMs,
        remainingHours,
      };
    },
    [cooldownMap, nowTickMs],
  );

  const buildCooldownFromErrorPayload = React.useCallback(
    (
      groupId: string,
      debtorId: string,
      payload: {
        cooldown?: ReminderCooldownInfo;
        remaining_hours?: number;
        next_allowed_at?: string;
        last_sent_at?: string;
      },
    ): ReminderCooldownInfo => {
      if (payload.cooldown) return payload.cooldown;
      const remainingHours = Math.max(
        1,
        Math.trunc(payload.remaining_hours ?? 24),
      );
      const remainingMs = remainingHours * 3_600_000;
      const now = Date.now();
      return {
        groupId,
        debtorId,
        creditorId: currentUserId,
        channel: "PUSH",
        sentAt: payload.last_sent_at ?? new Date(now).toISOString(),
        nextAllowedAt:
          payload.next_allowed_at ??
          new Date(now + Math.min(REMINDER_COOLDOWN_MS, remainingMs)).toISOString(),
        remainingMs,
        remainingHours,
      };
    },
    [currentUserId],
  );

  const handleSendSingleReminder = React.useCallback(
    async (
      groupId: string,
      debtorId: string,
      debtorName: string,
      amountCents: number,
    ) => {
      const key = getReminderCooldownKey(groupId, debtorId);
      if (sendingReminderKeys[key]) return;

      setSendingReminderKeys((prev) => ({ ...prev, [key]: true }));
      try {
        const response = await fetch(
          `/api/groups/${encodeURIComponent(groupId)}/reminders`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              debtor_id: debtorId,
              amount_cents: amountCents,
            }),
          },
        );
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          channel?: "PUSH" | "EMAIL" | "SMS";
          cooldown?: ReminderCooldownInfo;
          remaining_hours?: number;
          next_allowed_at?: string;
          last_sent_at?: string;
        };

        if (response.status === 429) {
          const cooldown = buildCooldownFromErrorPayload(
            groupId,
            debtorId,
            payload,
          );
          setCooldownOverrides((prev) => ({ ...prev, [key]: cooldown }));
          pushToast({
            tone: "warning",
            title: "Reminder cooldown active",
            description:
              payload.error ||
              `${debtorName}: ${formatCooldownLabel(cooldown.remainingHours)}.`,
          });
          return;
        }

        if (!response.ok || !payload.ok) {
          pushToast({
            tone: "error",
            title: "Could not send reminder",
            description: payload.error || "Unable to send settlement reminder.",
          });
          return;
        }

        const cooldown =
          payload.cooldown ??
          buildCooldownFromErrorPayload(groupId, debtorId, {
            remaining_hours: 24,
          });
        setCooldownOverrides((prev) => ({ ...prev, [key]: cooldown }));
        setNowTickMs(Date.now());

        const viaSms = payload.channel === "SMS";
        pushToast({
          tone: "success",
          title: viaSms ? "SMS reminder sent" : "Push reminder sent",
          description: viaSms
            ? `Dispatched SMS and in-app nudge to ${debtorName}.`
            : `Sent Push/in-app settlement reminder to ${debtorName}.`,
        });
        router.refresh();
      } catch {
        pushToast({
          tone: "error",
          title: "Network error",
          description: "Unable to send settlement reminder right now.",
        });
      } finally {
        setSendingReminderKeys((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [
      buildCooldownFromErrorPayload,
      pushToast,
      router,
      sendingReminderKeys,
    ],
  );

  const handleExportCsv = () => {
    const scopeParam = activeGroupId || ALL_GROUPS_VALUE;
    const url = `/api/expenses/export?group=${encodeURIComponent(scopeParam)}&cycle=${encodeURIComponent(cycle)}&format=csv`;
    const link = document.createElement("a");
    link.href = url;
    const scopeLabel = activeGroup?.slug ?? "all-groups";
    link.download = `ledgersplit-${scopeLabel}-${cycle}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    pushToast({
      tone: "success",
      title: "CSV export started",
      description: `Downloading ${activeGroup ? activeGroup.name : "All Groups"} transactions for ${formatCycleLabel(cycle)}.`,
    });
  };

  const handleExpenseUpdated = React.useCallback(
    (payload: {
      expense: Database["public"]["Tables"]["expenses"]["Row"];
      revision?: Database["public"]["Tables"]["expense_revisions"]["Row"];
      notifications?: Database["public"]["Tables"]["notifications"]["Row"][];
    }) => {
      const updated = payload.expense;
      const group = effectiveGroups.find((g) => g.id === updated.group_id);
      const payer = group?.members.find((m) => m.userId === updated.paid_by);
      const breakdown = Array.isArray(updated.split_breakdown)
        ? updated.split_breakdown
        : [];
      const lockEval = evaluateExpenseLockAndSettlement({
        expense: {
          id: updated.id,
          groupId: updated.group_id,
          paidBy: updated.paid_by,
          expenseDate: updated.expense_date,
          isLocked: Boolean(updated.is_locked),
          splitBreakdown: breakdown,
        },
        currentUserId,
        billingCycles: initialBillingCycles,
        settlements,
      });

      const nextRecord: ExpenseLedgerRecord = {
        id: updated.id,
        groupId: updated.group_id,
        groupName: group?.name ?? "Split Group",
        groupBaseCurrency: group?.baseCurrency ?? updated.currency,
        groupBillingAnchorDay: group?.billingCycleAnchorDay ?? 1,
        createdBy: updated.created_by,
        paidBy: updated.paid_by,
        payerName: payer?.name ?? "Member",
        description: updated.description,
        category: updated.category,
        expenseDate: updated.expense_date,
        amountCents: Number(updated.amount_cents),
        currency: updated.currency,
        originalAmountCents: null,
        originalCurrency: null,
        exchangeRate: null,
        exchangeRateSource: null,
        splitMethod: updated.split_method,
        splitBreakdown: breakdown,
        receiptUrl: updated.receipt_url ?? null,
        isRecurringGenerated: false,
        recurringRuleId: null,
        adjustmentForExpenseId: updated.adjustment_for_expense_id ?? null,
        isLocked: lockEval.isLocked,
        isCycleClosed: lockEval.isCycleClosed,
        isSettledByWatermark: lockEval.isSettledByWatermark,
        isSettledForUser: lockEval.isSettledForUser,
      };

      setEditedExpenses((prev) => ({ ...prev, [updated.id]: nextRecord }));
      pushToast({
        tone: "success",
        title: "Expense updated",
        description: `${updated.description} (${formatMinorUnits(updated.amount_cents, updated.currency)}) saved.`,
      });
      router.refresh();
    },
    [
      currentUserId,
      effectiveGroups,
      initialBillingCycles,
      pushToast,
      router,
      settlements,
    ],
  );

  const handleAdjustmentCreated = React.useCallback(
    (created: Database["public"]["Tables"]["expenses"]["Row"]) => {
      const group = effectiveGroups.find((g) => g.id === created.group_id);
      const payer = group?.members.find((m) => m.userId === created.paid_by);
      const breakdown = Array.isArray(created.split_breakdown)
        ? created.split_breakdown
        : [];
      const newRecord: ExpenseLedgerRecord = {
        id: created.id,
        groupId: created.group_id,
        groupName: group?.name ?? "Split Group",
        groupBaseCurrency: group?.baseCurrency ?? created.currency,
        groupBillingAnchorDay: group?.billingCycleAnchorDay ?? 1,
        createdBy: created.created_by,
        paidBy: created.paid_by,
        payerName: payer?.name ?? "Member",
        description: created.description,
        category: created.category,
        expenseDate: created.expense_date,
        amountCents: Number(created.amount_cents),
        currency: created.currency,
        originalAmountCents: null,
        originalCurrency: null,
        exchangeRate: null,
        exchangeRateSource: null,
        splitMethod: created.split_method,
        splitBreakdown: breakdown,
        receiptUrl: created.receipt_url ?? null,
        isRecurringGenerated: false,
        recurringRuleId: null,
        adjustmentForExpenseId: created.adjustment_for_expense_id ?? null,
        isLocked: Boolean(created.is_locked),
        isCycleClosed: false,
        isSettledByWatermark: false,
        isSettledForUser: false,
      };
      setAddedExpenses((prev) =>
        prev.some((item) => item.id === newRecord.id)
          ? prev
          : [newRecord, ...prev],
      );
      pushToast({
        tone: "success",
        title: "Offsetting adjustment logged",
        description: `${created.description} (${formatMinorUnits(created.amount_cents, created.currency)}) added to ${group?.name ?? "group"}.`,
      });
      router.refresh();
    },
    [effectiveGroups, pushToast, router],
  );

  const handleConfirmSoftDelete = React.useCallback(async () => {
    if (!deletingExpense || isDeletingExpense) return;
    setDeleteExpenseError(null);
    setIsDeletingExpense(true);

    try {
      const res = await fetch(
        `/api/groups/${encodeURIComponent(deletingExpense.groupId)}/expenses/${encodeURIComponent(deletingExpense.id)}`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (!res.ok) {
        setDeleteExpenseError(
          data?.error || "Unable to delete expense. Please try again.",
        );
        setIsDeletingExpense(false);
        return;
      }

      const deletedTarget = deletingExpense;
      setDeletedExpenseIds((prev) =>
        prev.includes(deletedTarget.id) ? prev : [...prev, deletedTarget.id],
      );
      setDeletingExpense(null);
      setIsDeletingExpense(false);
      pushToast({
        tone: "success",
        title: "Expense deleted",
        description: `${deletedTarget.description} removed from active balances and ledger.`,
      });
      router.refresh();
    } catch {
      setDeleteExpenseError("Network error while deleting expense.");
      setIsDeletingExpense(false);
    }
  }, [deletingExpense, isDeletingExpense, pushToast, router]);

  const cycleLabel = formatCycleLabel(cycle);
  const shortCycleLabel = formatShortCycleLabel(cycle);
  const prevShortCycleLabel = formatShortCycleLabel(stepCycleSlugSafe(cycle, -1));
  const cycleRangePill = formatCycleRangePill(
    cycle,
    activeLedgerGroup?.cycleResetDay ?? activeLedgerGroup?.billingCycleAnchorDay ?? 1,
  );
  const netSettlementCents = kpi.netSettlementCents;

  const renderEdgeRow = (
    edge: SimplifiedDebtEdge,
    group: ExpenseGroupInfo,
  ) => {
    const isYouOwe = edge.payerId === currentUserId;
    const isOwedToYou = edge.recipientId === currentUserId;
    const member = group.members.find((m) => m.userId === currentUserId);
    const userStatus = group.currentUserStatus ?? member?.status ?? null;
    const isActiveAdmin =
      userStatus === "ACTIVE" && group.currentUserRole === "ADMIN";
    const canSettle =
      group.status !== "ARCHIVED" && (isYouOwe || (!isOwedToYou && isActiveAdmin));
    const canRemind =
      group.status !== "ARCHIVED" && isOwedToYou && userStatus === "ACTIVE";
    const reminderKey = getReminderCooldownKey(edge.groupId, edge.payerId);
    const reminderCooldown = canRemind
      ? getActiveCooldown(edge.groupId, edge.payerId)
      : null;
    const isSendingReminder = Boolean(sendingReminderKeys[reminderKey]);

    const avatarName = isYouOwe
      ? edge.recipientName
      : isOwedToYou
        ? edge.payerName
        : edge.payerName;

    const primaryLabel = isYouOwe
      ? edge.recipientName
      : isOwedToYou
        ? edge.payerName
        : `${edge.payerName} -> ${edge.recipientName}`;

    const secondaryLabel = isYouOwe
      ? `You owe · ${edge.groupName}`
      : isOwedToYou
        ? `Owes you · ${edge.groupName}`
        : `Suggested transfer · ${edge.groupName}`;

    const amountDisplay = isYouOwe
      ? `-${formatMinorUnits(edge.amountCents, edge.currency)}`
      : isOwedToYou
        ? `+${formatMinorUnits(edge.amountCents, edge.currency)}`
        : formatMinorUnits(edge.amountCents, edge.currency);

    return (
      <div
        key={`${edge.groupId}::${edge.payerId}::${edge.recipientId}`}
        data-testid={`peer-balance-row-${edge.groupId}-${edge.payerId}-${edge.recipientId}`}
        className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-hairline bg-canvas-parchment p-3 transition-colors hover:border-[#c1c6d5]"
      >
        <div className="flex min-w-[140px] flex-1 items-center gap-3">
          <Avatar name={avatarName} size="md" />
          <div className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-ink">
              {primaryLabel}
            </span>
            <span
              className={`block truncate text-[12px] ${
                isYouOwe ? "text-[#ff3b30]" : "text-ink-muted-48"
              }`}
            >
              {secondaryLabel}
            </span>
          </div>
        </div>

        <div className="flex max-w-full flex-wrap items-center gap-2">
          <span
            data-testid={`peer-balance-amount-${edge.payerId}-${edge.recipientId}`}
            className={`text-[13px] font-semibold tabular-nums ${
              isYouOwe
                ? "text-[#dc2626]"
                : isOwedToYou
                  ? "text-[#166534]"
                  : "text-ink"
            }`}
          >
            {amountDisplay}
          </span>
          {canRemind && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid={`remind-peer-btn-${edge.groupId}-${edge.payerId}`}
              loading={isSendingReminder}
              disabled={Boolean(reminderCooldown) || isSendingReminder}
              aria-label={
                reminderCooldown
                  ? `${formatCooldownLabel(reminderCooldown.remainingHours)} for ${edge.payerName}`
                  : `Remind ${edge.payerName}`
              }
              onClick={() =>
                void handleSendSingleReminder(
                  edge.groupId,
                  edge.payerId,
                  edge.payerName,
                  edge.amountCents,
                )
              }
              className={cn(
                "h-8 px-3 text-[12px] whitespace-nowrap",
                reminderCooldown ? "text-ink-muted-48" : "text-[#0066cc]",
              )}
            >
              {reminderCooldown
                ? formatCooldownLabel(reminderCooldown.remainingHours)
                : "Remind"}
            </Button>
          )}
          {canSettle && (
            <Button
              type="button"
              variant={isYouOwe ? "primary" : "secondary"}
              size="sm"
              data-testid={`settle-peer-btn-${edge.groupId}-${edge.recipientId}`}
              onClick={() => openSettlementForEdge(edge)}
              className="h-8 px-3 text-[12px] whitespace-nowrap"
            >
              {isYouOwe ? "Settle now" : "Settle"}
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      {loadError && (
        <AlertBanner
          tone="error"
          title="Could not load all dashboard metrics"
          description={loadError}
        />
      )}

      {/* Page Header */}
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight text-ink">
              Dashboard Overview
            </h1>
            {isCycleClosed && (
              <Badge
                tone="warning"
                size="sm"
                data-testid="settled-closed-period-badge"
              >
                Settled / Closed Period
              </Badge>
            )}
          </div>
          <p className="text-[14px] text-ink-muted-48">
            {activeGroup
              ? `${activeGroup.name} · ${cycleLabel}`
              : `All active groups · ${cycleLabel}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <Button
            type="button"
            variant="secondary"
            size="md"
            leftIcon={<Download className="h-3.5 w-3.5 text-ink-muted-48" aria-hidden="true" />}
            onClick={handleExportCsv}
            className="whitespace-nowrap text-[12px] font-medium"
          >
            Export CSV
          </Button>
          <Button
            type="button"
            variant="icon-circle"
            size="sm"
            aria-label="Refresh dashboard"
            onClick={() => router.refresh()}
            className="h-9 w-9 border border-hairline bg-canvas text-ink-muted-80 hover:bg-surface-pearl"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </section>

      {/* Row 1: 3-Column KPI Row */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Card 1: Net Settlement Balance */}
        <Card
          variant="kpi"
          padding="md"
          data-testid="kpi-net-settlement-balance"
          className="flex flex-col justify-between gap-4"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
              NET SETTLEMENT BALANCE
            </span>
            <span
              className={cn(
                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                netSettlementCents < 0
                  ? "border-[#fecaca] bg-[#fef2f2] text-[#dc2626]"
                  : "border-[#bbf7d0] bg-[#edfbf2] text-[#166534]",
              )}
            >
              {netSettlementCents < 0 ? (
                <TrendingDown className="h-5 w-5" aria-hidden="true" />
              ) : (
                <TrendingUp className="h-5 w-5" aria-hidden="true" />
              )}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <p
              className={cn(
                "text-[32px] leading-tight font-bold tracking-tight tabular-nums",
                netSettlementCents > 0
                  ? "text-[#166534]"
                  : netSettlementCents < 0
                    ? "text-[#dc2626]"
                    : "text-ink",
              )}
            >
              {formatMinorUnits(netSettlementCents, kpi.displayCurrency, {
                showPlus: true,
              })}
            </p>
            <p className="text-[13px] text-ink-muted-48 tabular-nums">
              You are owed {formatMinorUnits(kpi.owedToYouCents, kpi.displayCurrency)} · You owe{" "}
              {formatMinorUnits(kpi.youOweCents, kpi.displayCurrency)}
            </p>
          </div>

          <div className="border-t border-divider-soft pt-2">
            <span className="text-[11px] font-semibold text-ink-muted-48 tabular-nums">
              {activeLedgerGroup
                ? `Verified in ${activeLedgerGroup.name} · ${kpi.displayCurrency}`
                : `All settlements verified across ${scopedGroups.length} ${scopedGroups.length === 1 ? "group" : "groups"}`}
            </span>
          </div>
        </Card>

        {/* Card 2: Total Spent (Cycle) */}
        <Card
          variant="kpi"
          padding="md"
          data-testid="kpi-total-spent"
          className="flex flex-col justify-between gap-4"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
              TOTAL SPENT ({shortCycleLabel.toUpperCase()})
            </span>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-pearl text-ink-muted-48">
              <Receipt className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <p className="text-[32px] leading-tight font-bold tracking-tight tabular-nums text-ink">
                {formatMinorUnits(kpi.totalGroupExpensesCents, kpi.displayCurrency)}
              </p>
              {kpi.momDeltaPercent !== null && (
                <Badge
                  tone={kpi.momDeltaPercent <= 0 ? "success" : "warning"}
                  size="sm"
                  data-testid="kpi-mom-delta"
                  className="whitespace-nowrap tabular-nums"
                >
                  {kpi.momDeltaPercent > 0 ? "+" : ""}
                  {kpi.momDeltaPercent.toFixed(1)}% vs {prevShortCycleLabel}
                </Badge>
              )}
            </div>
            <p className="text-[13px] text-ink-muted-48 tabular-nums">
              Your share: {formatMinorUnits(kpi.personalShareCents, kpi.displayCurrency)} ·{" "}
              {kpi.transactionCount} {kpi.transactionCount === 1 ? "expense" : "expenses"}
            </p>
          </div>

          <div className="border-t border-divider-soft pt-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48 tabular-nums">
              BUDGET UTILIZATION:{" "}
              {kpi.budgetUtilizationPercent !== null
                ? `${kpi.budgetUtilizationPercent.toFixed(1)}%`
                : "N/A"}
            </span>
          </div>
        </Card>

        {/* Card 3: You Owe */}
        <Card
          variant="kpi"
          padding="md"
          data-testid="kpi-you-owe"
          className="flex flex-col justify-between gap-4"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
              YOU OWE
            </span>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#fecaca] bg-[#fef2f2] text-[#dc2626]">
              <ArrowUpRight className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <p
              className={cn(
                "text-[32px] leading-tight font-bold tracking-tight tabular-nums",
                kpi.youOweCents > 0 ? "text-[#dc2626]" : "text-ink",
              )}
            >
              {kpi.youOweCents > 0
                ? `-${formatMinorUnits(kpi.youOweCents, kpi.displayCurrency)}`
                : formatMinorUnits(0, kpi.displayCurrency)}
            </p>
            <p className="text-[13px] text-ink-muted-48 tabular-nums">
              {kpi.youOweCount} pending {kpi.youOweCount === 1 ? "balance" : "balances"} ·{" "}
              {kpi.youOwePeerCount} {kpi.youOwePeerCount === 1 ? "peer" : "peers"}
            </p>
          </div>

          <div className="border-t border-divider-soft pt-2">
            <span className="text-[11px] font-semibold text-ink-muted-48 tabular-nums">
              Next auto-reconciliation: {kpi.nextSettlementDateLabel}
            </span>
          </div>
        </Card>
      </section>

      {/* Row 2: Monthly Category Breakdown (7 cols) + Peer Balances (5 cols) */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 7 Columns: Monthly Category Breakdown */}
        <Card
          variant="section"
          padding="md"
          data-testid="category-breakdown-card"
          className="flex flex-col justify-between lg:col-span-7"
        >
          <div>
            <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                  Monthly Category Breakdown
                </h2>
                <p className="mt-0.5 text-[13px] text-ink-muted-48 tabular-nums">
                  {kpi.operationalBudgetCents !== null &&
                  kpi.operationalBudgetCents > 0 ? (
                    <>
                      {formatMinorUnits(
                        kpi.totalGroupExpensesCents,
                        kpi.displayCurrency,
                      )}{" "}
                      spent of{" "}
                      {formatMinorUnits(
                        kpi.operationalBudgetCents,
                        kpi.displayCurrency,
                      )}{" "}
                      {shortCycleLabel} target (
                      {(kpi.budgetUtilizationPercent ?? 0).toFixed(1)}%)
                    </>
                  ) : (
                    <>
                      {formatMinorUnits(
                        kpi.totalGroupExpensesCents,
                        kpi.displayCurrency,
                      )}{" "}
                      spent across {kpi.categoryTotals.length}{" "}
                      {kpi.categoryTotals.length === 1
                        ? "category"
                        : "categories"}{" "}
                      in {shortCycleLabel}
                    </>
                  )}
                </p>
              </div>
              <Badge
                tone="neutral"
                size="sm"
                data-testid="category-cycle-pill"
                className="shrink-0 whitespace-nowrap tabular-nums"
              >
                {cycleRangePill}
              </Badge>
            </div>

            {/* Multi-segment ProgressBar */}
            <div className="mt-4 mb-5">
              <ProgressBar
                label="Monthly category spending breakdown"
                value={kpi.totalGroupExpensesCents}
                max={Math.max(kpi.totalGroupExpensesCents, 1)}
                size="md"
                segments={
                  kpi.totalGroupExpensesCents > 0
                    ? kpi.categoryTotals.slice(0, 6).map((cat, idx) => ({
                        id: cat.category,
                        label: cat.category,
                        value: cat.amountCents,
                        color: getCategoryColor(cat.category, idx),
                      }))
                    : undefined
                }
                tone="primary"
              />
            </div>

            {/* 6-Category Ranked List */}
            {kpi.categoryTotals.length === 0 ? (
              <div className="rounded-[14px] border border-hairline bg-surface-pearl p-4 text-[13px] text-ink-muted-48">
                No expenses logged in {cycleLabel} yet. Use + Add Expense to record
                a shared bill.
              </div>
            ) : (
              <div className="space-y-1" data-testid="category-breakdown-list">
                {kpi.categoryTotals.slice(0, 6).map((cat, idx) => {
                  const pct =
                    kpi.totalGroupExpensesCents > 0
                      ? Math.round(
                          (cat.amountCents / kpi.totalGroupExpensesCents) * 100,
                        )
                      : 0;
                  return (
                    <Link
                      key={cat.category}
                      href={buildNavHref("/expenses")}
                      data-testid={`category-row-${idx}`}
                      className="flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-pearl"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: getCategoryColor(cat.category, idx),
                          }}
                        />
                        <span className="truncate text-[13px] font-medium text-ink">
                          {cat.category}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-[13px] font-semibold tabular-nums text-ink">
                          {formatMinorUnits(cat.amountCents, kpi.displayCurrency)}
                        </span>
                        <span className="w-10 text-right text-[12px] font-medium tabular-nums text-ink-muted-48">
                          {pct}%
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {/* Right 5 Columns: Peer Balances (per-group simplification is always-on) */}
        <Card
          variant="section"
          padding="md"
          data-testid="peer-balances-card"
          className="flex flex-col justify-between gap-4 lg:col-span-5"
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                  Peer Balances
                </h2>
                <p className="text-[13px] text-ink-muted-48">
                  {activeLedgerGroup
                    ? `Active settlements in ${activeLedgerGroup.name}`
                    : "Active settlements across all groups"}
                </p>
              </div>
            </div>

            {/* Balances List */}
            <div
              data-testid="peer-balances-list"
              className="flex flex-col gap-2.5"
            >
              {scopedGroups.length === 0 ? (
                <div className="rounded-[14px] border border-hairline bg-surface-pearl p-4 text-[13px] text-ink-muted-48">
                  Create or join a split group to track peer balances.
                </div>
              ) : activeLedgerGroup ? (
                debtsByGroup[0]?.edges.length === 0 ? (
                  <div className="rounded-[14px] border border-hairline bg-surface-pearl p-4 text-[13px] text-ink-muted-48">
                    All balances settled in {activeLedgerGroup.name}.
                  </div>
                ) : (
                  debtsByGroup[0].edges.map((edge) =>
                    renderEdgeRow(edge, activeLedgerGroup),
                  )
                )
              ) : (
                debtsByGroup.map(({ group, edges }) => (
                  <div
                    key={group.id}
                    data-testid={`peer-balance-group-${group.id}`}
                    className="flex flex-col gap-2 rounded-[14px] border border-hairline bg-canvas p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-ink">
                          {group.name}
                        </span>
                        <Badge tone="neutral" size="sm">
                          {group.baseCurrency}
                        </Badge>
                      </div>
                    </div>
                    {edges.length === 0 ? (
                      <p className="text-[12px] text-ink-muted-48">
                        All balances settled in this group.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {edges.map((edge) => renderEdgeRow(edge, group))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Net Bottom Summary */}
          <div
            data-testid="overall-net-settlement"
            className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-hairline bg-surface-pearl p-3"
          >
            <span className="text-[12px] font-medium text-ink-muted-48">
              Overall Net Settlement
            </span>
            <span
              className={cn(
                "text-[13px] font-bold tabular-nums",
                netSettlementCents > 0
                  ? "text-[#166534]"
                  : netSettlementCents < 0
                    ? "text-[#dc2626]"
                    : "text-ink",
              )}
            >
              {netSettlementCents > 0
                ? `${formatMinorUnits(netSettlementCents, kpi.displayCurrency, { showPlus: true })} in your favor`
                : netSettlementCents < 0
                  ? `${formatMinorUnits(netSettlementCents, kpi.displayCurrency)} net you owe`
                  : `${formatMinorUnits(0, kpi.displayCurrency)} all settled`}
            </span>
          </div>
        </Card>
      </section>

      {/* Recent Shared Transactions */}
      <Card
        variant="section"
        padding="md"
        data-testid="recent-shared-transactions-card"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">
              Recent Shared Transactions
            </h2>
            <p className="text-[13px] text-ink-muted-48 tabular-nums">
              Latest 5 expenses · Click a row for split details
            </p>
          </div>

          <Link
            href={buildNavHref("/expenses")}
            data-testid="view-all-expenses-link"
            className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-[#0066cc] transition-colors hover:bg-surface-pearl"
          >
            <span className="tabular-nums">
              View all {cycleExpenses.length} in Expenses
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </Link>
        </div>

        <Table aria-label="Recent Shared Transactions">
          <TableHeader>
            <TableRow>
              <TableHead>DATE</TableHead>
              <TableHead>MERCHANT &amp; GROUP</TableHead>
              <TableHead>CATEGORY</TableHead>
              <TableHead>PAID BY</TableHead>
              <TableHead>SPLIT</TableHead>
              <TableHead className="text-right">YOUR SHARE</TableHead>
              <TableHead className="text-center">STATUS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentExpenses.length === 0 ? (
              <TableEmpty
                colSpan={7}
                title="No shared transactions in this period"
                description={
                  effectiveGroups.length === 0
                    ? "Create a split group first, then use + Add Expense to log shared bills."
                    : `No expenses logged for ${cycleLabel}. Use + Add Expense to record your first split.`
                }
              />
            ) : (
              recentExpenses.map((exp) => {
                const dateParts = formatDateParts(exp.expenseDate);
                const myShareCents = getUserShareCents(exp, currentUserId);
                const isUserPayer = exp.paidBy === currentUserId;
                const netDeltaCents = isUserPayer
                  ? exp.amountCents - myShareCents
                  : -myShareCents;
                const isSettled = exp.isSettledForUser || exp.isLocked;

                return (
                  <TableRow
                    key={exp.id}
                    data-testid={`dashboard-tx-row-${exp.id}`}
                    onClick={() => setInspectExpense(exp)}
                  >
                    <TableCell className="whitespace-nowrap text-[12px] text-ink-muted-48 tabular-nums">
                      <span>{dateParts.date}</span>
                      {dateParts.time && (
                        <span className="ml-1.5 text-ink-muted-48">
                          {dateParts.time}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[160px] max-w-[240px]">
                      <div className="flex min-w-0 flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-ink">
                            {exp.description}
                          </span>
                          {exp.adjustmentForExpenseId && (
                            <Badge tone="warning" size="sm">
                              Adjustment
                            </Badge>
                          )}
                        </div>
                        <span className="truncate text-[11px] font-medium text-ink-muted-48">
                          {exp.groupName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge
                        tone="category"
                        size="sm"
                        dotColor={getCategoryColor(exp.category)}
                      >
                        {exp.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <Avatar name={exp.payerName} size="sm" />
                        <span className="text-[12px] font-medium text-ink-muted-80">
                          {isUserPayer ? "You" : exp.payerName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[12px] text-ink-muted-80 tabular-nums">
                      {formatSplitLabel(
                        exp.splitMethod,
                        exp.splitBreakdown,
                        currentUserId,
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <span
                        className={cn(
                          "text-[13px] font-semibold tabular-nums",
                          netDeltaCents > 0
                            ? "text-[#166534]"
                            : netDeltaCents < 0
                              ? "text-[#dc2626]"
                              : "text-ink-muted-48",
                        )}
                      >
                        {formatMinorUnits(netDeltaCents, exp.currency, {
                          showPlus: true,
                        })}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-center">
                      <Badge
                        tone={isSettled ? "success" : "warning"}
                        size="sm"
                      >
                        {isSettled ? "Settled" : "Pending"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <RecordSettlementModal
        open={settlementModalOpen}
        onClose={() => setSettlementModalOpen(false)}
        debts={settleableDebts}
        currentUserId={currentUserId}
        initialDebtKey={selectedDebtKey}
        defaultPaymentRail={shellUser?.defaultPaymentRail}
        currentUserInstantTag={shellUser?.instantSettlementTag}
        onSettled={(settlement) => {
          setAddedSettlements((prev) => [
            {
              id: settlement.id,
              groupId: settlement.group_id,
              payerId: settlement.payer_id,
              recipientId: settlement.recipient_id,
              amountCents: Number(settlement.amount_cents),
              currency: settlement.currency,
              settledAt: settlement.settled_at,
            },
            ...prev,
          ]);
          pushToast({
            tone: "success",
            title: "Settlement recorded",
            description: `Logged ${formatMinorUnits(Number(settlement.amount_cents), settlement.currency)} via ${settlement.payment_rail}.`,
          });
          router.refresh();
        }}
      />

      {/* Split Inspection Dialog */}
      {(() => {
        const inspectGroup = inspectExpense
          ? effectiveGroups.find((g) => g.id === inspectExpense.groupId)
          : null;
        const inspectMember = inspectGroup?.members.find(
          (m) => m.userId === currentUserId,
        );
        const inspectIsActiveMember = inspectMember?.status === "ACTIVE";
        const inspectIsAdmin =
          inspectIsActiveMember && inspectGroup?.currentUserRole === "ADMIN";
        const inspectIsCreator =
          inspectIsActiveMember && inspectExpense?.createdBy === currentUserId;
        const inspectIsArchived = inspectGroup?.status === "ARCHIVED";
        const canModifyInspect =
          Boolean(inspectExpense) &&
          !inspectExpense?.isLocked &&
          !inspectIsArchived &&
          (inspectIsAdmin || inspectIsCreator);

        return (
          <Dialog
            open={inspectExpense !== null}
            onClose={() => setInspectExpense(null)}
            title={inspectExpense?.description ?? "Expense Details"}
            description={
              inspectExpense
                ? `${inspectExpense.groupName} · ${formatDateParts(inspectExpense.expenseDate).date}`
                : undefined
            }
            size="md"
            footer={
              <div className="flex flex-wrap items-center gap-2">
                {canModifyInspect && inspectExpense && (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      leftIcon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => {
                        const target = inspectExpense;
                        setInspectExpense(null);
                        setEditingExpense(target);
                      }}
                    >
                      Edit Expense
                    </Button>
                    <Button
                      type="button"
                      variant="danger-soft"
                      size="sm"
                      leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => {
                        const target = inspectExpense;
                        setInspectExpense(null);
                        setDeleteExpenseError(null);
                        setDeletingExpense(target);
                      }}
                    >
                      Delete Expense
                    </Button>
                  </>
                )}
                {inspectExpense?.isLocked &&
                  inspectGroup &&
                  !inspectIsArchived &&
                  inspectIsActiveMember && (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      leftIcon={
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      }
                      onClick={() => {
                        const target = inspectExpense;
                        setInspectExpense(null);
                        setAdjustingExpense(target);
                      }}
                    >
                      Log Adjustment
                    </Button>
                  )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setInspectExpense(null)}
                >
                  Close
                </Button>
              </div>
            }
          >
            {inspectExpense && (
              <div className="flex flex-col gap-4">
                {inspectExpense.isLocked && (
                  <AlertBanner
                    tone="warning"
                    title="Immutable Locked Expense"
                    description={
                      inspectExpense.isCycleClosed
                        ? "This expense belongs to a closed billing cycle and cannot be edited or deleted. Log an Offsetting Adjustment if a correction is needed."
                        : "A pairwise settlement watermark covers this expense, locking its split breakdown against edits."
                    }
                  />
                )}

                <div className="grid grid-cols-2 gap-3 rounded-[14px] border border-hairline bg-canvas-parchment p-4 text-[13px]">
                  <div>
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                      Total Amount
                    </span>
                    <span className="font-semibold tabular-nums text-ink">
                      {formatMinorUnits(
                        inspectExpense.amountCents,
                        inspectExpense.currency,
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                      Paid By
                    </span>
                    <span className="font-semibold text-ink">
                      {inspectExpense.paidBy === currentUserId
                        ? `You (${inspectExpense.payerName})`
                        : inspectExpense.payerName}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                      Category
                    </span>
                    <span className="font-medium text-ink">
                      {inspectExpense.category}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                      Status
                    </span>
                    <Badge
                      tone={
                        inspectExpense.isSettledForUser || inspectExpense.isLocked
                          ? "success"
                          : "warning"
                      }
                      size="sm"
                    >
                      {inspectExpense.isSettledForUser || inspectExpense.isLocked
                        ? "Settled"
                        : "Pending"}
                    </Badge>
                  </div>
                </div>

                {inspectExpense.receiptUrl && (
                  <a
                    href={`/api/receipts?path=${encodeURIComponent(inspectExpense.receiptUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-fit items-center gap-1.5 text-[12px] font-medium text-[#0066cc] hover:underline"
                  >
                    <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>View attached receipt</span>
                  </a>
                )}

                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                    Point-in-Time Split Snapshot ({inspectExpense.splitMethod})
                  </span>
                  <ul className="divide-y divide-divider-soft rounded-[14px] border border-hairline bg-canvas">
                    {inspectExpense.splitBreakdown.map((item) => {
                      const member = inspectGroup?.members.find(
                        (m) => m.userId === item.user_id,
                      );
                      const memberName = member?.name ?? "Group Member";
                      return (
                        <li
                          key={item.user_id}
                          className="flex items-center justify-between px-4 py-2.5 text-[13px]"
                        >
                          <span className="font-medium text-ink">
                            {item.user_id === currentUserId
                              ? `${memberName} (You)`
                              : memberName}
                          </span>
                          <span className="font-semibold tabular-nums text-ink">
                            {formatMinorUnits(
                              item.share_cents,
                              inspectExpense.currency,
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </Dialog>
        );
      })()}

      {/* Edit Expense Modal */}
      <AddEditExpenseModal
        open={editingExpense !== null}
        onClose={() => setEditingExpense(null)}
        mode="edit"
        expense={editingExpense}
        onSwitchToAdjustment={() => {
          const target = editingExpense;
          setEditingExpense(null);
          if (target) setAdjustingExpense(target);
        }}
        groups={modalGroups}
        activeGroupId={editingExpense?.groupId ?? activeGroupId}
        currentUser={
          shellUser ?? {
            id: currentUserId,
            fullName: "Member",
            email: "",
          }
        }
        cycle={cycle}
        onReceiptStorageUsedBytesChange={updateReceiptStorageUsedBytes}
        onUpdated={handleExpenseUpdated}
      />

      {/* Offsetting Adjustment Modal */}
      <AddEditExpenseModal
        open={adjustingExpense !== null}
        onClose={() => setAdjustingExpense(null)}
        mode="adjustment"
        expense={adjustingExpense}
        groups={modalGroups}
        activeGroupId={adjustingExpense?.groupId ?? activeGroupId}
        currentUser={
          shellUser ?? {
            id: currentUserId,
            fullName: "Member",
            email: "",
          }
        }
        cycle={cycle}
        onReceiptStorageUsedBytesChange={updateReceiptStorageUsedBytes}
        onCreated={handleAdjustmentCreated}
      />

      {/* Soft-Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deletingExpense !== null}
        onClose={() => {
          if (!isDeletingExpense) {
            setDeleteExpenseError(null);
            setDeletingExpense(null);
          }
        }}
        onConfirm={handleConfirmSoftDelete}
        title="Delete Unlocked Expense?"
        description={
          deletingExpense
            ? `Soft-delete "${deletingExpense.description}" (${formatMinorUnits(deletingExpense.amountCents, deletingExpense.currency)}) from ${deletingExpense.groupName}? Active group balances will recalculate immediately.`
            : undefined
        }
        confirmLabel="Delete Expense"
        variant="danger"
        loading={isDeletingExpense}
      >
        {deleteExpenseError && (
          <AlertBanner
            tone="error"
            title="Could not delete expense"
            description={deleteExpenseError}
          />
        )}
      </ConfirmDialog>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
