"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  Lightbulb,
  Lock,
  Pause,
  PieChart,
  Play,
  Plus,
  ReceiptText,
  Repeat,
  ShoppingBag,
  Sparkles,
  Trash2,
  TrendingUp,
  Utensils,
  Zap,
  Car,
  Home,
} from "lucide-react";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  Dropdown,
  Input,
  Pagination,
  ProgressBar,
  SearchInput,
  SegmentedControl,
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
  SegmentedOption,
  SelectOption,
  SortDirection,
  ToastItem,
} from "@/components/ui";
import { LiveSyncPill, useActiveGroup } from "@/components/shell";
import {
  ALL_GROUPS_VALUE,
  formatCycleLabel,
} from "@/components/shell/url-state";
import { EXPENSE_CATEGORIES } from "@/lib/expenses/split-engine";
import {
  buildExpensesCsv,
  computeExpensesKpiSummary,
  computePerGroupDebtEdges,
  filterAndSortExpenses,
  getUserShareCents,
  isBillingCycleClosedForWindow,
  stepCycleSlugSafe,
  type ExpenseBillingCycleRecord,
  type ExpenseGroupInfo,
  type ExpenseLedgerRecord,
  type ExpenseLedgerTab,
  type ExpenseSettlementRecord,
  type ExpenseSortOption,
  type RecurringRuleRecord,
} from "@/lib/expenses/ledger";
import {
  formatMinorUnits,
  getCurrencyMinorDigits,
  getCurrencySymbol,
  parseCurrencyInputToMinorUnits,
} from "@/lib/money";
import type { ExpenseSplitMethod, SplitMode } from "@/types/database";
import { RecordSettlementModal } from "./RecordSettlementModal";

const PAGE_SIZE = 7;

const TAB_OPTIONS: Array<SegmentedOption<ExpenseLedgerTab>> = [
  { value: "all", label: "All Expenses" },
  { value: "paid-by-me", label: "Paid by Me" },
  { value: "split-with-me", label: "Split with Me" },
  { value: "recurring", label: "Recurring" },
];

const SORT_OPTIONS: SelectOption[] = [
  { value: "date-desc", label: "Date (Newest first)" },
  { value: "date-asc", label: "Date (Oldest first)" },
  { value: "amount-desc", label: "Amount (Highest first)" },
  { value: "amount-asc", label: "Amount (Lowest first)" },
  { value: "share-desc", label: "Your Share (Highest first)" },
];

const SPLIT_RULE_OPTIONS: SelectOption[] = [
  { value: "EQUAL", label: "Equal Split" },
  { value: "CUSTOM_RATIOS", label: "Group Custom Ratios" },
];

const CATEGORY_COLORS: Record<string, string> = {
  "Groceries & Food": "#34c759",
  Groceries: "#34c759",
  Utilities: "#5856d6",
  "Rent & Housing": "#0066cc",
  "Home Goods": "#0066cc",
  "Household Supplies": "#0066cc",
  "Dining Out": "#ff9500",
  "Food & Drink": "#ff9500",
  "Transit & Travel": "#ff9500",
  Transport: "#ff9500",
  Entertainment: "#ff2d55",
  General: "#7a7a7a",
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? "#0066cc";
}

function renderCategoryIcon(category: string) {
  const lower = category.toLowerCase();
  if (lower.includes("grocer") || lower.includes("food")) {
    return <ShoppingBag className="h-4 w-4" aria-hidden="true" />;
  }
  if (lower.includes("utilit")) {
    return <Zap className="h-4 w-4" aria-hidden="true" />;
  }
  if (lower.includes("dining") || lower.includes("drink")) {
    return <Utensils className="h-4 w-4" aria-hidden="true" />;
  }
  if (lower.includes("transit") || lower.includes("transport") || lower.includes("travel")) {
    return <Car className="h-4 w-4" aria-hidden="true" />;
  }
  if (lower.includes("rent") || lower.includes("hous") || lower.includes("home")) {
    return <Home className="h-4 w-4" aria-hidden="true" />;
  }
  if (lower.includes("entertain")) {
    return <Sparkles className="h-4 w-4" aria-hidden="true" />;
  }
  return <ReceiptText className="h-4 w-4" aria-hidden="true" />;
}

