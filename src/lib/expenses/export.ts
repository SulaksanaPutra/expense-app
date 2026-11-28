import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCycleParam } from "@/components/shell/url-state";
import {
  buildExpensesCsv,
  evaluateExpenseLockAndSettlement,
  filterAndSortExpenses,
  getUserShareCents,
  type ExpenseBillingCycleRecord,
  type ExpenseLedgerRecord,
  type ExpenseOwnershipFilter,
  type ExpenseSettlementRecord,
  type ExpenseSortOption,
  type ExpenseStatusFilter,
} from "@/lib/expenses/ledger";
import { formatMinorUnits, formatMinorUnitsDecimal } from "@/lib/money";
import type { Database, SplitBreakdownItem } from "@/types/database";

export type ExportFormat = "csv" | "json";

export interface ScopedExportParams {
  groupId?: string | null;
  cycleSlug?: string | null;
  category?: string | null;
  ownership?: ExpenseOwnershipFilter | null;
  status?: ExpenseStatusFilter | null;
  searchQuery?: string | null;
  sortBy?: ExpenseSortOption | null;
}

export type ScopedExportResult =
  | {
      ok: true;
      scopeLabel: string;
      cycleSlug: string;
      recordCount: number;
      csv: string;
      json: string;
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

export function isValidCycleSlugParam(raw: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.trim());
}

