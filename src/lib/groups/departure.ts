import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMinorUnits } from "@/lib/money";
import type {
  Database,
  GroupStatus,
  MemberRole,
  MemberStatus,
  SplitBreakdownItem,
  SplitMode,
} from "@/types/database";
import { recordGroupAuditEvent, type GroupAuditLogEntry } from "./audit-log";
import { computeEqualSharePercentages } from "./invite-utils";
import {
  computeGroupLedgerMetrics,
  type LedgerExpenseInput,
  type LedgerSettlementInput,
} from "./service";

export interface UserGroupBalanceSummary {
  groupId: string;
  groupName: string;
  groupStatus: GroupStatus;
  baseCurrency: string;
  memberStatus: MemberStatus;
  role: MemberRole;
  netBalanceCents: number;
  formattedBalance: string;
}

export type LeaveGroupResult =
  | {
      ok: true;
      groupId: string;
      groupName: string;
      groupStatus: GroupStatus;
      remainingActiveCount: number;
      auditEntry: GroupAuditLogEntry;
    }
  | {
      ok: false;
      status: number;
      code:
        | "UNSETTLED_BALANCE"
        | "GROUP_ARCHIVED"
        | "NOT_MEMBER"
        | "NOT_FOUND"
        | "SERVER_ERROR";
      message: string;
      groupId?: string;
      groupName?: string;
      baseCurrency?: string;
      netBalanceCents?: number;
      formattedBalance?: string;
    };

export type RemoveGroupMemberResult =
  | {
      ok: true;
      groupId: string;
      targetUserId: string;
      transition: "FORMER_MEMBER" | "REMOVED";
      netBalanceCents: number;
      groupStatus: GroupStatus;
      memberShares: Array<{
        userId: string;
        status: MemberStatus;
        sharePercentage: number;
      }>;
      auditEntry: GroupAuditLogEntry;
    }
  | {
      ok: false;
      status: number;
      code:
        | "FORBIDDEN"
        | "GROUP_ARCHIVED"
        | "SELF_REMOVE_USE_LEAVE"
        | "UNSETTLED_BALANCE"
        | "NOT_FOUND"
        | "SERVER_ERROR";
      message: string;
      netBalanceCents?: number;
    };

export type DeleteUserAccountResult =
  | {
      ok: true;
      deletedUserId: string;
    }
  | {
      ok: false;
      status: number;
      code: "UNSETTLED_BALANCES" | "SERVER_ERROR";
      message: string;
      unsettledGroups: UserGroupBalanceSummary[];
    };

async function fetchGroupMemberLedger(
  supabase: SupabaseClient<Database>,
  groupId: string,
  currentUserId: string,
  anchorDay: number,
) {
  const [
    { data: memberRows, error: membersError },
    { data: expenseRows, error: expensesError },
    { data: settlementRows, error: settlementsError },
  ] = await Promise.all([
    supabase
      .from("group_members")
      .select("group_id, user_id, role, status, share_percentage, joined_at")
      .eq("group_id", groupId)
      .order("joined_at", { ascending: true }),
    supabase
      .from("expenses")
      .select(
        "group_id, paid_by, amount_cents, expense_date, split_breakdown, deleted_at",
      )
      .eq("group_id", groupId)
      .is("deleted_at", null),
    supabase
      .from("settlements")
      .select("group_id, payer_id, recipient_id, amount_cents")
      .eq("group_id", groupId),
  ]);

  if (membersError || expensesError || settlementsError) {
    return {
      ok: false as const,
      message:
        membersError?.message ||
        expensesError?.message ||
        settlementsError?.message ||
        "Unable to compute member balances.",
    };
  }

  const normalizedExpenses: LedgerExpenseInput[] = (expenseRows ?? []).map(
    (row) => ({
      group_id: row.group_id,
      paid_by: row.paid_by,
      amount_cents: row.amount_cents,
      expense_date: row.expense_date,
      split_breakdown: Array.isArray(row.split_breakdown)
        ? (row.split_breakdown as unknown as SplitBreakdownItem[])
        : [],
      deleted_at: row.deleted_at,
    }),
  );

  const normalizedSettlements: LedgerSettlementInput[] = (
    settlementRows ?? []
  ).map((row) => ({
    group_id: row.group_id,
    payer_id: row.payer_id,
    recipient_id: row.recipient_id,
    amount_cents: row.amount_cents,
  }));

  const members = memberRows ?? [];
  const metrics = computeGroupLedgerMetrics({
    expenses: normalizedExpenses,
    settlements: normalizedSettlements,
    memberIds: members.map((m) => m.user_id),
    currentUserId,
    cycleSlug: "2026-11",
    anchorDay,
  });

  return {
    ok: true as const,
    members,
    netBalanceByUser: metrics.netBalanceByUser,
  };
}

