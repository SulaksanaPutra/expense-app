"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Paperclip,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  Input,
  SegmentedControl,
  Select,
} from "@/components/ui";
import type { SegmentedOption, SelectOption } from "@/components/ui";
import type { ShellGroupSummary, ShellUserSummary } from "@/components/shell/types";
import { cn } from "@/lib/cn";
import {
  EXPENSE_CATEGORIES,
  computeEqualSplit,
  computeExactSplit,
  computePercentageSplit,
  computeSharesSplit,
  validateSplitBreakdown,
} from "@/lib/expenses/split-engine";
import { computeEqualSharePercentages } from "@/lib/groups/invite-utils";
import {
  formatMinorUnits,
  getCurrencyMinorDigits,
  getCurrencySymbol,
  parseCurrencyInputToMinorUnits,
  parseSignedCurrencyInputToMinorUnits,
} from "@/lib/money";
import type { ExpenseLedgerRecord } from "@/lib/expenses/ledger";
import type {
  Database,
  ExpenseSplitMethod,
  SplitBreakdownItem,
} from "@/types/database";

export interface AddEditExpenseModalProps {
  open: boolean;
  onClose: () => void;
  mode?: "create" | "edit" | "adjustment";
  expense?: ExpenseLedgerRecord | null;
  onSwitchToAdjustment?: () => void;
  groups: ShellGroupSummary[];
  activeGroupId: string;
  currentUser: ShellUserSummary | null;
  cycle?: string;
  onReceiptStorageUsedBytesChange?: (usedBytes: number) => void;
  onCreated?: (expense: Database["public"]["Tables"]["expenses"]["Row"]) => void;
  onUpdated?: (payload: {
    expense: Database["public"]["Tables"]["expenses"]["Row"];
    revision?: Database["public"]["Tables"]["expense_revisions"]["Row"];
    notifications?: Database["public"]["Tables"]["notifications"]["Row"][];
  }) => void;
}

const SPLIT_METHOD_OPTIONS: Array<SegmentedOption<ExpenseSplitMethod>> = [
  { value: "EQUAL", label: "Equal" },
  { value: "PERCENTAGE", label: "Percentage" },
  { value: "EXACT", label: "Exact" },
  { value: "SHARES", label: "Shares" },
];

const CATEGORY_OPTIONS: SelectOption[] = EXPENSE_CATEGORIES.map((cat) => ({
  value: cat,
  label: cat,
}));

const RECEIPT_POLICY_THRESHOLD_CENTS = 10_000;