export async function buildScopedLedgerExport(
  supabase: SupabaseClient<Database>,
  userId: string,
  params: ScopedExportParams = {},
): Promise<ScopedExportResult> {
  const rawGroup = params.groupId?.trim() || "all";
  const rawCycle = params.cycleSlug?.trim() || "";

  if (rawCycle && !isValidCycleSlugParam(rawCycle)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_CYCLE",
      message: "Billing cycle must be formatted as YYYY-MM.",
    };
  }

  const cycleSlug = parseCycleParam(rawCycle || undefined);

  const { data: membershipRows, error: memErr } = await supabase
    .from("group_members")
    .select("group_id, role, status")
    .eq("user_id", userId);

  if (memErr) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: memErr.message || "Unable to verify group membership.",
    };
  }

  const memberGroupIds = new Set((membershipRows ?? []).map((m) => m.group_id));

  let targetGroupIds: string[] = [];
  if (rawGroup !== "all") {
    const { data: targetGroup, error: targetGroupErr } = await supabase
      .from("groups")
      .select("id")
      .eq("id", rawGroup)
      .maybeSingle();

    if (targetGroupErr) {
      return {
        ok: false,
        status: 500,
        code: "SERVER_ERROR",
        message: targetGroupErr.message || "Unable to load split group.",
      };
    }

    if (!targetGroup) {
      if (!memberGroupIds.has(rawGroup)) {
        return {
          ok: false,
          status: 404,
          code: "NOT_FOUND",
          message: "Split group not found.",
        };
      }
    }

    if (!memberGroupIds.has(rawGroup)) {
      return {
        ok: false,
        status: 403,
        code: "FORBIDDEN",
        message: "You are not a member of this split group.",
      };
    }

    targetGroupIds = [rawGroup];
  } else {
    targetGroupIds = Array.from(memberGroupIds);
  }

  if (targetGroupIds.length === 0) {
    const emptyJson = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        userId,
        scope: { group: rawGroup, cycle: cycleSlug },
        groups: [],
        expenses: [],
        summary: { recordCount: 0 },
      },
      null,
      2,
    );
    return {
      ok: true,
      scopeLabel: rawGroup === "all" ? "all-groups" : rawGroup,
      cycleSlug,
      recordCount: 0,
      csv: buildExpensesCsv([], userId),
      json: emptyJson,
    };
  }

  let groupQuery = supabase
    .from("groups")
    .select(
      "id, name, slug, group_type, status, base_currency, billing_cycle_anchor_day",
    )
    .in("id", targetGroupIds);

  if (rawGroup === "all") {
    groupQuery = groupQuery.neq("status", "ARCHIVED");
  }

  const { data: groupRows, error: groupErr } = await groupQuery.order(
    "created_at",
    { ascending: true },
  );

  if (groupErr) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: groupErr.message || "Unable to load groups for export.",
    };
  }

  const groups = groupRows ?? [];
  if (groups.length === 0) {
    if (rawGroup !== "all") {
      return {
        ok: false,
        status: 404,
        code: "NOT_FOUND",
        message: "Split group not found.",
      };
    }
    const emptyJson = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        userId,
        scope: { group: rawGroup, cycle: cycleSlug },
        groups: [],
        expenses: [],
        summary: { recordCount: 0 },
      },
      null,
      2,
    );
    return {
      ok: true,
      scopeLabel: "all-groups",
      cycleSlug,
      recordCount: 0,
      csv: buildExpensesCsv([], userId),
      json: emptyJson,
    };
  }

  const resolvedGroupIds = groups.map((g) => g.id);
  const scopeLabel =
    rawGroup === "all"
      ? "all-groups"
      : (groups[0]?.slug || groups[0]?.id || "group");

  const [
    { data: expenseRows, error: expErr },
    { data: settlementRows, error: setErr },
    { data: billingCycleRows },
  ] = await Promise.all([
    supabase
      .from("expenses")
      .select("*")
      .in("group_id", resolvedGroupIds)
      .is("deleted_at", null)
      .order("expense_date", { ascending: false }),
    supabase
      .from("settlements")
      .select("id, group_id, payer_id, recipient_id, amount_cents, currency, settled_at")
      .in("group_id", resolvedGroupIds)
      .order("settled_at", { ascending: false }),
    supabase
      .from("billing_cycles")
      .select("id, group_id, period_start, period_end, status")
      .in("group_id", resolvedGroupIds),
  ]);

  if (expErr || setErr) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message:
        expErr?.message || setErr?.message || "Unable to load ledger records for export.",
    };
  }

  const payerIds = Array.from(
    new Set((expenseRows ?? []).map((e) => e.paid_by)),
  );
  const usersById = new Map<string, string>();
  if (payerIds.length > 0) {
    const { data: userRows } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", payerIds);
    for (const u of userRows ?? []) {
      usersById.set(u.id, u.full_name || "Member");
    }
  }

  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const billingCycles: ExpenseBillingCycleRecord[] = (
    billingCycleRows ?? []
  ).map((bc) => ({
    id: bc.id,
    groupId: bc.group_id,
    periodStart: bc.period_start,
    periodEnd: bc.period_end,
    status: bc.status,
  }));

  const settlements: ExpenseSettlementRecord[] = (settlementRows ?? []).map(
    (s) => ({
      id: s.id,
      groupId: s.group_id,
      payerId: s.payer_id,
      recipientId: s.recipient_id,
      amountCents: Math.trunc(Number(s.amount_cents)),
      currency: s.currency,
      settledAt: s.settled_at,
    }),
  );

  const ledgerRecords: ExpenseLedgerRecord[] = (expenseRows ?? [])
    .map((row) => {
      const group = groupMap.get(row.group_id);
      const baseCurrency = (group?.base_currency || row.currency || "USD").toUpperCase();
      const breakdown: SplitBreakdownItem[] = Array.isArray(row.split_breakdown)
        ? (row.split_breakdown as unknown as SplitBreakdownItem[])
        : [];
      const lockEval = evaluateExpenseLockAndSettlement({
        expense: {
          id: row.id,
          groupId: row.group_id,
          paidBy: row.paid_by,
          expenseDate: row.expense_date,
          isLocked: Boolean(row.is_locked),
          splitBreakdown: breakdown,
        },
        currentUserId: userId,
        billingCycles,
        settlements,
      });

      return {
        id: row.id,
        groupId: row.group_id,
        groupName: group?.name ?? "Split Group",
        groupBaseCurrency: baseCurrency,
        groupBillingAnchorDay: group?.billing_cycle_anchor_day ?? 1,
        createdBy: row.created_by,
        paidBy: row.paid_by,
        payerName: usersById.get(row.paid_by) ?? "Member",
        description: row.description,
        category: row.category,
        expenseDate: row.expense_date,
        amountCents: Math.trunc(Number(row.amount_cents)),
        currency: baseCurrency,
        originalAmountCents: null,
        originalCurrency: null,
        exchangeRate: null,
        exchangeRateSource: null,
        splitMethod: row.split_method,
        splitBreakdown: breakdown,
        receiptUrl: row.receipt_url ?? null,
        isRecurringGenerated: false,
        recurringRuleId: null,
        adjustmentForExpenseId: row.adjustment_for_expense_id ?? null,
        isLocked: lockEval.isLocked,
        isCycleClosed: lockEval.isCycleClosed,
        isSettledByWatermark: lockEval.isSettledByWatermark,
        isSettledForUser: lockEval.isSettledForUser,
      };
    })
