import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeInitialNextRunDate,
  isValidIsoDateString,
} from "@/lib/expenses/recurring";
import {
  convertForeignAmountToBaseMinorUnits,
  validateSplitBreakdown,
} from "@/lib/expenses/split-engine";
import { isValidCurrencyCode } from "@/lib/money";
import type {
  Database,
  ExchangeRateSource,
  ExpenseSplitMethod,
  GroupStatus,
  MemberRole,
  MemberStatus,
  PaymentRail,
  RecurringFrequency,
  SplitBreakdownItem,
  SplitMode,
} from "@/types/database";
import { buildDefaultSplitExcludingFormerMembers } from "./invite-utils";

export type LedgerWriteOperation =
  | "EXPENSE_CREATE"
  | "EXPENSE_UPDATE"
  | "EXPENSE_DELETE"
  | "SETTLEMENT_CREATE"
  | "RECURRING_RULE_CREATE"
  | "RECURRING_RULE_UPDATE"
  | "RECURRING_RULE_DELETE";

export type LedgerWriteGuardResult =
  | {
      ok: true;
      group: {
        id: string;
        status: GroupStatus;
        base_currency: string;
        default_split_mode: SplitMode;
      };
      member: {
        role: MemberRole;
        status: MemberStatus;
      };
    }
  | {
      ok: false;
      status: number;
      code:
        | "NOT_FOUND"
        | "NOT_MEMBER"
        | "GROUP_ARCHIVED"
        | "FORMER_MEMBER_RESTRICTED"
        | "FORBIDDEN"
        | "SERVER_ERROR";
      message: string;
    };

export async function assertGroupWritableForLedger(
  supabase: SupabaseClient<Database>,
  params: {
    groupId: string;
    userId: string;
    operation: LedgerWriteOperation;
  },
): Promise<LedgerWriteGuardResult> {
  const { groupId, userId, operation } = params;

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id, status, base_currency, default_split_mode")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: groupError.message || "Unable to verify group status.",
    };
  }

  if (!group) {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: "Split group not found.",
    };
  }

  const { data: member, error: memberError } = await supabase
    .from("group_members")
    .select("role, status")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: memberError.message || "Unable to verify group membership.",
    };
  }

  if (!member) {
    return {
      ok: false,
      status: 403,
      code: "NOT_MEMBER",
      message: "You are not a member of this split group.",
    };
  }

  if (group.status === "ARCHIVED") {
    return {
      ok: false,
      status: 409,
      code: "GROUP_ARCHIVED",
      message:
        "This group is ARCHIVED and strictly read-only. Expenses, settlements, and recurring rules cannot be created or modified.",
    };
  }

  if (member.status === "FORMER_MEMBER") {
    if (operation !== "SETTLEMENT_CREATE") {
      return {
        ok: false,
        status: 403,
        code: "FORMER_MEMBER_RESTRICTED",
        message:
          "Former members are excluded from new expenses and recurring rules and can only record settlements.",
      };
    }
  }

  if (
    (operation === "RECURRING_RULE_CREATE" ||
      operation === "RECURRING_RULE_UPDATE" ||
      operation === "RECURRING_RULE_DELETE") &&
    member.status !== "ACTIVE"
  ) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "Only active group members can manage recurring rules.",
    };
  }

  return {
    ok: true,
    group: {
      id: group.id,
      status: group.status,
      base_currency: group.base_currency,
      default_split_mode: group.default_split_mode,
    },
    member: {
      role: member.role,
      status: member.status,
    },
  };
}

export async function createGroupExpense(
  supabase: SupabaseClient<Database>,
  params: {
    groupId: string;
    userId: string;
    paidBy?: string;
    description: string;
    category: string;
    amountCents: number;
    expenseDate?: string;
    splitMethod?: ExpenseSplitMethod;
    splitBreakdown?: SplitBreakdownItem[];
    originalAmountCents?: number | null;
    originalCurrency?: string | null;
    exchangeRate?: number | null;
    exchangeRateSource?: ExchangeRateSource | null;
    receiptUrl?: string | null;
  },
): Promise<
  | { ok: true; expense: Database["public"]["Tables"]["expenses"]["Row"] }
  | { ok: false; status: number; code: string; message: string }
