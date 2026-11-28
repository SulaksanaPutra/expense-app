"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Lock,
  Pencil,
  PieChart,
  Plus,
  RefreshCw,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  Dropdown,
  Pagination,
  ProgressBar,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  ToastContainer,
} from "@/components/ui";
import type {
  DropdownItem,
  SelectOption,
  SortDirection,
  ToastItem,
} from "@/components/ui";
import {
  REALTIME_LEDGER_CHANGE_EVENT,
  useActiveGroup,
} from "@/components/shell";
import type {
  RealtimeLedgerChangeDetail,
  ShellGroupSummary,
} from "@/components/shell/types";
import {
  ALL_GROUPS_VALUE,
  formatCycleLabel,
} from "@/components/shell/url-state";
import {
  computeExpensesKpiSummary,
  computePerGroupDebtEdges,
  evaluateExpenseLockAndSettlement,
  filterAndSortExpenses,
  getUserShareCents,
  isBillingCycleClosedForWindow,
  stepCycleSlugSafe,
  type ExpenseBillingCycleRecord,
  type ExpenseGroupInfo,
  type ExpenseLedgerRecord,
  type ExpenseOwnershipFilter,
  type ExpenseSettlementRecord,
  type ExpenseSortOption,
  type ExpenseStatusFilter,
} from "@/lib/expenses/ledger";
import { formatMinorUnits } from "@/lib/money";
import type { Database, ExpenseSplitMethod } from "@/types/database";
import { AddEditExpenseModal } from "./AddEditExpenseModal";
import {
  RecordSettlementModal,
  getSettlementDebtKey,
} from "./RecordSettlementModal";

const PAGE_SIZE = 8;

const QUICK_FILTER_CATEGORIES = [
  { value: "Groceries", label: "Groceries", dotColor: "#22c55e" },
  { value: "Utilities", label: "Utilities", dotColor: "#0066cc" },
  { value: "Dining", label: "Dining", dotColor: "#f59e0b" },
  { value: "Travel", label: "Travel", dotColor: "#a855f7" },
] as const;

const OWNERSHIP_OPTIONS: SelectOption[] = [
  { value: "all", label: "All Expenses" },
  { value: "paid-by-me", label: "Paid by Me" },
  { value: "split-with-me", label: "Split with Me" },
];

const STATUS_OPTIONS: SelectOption[] = [
  { value: "all", label: "All" },
  { value: "settled", label: "Settled" },
  { value: "pending", label: "Pending" },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: "date-desc", label: "Date (Newest)" },
  { value: "date-asc", label: "Date (Oldest)" },
  { value: "amount-desc", label: "Amount (Highest)" },
  { value: "amount-asc", label: "Amount (Lowest)" },
  { value: "share-desc", label: "Your Share (Highest)" },
];

const CATEGORY_COLORS: Record<string, string> = {
  Groceries: "#22c55e",
  "Groceries & Food": "#22c55e",
  Utilities: "#0066cc",
  "Housing & Utilities": "#0066cc",
  "Rent & Housing": "#0066cc",
  "Home Goods": "#0066cc",
  "Household Supplies": "#0066cc",
  "Supplies & Misc": "#0066cc",
  Dining: "#f59e0b",
  "Dining & Social": "#f59e0b",
  "Dining Out": "#f59e0b",
  "Food & Drink": "#f59e0b",
  Travel: "#a855f7",
  "Travel & Fuel": "#a855f7",
  "Transit & Travel": "#a855f7",
  Transport: "#a855f7",
  Entertainment: "#ec4899",
  General: "#7a7a7a",
};

function getCategoryColor(category: string): string {
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category];
  const lower = category.toLowerCase();
  if (lower.includes("grocer")) return "#22c55e";
  if (lower.includes("utilit") || lower.includes("hous")) return "#0066cc";
  if (lower.includes("dining") || lower.includes("food")) return "#f59e0b";
  if (lower.includes("travel") || lower.includes("transit")) return "#a855f7";
  if (lower.includes("entertain")) return "#ec4899";
  return "#7a7a7a";
}

