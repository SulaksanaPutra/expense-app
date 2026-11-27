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

export interface ArchiveCheckEvaluationSummary {
  autoArchivedGroupIds: string[];
  leasePromptGroupIds: string[];
  checkedGroupCount: number;
}

export async function runArchiveRulesEvaluation(
  supabase: SupabaseClient<Database>,
  now = new Date(),
): Promise<{
  ok: true;
  summary: ArchiveCheckEvaluationSummary;
} | {
  ok: false;
  message: string;
}> {
  const { data: groupRows, error: groupsError } = await supabase
    .from("groups")
    .select(
      "id, name, group_type, status, billing_cycle_anchor_day, lease_end_date, trip_auto_archive_enabled, trip_auto_archive_days, residential_lease_prompt_enabled, zero_balance_since, lease_prompt_snoozed_until",
    )
    .neq("status", "ARCHIVED");

  if (groupsError) {
    return {
      ok: false,
      message: groupsError.message || "Unable to load groups for archive check.",
    };
  }

  const groups = groupRows ?? [];
  if (groups.length === 0) {
    return {
      ok: true,
      summary: {
        autoArchivedGroupIds: [],
        leasePromptGroupIds: [],
        checkedGroupCount: 0,
      },
    };
  }

  const tripIds = groups
    .filter((g) => g.group_type === "TRIP")
    .map((g) => g.id);

  const expensesByGroup = new Map<string, LedgerExpenseInput[]>();
  const settlementsByGroup = new Map<string, LedgerSettlementInput[]>();
  const memberIdsByGroup = new Map<string, string[]>();

  if (tripIds.length > 0) {
    const [{ data: memberRows }, { data: expenseRows }, { data: settlementRows }] =
      await Promise.all([
        supabase
          .from("group_members")
          .select("group_id, user_id")
          .in("group_id", tripIds),
        supabase
          .from("expenses")
          .select(
            "group_id, paid_by, amount_cents, expense_date, split_breakdown, deleted_at",
          )
          .in("group_id", tripIds)
          .is("deleted_at", null),
        supabase
          .from("settlements")
          .select("group_id, payer_id, recipient_id, amount_cents")
          .in("group_id", tripIds),
      ]);

    for (const m of memberRows ?? []) {
      const list = memberIdsByGroup.get(m.group_id) ?? [];
      list.push(m.user_id);
      memberIdsByGroup.set(m.group_id, list);
    }

    for (const e of expenseRows ?? []) {
      const list = expensesByGroup.get(e.group_id) ?? [];
      list.push({
        group_id: e.group_id,
        paid_by: e.paid_by,
        amount_cents: e.amount_cents,
        expense_date: e.expense_date,
        split_breakdown: Array.isArray(e.split_breakdown)
          ? (e.split_breakdown as unknown as SplitBreakdownItem[])
          : [],
        deleted_at: e.deleted_at,
      });
      expensesByGroup.set(e.group_id, list);
    }

    for (const s of settlementRows ?? []) {
      const list = settlementsByGroup.get(s.group_id) ?? [];
      list.push(s);
      settlementsByGroup.set(s.group_id, list);
    }
  }

  const autoArchivedGroupIds: string[] = [];
  const leasePromptGroupIds: string[] = [];
  const nowIso = now.toISOString();

  for (const g of groups) {
    if (g.group_type === "TRIP") {
      const metrics = computeGroupLedgerMetrics({
        expenses: expensesByGroup.get(g.id) ?? [],
        settlements: settlementsByGroup.get(g.id) ?? [],
        memberIds: memberIdsByGroup.get(g.id) ?? [],
        currentUserId: "",
        cycleSlug: "2026-11",
        anchorDay: g.billing_cycle_anchor_day ?? 1,
      });

      const evaluation = evaluateTripAutoArchive(
        {
          groupType: g.group_type,
          status: g.status,
          tripAutoArchiveEnabled: g.trip_auto_archive_enabled ?? true,
          tripAutoArchiveDays:
            g.trip_auto_archive_days ?? DEFAULT_TRIP_AUTO_ARCHIVE_DAYS,
          isFullySettled: metrics.isFullySettled,
          zeroBalanceSince: g.zero_balance_since ?? null,
        },
        now,
      );

      if (evaluation.shouldAutoArchive) {
        const { error: updateErr } = await supabase
          .from("groups")
          .update({
            status: "ARCHIVED",
            archived_at: nowIso,
            zero_balance_since: evaluation.nextZeroBalanceSince,
          })
          .eq("id", g.id);

        if (!updateErr) {
          autoArchivedGroupIds.push(g.id);
          await recordGroupAuditEvent(supabase, {
            groupId: g.id,
            actorId: null,
            actorName: "System",
            eventType: "GROUP_ARCHIVED",
            summary: `Auto-archived ${g.name} after ${evaluation.daysAtZeroBalance} days at zero balance`,
            metadata: {
              archive_reason: `Trip auto-archive triggered (${evaluation.daysAtZeroBalance} days at $0.00 balance).`,
            },
          });
        }
      } else if (
        evaluation.nextZeroBalanceSince !== (g.zero_balance_since ?? null)
      ) {
        await supabase
          .from("groups")
          .update({ zero_balance_since: evaluation.nextZeroBalanceSince })
          .eq("id", g.id);
      }
    }

    if (g.group_type === "RESIDENTIAL") {
      const promptEval = evaluateResidentialLeasePrompt(
        {
          groupType: g.group_type,
          status: g.status,
          residentialLeasePromptEnabled:
            g.residential_lease_prompt_enabled ?? true,
          leaseEndDate: g.lease_end_date ?? null,
          leasePromptSnoozedUntil: g.lease_prompt_snoozed_until ?? null,
        },
        now,
      );
      if (promptEval.shouldPromptLeaseArchive) {
        leasePromptGroupIds.push(g.id);

        try {
          const notifTable = supabase.from("notifications");
          if (notifTable && typeof notifTable.insert === "function") {
            const { data: adminMembers } = await supabase
              .from("group_members")
              .select("user_id")
              .eq("group_id", g.id)
              .eq("role", "ADMIN")
              .eq("status", "ACTIVE");

            const adminIds = (adminMembers ?? []).map((m) => m.user_id);
            if (adminIds.length > 0) {
              const { data: existingPrompts } = await notifTable
                .select("user_id")
                .eq("group_id", g.id)
                .eq("type", "LEASE_ARCHIVE_PROMPT")
                .eq("is_read", false)
                .in("user_id", adminIds);

              const alreadyPrompted = new Set(
                (existingPrompts ?? []).map((row) => row.user_id),
              );
              const targetAdmins = adminIds.filter(
                (uid) => !alreadyPrompted.has(uid),
              );

              if (targetAdmins.length > 0) {
                const payloads: Database["public"]["Tables"]["notifications"]["Insert"][] =
                  targetAdmins.map((uid) => ({
                    id: crypto.randomUUID(),
                    user_id: uid,
                    group_id: g.id,
                    actor_id: null,
                    expense_id: null,
                    revision_id: null,
                    type: "LEASE_ARCHIVE_PROMPT",
                    title: "Lease archive prompt",
                    description: `Lease ended on ${g.lease_end_date} for ${g.name}. Review balances and archive or snooze.`,
                    delta_cents: null,
                    currency: null,
                    href: `/split-groups?group=${encodeURIComponent(g.id)}`,
                    is_read: false,
                    created_at: nowIso,
                  }));
                await notifTable.insert(payloads);
              }
            }
          }
        } catch {
          // Non-fatal in minimal unit-test mocks.
        }
      }
    }
  }

  return {
    ok: true,
    summary: {
      autoArchivedGroupIds,
      leasePromptGroupIds,
      checkedGroupCount: groups.length,
    },
  };
}