> {
  const guard = await assertGroupWritableForLedger(supabase, {
    groupId: params.groupId,
    userId: params.userId,
    operation: "EXPENSE_CREATE",
  });
  if (!guard.ok) return guard;

  const trimmedDescription = params.description.trim();
  if (!trimmedDescription) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_DESCRIPTION",
      message: "Expense description is required.",
    };
  }
  if (trimmedDescription.length > 200) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_DESCRIPTION",
      message: "Expense description must be 200 characters or fewer.",
    };
  }

  const amountCents = Math.trunc(params.amountCents);
  if (
    !Number.isSafeInteger(params.amountCents) ||
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_AMOUNT",
      message: "Expense amount_cents must be a positive integer in minor units.",
    };
  }

  if (
    params.splitMethod !== undefined &&
    params.splitMethod !== "EQUAL" &&
    params.splitMethod !== "PERCENTAGE" &&
    params.splitMethod !== "EXACT"
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_SPLIT_METHOD",
      message: "Split method must be EQUAL, PERCENTAGE, or EXACT.",
    };
  }

  // Validate FX audit completeness when foreign currency is provided
  const hasAnyFxField =
    params.originalAmountCents != null ||
    (params.originalCurrency != null && params.originalCurrency.trim() !== "") ||
    params.exchangeRate != null ||
    params.exchangeRateSource != null;

  let originalAmountCents: number | null = null;
  let originalCurrency: string | null = null;
  let exchangeRate: number | null = null;
  let exchangeRateSource: ExchangeRateSource | null = null;

  if (hasAnyFxField) {
    const rawOrigCur =
      typeof params.originalCurrency === "string"
        ? params.originalCurrency.trim().toUpperCase()
        : "";
    if (rawOrigCur && rawOrigCur === guard.group.base_currency) {
      if (
        params.originalAmountCents != null &&
        params.originalAmountCents !== amountCents
      ) {
        return {
          ok: false,
          status: 400,
          code: "FX_CONVERSION_MISMATCH",
          message: `Expense amount_cents (${amountCents}) must match original_amount_cents (${params.originalAmountCents}) when currency equals ${guard.group.base_currency}.`,
        };
      }
      // Base currency matches group base currency; clear redundant FX audit fields.
      originalAmountCents = null;
      originalCurrency = null;
      exchangeRate = null;
      exchangeRateSource = null;
    } else {
      if (
        !isValidCurrencyCode(rawOrigCur) ||
        typeof params.originalAmountCents !== "number" ||
        !Number.isSafeInteger(params.originalAmountCents) ||
        params.originalAmountCents <= 0 ||
        typeof params.exchangeRate !== "number" ||
        !Number.isFinite(params.exchangeRate) ||
        params.exchangeRate <= 0 ||
        params.exchangeRate >= 1_000_000 ||
        (params.exchangeRateSource !== "API" &&
          params.exchangeRateSource !== "MANUAL_OVERRIDE")
      ) {
        return {
          ok: false,
          status: 400,
          code: "INVALID_FX_AUDIT",
          message:
            "Foreign-currency expenses require original_amount_cents, original_currency, positive exchange_rate (< 1,000,000), and exchange_rate_source.",
        };
      }

      const normalizedRate = Number(params.exchangeRate.toFixed(6));
      if (!Number.isFinite(normalizedRate) || normalizedRate <= 0) {
        return {
          ok: false,
          status: 400,
          code: "INVALID_FX_AUDIT",
          message: "Exchange rate must remain positive at 6 decimal places.",
        };
      }

      const expectedAmountCents = convertForeignAmountToBaseMinorUnits({
        originalAmountCents: params.originalAmountCents,
        originalCurrency: rawOrigCur,
        exchangeRate: normalizedRate,
        baseCurrency: guard.group.base_currency,
      });

      if (expectedAmountCents === null) {
        return {
          ok: false,
          status: 400,
          code: "INVALID_FX_AUDIT",
          message:
            "Unable to convert original_amount_cents to group base_currency with the supplied exchange_rate.",
        };
      }

      if (expectedAmountCents !== amountCents) {
        return {
          ok: false,
          status: 400,
          code: "FX_CONVERSION_MISMATCH",
          message: `Converted amount_cents (${amountCents}) does not match ${params.originalAmountCents} ${rawOrigCur} at rate ${normalizedRate} (${expectedAmountCents} ${guard.group.base_currency}).`,
        };
      }

      originalAmountCents = params.originalAmountCents;
      originalCurrency = rawOrigCur;
      exchangeRate = normalizedRate;
      exchangeRateSource = params.exchangeRateSource;
    }
  }

  const paidBy = params.paidBy ?? params.userId;

  const { data: memberRows, error: membersError } = await supabase
    .from("group_members")
    .select("user_id, status, share_percentage, joined_at")
    .eq("group_id", params.groupId)
    .order("joined_at", { ascending: true });

  if (membersError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: membersError.message || "Unable to load group members.",
    };
  }

  const allMembers = (memberRows ?? []).map((m) => ({
    userId: m.user_id,
    status: m.status,
    sharePercentage: Number(m.share_percentage ?? 0),
  }));

  const payerMember = allMembers.find((m) => m.userId === paidBy);
  if (!payerMember || payerMember.status !== "ACTIVE") {
    return {
      ok: false,
      status: 400,
      code: "INVALID_PAYER",
      message: "Expense payer must be an active member of the group.",
    };
  }

  const activeIds = allMembers
    .filter((m) => m.status === "ACTIVE")
    .map((m) => m.userId);

  const splitMethod: ExpenseSplitMethod =
    params.splitMethod ??
    (guard.group.default_split_mode === "CUSTOM_RATIOS"
      ? "PERCENTAGE"
      : "EQUAL");

  let splitBreakdown: SplitBreakdownItem[];
  if (!params.splitBreakdown || params.splitBreakdown.length === 0) {
    splitBreakdown = buildDefaultSplitExcludingFormerMembers({
      amountCents,
      paidBy,
      defaultSplitMode: guard.group.default_split_mode,
      members: allMembers,
    });
  } else {
    const splitValidation = validateSplitBreakdown({
      amountCents,
      splitMethod,
      splitBreakdown: params.splitBreakdown,
      activeMemberIds: activeIds,
    });
    if (!splitValidation.ok) {
      return {
        ok: false,
        status: 400,
        code: splitValidation.code,
        message: splitValidation.message,
      };
    }
    splitBreakdown = splitValidation.breakdown;
  }

  const finalSumCents = splitBreakdown.reduce(
    (sum, item) => sum + Math.trunc(item.share_cents),
    0,
  );
  if (finalSumCents !== amountCents) {
    return {
      ok: false,
      status: 400,
      code: "SPLIT_SUM_MISMATCH",
      message: `Split breakdown (${finalSumCents}) must equal amount_cents (${amountCents}).`,
    };
  }

  let expenseDateIso = new Date().toISOString();
  if (params.expenseDate) {
    const parsedDate = Date.parse(params.expenseDate);
    if (Number.isNaN(parsedDate)) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_DATE",
        message: "Expense date must be a valid ISO date.",
      };
    }
    expenseDateIso = new Date(parsedDate).toISOString();
  }

  const receiptUrl =
    typeof params.receiptUrl === "string" && params.receiptUrl.trim()
      ? params.receiptUrl.trim()
      : null;

  const { data: inserted, error: insertError } = await supabase
    .from("expenses")
    .insert({
      group_id: params.groupId,
      created_by: params.userId,
      paid_by: paidBy,
      description: trimmedDescription,
      category: params.category.trim() || "General",
      expense_date: expenseDateIso,
      amount_cents: amountCents,
      currency: guard.group.base_currency,
      original_amount_cents: originalAmountCents,
      original_currency: originalCurrency,
      exchange_rate: exchangeRate,
      exchange_rate_source: exchangeRateSource,
      split_method: splitMethod,
      split_breakdown: splitBreakdown,
      receipt_url: receiptUrl,
    })
    .select("*")
    .maybeSingle();

  if (insertError || !inserted) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: insertError?.message || "Failed to log expense.",
    };
  }

  return { ok: true, expense: inserted };
}