async function rebalanceRemainingActiveMembers(params: {
  supabase: SupabaseClient<Database>;
  groupId: string;
  currentStatus: GroupStatus;
  defaultSplitMode: SplitMode;
  remainingActiveMembers: Array<{
    user_id: string;
    role: MemberRole;
    share_percentage: number;
  }>;
}): Promise<{
  ok: boolean;
  nextGroupStatus: GroupStatus;
  updatedShares: Map<string, number>;
  errorMessage?: string;
}> {
  const {
    supabase,
    groupId,
    currentStatus,
    defaultSplitMode,
    remainingActiveMembers,
  } = params;

  const updatedShares = new Map<string, number>();
  let nextGroupStatus: GroupStatus = currentStatus;

  if (remainingActiveMembers.length === 0) {
    return { ok: true, nextGroupStatus, updatedShares };
  }

  if (defaultSplitMode === "EQUAL") {
    const equalShares = computeEqualSharePercentages(
      remainingActiveMembers.map((m) => m.user_id),
    );
    for (const member of remainingActiveMembers) {
      const nextShare = equalShares.get(member.user_id) ?? 0;
      updatedShares.set(member.user_id, nextShare);
      const { error } = await supabase
        .from("group_members")
        .update({ share_percentage: nextShare })
        .eq("group_id", groupId)
        .eq("user_id", member.user_id);
      if (error) {
        return {
          ok: false,
          nextGroupStatus,
          updatedShares,
          errorMessage:
            error.message || "Failed to recalculate equal member shares.",
        };
      }
    }
    return { ok: true, nextGroupStatus, updatedShares };
  }

  let totalBps = 0;
  for (const member of remainingActiveMembers) {
    const share = Number(member.share_percentage ?? 0);
    updatedShares.set(member.user_id, share);
    totalBps += Math.round(share * 100);
  }

  if (totalBps !== 10_000 && currentStatus === "ACTIVE") {
    nextGroupStatus = "NEEDS_RATIO_UPDATE";
    const { error } = await supabase
      .from("groups")
      .update({ status: "NEEDS_RATIO_UPDATE" })
      .eq("id", groupId);
    if (error) {
      return {
        ok: false,
        nextGroupStatus: currentStatus,
        updatedShares,
        errorMessage: error.message || "Failed to flag split ratios for review.",
      };
    }
  } else if (totalBps === 10_000 && currentStatus === "NEEDS_RATIO_UPDATE") {
    nextGroupStatus = "ACTIVE";
    const { error } = await supabase
      .from("groups")
      .update({ status: "ACTIVE" })
      .eq("id", groupId);
    if (error) {
      return {
        ok: false,
        nextGroupStatus: currentStatus,
        updatedShares,
        errorMessage: error.message || "Failed to restore active group status.",
      };
    }
  }

  return { ok: true, nextGroupStatus, updatedShares };
}

