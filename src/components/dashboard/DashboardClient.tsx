"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Download,
  Paperclip,
  PieChart,
  Plus,
  ReceiptText,
  RefreshCw,
  Wallet,
} from "lucide-react";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Card,
  Pagination,
  SearchInput,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  ToastContainer,
} from "@/components/ui";
import type { SelectOption, ToastItem } from "@/components/ui";
import { RecordSettlementModal, getSettlementDebtKey } from "@/components/expenses";
import { LiveSyncPill, useActiveGroup } from "@/components/shell";
import { ALL_GROUPS_VALUE, formatCycleLabel } from "@/components/shell/url-state";
import {
  buildExpensesCsv,
  computeExpensesKpiSummary,
  computePerGroupDebtEdges,
  isBillingCycleClosedForWindow,
  type ExpenseBillingCycleRecord,
  type ExpenseGroupInfo,
  type ExpenseLedgerRecord,
  type ExpenseSettlementRecord,
  type SimplifiedDebtEdge,
} from "@/lib/expenses/ledger";
import { getBillingCycleWindow } from "@/lib/groups/service";
import { formatMinorUnits } from "@/lib/money";
import type { ExpenseSplitMethod, SplitBreakdownItem } from "@/types/database";

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
  loadError?: string | null;
}

const RECENT_TX_PAGE_SIZE = 5;

const SPLIT_METHOD_LABEL: Record<ExpenseSplitMethod, string> = {
  EQUAL: "Split Evenly",
  PERCENTAGE: "By Percentage",
  EXACT: "Exact Amounts",
};