export async function createGroupSettlement(
  supabase: SupabaseClient<Database>,
  params: {
    groupId: string;
    userId: string;
    payerId: string;
    recipientId: string;
    amountCents: number;
    paymentRail?: PaymentRail;
  },
): Promise<
  | { ok: true; settlement: Database["public"]["Tables"]["settlements"]["Row"] }
  | { ok: false; status: number; code: string; message: string }
> {
  const guard = await assertGroupWritableForLedger(supabase, {
    groupId: params.groupId,
    userId: params.userId,
    operation: "SETTLEMENT_CREATE",
  });
  if (!guard.ok) return guard;

  const amountCents = Math.trunc(params.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_AMOUNT",
      message: "Settlement amount_cents must be a positive integer.",
    };
  }

  if (params.payerId === params.recipientId) {
    return {
      ok: false,
      status: 400,
      code: "SAME_PARTY",
      message: "Settlement payer and recipient must be different users.",
    };
  }

  if (
    guard.member.status === "FORMER_MEMBER" &&
    params.payerId !== params.userId &&
    params.recipientId !== params.userId
  ) {
    return {
      ok: false,
      status: 403,
      code: "FORMER_MEMBER_RESTRICTED",
      message:
        "Former members can only record settlements in which they are payer or recipient.",
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("settlements")
    .insert({
      group_id: params.groupId,
      payer_id: params.payerId,
      recipient_id: params.recipientId,
      amount_cents: amountCents,
      currency: guard.group.base_currency,
      payment_rail: params.paymentRail ?? "OTHER",
    })
    .select("*")
    .maybeSingle();

  if (insertError || !inserted) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: insertError?.message || "Failed to record settlement.",
    };
  }

  return { ok: true, settlement: inserted };
}

