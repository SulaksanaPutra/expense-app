import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  ExpenseSplitMethod,
  GroupStatus,
  MemberRole,
  MemberStatus,
  PaymentRail,
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
    (member.status !== "ACTIVE" || member.role !== "ADMIN")
  ) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "Only active group admins can manage recurring rules.",
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

  const amountCents = Math.trunc(params.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents === 0) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_AMOUNT",
      message: "Expense amount_cents must be a non-zero integer.",
    };
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

  let splitBreakdown = params.splitBreakdown;
  if (!splitBreakdown || splitBreakdown.length === 0) {
    splitBreakdown = buildDefaultSplitExcludingFormerMembers({
      amountCents,
      paidBy,
      defaultSplitMode: guard.group.default_split_mode,
      members: allMembers,
    });
  } else {
    const activeIds = new Set(
      allMembers.filter((m) => m.status === "ACTIVE").map((m) => m.userId),
    );
    for (const part of splitBreakdown) {
      if (!activeIds.has(part.user_id)) {
        return {
          ok: false,
          status: 400,
          code: "INVALID_SPLIT_PARTICIPANT",
          message:
            "Former or non-group members cannot be included in new expense splits.",
        };
      }
    }
  }

  const sumCents = splitBreakdown.reduce(
    (sum, item) => sum + Math.trunc(item.share_cents),
    0,
  );
  if (sumCents !== amountCents) {
    return {
      ok: false,
      status: 400,
      code: "SPLIT_SUM_MISMATCH",
      message: `Split breakdown (${sumCents}) must equal amount_cents (${amountCents}).`,
    };
  }

  const splitMethod: ExpenseSplitMethod =
    params.splitMethod ??
    (guard.group.default_split_mode === "CUSTOM_RATIOS"
      ? "PERCENTAGE"
      : "EQUAL");

  const { data: inserted, error: insertError } = await supabase
    .from("expenses")
    .insert({
      group_id: params.groupId,
      created_by: params.userId,
      paid_by: paidBy,
      description: params.description.trim(),
      category: params.category.trim() || "General",
      expense_date: params.expenseDate ?? new Date().toISOString(),
      amount_cents: amountCents,
      currency: guard.group.base_currency,
      split_method: splitMethod,
      split_breakdown: splitBreakdown,
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
    dayOfMonth: number;
    splitRule?: SplitMode;
    nextRunDate: string;
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

  const amountCents = Math.trunc(params.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_AMOUNT",
      message: "Recurring rule amount_cents must be a positive integer.",
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
      paid_by: paidBy,
      description: params.description.trim(),
      category: params.category.trim() || "General",
      amount_cents: amountCents,
      currency: guard.group.base_currency,
      frequency: "MONTHLY",
      day_of_month: Math.min(Math.max(Math.trunc(params.dayOfMonth), 1), 28),
      split_rule: params.splitRule ?? guard.group.default_split_mode,
      is_active: true,
      next_run_date: params.nextRunDate,
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

  const patch: Database["public"]["Tables"]["recurring_rules"]["Update"] = {};
  if (typeof params.isActive === "boolean") patch.is_active = params.isActive;
  if (typeof params.amountCents === "number") {
    const amt = Math.trunc(params.amountCents);
    if (!Number.isSafeInteger(amt) || amt <= 0) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_AMOUNT",
        message: "Recurring rule amount_cents must be positive.",
      };
    }
    patch.amount_cents = amt;
  }
  if (typeof params.description === "string" && params.description.trim()) {
    patch.description = params.description.trim();
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