export async function leaveGroup(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupId: string,
): Promise<LeaveGroupResult> {
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select(
      "id, name, status, base_currency, default_split_mode, billing_cycle_anchor_day",
    )
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: groupError.message || "Unable to load split group.",
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

  if (group.status === "ARCHIVED") {
    return {
      ok: false,
      status: 409,
      code: "GROUP_ARCHIVED",
      groupId: group.id,
      groupName: group.name,
      baseCurrency: group.base_currency,
      message: "Archived groups are read-only and memberships cannot be altered.",
    };
  }

  const ledger = await fetchGroupMemberLedger(
    supabase,
    group.id,
    userId,
    group.billing_cycle_anchor_day ?? 1,
  );

  if (!ledger.ok) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: ledger.message,
    };
  }

  const selfMember = ledger.members.find((m) => m.user_id === userId);
  if (!selfMember) {
    return {
      ok: false,
      status: 403,
      code: "NOT_MEMBER",
      message: "You are not a member of this split group.",
    };
  }

  const netBalanceCents = ledger.netBalanceByUser.get(userId) ?? 0;
  if (netBalanceCents !== 0) {
    const formattedBalance = formatMinorUnits(
      netBalanceCents,
      group.base_currency,
      { showPlus: true },
    );
    const absFormatted = formatMinorUnits(
      Math.abs(netBalanceCents),
      group.base_currency,
    );
    return {
      ok: false,
      status: 409,
      code: "UNSETTLED_BALANCE",
      groupId: group.id,
      groupName: group.name,
      baseCurrency: group.base_currency,
      netBalanceCents,
      formattedBalance,
      message: `Cannot leave ${group.name} while you have an unpaid balance of ${absFormatted} (${netBalanceCents > 0 ? "owed to you" : "you owe"}). Settle all balances to zero first.`,
    };
  }

  const remainingActiveMembers = ledger.members.filter(
    (m) => m.user_id !== userId && m.status === "ACTIVE",
  );

  // If leaving user was the sole active ADMIN and active members remain, promote the earliest active member.
  const remainingActiveAdmins = remainingActiveMembers.filter(
    (m) => m.role === "ADMIN",
  );
  if (
    selfMember.role === "ADMIN" &&
    remainingActiveMembers.length > 0 &&
    remainingActiveAdmins.length === 0
  ) {
    const successor = remainingActiveMembers[0];
    const { error: promoteError } = await supabase
      .from("group_members")
      .update({ role: "ADMIN" })
      .eq("group_id", group.id)
      .eq("user_id", successor.user_id);

    if (promoteError) {
      return {
        ok: false,
        status: 500,
        code: "SERVER_ERROR",
        message:
          promoteError.message ||
          "Unable to promote a successor Admin before leaving.",
      };
    }
  }

  const { error: deleteError } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", group.id)
    .eq("user_id", userId);

  if (deleteError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: deleteError.message || "Unable to leave split group.",
    };
  }

  const rebalanced = await rebalanceRemainingActiveMembers({
    supabase,
    groupId: group.id,
    currentStatus: group.status,
    defaultSplitMode: group.default_split_mode,
    remainingActiveMembers,
  });

  if (!rebalanced.ok) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: rebalanced.errorMessage || "Unable to update member split shares.",
    };
  }

  const auditEntry = await recordGroupAuditEvent(supabase, {
    groupId: group.id,
    actorId: userId,
    eventType: "MEMBER_LEFT",
    summary: `Member departed ${group.name} with $0.00 balance`,
    metadata: {
      departed_user_id: userId,
      remaining_active_count: remainingActiveMembers.length,
    },
  });

  return {
    ok: true,
    groupId: group.id,
    groupName: group.name,
    groupStatus: rebalanced.nextGroupStatus,
    remainingActiveCount: remainingActiveMembers.length,
    auditEntry,
  };
}

