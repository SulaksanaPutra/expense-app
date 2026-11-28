import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  GroupStatus,
  GroupType,
  SplitBreakdownItem,
} from "@/types/database";
import { recordGroupAuditEvent, type GroupAuditLogEntry } from "./audit-log";
import {
  computeGroupLedgerMetrics,
  isValidIsoDate,
  type LedgerExpenseInput,
  type LedgerSettlementInput,
} from "./service";

const MS_PER_DAY = 86_400_000;
export const DEFAULT_TRIP_AUTO_ARCHIVE_DAYS = 14;
export const RESIDENTIAL_LEASE_PROMPT_DELAY_DAYS = 7;

export interface TripArchiveEvaluationInput {
  groupType: GroupType;
  status: GroupStatus;
  tripAutoArchiveEnabled: boolean;
  tripAutoArchiveDays: number;
  isFullySettled: boolean;
  zeroBalanceSince: string | null;
}

export interface TripArchiveEvaluationResult {
  shouldAutoArchive: boolean;
  nextZeroBalanceSince: string | null;
  daysAtZeroBalance: number;
}

export function evaluateTripAutoArchive(
  input: TripArchiveEvaluationInput,
  now = new Date(),
): TripArchiveEvaluationResult {
  if (input.groupType !== "TRIP" || input.status === "ARCHIVED") {
    return {
      shouldAutoArchive: false,
      nextZeroBalanceSince: input.zeroBalanceSince,
      daysAtZeroBalance: 0,
    };
  }

  if (!input.isFullySettled) {
    return {
      shouldAutoArchive: false,
      nextZeroBalanceSince: null,
      daysAtZeroBalance: 0,
    };
  }

  const nowIso = now.toISOString();
  const effectiveSince = input.zeroBalanceSince ?? nowIso;
  const sinceMs = Date.parse(effectiveSince);
  const daysAtZeroBalance = Number.isFinite(sinceMs)
    ? Math.max(0, Math.floor((now.getTime() - sinceMs) / MS_PER_DAY))
    : 0;

  const thresholdDays = Math.max(
    1,
    Math.trunc(input.tripAutoArchiveDays || DEFAULT_TRIP_AUTO_ARCHIVE_DAYS),
  );

  const shouldAutoArchive =
    input.tripAutoArchiveEnabled && daysAtZeroBalance >= thresholdDays;

  return {
    shouldAutoArchive,
    nextZeroBalanceSince: effectiveSince,
    daysAtZeroBalance,
  };
}

export interface ResidentialLeasePromptInput {
  groupType: GroupType;
  status: GroupStatus;
  residentialLeasePromptEnabled: boolean;
  leaseEndDate: string | null;
  leasePromptSnoozedUntil: string | null;
}

export interface ResidentialLeasePromptResult {
  shouldPromptLeaseArchive: boolean;
  daysSinceLeaseEnd: number | null;
}

export function evaluateResidentialLeasePrompt(
  input: ResidentialLeasePromptInput,
  now = new Date(),
): ResidentialLeasePromptResult {
  if (
    input.groupType !== "RESIDENTIAL" ||
    input.status === "ARCHIVED" ||
    !input.residentialLeasePromptEnabled ||
    !input.leaseEndDate ||
    !isValidIsoDate(input.leaseEndDate)
  ) {
    return {
      shouldPromptLeaseArchive: false,
      daysSinceLeaseEnd: null,
    };
  }

  const [year, month, day] = input.leaseEndDate
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  const leaseEndMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const nowMs = now.getTime();
  const daysSinceLeaseEnd = Math.floor((nowMs - leaseEndMs) / MS_PER_DAY);

  if (daysSinceLeaseEnd < RESIDENTIAL_LEASE_PROMPT_DELAY_DAYS) {
    return {
      shouldPromptLeaseArchive: false,
      daysSinceLeaseEnd,
    };
  }

  if (input.leasePromptSnoozedUntil) {
    const snoozedMs = Date.parse(input.leasePromptSnoozedUntil);
    if (Number.isFinite(snoozedMs) && nowMs < snoozedMs) {
      return {
        shouldPromptLeaseArchive: false,
        daysSinceLeaseEnd,
      };
    }
  }

  return {
    shouldPromptLeaseArchive: true,
    daysSinceLeaseEnd,
  };
}

export type ArchiveMutationResult =
  | {
      ok: true;
      groupId: string;
      status: GroupStatus;
      tripAutoArchiveEnabled: boolean;
      tripAutoArchiveDays: number;
      residentialLeasePromptEnabled: boolean;
      leaseEndDate: string | null;
      leasePromptSnoozedUntil: string | null;
      archivedAt: string | null;
      auditEntry?: GroupAuditLogEntry;
    }
  | { ok: false; status: number; message: string };

