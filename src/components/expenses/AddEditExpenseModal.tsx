"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Paperclip,
  RefreshCw,
  Trash2,
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
import { formatCycleLabel } from "@/components/shell/url-state";
import { cn } from "@/lib/cn";
import {
  EXPENSE_CATEGORIES,
  RECEIPT_STORAGE_QUOTA_BYTES,
  checkReceiptStorageQuota,
  computeEqualSplit,
  computeExactSplit,
  computePercentageSplit,
  convertForeignAmountToBaseMinorUnits,
  validateSplitBreakdown,
} from "@/lib/expenses/split-engine";
import { computeEqualSharePercentages } from "@/lib/groups/invite-utils";
import {
  SUPPORTED_CURRENCIES,
  formatMinorUnits,
  getCurrencyMinorDigits,
  getCurrencySymbol,
  parseCurrencyInputToMinorUnits,
} from "@/lib/money";
import type { ExpenseLedgerRecord } from "@/lib/expenses/ledger";
import type {
  Database,
  ExchangeRateSource,
  ExpenseSplitMethod,
  SplitBreakdownItem,
} from "@/types/database";

export interface AddEditExpenseModalProps {
  open: boolean;
  onClose: () => void;
  mode?: "create" | "edit";
  expense?: ExpenseLedgerRecord | null;
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
  { value: "EQUAL", label: "Split Evenly" },
  { value: "PERCENTAGE", label: "By Percentage" },
  { value: "EXACT", label: "Exact Amounts" },
];