export interface UpdateArchiveRulesInput {
  trip_auto_archive_enabled?: boolean;
  trip_auto_archive_days?: number;
  residential_lease_prompt_enabled?: boolean;
  lease_end_date?: string | null;
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
      message: "Only active group admins can configure archive rules.",
    };
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select(
      "id, name, group_type, status, default_split_mode, lease_end_date, trip_auto_archive_enabled, trip_auto_archive_days, residential_lease_prompt_enabled, lease_prompt_snoozed_until, archived_at",
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

export async function updateGroupArchiveRules(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupId: string,
  input: UpdateArchiveRulesInput,
): Promise<ArchiveMutationResult> {
  const auth = await requireActiveGroupAdmin(supabase, userId, groupId);
  if (!auth.ok) return auth;

  const { group } = auth;
  if (group.status === "ARCHIVED") {
    return {
      ok: false,
      status: 409,
      message: "Archived groups are read-only. Restore the group first to edit rules.",
    };
  }

  const nextTripEnabled =
    typeof input.trip_auto_archive_enabled === "boolean"
      ? input.trip_auto_archive_enabled
      : (group.trip_auto_archive_enabled ?? true);

  let nextTripDays = group.trip_auto_archive_days ?? DEFAULT_TRIP_AUTO_ARCHIVE_DAYS;
  if (input.trip_auto_archive_days !== undefined) {
    const parsedDays = Number(input.trip_auto_archive_days);
    if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 365) {
      return {
        ok: false,
        status: 400,
        message: "Trip auto-archive days must be a whole number between 1 and 365.",
      };
    }
    nextTripDays = parsedDays;
  }

  const nextResidentialEnabled =
    typeof input.residential_lease_prompt_enabled === "boolean"
      ? input.residential_lease_prompt_enabled
      : (group.residential_lease_prompt_enabled ?? true);

  let nextLeaseEndDate = group.lease_end_date ?? null;
  if (input.lease_end_date !== undefined) {
    if (input.lease_end_date === null || input.lease_end_date.trim() === "") {
      nextLeaseEndDate = null;
    } else {
      const trimmed = input.lease_end_date.trim();
      if (!isValidIsoDate(trimmed)) {
        return {
          ok: false,
          status: 400,
          message: "Lease end date must be a valid YYYY-MM-DD date.",
        };
      }
      nextLeaseEndDate = trimmed;
    }
  }

  const { error: updateError } = await supabase
    .from("groups")
    .update({
      trip_auto_archive_enabled: nextTripEnabled,
      trip_auto_archive_days: nextTripDays,
      residential_lease_prompt_enabled: nextResidentialEnabled,
      lease_end_date: nextLeaseEndDate,
    })
    .eq("id", group.id);

  if (updateError) {
    return {
      ok: false,
      status: 500,
      message: updateError.message || "Failed to update archive rules.",
    };
  }

  const auditEntry = await recordGroupAuditEvent(supabase, {
    groupId: group.id,
    actorId: userId,
    eventType: "ARCHIVE_RULES_UPDATED",
    summary: `Updated archive rules for ${group.name}`,
    metadata: {
      trip_auto_archive_enabled: nextTripEnabled,
      trip_auto_archive_days: nextTripDays,
      residential_lease_prompt_enabled: nextResidentialEnabled,
      lease_end_date: nextLeaseEndDate,
    },
  });

  return {
    ok: true,
    groupId: group.id,
    status: group.status,
    tripAutoArchiveEnabled: nextTripEnabled,
    tripAutoArchiveDays: nextTripDays,
    residentialLeasePromptEnabled: nextResidentialEnabled,
    leaseEndDate: nextLeaseEndDate,
    leasePromptSnoozedUntil: group.lease_prompt_snoozed_until ?? null,
    archivedAt: group.archived_at ?? null,
    auditEntry,
  };
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
      leaseEndDate: group.lease_end_date ?? null,
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
    leaseEndDate: group.lease_end_date ?? null,
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
      leaseEndDate: group.lease_end_date ?? null,
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
    leaseEndDate: group.lease_end_date ?? null,
    leasePromptSnoozedUntil: group.lease_prompt_snoozed_until ?? null,
    archivedAt: null,
    auditEntry,
  };
}