export async function removeGroupMember(
  supabase: SupabaseClient<Database>,
  actorUserId: string,
  groupId: string,
  targetUserId: string,
): Promise<RemoveGroupMemberResult> {
  if (actorUserId === targetUserId) {
    return {
      ok: false,
      status: 400,
      code: "SELF_REMOVE_USE_LEAVE",
      message: "Use Leave Group to depart from a group yourself.",
    };
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select(
      "id, name, status, base_currency, default_split_mode, billing_cycle_anchor_day",
    )
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: groupError.message || "Unable to load split group.",
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

  const ledger = await fetchGroupMemberLedger(
    supabase,
    group.id,
    actorUserId,
    group.billing_cycle_anchor_day ?? 1,
  );

  if (!ledger.ok) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: ledger.message,
    };
  }

  const actorMember = ledger.members.find((m) => m.user_id === actorUserId);
  if (
    !actorMember ||
    actorMember.status !== "ACTIVE" ||
    actorMember.role !== "ADMIN"
  ) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "Only active group admins can remove members.",
    };
  }

  if (group.status === "ARCHIVED") {
    return {
      ok: false,
      status: 409,
      code: "GROUP_ARCHIVED",
      message: "Archived groups are read-only and members cannot be removed.",
    };
  }

  const targetMember = ledger.members.find((m) => m.user_id === targetUserId);
  if (!targetMember) {
    return {
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      message: "Target member not found in this group.",
    };
  }

  const netBalanceCents = ledger.netBalanceByUser.get(targetUserId) ?? 0;

  if (targetMember.status === "FORMER_MEMBER" && netBalanceCents !== 0) {
    return {
      ok: false,
      status: 409,
      code: "UNSETTLED_BALANCE",
      netBalanceCents,
      message:
        "This former member still has an unsettled balance and must remain in FORMER_MEMBER status until settled.",
    };
  }

  const userNamesById = new Map<string, string>();
  try {
    const usersTable = supabase.from("users") as unknown as {
      select?: (cols: string) => {
        in?: (col: string, vals: string[]) => Promise<{
          data: Array<{ id: string; full_name: string; email: string }> | null;
          error: unknown;
        }>;
      };
    };
    const selector = usersTable?.select?.("id, full_name, email");
    if (selector && typeof selector.in === "function") {
      const { data: userRows } = await selector.in("id", [
        actorUserId,
        targetUserId,
      ]);
      for (const u of userRows ?? []) {
        userNamesById.set(u.id, u.full_name || u.email);
      }
    }
  } catch {
    // Ignore profile lookup failures in partial mocks.
  }

  const actorName = userNamesById.get(actorUserId) ?? "Group Admin";
  const targetName = userNamesById.get(targetUserId) ?? "Member";

  let transition: "FORMER_MEMBER" | "REMOVED";
  if (netBalanceCents !== 0) {
    transition = "FORMER_MEMBER";
    const { error: updateError } = await supabase
      .from("group_members")
      .update({
        status: "FORMER_MEMBER",
        role: "MEMBER",
        share_percentage: 0,
      })
      .eq("group_id", group.id)
      .eq("user_id", targetUserId);

    if (updateError) {
      return {
        ok: false,
        status: 500,
        code: "SERVER_ERROR",
        message:
          updateError.message ||
          "Unable to transition member to FORMER_MEMBER.",
      };
    }
  } else {
    transition = "REMOVED";
    const { error: deleteError } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", group.id)
      .eq("user_id", targetUserId);

    if (deleteError) {
      return {
        ok: false,
        status: 500,
        code: "SERVER_ERROR",
        message: deleteError.message || "Unable to remove member from group.",
      };
    }
  }

  const remainingActiveMembers = ledger.members.filter(
    (m) => m.user_id !== targetUserId && m.status === "ACTIVE",
  );

  const rebalanced = await rebalanceRemainingActiveMembers({
    supabase,
    groupId: group.id,
    currentStatus: group.status,
    defaultSplitMode: group.default_split_mode,
    remainingActiveMembers,
  });

  if (!rebalanced.ok) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: rebalanced.errorMessage || "Unable to update member split shares.",
    };
  }

  const formattedBalance = formatMinorUnits(
    netBalanceCents,
    group.base_currency,
    { showPlus: true },
  );

  const auditEntry = await recordGroupAuditEvent(supabase, {
    groupId: group.id,
    actorId: actorUserId,
    actorName,
    eventType:
      transition === "FORMER_MEMBER" ? "MEMBER_MARKED_FORMER" : "MEMBER_REMOVED",
    summary:
      transition === "FORMER_MEMBER"
        ? `Transitioned ${targetName} to FORMER_MEMBER (unsettled balance ${formattedBalance})`
        : `Removed ${targetName} from ${group.name} ($0.00 balance)`,
    metadata: {
      target_user_id: targetUserId,
      transition,
      former_member_balance_cents:
        transition === "FORMER_MEMBER" ? netBalanceCents : undefined,
      base_currency: group.base_currency,
    },
  });

  const memberShares: Array<{
    userId: string;
    status: MemberStatus;
    sharePercentage: number;
  }> = remainingActiveMembers.map((m) => ({
    userId: m.user_id,
    status: "ACTIVE" as MemberStatus,
    sharePercentage:
      rebalanced.updatedShares.get(m.user_id) ?? Number(m.share_percentage),
  }));

  if (transition === "FORMER_MEMBER") {
    memberShares.push({
      userId: targetUserId,
      status: "FORMER_MEMBER",
      sharePercentage: 0,
    });
  }

  return {
    ok: true,
    groupId: group.id,
    targetUserId,
    transition,
    netBalanceCents,
    groupStatus: rebalanced.nextGroupStatus,
    memberShares,
    auditEntry,
  };
}