const CURRENCY_OPTIONS: SelectOption[] = SUPPORTED_CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} (${c.symbol})`,
  description: c.label,
}));

const CATEGORY_OPTIONS: SelectOption[] = EXPENSE_CATEGORIES.map((cat) => ({
  value: cat,
  label: cat,
}));

async function fetchSpotRateFromApi(
  fromCur: string,
  toCur: string,
  signal: AbortSignal,
): Promise<number | null> {
  const res = await fetch(
    `/api/fx?from=${encodeURIComponent(fromCur)}&to=${encodeURIComponent(toCur)}`,
    { signal },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { rate?: number };
  if (
    typeof data.rate === "number" &&
    Number.isFinite(data.rate) &&
    data.rate > 0
  ) {
    return data.rate;
  }
  return null;
}

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
  currency: string;
  paidBy: string;
  splitMethod: ExpenseSplitMethod;
  includedMemberIds: string[];
  percentageInputs: Record<string, string>;
  exactInputs: Record<string, string>;
} {
  if (!group) {
    return {
      currency: "USD",
      paidBy: currentUser?.id ?? "",
      splitMethod: "EQUAL",
      includedMemberIds: [],
      percentageInputs: {},
      exactInputs: {},
    };
  }

  const members = group.members ?? [];
  const memberIds = members.map((m) => m.id);
  const defaultPayer =
    currentUser && memberIds.includes(currentUser.id)
      ? currentUser.id
      : (memberIds[0] ?? "");

  const equalMap = computeEqualSharePercentages(memberIds);
  const hasCustomRatios =
    group.defaultSplitMode === "CUSTOM_RATIOS" &&
    group.status !== "NEEDS_RATIO_UPDATE" &&
    members.some((m) => typeof m.sharePercentage === "number");

  return {
    currency: group.baseCurrency,
    paidBy: defaultPayer,
    splitMethod: hasCustomRatios ? "PERCENTAGE" : "EQUAL",
    includedMemberIds: memberIds,
    percentageInputs: Object.fromEntries(
      members.map((m) => [
        m.id,
        String(
          hasCustomRatios
            ? (m.sharePercentage ?? equalMap.get(m.id) ?? 0)
            : (equalMap.get(m.id) ?? 0),
        ),
      ]),
    ),
    exactInputs: Object.fromEntries(members.map((m) => [m.id, ""])),
  };
}

function buildInitialEditState(
  group: ShellGroupSummary | null,
  expense: ExpenseLedgerRecord,
  currentUser: ShellUserSummary | null,
): {
  amountInput: string;
  currency: string;
  exchangeRateInput: string;
  exchangeRateSource: ExchangeRateSource;
  description: string;
  category: string;
  expenseDate: string;
  paidBy: string;
  splitMethod: ExpenseSplitMethod;
  includedMemberIds: string[];
  percentageInputs: Record<string, string>;
  exactInputs: Record<string, string>;
  existingReceiptUrl: string | null;
} {
  const baseDefaults = buildInitialGroupState(group, currentUser);
  const members = group?.members ?? [];
  const activeMemberSet = new Set(members.map((m) => m.id));
  const baseCurrency = group?.baseCurrency ?? expense.currency;

  const isForeign =
    expense.originalAmountCents !== null &&
    Boolean(expense.originalCurrency) &&
    expense.originalCurrency !== baseCurrency;

  const currency = isForeign
    ? (expense.originalCurrency ?? baseCurrency)
    : expense.currency;
  const amountInput = isForeign
    ? formatMinorUnitsPlain(
        expense.originalAmountCents ?? expense.amountCents,
        currency,
      )
    : formatMinorUnitsPlain(expense.amountCents, currency);

  const exchangeRateInput =
    isForeign && expense.exchangeRate !== null
      ? String(expense.exchangeRate)
      : "1";
  const exchangeRateSource: ExchangeRateSource =
    isForeign && expense.exchangeRateSource
      ? expense.exchangeRateSource
      : "API";

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
    } else {
      percentageInputs[m.id] = "0";
      exactInputs[m.id] = "";
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
    currency,
    exchangeRateInput,
    exchangeRateSource,
    description: expense.description,
    category: expense.category,
    expenseDate,
    paidBy,
    splitMethod: expense.splitMethod,
    includedMemberIds,
    percentageInputs,
    exactInputs,
    existingReceiptUrl: expense.receiptUrl ?? null,
  };
}

export function AddEditExpenseModal(props: AddEditExpenseModalProps) {
  const isEditMode = props.mode === "edit" && Boolean(props.expense);
  if (!props.open) {
    return (
      <Dialog
        open={false}
        onClose={props.onClose}
        title={isEditMode ? "Edit Expense" : "Add Expense"}
      >
        {null}
      </Dialog>
    );
  }

  const modalKey =
    isEditMode && props.expense
      ? `edit-${props.expense.id}`
      : `create-${props.activeGroupId}`;

  return <AddEditExpenseModalInner key={modalKey} {...props} />;
}

function AddEditExpenseModalInner({
  open,
  onClose,
  mode = "create",
  expense = null,
  groups,
  activeGroupId,
  currentUser,
  cycle,
  onReceiptStorageUsedBytesChange,
  onCreated,
  onUpdated,
}: AddEditExpenseModalProps) {
  const isEditMode = mode === "edit" && expense !== null;
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

  const initialGroupId = isEditMode && expense
    ? expense.groupId
    : activeGroupId &&
        activeGroupId !== "all" &&
        nonArchivedGroups.some((g) => g.id === activeGroupId)
      ? activeGroupId
      : "";

  const [selectedGroupId, setSelectedGroupId] =
    React.useState<string>(initialGroupId);

  const selectedGroup = React.useMemo(
    () => nonArchivedGroups.find((g) => g.id === selectedGroupId) ?? null,
    [nonArchivedGroups, selectedGroupId],
  );

  const initialGroup = React.useMemo(
    () => nonArchivedGroups.find((g) => g.id === initialGroupId) ?? null,
    [initialGroupId, nonArchivedGroups],
  );

  const initialEditSeed = React.useMemo(
    () =>
      isEditMode && expense
        ? buildInitialEditState(initialGroup, expense, currentUser)
        : null,
    [currentUser, expense, initialGroup, isEditMode],
  );

  const initialSeed = React.useMemo(
    () => buildInitialGroupState(initialGroup, currentUser),
    [currentUser, initialGroup],
  );

  const [amountInput, setAmountInput] = React.useState(
    initialEditSeed?.amountInput ?? "",
  );
  const [currency, setCurrency] = React.useState(
    initialEditSeed?.currency ?? initialSeed.currency,
  );
  const [exchangeRateInput, setExchangeRateInput] = React.useState(
    initialEditSeed?.exchangeRateInput ?? "1",
  );
  const [exchangeRateSource, setExchangeRateSource] =
    React.useState<ExchangeRateSource>(
      initialEditSeed?.exchangeRateSource ?? "API",
    );
  const skipFxAutoFetchForCurrencyRef = React.useRef<string | null>(
    initialEditSeed &&
      initialGroup &&
      initialEditSeed.currency !== initialGroup.baseCurrency
      ? initialEditSeed.currency
      : null,
  );
  const [fxLoading, setFxLoading] = React.useState(false);
  const [fxError, setFxError] = React.useState<string | null>(null);
  const fxAbortRef = React.useRef<AbortController | null>(null);
  const fxRequestSeqRef = React.useRef(0);

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
  const [existingReceiptUrl, setExistingReceiptUrl] = React.useState<
    string | null
  >(initialEditSeed?.existingReceiptUrl ?? null);

  const [attachedFile, setAttachedFile] = React.useState<File | null>(null);
  const [receiptWarning, setReceiptWarning] = React.useState<string | null>(
    null,
  );
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const cancelPendingFxFetch = React.useCallback(() => {
    fxRequestSeqRef.current += 1;
    if (fxAbortRef.current) {
      fxAbortRef.current.abort();
      fxAbortRef.current = null;
    }
  }, []);

  const applyGroupDefaults = React.useCallback(
    (group: ShellGroupSummary | null) => {
      cancelPendingFxFetch();
      const next = buildInitialGroupState(group, currentUser);
      setCurrency(next.currency);
      setExchangeRateInput("1");
      setExchangeRateSource("API");
      setFxLoading(false);
      setFxError(null);
      setPaidBy(next.paidBy);
      setSplitMethod(next.splitMethod);
      setIncludedMemberIds(next.includedMemberIds);
      setPercentageInputs(next.percentageInputs);
      setExactInputs(next.exactInputs);
    },
    [cancelPendingFxFetch, currentUser],
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
      setReceiptWarning(null);
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
    setServerError(null);
  };

  // Fetch spot FX rate when logging in a foreign currency
  const baseCurrency = selectedGroup?.baseCurrency ?? "USD";
  const isForeignCurrency =
    selectedGroup !== null && currency !== baseCurrency;

  const handleRefreshSpotRate = React.useCallback(() => {
    cancelPendingFxFetch();
    if (!selectedGroup || currency === selectedGroup.baseCurrency) {
      setExchangeRateInput("1");
      setExchangeRateSource("API");
      setFxLoading(false);
      setFxError(null);
      return;
    }

    const requestSeq = fxRequestSeqRef.current;
    const controller = new AbortController();
    fxAbortRef.current = controller;
    setFxLoading(true);
    setFxError(null);

    fetchSpotRateFromApi(currency, selectedGroup.baseCurrency, controller.signal)
      .then((rate) => {
        if (controller.signal.aborted || requestSeq !== fxRequestSeqRef.current) {
          return;
        }
        if (rate !== null) {
          setExchangeRateInput(String(rate));
          setExchangeRateSource("API");
          setFxError(null);
        } else {
          setFxError("Live spot rate unavailable. Enter an exchange rate manually.");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && requestSeq === fxRequestSeqRef.current) {
          setFxError("Live spot rate unavailable. Enter an exchange rate manually.");
        }
      })
      .finally(() => {
        if (requestSeq === fxRequestSeqRef.current) {
          fxAbortRef.current = null;
          setFxLoading(false);
        }
      });
  }, [cancelPendingFxFetch, currency, selectedGroup]);

  React.useEffect(() => {
    if (!open || !selectedGroup || currency === selectedGroup.baseCurrency) {
      return;
    }

    if (skipFxAutoFetchForCurrencyRef.current === currency) {
      skipFxAutoFetchForCurrencyRef.current = null;
      return;
    }

    const requestSeq = fxRequestSeqRef.current;
    const controller = new AbortController();
    fxAbortRef.current = controller;

    fetchSpotRateFromApi(currency, selectedGroup.baseCurrency, controller.signal)
      .then((rate) => {
        if (controller.signal.aborted || requestSeq !== fxRequestSeqRef.current) {
          return;
        }
        if (rate !== null) {
          setExchangeRateInput(String(rate));
          setExchangeRateSource("API");
          setFxError(null);
        } else {
          setFxError("Live spot rate unavailable. Enter an exchange rate manually.");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && requestSeq === fxRequestSeqRef.current) {
          setFxError("Live spot rate unavailable. Enter an exchange rate manually.");
        }
      })
      .finally(() => {
        if (requestSeq === fxRequestSeqRef.current) {
          fxAbortRef.current = null;
          setFxLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [currency, open, selectedGroup]);

  const parsedInputAmountCents = React.useMemo(
    () => parseCurrencyInputToMinorUnits(amountInput, currency),
    [amountInput, currency],
  );

  const parsedExchangeRate = React.useMemo(() => {
    if (!isForeignCurrency) return 1;
    const cleaned = exchangeRateInput.trim();
    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const num = Number(cleaned);
    if (!Number.isFinite(num) || num <= 0 || num >= 1_000_000) return null;
    const rounded = Number(num.toFixed(6));
    return rounded > 0 ? rounded : null;
  }, [exchangeRateInput, isForeignCurrency]);

  const effectiveBaseAmountCents = React.useMemo(() => {
    if (parsedInputAmountCents === null || parsedInputAmountCents <= 0) {
      return null;
    }
    if (!isForeignCurrency) {
      return parsedInputAmountCents;
    }
    if (parsedExchangeRate === null) {
      return null;
    }
    return convertForeignAmountToBaseMinorUnits({
      originalAmountCents: parsedInputAmountCents,
      originalCurrency: currency,
      exchangeRate: parsedExchangeRate,
      baseCurrency,
    });
  }, [
    baseCurrency,
    currency,
    isForeignCurrency,
    parsedExchangeRate,
    parsedInputAmountCents,
  ]);

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

  // Live split calculation
  const splitEvaluation = React.useMemo((): {
    ok: boolean;
    breakdown: SplitBreakdownItem[];
    assignedCents: number;
    totalBps: number;
    errorMessage: string | null;
  } => {
    const activeIds = groupMembers.map((m) => m.id);
    if (!selectedGroup || activeIds.length === 0) {
      return {
        ok: false,
        breakdown: [],
        assignedCents: 0,
        totalBps: 0,
        errorMessage: "Select a split group with active members.",
      };
    }

    if (selectedMemberIds.length === 0) {
      return {
        ok: false,
        breakdown: [],
        assignedCents: 0,
        totalBps: 0,
        errorMessage: "Select at least one member to split this expense.",
      };
    }

    const totalCents = effectiveBaseAmountCents ?? 0;

    if (splitMethod === "EQUAL") {
      const breakdown =
        totalCents > 0
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

      if (totalCents <= 0) {
        return {
          ok: false,
          breakdown,
          assignedCents: 0,
          totalBps: 0,
          errorMessage: "Enter an expense amount greater than zero.",
        };
      }

      const check = validateSplitBreakdown({
        amountCents: totalCents,
        splitMethod: "EQUAL",
        splitBreakdown: breakdown,
        activeMemberIds: activeIds,
      });

      return {
        ok: check.ok,
        breakdown: check.ok ? check.breakdown : breakdown,
        assignedCents: breakdown.reduce((s, i) => s + i.share_cents, 0),
        totalBps: 10_000,
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

      if (totalCents <= 0) {
        return {
          ok: false,
          breakdown: participants.map((p) => ({
            user_id: p.userId,
            share_cents: 0,
            percentage: p.percentage,
          })),
          assignedCents: 0,
          totalBps,
          errorMessage: "Enter an expense amount greater than zero.",
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
          errorMessage: "Each percentage must be between 0% and 100%.",
        };
      }

      const result = computePercentageSplit({
        amountCents: totalCents,
        paidBy,
        participants,
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
          errorMessage: result.message,
        };
      }

      return {
        ok: true,
        breakdown: result.breakdown,
        assignedCents: result.breakdown.reduce((s, i) => s + i.share_cents, 0),
        totalBps,
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
        raw === "" ? 0 : parseCurrencyInputToMinorUnits(raw, baseCurrency);
      if (parsed === null || parsed < 0) {
        hasInvalidExact = true;
        exactParticipants.push({ userId: id, shareCents: 0 });
      } else {
        sumCents += parsed;
        exactParticipants.push({ userId: id, shareCents: parsed });
      }
    }

    if (totalCents <= 0) {
      return {
        ok: false,
        breakdown: exactParticipants.map((p) => ({
          user_id: p.userId,
          share_cents: p.shareCents,
        })),
        assignedCents: sumCents,
        totalBps: 0,
        errorMessage: "Enter an expense amount greater than zero.",
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
        errorMessage: "Enter valid non-negative currency amounts.",
      };
    }

    const exactResult = computeExactSplit({
      amountCents: totalCents,
      participants: exactParticipants,
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
        errorMessage: exactResult.message,
      };
    }

    return {
      ok: true,
      breakdown: exactResult.breakdown,
      assignedCents: sumCents,
      totalBps: 10_000,
      errorMessage: null,
    };
  }, [
    baseCurrency,
    effectiveBaseAmountCents,
    exactInputs,
    groupMembers,
    paidBy,
    percentageInputs,
    selectedGroup,
    selectedMemberIds,
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

  const handleQuickIncrement = (majorUnits: number) => {
    const digits = getCurrencyMinorDigits(currency);
    const stepMinor = majorUnits * 10 ** digits;
    const current = parsedInputAmountCents ?? 0;
    const next = current + stepMinor;
    setAmountInput(formatMinorUnitsPlain(next, currency));
    setTouched((prev) => ({ ...prev, amount: true }));
  };

  const handleRoundNearest = () => {
    const digits = getCurrencyMinorDigits(currency);
    if (digits === 0) return;
    const unit = 10 ** digits;
    const current = parsedInputAmountCents ?? 0;
    if (current <= 0) return;
    const rounded = Math.round(current / unit) * unit;
    setAmountInput(formatMinorUnitsPlain(Math.max(unit, rounded), currency));
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
    const usedBytes = currentUser?.receiptStorageUsedBytes ?? 0;
    if (usedBytes >= RECEIPT_STORAGE_QUOTA_BYTES) {
      setReceiptWarning(
        "Receipt storage full (500 MB). Expense will be logged without receipt.",
      );
      setAttachedFile(null);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleReceiptFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;

    const usedBytes = currentUser?.receiptStorageUsedBytes ?? 0;
    const quota = checkReceiptStorageQuota(usedBytes, file.size);
    if (!quota.allowed) {
      setReceiptWarning(
        "Receipt storage full (500 MB). Expense will be logged without receipt.",
      );
      setAttachedFile(null);
      return;
    }

    setReceiptWarning(null);
    uploadedReceiptRef.current = null;
    setAttachedFile(file);
  };

  const isDescriptionValid = description.trim().length > 0;
  const isDateValid = isValidIsoDateInput(expenseDate);
  const isPayerValid =
    Boolean(paidBy) && groupMembers.some((m) => m.id === paidBy);
  const isAmountValid =
    effectiveBaseAmountCents !== null && effectiveBaseAmountCents > 0;

  const isFormValid =
    !isLockedExpense &&
    selectedGroup !== null &&
    selectedGroup.status !== "ARCHIVED" &&
    isDescriptionValid &&
    isDateValid &&
    isPayerValid &&
    isAmountValid &&
    splitEvaluation.ok &&
    (!isForeignCurrency ||
      (parsedInputAmountCents !== null &&
        parsedInputAmountCents > 0 &&
        parsedExchangeRate !== null));

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
    setTouched({
      group: true,
      amount: true,
      description: true,
      date: true,
      exchangeRate: true,
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
            usedBytes?: number;
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
              usedBytes?: number;
              error?: string;
            } | null;
          } catch {
            uploadOk = false;
          }

          if (typeof uploadPayload?.usedBytes === "number") {
            onReceiptStorageUsedBytesChange?.(uploadPayload.usedBytes);
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
            setReceiptWarning(
              uploadPayload?.error ||
                "Receipt storage full (500 MB). Expense will be logged without receipt.",
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
          original_amount_cents: isForeignCurrency
            ? parsedInputAmountCents
            : null,
          original_currency: isForeignCurrency ? currency : null,
          exchange_rate: isForeignCurrency ? parsedExchangeRate : null,
          exchange_rate_source: isForeignCurrency ? exchangeRateSource : null,
          receipt_url: receiptUrl,
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

  const payerMember =
    groupMembers.find((m) => m.id === paidBy) ?? groupMembers[0] ?? null;

  const inputCurrencySymbol = getCurrencySymbol(currency);
  const baseCurrencySymbol = getCurrencySymbol(baseCurrency);
  const cycleLabel = cycle ? formatCycleLabel(cycle) : "Current Period";

  const amountError = React.useMemo(() => {
    if (!touched.amount) return undefined;
    if (parsedInputAmountCents !== null && parsedInputAmountCents > 0) {
      return undefined;
    }
    const digits = getCurrencyMinorDigits(currency);
    const trimmed = amountInput.trim();
    if (digits === 0 && trimmed.includes(".")) {
      return `${currency} does not use decimal places. Enter a whole number.`;
    }
    if (digits > 0 && /^\d+\.\d+$/.test(trimmed)) {
      const frac = trimmed.split(".")[1] ?? "";
      if (frac.length > digits) {
        return `Use up to ${digits} decimal places for ${currency}.`;
      }
    }
    return "Enter an amount greater than 0.";
  }, [amountInput, currency, parsedInputAmountCents, touched.amount]);

  const exchangeRateError = React.useMemo(() => {
    if (!isForeignCurrency || !touched.exchangeRate || parsedExchangeRate !== null) {
      return undefined;
    }
    const trimmed = exchangeRateInput.trim();
    if (!trimmed) {
      return "Enter an exchange rate.";
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric >= 1_000_000) {
      return "Exchange rate must be less than 1,000,000.";
    }
    return "Enter a positive exchange rate (e.g. 1.085).";
  }, [exchangeRateInput, isForeignCurrency, parsedExchangeRate, touched.exchangeRate]);

  const descriptionError =
    touched.description && !isDescriptionValid
      ? "Please enter a description for this expense."
      : undefined;
  const dateError =
    touched.date && !isDateValid ? "Enter a valid YYYY-MM-DD date." : undefined;

  const saveBaseLabel = isEditMode ? "Save Changes" : "Save Expense";
  const saveLabel =
    effectiveBaseAmountCents && effectiveBaseAmountCents > 0
      ? `${saveBaseLabel} (${formatMinorUnits(effectiveBaseAmountCents, baseCurrency)})`
      : saveBaseLabel;

  const remainingCents =
    effectiveBaseAmountCents !== null
      ? effectiveBaseAmountCents - splitEvaluation.assignedCents
      : 0;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={isEditMode ? "Edit Expense" : "Add Expense"}
      description={
        isEditMode
          ? selectedGroup
            ? `Editing expense in ${selectedGroup.name} · records an ExpenseRevision snapshot`
            : "Editing shared expense"
          : selectedGroup
            ? `Logging to ${selectedGroup.name} (${cycleLabel})`
            : `Select a split group to log an expense for ${cycleLabel}`
      }
      size="lg"
      closeOnBackdropClick={!isSubmitting}
      closeOnEscape={!isSubmitting}
      footer={
        <div className="flex w-full flex-col gap-3">
          {receiptWarning && (
            <AlertBanner
              tone="warning"
              title="Receipt upload skipped"
              description={receiptWarning}
              onDismiss={() => setReceiptWarning(null)}
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isSubmitting || isLockedExpense}
                leftIcon={<Paperclip className="h-4 w-4" aria-hidden="true" />}
                onClick={handleAttachReceiptClick}
              >
                Attach Receipt
              </Button>
              {attachedFile && (
                <span className="inline-flex max-w-[200px] items-center gap-1.5 rounded-pill border border-hairline bg-canvas-parchment py-0.5 pr-1 pl-2.5 text-[11px] font-medium text-ink">
                  <span className="truncate">{attachedFile.name}</span>
                  <span className="shrink-0 text-ink-muted-48">
                    ({formatFileSize(attachedFile.size)})
                  </span>
                  <button
                    type="button"
                    aria-label="Remove attached receipt"
                    onClick={() => {
                      uploadedReceiptRef.current = null;
                      setAttachedFile(null);
                    }}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-muted-48 transition-colors hover:bg-canvas hover:text-red-600 focus-visible:outline-2 focus-visible:outline-primary-focus"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              )}
              {!attachedFile && existingReceiptUrl && (
                <span className="inline-flex max-w-[200px] items-center gap-1.5 rounded-pill border border-hairline bg-canvas-parchment py-0.5 pr-1 pl-2.5 text-[11px] font-medium text-ink">
                  <span className="truncate">Existing receipt</span>
                  <button
                    type="button"
                    aria-label="Remove existing receipt"
                    onClick={() => setExistingReceiptUrl(null)}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-muted-48 transition-colors hover:bg-canvas hover:text-red-600 focus-visible:outline-2 focus-visible:outline-primary-focus"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isSubmitting}
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form={formId}
                variant="primary"
                size="sm"
                loading={isSubmitting}
                disabled={!isFormValid || isSubmitting}
                leftIcon={<Check className="h-4 w-4" aria-hidden="true" />}
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
        className="flex flex-col gap-4"
      >
        {isLockedExpense && (
          <AlertBanner
            tone="warning"
            title="Expense is locked"
            description="This expense is covered by a closed billing cycle or pairwise settlement watermark and cannot be edited."
          />
        )}

        {serverError && (
          <AlertBanner
            tone="error"
            title="Could not save expense"
            description={serverError}
          />
        )}

        {nonArchivedGroups.length === 0 ? (
          <AlertBanner
            tone="warning"
            title="No active split groups"
            description="Create or join an active split group before logging an expense."
          />
        ) : (
          !isEditMode &&
          (activeGroupId === "all" || nonArchivedGroups.length > 1) && (
            <Select
              label="Split Group"
              aria-label="Split Group"
              placeholder="Select a split group..."
              options={groupOptions}
              value={selectedGroupId}
              onChange={handleGroupChange}
              error={
                touched.group && !selectedGroup
                  ? "Select a split group."
                  : undefined
              }
            />
          )
        )}

        {selectedGroup?.status === "NEEDS_RATIO_UPDATE" && (
          <AlertBanner
            tone="warning"
            title="Custom ratios need admin review"
            description="A newly joined member has a 0% default ratio. Split Evenly, Exact Amounts, or percentages summing to 100.00% can still be logged."
          />
        )}

        {/* Hero Amount & Currency Card */}
        <Card variant="sub-card" padding="md" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Input
                label="Total Bill Amount"
                name="amount"
                type="text"
                inputMode="decimal"
                required
                autoFocus
                prefix={inputCurrencySymbol}
                placeholder={getCurrencyMinorDigits(currency) === 0 ? "0" : "0.00"}
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setServerError(null);
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, amount: true }))}
                error={amountError}
                className="text-[22px] font-semibold tracking-tight tabular-nums"
              />
            </div>

            <div className="w-full sm:w-44">
              <Select
                label="Currency"
                aria-label="Currency"
                options={CURRENCY_OPTIONS}
                value={currency}
                onChange={(nextCur) => {
                  skipFxAutoFetchForCurrencyRef.current = null;
                  setCurrency(nextCur);
                  if (selectedGroup && nextCur === selectedGroup.baseCurrency) {
                    cancelPendingFxFetch();
                    setExchangeRateInput("1");
                    setExchangeRateSource("API");
                    setFxLoading(false);
                    setFxError(null);
                  } else if (selectedGroup) {
                    cancelPendingFxFetch();
                    setExchangeRateInput("");
                    setExchangeRateSource("API");
                    setFxLoading(true);
                    setFxError(null);
                  }
                  setServerError(null);
                }}
                disabled={!selectedGroup}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleQuickIncrement(10)}
              className="h-7 px-2.5 text-[12px] tabular-nums"
            >
              +{inputCurrencySymbol}10
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleQuickIncrement(20)}
              className="h-7 px-2.5 text-[12px] tabular-nums"
            >
              +{inputCurrencySymbol}20
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleQuickIncrement(50)}
              className="h-7 px-2.5 text-[12px] tabular-nums"
            >
              +{inputCurrencySymbol}50
            </Button>
            {getCurrencyMinorDigits(currency) > 0 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleRoundNearest}
                className="ml-auto h-7 px-2.5 text-[12px]"
              >
                Round nearest {inputCurrencySymbol}
              </Button>
            )}
          </div>

          {isForeignCurrency && selectedGroup && (
            <div
              data-testid="fx-conversion-box"
              className="mt-1 flex flex-col gap-2.5 rounded-md border border-hairline bg-canvas p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                  FX Conversion to {baseCurrency}
                </span>
                <div className="flex items-center gap-1.5">
                  <Badge
                    data-testid="fx-rate-source-badge"
                    tone={
                      exchangeRateSource === "MANUAL_OVERRIDE"
                        ? "warning"
                        : fxError
                          ? "danger"
                          : "info"
                    }
                    size="sm"
                  >
                    {exchangeRateSource === "MANUAL_OVERRIDE"
                      ? "Manual Override"
                      : fxLoading
                        ? "Fetching rate..."
                        : fxError
                          ? "Rate unavailable"
                          : "API Spot Rate"}
                  </Badge>
                  <Button
                    type="button"
                    variant="icon-circle"
                    size="sm"
                    disabled={fxLoading}
                    aria-label="Refresh spot exchange rate"
                    onClick={handleRefreshSpotRate}
                    className="h-6 w-6 border-transparent bg-transparent text-ink-muted-48 hover:bg-canvas-parchment hover:text-ink"
                  >
                    <RefreshCw
                      className={cn("h-3.5 w-3.5", fxLoading && "animate-spin")}
                      aria-hidden="true"
                    />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-start">
                <Input
                  label={`Exchange Rate (1 ${currency} → ${baseCurrency})`}
                  name="exchange_rate"
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder={fxLoading ? "Fetching..." : "1.0000"}
                  value={exchangeRateInput}
                  onChange={(e) => {
                    cancelPendingFxFetch();
                    setFxLoading(false);
                    setFxError(null);
                    setExchangeRateInput(e.target.value);
                    setExchangeRateSource("MANUAL_OVERRIDE");
                    setServerError(null);
                  }}
                  onBlur={() =>
                    setTouched((prev) => ({ ...prev, exchangeRate: true }))
                  }
                  error={exchangeRateError}
                />
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-semibold tracking-wide text-ink-muted-80">
                    Converted Total ({baseCurrency})
                  </span>
                  <div
                    data-testid="fx-base-total"
                    className="flex h-11 items-center justify-between rounded-md border border-hairline bg-surface-pearl px-3.5"
                  >
                    <span className="text-[12px] font-medium text-ink-muted-48">
                      Base Total
                    </span>
                    <span className="text-[15px] font-semibold tabular-nums text-ink">
                      {effectiveBaseAmountCents !== null
                        ? `${formatMinorUnits(effectiveBaseAmountCents, baseCurrency)} ${baseCurrency}`
                        : `— ${baseCurrency}`}
                    </span>
                  </div>
                </div>
              </div>

              {fxError && (
                <p role="alert" className="text-[12px] font-medium text-red-600">
                  {fxError}
                </p>
              )}

              {!fxError &&
                parsedInputAmountCents !== null &&
                parsedInputAmountCents > 0 &&
                parsedExchangeRate !== null &&
                effectiveBaseAmountCents !== null && (
                  <p className="text-[12px] tabular-nums text-ink-muted-48">
                    {formatMinorUnits(parsedInputAmountCents, currency)} ×{" "}
                    {parsedExchangeRate} ={" "}
                    {formatMinorUnits(effectiveBaseAmountCents, baseCurrency)}{" "}
                    {baseCurrency}
                  </p>
                )}
            </div>
          )}
        </Card>

        {/* Description */}
        <Input
          label="Description"
          name="description"
          required
          placeholder="What was this expense for?"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setServerError(null);
          }}
          onBlur={() => setTouched((prev) => ({ ...prev, description: true }))}
          error={descriptionError}
        />

        {/* Category & Date */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Category"
            aria-label="Category"
            options={categoryOptions}
            value={category}
            onChange={setCategory}
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
          />
        </div>

        {/* Paid By */}
        <Card variant="sub-card" padding="sm" className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={payerMember?.name ?? "Member"} size="md" />
            <div className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-muted-48">
                Paid By
              </span>
              <span className="block truncate text-[13px] font-semibold text-ink">
                {payerMember
                  ? payerMember.id === currentUser?.id
                    ? `Paid by You (${payerMember.name})`
                    : `Paid by ${payerMember.name}`
                  : "Select payer"}
              </span>
            </div>
          </div>

          <div className="w-full sm:w-52">
            <Select
              aria-label="Paid By"
              variant="pill-select"
              options={memberOptions}
              value={paidBy}
              onChange={setPaidBy}
              disabled={memberOptions.length === 0}
              className="h-9 bg-canvas text-[13px]"
            />
          </div>
        </Card>

        {/* Split Method SegmentedControl */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
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
            options={SPLIT_METHOD_OPTIONS}
            value={splitMethod}
            onChange={handleSplitMethodChange}
          />
        </div>

        {/* Split Breakdown Member Checklist */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
              Split Breakdown
            </span>
            <span className="text-[12px] text-ink-muted-48">
              {selectedMemberIds.length} of {groupMembers.length} selected
            </span>
          </div>

          {groupMembers.length === 0 ? (
            <Card variant="sub-card" padding="sm">
              <p className="text-center text-[13px] text-ink-muted-48">
                {selectedGroup
                  ? "No active members in this group."
                  : "Choose a split group above to configure member shares."}
              </p>
            </Card>
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
                      "flex flex-wrap items-center justify-between gap-2.5 rounded-md border px-3 py-2.5 transition-colors",
                      isIncluded
                        ? "border-hairline bg-canvas"
                        : "border-divider-soft bg-surface-pearl opacity-65",
                    )}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        onChange={() => handleToggleMember(member.id)}
                        aria-label={`Include ${member.name} in split`}
                        className="h-4 w-4 shrink-0 cursor-pointer rounded border-hairline accent-[#0066cc]"
                      />
                      <Avatar name={member.name} size="sm" />
                      <div className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-ink">
                          {member.id === currentUser?.id
                            ? `${member.name} (You)`
                            : member.name}
                        </span>
                        <span
                          className={cn(
                            "block text-[11px] font-medium",
                            isPayer ? "text-[#0066cc]" : "text-ink-muted-48",
                          )}
                        >
                          {isPayer ? "Payer (Credited)" : "Member"}
                        </span>
                      </div>
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
                              disabled={!isIncluded}
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
                              className="text-right text-[13px] tabular-nums"
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
                            disabled={!isIncluded}
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
                            className="text-right text-[13px] tabular-nums"
                          />
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
                "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-[12px]",
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
                    : effectiveBaseAmountCents && effectiveBaseAmountCents > 0
                      ? remainingCents > 0
                        ? `${formatMinorUnits(remainingCents, baseCurrency)} remaining`
                        : remainingCents < 0
                          ? `Over by ${formatMinorUnits(Math.abs(remainingCents), baseCurrency)}`
                          : splitEvaluation.errorMessage ?? "Incomplete"
                      : "Pending amount"}
              </span>
            </div>
          )}
        </div>
      </form>
    </Dialog>
  );
}