function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidIsoDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map((n) => Number.parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function formatMinorUnitsPlain(minorUnits: number, currency: string): string {
  const digits = getCurrencyMinorDigits(currency);
  const divisor = 10 ** digits;
  return (minorUnits / divisor).toFixed(digits);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildInitialGroupState(
  group: ShellGroupSummary | null,
  currentUser: ShellUserSummary | null,
): {
  paidBy: string;
  splitMethod: ExpenseSplitMethod;
  includedMemberIds: string[];
  percentageInputs: Record<string, string>;
  exactInputs: Record<string, string>;
  shareInputs: Record<string, string>;
} {
  if (!group) {
    return {
      paidBy: currentUser?.id ?? "",
      splitMethod: currentUser?.defaultSplitMethod ?? "EQUAL",
      includedMemberIds: [],
      percentageInputs: {},
      exactInputs: {},
      shareInputs: {},
    };
  }

  const members = group.members ?? [];
  const memberIds = members.map((m) => m.id);
  const defaultPayer =
    currentUser && memberIds.includes(currentUser.id)
      ? currentUser.id
      : (memberIds[0] ?? "");

  const includedMemberIds =
    currentUser &&
    currentUser.autoIncludeInExpenses === false &&
    memberIds.length > 1
      ? memberIds.filter((id) => id !== currentUser.id)
      : memberIds;

  const equalMap = computeEqualSharePercentages(includedMemberIds);
  const isRatioMode =
    (group.defaultSplitMode === "PERCENTAGE" ||
      group.defaultSplitMode === "CUSTOM" ||
      group.defaultSplitMode === "CUSTOM_RATIOS") &&
    group.status !== "NEEDS_RATIO_UPDATE" &&
    members.some((m) => typeof m.sharePercentage === "number");

  const resolvedSplitMethod: ExpenseSplitMethod =
    group.defaultSplitMode === "SHARES"
      ? "SHARES"
      : isRatioMode
        ? "PERCENTAGE"
        : (currentUser?.defaultSplitMethod ?? "EQUAL");

  const customRatioSum = members.reduce(
    (sum, m) => sum + Math.round((m.sharePercentage ?? 0) * 100),
    0,
  );
  const useMemberRatios =
    isRatioMode &&
    includedMemberIds.length === memberIds.length &&
    Math.abs(customRatioSum - 10_000) <= 1;

  return {
    paidBy: defaultPayer,
    splitMethod: resolvedSplitMethod,
    includedMemberIds,
    percentageInputs: Object.fromEntries(
      members.map((m) => [
        m.id,
        String(
          useMemberRatios
            ? (m.sharePercentage ?? equalMap.get(m.id) ?? 0)
            : (equalMap.get(m.id) ?? 0),
        ),
      ]),
    ),
    exactInputs: Object.fromEntries(members.map((m) => [m.id, ""])),
    shareInputs: Object.fromEntries(
      members.map((m) => [
        m.id,
        String(
          typeof m.shareUnits === "number" &&
            Number.isFinite(m.shareUnits) &&
            m.shareUnits >= 0
            ? m.shareUnits
            : 1,
        ),
      ]),
    ),
  };
}

function buildInitialEditState(
  group: ShellGroupSummary | null,
  expense: ExpenseLedgerRecord,
  currentUser: ShellUserSummary | null,
): {
  amountInput: string;
  description: string;
  category: string;
  expenseDate: string;
  paidBy: string;
  splitMethod: ExpenseSplitMethod;
  includedMemberIds: string[];
  percentageInputs: Record<string, string>;
  exactInputs: Record<string, string>;
  shareInputs: Record<string, string>;
  existingReceiptUrl: string | null;
} {
  const baseDefaults = buildInitialGroupState(group, currentUser);
  const members = group?.members ?? [];
  const activeMemberSet = new Set(members.map((m) => m.id));
  const baseCurrency = group?.baseCurrency ?? expense.currency;

  const amountInput = formatMinorUnitsPlain(expense.amountCents, baseCurrency);

  const breakdownByUserId = new Map(
    expense.splitBreakdown.map((item) => [item.user_id, item]),
  );
  const matchingActiveIds = expense.splitBreakdown
    .map((item) => item.user_id)
    .filter((id) => activeMemberSet.has(id));
  const includedMemberIds =
    matchingActiveIds.length > 0
      ? matchingActiveIds
      : baseDefaults.includedMemberIds;

  const equalMap = computeEqualSharePercentages(includedMemberIds);
  const percentageInputs: Record<string, string> = {};
  const exactInputs: Record<string, string> = {};
  const shareInputs: Record<string, string> = {};

  for (const m of members) {
    const entry = breakdownByUserId.get(m.id);
    if (entry) {
      const derivedPct =
        entry.percentage !== undefined
          ? entry.percentage
          : expense.amountCents > 0
            ? Math.round((entry.share_cents / expense.amountCents) * 10_000) /
              100
            : (equalMap.get(m.id) ?? 0);
      percentageInputs[m.id] = String(derivedPct);
      exactInputs[m.id] = formatMinorUnitsPlain(entry.share_cents, baseCurrency);
      shareInputs[m.id] = String(
        entry.shares !== undefined
          ? entry.shares
          : (m.shareUnits ?? 1),
      );
    } else {
      percentageInputs[m.id] = "0";
      exactInputs[m.id] = "";
      shareInputs[m.id] = String(m.shareUnits ?? 1);
    }
  }

  const paidBy = activeMemberSet.has(expense.paidBy)
    ? expense.paidBy
    : baseDefaults.paidBy;

  const parsedDate = expense.expenseDate.slice(0, 10);
  const expenseDate = isValidIsoDateInput(parsedDate)
    ? parsedDate
    : getTodayIsoDate();

  return {
    amountInput,
    description: expense.description,
    category: expense.category,
    expenseDate,
    paidBy,
    splitMethod: expense.splitMethod,
    includedMemberIds,
    percentageInputs,
    exactInputs,
    shareInputs,
    existingReceiptUrl: expense.receiptUrl ?? null,
  };
}

export function AddEditExpenseModal(props: AddEditExpenseModalProps) {
  const isEditMode = props.mode === "edit" && Boolean(props.expense);
  const isAdjustmentMode = props.mode === "adjustment" && Boolean(props.expense);
  if (!props.open) {
    return (
      <Dialog
        open={false}
        onClose={props.onClose}
        title={
          isAdjustmentMode
            ? "Log Offsetting Adjustment"
            : isEditMode
              ? "Edit Expense"
              : "Add Expense"
        }
      >
        {null}
      </Dialog>
    );
  }

  const modalKey =
    isEditMode && props.expense
      ? `edit-${props.expense.id}`
      : isAdjustmentMode && props.expense
        ? `adjustment-${props.expense.id}`
        : `create-${props.activeGroupId}-${String(props.currentUser?.autoIncludeInExpenses ?? true)}`;

  return <AddEditExpenseModalInner key={modalKey} {...props} />;
}

function AddEditExpenseModalInner({
  open,
  onClose,
  mode = "create",
  expense = null,
  onSwitchToAdjustment,
  groups,
  activeGroupId,
  currentUser,
  onCreated,
  onUpdated,
}: AddEditExpenseModalProps) {
  const isEditMode = mode === "edit" && expense !== null;
  const isAdjustmentMode = mode === "adjustment" && expense !== null;
  const isLockedExpense = isEditMode && Boolean(expense?.isLocked);

  const formId = React.useId();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const uploadedReceiptRef = React.useRef<{
    file: File;
    receiptUrl: string;
  } | null>(null);

  const nonArchivedGroups = React.useMemo(
    () => groups.filter((g) => g.status !== "ARCHIVED"),
    [groups],
  );

  const initialGroupId =
    (isEditMode || isAdjustmentMode) && expense
      ? expense.groupId
      : activeGroupId &&
          activeGroupId !== "all" &&
          nonArchivedGroups.some((g) => g.id === activeGroupId)
        ? activeGroupId
        : nonArchivedGroups.length === 1
          ? nonArchivedGroups[0].id
          : "";

  const [selectedGroupId, setSelectedGroupId] =
    React.useState<string>(initialGroupId);

  const selectedGroup = React.useMemo(
    () => nonArchivedGroups.find((g) => g.id === selectedGroupId) ?? null,
    [nonArchivedGroups, selectedGroupId],
  );

  const isFormerMemberInSelectedGroup =
    selectedGroup?.currentUserStatus === "FORMER_MEMBER";

  const isExpenseCreationBlockedByPolicy =
    !isEditMode &&
    !isFormerMemberInSelectedGroup &&
    selectedGroup !== null &&
    selectedGroup.allowAnyMemberAddExpense === false &&
    selectedGroup.currentUserRole !== "ADMIN";

  const initialGroup = React.useMemo(
    () => nonArchivedGroups.find((g) => g.id === initialGroupId) ?? null,
    [initialGroupId, nonArchivedGroups],
  );

  const initialEditSeed = React.useMemo(() => {
    if (!expense || (!isEditMode && !isAdjustmentMode)) return null;
    const base = buildInitialEditState(initialGroup, expense, currentUser);
    if (!isAdjustmentMode) return base;

    const baseCurrency = initialGroup?.baseCurrency ?? expense.currency;
    const negatedExactInputs: Record<string, string> = {};
    for (const [uid, val] of Object.entries(base.exactInputs)) {
      if (!val) {
        negatedExactInputs[uid] = "";
      } else {
        negatedExactInputs[uid] = val.startsWith("-") ? val : `-${val}`;
      }
    }

    return {
      ...base,
      amountInput: `-${formatMinorUnitsPlain(expense.amountCents, baseCurrency)}`,
      description: `Adjustment: ${expense.description}`.slice(0, 200),
      expenseDate: getTodayIsoDate(),
      exactInputs: negatedExactInputs,
      existingReceiptUrl: null,
    };
  }, [currentUser, expense, initialGroup, isAdjustmentMode, isEditMode]);

  const initialSeed = React.useMemo(
    () => buildInitialGroupState(initialGroup, currentUser),
    [currentUser, initialGroup],
  );

  const [amountInput, setAmountInput] = React.useState(
    initialEditSeed?.amountInput ?? "",
  );
  const [description, setDescription] = React.useState(
    initialEditSeed?.description ?? "",
  );
  const [category, setCategory] = React.useState<string>(
    initialEditSeed?.category ?? EXPENSE_CATEGORIES[0],
  );
  const [expenseDate, setExpenseDate] = React.useState<string>(
    initialEditSeed?.expenseDate ?? getTodayIsoDate(),
  );
  const [paidBy, setPaidBy] = React.useState<string>(
    initialEditSeed?.paidBy ?? initialSeed.paidBy,
  );
  const [splitMethod, setSplitMethod] = React.useState<ExpenseSplitMethod>(
    initialEditSeed?.splitMethod ?? initialSeed.splitMethod,
  );
  const [includedMemberIds, setIncludedMemberIds] = React.useState<string[]>(
    initialEditSeed?.includedMemberIds ?? initialSeed.includedMemberIds,
  );
  const [percentageInputs, setPercentageInputs] = React.useState<
    Record<string, string>
  >(initialEditSeed?.percentageInputs ?? initialSeed.percentageInputs);
  const [exactInputs, setExactInputs] = React.useState<Record<string, string>>(
    initialEditSeed?.exactInputs ?? initialSeed.exactInputs,
  );
  const [shareInputs, setShareInputs] = React.useState<Record<string, string>>(
    initialEditSeed?.shareInputs ?? initialSeed.shareInputs,
  );
  const [existingReceiptUrl, setExistingReceiptUrl] = React.useState<
    string | null
  >(initialEditSeed?.existingReceiptUrl ?? null);

  const [attachedFile, setAttachedFile] = React.useState<File | null>(null);
  const [receiptError, setReceiptError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const baseCurrency = selectedGroup?.baseCurrency ?? currentUser?.displayCurrency ?? "USD";

  const applyGroupDefaults = React.useCallback(
    (group: ShellGroupSummary | null) => {
      const next = buildInitialGroupState(group, currentUser);
      setPaidBy(next.paidBy);
      setSplitMethod(next.splitMethod);
      setIncludedMemberIds(next.includedMemberIds);
      setPercentageInputs(next.percentageInputs);
      setExactInputs(next.exactInputs);
      setShareInputs(next.shareInputs);
    },
    [currentUser],
  );

  const resetAllState = React.useCallback(
    (targetGroupId: string) => {
      const targetGroup =
        nonArchivedGroups.find((g) => g.id === targetGroupId) ?? null;
      setSelectedGroupId(targetGroupId);
      setAmountInput("");
      setDescription("");
      setCategory(EXPENSE_CATEGORIES[0]);
      setExpenseDate(getTodayIsoDate());
      setAttachedFile(null);
      uploadedReceiptRef.current = null;
      setReceiptError(null);
      setTouched({});
      setServerError(null);
      setIsSubmitting(false);
      applyGroupDefaults(targetGroup);
    },
    [applyGroupDefaults, nonArchivedGroups],
  );

  const handleGroupChange = (nextGroupId: string) => {
    setSelectedGroupId(nextGroupId);
    const nextGroup =
      nonArchivedGroups.find((g) => g.id === nextGroupId) ?? null;
    applyGroupDefaults(nextGroup);
    setReceiptError(null);
    setServerError(null);
  };

  const parsedInputAmountCents = React.useMemo(
    () =>
      isAdjustmentMode
        ? parseSignedCurrencyInputToMinorUnits(amountInput, baseCurrency)
        : parseCurrencyInputToMinorUnits(amountInput, baseCurrency),
    [amountInput, baseCurrency, isAdjustmentMode],
  );

  const effectiveBaseAmountCents = React.useMemo(() => {
    if (
      parsedInputAmountCents === null ||
      parsedInputAmountCents === 0 ||
      (!isAdjustmentMode && parsedInputAmountCents < 0)
    ) {
      return null;
    }
    return parsedInputAmountCents;
  }, [isAdjustmentMode, parsedInputAmountCents]);

  const groupMembers = React.useMemo(
    () => selectedGroup?.members ?? [],
    [selectedGroup],
  );

  const includedSet = React.useMemo(
    () => new Set(includedMemberIds),
    [includedMemberIds],
  );

  const selectedMemberIds = React.useMemo(
    () => groupMembers.filter((m) => includedSet.has(m.id)).map((m) => m.id),
    [groupMembers, includedSet],
  );

  // Live split calculation (strictly integer minor units)
  const splitEvaluation = React.useMemo((): {
    ok: boolean;
    breakdown: SplitBreakdownItem[];
    assignedCents: number;
    totalBps: number;
    totalShares: number;
    errorMessage: string | null;
  } => {
    const activeIds = groupMembers.map((m) => m.id);
    if (!selectedGroup || activeIds.length === 0) {
      return {
        ok: false,
        breakdown: [],
        assignedCents: 0,
        totalBps: 0,
        totalShares: 0,
        errorMessage: "Select a split group with active members.",
      };
    }

    if (selectedMemberIds.length === 0) {
      return {
        ok: false,
        breakdown: [],
        assignedCents: 0,
        totalBps: 0,
        totalShares: 0,
        errorMessage: "Select at least one member to split this expense.",
      };
    }

    const totalCents = effectiveBaseAmountCents ?? 0;
    const hasValidNonZeroTotal = isAdjustmentMode ? totalCents !== 0 : totalCents > 0;

    if (splitMethod === "EQUAL") {
      const breakdown = hasValidNonZeroTotal
        ? computeEqualSplit({
            amountCents: totalCents,
            paidBy,
            participantIds: selectedMemberIds,
          })
        : selectedMemberIds.map((id) => ({
            user_id: id,
            share_cents: 0,
            percentage: 0,
          }));

      if (!hasValidNonZeroTotal) {
        return {
          ok: false,
          breakdown,
          assignedCents: 0,
          totalBps: 0,
          totalShares: 0,
          errorMessage: isAdjustmentMode
            ? "Enter a non-zero adjustment amount."
            : "Enter an expense amount greater than zero.",
        };
      }

      const check = validateSplitBreakdown({
        amountCents: totalCents,
        splitMethod: "EQUAL",
        splitBreakdown: breakdown,
        activeMemberIds: activeIds,
        allowNegative: isAdjustmentMode,
      });

      return {
        ok: check.ok,
        breakdown: check.ok ? check.breakdown : breakdown,
        assignedCents: breakdown.reduce((s, i) => s + i.share_cents, 0),
        totalBps: 10_000,
        totalShares: selectedMemberIds.length,
        errorMessage: check.ok ? null : check.message,
      };
    }

    if (splitMethod === "PERCENTAGE") {
      const participants: Array<{ userId: string; percentage: number }> = [];
      let totalBps = 0;
      let hasInvalidPct = false;

      for (const id of selectedMemberIds) {
        const raw = (percentageInputs[id] ?? "").trim();
        const num = raw === "" ? 0 : Number(raw);
        if (!Number.isFinite(num) || num < 0 || num > 100) {
          hasInvalidPct = true;
          participants.push({ userId: id, percentage: 0 });
        } else {
          const bps = Math.round(num * 100);
          totalBps += bps;
          participants.push({ userId: id, percentage: bps / 100 });
        }
      }

      if (!hasValidNonZeroTotal) {
        return {
          ok: false,
          breakdown: participants.map((p) => ({
            user_id: p.userId,
            share_cents: 0,
            percentage: p.percentage,
          })),
          assignedCents: 0,
          totalBps,
          totalShares: 0,
          errorMessage: isAdjustmentMode
            ? "Enter a non-zero adjustment amount."
            : "Enter an expense amount greater than zero.",
        };
      }

      if (hasInvalidPct) {
        return {
          ok: false,
          breakdown: participants.map((p) => ({
            user_id: p.userId,
            share_cents: 0,
            percentage: p.percentage,
          })),
          assignedCents: 0,
          totalBps,
          totalShares: 0,
          errorMessage: "Each percentage must be between 0% and 100%.",
        };
      }

      const result = computePercentageSplit({
        amountCents: totalCents,
        paidBy,
        participants,
        allowNegative: isAdjustmentMode,
      });

      if (!result.ok) {
        const previewBreakdown: SplitBreakdownItem[] = participants.map((p) => {
          const bps = Math.round(p.percentage * 100);
          const floored = Number(
            (BigInt(totalCents) * BigInt(bps)) / BigInt(10_000),
          );
          return {
            user_id: p.userId,
            share_cents: floored,
            percentage: p.percentage,
          };
        });
        return {
          ok: false,
          breakdown: previewBreakdown,
          assignedCents: previewBreakdown.reduce((s, i) => s + i.share_cents, 0),
          totalBps,
          totalShares: 0,
          errorMessage: result.message,
        };
      }

      return {
        ok: true,
        breakdown: result.breakdown,
        assignedCents: result.breakdown.reduce((s, i) => s + i.share_cents, 0),
        totalBps,
        totalShares: 0,
        errorMessage: null,
      };
    }

    if (splitMethod === "SHARES") {
      const participants: Array<{ userId: string; shares: number }> = [];
      let totalShares = 0;
      let hasInvalidShares = false;

      for (const id of selectedMemberIds) {
        const raw = (shareInputs[id] ?? "").trim();
        const num = raw === "" ? 0 : Number(raw);
        if (!Number.isFinite(num) || num < 0) {
          hasInvalidShares = true;
          participants.push({ userId: id, shares: 0 });
        } else {
          const clean = Math.round(num * 10_000) / 10_000;
          totalShares += clean;
          participants.push({ userId: id, shares: clean });
        }
      }

      totalShares = Math.round(totalShares * 10_000) / 10_000;

      if (!hasValidNonZeroTotal) {
        return {
          ok: false,
          breakdown: participants.map((p) => ({
            user_id: p.userId,
            share_cents: 0,
            shares: p.shares,
            percentage:
              totalShares > 0
                ? Math.round((p.shares / totalShares) * 10_000) / 100
                : 0,
          })),
          assignedCents: 0,
          totalBps: totalShares > 0 ? 10_000 : 0,
          totalShares,
          errorMessage: isAdjustmentMode
            ? "Enter a non-zero adjustment amount."
            : "Enter an expense amount greater than zero.",
        };
      }

      if (hasInvalidShares) {
        return {
          ok: false,
          breakdown: participants.map((p) => ({
            user_id: p.userId,
            share_cents: 0,
            shares: p.shares,
            percentage: 0,
          })),
          assignedCents: 0,
          totalBps: 0,
          totalShares,
          errorMessage: "Share weights must be non-negative numbers.",
        };
      }

      const sharesResult = computeSharesSplit({
        amountCents: totalCents,
        paidBy,
        participants,
        allowNegative: isAdjustmentMode,
      });

      if (!sharesResult.ok) {
        return {
          ok: false,
          breakdown: participants.map((p) => ({
            user_id: p.userId,
            share_cents: 0,
            shares: p.shares,
            percentage: 0,
          })),
          assignedCents: 0,
          totalBps: 0,
          totalShares,
          errorMessage: sharesResult.message,
        };
      }

      return {
        ok: true,
        breakdown: sharesResult.breakdown,
        assignedCents: sharesResult.breakdown.reduce((s, i) => s + i.share_cents, 0),
        totalBps: 10_000,
        totalShares,
        errorMessage: null,
      };
    }

    // EXACT mode
    const exactParticipants: Array<{ userId: string; shareCents: number }> = [];
    let hasInvalidExact = false;
    let sumCents = 0;

    for (const id of selectedMemberIds) {
      const raw = (exactInputs[id] ?? "").trim();
      const parsed =
        raw === ""
          ? 0
          : isAdjustmentMode
            ? parseSignedCurrencyInputToMinorUnits(raw, baseCurrency)
            : parseCurrencyInputToMinorUnits(raw, baseCurrency);
      const invalidSign =
        parsed === null || (totalCents < 0 ? parsed > 0 : parsed < 0);
      if (invalidSign) {
        hasInvalidExact = true;
        exactParticipants.push({ userId: id, shareCents: 0 });
      } else {
        sumCents += parsed;
        exactParticipants.push({ userId: id, shareCents: parsed });
      }
    }

    if (!hasValidNonZeroTotal) {
      return {
        ok: false,
        breakdown: exactParticipants.map((p) => ({
          user_id: p.userId,
          share_cents: p.shareCents,
        })),
        assignedCents: sumCents,
        totalBps: 0,
        totalShares: 0,
        errorMessage: isAdjustmentMode
          ? "Enter a non-zero adjustment amount."
          : "Enter an expense amount greater than zero.",
      };
    }

    if (hasInvalidExact) {
      return {
        ok: false,
        breakdown: exactParticipants.map((p) => ({
          user_id: p.userId,
          share_cents: p.shareCents,
        })),
        assignedCents: sumCents,
        totalBps: 0,
        totalShares: 0,
        errorMessage:
          totalCents < 0
            ? "Enter valid zero or negative currency amounts."
            : "Enter valid non-negative currency amounts.",
      };
    }

    const exactResult = computeExactSplit({
      amountCents: totalCents,
      participants: exactParticipants,
      allowNegative: isAdjustmentMode,
    });

    if (!exactResult.ok) {
      return {
        ok: false,
        breakdown: exactParticipants.map((p) => ({
          user_id: p.userId,
          share_cents: p.shareCents,
        })),
        assignedCents: sumCents,
        totalBps: 0,
        totalShares: 0,
        errorMessage: exactResult.message,
      };
    }

    return {
      ok: true,
      breakdown: exactResult.breakdown,
      assignedCents: sumCents,
      totalBps: 10_000,
      totalShares: 0,
      errorMessage: null,
    };
  }, [
    baseCurrency,
    effectiveBaseAmountCents,
    exactInputs,
    groupMembers,
    isAdjustmentMode,
    paidBy,
    percentageInputs,
    selectedGroup,
    selectedMemberIds,
    shareInputs,
    splitMethod,
  ]);

  const breakdownByUser = React.useMemo(() => {
    const map = new Map<string, SplitBreakdownItem>();
    for (const item of splitEvaluation.breakdown) {
      map.set(item.user_id, item);
    }
    return map;
  }, [splitEvaluation.breakdown]);

  const handleToggleMember = (memberId: string) => {
    setIncludedMemberIds((prev) => {
      if (prev.includes(memberId)) {
        return prev.filter((id) => id !== memberId);
      }
      return [...prev, memberId];
    });
  };

  const handleDistributePercentagesEvenly = () => {
    const ids = selectedMemberIds;
    if (ids.length === 0) return;
    const equalMap = computeEqualSharePercentages(ids);
    setPercentageInputs((prev) => {
      const next = { ...prev };
      for (const member of groupMembers) {
        next[member.id] = equalMap.has(member.id)
          ? String(equalMap.get(member.id))
          : "0";
      }
      return next;
    });
  };

  const handleSplitMethodChange = (nextMethod: ExpenseSplitMethod) => {
    setSplitMethod(nextMethod);
    if (
      nextMethod === "EXACT" &&
      effectiveBaseAmountCents &&
      effectiveBaseAmountCents > 0
    ) {
      const allBlank = groupMembers.every(
        (m) => !(exactInputs[m.id] ?? "").trim(),
      );
      if (allBlank) {
        const seeded = computeEqualSplit({
          amountCents: effectiveBaseAmountCents,
          paidBy,
          participantIds: selectedMemberIds,
        });
        const byId = new Map(
          seeded.map((item) => [item.user_id, item.share_cents]),
        );
        setExactInputs(
          Object.fromEntries(
            groupMembers.map((m) => {
              const cents = byId.get(m.id);
              return [
                m.id,
                cents !== undefined
                  ? formatMinorUnitsPlain(cents, baseCurrency)
                  : "",
              ];
            }),
          ),
        );
      }
    }
  };

  const handleAttachReceiptClick = () => {
    fileInputRef.current?.click();
  };

  const handleReceiptFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;

    setReceiptError(null);
    setServerError(null);
    uploadedReceiptRef.current = null;
    setAttachedFile(file);
  };

  const isReceiptRequired =
    Boolean(selectedGroup?.requireReceiptOver100) &&
    effectiveBaseAmountCents !== null &&
    effectiveBaseAmountCents > RECEIPT_POLICY_THRESHOLD_CENTS;
  const hasReceipt = Boolean(attachedFile || existingReceiptUrl);
  const isMissingRequiredReceipt = isReceiptRequired && !hasReceipt;

  const isDescriptionValid = description.trim().length > 0;
  const isDateValid = isValidIsoDateInput(expenseDate);
  const isPayerValid =
    Boolean(paidBy) && groupMembers.some((m) => m.id === paidBy);
  const isAmountValid =
    effectiveBaseAmountCents !== null &&
    (isAdjustmentMode
      ? effectiveBaseAmountCents !== 0
      : effectiveBaseAmountCents > 0);

  const isFormValid =
    !isLockedExpense &&
    !isFormerMemberInSelectedGroup &&
    !isExpenseCreationBlockedByPolicy &&
    !isMissingRequiredReceipt &&
    selectedGroup !== null &&
    selectedGroup.status !== "ARCHIVED" &&
    isDescriptionValid &&
    isDateValid &&
    isPayerValid &&
    isAmountValid &&
    splitEvaluation.ok;

  const handleClose = () => {
    if (isSubmitting) return;
    if (!isEditMode) {
      resetAllState(initialGroupId);
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);
    setReceiptError(null);
    setTouched({
      group: true,
      amount: true,
      description: true,
      date: true,
    });

    if (!isFormValid || !selectedGroup || effectiveBaseAmountCents === null) {
      return;
    }

    setIsSubmitting(true);

    try {
      let receiptUrl: string | null = existingReceiptUrl;
      if (attachedFile) {
        if (uploadedReceiptRef.current?.file === attachedFile) {
          receiptUrl = uploadedReceiptRef.current.receiptUrl;
        } else {
          const formData = new FormData();
          formData.append("file", attachedFile);
          formData.append("groupId", selectedGroup.id);

          let uploadOk = false;
          let uploadPayload: {
            ok?: boolean;
            code?: string;
            receiptUrl?: string;
            error?: string;
          } | null = null;

          try {
            const uploadRes = await fetch("/api/receipts", {
              method: "POST",
              body: formData,
            });
            uploadOk = uploadRes.ok;
            uploadPayload = (await uploadRes.json().catch(() => null)) as {
              ok?: boolean;
              code?: string;
              receiptUrl?: string;
              error?: string;
            } | null;
          } catch {
            uploadOk = false;
          }

          if (uploadOk && uploadPayload?.receiptUrl) {
            receiptUrl = uploadPayload.receiptUrl;
            uploadedReceiptRef.current = {
              file: attachedFile,
              receiptUrl,
            };
          } else {
            uploadedReceiptRef.current = null;
            setAttachedFile(null);
            setReceiptError(
              uploadPayload?.error ||
                "Unable to upload receipt file. Please try again.",
            );
            setIsSubmitting(false);
            return;
          }
        }
      }

      const endpoint =
        isEditMode && expense
          ? `/api/groups/${encodeURIComponent(selectedGroup.id)}/expenses/${encodeURIComponent(expense.id)}`
          : `/api/groups/${encodeURIComponent(selectedGroup.id)}/expenses`;

      const resolvedExpenseDate =
        isEditMode &&
        expense &&
        expense.expenseDate.slice(0, 10) === expenseDate
          ? expense.expenseDate
          : `${expenseDate}T12:00:00.000Z`;

      const response = await fetch(endpoint, {
        method: isEditMode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paid_by: paidBy,
          description: description.trim(),
          category,
          amount_cents: effectiveBaseAmountCents,
          expense_date: resolvedExpenseDate,
          split_method: splitMethod,
          split_breakdown: splitEvaluation.breakdown,
          receipt_url: receiptUrl,
          ...(isAdjustmentMode && expense
            ? { adjustment_for_expense_id: expense.id }
            : {}),
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        expense?: Database["public"]["Tables"]["expenses"]["Row"];
        revision?: Database["public"]["Tables"]["expense_revisions"]["Row"];
        notifications?: Database["public"]["Tables"]["notifications"]["Row"][];
      };

      if (!response.ok || !payload.expense) {
        setServerError(
          payload.error || "Unable to save expense. Please try again.",
        );
        setIsSubmitting(false);
        return;
      }

      if (isEditMode) {
        onUpdated?.({
          expense: payload.expense,
          revision: payload.revision,
          notifications: payload.notifications,
        });
      } else {
        onCreated?.(payload.expense);
        resetAllState(initialGroupId);
      }
      onClose();
    } catch {
      setServerError("Network error while saving expense. Please try again.");
      setIsSubmitting(false);
    }
  };

  const groupOptions = React.useMemo<SelectOption[]>(
    () =>
      nonArchivedGroups.map((g) => ({
        value: g.id,
        label: g.name,
        description: `${g.baseCurrency} · ${g.members.length} ${g.members.length === 1 ? "member" : "members"}`,
      })),
    [nonArchivedGroups],
  );

  const categoryOptions = React.useMemo<SelectOption[]>(() => {
    if (!category || CATEGORY_OPTIONS.some((opt) => opt.value === category)) {
      return CATEGORY_OPTIONS;
    }
    return [{ value: category, label: category }, ...CATEGORY_OPTIONS];
  }, [category]);

  const memberOptions = React.useMemo<SelectOption[]>(
    () =>
      groupMembers.map((m) => ({
        value: m.id,
        label: m.id === currentUser?.id ? `${m.name} (You)` : m.name,
      })),
    [currentUser?.id, groupMembers],
  );

  const baseCurrencySymbol = getCurrencySymbol(baseCurrency);

  const amountError = React.useMemo(() => {
    if (!touched.amount) return undefined;
    if (
      parsedInputAmountCents !== null &&
      (isAdjustmentMode ? parsedInputAmountCents !== 0 : parsedInputAmountCents > 0)
    ) {
      return undefined;
    }
    const digits = getCurrencyMinorDigits(baseCurrency);
    const trimmed = amountInput.trim();
    if (digits === 0 && trimmed.includes(".")) {
      return `${baseCurrency} does not use decimal places. Enter a whole number.`;
    }
    if (digits > 0 && /^\d+\.\d+$/.test(trimmed)) {
      const frac = trimmed.split(".")[1] ?? "";
      if (frac.length > digits) {
        return `Use up to ${digits} decimal places for ${baseCurrency}.`;
      }
    }
    return isAdjustmentMode
      ? "Enter a non-zero adjustment amount (e.g. -25.00)."
      : "Enter an amount greater than 0.";
  }, [amountInput, baseCurrency, isAdjustmentMode, parsedInputAmountCents, touched.amount]);

  const descriptionError =
    touched.description && !isDescriptionValid
      ? "Please enter a merchant or description."
      : undefined;
  const dateError =
    touched.date && !isDateValid ? "Enter a valid YYYY-MM-DD date." : undefined;

  const saveBaseLabel = isAdjustmentMode
    ? "Save Adjustment"
    : isEditMode
      ? "Save Changes"
      : "Add Expense";
  const saveLabel =
    effectiveBaseAmountCents && effectiveBaseAmountCents !== 0
      ? `${saveBaseLabel} (${formatMinorUnits(effectiveBaseAmountCents, baseCurrency)})`
      : saveBaseLabel;

  const remainingCents =
    effectiveBaseAmountCents !== null
      ? effectiveBaseAmountCents - splitEvaluation.assignedCents
      : 0;

  const distributionSummary = React.useMemo(() => {
    if (selectedMemberIds.length === 0) return "No members selected";
    if (splitMethod === "EQUAL") {
      const pct = (100 / selectedMemberIds.length).toFixed(1);
      return `${selectedMemberIds.length}-Way Equal (${pct}%)`;
    }
    if (splitMethod === "PERCENTAGE") {
      return `${(splitEvaluation.totalBps / 100).toFixed(2)}% of 100%`;
    }
    if (splitMethod === "SHARES") {
      return `${splitEvaluation.totalShares} Total ${splitEvaluation.totalShares === 1 ? "Share" : "Shares"}`;
    }
    return `${formatMinorUnits(splitEvaluation.assignedCents, baseCurrency)} Assigned`;
  }, [
    baseCurrency,
    selectedMemberIds.length,
    splitEvaluation.assignedCents,
    splitEvaluation.totalBps,
    splitEvaluation.totalShares,
    splitMethod,
  ]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={
        isAdjustmentMode
          ? "Log Offsetting Adjustment"
          : isEditMode
            ? "Edit Expense"
            : "Add Expense"
      }
      description={
        isAdjustmentMode && expense
          ? `Creating an offsetting adjustment for "${expense.description}" (${formatMinorUnits(expense.amountCents, expense.currency)})`
          : isEditMode
            ? selectedGroup
              ? `Editing expense in ${selectedGroup.name} · records an ExpenseRevision snapshot`
              : "Editing shared expense"
            : "Log a shared expense and split it with group members."
      }
      size="md"
      closeOnBackdropClick={!isSubmitting}
      closeOnEscape={!isSubmitting}
      footer={
        <div className="flex w-full flex-col gap-3">
          {receiptError && (
            <AlertBanner
              tone="error"
              title="Receipt upload failed"
              description={receiptError}
              onDismiss={() => setReceiptError(null)}
            />
          )}
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                aria-label="Upload receipt file"
                tabIndex={-1}
                className="sr-only"
                onChange={handleReceiptFileChange}
              />
              {!isReceiptRequired && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={
                      isSubmitting ||
                      isLockedExpense ||
                      isExpenseCreationBlockedByPolicy ||
                      isFormerMemberInSelectedGroup
                    }
                    leftIcon={<Paperclip className="h-4 w-4" aria-hidden="true" />}
                    onClick={handleAttachReceiptClick}
                  >
                    Attach Receipt
                  </Button>
                  {attachedFile && (
                    <span className="inline-flex max-w-[190px] items-center gap-1.5 rounded-pill border border-hairline bg-canvas-parchment py-0.5 pr-1 pl-2.5 text-[11px] font-medium text-ink">
                      <span className="truncate">{attachedFile.name}</span>
                      <span className="shrink-0 text-ink-muted-48">
                        ({formatFileSize(attachedFile.size)})
                      </span>
                      <Button
                        type="button"
                        variant="icon-circle"
                        size="sm"
                        aria-label="Remove attached receipt"
                        onClick={() => {
                          uploadedReceiptRef.current = null;
                          setAttachedFile(null);
                        }}
                        className="h-6 w-6 border-transparent bg-transparent text-ink-muted-48 hover:bg-canvas hover:text-red-600"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    </span>
                  )}
                  {!attachedFile && existingReceiptUrl && (
                    <span className="inline-flex max-w-[190px] items-center gap-1.5 rounded-pill border border-hairline bg-canvas-parchment py-0.5 pr-1 pl-2.5 text-[11px] font-medium text-ink">
                      <span className="truncate">Existing receipt</span>
                      <Button
                        type="button"
                        variant="icon-circle"
                        size="sm"
                        aria-label="Remove existing receipt"
                        onClick={() => setExistingReceiptUrl(null)}
                        className="h-6 w-6 border-transparent bg-transparent text-ink-muted-48 hover:bg-canvas hover:text-red-600"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    </span>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={isSubmitting}
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form={formId}
                variant="primary"
                size="md"
                loading={isSubmitting}
                disabled={!isFormValid || isSubmitting}
                leftIcon={
                  isEditMode || isAdjustmentMode ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  )
                }
                className="tabular-nums"
              >
                {saveLabel}
              </Button>
            </div>
          </div>
        </div>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 tabular-nums"
      >
        {isLockedExpense && (
          <AlertBanner
            tone="warning"
            title="Expense is locked"
            description="This expense is covered by a closed billing cycle or pairwise settlement watermark and cannot be edited."
            action={
              onSwitchToAdjustment ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onSwitchToAdjustment}
                >
                  Log Adjustment
                </Button>
              ) : undefined
            }
          />
        )}

        {isAdjustmentMode && expense && (
          <AlertBanner
            tone="info"
            title="Offsetting Adjustment Mode"
            description={`This entry is linked to locked expense "${expense.description}" (${formatMinorUnits(expense.amountCents, expense.currency)}). Enter a negative amount to reverse or reduce it, or a positive amount to add a correction.`}
          />
        )}

        {isFormerMemberInSelectedGroup && (
          <AlertBanner
            tone="warning"
            title="Former members cannot log expenses"
            description="You have FORMER_MEMBER status in this group and are excluded from new splits. You can still record settlements on the Expenses page."
          />
        )}

        {isExpenseCreationBlockedByPolicy && (
          <AlertBanner
            tone="warning"
            title="Only group admins can add expenses"
            description="This group's policy restricts adding new expenses to Group Owners/Admins. Ask an admin to log this expense or update Split Rules."
          />
        )}

        {serverError && (
          <AlertBanner
            tone="error"
            title="Could not save expense"
            description={serverError}
          />
        )}

        {nonArchivedGroups.length === 0 && (
          <AlertBanner
            tone="warning"
            title="No active split groups"
            description="Create or join an active split group before logging an expense."
          />
        )}

        {selectedGroup?.status === "NEEDS_RATIO_UPDATE" && (
          <AlertBanner
            tone="warning"
            title="Custom ratios need admin review"
            description="A newly joined member has a 0% default ratio. Equal, Exact, Shares, or percentages summing to 100.00% can still be logged."
          />
        )}

        {/* 1. Merchant / Description */}
        <Input
          label="Merchant / Description"
          name="description"
          required
          autoFocus
          placeholder="e.g., Whole Foods Market"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setServerError(null);
          }}
          onBlur={() => setTouched((prev) => ({ ...prev, description: true }))}
          error={descriptionError}
          disabled={isLockedExpense || isExpenseCreationBlockedByPolicy}
        />

        {/* 2. Amount & Date */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Input
            label="Amount"
            name="amount"
            type="text"
            inputMode="decimal"
            required
            prefix={baseCurrencySymbol}
            suffix={baseCurrency}
            placeholder={getCurrencyMinorDigits(baseCurrency) === 0 ? "0" : "0.00"}
            value={amountInput}
            onChange={(e) => {
              setAmountInput(e.target.value);
              setServerError(null);
            }}
            onBlur={() => setTouched((prev) => ({ ...prev, amount: true }))}
            error={amountError}
            disabled={isLockedExpense || isExpenseCreationBlockedByPolicy}
            className="font-semibold tabular-nums"
          />

          <Input
            label="Date"
            name="expense_date"
            type="date"
            required
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, date: true }))}
            error={dateError}
            disabled={isLockedExpense || isExpenseCreationBlockedByPolicy}
          />
        </div>

        {/* 3. Split Group & Category */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Select
            label="Split Group"
            aria-label="Split Group"
            placeholder="Select a split group..."
            options={groupOptions}
            value={selectedGroupId}
            onChange={handleGroupChange}
            disabled={
              isEditMode || isAdjustmentMode || nonArchivedGroups.length === 0
            }
            error={
              touched.group && !selectedGroup
                ? "Select a split group."
                : undefined
            }
          />

          <Select
            label="Category"
            aria-label="Category"
            options={categoryOptions}
            value={category}
            onChange={setCategory}
            disabled={isLockedExpense || isExpenseCreationBlockedByPolicy}
          />
        </div>

        {/* 4. Paid By */}
        <Select
          label="Paid By"
          aria-label="Paid By"
          options={memberOptions}
          value={paidBy}
          onChange={setPaidBy}
          disabled={
            memberOptions.length === 0 ||
            isLockedExpense ||
            isExpenseCreationBlockedByPolicy
          }
        />

        {/* 5. Conditional Receipt Upload when Group.require_receipt_over_100 is active and amount > $100 */}
        {isReceiptRequired && (
          <Card
            variant="sub-card"
            padding="sm"
            data-testid="required-receipt-section"
            className={cn(
              "flex flex-col gap-2.5 border",
              hasReceipt
                ? "border-emerald-200 bg-emerald-50/40"
                : "border-amber-300 bg-amber-50/60",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-ink">
                  Receipt Required (Over {formatMinorUnits(RECEIPT_POLICY_THRESHOLD_CENTS, baseCurrency)})
                </span>
                <Badge tone={hasReceipt ? "success" : "warning"} size="sm">
                  {hasReceipt ? "Attached" : "Required"}
                </Badge>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  isSubmitting ||
                  isLockedExpense ||
                  isExpenseCreationBlockedByPolicy
                }
                leftIcon={<Upload className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={handleAttachReceiptClick}
              >
                {hasReceipt ? "Replace Receipt" : "Upload Receipt"}
              </Button>
            </div>

            {!hasReceipt ? (
              <p className="text-[12px] text-amber-900">
                This group requires a receipt attachment for expenses over{" "}
                {formatMinorUnits(RECEIPT_POLICY_THRESHOLD_CENTS, baseCurrency)}.
              </p>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-[12px]">
                <span className="truncate font-medium text-ink">
                  {attachedFile
                    ? `${attachedFile.name} (${formatFileSize(attachedFile.size)})`
                    : "Existing receipt attached"}
                </span>
                <Button
                  type="button"
                  variant="icon-circle"
                  size="sm"
                  aria-label="Remove required receipt"
                  onClick={() => {
                    uploadedReceiptRef.current = null;
                    setAttachedFile(null);
                    setExistingReceiptUrl(null);
                  }}
                  className="h-6 w-6 border-transparent bg-transparent text-ink-muted-48 hover:bg-surface-pearl hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* 6. Split Method SegmentedControl */}
        <div className="flex flex-col gap-1.5 pt-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-ink-muted-80">
              Split Method
            </span>
            {splitMethod === "PERCENTAGE" && selectedMemberIds.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDistributePercentagesEvenly}
                className="h-6 px-2 text-[12px] font-medium text-[#0066cc] hover:underline"
              >
                Distribute evenly
              </Button>
            )}
          </div>
          <SegmentedControl
            ariaLabel="Split Method"
            variant="split-method"
            fullWidth
            options={SPLIT_METHOD_OPTIONS.map((opt) => ({
              ...opt,
              disabled: isLockedExpense || isExpenseCreationBlockedByPolicy,
            }))}
            value={splitMethod}
            onChange={handleSplitMethodChange}
          />
        </div>

        {/* 7. Split Distribution Sub-Card */}
        <Card variant="sub-card" padding="sm" className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider-soft pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
            <span>
              Split Distribution ({selectedMemberIds.length}{" "}
              {selectedMemberIds.length === 1 ? "Member" : "Members"})
            </span>
            <span className="text-[#0066cc]">{distributionSummary}</span>
          </div>

          {groupMembers.length === 0 ? (
            <p className="py-2 text-center text-[13px] text-ink-muted-48">
              {selectedGroup
                ? "No active members in this group."
                : "Choose a split group above to configure member shares."}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {groupMembers.map((member) => {
                const isIncluded = includedSet.has(member.id);
                const isPayer = member.id === paidBy;
                const item = breakdownByUser.get(member.id);
                const shareCents = isIncluded ? (item?.share_cents ?? 0) : 0;
                const sharePct = isIncluded ? (item?.percentage ?? 0) : 0;

                return (
                  <div
                    key={member.id}
                    data-testid={`split-member-row-${member.id}`}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-2 rounded-[11px] px-2 py-1.5 transition-colors",
                      isIncluded ? "bg-transparent" : "opacity-55",
                    )}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        disabled={
                          isLockedExpense || isExpenseCreationBlockedByPolicy
                        }
                        onChange={() => handleToggleMember(member.id)}
                        aria-label={`Include ${member.name} in split`}
                        className="h-4 w-4 shrink-0 cursor-pointer rounded border-hairline accent-[#0066cc]"
                      />
                      <Avatar name={member.name} size="sm" />
                      <span className="truncate text-[13px] font-medium text-ink">
                        {member.name}
                        {member.id === currentUser?.id && (
                          <span className="font-normal text-ink-muted-48">
                            {" "}
                            (You)
                          </span>
                        )}
                      </span>
                      {isPayer && (
                        <Badge tone="info" size="sm" className="shrink-0">
                          Payer
                        </Badge>
                      )}
                    </label>

                    <div className="flex shrink-0 items-center gap-2">
                      {splitMethod === "EQUAL" && (
                        <span
                          data-testid={`split-share-${member.id}`}
                          className="text-[13px] font-semibold tabular-nums text-ink"
                        >
                          {formatMinorUnits(shareCents, baseCurrency)}{" "}
                          <span className="text-[12px] font-normal text-ink-muted-48">
                            ({sharePct}%)
                          </span>
                        </span>
                      )}

                      {splitMethod === "PERCENTAGE" && (
                        <div className="flex items-center gap-2">
                          <div className="w-24">
                            <Input
                              aria-label={`${member.name} percentage`}
                              type="text"
                              inputMode="decimal"
                              suffix="%"
                              disabled={
                                !isIncluded ||
                                isLockedExpense ||
                                isExpenseCreationBlockedByPolicy
                              }
                              value={
                                isIncluded
                                  ? (percentageInputs[member.id] ?? "0")
                                  : "0"
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                setPercentageInputs((prev) => ({
                                  ...prev,
                                  [member.id]: val,
                                }));
                              }}
                              className="h-9 text-right text-[13px] tabular-nums"
                            />
                          </div>
                          <span
                            data-testid={`split-share-${member.id}`}
                            className="w-20 text-right text-[13px] font-semibold tabular-nums text-ink"
                          >
                            {formatMinorUnits(shareCents, baseCurrency)}
                          </span>
                        </div>
                      )}

                      {splitMethod === "EXACT" && (
                        <div className="w-28">
                          <Input
                            aria-label={`${member.name} exact amount`}
                            type="text"
                            inputMode="decimal"
                            prefix={baseCurrencySymbol}
                            placeholder={
                              getCurrencyMinorDigits(baseCurrency) === 0
                                ? "0"
                                : "0.00"
                            }
                            disabled={
                              !isIncluded ||
                              isLockedExpense ||
                              isExpenseCreationBlockedByPolicy
                            }
                            value={
                              isIncluded ? (exactInputs[member.id] ?? "") : ""
                            }
                            onChange={(e) => {
                              const val = e.target.value;
                              setExactInputs((prev) => ({
                                ...prev,
                                [member.id]: val,
                              }));
                            }}
                            className="h-9 text-right text-[13px] tabular-nums"
                          />
                        </div>
                      )}

                      {splitMethod === "SHARES" && (
                        <div className="flex items-center gap-2">
                          <div className="w-24">
                            <Input
                              aria-label={`${member.name} shares`}
                              type="text"
                              inputMode="decimal"
                              suffix="sh"
                              disabled={
                                !isIncluded ||
                                isLockedExpense ||
                                isExpenseCreationBlockedByPolicy
                              }
                              value={
                                isIncluded
                                  ? (shareInputs[member.id] ?? "1")
                                  : "0"
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                setShareInputs((prev) => ({
                                  ...prev,
                                  [member.id]: val,
                                }));
                              }}
                              className="h-9 text-right text-[13px] tabular-nums"
                            />
                          </div>
                          <span
                            data-testid={`split-share-${member.id}`}
                            className="min-w-[84px] text-right text-[13px] font-semibold tabular-nums text-ink"
                          >
                            {formatMinorUnits(shareCents, baseCurrency)}{" "}
                            <span className="text-[11px] font-normal text-ink-muted-48">
                              ({sharePct}%)
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Live Allocation Balance Bar */}
          {selectedGroup && (
            <div
              role="status"
              aria-live="polite"
              data-testid="split-balance-bar"
              className={cn(
                "mt-1 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-[12px]",
                splitEvaluation.ok && isAmountValid
                  ? "border-[#0066cc]/25 bg-[#0066cc]/5 text-[#0066cc]"
                  : "border-amber-200 bg-amber-50 text-amber-900",
              )}
            >
              <div className="flex items-center gap-1.5 font-semibold tabular-nums">
                {splitEvaluation.ok && isAmountValid ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {formatMinorUnits(
                        splitEvaluation.assignedCents,
                        baseCurrency,
                      )}{" "}
                      of{" "}
                      {formatMinorUnits(
                        effectiveBaseAmountCents ?? 0,
                        baseCurrency,
                      )}{" "}
                      assigned (100%)
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {effectiveBaseAmountCents && effectiveBaseAmountCents > 0
                        ? `${formatMinorUnits(splitEvaluation.assignedCents, baseCurrency)} of ${formatMinorUnits(effectiveBaseAmountCents, baseCurrency)} assigned`
                        : "Enter an amount to calculate splits"}
                    </span>
                  </>
                )}
              </div>

              <span className="font-semibold">
                {splitEvaluation.ok && isAmountValid
                  ? "Fully Balanced"
                  : splitMethod === "PERCENTAGE" &&
                      splitEvaluation.totalBps !== 10_000
                    ? `${(splitEvaluation.totalBps / 100).toFixed(2)}% of 100.00%`
                    : splitMethod === "SHARES" &&
                        splitEvaluation.totalShares <= 0
                      ? "Total shares must be > 0"
                      : effectiveBaseAmountCents && effectiveBaseAmountCents > 0
                        ? remainingCents > 0
                          ? `${formatMinorUnits(remainingCents, baseCurrency)} remaining`
                          : remainingCents < 0
                            ? `Over by ${formatMinorUnits(Math.abs(remainingCents), baseCurrency)}`
                            : (splitEvaluation.errorMessage ?? "Incomplete")
                        : "Pending amount"}
              </span>
            </div>
          )}
        </Card>
      </form>
    </Dialog>
  );
}