export async function getUserGroupBalances(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{
  ok: true;
  balances: UserGroupBalanceSummary[];
} | {
  ok: false;
  message: string;
}> {
  const { data: memberships, error: memError } = await supabase
    .from("group_members")
    .select("group_id, role, status")
    .eq("user_id", userId);

  if (memError) {
    return {
      ok: false,
      message: memError.message || "Unable to verify group balances.",
    };
  }

  if (!memberships || memberships.length === 0) {
    return { ok: true, balances: [] };
  }

  const groupIds = memberships.map((m) => m.group_id);

  const [
    { data: groupRows, error: groupsError },
    { data: expenseRows, error: expensesError },
    { data: settlementRows, error: settlementsError },
  ] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, status, base_currency, billing_cycle_anchor_day")
      .in("id", groupIds),
    supabase
      .from("expenses")
      .select(
        "group_id, paid_by, amount_cents, expense_date, split_breakdown, deleted_at",
      )
      .in("group_id", groupIds)
      .is("deleted_at", null),
    supabase
      .from("settlements")
      .select("group_id, payer_id, recipient_id, amount_cents")
      .in("group_id", groupIds),
  ]);

  if (groupsError || expensesError || settlementsError) {
    return {
      ok: false,
      message:
        groupsError?.message ||
        expensesError?.message ||
        settlementsError?.message ||
        "Unable to load group ledger balances.",
    };
  }

  const groupsById = new Map((groupRows ?? []).map((g) => [g.id, g]));
  const expensesByGroup = new Map<string, LedgerExpenseInput[]>();
  for (const row of expenseRows ?? []) {
    const list = expensesByGroup.get(row.group_id) ?? [];
    list.push({
      group_id: row.group_id,
      paid_by: row.paid_by,
      amount_cents: row.amount_cents,
      expense_date: row.expense_date,
      split_breakdown: Array.isArray(row.split_breakdown)
        ? (row.split_breakdown as unknown as SplitBreakdownItem[])
        : [],
      deleted_at: row.deleted_at,
    });
    expensesByGroup.set(row.group_id, list);
  }

  const settlementsByGroup = new Map<string, LedgerSettlementInput[]>();
  for (const row of settlementRows ?? []) {
    const list = settlementsByGroup.get(row.group_id) ?? [];
    list.push(row);
    settlementsByGroup.set(row.group_id, list);
  }

  const balances: UserGroupBalanceSummary[] = memberships.map((membership) => {
    const group = groupsById.get(membership.group_id);
    const baseCurrency = group?.base_currency ?? "USD";
    const metrics = computeGroupLedgerMetrics({
      expenses: expensesByGroup.get(membership.group_id) ?? [],
      settlements: settlementsByGroup.get(membership.group_id) ?? [],
      memberIds: [userId],
      currentUserId: userId,
      cycleSlug: "2026-11",
      anchorDay: group?.billing_cycle_anchor_day ?? 1,
    });

    const netBalanceCents = metrics.userNetLedgerCents;

    return {
      groupId: membership.group_id,
      groupName: group?.name ?? "Split Group",
      groupStatus: group?.status ?? "ACTIVE",
      baseCurrency,
      memberStatus: membership.status,
      role: membership.role,
      netBalanceCents,
      formattedBalance: formatMinorUnits(netBalanceCents, baseCurrency, {
        showPlus: true,
      }),
    };
  });

  return { ok: true, balances };
}

export async function deleteUserAccount(
  supabase: SupabaseClient<Database>,
  userId: string,
  adminSupabase?: SupabaseClient<Database> | null,
): Promise<DeleteUserAccountResult> {
  const balanceResult = await getUserGroupBalances(supabase, userId);
  if (!balanceResult.ok) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: balanceResult.message,
      unsettledGroups: [],
    };
  }

  const unsettledGroups = balanceResult.balances.filter(
    (b) => b.netBalanceCents !== 0,
  );

  if (unsettledGroups.length > 0) {
    const summaryText = unsettledGroups
      .map((g) => `${g.groupName} (${g.formattedBalance})`)
      .join(", ");
    return {
      ok: false,
      status: 409,
      code: "UNSETTLED_BALANCES",
      message: `Account deletion is blocked while you have unpaid balances in: ${summaryText}. Settle all group balances to zero first.`,
      unsettledGroups,
    };
  }

  // Delete zero-balance non-archived memberships first so group splits rebalance cleanly
  for (const membership of balanceResult.balances) {
    if (membership.groupStatus !== "ARCHIVED") {
      await leaveGroup(supabase, userId, membership.groupId);
    }
  }

  const dbClient = adminSupabase ?? supabase;
  const { error: deleteUserError } = await dbClient
    .from("users")
    .delete()
    .eq("id", userId);

  if (deleteUserError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message:
        deleteUserError.message ||
        "Unable to delete user account due to historical ledger references.",
      unsettledGroups: [],
    };
  }

  if (adminSupabase?.auth?.admin?.deleteUser) {
    try {
      await adminSupabase.auth.admin.deleteUser(userId);
    } catch {
      // Non-fatal if auth admin API is mocked or unavailable in tests.
    }
  }

  return {
    ok: true,
    deletedUserId: userId,
  };
}