function formatSplitMethodLabel(
  method: ExpenseSplitMethod,
  participantCount: number,
): string {
  if (method === "EQUAL") {
    return `Equal (${participantCount})`;
  }
  if (method === "PERCENTAGE") {
    return `Percent (${participantCount})`;
  }
  return `Exact (${participantCount})`;
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

function parseTabParam(raw: string | null): ExpenseLedgerTab {
  if (
    raw === "all" ||
    raw === "paid-by-me" ||
    raw === "split-with-me" ||
    raw === "recurring"
  ) {
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
  initialRecurringRules: RecurringRuleRecord[];
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
  initialRecurringRules,
  loadError = null,
}: ExpensesClientProps) {
  const router = useRouter();
  const pathname = usePathname() || "/expenses";
  const searchParams = useSearchParams();
  const { activeGroupId, activeGroup, cycle, openAddExpense } = useActiveGroup();

  const [addedExpenses, setAddedExpenses] = React.useState<ExpenseLedgerRecord[]>(
    [],
  );
  const [addedSettlements, setAddedSettlements] = React.useState<
    ExpenseSettlementRecord[]
  >([]);
  const [addedRules, setAddedRules] = React.useState<RecurringRuleRecord[]>([]);
  const [ruleActiveOverrides, setRuleActiveOverrides] = React.useState<
    Record<string, boolean>
  >({});
  const [deletedRuleIds, setDeletedRuleIds] = React.useState<string[]>([]);

  const expenses = React.useMemo(() => {
    const byId = new Map<string, ExpenseLedgerRecord>();
    for (const item of addedExpenses) byId.set(item.id, item);
    for (const item of initialExpenses) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return Array.from(byId.values());
  }, [addedExpenses, initialExpenses]);

  const settlements = React.useMemo(() => {
    const byId = new Map<string, ExpenseSettlementRecord>();
    for (const item of addedSettlements) byId.set(item.id, item);
    for (const item of initialSettlements) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return Array.from(byId.values());
  }, [addedSettlements, initialSettlements]);

  const recurringRules = React.useMemo(() => {
    const deletedSet = new Set(deletedRuleIds);
    const byId = new Map<string, RecurringRuleRecord>();
    for (const item of initialRecurringRules) {
      if (!deletedSet.has(item.id)) byId.set(item.id, item);
    }
    for (const item of addedRules) {
      if (!deletedSet.has(item.id)) byId.set(item.id, item);
    }
    return Array.from(byId.values()).map((r) =>
      r.id in ruleActiveOverrides
        ? { ...r, isActive: ruleActiveOverrides[r.id] }
        : r,
    );
  }, [addedRules, deletedRuleIds, initialRecurringRules, ruleActiveOverrides]);

  const searchKey = searchParams.toString();
  const urlQ = searchParams.get("q") ?? "";
  const urlTab = parseTabParam(searchParams.get("tab"));
  const urlCat = searchParams.get("cat") ?? "all";
  const urlSort = parseSortParam(searchParams.get("sort"));
  const urlPage = parsePageParam(searchParams.get("page"));

  const [optimisticFilters, setOptimisticFilters] = React.useState<{
    forSearchKey: string;
    q?: string;
    tab?: ExpenseLedgerTab;
    cat?: string;
    sort?: ExpenseSortOption;
    page?: number;
  }>({ forSearchKey: searchKey });

  const isOptimistic = optimisticFilters.forSearchKey === searchKey;
  const searchQuery = isOptimistic && optimisticFilters.q !== undefined ? optimisticFilters.q : urlQ;
  const activeTab = isOptimistic && optimisticFilters.tab !== undefined ? optimisticFilters.tab : urlTab;
  const selectedCategory = isOptimistic && optimisticFilters.cat !== undefined ? optimisticFilters.cat : urlCat;
  const sortBy = isOptimistic && optimisticFilters.sort !== undefined ? optimisticFilters.sort : urlSort;
  const currentPage = isOptimistic && optimisticFilters.page !== undefined ? optimisticFilters.page : urlPage;

  const searchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const handleSlashFocus = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (searchInputRef.current) {
        event.preventDefault();
        searchInputRef.current.focus();
      }
    };
    window.addEventListener("keydown", handleSlashFocus);
    return () => window.removeEventListener("keydown", handleSlashFocus);
  }, []);

  const syncQueryParams = React.useCallback(
    (updates: {
      q?: string;
      tab?: ExpenseLedgerTab;
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

      if (updates.q !== undefined) {
        const trimmed = updates.q.trim();
        if (trimmed) nextParams.set("q", trimmed);
        else nextParams.delete("q");
      }
      if (updates.tab !== undefined) {
        if (updates.tab !== "all") nextParams.set("tab", updates.tab);
        else nextParams.delete("tab");
      }
      if (updates.cat !== undefined) {
        if (updates.cat && updates.cat !== "all") nextParams.set("cat", updates.cat);
        else nextParams.delete("cat");
      }
      if (updates.sort !== undefined) {
        if (updates.sort !== "date-desc") nextParams.set("sort", updates.sort);
        else nextParams.delete("sort");
      }
      if (updates.page !== undefined) {
        if (updates.page > 1) nextParams.set("page", String(updates.page));
        else nextParams.delete("page");
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
        original_amount_cents: number | null;
        original_currency: string | null;
        exchange_rate: number | null;
        exchange_rate_source: "API" | "MANUAL_OVERRIDE" | null;
        split_method: ExpenseSplitMethod;
        split_breakdown: Array<{ user_id: string; share_cents: number; percentage?: number }>;
        receipt_url: string | null;
        is_recurring_generated: boolean;
        recurring_rule_id: string | null;
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
        originalAmountCents: created.original_amount_cents,
        originalCurrency: created.original_currency,
        exchangeRate: created.exchange_rate,
        exchangeRateSource: created.exchange_rate_source,
        splitMethod: created.split_method,
        splitBreakdown: Array.isArray(created.split_breakdown)
          ? created.split_breakdown
          : [],
        receiptUrl: created.receipt_url,
        isRecurringGenerated: Boolean(created.is_recurring_generated),
        recurringRuleId: created.recurring_rule_id,
        adjustmentForExpenseId: created.adjustment_for_expense_id,
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

  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const toastCounter = React.useRef(0);
  const pushToast = React.useCallback((toast: Omit<ToastItem, "id">) => {
    toastCounter.current += 1;
    setToasts((prev) => [...prev, { ...toast, id: `exp-toast-${toastCounter.current}` }]);
  }, []);
  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const [settleModalOpen, setSettleModalOpen] = React.useState(false);
  const [inspectExpense, setInspectExpense] =
    React.useState<ExpenseLedgerRecord | null>(null);

  // Recurring rule creation dialog state
  const [recurringModalOpen, setRecurringModalOpen] = React.useState(false);
  const [recGroupId, setRecGroupId] = React.useState<string>("");
  const [recDescription, setRecDescription] = React.useState("");
  const [recCategory, setRecCategory] = React.useState<string>(EXPENSE_CATEGORIES[0]);
  const [recAmount, setRecAmount] = React.useState("");
  const [recDayOfMonth, setRecDayOfMonth] = React.useState("1");
  const [recSplitRule, setRecSplitRule] = React.useState<SplitMode>("EQUAL");
  const [recError, setRecError] = React.useState<string | null>(null);
  const [recSubmitting, setRecSubmitting] = React.useState(false);

  const handleTabChange = (nextTab: ExpenseLedgerTab) => {
    syncQueryParams({ tab: nextTab, page: 1 });
  };

  const handleSearchChange = (value: string) => {
    syncQueryParams({ q: value, page: 1 });
  };

  const handleCategoryChange = (cat: string) => {
    syncQueryParams({ cat, page: 1 });
  };

  const handleSortChange = (nextSort: string) => {
    const parsed = parseSortParam(nextSort);
    syncQueryParams({ sort: parsed, page: 1 });
  };

  const handlePageChange = (page: number) => {
    syncQueryParams({ page });
  };

  const kpi = React.useMemo(
    () =>
      computeExpensesKpiSummary({
        expenses,
        groups: initialGroups,
        settlements,
        activeGroupId,
        cycleSlug: cycle,
        currentUserId,
        userBaseCurrency,
        personalShareCapCents,
      }),
    [
      activeGroupId,
      currentUserId,
      cycle,
      expenses,
      initialGroups,
      personalShareCapCents,
      settlements,
      userBaseCurrency,
    ],
  );

  const scopedGroups = React.useMemo(
    () =>
      activeGroupId === ALL_GROUPS_VALUE
        ? initialGroups
        : initialGroups.filter((g) => g.id === activeGroupId),
    [activeGroupId, initialGroups],
  );

  const scopedDebts = React.useMemo(
    () =>
      scopedGroups.flatMap((group) =>
        computePerGroupDebtEdges({ group, expenses, settlements }),
      ),
    [expenses, scopedGroups, settlements],
  );

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

  const filteredExpenses = React.useMemo(
    () =>
      filterAndSortExpenses({
        expenses,
        activeGroupId,
        cycleSlug: cycle,
        currentUserId,
        tab: activeTab === "recurring" ? "all" : activeTab,
        searchQuery,
        category: selectedCategory,
        sortBy,
      }),
    [
      activeGroupId,
      activeTab,
      currentUserId,
      cycle,
      expenses,
      searchQuery,
      selectedCategory,
      sortBy,
    ],
  );

  const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const paginatedExpenses = React.useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredExpenses.slice(start, start + PAGE_SIZE);
  }, [filteredExpenses, safePage]);

  const scopedRecurringRules = React.useMemo(
    () =>
      recurringRules.filter(
        (r) => activeGroupId === ALL_GROUPS_VALUE || r.groupId === activeGroupId,
      ),
    [activeGroupId, recurringRules],
  );

  const adminGroups = React.useMemo(
    () =>
      scopedGroups.filter(
        (g) => g.status !== "ARCHIVED" && g.currentUserRole === "ADMIN",
      ),
    [scopedGroups],
  );

  const categoryChipList = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const item of kpi.categoryTotals) {
      map.set(item.category, item.amountCents);
    }
    if (selectedCategory !== "all" && !map.has(selectedCategory)) {
      map.set(selectedCategory, 0);
    }
    return Array.from(map.entries()).map(([category, amountCents]) => ({
      category,
      amountCents,
    }));
  }, [kpi.categoryTotals, selectedCategory]);

  const handleExportCsv = () => {
    const csv = buildExpensesCsv(filteredExpenses, currentUserId);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const scopeLabel = activeGroup?.slug ?? "all-groups";
    link.download = `ledgersplit-${scopeLabel}-${cycle}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    pushToast({
      tone: "success",
      title: "CSV exported",
      description: `Downloaded ${filteredExpenses.length} ${filteredExpenses.length === 1 ? "transaction" : "transactions"} for ${formatCycleLabel(cycle)}.`,
    });
  };

  const openNewRecurringDialog = () => {
    const targetGroup =
      adminGroups.find((g) => g.id === activeGroupId) ?? adminGroups[0];
    if (!targetGroup) return;
    setRecGroupId(targetGroup.id);
    setRecDescription("");
    setRecCategory(EXPENSE_CATEGORIES[0]);
    setRecAmount("");
    setRecDayOfMonth("1");
    setRecSplitRule(targetGroup.defaultSplitMode);
    setRecError(null);
    setRecurringModalOpen(true);
  };

  const handleCreateRecurringRule = async (
    e: React.FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    setRecError(null);
    const targetGroup = initialGroups.find((g) => g.id === recGroupId);
    if (!targetGroup) {
      setRecError("Select a group.");
      return;
    }
    const amountCents = parseCurrencyInputToMinorUnits(
      recAmount,
      targetGroup.baseCurrency,
    );
    if (!amountCents || amountCents <= 0) {
      setRecError("Enter a positive amount.");
      return;
    }
    if (!recDescription.trim()) {
      setRecError("Description is required.");
      return;
    }
    const day = Number.parseInt(recDayOfMonth, 10);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      setRecError("Billing day must be between 1 and 28.");
      return;
    }

    setRecSubmitting(true);
    try {
      const now = new Date();
      const nextDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day),
      )
        .toISOString()
        .slice(0, 10);

      const res = await fetch(
        `/api/groups/${encodeURIComponent(targetGroup.id)}/recurring-rules`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: recDescription.trim(),
            category: recCategory,
            amount_cents: amountCents,
            day_of_month: day,
            split_rule: recSplitRule,
            next_run_date: nextDate,
          }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        rule?: {
          id: string;
          group_id: string;
          paid_by: string;
          description: string;
          category: string;
          amount_cents: number;
          currency: string;
          frequency: "MONTHLY";
          day_of_month: number;
          split_rule: SplitMode;
          is_active: boolean;
          next_run_date: string;
        };
      };

      if (!res.ok || !data.rule) {
        setRecError(data.error || "Unable to create recurring rule.");
        setRecSubmitting(false);
        return;
      }

      const payer = targetGroup.members.find(
        (m) => m.userId === data.rule?.paid_by,
      );
      setAddedRules((prev) => [
        ...prev,
        {
          id: data.rule!.id,
          groupId: data.rule!.group_id,
          groupName: targetGroup.name,
          paidBy: data.rule!.paid_by,
          payerName: payer?.name ?? "Member",
          description: data.rule!.description,
          category: data.rule!.category,
          amountCents: Number(data.rule!.amount_cents),
          currency: data.rule!.currency,
          frequency: data.rule!.frequency,
          dayOfMonth: data.rule!.day_of_month,
          splitRule: data.rule!.split_rule,
          isActive: data.rule!.is_active,
          nextRunDate: data.rule!.next_run_date,
        },
      ]);
      setRecurringModalOpen(false);
      setRecSubmitting(false);
      pushToast({
        tone: "success",
        title: "Recurring rule added",
        description: `${data.rule.description} runs on day ${data.rule.day_of_month} each month.`,
      });
    } catch {
      setRecError("Network error while saving recurring rule.");
      setRecSubmitting(false);
    }
  };

  const handleToggleRecurringRule = async (rule: RecurringRuleRecord) => {
    try {
      const res = await fetch(
        `/api/groups/${encodeURIComponent(rule.groupId)}/recurring-rules`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rule_id: rule.id,
            is_active: !rule.isActive,
          }),
        },
      );
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        pushToast({
          tone: "error",
          title: "Update failed",
          description: data.error || "Unable to update recurring rule.",
        });
        return;
      }
      setRuleActiveOverrides((prev) => ({
        ...prev,
        [rule.id]: !rule.isActive,
      }));
      pushToast({
        tone: "info",
        title: rule.isActive ? "Recurring rule paused" : "Recurring rule resumed",
        description: rule.description,
      });
    } catch {
      pushToast({
        tone: "error",
        title: "Network error",
        description: "Unable to update recurring rule.",
      });
    }
  };

  const handleDeleteRecurringRule = async (rule: RecurringRuleRecord) => {
    try {
      const res = await fetch(
        `/api/groups/${encodeURIComponent(rule.groupId)}/recurring-rules?rule_id=${encodeURIComponent(rule.id)}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        pushToast({
          tone: "error",
          title: "Delete failed",
          description: data.error || "Unable to delete recurring rule.",
        });
        return;
      }
      setDeletedRuleIds((prev) => [...prev, rule.id]);
      pushToast({
        tone: "info",
        title: "Recurring rule removed",
        description: rule.description,
      });
    } catch {
      pushToast({
        tone: "error",
        title: "Network error",
        description: "Unable to delete recurring rule.",
      });
    }
  };

  const cycleLabel = formatCycleLabel(cycle);
  const prevCycleShort = formatCycleLabel(stepCycleSlugSafe(cycle, -1), "short").split(
    " ",
  )[0];

  const capPctRaw = kpi.personalCapPercent ?? 0;
  const capPctClamped = Math.min(Math.max(Math.round(capPctRaw), 0), 100);
  const capBadgeTone =
    kpi.personalCapPercent === null
      ? "neutral"
      : kpi.personalCapPercent >= 100
        ? "danger"
        : kpi.personalCapPercent >= 75
          ? "warning"
          : "info";

  const capStatusText =
    kpi.personalCapPercent === null
      ? "Set cap in Settings"
      : kpi.personalCapPercent >= 100
        ? "Over personal limit cap"
        : kpi.personalCapPercent >= 75
          ? "Approaching limit cap"
          : "Under target limit cap";

  const dateSortDir: SortDirection =
    sortBy === "date-asc" ? "asc" : sortBy === "date-desc" ? "desc" : null;
  const amountSortDir: SortDirection =
    sortBy === "amount-asc" ? "asc" : sortBy === "amount-desc" ? "desc" : null;

  const inspectGroup = inspectExpense
    ? initialGroups.find((g) => g.id === inspectExpense.groupId)
    : null;

  // Insights computation
  const budgetTotalCents = scopedGroups.reduce(
    (sum, g) => sum + (g.operationalBudgetCents ?? 0),
    0,
  );
  const topCategory = kpi.categoryTotals[0] ?? null;
  const primaryDebt =
    scopedDebts.find((d) => d.payerId === currentUserId) ?? scopedDebts[0] ?? null;

  return (
    <div className="flex flex-col gap-6 pb-10">
      {loadError && (
        <AlertBanner
          tone="error"
          title="Unable to load complete ledger"
          description={loadError}
        />
      )}

      {/* Page Header */}
      <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Expenses Ledger
            </h1>
            <LiveSyncPill />
            <Badge tone={isCycleClosed ? "warning" : "info"} size="sm">
              {isCycleClosed ? "Closed Period" : "Open Cycle"}
            </Badge>
          </div>
          <p className="text-[14px] text-ink-muted-48">
            {activeGroup
              ? `${activeGroup.name} shared expenses, real-time splits, and monthly settlement balances (${cycleLabel}).`
              : `All active groups shared expenses, real-time splits, and monthly settlement balances (${cycleLabel}).`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:justify-end">
          <SegmentedControl
            ariaLabel="Expense ledger scope"
            variant="pill-tabs"
            options={TAB_OPTIONS}
            value={activeTab}
            onChange={handleTabChange}
            className="[&>button]:px-3 [&>button]:py-1.5 [&>button]:text-[12px]"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={
              <Download className="h-4 w-4 text-[#0066cc]" aria-hidden="true" />
            }
            onClick={handleExportCsv}
            className="shrink-0"
          >
            Export CSV
          </Button>
        </div>
      </section>

      {/* 3-Column KPI Strip */}
      <section
        aria-label="Expense ledger metrics"
        className="grid grid-cols-1 gap-6 md:grid-cols-3"
      >
        {/* KPI 1: Total Group Expenses */}
        <Card
          variant="kpi"
          padding="md"
          data-testid="kpi-total-group-expenses"
          className="flex flex-col justify-between gap-4"
        >
          <div>
            <div className="mb-4 flex items-start justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                Total Group Expenses
              </span>
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas-parchment text-ink-muted-80">
                <ReceiptText className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[30px] font-semibold tracking-tight tabular-nums text-ink">
                {formatMinorUnits(kpi.totalGroupExpensesCents, kpi.displayCurrency)}
              </span>
              {kpi.hasMixedCurrencies && (
                <Badge tone="neutral" size="sm">
                  Multi-currency
                </Badge>
              )}
            </div>
            <div className="mt-2">
              <Badge tone="neutral" size="sm" className="tabular-nums">
                <TrendingUp
                  className="h-3 w-3 text-[#0066cc]"
                  aria-hidden="true"
                />
                {kpi.momDeltaPercent !== null
                  ? `${kpi.momDeltaPercent > 0 ? "+" : ""}${kpi.momDeltaPercent}% vs ${prevCycleShort}`
                  : `No ${prevCycleShort} baseline`}
              </Badge>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-divider-soft pt-3 text-[12px] text-ink-muted-48">
            <span>
              {kpi.transactionCount} aggregate{" "}
              {kpi.transactionCount === 1 ? "transaction" : "transactions"}
            </span>
            <span className="font-medium text-[#0066cc]">
              {kpi.activeMemberCount}{" "}
              {kpi.activeMemberCount === 1 ? "member" : "members"} active
            </span>
          </div>
        </Card>

        {/* KPI 2: Your Personal Share */}
        <Card
          variant="kpi"
          padding="md"
          data-testid="kpi-personal-share"
          className="flex flex-col justify-between gap-4"
        >
          <div>
            <div className="mb-4 flex items-start justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                Your Personal Share
              </span>
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#0066cc]/20 bg-[#0066cc]/10 text-[#0066cc]">
                <PieChart className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[30px] font-semibold tracking-tight tabular-nums text-ink">
                {formatMinorUnits(kpi.personalShareCents, kpi.displayCurrency)}
              </span>
              <Badge tone={capBadgeTone} size="sm" className="tabular-nums">
                {kpi.personalCapPercent !== null
                  ? `${kpi.personalCapPercent.toFixed(1)}%`
                  : "No cap"}
              </Badge>
            </div>
            <p className="mt-2 text-[12px] text-ink-muted-48 tabular-nums">
              {kpi.personalShareCapCents !== null && kpi.personalShareCapCents > 0
                ? `Monthly limit threshold: ${formatMinorUnits(kpi.personalShareCapCents, kpi.displayCurrency)}`
                : "Monthly limit threshold: Not configured"}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-divider-soft pt-3">
            <ProgressBar
              value={capPctClamped}
              max={100}
              tone="auto"
              size="sm"
              label="Personal share cap"
            />
            <div className="flex items-center justify-between text-[11px] text-ink-muted-48">
              <span>0%</span>
              <span>{capStatusText}</span>
              <span>100%</span>
            </div>
          </div>
        </Card>

        {/* KPI 3: Unsettled / Pending */}
        <Card
          variant="kpi"
          padding="md"
          data-testid="kpi-unsettled-pending"
          className="flex flex-col justify-between gap-4"
        >
          <div>
            <div className="mb-4 flex items-start justify-between gap-2">
              <span
                className={
                  kpi.youOweCents > 0
                    ? "text-[11px] font-semibold uppercase tracking-wider text-red-600"
                    : "text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48"
                }
              >
                Unsettled / Pending
              </span>
              <span
                className={
                  kpi.youOweCents > 0
                    ? "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600"
                    : "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas-parchment text-ink-muted-80"
                }
              >
                <Clock className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span
                className={
                  kpi.youOweCents > 0
                    ? "text-[30px] font-semibold tracking-tight tabular-nums text-red-600"
                    : "text-[30px] font-semibold tracking-tight tabular-nums text-ink"
                }
              >
                {formatMinorUnits(kpi.unsettledTotalCents, kpi.displayCurrency)}
              </span>
              <Badge
                tone={
                  kpi.youOweCount + kpi.owedToYouCount > 0
                    ? kpi.youOweCount > 0
                      ? "danger"
                      : "info"
                    : "success"
                }
                size="sm"
              >
                {kpi.youOweCount + kpi.owedToYouCount > 0
                  ? `${kpi.youOweCount + kpi.owedToYouCount} pending`
                  : "Settled"}
              </Badge>
            </div>
            <p className="mt-2 text-[12px] text-ink-muted-48">
              Next group settlement: {kpi.nextSettlementDateLabel}
            </p>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-divider-soft pt-3 text-[12px]">
            {kpi.youOweCount > 0 ? (
              <Badge tone="danger" size="sm" className="tabular-nums">
                {kpi.youOweCount} you owe (
                {formatMinorUnits(kpi.youOweCents, kpi.displayCurrency)})
              </Badge>
            ) : kpi.owedToYouCount > 0 ? (
              <Badge tone="success" size="sm" className="tabular-nums">
                {kpi.owedToYouCount} owed to you (
                {formatMinorUnits(kpi.owedToYouCents, kpi.displayCurrency)})
              </Badge>
            ) : (
              <Badge tone="success" size="sm">
                All balances settled
              </Badge>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={scopedDebts.length === 0}
              rightIcon={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => setSettleModalOpen(true)}
              className="h-7 px-2 text-[12px] text-[#0066cc]"
            >
              Settle now
            </Button>
          </div>
        </Card>
      </section>

      {activeTab !== "recurring" ? (
        <>
          {/* Filter & Search Toolbar */}
          <Card
            variant="section"
            padding="sm"
            className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center"
          >
            <SearchInput
              ref={searchInputRef}
              id="expenseSearch"
              aria-label="Search expenses"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onClear={() => handleSearchChange("")}
              placeholder="Search merchant, category, payer, or group..."
              shortcut="/"
              containerClassName="w-full lg:max-w-sm"
            />

            <div
              role="group"
              aria-label="Filter by category"
              className="flex flex-wrap items-center gap-1.5"
            >
              <Button
                type="button"
                size="sm"
                variant={selectedCategory === "all" ? "primary" : "secondary"}
                onClick={() => handleCategoryChange("all")}
                className="h-8 px-3 text-[12px]"
              >
                All
              </Button>
              {categoryChipList.map(({ category, amountCents }) => {
                const isSelected = selectedCategory === category;
                return (
                  <Button
                    key={category}
                    type="button"
                    size="sm"
                    variant={isSelected ? "primary" : "secondary"}
                    onClick={() =>
                      handleCategoryChange(isSelected ? "all" : category)
                    }
                    className="h-8 gap-1.5 px-3 text-[12px]"
                  >
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: isSelected
                          ? "#ffffff"
                          : getCategoryColor(category),
                      }}
                    />
                    <span>{category}</span>
                    <span
                      className={
                        isSelected
                          ? "text-white/85 tabular-nums"
                          : "text-ink-muted-48 tabular-nums"
                      }
                    >
                      {formatMinorUnits(amountCents, kpi.displayCurrency)}
                    </span>
                  </Button>
                );
              })}
            </div>

            <div className="shrink-0 self-end lg:self-center">
              <Select
                aria-label="Sort transactions"
                variant="pill-select"
                options={SORT_OPTIONS}
                value={sortBy}
                onChange={handleSortChange}
                className="h-9 bg-canvas-parchment text-[12px] font-medium"
              />
            </div>
          </Card>

          {/* Itemized Transactions Table Card */}
          <Card variant="section" padding="md" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider-soft pb-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas-parchment text-[#0066cc]">
                  <ReceiptText className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                    Itemized Transactions
                  </h2>
                  <p className="text-[12px] text-ink-muted-48">
                    Complete household records and per-person cost breakdown
                  </p>
                </div>
              </div>

              <Badge
                tone={isCycleClosed ? "warning" : "success"}
                size="sm"
                dot={!isCycleClosed}
              >
                {isCycleClosed
                  ? "Closed Cycle · Locked"
                  : activeGroup
                    ? `${activeGroup.name} · Group-Isolated`
                    : "Group-Isolated Ledger"}
              </Badge>
            </div>

            <div className="overflow-hidden rounded-[14px] border border-hairline">
              <Table
                aria-label="Itemized Transactions"
                className="[&_th]:px-2 [&_th]:py-2.5 [&_td]:px-2 [&_td]:py-3"
              >
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
                    >
                      Date
                    </TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Paid By</TableHead>
                    <TableHead>Split</TableHead>
                    <TableHead className="text-right">Your Share</TableHead>
                    <TableHead
                      sortable
                      sortDirection={amountSortDir}
                      onSort={() =>
                        handleSortChange(
                          sortBy === "amount-desc"
                            ? "amount-asc"
                            : "amount-desc",
                        )
                      }
                      className="text-right"
                    >
                      Total
                    </TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-center">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedExpenses.length === 0 ? (
                    <TableEmpty
                      colSpan={9}
                      title="No matching expenses in this cycle"
                      description={
                        initialGroups.length === 0
                          ? "Create or join a split group first to start logging shared expenses."
                          : searchQuery || selectedCategory !== "all" || activeTab !== "all"
                            ? "Try clearing your search query, category chip, or tab filter."
                            : `No expenses logged for ${cycleLabel}.`
                      }
                      action={
                        searchQuery || selectedCategory !== "all" || activeTab !== "all" ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              syncQueryParams({
                                q: "",
                                cat: "all",
                                tab: "all",
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
                      const dateParts = formatDateParts(exp.expenseDate);
                      const myShareCents = getUserShareCents(exp, currentUserId);
                      const isUserPayer = exp.paidBy === currentUserId;
                      const netOwedToUser = isUserPayer
                        ? exp.amountCents - myShareCents
                        : myShareCents;
                      const payerFirstName =
                        exp.payerName.split(" ")[0] || exp.payerName;

                      const rowMenuItems: DropdownItem[] = [
                        {
                          id: "inspect",
                          label: "View Split Details",
                          icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" />,
                          onSelect: () => setInspectExpense(exp),
                        },
                      ];

                      if (scopedDebts.some((d) => d.groupId === exp.groupId)) {
                        rowMenuItems.push({
                          id: "settle",
                          label: "Settle Group Balance",
                          icon: (
                            <CheckCircle2
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          ),
                          onSelect: () => setSettleModalOpen(true),
                        });
                      }

                      return (
                        <TableRow key={exp.id} data-testid={`expense-row-${exp.id}`}>
                          <TableCell className="whitespace-nowrap">
                            <span className="block text-[12px] font-medium text-ink">
                              {dateParts.date}
                            </span>
                            {dateParts.time && (
                              <span className="block text-[11px] text-ink-muted-48">
                                {dateParts.time}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="min-w-[140px] max-w-[170px]">
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas-parchment"
                                style={{ color: getCategoryColor(exp.category) }}
                              >
                                {renderCategoryIcon(exp.category)}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-[13px] font-semibold text-ink">
                                    {exp.description}
                                  </span>
                                  {exp.adjustmentForExpenseId && (
                                    <Badge tone="warning" size="sm">
                                      Adjustment
                                    </Badge>
                                  )}
                                  {exp.isRecurringGenerated && (
                                    <Badge tone="info" size="sm">
                                      Auto
                                    </Badge>
                                  )}
                                </div>
                                <span className="block truncate text-[11px] text-ink-muted-48">
                                  {exp.groupName}
                                  {exp.originalAmountCents !== null &&
                                  exp.originalCurrency
                                    ? ` · Orig ${formatMinorUnits(exp.originalAmountCents, exp.originalCurrency)}`
                                    : ""}
                                </span>
                              </div>
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
                            <div className="flex items-center gap-2">
                              <Avatar name={exp.payerName} size="sm" />
                              <span className="text-[12px] font-medium text-ink">
                                {isUserPayer
                                  ? `You (${payerFirstName})`
                                  : exp.payerName}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <Badge tone="neutral" size="sm">
                              {formatSplitMethodLabel(
                                exp.splitMethod,
                                exp.splitBreakdown.length,
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right">
                            <span
                              className={
                                !exp.isSettledForUser && !isUserPayer && myShareCents > 0
                                  ? "block text-[12px] font-semibold tabular-nums text-red-600"
                                  : !exp.isSettledForUser && isUserPayer && netOwedToUser > 0
                                    ? "block text-[12px] font-semibold tabular-nums text-emerald-700"
                                    : "block text-[12px] font-semibold tabular-nums text-ink"
                              }
                            >
                              {formatMinorUnits(myShareCents, exp.currency)}
                            </span>
                            <span className="block text-[11px] text-ink-muted-48">
                              {myShareCents === 0 && !isUserPayer
                                ? "Not in split"
                                : exp.isSettledForUser
                                  ? "Settled"
                                  : isUserPayer
                                    ? `Owed ${formatMinorUnits(netOwedToUser, exp.currency)}`
                                    : `You owe ${payerFirstName}`}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-[13px] font-semibold tabular-nums text-ink">
                            {formatMinorUnits(exp.amountCents, exp.currency)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-center">
                            {exp.isLocked ? (
                              <Badge tone="neutral" size="sm">
                                <Lock className="h-3 w-3" aria-hidden="true" />
                                LOCKED
                              </Badge>
                            ) : exp.isSettledForUser ? (
                              <Badge tone="success" size="sm">
                                <CheckCircle2
                                  className="h-3 w-3"
                                  aria-hidden="true"
                                />
                                Settled
                              </Badge>
                            ) : (
                              <Badge tone="warning" size="sm">
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                Pending
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-center">
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
            </div>

            <Pagination
              currentPage={safePage}
              totalPages={totalPages}
              totalItems={filteredExpenses.length}
              pageSize={PAGE_SIZE}
              itemLabel="transactions"
              onPageChange={handlePageChange}
            />
          </Card>
        </>
      ) : (
        /* Recurring Rules Tab Panel */
        <Card variant="section" padding="md" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider-soft pb-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas-parchment text-[#0066cc]">
                <Repeat className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                  Recurring Expense Templates
                </h2>
                <p className="text-[12px] text-ink-muted-48">
                  Monthly scheduled splits configured for{" "}
                  {activeGroup ? activeGroup.name : "your active groups"}.
                </p>
              </div>
            </div>

            {adminGroups.length > 0 && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                onClick={openNewRecurringDialog}
              >
                Add Recurring Rule
              </Button>
            )}
          </div>

          {scopedRecurringRules.length === 0 ? (
            <div className="rounded-[14px] border border-hairline bg-surface-pearl px-6 py-10 text-center">
              <p className="text-[14px] font-semibold text-ink">
                No recurring rules configured
              </p>
              <p className="mt-1 text-[13px] text-ink-muted-48">
                {adminGroups.length > 0
                  ? "Add a recurring monthly template (such as rent or internet) to automate ledger reminders."
                  : "Group admins can configure recurring monthly expense templates here."}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[14px] border border-hairline">
              <Table aria-label="Recurring Expense Templates">
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Paid By</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-center">Controls</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scopedRecurringRules.map((rule) => {
                    const group = initialGroups.find((g) => g.id === rule.groupId);
                    const isAdmin =
                      group?.currentUserRole === "ADMIN" &&
                      group?.status !== "ARCHIVED";

                    return (
                      <TableRow key={rule.id}>
                        <TableCell className="font-semibold text-[13px] text-ink">
                          {rule.description}
                        </TableCell>
                        <TableCell className="text-[12px] text-ink-muted-80">
                          {rule.groupName}
                        </TableCell>
                        <TableCell>
                          <Badge
                            tone="category"
                            size="sm"
                            dotColor={getCategoryColor(rule.category)}
                          >
                            {rule.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-[12px] text-ink">
                          {rule.paidBy === currentUserId
                            ? `You (${rule.payerName})`
                            : rule.payerName}
                        </TableCell>
                        <TableCell className="text-[12px] text-ink-muted-80">
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock
                              className="h-3.5 w-3.5 text-ink-muted-48"
                              aria-hidden="true"
                            />
                            Day {rule.dayOfMonth} · Next {rule.nextRunDate}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-[13px] font-semibold tabular-nums text-ink">
                          {formatMinorUnits(rule.amountCents, rule.currency)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            tone={rule.isActive ? "success" : "neutral"}
                            size="sm"
                          >
                            {rule.isActive ? "Active" : "Paused"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {isAdmin ? (
                            <div className="inline-flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={
                                  rule.isActive
                                    ? `Pause ${rule.description}`
                                    : `Resume ${rule.description}`
                                }
                                onClick={() => void handleToggleRecurringRule(rule)}
                                className="h-7 px-2"
                              >
                                {rule.isActive ? (
                                  <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                                ) : (
                                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={`Delete ${rule.description}`}
                                onClick={() => void handleDeleteRecurringRule(rule)}
                                className="h-7 px-2 text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-ink-muted-48">
                              Admin only
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}

      {/* 2-Column Bottom Insight Cards */}
      <section
        aria-label="Ledger insights"
        className="grid grid-cols-1 gap-6 md:grid-cols-2"
      >
        <Card variant="section" padding="md" className="flex items-start gap-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#0066cc]/20 bg-[#0066cc]/10 text-[#0066cc]">
            <TrendingUp className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-[14px] font-semibold text-ink">
              Household Run-Rate Analysis
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted-48">
              {kpi.transactionCount === 0
                ? `No expenses recorded yet for ${cycleLabel}. Log a shared bill to start tracking run-rate against your cap.`
                : budgetTotalCents > 0
                  ? `${activeGroup?.name ?? "Your groups"} spent ${formatMinorUnits(kpi.totalGroupExpensesCents, kpi.displayCurrency)} of ${formatMinorUnits(budgetTotalCents, kpi.displayCurrency)} operational budget (${Math.round((kpi.totalGroupExpensesCents / budgetTotalCents) * 100)}%).${topCategory ? ` Top category: ${topCategory.category} (${formatMinorUnits(topCategory.amountCents, kpi.displayCurrency)}).` : ""}`
                  : `${topCategory ? `Top spending category in ${cycleLabel} is ${topCategory.category} at ${formatMinorUnits(topCategory.amountCents, kpi.displayCurrency)} across ${topCategory.count} ${topCategory.count === 1 ? "entry" : "entries"}.` : `Logged ${kpi.transactionCount} shared expenses totaling ${formatMinorUnits(kpi.totalGroupExpensesCents, kpi.displayCurrency)}.`}`}
            </p>
          </div>
        </Card>

        <Card variant="section" padding="md" className="flex items-start gap-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700">
            <Lightbulb className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-ink">
              Smart Split Recommendation
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted-48">
              {primaryDebt
                ? `Settling ${formatMinorUnits(primaryDebt.amountCents, primaryDebt.currency)} from ${primaryDebt.payerId === currentUserId ? "you" : primaryDebt.payerName} to ${primaryDebt.recipientId === currentUserId ? "you" : primaryDebt.recipientName} clears the largest open balance in ${primaryDebt.groupName}.`
                : "All pairwise and simplified balances are settled across your active group scope."}
            </p>
          </div>
        </Card>
      </section>

      {/* Split Inspection Dialog */}
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setInspectExpense(null)}
          >
            Close
          </Button>
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
              {inspectExpense.originalAmountCents !== null &&
                inspectExpense.originalCurrency && (
                  <div className="col-span-2">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                      FX Audit
                    </span>
                    <span className="tabular-nums text-ink-muted-80">
                      {formatMinorUnits(
                        inspectExpense.originalAmountCents,
                        inspectExpense.originalCurrency,
                      )}{" "}
                      @ {inspectExpense.exchangeRate} (
                      {inspectExpense.exchangeRateSource === "MANUAL_OVERRIDE"
                        ? "Manual Override"
                        : "API Spot Rate"}
                      )
                    </span>
                  </div>
                )}
            </div>

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
                        {item.percentage !== undefined && (
                          <span className="ml-1.5 text-[12px] font-normal text-ink-muted-48">
                            ({item.percentage}%)
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
        onClose={() => setSettleModalOpen(false)}
        debts={scopedDebts}
        currentUserId={currentUserId}
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

      {/* Add Recurring Rule Modal */}
      <Dialog
        open={recurringModalOpen}
        onClose={() => !recSubmitting && setRecurringModalOpen(false)}
        title="Add Recurring Rule"
        description="Schedule a monthly recurring expense template for a group."
        size="md"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={recSubmitting}
              onClick={() => setRecurringModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="recurring-rule-form"
              variant="primary"
              size="sm"
              loading={recSubmitting}
            >
              Save Rule
            </Button>
          </>
        }
      >
        <form
          id="recurring-rule-form"
          onSubmit={handleCreateRecurringRule}
          className="flex flex-col gap-4"
        >
          {recError && (
            <AlertBanner
              tone="error"
              title="Invalid recurring rule"
              description={recError}
            />
          )}

          {adminGroups.length > 1 && (
            <Select
              label="Split Group"
              aria-label="Split Group"
              options={adminGroups.map((g) => ({
                value: g.id,
                label: `${g.name} (${g.baseCurrency})`,
              }))}
              value={recGroupId}
              onChange={setRecGroupId}
            />
          )}

          <Input
            label="Description"
            required
            placeholder="e.g. Monthly Fiber Internet"
            value={recDescription}
            onChange={(e) => setRecDescription(e.target.value)}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Amount"
              type="text"
              inputMode="decimal"
              required
              prefix={getCurrencySymbol(
                initialGroups.find((g) => g.id === recGroupId)?.baseCurrency ??
                  "USD",
              )}
              placeholder={
                getCurrencyMinorDigits(
                  initialGroups.find((g) => g.id === recGroupId)?.baseCurrency ??
                    "USD",
                ) === 0
                  ? "0"
                  : "0.00"
              }
              value={recAmount}
              onChange={(e) => setRecAmount(e.target.value)}
            />
            <Input
              label="Day of Month (1–28)"
              type="number"
              min={1}
              max={28}
              required
              value={recDayOfMonth}
              onChange={(e) => setRecDayOfMonth(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Category"
              aria-label="Recurring Category"
              options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
              value={recCategory}
              onChange={setRecCategory}
            />
            <Select
              label="Split Rule"
              aria-label="Split Rule"
              options={SPLIT_RULE_OPTIONS}
              value={recSplitRule}
              onChange={(v) => setRecSplitRule(v as SplitMode)}
            />
          </div>
        </form>
      </Dialog>

      {toasts.length > 0 && (
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      )}
    </div>
  );
}