;

  const filteredRecords = filterAndSortExpenses({
    expenses: ledgerRecords,
    activeGroupId: rawGroup,
    cycleSlug,
    currentUserId: userId,
    ownership: params.ownership ?? "all",
    status: params.status ?? "all",
    searchQuery: params.searchQuery ?? "",
    category: params.category ?? "all",
    sortBy: params.sortBy ?? "date-desc",
  });

  const csv = buildExpensesCsv(filteredRecords, userId);

  const jsonExpenses = filteredRecords.map((exp) => {
    const shareCents = getUserShareCents(exp, userId);
    const status = exp.isLocked
      ? "LOCKED"
      : exp.isSettledForUser
        ? "Settled"
        : "Pending";
    const origCurrency = exp.originalCurrency
      ? exp.originalCurrency.toUpperCase()
      : null;
    const fxAudit =
      exp.originalAmountCents !== null && exp.originalAmountCents !== undefined && origCurrency
        ? {
            original_amount_cents: exp.originalAmountCents,
            original_amount_formatted: formatMinorUnits(
              exp.originalAmountCents,
              origCurrency,
            ),
            original_amount_decimal: formatMinorUnitsDecimal(
              exp.originalAmountCents,
              origCurrency,
            ),
            original_currency: origCurrency,
            exchange_rate: exp.exchangeRate,
            exchange_rate_source: exp.exchangeRateSource,
          }
        : null;

    return {
      id: exp.id,
      group_id: exp.groupId,
      group_name: exp.groupName,
      paid_by: exp.paidBy,
      payer_name: exp.payerName,
      description: exp.description,
      category: exp.category,
      expense_date: exp.expenseDate,
      base_currency: exp.groupBaseCurrency,
      currency: exp.groupBaseCurrency,
      amount_cents: exp.amountCents,
      amount_formatted: formatMinorUnits(exp.amountCents, exp.groupBaseCurrency),
      amount_decimal: formatMinorUnitsDecimal(
        exp.amountCents,
        exp.groupBaseCurrency,
      ),
      your_share_cents: shareCents,
      your_share_formatted: formatMinorUnits(shareCents, exp.groupBaseCurrency),
      your_share_decimal: formatMinorUnitsDecimal(
        shareCents,
        exp.groupBaseCurrency,
      ),
      split_method: exp.splitMethod,
      split_breakdown: exp.splitBreakdown,
      original_amount_cents: exp.originalAmountCents ?? null,
      original_currency: origCurrency,
      exchange_rate: exp.exchangeRate ?? null,
      exchange_rate_source: exp.exchangeRateSource ?? null,
      fx_audit: fxAudit,
      receipt_url: exp.receiptUrl,
      adjustment_for_expense_id: exp.adjustmentForExpenseId,
      is_locked: exp.isLocked,
      status,
    };
  });

  const json = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      userId,
      scope: { group: rawGroup, cycle: cycleSlug },
      groups,
      expenses: jsonExpenses,
      summary: { recordCount: jsonExpenses.length },
    },
    null,
    2,
  );

  return {
    ok: true,
    scopeLabel,
    cycleSlug,
    recordCount: ledgerRecords.length,
    csv,
    json,
  };
}