const CATEGORY_COLORS: Record<string, string> = {
  "Groceries & Food": "#34c759",
  Groceries: "#34c759",
  "Rent & Housing": "#0066cc",
  "Home Goods": "#0066cc",
  "Household Supplies": "#0066cc",
  Utilities: "#5856d6",
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

function formatExpenseDateShort(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
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
  loadError = null,
}: DashboardClientProps) {
  const router = useRouter();
  const {
    groups: shellGroups,
    activeGroupId,
    activeGroup,
    cycle,
    setActiveGroup,
    buildNavHref,
    openAddExpense,
  } = useActiveGroup();

  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState("all");
  const [currentPage, setCurrentPage] = React.useState(1);

  const [simplifyOverrides, setSimplifyOverrides] = React.useState<
    Record<string, boolean>
  >({});
  const [savingSimplifyGroupId, setSavingSimplifyGroupId] = React.useState<
    string | null
  >(null);
  const [addedSettlements, setAddedSettlements] = React.useState<
    ExpenseSettlementRecord[]
  >([]);

  const [settlementModalOpen, setSettlementModalOpen] = React.useState(false);
  const [selectedDebtKey, setSelectedDebtKey] = React.useState<string | null>(
    null,
  );
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const pushToast = React.useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Merge initialGroups with local simplifyOverrides for immediate reactive updates
  const effectiveGroups = React.useMemo<ExpenseGroupInfo[]>(() => {
    const baseGroups: ExpenseGroupInfo[] =
      initialGroups.length > 0
        ? initialGroups
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
            currentUserRole: null,
            currentUserStatus: sg.currentUserStatus ?? null,
            members: sg.members.map((m) => ({
              userId: m.id,
              name: m.name,
              status: "ACTIVE",
              instantSettlementTag: null,
            })),
          }));

    return baseGroups.map((g) =>
      g.id in simplifyOverrides
        ? { ...g, simplifyDebts: simplifyOverrides[g.id] }
        : g,
    );
  }, [initialGroups, shellGroups, simplifyOverrides]);

  const settlements = React.useMemo(() => {
    const byId = new Map<string, ExpenseSettlementRecord>();
    for (const item of addedSettlements) byId.set(item.id, item);
    for (const item of initialSettlements) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return Array.from(byId.values());
  }, [addedSettlements, initialSettlements]);

  const ledgerExpenses = React.useMemo(
    () => initialExpenses.map(toLedgerRecord),
    [initialExpenses],
  );

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

  const kpi = React.useMemo(
    () =>
      computeExpensesKpiSummary({
        expenses: ledgerExpenses,
        groups: effectiveGroups,
        settlements,
        activeGroupId,
        cycleSlug: cycle,
        currentUserId,
        userBaseCurrency,
        personalShareCapCents: null,
      }),
    [
      activeGroupId,
      currentUserId,
      cycle,
      effectiveGroups,
      ledgerExpenses,
      settlements,
      userBaseCurrency,
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

  const owedToYouEdges = React.useMemo(
    () => allScopedEdges.filter((edge) => edge.recipientId === currentUserId),
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

  const groupFilterOptions = React.useMemo<SelectOption[]>(
    () => [
      { value: ALL_GROUPS_VALUE, label: "All Groups" },
      ...effectiveGroups.map((g) => ({
        value: g.id,
        label: g.name,
      })),
    ],
    [effectiveGroups],
  );

  const categoryOptions = React.useMemo<SelectOption[]>(() => {
    const categories = Array.from(
      new Set(kpi.categoryTotals.map((c) => c.category)),
    );
    return [
      { value: "all", label: "All Categories" },
      ...categories.map((cat) => ({ value: cat, label: cat })),
    ];
  }, [kpi.categoryTotals]);

  const visibleExpenses = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return ledgerExpenses.filter((exp) => {
      if (activeGroupId !== ALL_GROUPS_VALUE && exp.groupId !== activeGroupId) {
        return false;
      }

      const { startMs, endMs } = getBillingCycleWindow(
        cycle,
        exp.groupBillingAnchorDay || 1,
      );
      const expMs = Date.parse(exp.expenseDate);
      if (!Number.isFinite(expMs) || expMs < startMs || expMs >= endMs) {
        return false;
      }

      if (selectedCategory !== "all" && exp.category !== selectedCategory) {
        return false;
      }

      if (q) {
        const matchesDesc = exp.description.toLowerCase().includes(q);
        const matchesCat = exp.category.toLowerCase().includes(q);
        const matchesGroup = exp.groupName.toLowerCase().includes(q);
        const matchesPayer = exp.payerName.toLowerCase().includes(q);
        if (!matchesDesc && !matchesCat && !matchesGroup && !matchesPayer) {
          return false;
        }
      }

      return true;
    });
  }, [activeGroupId, cycle, ledgerExpenses, searchQuery, selectedCategory]);

  const totalPages = Math.max(
    1,
    Math.ceil(visibleExpenses.length / RECENT_TX_PAGE_SIZE),
  );
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const paginatedExpenses = React.useMemo(() => {
    const start = (safePage - 1) * RECENT_TX_PAGE_SIZE;
    return visibleExpenses.slice(start, start + RECENT_TX_PAGE_SIZE);
  }, [safePage, visibleExpenses]);

  const handleToggleSimplify = async (
    group: ExpenseGroupInfo,
    nextChecked: boolean,
  ) => {
    const previous = group.simplifyDebts;
    setSimplifyOverrides((prev) => ({ ...prev, [group.id]: nextChecked }));

    const member = group.members.find((m) => m.userId === currentUserId);
    const userStatus = group.currentUserStatus ?? member?.status ?? null;
    const isActiveAdmin =
      userStatus === "ACTIVE" &&
      group.currentUserRole === "ADMIN" &&
      group.status !== "ARCHIVED";

    if (!isActiveAdmin) {
      pushToast({
        tone: "info",
        title: nextChecked
          ? "Previewing simplified transfers"
          : "Previewing direct pairwise balances",
        description:
          "Only Group Admins can save this setting permanently for the group.",
      });
      return;
    }

    setSavingSimplifyGroupId(group.id);
    try {
      const res = await fetch(
        `/api/groups/${encodeURIComponent(group.id)}/simplify`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ simplify_debts: nextChecked }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        simplify_debts?: boolean;
      };

      if (!res.ok) {
        setSimplifyOverrides((prev) => ({ ...prev, [group.id]: previous }));
        pushToast({
          tone: "error",
          title: "Could not update Simplify setting",
          description: data.error || "Unable to save debt simplification setting.",
        });
        return;
      }

      pushToast({
        tone: "success",
        title: nextChecked
          ? `Simplified debts enabled for ${group.name}`
          : `Direct pairwise balances enabled for ${group.name}`,
        description: nextChecked
          ? "Multi-person balances are consolidated within this group."
          : "Showing direct member-to-member obligations without multi-party netting.",
      });
    } catch {
      setSimplifyOverrides((prev) => ({ ...prev, [group.id]: previous }));
      pushToast({
        tone: "error",
        title: "Network error",
        description: "Unable to save debt simplification setting.",
      });
    } finally {
      setSavingSimplifyGroupId((curr) => (curr === group.id ? null : curr));
    }
  };

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

  const handleExportCsv = () => {
    const csv = buildExpensesCsv(visibleExpenses, currentUserId);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const scopeLabel = activeGroup?.slug ?? "all-groups";
    link.download = `ledgersplit-dashboard-${scopeLabel}-${cycle}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    pushToast({
      tone: "success",
      title: "CSV exported",
      description: `Downloaded ${visibleExpenses.length} ${visibleExpenses.length === 1 ? "transaction" : "transactions"} for ${formatCycleLabel(cycle)}.`,
    });
  };

  const cycleLabel = formatCycleLabel(cycle);
  const netSettlementCents = kpi.owedToYouCents - kpi.youOweCents;

  const activeBudgetCents = activeLedgerGroup?.operationalBudgetCents ?? null;
  const budgetConsumedPct =
    activeBudgetCents && activeBudgetCents > 0
      ? Math.min(
          100,
          Math.round((kpi.totalGroupExpensesCents / activeBudgetCents) * 100),
        )
      : null;
  const budgetRemainingCents =
    activeBudgetCents !== null
      ? Math.max(0, activeBudgetCents - kpi.totalGroupExpensesCents)
      : null;

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
      group.status !== "ARCHIVED" && (isYouOwe || isOwedToYou || isActiveAdmin);

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
        <div className="flex min-w-0 flex-1 items-center gap-3">
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

        <div className="flex shrink-0 items-center gap-2">
          <span
            data-testid={`peer-balance-amount-${edge.payerId}-${edge.recipientId}`}
            className={`text-[13px] font-semibold tabular-nums ${
              isYouOwe
                ? "text-[#ff3b30]"
                : isOwedToYou
                  ? "text-[#248a3d]"
                  : "text-ink"
            }`}
          >
            {amountDisplay}
          </span>
          {canSettle && (
            <Button
              type="button"
              variant={isYouOwe ? "danger-soft" : "secondary"}
              size="sm"
              onClick={() => openSettlementForEdge(edge)}
              className="h-7 px-3 text-[12px]"
            >
              {isYouOwe ? "Settle Up" : "Settle"}
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
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
              Dashboard Overview
            </h1>
            <LiveSyncPill />
            {isCycleClosed && (
              <Badge tone="warning" size="sm">
                Closed Period
              </Badge>
            )}
          </div>
          <p className="text-[14px] text-ink-muted-48">
            {activeGroup
              ? `${activeGroup.name} · ${cycleLabel}`
              : `All active groups · ${cycleLabel}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Filter dashboard by group"
            variant="pill-select"
            options={groupFilterOptions}
            value={activeGroupId}
            onChange={(val) => {
              setActiveGroup(val);
              setCurrentPage(1);
            }}
            className="h-9 bg-canvas text-[13px] font-medium"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={handleExportCsv}
          >
            Export CSV
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label="Recalculate balances"
            onClick={() => router.refresh()}
            className="px-2.5"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            onClick={openAddExpense}
          >
            Quick Add
          </Button>
        </div>
      </section>

      {/* Top Row: 3 KPI Cards */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <Card
          variant="kpi"
          padding="md"
          data-testid="kpi-total-spent"
          className="flex flex-col justify-between gap-4"
        >
          <div>
            <div className="mb-3 flex items-start justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                Total Spent This Month
              </span>
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas-parchment text-ink-muted-80">
                <Wallet className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <p className="text-[30px] font-semibold tracking-tight tabular-nums text-ink">
              {kpi.hasMixedCurrencies
                ? "Mixed currencies"
                : formatMinorUnits(
                    kpi.totalGroupExpensesCents,
                    kpi.displayCurrency,
                  )}
            </p>
            <div className="mt-2">
              {kpi.momDeltaPercent !== null ? (
                <Badge tone="neutral" size="sm">
                  {kpi.momDeltaPercent >= 0 ? "+" : ""}
                  {kpi.momDeltaPercent}% vs last month
                </Badge>
              ) : (
                <span className="text-[12px] text-ink-muted-48">
                  {cycleLabel}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-divider-soft pt-3 text-[12px] text-ink-muted-48">
            <span>
              Your share:{" "}
              <strong className="font-semibold tabular-nums text-ink">
                {formatMinorUnits(kpi.personalShareCents, kpi.displayCurrency)}
              </strong>
            </span>
            <span className="tabular-nums">
              {kpi.transactionCount}{" "}
              {kpi.transactionCount === 1 ? "transaction" : "transactions"}
            </span>
          </div>
        </Card>

        <Card
          variant="kpi"
          padding="md"
          data-testid="kpi-you-are-owed"
          className="flex flex-col justify-between gap-4"
        >
          <div>
            <div className="mb-3 flex items-start justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                You Are Owed
              </span>
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#34c759]/25 bg-[#34c759]/10 text-[#248a3d]">
                <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-[30px] font-semibold tracking-tight tabular-nums text-[#248a3d]">
                {kpi.hasMixedCurrencies && kpi.owedToYouCount > 0
                  ? `${kpi.owedToYouCount} claims`
                  : `+${formatMinorUnits(kpi.owedToYouCents, kpi.displayCurrency)}`}
              </p>
              <Badge
                tone={kpi.owedToYouCents > 0 ? "success" : "neutral"}
                size="sm"
              >
                {kpi.owedToYouCents > 0 ? "Incoming" : "Settled"}
              </Badge>
            </div>
            <p className="mt-2 text-[12px] text-ink-muted-48">
              {owedToYouEdges.length > 0
                ? `From ${owedToYouEdges.length} ${owedToYouEdges.length === 1 ? "peer transfer" : "peer transfers"}`
                : "No pending incoming claims"}
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-divider-soft pt-3 text-[12px]">
            <span className="text-ink-muted-48">
              {kpi.owedToYouCount}{" "}
              {kpi.owedToYouCount === 1 ? "pending claim" : "pending claims"}
            </span>
            <Link
              href={buildNavHref("/expenses")}
              className="inline-flex items-center gap-1 font-medium text-[#0066cc] hover:underline"
            >
              <span>View ledger</span>
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        </Card>

        <Card
          variant="kpi"
          padding="md"
          data-testid="kpi-you-owe"
          className="flex flex-col justify-between gap-4"
        >
          <div>
            <div className="mb-3 flex items-start justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                You Owe
              </span>
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#ff3b30]/25 bg-[#ff3b30]/10 text-[#ff3b30]">
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <p
                className={`text-[30px] font-semibold tracking-tight tabular-nums ${
                  kpi.youOweCents > 0 ? "text-[#ff3b30]" : "text-ink"
                }`}
              >
                {kpi.hasMixedCurrencies && kpi.youOweCount > 0
                  ? `${kpi.youOweCount} owed`
                  : kpi.youOweCents > 0
                    ? `-${formatMinorUnits(kpi.youOweCents, kpi.displayCurrency)}`
                    : formatMinorUnits(0, kpi.displayCurrency)}
              </p>
              <Badge
                tone={kpi.youOweCents > 0 ? "danger" : "success"}
                size="sm"
              >
                {kpi.youOweCents > 0 ? "Action Needed" : "All Settled"}
              </Badge>
            </div>
            <p className="mt-2 truncate text-[12px] text-ink-muted-48">
              {topCreditorEdge
                ? `To ${topCreditorEdge.recipientName} (${topCreditorEdge.groupName})`
                : "No outstanding payouts owed"}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-divider-soft pt-3 text-[12px]">
            <span className="text-ink-muted-48">
              Next: {kpi.nextSettlementDateLabel}
            </span>
            <Button
              type="button"
              variant="danger-soft"
              size="sm"
              disabled={settleableDebts.length === 0 || kpi.youOweCents === 0}
              onClick={() => openSettlementForEdge(topCreditorEdge)}
              className="h-7 px-3 text-[12px]"
            >
              Quick Settle
            </Button>
          </div>
        </Card>
      </section>

      {/* Middle Row: Category Breakdown (7 cols) + Peer Balances (5 cols) */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 7 Columns: Monthly Category Breakdown */}
        <Card
          variant="section"
          padding="md"
          data-testid="category-breakdown-card"
          className="flex flex-col justify-between gap-5 lg:col-span-7"
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                    Monthly Category Breakdown
                  </h2>
                  <Badge tone="neutral" size="sm">
                    {cycleLabel}
                  </Badge>
                </div>
                <p className="mt-1 text-[12px] text-ink-muted-48">
                  {activeBudgetCents && activeBudgetCents > 0 && !kpi.hasMixedCurrencies ? (
                    <>
                      Current total:{" "}
                      <strong className="font-semibold tabular-nums text-ink">
                        {formatMinorUnits(
                          kpi.totalGroupExpensesCents,
                          kpi.displayCurrency,
                        )}
                      </strong>{" "}
                      /{" "}
                      {formatMinorUnits(activeBudgetCents, kpi.displayCurrency)}{" "}
                      target budget ({budgetConsumedPct}% consumed)
                    </>
                  ) : (
                    <>
                      Cycle spend across{" "}
                      <strong className="font-semibold text-ink">
                        {kpi.categoryTotals.length}
                      </strong>{" "}
                      {kpi.categoryTotals.length === 1
                        ? "category"
                        : "categories"}
                    </>
                  )}
                </p>
              </div>

              <Link
                href={buildNavHref("/expenses")}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[#0066cc] hover:underline"
              >
                <span>View Full Report</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>

            {/* Segmented Category Meter */}
            <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full border border-hairline bg-canvas-parchment p-0.5">
              {kpi.totalGroupExpensesCents <= 0 || kpi.categoryTotals.length === 0 ? (
                <div className="h-full w-full rounded-full bg-hairline/40" />
              ) : (
                kpi.categoryTotals.slice(0, 6).map((cat) => {
                  const pct = Math.max(
                    3,
                    Math.round(
                      (cat.amountCents / kpi.totalGroupExpensesCents) * 100,
                    ),
                  );
                  return (
                    <div
                      key={cat.category}
                      style={{
                        width: `${pct}%`,
                        backgroundColor: getCategoryColor(cat.category),
                      }}
                      title={`${cat.category}: ${formatMinorUnits(cat.amountCents, kpi.displayCurrency)}`}
                      className="h-full rounded-full transition-all"
                    />
                  );
                })
              )}
            </div>

            {/* Category Tiles */}
            {kpi.categoryTotals.length === 0 ? (
              <div className="rounded-[14px] border border-hairline bg-canvas-parchment p-4 text-[13px] text-ink-muted-48">
                No expenses logged in {cycleLabel} yet. Use Quick Add to record
                a shared bill.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {kpi.categoryTotals.slice(0, 6).map((cat) => {
                  const pct =
                    kpi.totalGroupExpensesCents > 0
                      ? Math.round(
                          (cat.amountCents / kpi.totalGroupExpensesCents) * 100,
                        )
                      : 0;
                  return (
                    <div
                      key={cat.category}
                      className="flex items-center justify-between gap-2 rounded-[14px] border border-hairline bg-canvas-parchment p-3.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: getCategoryColor(cat.category),
                          }}
                        />
                        <span className="truncate text-[12px] font-medium text-ink">
                          {cat.category}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="block text-[12px] font-semibold tabular-nums text-ink">
                          {formatMinorUnits(cat.amountCents, kpi.displayCurrency)}
                        </span>
                        <span className="text-[11px] tabular-nums text-ink-muted-48">
                          {pct}%
                        </span>
                      </div>
                    </div>
                  );
                })}

                {budgetRemainingCents !== null &&
                  activeBudgetCents !== null &&
                  !kpi.hasMixedCurrencies && (
                    <div className="flex items-center justify-between gap-2 rounded-[14px] border border-hairline bg-canvas p-3.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ink-muted-48" />
                        <span className="truncate text-[12px] font-medium text-ink-muted-48">
                          Budget Buffer
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="block text-[12px] font-semibold tabular-nums text-ink">
                          {formatMinorUnits(
                            budgetRemainingCents,
                            kpi.displayCurrency,
                          )}
                        </span>
                        <span className="text-[11px] font-medium tabular-nums text-[#248a3d]">
                          {Math.max(0, 100 - (budgetConsumedPct ?? 0))}% left
                        </span>
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-hairline bg-canvas-parchment p-3.5 text-[12px]">
            <div className="flex items-center gap-2 text-ink-muted-80">
              <PieChart
                className="h-4 w-4 shrink-0 text-[#0066cc]"
                aria-hidden="true"
              />
              <span>
                {activeLedgerGroup
                  ? `Split model: ${
                      activeLedgerGroup.defaultSplitMode === "CUSTOM_RATIOS"
                        ? "Custom Ratios"
                        : "Equal Split"
                    }`
                  : `${scopedGroups.length} active split ${scopedGroups.length === 1 ? "group" : "groups"}`}
              </span>
            </div>
            <Link
              href={buildNavHref("/split-groups")}
              className="font-medium text-[#0066cc] hover:underline"
            >
              Edit Default Ratios
            </Link>
          </div>
        </Card>

        {/* Right 5 Columns: Peer Balances + Simplify Switch */}
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
                <p className="text-[12px] text-ink-muted-48">
                  {activeLedgerGroup
                    ? activeLedgerGroup.simplifyDebts
                      ? "Simplified bipartite transfers within this group"
                      : "Direct pairwise balances within this group"
                    : "Per-group balances (never netted across groups)"}
                </p>
              </div>

              {activeLedgerGroup ? (
                <div className="flex shrink-0 items-center gap-2 rounded-full border border-hairline bg-canvas-parchment px-3 py-1">
                  <Switch
                    id="simplify-debts-switch"
                    label="Simplify"
                    aria-label="Simplify debts"
                    size="sm"
                    tone="success"
                    checked={activeLedgerGroup.simplifyDebts}
                    disabled={savingSimplifyGroupId === activeLedgerGroup.id}
                    onCheckedChange={(next) =>
                      void handleToggleSimplify(activeLedgerGroup, next)
                    }
                  />
                </div>
              ) : scopedGroups.length === 1 ? (
                <div className="flex items-center gap-2 rounded-full border border-hairline bg-canvas-parchment px-3 py-1">
                  <Switch
                    id="simplify-debts-switch"
                    label="Simplify"
                    aria-label="Simplify debts"
                    size="sm"
                    tone="success"
                    checked={scopedGroups[0].simplifyDebts}
                    disabled={savingSimplifyGroupId === scopedGroups[0].id}
                    onCheckedChange={(next) =>
                      void handleToggleSimplify(scopedGroups[0], next)
                    }
                  />
                </div>
              ) : (
                <Badge tone="info" size="sm">
                  Per-group
                </Badge>
              )}
            </div>

            {/* Balances List */}
            <div
              data-testid="peer-balances-list"
              className="flex flex-col gap-3"
            >
              {scopedGroups.length === 0 ? (
                <div className="rounded-[14px] border border-hairline bg-canvas-parchment p-4 text-[13px] text-ink-muted-48">
                  Create or join a split group to track peer balances.
                </div>
              ) : activeLedgerGroup ? (
                debtsByGroup[0]?.edges.length === 0 ? (
                  <div className="rounded-[14px] border border-hairline bg-canvas-parchment p-4 text-[13px] text-ink-muted-48">
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
                      <Switch
                        id={`simplify-debts-switch-${group.id}`}
                        label="Simplify"
                        aria-label={`Simplify ${group.name}`}
                        size="sm"
                        tone="success"
                        checked={group.simplifyDebts}
                        disabled={savingSimplifyGroupId === group.id}
                        onCheckedChange={(next) =>
                          void handleToggleSimplify(group, next)
                        }
                      />
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
            className="flex flex-wrap items-center justify-between gap-2 border-t border-divider-soft pt-3"
          >
            <span className="text-[12px] text-ink-muted-48">
              Overall Net Settlement
            </span>
            <span
              className={`text-[13px] font-semibold tabular-nums ${
                kpi.hasMixedCurrencies
                  ? "text-ink-muted-80"
                  : netSettlementCents > 0
                    ? "text-[#248a3d]"
                    : netSettlementCents < 0
                      ? "text-[#ff3b30]"
                      : "text-ink"
              }`}
            >
              {kpi.hasMixedCurrencies
                ? "Multiple currencies"
                : netSettlementCents > 0
                  ? `+${formatMinorUnits(netSettlementCents, kpi.displayCurrency)} Net Owed to You`
                  : netSettlementCents < 0
                    ? `-${formatMinorUnits(Math.abs(netSettlementCents), kpi.displayCurrency)} Net You Owe`
                    : `${formatMinorUnits(0, kpi.displayCurrency)} All Settled`}
            </span>
          </div>
        </Card>
      </section>

      {/* Recent Shared Transactions */}
      <Card variant="section" padding="md" className="flex flex-col gap-4">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas-parchment text-[#0066cc]">
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                Recent Shared Transactions
              </h2>
              <p className="text-[12px] text-ink-muted-48">
                Itemized expenses logged for {cycleLabel}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <SearchInput
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              onClear={() => {
                setSearchQuery("");
                setCurrentPage(1);
              }}
              placeholder="Filter by merchant..."
              containerClassName="w-full sm:w-52"
              className="text-[13px]"
            />
            <Select
              aria-label="Filter transactions by category"
              variant="pill-select"
              options={categoryOptions}
              value={selectedCategory}
              onChange={(val) => {
                setSelectedCategory(val);
                setCurrentPage(1);
              }}
              className="h-9 bg-canvas text-[12px] font-medium"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-[14px] border border-hairline">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description &amp; Group</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Paid By</TableHead>
                <TableHead>Split</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedExpenses.length === 0 ? (
                <TableEmpty
                  colSpan={6}
                  title="No shared transactions in this period"
                  description={
                    effectiveGroups.length === 0
                      ? "Create a split group first, then use Quick Add to log shared expenses."
                      : `No expenses logged for ${cycleLabel}. Use Quick Add to record your first split.`
                  }
                  action={
                    effectiveGroups.length > 0 ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                        onClick={openAddExpense}
                      >
                        Quick Add
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                paginatedExpenses.map((exp) => {
                  const myShare = exp.splitBreakdown.find(
                    (b) => b.user_id === currentUserId,
                  );

                  return (
                    <TableRow key={exp.id}>
                      <TableCell className="whitespace-nowrap text-[12px] text-ink-muted-80">
                        {formatExpenseDateShort(exp.expenseDate)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-ink">
                              {exp.description}
                            </span>
                            {exp.receiptUrl && (
                              <a
                                href={`/api/receipts?path=${encodeURIComponent(exp.receiptUrl)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`View receipt for ${exp.description}`}
                                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-muted-48 transition-colors hover:bg-canvas-parchment hover:text-[#0066cc] focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
                              >
                                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                              </a>
                            )}
                          </div>
                          <span className="text-[11px] text-ink-muted-48">
                            {exp.groupName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge tone="neutral" size="sm">
                          {exp.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Avatar name={exp.payerName} size="sm" />
                          <span className="text-[12px] font-medium text-ink">
                            {exp.paidBy === currentUserId
                              ? "You"
                              : exp.payerName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[12px] text-ink-muted-80">
                        <div className="flex flex-col">
                          <span>{SPLIT_METHOD_LABEL[exp.splitMethod]}</span>
                          {myShare && (
                            <span className="text-[11px] tabular-nums text-[#0066cc]">
                              Your share:{" "}
                              {formatMinorUnits(
                                myShare.share_cents,
                                exp.currency,
                              )}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-[13px] font-semibold tabular-nums text-ink">
                            {formatMinorUnits(exp.amountCents, exp.currency)}
                          </span>
                          {exp.originalAmountCents !== null &&
                            exp.originalCurrency && (
                              <span className="text-[11px] tabular-nums text-ink-muted-48">
                                Orig:{" "}
                                {formatMinorUnits(
                                  exp.originalAmountCents,
                                  exp.originalCurrency,
                                )}
                              </span>
                            )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {visibleExpenses.length > RECENT_TX_PAGE_SIZE && (
          <Pagination
            currentPage={safePage}
            totalPages={totalPages}
            totalItems={visibleExpenses.length}
            pageSize={RECENT_TX_PAGE_SIZE}
            onPageChange={setCurrentPage}
          />
        )}
      </Card>

      <RecordSettlementModal
        open={settlementModalOpen}
        onClose={() => setSettlementModalOpen(false)}
        debts={settleableDebts}
        currentUserId={currentUserId}
        initialDebtKey={selectedDebtKey}
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

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