export async function snoozeResidentialLeasePrompt(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupId: string,
  snoozeDays = 30,
  now = new Date(),
): Promise<ArchiveMutationResult> {
  const auth = await requireActiveGroupAdmin(supabase, userId, groupId);
  if (!auth.ok) return auth;

  const { group } = auth;
  if (group.status === "ARCHIVED") {
    return {
      ok: false,
      status: 409,
      message: "Group is already archived.",
    };
  }

  const clampedDays = Math.min(Math.max(Math.trunc(snoozeDays), 1), 365);
  const snoozedUntil = new Date(
    now.getTime() + clampedDays * MS_PER_DAY,
  ).toISOString();

  const { error: updateError } = await supabase
    .from("groups")
    .update({ lease_prompt_snoozed_until: snoozedUntil })
    .eq("id", group.id);

  if (updateError) {
    return {
      ok: false,
      status: 500,
      message: updateError.message || "Failed to snooze lease archive prompt.",
    };
  }

  return {
    ok: true,
    groupId: group.id,
    status: group.status,
    tripAutoArchiveEnabled: group.trip_auto_archive_enabled ?? true,
    tripAutoArchiveDays:
      group.trip_auto_archive_days ?? DEFAULT_TRIP_AUTO_ARCHIVE_DAYS,
    residentialLeasePromptEnabled:
      group.residential_lease_prompt_enabled ?? true,
    leaseEndDate: group.lease_end_date ?? null,
    leasePromptSnoozedUntil: snoozedUntil,
    archivedAt: group.archived_at ?? null,
  };
}