async function requireActiveGroupAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupId: string,
) {
  const { data: membership, error: memberError } = await supabase
    .from("group_members")
    .select("role, status")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) {
    return {
      ok: false as const,
      status: 500,
      message: memberError.message || "Unable to verify admin permissions.",
    };
  }

  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    membership.role !== "ADMIN"
  ) {
    return {
      ok: false as const,
      status: 403,
      message: "Only active group admins can manage group archive status.",
    };
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select(
      "id, name, group_type, status, default_split_mode, trip_auto_archive_enabled, trip_auto_archive_days, residential_lease_prompt_enabled, lease_prompt_snoozed_until, archived_at",
    )
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    return {
      ok: false as const,
      status: 500,
      message: groupError.message || "Unable to load group details.",
    };
  }

  if (!group) {
    return {
      ok: false as const,
      status: 404,
      message: "Split group not found.",
    };
  }

  return { ok: true as const, group };
}

export async function archiveGroup(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupId: string,
  reason?: string,
): Promise<ArchiveMutationResult> {
  const auth = await requireActiveGroupAdmin(supabase, userId, groupId);
  if (!auth.ok) return auth;

  const { group } = auth;
  if (group.status === "ARCHIVED") {
    return {
      ok: true,
      groupId: group.id,
      status: "ARCHIVED",
      tripAutoArchiveEnabled: group.trip_auto_archive_enabled ?? true,
      tripAutoArchiveDays:
        group.trip_auto_archive_days ?? DEFAULT_TRIP_AUTO_ARCHIVE_DAYS,
      residentialLeasePromptEnabled:
        group.residential_lease_prompt_enabled ?? true,
      leaseEndDate: null,
      leasePromptSnoozedUntil: group.lease_prompt_snoozed_until ?? null,
      archivedAt: group.archived_at ?? null,
    };
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("groups")
    .update({
      status: "ARCHIVED",
      archived_at: nowIso,
      archived_by: userId,
    })
    .eq("id", group.id);

  if (updateError) {
    return {
      ok: false,
      status: 500,
      message: updateError.message || "Failed to archive split group.",
    };
  }

  const auditEntry = await recordGroupAuditEvent(supabase, {
    groupId: group.id,
    actorId: userId,
    eventType: "GROUP_ARCHIVED",
    summary: `Archived ${group.name} (read-only ledger)`,
    metadata: {
      archive_reason:
        reason?.trim() || "Manually archived by Group Admin.",
    },
  });

  return {
    ok: true,
    groupId: group.id,
    status: "ARCHIVED",
    tripAutoArchiveEnabled: group.trip_auto_archive_enabled ?? true,
    tripAutoArchiveDays:
      group.trip_auto_archive_days ?? DEFAULT_TRIP_AUTO_ARCHIVE_DAYS,
    residentialLeasePromptEnabled:
      group.residential_lease_prompt_enabled ?? true,
    leaseEndDate: null,
    leasePromptSnoozedUntil: group.lease_prompt_snoozed_until ?? null,
    archivedAt: nowIso,
    auditEntry,
  };
}

export async function unarchiveGroup(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupId: string,
): Promise<ArchiveMutationResult> {
  const auth = await requireActiveGroupAdmin(supabase, userId, groupId);
  if (!auth.ok) return auth;

  const { group } = auth;
  if (group.status !== "ARCHIVED") {
    return {
      ok: true,
      groupId: group.id,
      status: group.status,
      tripAutoArchiveEnabled: group.trip_auto_archive_enabled ?? true,
      tripAutoArchiveDays:
        group.trip_auto_archive_days ?? DEFAULT_TRIP_AUTO_ARCHIVE_DAYS,
      residentialLeasePromptEnabled:
        group.residential_lease_prompt_enabled ?? true,
      leaseEndDate: null,
      leasePromptSnoozedUntil: group.lease_prompt_snoozed_until ?? null,
      archivedAt: null,
    };
  }

  let nextStatus: GroupStatus = "ACTIVE";
  if (group.default_split_mode === "CUSTOM_RATIOS") {
    const { data: activeMembers } = await supabase
      .from("group_members")
      .select("share_percentage")
      .eq("group_id", group.id)
      .eq("status", "ACTIVE");
    const sumBps = (activeMembers ?? []).reduce(
      (sum, m) => sum + Math.round(Number(m.share_percentage ?? 0) * 100),
      0,
    );
    if (sumBps !== 10_000) {
      nextStatus = "NEEDS_RATIO_UPDATE";
    }
  }

  const { error: updateError } = await supabase
    .from("groups")
    .update({
      status: nextStatus,
      archived_at: null,
      archived_by: null,
    })
    .eq("id", group.id);

  if (updateError) {
    return {
      ok: false,
      status: 500,
      message: updateError.message || "Failed to restore archived group.",
    };
  }

  const auditEntry = await recordGroupAuditEvent(supabase, {
    groupId: group.id,
    actorId: userId,
    eventType: "GROUP_UNARCHIVED",
    summary: `Restored ${group.name} from archive (${nextStatus})`,
    metadata: {
      archive_reason: "Restored to active status by Group Admin.",
    },
  });

  return {
    ok: true,
    groupId: group.id,
    status: nextStatus,
    tripAutoArchiveEnabled: group.trip_auto_archive_enabled ?? true,
    tripAutoArchiveDays:
      group.trip_auto_archive_days ?? DEFAULT_TRIP_AUTO_ARCHIVE_DAYS,
    residentialLeasePromptEnabled:
      group.residential_lease_prompt_enabled ?? true,
    leaseEndDate: null,
    leasePromptSnoozedUntil: group.lease_prompt_snoozed_until ?? null,
    archivedAt: null,
    auditEntry,
  };
}


export type DeleteArchivedGroupResult =
  | {
      ok: true;
      groupId: string;
      groupName: string;
    }
  | {
      ok: false;
      status: number;
      code?: "GROUP_NOT_ARCHIVED" | "UNSETTLED_BALANCES";
      unsettledMemberCount?: number;
      message: string;
    };

export async function deleteArchivedGroup(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupId: string,
): Promise<DeleteArchivedGroupResult> {
  const { data: membership, error: memberError } = await supabase
    .from("group_members")
    .select("role, status")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) {
    return {
      ok: false,
      status: 500,
      message: memberError.message || "Unable to verify admin permissions.",
    };
  }

  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    membership.role !== "ADMIN"
  ) {
    return {
      ok: false,
      status: 403,
      message: "Only active group admins can permanently delete an archived group.",
    };
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id, name, status, base_currency, billing_cycle_anchor_day")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    return {
      ok: false,
      status: 500,
      message: groupError.message || "Unable to load group details.",
    };
  }

  if (!group) {
    return {
      ok: false,
      status: 404,
      message: "Split group not found.",
    };
  }

  if (group.status !== "ARCHIVED") {
    return {
      ok: false,
      status: 409,
      code: "GROUP_NOT_ARCHIVED",
      message: "Archive the group before permanently deleting it.",
    };
  }

  const [
    { data: memberRows, error: membersErr },
    { data: expenseRows, error: expensesErr },
    { data: settlementRows, error: settlementsErr },
  ] = await Promise.all([
    supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", group.id),
    supabase
      .from("expenses")
      .select(
        "group_id, paid_by, amount_cents, expense_date, split_breakdown, deleted_at",
      )
      .eq("group_id", group.id)
      .is("deleted_at", null),
    supabase
      .from("settlements")
      .select("group_id, payer_id, recipient_id, amount_cents")
      .eq("group_id", group.id),
  ]);

  if (membersErr || expensesErr || settlementsErr) {
    return {
      ok: false,
      status: 500,
      message:
        membersErr?.message ||
        expensesErr?.message ||
        settlementsErr?.message ||
        "Unable to verify group balances before deletion.",
    };
  }

  const normalizedExpenses: LedgerExpenseInput[] = (expenseRows ?? []).map((e) => ({
    group_id: e.group_id,
    paid_by: e.paid_by,
    amount_cents: e.amount_cents,
    expense_date: e.expense_date,
    split_breakdown: Array.isArray(e.split_breakdown)
      ? (e.split_breakdown as unknown as SplitBreakdownItem[])
      : [],
    deleted_at: e.deleted_at,
  }));

  const metrics = computeGroupLedgerMetrics({
    expenses: normalizedExpenses,
    settlements: (settlementRows ?? []) as LedgerSettlementInput[],
    memberIds: (memberRows ?? []).map((m) => m.user_id),
    currentUserId: userId,
    cycleSlug: "2026-11",
    anchorDay: group.billing_cycle_anchor_day ?? 1,
  });

  const unsettledMemberCount = Array.from(
    metrics.netBalanceByUser.values(),
  ).filter((bal) => Math.trunc(bal) !== 0).length;

  if (unsettledMemberCount > 0) {
    return {
      ok: false,
      status: 409,
      code: "UNSETTLED_BALANCES",
      unsettledMemberCount,
      message: `Cannot permanently delete ${group.name}: ${unsettledMemberCount} ${unsettledMemberCount === 1 ? "member still has" : "members still have"} an unsettled balance. All member balances must be $0.00 before deletion.`,
    };
  }

  const { error: deleteError } = await supabase
    .from("groups")
    .delete()
    .eq("id", group.id);

  if (deleteError) {
    return {
      ok: false,
      status: 500,
      message: deleteError.message || "Failed to permanently delete group.",
    };
  }

  return {
    ok: true,
    groupId: group.id,
    groupName: group.name,
  };
}