function formatSplitLabel(
  method: ExpenseSplitMethod,
  splitBreakdown: ExpenseLedgerRecord["splitBreakdown"],
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

function formatShortDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function parseOwnershipParam(raw: string | null): ExpenseOwnershipFilter {
  if (raw === "paid-by-me" || raw === "split-with-me") {
    return raw;
  }
  return "all";
}

function parseStatusParam(raw: string | null): ExpenseStatusFilter {
  if (raw === "settled" || raw === "pending") {
    return raw;
  }
  return "all";
}

function parseSortParam(raw: string | null): ExpenseSortOption {
  if (
    raw === "date-desc" ||
    raw === "date-asc" ||
    raw === "amount-desc" ||
    raw === "amount-asc" ||
    raw === "share-desc"
  ) {
    return raw;
  }
  return "date-desc";
}

function parsePageParam(raw: string | null): number {
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export interface ExpensesClientProps {
  currentUserId: string;
  userBaseCurrency: string;
  personalShareCapCents: number | null;
  initialGroups: ExpenseGroupInfo[];
  initialExpenses: ExpenseLedgerRecord[];
  initialSettlements: ExpenseSettlementRecord[];
  initialBillingCycles: ExpenseBillingCycleRecord[];
  loadError?: string | null;
}

export function ExpensesClient({
  currentUserId,
  userBaseCurrency,
  personalShareCapCents,
  initialGroups,
  initialExpenses,
  initialSettlements,
  initialBillingCycles,
  loadError = null,
}: ExpensesClientProps) {
  const router = useRouter();
  const pathname = usePathname() || "/expenses";
  const searchParams = useSearchParams();
  const {
    groups: shellGroups,
    activeGroupId,
    activeGroup,
    cycle,
    user: shellUser,
    updateReceiptStorageUsedBytes,
    openAddExpense,
  } = useActiveGroup();

  const [addedExpenses, setAddedExpenses] = React.useState<ExpenseLedgerRecord[]>(
    [],
  );
  const [editedExpenses, setEditedExpenses] = React.useState<
    Record<string, ExpenseLedgerRecord>
  >({});
  const [deletedExpenseIds, setDeletedExpenseIds] = React.useState<string[]>([]);
  const [addedSettlements, setAddedSettlements] = React.useState<
    ExpenseSettlementRecord[]
  >([]);
  const [addedBillingCycles, setAddedBillingCycles] = React.useState<
    ExpenseBillingCycleRecord[]
  >([]);

  const settlements = React.useMemo(() => {
    const byId = new Map<string, ExpenseSettlementRecord>();
    for (const item of addedSettlements) byId.set(item.id, item);
    for (const item of initialSettlements) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return Array.from(byId.values());
  }, [addedSettlements, initialSettlements]);

  const billingCycles = React.useMemo(() => {
    const byId = new Map<string, ExpenseBillingCycleRecord>();
    for (const bc of addedBillingCycles) byId.set(bc.id, bc);
    for (const bc of initialBillingCycles) {
      if (!byId.has(bc.id)) byId.set(bc.id, bc);
    }
    return Array.from(byId.values());
  }, [addedBillingCycles, initialBillingCycles]);

  const expenses = React.useMemo(() => {
    const deletedSet = new Set(deletedExpenseIds);
    const byId = new Map<string, ExpenseLedgerRecord>();
    for (const item of addedExpenses) {
      if (!deletedSet.has(item.id)) byId.set(item.id, item);
    }
    for (const item of initialExpenses) {
      if (!deletedSet.has(item.id) && !byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
    return Array.from(byId.values()).map((rawItem) => {
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
        billingCycles,
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
    });
  }, [
    addedExpenses,
    billingCycles,
    currentUserId,
    deletedExpenseIds,
    editedExpenses,
    initialExpenses,
    settlements,
  ]);

  const searchKey = searchParams.toString();
  const urlQ = searchParams.get("q") ?? "";
  const urlOwnership = parseOwnershipParam(
    searchParams.get("ownership") ?? searchParams.get("tab"),
  );
  const urlStatus = parseStatusParam(searchParams.get("status"));
  const urlCat = searchParams.get("cat") ?? "all";
  const urlSort = parseSortParam(searchParams.get("sort"));
  const urlPage = parsePageParam(searchParams.get("page"));

  const [optimisticFilters, setOptimisticFilters] = React.useState<{
    forSearchKey: string;
    q?: string;
    ownership?: ExpenseOwnershipFilter;
    status?: ExpenseStatusFilter;
    cat?: string;
    sort?: ExpenseSortOption;
    page?: number;
  }>({ forSearchKey: searchKey });

  const isOptimistic = optimisticFilters.forSearchKey === searchKey;
  const searchQuery =
    isOptimistic && optimisticFilters.q !== undefined
      ? optimisticFilters.q
      : urlQ;
  const ownershipFilter =
    isOptimistic && optimisticFilters.ownership !== undefined
      ? optimisticFilters.ownership
      : urlOwnership;
  const statusFilter =
    isOptimistic && optimisticFilters.status !== undefined
      ? optimisticFilters.status
      : urlStatus;
  const selectedCategory =
    isOptimistic && optimisticFilters.cat !== undefined
      ? optimisticFilters.cat
      : urlCat;
  const sortBy =
    isOptimistic && optimisticFilters.sort !== undefined
      ? optimisticFilters.sort
      : urlSort;
  const currentPage =
    isOptimistic && optimisticFilters.page !== undefined
      ? optimisticFilters.page
      : urlPage;

  const syncQueryParams = React.useCallback(
    (updates: {
      q?: string;
      ownership?: ExpenseOwnershipFilter;
      status?: ExpenseStatusFilter;
      cat?: string;
      sort?: ExpenseSortOption;
      page?: number;
    }) => {
      setOptimisticFilters((prev) => ({
        ...(prev.forSearchKey === searchKey ? prev : {}),
        forSearchKey: searchKey,
        ...updates,
      }));

      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("tab");

      if (updates.q !== undefined) {
        const trimmed = updates.q.trim();
        if (trimmed) nextParams.set("q", trimmed);
        else nextParams.delete("q");
      }
      if (updates.ownership !== undefined) {
        if (updates.ownership !== "all") {
          nextParams.set("ownership", updates.ownership);
        } else {
          nextParams.delete("ownership");
        }
      }
      if (updates.status !== undefined) {
        if (updates.status !== "all") {
          nextParams.set("status", updates.status);
        } else {
          nextParams.delete("status");
        }
      }
      if (updates.cat !== undefined) {
        if (updates.cat && updates.cat !== "all") {
          nextParams.set("cat", updates.cat);
        } else {
          nextParams.delete("cat");
        }
      }
      if (updates.sort !== undefined) {
        if (updates.sort !== "date-desc") {
          nextParams.set("sort", updates.sort);
        } else {
          nextParams.delete("sort");
        }
      }
      if (updates.page !== undefined) {
        if (updates.page > 1) {
          nextParams.set("page", String(updates.page));
        } else {
          nextParams.delete("page");
        }
      }

      const qs = nextParams.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchKey, searchParams],
  );

  // Listen to global expense-created event from TopBar AddEditExpenseModal
  React.useEffect(() => {
    const handleCreated = (event: Event) => {
      const custom = event as CustomEvent<{
        id: string;
        group_id: string;
        created_by: string;
        paid_by: string;
        description: string;
        category: string;
        expense_date: string;
        amount_cents: number;
        currency: string;
        split_method: ExpenseSplitMethod;
        split_breakdown: Array<{
          user_id: string;
          share_cents: number;
          percentage?: number;
          shares?: number;
        }>;
        receipt_url: string | null;
        adjustment_for_expense_id: string | null;
        is_locked: boolean;
      }>;
      const created = custom.detail;
      if (!created || !created.id) return;
      const group = initialGroups.find((g) => g.id === created.group_id);
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
        prev.some((item) => item.id === newRecord.id) ? prev : [newRecord, ...prev],
      );
    };
    window.addEventListener("ledgersplit:expense-created", handleCreated);
    return () =>
      window.removeEventListener("ledgersplit:expense-created", handleCreated);
  }, [initialGroups]);

  React.useEffect(() => {
    const handleRealtimeChange = (event: Event) => {
      const detail = (event as CustomEvent<RealtimeLedgerChangeDetail>).detail;
      if (!detail || detail.table !== "expenses") return;
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
    };

    window.addEventListener(REALTIME_LEDGER_CHANGE_EVENT, handleRealtimeChange);
    return () =>
      window.removeEventListener(
        REALTIME_LEDGER_CHANGE_EVENT,
        handleRealtimeChange,
      );
  }, []);

  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const toastCounter = React.useRef(0);
  const pushToast = React.useCallback((toast: Omit<ToastItem, "id">) => {
    toastCounter.current += 1;
    setToasts((prev) => [
      ...prev,
      { ...toast, id: `exp-toast-${toastCounter.current}` },
    ]);
  }, []);
  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const [settleModalOpen, setSettleModalOpen] = React.useState(false);
  const [settleInitialDebtKey, setSettleInitialDebtKey] = React.useState<
    string | null
  >(null);
  const [inspectExpense, setInspectExpense] =
    React.useState<ExpenseLedgerRecord | null>(null);
  const [editingExpense, setEditingExpense] =
    React.useState<ExpenseLedgerRecord | null>(null);
  const [adjustingExpense, setAdjustingExpense] =
    React.useState<ExpenseLedgerRecord | null>(null);
  const [closeCycleConfirmOpen, setCloseCycleConfirmOpen] =
    React.useState(false);
  const [closingCycle, setClosingCycle] = React.useState(false);
  const [closeCycleError, setCloseCycleError] = React.useState<string | null>(
    null,
  );
  const [deletingExpense, setDeletingExpense] =
    React.useState<ExpenseLedgerRecord | null>(null);
  const [isDeletingExpense, setIsDeletingExpense] = React.useState(false);
  const [deleteExpenseError, setDeleteExpenseError] = React.useState<
    string | null
  >(null);

  const modalGroups = React.useMemo<ShellGroupSummary[]>(() => {
    const shellById = new Map(shellGroups.map((g) => [g.id, g]));
    return initialGroups.map((g) => {
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
  }, [initialGroups, shellGroups]);

  const handleExpenseUpdated = React.useCallback(
    (payload: {
      expense: Database["public"]["Tables"]["expenses"]["Row"];
      revision?: Database["public"]["Tables"]["expense_revisions"]["Row"];
      notifications?: Database["public"]["Tables"]["notifications"]["Row"][];
    }) => {
      const updated = payload.expense;
      const group = initialGroups.find((g) => g.id === updated.group_id);
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
        billingCycles,
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
      const notifCount = payload.notifications?.length ?? 0;
      pushToast({
        tone: "success",
        title: "Expense updated",
        description:
          notifCount > 0
            ? `${updated.description} (${formatMinorUnits(updated.amount_cents, updated.currency)}) saved. Recorded revision and notified ${notifCount} ${notifCount === 1 ? "member" : "members"}.`
            : `${updated.description} (${formatMinorUnits(updated.amount_cents, updated.currency)}) saved with revision history.`,
      });
      router.refresh();
    },
    [billingCycles, currentUserId, initialGroups, pushToast, router, settlements],
  );

  const handleAdjustmentCreated = React.useCallback(
    (created: Database["public"]["Tables"]["expenses"]["Row"]) => {
      const group = initialGroups.find((g) => g.id === created.group_id);
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
        prev.some((item) => item.id === newRecord.id) ? prev : [newRecord, ...prev],
      );
      pushToast({
        tone: "success",
        title: "Offsetting adjustment logged",
        description: `${created.description} (${formatMinorUnits(created.amount_cents, created.currency)}) added to ${group?.name ?? "group"}.`,
      });
      router.refresh();
    },
    [initialGroups, pushToast, router],
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

  const handleOwnershipChange = (nextOwnership: string) => {
    syncQueryParams({
      ownership: parseOwnershipParam(nextOwnership),
      page: 1,
    });
  };

  const handleStatusChange = (nextStatus: string) => {
    syncQueryParams({
      status: parseStatusParam(nextStatus),
      page: 1,
    });
  };

  const handleCategoryChange = (cat: string) => {
    syncQueryParams({ cat, page: 1 });
  };

  const handleSortChange = (nextSort: string) => {
    syncQueryParams({ sort: parseSortParam(nextSort), page: 1 });
  };

  const handlePageChange = (page: number) => {
    syncQueryParams({ page });
  };

  const shellInstantTag = shellUser?.instantSettlementTag;

  const effectiveGroups = React.useMemo<ExpenseGroupInfo[]>(() => {
    const shellById = new Map(shellGroups.map((sg) => [sg.id, sg]));
    return initialGroups.map((g) => {
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
      if (!sg) {
        return nextMembers === g.members ? g : { ...g, members: nextMembers };
      }
      return {
        ...g,
        defaultSplitMode: sg.defaultSplitMode ?? g.defaultSplitMode,
        simplifyDebts: sg.simplifyDebts ?? g.simplifyDebts,
        members: nextMembers,
      };
    });
  }, [currentUserId, initialGroups, shellGroups, shellInstantTag]);

  const effectivePersonalShareCapCents =
    shellUser?.personalShareCapCents !== undefined
      ? shellUser.personalShareCapCents
      : personalShareCapCents;
  const effectiveUserBaseCurrency =
    shellUser?.baseCurrency ?? userBaseCurrency;

  const kpi = React.useMemo(
    () =>
      computeExpensesKpiSummary({
        expenses,
        groups: effectiveGroups,
        settlements,
        activeGroupId,
        cycleSlug: cycle,
        currentUserId,
        userBaseCurrency: effectiveUserBaseCurrency,
        personalShareCapCents: effectivePersonalShareCapCents,
      }),
    [
      activeGroupId,
      currentUserId,
      cycle,
      effectiveGroups,
      effectivePersonalShareCapCents,
      effectiveUserBaseCurrency,
      expenses,
      settlements,
    ],
  );

  const scopedGroups = React.useMemo(
    () =>
      activeGroupId === ALL_GROUPS_VALUE
        ? effectiveGroups
        : effectiveGroups.filter((g) => g.id === activeGroupId),
    [activeGroupId, effectiveGroups],
  );

  const settleableDebts = React.useMemo(() => {
    const allowedEdges = scopedGroups.flatMap((group) => {
      if (group.status === "ARCHIVED") return [];
      const member = group.members.find((m) => m.userId === currentUserId);
      const userStatus = group.currentUserStatus ?? member?.status ?? null;
      const isActiveAdmin =
        userStatus === "ACTIVE" && group.currentUserRole === "ADMIN";
      const edges = computePerGroupDebtEdges({ group, expenses, settlements });
      return isActiveAdmin
        ? edges
        : edges.filter(
            (edge) =>
              edge.payerId === currentUserId ||
              edge.recipientId === currentUserId,
          );
    });

    return allowedEdges.sort((a, b) => {
      const rank = (edge: (typeof allowedEdges)[number]) =>
        edge.payerId === currentUserId
          ? 0
          : edge.recipientId === currentUserId
            ? 1
            : 2;
      return rank(a) - rank(b) || b.amountCents - a.amountCents;
    });
  }, [currentUserId, expenses, scopedGroups, settlements]);

  const activeLedgerGroup = React.useMemo(
    () =>
      activeGroupId === ALL_GROUPS_VALUE
        ? null
        : (effectiveGroups.find((g) => g.id === activeGroupId) ?? null),
    [activeGroupId, effectiveGroups],
  );

  const isFormerMemberInActiveGroup = React.useMemo(() => {
    if (!activeLedgerGroup) return false;
    const status =
      activeLedgerGroup.currentUserStatus ??
      activeLedgerGroup.members.find((m) => m.userId === currentUserId)?.status;
    return status === "FORMER_MEMBER";
  }, [activeLedgerGroup, currentUserId]);

  const isCycleClosed = React.useMemo(
    () =>
      scopedGroups.length > 0 &&
      scopedGroups.every((g) =>
        isBillingCycleClosedForWindow(
          g.id,
          cycle,
          g.billingCycleAnchorDay,
          billingCycles,
        ),
      ),
    [billingCycles, cycle, scopedGroups],
  );

  const handleConfirmCloseCycle = React.useCallback(async () => {
    if (!activeLedgerGroup || closingCycle) return;
    setCloseCycleError(null);
    setClosingCycle(true);
    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(activeLedgerGroup.id)}/billing-cycles/close`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cycle }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        billingCycle?: Database["public"]["Tables"]["billing_cycles"]["Row"];
        lockedExpenseCount?: number;
      };
      if (!response.ok || !payload.billingCycle) {
        setCloseCycleError(
          payload.error || "Unable to close and lock this billing cycle.",
        );
        setClosingCycle(false);
        return;
      }

      const closed = payload.billingCycle;
      setAddedBillingCycles((prev) => [
        ...prev,
        {
          id: closed.id,
          groupId: closed.group_id,
          periodStart: closed.period_start,
          periodEnd: closed.period_end,
          status: closed.status,
        },
      ]);
      const lockedCount = payload.lockedExpenseCount ?? 0;
      const label = formatCycleLabel(cycle);
      pushToast({
        tone: "success",
        title: "Billing cycle closed & locked",
        description: `${label} for ${activeLedgerGroup.name} is now CLOSED (${lockedCount} ${lockedCount === 1 ? "expense" : "expenses"} locked).`,
      });
      setCloseCycleConfirmOpen(false);
      setClosingCycle(false);
      router.refresh();
    } catch {
      setCloseCycleError("Network error while closing billing cycle.");
      setClosingCycle(false);
    }
  }, [activeLedgerGroup, closingCycle, cycle, pushToast, router]);

  const filteredExpenses = React.useMemo(
    () =>
      filterAndSortExpenses({
        expenses,
        activeGroupId,
        cycleSlug: cycle,
        currentUserId,
        ownership: ownershipFilter,
        status: statusFilter,
        searchQuery,
        category: selectedCategory,
        sortBy,
      }),
    [
      activeGroupId,
      currentUserId,
      cycle,
      expenses,
      ownershipFilter,
      searchQuery,
      selectedCategory,
      sortBy,
      statusFilter,
    ],
  );

  const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const paginatedExpenses = React.useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredExpenses.slice(start, start + PAGE_SIZE);
  }, [filteredExpenses, safePage]);

  const handleExportCsv = () => {
    const scopeParam = activeGroupId || ALL_GROUPS_VALUE;
    const params = new URLSearchParams({
      group: scopeParam,
      cycle,
      format: "csv",
    });
    if (selectedCategory && selectedCategory !== "all") {
      params.set("cat", selectedCategory);
    }
    if (ownershipFilter !== "all") {
      params.set("ownership", ownershipFilter);
    }
    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }
    if (searchQuery.trim()) {
      params.set("q", searchQuery.trim());
    }
    if (sortBy !== "date-desc") {
      params.set("sort", sortBy);
    }
    const url = `/api/expenses/export?${params.toString()}`;
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

  const cycleLabel = formatCycleLabel(cycle);
  const cycleShortLabel = formatCycleLabel(cycle, "short");
  const prevCycleShort = formatCycleLabel(
    stepCycleSlugSafe(cycle, -1),
    "short",
  ).split(" ")[0];

  const capPctRaw = kpi.personalCapPercent ?? 0;
  const capPctClamped = Math.min(Math.max(Math.round(capPctRaw), 0), 100);

  const dateSortDir: SortDirection =
    sortBy === "date-asc" ? "asc" : sortBy === "date-desc" ? "desc" : null;

  const inspectGroup = inspectExpense
    ? initialGroups.find((g) => g.id === inspectExpense.groupId)
    : null;

  const ownershipLabel =
    OWNERSHIP_OPTIONS.find((o) => o.value === ownershipFilter)?.label ??
    "All Expenses";
  const statusLabel =
    STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? "All";
  const sortLabel =
    SORT_OPTIONS.find((o) => o.value === sortBy)?.label ?? "Date (Newest)";

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    selectedCategory !== "all" ||
    ownershipFilter !== "all" ||
    statusFilter !== "all";

  const isCustomSelectedCategory =
    selectedCategory !== "all" &&
    !QUICK_FILTER_CATEGORIES.some(
      (c) => c.value.toLowerCase() === selectedCategory.toLowerCase(),
    );

  return (
    <div className="flex flex-col gap-6 pb-10">
      {loadError && (
        <AlertBanner
          tone="error"
          title="Unable to load complete ledger"
          description={loadError}
        />
      )}

      {isFormerMemberInActiveGroup && activeLedgerGroup && (
        <AlertBanner
          tone="warning"
          title="Former Member Access"
          description={`You are a former member of ${activeLedgerGroup.name}. You are excluded from logging or splitting new expenses, but you can still record settlements for remaining balances.`}
        />
      )}

      {/* Page Header */}
      <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-[30px]">
            Expenses Ledger
          </h1>
          <p className="mt-0.5 text-[14px] text-outline tabular-nums">
            {kpi.transactionCount} shared{" "}
            {kpi.transactionCount === 1 ? "expense" : "expenses"} ·{" "}
            {activeGroup ? activeGroup.name : "All active groups"} · {cycleLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {activeLedgerGroup &&
            activeLedgerGroup.currentUserRole === "ADMIN" &&
            activeLedgerGroup.status !== "ARCHIVED" &&
            !isCycleClosed && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<Lock className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => {
                  setCloseCycleError(null);
                  setCloseCycleConfirmOpen(true);
                }}
              >
                Close &amp; Lock Cycle
              </Button>
            )}
          <Button
            type="button"
            variant="secondary"
            size="md"
            leftIcon={
              <Download className="h-4 w-4 text-outline" aria-hidden="true" />
            }
            onClick={handleExportCsv}
          >
            Export CSV
          </Button>
        </div>
      </section>

      {/* 3-Column KPI Summary Row */}
      <section
        aria-label="Expense ledger metrics"
        className="grid grid-cols-1 gap-5 md:grid-cols-3"
      >
        {/* KPI 1: TOTAL GROUP EXPENSES */}
        <Card
          variant="kpi"
          padding="md"
          data-testid="kpi-total-group-expenses"
          className="flex min-w-0 flex-col justify-between gap-4 tabular-nums"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-outline">
              TOTAL GROUP EXPENSES
            </span>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-pearl text-outline">
              <FileText className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[32px] font-semibold leading-tight tracking-tight text-ink">
              {formatMinorUnits(kpi.totalGroupExpensesCents, kpi.displayCurrency)}
            </span>
            {kpi.hasMixedCurrencies && (
              <Badge tone="neutral" size="sm">
                Multi-currency
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[13px] text-outline">
              {filteredExpenses.length} filtered{" "}
              {filteredExpenses.length === 1 ? "expense" : "expenses"} ·{" "}
              {cycleShortLabel}
            </span>
            {kpi.momDeltaPercent !== null ? (
              <Badge
                tone={kpi.momDeltaPercent <= 0 ? "success" : "warning"}
                size="sm"
                className="tabular-nums"
              >
                {kpi.momDeltaPercent <= 0 ? (
                  <TrendingDown className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <TrendingUp className="h-3 w-3" aria-hidden="true" />
                )}
                <span>
                  {kpi.momDeltaPercent > 0 ? "+" : ""}
                  {kpi.momDeltaPercent}% MoM
                </span>
              </Badge>
            ) : (
              <Badge tone="neutral" size="sm">
                No {prevCycleShort} baseline
              </Badge>
            )}
          </div>
        </Card>

        {/* KPI 2: YOUR PERSONAL SHARE */}
        <Card
          variant="kpi"
          padding="md"
          data-testid="kpi-personal-share"
          className="flex min-w-0 flex-col justify-between gap-4 tabular-nums"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-outline">
              YOUR PERSONAL SHARE
            </span>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-pearl text-outline">
              <PieChart className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[32px] font-semibold leading-tight tracking-tight text-ink">
              {formatMinorUnits(kpi.personalShareCents, kpi.displayCurrency)}
            </span>
            <Badge tone="neutral" size="sm" className="tabular-nums">
              {kpi.personalShareOfTotalPercent.toFixed(1)}% of total
            </Badge>
          </div>
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="text-outline">
                {kpi.personalShareCapCents !== null &&
                kpi.personalShareCapCents > 0
                  ? `Monthly Cap (${formatMinorUnits(kpi.personalShareCapCents, kpi.displayCurrency)})`
                  : "Monthly Cap (Not set)"}
              </span>
              <span className="font-semibold text-ink">
                {kpi.personalCapPercent !== null
                  ? `${kpi.personalCapPercent.toFixed(1)}%`
                  : "—"}
              </span>
            </div>
            <ProgressBar
              value={capPctClamped}
              max={100}
              tone="auto"
              size="sm"
              label="Monthly Cap"
            />
          </div>
        </Card>

        {/* KPI 3: UNSETTLED / PENDING */}
        <Card
          variant="kpi"
          padding="md"
          data-testid="kpi-unsettled-pending"
          className="flex min-w-0 flex-col justify-between gap-4 tabular-nums"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-outline">
              UNSETTLED / PENDING
            </span>
            <span
              className={
                kpi.unsettledTotalCents > 0
                  ? "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600"
                  : "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-pearl text-outline"
              }
            >
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span
              className={
                kpi.unsettledTotalCents > 0
                  ? "text-[32px] font-semibold leading-tight tracking-tight text-red-600"
                  : "text-[32px] font-semibold leading-tight tracking-tight text-ink"
              }
            >
              {formatMinorUnits(kpi.unsettledTotalCents, kpi.displayCurrency)}
            </span>
            {settleableDebts.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSettleInitialDebtKey(null);
                  setSettleModalOpen(true);
                }}
                className="h-7 px-2.5 text-[12px] text-[#0066cc]"
              >
                Settle now
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[13px] text-outline">
              {kpi.unsettledTotalCents > 0 || kpi.pendingItemsCount > 0
                ? `${kpi.pendingItemsCount} pending ${kpi.pendingItemsCount === 1 ? "item" : "items"} · ${kpi.pendingPeerCount} ${kpi.pendingPeerCount === 1 ? "peer" : "peers"}`
                : "All balances settled"}
            </span>
            {kpi.unsettledTotalCents > 0 || kpi.pendingItemsCount > 0 ? (
              <Badge tone="warning" size="sm" dot>
                Action needed
              </Badge>
            ) : (
              <Badge tone="success" size="sm" dot>
                Settled
              </Badge>
            )}
          </div>
        </Card>
      </section>

      {/* Filter Toolbar: Category Quick-Filter Pills + Ownership / Status / Sort Dropdowns */}
      <Card
        variant="section"
        padding="sm"
        className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between"
      >
        <div
          role="group"
          aria-label="Filter by category"
          className="flex flex-wrap items-center gap-1.5 xl:flex-nowrap"
        >
          <Button
            type="button"
            size="sm"
            variant={selectedCategory === "all" ? "primary" : "secondary"}
            onClick={() => handleCategoryChange("all")}
            className="h-8 whitespace-nowrap px-2.5 text-[12px] tabular-nums"
          >
            All ({kpi.transactionCount})
          </Button>
          {QUICK_FILTER_CATEGORIES.map((cat) => {
            const isSelected =
              selectedCategory.toLowerCase() === cat.value.toLowerCase();
            return (
              <Button
                key={cat.value}
                type="button"
                size="sm"
                variant={isSelected ? "primary" : "secondary"}
                onClick={() =>
                  handleCategoryChange(isSelected ? "all" : cat.value)
                }
                className="h-8 gap-1.5 whitespace-nowrap px-2.5 text-[12px]"
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: isSelected ? "#ffffff" : cat.dotColor,
                  }}
                />
                <span>{cat.label}</span>
              </Button>
            );
          })}
          {isCustomSelectedCategory && (
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() => handleCategoryChange("all")}
              className="h-8 gap-1.5 whitespace-nowrap px-2.5 text-[12px]"
            >
              <span>{selectedCategory}</span>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>

        <div
          data-testid="expenses-filter-controls"
          className="flex flex-wrap items-center gap-1.5 xl:flex-nowrap"
        >
          <Select
            aria-label="Ownership"
            variant="pill-select"
            options={OWNERSHIP_OPTIONS}
            value={ownershipFilter}
            onChange={handleOwnershipChange}
            selectedLabel={
              <span>
                <span className="font-normal text-outline">Ownership: </span>
                <span className="font-semibold text-on-surface">
                  {ownershipLabel}
                </span>
              </span>
            }
            className="!h-8 whitespace-nowrap !px-3 text-[12px]"
            containerClassName="w-full sm:w-auto"
          />

          <Select
            aria-label="Status"
            variant="pill-select"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={handleStatusChange}
            selectedLabel={
              <span>
                <span className="font-normal text-outline">Status: </span>
                <span className="font-semibold text-on-surface">
                  {statusLabel}
                </span>
              </span>
            }
            className="!h-8 whitespace-nowrap !px-3 text-[12px]"
            containerClassName="w-full sm:w-auto"
          />

          <Select
            aria-label="Sort"
            variant="pill-select"
            options={SORT_OPTIONS}
            value={sortBy}
            onChange={handleSortChange}
            selectedLabel={
              <span>
                <span className="font-normal text-outline">Sort: </span>
                <span className="font-semibold text-on-surface">
                  {sortLabel}
                </span>
              </span>
            }
            className="!h-8 whitespace-nowrap !px-3 text-[12px]"
            containerClassName="w-full sm:w-auto"
          />
        </div>
      </Card>

      {searchQuery.trim() && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info" size="md">
            Search: &ldquo;{searchQuery.trim()}&rdquo;
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leftIcon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => syncQueryParams({ q: "", page: 1 })}
          >
            Clear search
          </Button>
        </div>
      )}

      {/* 8-Column Expenses Ledger Table + Pagination */}
      <Card
        variant="section"
        padding="none"
        className="overflow-hidden tabular-nums"
      >
        <Table aria-label="Expenses Ledger" bordered={false}>
          <TableHeader>
            <TableRow>
              <TableHead
                sortable
                sortDirection={dateSortDir}
                onSort={() =>
                  handleSortChange(
                    sortBy === "date-desc" ? "date-asc" : "date-desc",
                  )
                }
                className="py-3.5 pl-4 pr-3"
              >
                DATE
              </TableHead>
              <TableHead className="px-3 py-3.5">
                MERCHANT &amp; GROUP
              </TableHead>
              <TableHead className="px-3 py-3.5">CATEGORY</TableHead>
              <TableHead className="px-3 py-3.5">PAID BY</TableHead>
              <TableHead className="px-3 py-3.5">SPLIT</TableHead>
              <TableHead className="px-3 py-3.5 text-right">
                YOUR SHARE
              </TableHead>
              <TableHead className="px-3 py-3.5 text-center">
                STATUS
              </TableHead>
              <TableHead className="py-3.5 pl-2 pr-4 text-center">
                ACTION
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-[13px]">
            {paginatedExpenses.length === 0 ? (
              <TableEmpty
                colSpan={8}
                title="No matching expenses in this cycle"
                description={
                  initialGroups.length === 0
                    ? "Create or join a split group first to start logging shared expenses."
                    : hasActiveFilters
                      ? "Try clearing your category pill, ownership, status, or search filters."
                      : `No expenses logged for ${cycleLabel}.`
                }
                action={
                  hasActiveFilters ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        syncQueryParams({
                          q: "",
                          cat: "all",
                          ownership: "all",
                          status: "all",
                          page: 1,
                        });
                      }}
                    >
                      Reset Filters
                    </Button>
                  ) : initialGroups.length > 0 ? (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={openAddExpense}
                    >
                      Add Expense
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              paginatedExpenses.map((exp) => {
                const myShareCents = getUserShareCents(exp, currentUserId);
                const isUserPayer = exp.paidBy === currentUserId;
                const netOwedToUser = isUserPayer
                  ? exp.amountCents - myShareCents
                  : 0;
                const payerFirstName =
                  exp.payerName.split(" ")[0] || exp.payerName;

                const expGroup = initialGroups.find(
                  (g) => g.id === exp.groupId,
                );
                const currentMember = expGroup?.members.find(
                  (m) => m.userId === currentUserId,
                );
                const isActiveMember = currentMember?.status === "ACTIVE";
                const isGroupAdmin =
                  isActiveMember && expGroup?.currentUserRole === "ADMIN";
                const isCreator =
                  isActiveMember && exp.createdBy === currentUserId;
                const isGroupArchived = expGroup?.status === "ARCHIVED";
                const canModify =
                  !exp.isLocked &&
                  !isGroupArchived &&
                  (isGroupAdmin || isCreator);

                const rowMenuItems: DropdownItem[] = [
                  {
                    id: "inspect",
                    label: "View Split Details",
                    icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" />,
                    onSelect: () => setInspectExpense(exp),
                  },
                ];

                if (canModify) {
                  rowMenuItems.push({
                    id: "edit",
                    label: "Edit Expense",
                    icon: <Pencil className="h-3.5 w-3.5" aria-hidden="true" />,
                    onSelect: () => setEditingExpense(exp),
                  });
                } else if (exp.isLocked && !isGroupArchived && isActiveMember) {
                  rowMenuItems.push({
                    id: "adjust",
                    label: "Log Adjustment",
                    icon: (
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    ),
                    onSelect: () => setAdjustingExpense(exp),
                  });
                }

                const groupSettleableDebts = settleableDebts.filter(
                  (d) => d.groupId === exp.groupId,
                );
                if (groupSettleableDebts.length > 0) {
                  const preferredDebt =
                    groupSettleableDebts.find(
                      (d) =>
                        (d.payerId === currentUserId &&
                          d.recipientId === exp.paidBy) ||
                        (d.recipientId === currentUserId &&
                          d.payerId === exp.paidBy),
                    ) ?? groupSettleableDebts[0];
                  rowMenuItems.push({
                    id: "settle",
                    label: "Settle Group Balance",
                    icon: (
                      <CheckCircle2
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    ),
                    onSelect: () => {
                      setSettleInitialDebtKey(
                        getSettlementDebtKey(preferredDebt),
                      );
                      setSettleModalOpen(true);
                    },
                  });
                }

                if (canModify) {
                  rowMenuItems.push(
                    { id: "delete-divider", separator: true },
                    {
                      id: "delete",
                      label: "Delete Expense",
                      danger: true,
                      icon: (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      ),
                      onSelect: () => {
                        setDeleteExpenseError(null);
                        setDeletingExpense(exp);
                      },
                    },
                  );
                }

                const shareDisplay = isUserPayer
                  ? netOwedToUser > 0
                    ? `+${formatMinorUnits(netOwedToUser, exp.currency)}`
                    : formatMinorUnits(0, exp.currency)
                  : myShareCents > 0
                    ? `-${formatMinorUnits(myShareCents, exp.currency)}`
                    : formatMinorUnits(0, exp.currency);

                const shareColorClass = isUserPayer
                  ? netOwedToUser > 0
                    ? "text-emerald-700"
                    : "text-outline"
                  : myShareCents > 0
                    ? "text-red-600"
                    : "text-outline";

                return (
                  <TableRow
                    key={exp.id}
                    data-testid={`expense-row-${exp.id}`}
                  >
                    <TableCell className="whitespace-nowrap py-3.5 pl-4 pr-3 font-medium text-outline">
                      {formatShortDate(exp.expenseDate)}
                    </TableCell>
                    <TableCell className="min-w-[140px] max-w-[200px] px-3 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold text-ink">
                          {exp.description}
                        </span>
                        {exp.adjustmentForExpenseId && (
                          <Badge tone="warning" size="sm">
                            Adjustment
                          </Badge>
                        )}
                      </div>
                      <div className="truncate text-[12px] text-outline">
                        {exp.groupName}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-3.5">
                      <Badge
                        tone="category"
                        size="sm"
                        dotColor={getCategoryColor(exp.category)}
                      >
                        {exp.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-3.5">
                      <div className="flex items-center gap-2">
                        <Avatar name={exp.payerName} size="sm" />
                        <span className="font-medium text-ink">
                          {isUserPayer ? "You" : payerFirstName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-3.5 font-medium text-on-surface-variant">
                      {formatSplitLabel(
                        exp.splitMethod,
                        exp.splitBreakdown,
                        currentUserId,
                      )}
                    </TableCell>
                    <TableCell
                      className={`whitespace-nowrap px-3 py-3.5 text-right font-semibold tabular-nums ${shareColorClass}`}
                    >
                      {shareDisplay}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-3.5 text-center">
                      {exp.isLocked ? (
                        <Badge tone="neutral" size="sm">
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          LOCKED
                        </Badge>
                      ) : exp.isSettledForUser ? (
                        <Badge tone="success" size="sm">
                          Settled
                        </Badge>
                      ) : (
                        <Badge tone="warning" size="sm">
                          Pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-3.5 pl-2 pr-4 text-center">
                      <Dropdown
                        variant="action-menu"
                        align="right"
                        triggerAriaLabel={`Actions for ${exp.description}`}
                        items={rowMenuItems}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        <div className="border-t border-hairline bg-canvas px-4 py-3.5 md:px-6">
          <Pagination
            currentPage={safePage}
            totalPages={totalPages}
            totalItems={filteredExpenses.length}
            pageSize={PAGE_SIZE}
            itemLabel="itemized expenses"
            onPageChange={handlePageChange}
            className="pt-0"
          />
        </div>
      </Card>

      {/* Split Inspection Dialog */}
      <Dialog
        open={inspectExpense !== null}
        onClose={() => setInspectExpense(null)}
        title={inspectExpense?.description ?? "Expense Details"}
        description={
          inspectExpense
            ? `${inspectExpense.groupName} · ${formatShortDate(inspectExpense.expenseDate)}`
            : undefined
        }
        size="md"
        footer={
          <div className="flex items-center gap-2">
            {inspectExpense?.isLocked &&
              inspectGroup &&
              inspectGroup.status !== "ARCHIVED" &&
              inspectGroup.members.some(
                (m) => m.userId === currentUserId && m.status === "ACTIVE",
              ) && (
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

            <div className="grid grid-cols-2 gap-3 rounded-[14px] border border-hairline bg-surface-container-low p-4 text-[13px]">
              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-outline">
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
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-outline">
                  Paid By
                </span>
                <span className="font-semibold text-ink">
                  {inspectExpense.paidBy === currentUserId
                    ? `You (${inspectExpense.payerName})`
                    : inspectExpense.payerName}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-outline">
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
                        {item.percentage !== undefined && (
                          <span className="ml-1.5 text-[12px] font-normal text-outline">
                            ({item.percentage}%)
                          </span>
                        )}
                        {item.shares !== undefined && (
                          <span className="ml-1.5 text-[12px] font-normal text-outline">
                            ({item.shares} sh)
                          </span>
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

      {/* Record Settlement Modal */}
      <RecordSettlementModal
        open={settleModalOpen}
        onClose={() => {
          setSettleModalOpen(false);
          setSettleInitialDebtKey(null);
        }}
        debts={settleableDebts}
        currentUserId={currentUserId}
        initialDebtKey={settleInitialDebtKey}
        defaultPaymentRail={shellUser?.defaultPaymentRail}
        currentUserInstantTag={shellUser?.instantSettlementTag}
        onSettled={(created) => {
          setAddedSettlements((prev) => [
            {
              id: created.id,
              groupId: created.group_id,
              payerId: created.payer_id,
              recipientId: created.recipient_id,
              amountCents: Number(created.amount_cents),
              currency: created.currency,
              settledAt: created.settled_at,
            },
            ...prev,
          ]);
          pushToast({
            tone: "success",
            title: "Settlement recorded",
            description: `Logged ${formatMinorUnits(created.amount_cents, created.currency)} via ${created.payment_rail}.`,
          });
          router.refresh();
        }}
      />

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

      {/* Close & Lock Billing Cycle Confirmation */}
      <ConfirmDialog
        open={closeCycleConfirmOpen}
        onClose={() => {
          if (!closingCycle) {
            setCloseCycleError(null);
            setCloseCycleConfirmOpen(false);
          }
        }}
        onConfirm={handleConfirmCloseCycle}
        title={`Close & Lock ${cycleLabel}?`}
        description={
          activeLedgerGroup
            ? `Closing ${cycleLabel} for ${activeLedgerGroup.name} permanently locks all expenses in this billing period. Future corrections will require logging an Offsetting Adjustment.`
            : undefined
        }
        confirmLabel="Close & Lock Cycle"
        variant="danger"
        loading={closingCycle}
      >
        {closeCycleError && (
          <AlertBanner
            tone="error"
            title="Could not close billing cycle"
            description={closeCycleError}
          />
        )}
      </ConfirmDialog>

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
        title="Delete Expense"
        description={
          deletingExpense
            ? `Delete "${deletingExpense.description}" (${formatMinorUnits(deletingExpense.amountCents, deletingExpense.currency)}) from ${deletingExpense.groupName}? It will be removed from active group balances and ledger lists.`
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

      {toasts.length > 0 && (
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      )}
    </div>
  );
}