export async function createGroupRecurringRule(
  supabase: SupabaseClient<Database>,
  params: {
    groupId: string;
    userId: string;
    paidBy?: string;
    description: string;
    category: string;
    amountCents: number;
    frequency?: RecurringFrequency;
    dayOfMonth: number;
    splitRule?: SplitMode;
    nextRunDate?: string;
  },
): Promise<
  | {
      ok: true;
      rule: Database["public"]["Tables"]["recurring_rules"]["Row"];
    }
  | { ok: false; status: number; code: string; message: string }
> {
  const guard = await assertGroupWritableForLedger(supabase, {
    groupId: params.groupId,
    userId: params.userId,
    operation: "RECURRING_RULE_CREATE",
  });
  if (!guard.ok) return guard;

  const trimmedDescription = params.description.trim();
  if (!trimmedDescription) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_DESCRIPTION",
      message: "Recurring rule description is required.",
    };
  }
  if (trimmedDescription.length > 200) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_DESCRIPTION",
      message: "Recurring rule description must be 200 characters or fewer.",
    };
  }

  const amountCents = Math.trunc(params.amountCents);
  if (
    !Number.isSafeInteger(params.amountCents) ||
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_AMOUNT",
      message: "Recurring rule amount_cents must be a positive integer.",
    };
  }

  const frequency = params.frequency ?? "MONTHLY";
  if (frequency !== "MONTHLY") {
    return {
      ok: false,
      status: 400,
      code: "INVALID_FREQUENCY",
      message: "Recurring rule frequency must be MONTHLY.",
    };
  }

  const dayOfMonth = Math.trunc(params.dayOfMonth);
  if (
    !Number.isInteger(params.dayOfMonth) ||
    dayOfMonth < 1 ||
    dayOfMonth > 28
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_DAY_OF_MONTH",
      message: "Recurring rule day_of_month must be an integer between 1 and 28.",
    };
  }

  const splitRule = params.splitRule ?? guard.group.default_split_mode;
  if (splitRule !== "EQUAL" && splitRule !== "CUSTOM_RATIOS") {
    return {
      ok: false,
      status: 400,
      code: "INVALID_SPLIT_RULE",
      message: "Recurring rule split_rule must be EQUAL or CUSTOM_RATIOS.",
    };
  }

  const nextRunDate = params.nextRunDate?.trim()
    ? params.nextRunDate.trim()
    : computeInitialNextRunDate(dayOfMonth);
  if (!isValidIsoDateString(nextRunDate)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_DATE",
      message: "Recurring rule next_run_date must be a valid YYYY-MM-DD date.",
    };
  }

  const paidBy = params.paidBy ?? params.userId;
  const { data: payerMember } = await supabase
    .from("group_members")
    .select("status")
    .eq("group_id", params.groupId)
    .eq("user_id", paidBy)
    .maybeSingle();

  if (!payerMember || payerMember.status !== "ACTIVE") {
    return {
      ok: false,
      status: 400,
      code: "INVALID_PAYER",
      message: "Recurring rule payer must be an active group member.",
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("recurring_rules")
    .insert({
      group_id: params.groupId,
      created_by: params.userId,
      paid_by: paidBy,
      description: trimmedDescription,
      category: params.category.trim() || "General",
      amount_cents: amountCents,
      currency: guard.group.base_currency,
      frequency,
      day_of_month: dayOfMonth,
      split_rule: splitRule,
      is_active: true,
      next_run_date: nextRunDate,
    })
    .select("*")
    .maybeSingle();

  if (insertError || !inserted) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: insertError?.message || "Failed to create recurring rule.",
    };
  }

  return { ok: true, rule: inserted };
}

export async function updateGroupRecurringRule(
  supabase: SupabaseClient<Database>,
  params: {
    groupId: string;
    userId: string;
    ruleId: string;
    isActive?: boolean;
    amountCents?: number;
    description?: string;
    category?: string;
    frequency?: RecurringFrequency;
    dayOfMonth?: number;
    splitRule?: SplitMode;
    paidBy?: string;
    nextRunDate?: string;
  },
): Promise<
  | {
      ok: true;
      rule: Database["public"]["Tables"]["recurring_rules"]["Row"];
    }
  | { ok: false; status: number; code: string; message: string }
> {
  const guard = await assertGroupWritableForLedger(supabase, {
    groupId: params.groupId,
    userId: params.userId,
    operation: "RECURRING_RULE_UPDATE",
  });
  if (!guard.ok) return guard;

  const { data: existingRule, error: fetchError } = await supabase
    .from("recurring_rules")
    .select("id, group_id, created_by, paid_by")
    .eq("id", params.ruleId)
    .eq("group_id", params.groupId)
    .maybeSingle();

  if (fetchError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: fetchError.message || "Unable to load recurring rule.",
    };
  }

  if (!existingRule) {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: "Recurring rule not found.",
    };
  }

  const ruleOwnerId = existingRule.created_by ?? existingRule.paid_by;
  if (guard.member.role !== "ADMIN" && ruleOwnerId !== params.userId) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "Only group admins or the rule creator can update this recurring rule.",
    };
  }

  const patch: Database["public"]["Tables"]["recurring_rules"]["Update"] = {};
  if (typeof params.isActive === "boolean") patch.is_active = params.isActive;
  if (typeof params.amountCents === "number") {
    const amt = Math.trunc(params.amountCents);
    if (!Number.isSafeInteger(params.amountCents) || !Number.isSafeInteger(amt) || amt <= 0) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_AMOUNT",
        message: "Recurring rule amount_cents must be positive.",
      };
    }
    patch.amount_cents = amt;
  }
  if (typeof params.description === "string") {
    const trimmed = params.description.trim();
    if (!trimmed || trimmed.length > 200) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_DESCRIPTION",
        message: "Recurring rule description must be 1 to 200 characters.",
      };
    }
    patch.description = trimmed;
  }
  if (typeof params.category === "string" && params.category.trim()) {
    patch.category = params.category.trim();
  }
  if (params.frequency !== undefined) {
    if (params.frequency !== "MONTHLY") {
      return {
        ok: false,
        status: 400,
        code: "INVALID_FREQUENCY",
        message: "Recurring rule frequency must be MONTHLY.",
      };
    }
    patch.frequency = params.frequency;
  }
  if (params.dayOfMonth !== undefined) {
    const day = Math.trunc(params.dayOfMonth);
    if (!Number.isInteger(params.dayOfMonth) || day < 1 || day > 28) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_DAY_OF_MONTH",
        message: "Recurring rule day_of_month must be between 1 and 28.",
      };
    }
    patch.day_of_month = day;
  }
  if (params.splitRule !== undefined) {
    if (params.splitRule !== "EQUAL" && params.splitRule !== "CUSTOM_RATIOS") {
      return {
        ok: false,
        status: 400,
        code: "INVALID_SPLIT_RULE",
        message: "Recurring rule split_rule must be EQUAL or CUSTOM_RATIOS.",
      };
    }
    patch.split_rule = params.splitRule;
  }
  if (typeof params.paidBy === "string" && params.paidBy.trim()) {
    const { data: payerMember } = await supabase
      .from("group_members")
      .select("status")
      .eq("group_id", params.groupId)
      .eq("user_id", params.paidBy.trim())
      .maybeSingle();
    if (!payerMember || payerMember.status !== "ACTIVE") {
      return {
        ok: false,
        status: 400,
        code: "INVALID_PAYER",
        message: "Recurring rule payer must be an active group member.",
      };
    }
    patch.paid_by = params.paidBy.trim();
  }
  if (typeof params.nextRunDate === "string") {
    const trimmedDate = params.nextRunDate.trim();
    if (!isValidIsoDateString(trimmedDate)) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_DATE",
        message: "Recurring rule next_run_date must be a valid YYYY-MM-DD date.",
      };
    }
    patch.next_run_date = trimmedDate;
  }

  const { data: updated, error: updateError } = await supabase
    .from("recurring_rules")
    .update(patch)
    .eq("id", params.ruleId)
    .eq("group_id", params.groupId)
    .select("*")
    .maybeSingle();

  if (updateError || !updated) {
    return {
      ok: false,
      status: updateError ? 500 : 404,
      code: updateError ? "SERVER_ERROR" : "NOT_FOUND",
      message: updateError?.message || "Recurring rule not found.",
    };
  }

  return { ok: true, rule: updated };
}

export async function deleteGroupRecurringRule(
  supabase: SupabaseClient<Database>,
  params: {
    groupId: string;
    userId: string;
    ruleId: string;
  },
): Promise<
  | { ok: true; ruleId: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const guard = await assertGroupWritableForLedger(supabase, {
    groupId: params.groupId,
    userId: params.userId,
    operation: "RECURRING_RULE_DELETE",
  });
  if (!guard.ok) return guard;

  const { data: existingRule, error: fetchError } = await supabase
    .from("recurring_rules")
    .select("id, group_id, created_by, paid_by")
    .eq("id", params.ruleId)
    .eq("group_id", params.groupId)
    .maybeSingle();

  if (fetchError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: fetchError.message || "Unable to load recurring rule.",
    };
  }

  if (!existingRule) {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: "Recurring rule not found.",
    };
  }

  const ruleOwnerId = existingRule.created_by ?? existingRule.paid_by;
  if (guard.member.role !== "ADMIN" && ruleOwnerId !== params.userId) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "Only group admins or the rule creator can delete this recurring rule.",
    };
  }

  const { error: deleteError } = await supabase
    .from("recurring_rules")
    .delete()
    .eq("id", params.ruleId)
    .eq("group_id", params.groupId);

  if (deleteError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: deleteError.message || "Failed to delete recurring rule.",
    };
  }

  return { ok: true, ruleId: params.ruleId };
}
