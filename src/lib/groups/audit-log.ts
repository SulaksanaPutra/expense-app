import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMinorUnits } from "@/lib/money";
import type {
  Database,
  GroupAuditEventType,
  GroupStatus,
  Json,
  SplitMode,
} from "@/types/database";

export type GroupAuditCategory = "RATIOS" | "GOVERNANCE" | "LEDGER";

export type AuditLogDisplayEventType =
  | GroupAuditEventType
  | "EXPENSE_REVISION"
  | "SETTLEMENT_RECORDED";

export interface GroupAuditLogEntry {
  id: string;
  groupId: string;
  category: GroupAuditCategory;
  eventType: AuditLogDisplayEventType;
  actorId: string | null;
  actorName: string;
  summary: string;
  details: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface RecordGroupAuditEventInput {
  groupId: string;
  actorId: string | null;
  actorName?: string;
  eventType: GroupAuditEventType;
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

const RATIO_EVENT_TYPES = new Set<AuditLogDisplayEventType>([
  "RATIOS_UPDATED",
  "SPLIT_MODE_CHANGED",
  "NEEDS_RATIO_UPDATE_FLAGGED",
  "NEEDS_RATIO_UPDATE_CLEARED",
]);

const LEDGER_EVENT_TYPES = new Set<AuditLogDisplayEventType>([
  "EXPENSE_REVISION",
  "SETTLEMENT_RECORDED",
]);

export function classifyAuditCategory(
  eventType: AuditLogDisplayEventType,
): GroupAuditCategory {
  if (RATIO_EVENT_TYPES.has(eventType)) return "RATIOS";
  if (LEDGER_EVENT_TYPES.has(eventType)) return "LEDGER";
  return "GOVERNANCE";
}

function formatSplitModeLabel(mode: unknown): string {
  if (mode === "EQUAL") return "Equal Split";
  if (mode === "CUSTOM_RATIOS") return "Custom Ratios";
  return typeof mode === "string" ? mode : "Unknown";
}

export function extractAuditDetails(
  eventType: AuditLogDisplayEventType,
  metadata: Record<string, unknown> | undefined,
  usersById?: Map<string, { full_name: string; email: string }>,
): string[] {
  if (!metadata) return [];

  if (Array.isArray(metadata.details)) {
    return metadata.details.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  }

  const details: string[] = [];

  if (
    typeof metadata.previous_split_mode === "string" &&
    typeof metadata.next_split_mode === "string"
  ) {
    if (metadata.previous_split_mode !== metadata.next_split_mode) {
      details.push(
        `Default split mode: ${formatSplitModeLabel(metadata.previous_split_mode)} -> ${formatSplitModeLabel(metadata.next_split_mode)}`,
      );
    } else {
      details.push(
        `Split mode: ${formatSplitModeLabel(metadata.next_split_mode)}`,
      );
    }
  }

  if (metadata.cleared_needs_ratio_update === true) {
    details.push("Cleared NEEDS_RATIO_UPDATE flag -> Group status ACTIVE");
  } else if (metadata.flagged_needs_ratio_update === true) {
    details.push("Flagged group status as NEEDS_RATIO_UPDATE");
  }

  if (Array.isArray(metadata.member_changes)) {
    for (const change of metadata.member_changes) {
      if (!change || typeof change !== "object") continue;
      const item = change as Record<string, unknown>;
      const userId = typeof item.user_id === "string" ? item.user_id : "";
      const userName =
        (typeof item.name === "string" && item.name) ||
        usersById?.get(userId)?.full_name ||
        usersById?.get(userId)?.email ||
        "Member";
      const prevPct =
        typeof item.previous_share_percentage === "number"
          ? item.previous_share_percentage
          : null;
      const nextPct =
        typeof item.next_share_percentage === "number"
          ? item.next_share_percentage
          : null;

      if (prevPct !== null && nextPct !== null) {
        if (prevPct !== nextPct) {
          details.push(`${userName}: ${prevPct}% -> ${nextPct}%`);
        } else {
          details.push(`${userName}: ${nextPct}% (unchanged)`);
        }
      } else if (nextPct !== null) {
        details.push(`${userName}: ${nextPct}%`);
      }
    }
  }

  if (eventType === "RATIOS_UPDATED" || eventType === "NEEDS_RATIO_UPDATE_CLEARED") {
    details.push("Existing Expense.split_breakdown snapshots remain untouched.");
  }

  if (typeof metadata.invite_token_version === "number") {
    details.push(`Active invite token version: v${metadata.invite_token_version}`);
  }

  if (typeof metadata.joined_share_percentage === "number") {
    details.push(`Assigned initial share: ${metadata.joined_share_percentage}%`);
  }

  if (typeof metadata.former_member_balance_cents === "number" && typeof metadata.base_currency === "string") {
    const formatted = formatMinorUnits(
      metadata.former_member_balance_cents,
      metadata.base_currency,
      { showPlus: true },
    );
    details.push(`Preserved unsettled balance: ${formatted}`);
    details.push("Excluded from future default splits; settlements remain enabled.");
  }

  if (typeof metadata.trip_auto_archive_enabled === "boolean") {
    const days =
      typeof metadata.trip_auto_archive_days === "number"
        ? metadata.trip_auto_archive_days
        : 14;
    details.push(
      metadata.trip_auto_archive_enabled
        ? `Trip auto-archive: Enabled (${days} days at zero balance)`
        : "Trip auto-archive: Disabled",
    );
  }

  if (typeof metadata.residential_lease_prompt_enabled === "boolean") {
    details.push(
      metadata.residential_lease_prompt_enabled
        ? "Residential lease prompt: Enabled (7 days post-lease)"
        : "Residential lease prompt: Disabled",
    );
  }

  if (typeof metadata.archive_reason === "string" && metadata.archive_reason.trim()) {
    details.push(metadata.archive_reason);
  }

  return details;
}

export function buildRatioAuditPayload(params: {
  previousSplitMode: SplitMode;
  nextSplitMode: SplitMode;
  previousStatus: GroupStatus;
  nextStatus: GroupStatus;
  memberChanges: Array<{
    userId: string;
    name?: string;
    previousSharePercentage: number;
    nextSharePercentage: number;
  }>;
}): {
  eventType: GroupAuditEventType;
  summary: string;
  metadata: Record<string, unknown>;
} {
  const clearedFlag =
    params.previousStatus === "NEEDS_RATIO_UPDATE" &&
    params.nextStatus === "ACTIVE";
  const modeChanged = params.previousSplitMode !== params.nextSplitMode;

  const eventType: GroupAuditEventType = clearedFlag
    ? "NEEDS_RATIO_UPDATE_CLEARED"
    : modeChanged
      ? "SPLIT_MODE_CHANGED"
      : "RATIOS_UPDATED";

  const summary = clearedFlag
    ? `Updated split ratios (${formatSplitModeLabel(params.nextSplitMode)}) and cleared review flag`
    : modeChanged
      ? `Changed default split mode from ${formatSplitModeLabel(params.previousSplitMode)} to ${formatSplitModeLabel(params.nextSplitMode)}`
      : `Updated household split ratios (${formatSplitModeLabel(params.nextSplitMode)})`;

  const metadata: Record<string, unknown> = {
    previous_split_mode: params.previousSplitMode,
    next_split_mode: params.nextSplitMode,
    previous_status: params.previousStatus,
    next_status: params.nextStatus,
    cleared_needs_ratio_update: clearedFlag,
    member_changes: params.memberChanges.map((item) => ({
      user_id: item.userId,
      name: item.name,
      previous_share_percentage: item.previousSharePercentage,
      next_share_percentage: item.nextSharePercentage,
    })),
  };

  return { eventType, summary, metadata };
}

export async function recordGroupAuditEvent(
  supabase: SupabaseClient<Database>,
  input: RecordGroupAuditEventInput,
): Promise<GroupAuditLogEntry> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const fallbackId = crypto.randomUUID();
  const metadata = input.metadata ?? {};

  const fallbackEntry: GroupAuditLogEntry = {
    id: fallbackId,
    groupId: input.groupId,
    category: classifyAuditCategory(input.eventType),
    eventType: input.eventType,
    actorId: input.actorId,
    actorName: input.actorName ?? "Group Admin",
    summary: input.summary,
    details: extractAuditDetails(input.eventType, metadata),
    createdAt,
    metadata,
  };

  try {
    const tableApi = supabase.from("group_audit_logs") as unknown as {
      insert?: (values: Database["public"]["Tables"]["group_audit_logs"]["Insert"]) => {
        select?: (columns: string) => {
          maybeSingle?: () => Promise<{
            data: Database["public"]["Tables"]["group_audit_logs"]["Row"] | null;
            error: { message?: string } | null;
          }>;
        };
      } & Promise<{ error: { message?: string } | null }>;
    };

    if (!tableApi || typeof tableApi.insert !== "function") {
      return fallbackEntry;
    }

    const insertResult = tableApi.insert({
      id: fallbackId,
      group_id: input.groupId,
      actor_id: input.actorId,
      event_type: input.eventType,
      summary: input.summary,
      metadata: metadata as Json,
      created_at: createdAt,
    });

    if (insertResult && typeof insertResult.select === "function") {
      const selected = insertResult.select(
        "id, group_id, actor_id, event_type, summary, metadata, created_at",
      );
      if (selected && typeof selected.maybeSingle === "function") {
        const { data } = await selected.maybeSingle();
        if (data) {
          const rowMetadata =
            data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
              ? (data.metadata as Record<string, unknown>)
              : metadata;
          return {
            id: data.id,
            groupId: data.group_id,
            category: classifyAuditCategory(data.event_type),
            eventType: data.event_type,
            actorId: data.actor_id,
            actorName: input.actorName ?? "Group Admin",
            summary: data.summary,
            details: extractAuditDetails(data.event_type, rowMetadata),
            createdAt: data.created_at,
            metadata: rowMetadata,
          };
        }
      }
    } else if (insertResult && typeof (insertResult as Promise<unknown>).then === "function") {
      await insertResult;
    }
  } catch {
    // Non-fatal in test mocks or before migration 0004 is applied.
  }

  return fallbackEntry;
}

export type GetGroupAuditLogsResult =
  | { ok: true; groupId: string; entries: GroupAuditLogEntry[] }
  | { ok: false; status: number; message: string };

export async function getGroupAuditLogs(
  supabase: SupabaseClient<Database>,
  userId: string,
  groupId: string,
): Promise<GetGroupAuditLogsResult> {
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
      message: memberError.message || "Unable to verify group membership.",
    };
  }

  if (!membership) {
    return {
      ok: false,
      status: 403,
      message: "You must be a member of this group to view its audit log.",
    };
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id, base_currency")
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

  let auditRows: Array<Database["public"]["Tables"]["group_audit_logs"]["Row"]> =
    [];
  try {
    const auditTable = supabase.from("group_audit_logs") as unknown as {
      select?: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (
            col: string,
            opts: { ascending: boolean },
          ) => Promise<{
            data: Array<Database["public"]["Tables"]["group_audit_logs"]["Row"]> | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };

    if (auditTable && typeof auditTable.select === "function") {
      const { data, error } = await auditTable
        .select("id, group_id, actor_id, event_type, summary, metadata, created_at")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        auditRows = data;
      }
    }
  } catch {
    // Gracefully fallback when table is unavailable in partial mocks.
  }

  let settlementRows: Array<Database["public"]["Tables"]["settlements"]["Row"]> = [];
  try {
    const settlementsTable = supabase.from("settlements") as unknown as {
      select?: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (
            col: string,
            opts: { ascending: boolean },
          ) => Promise<{
            data: Array<Database["public"]["Tables"]["settlements"]["Row"]> | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };

    if (settlementsTable && typeof settlementsTable.select === "function") {
      const { data, error } = await settlementsTable
        .select(
          "id, group_id, payer_id, recipient_id, amount_cents, currency, payment_rail, settled_at",
        )
        .eq("group_id", groupId)
        .order("settled_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        settlementRows = data;
      }
    }
  } catch {
    // Ignore if settlements isn't mocked.
  }

  let expenseRows: Array<{
    id: string;
    description?: string;
    currency?: string;
  }> = [];
  let revisionRows: Array<
    Database["public"]["Tables"]["expense_revisions"]["Row"]
  > = [];

  try {
    const expensesTable = supabase.from("expenses") as unknown as {
      select?: (cols: string) => {
        eq?: (col: string, val: string) => Promise<{
          data: Array<{
            id: string;
            description?: string;
            currency?: string;
          }> | null;
          error: { message?: string } | null;
        }>;
      };
    };
    const expSel = expensesTable?.select?.("id, description, currency");
    if (expSel && typeof expSel.eq === "function") {
      const { data, error } = await expSel.eq("group_id", groupId);
      if (!error && Array.isArray(data)) {
        expenseRows = data;
      }
    }

    const expenseIds = expenseRows.map((e) => e.id).filter(Boolean);
    if (expenseIds.length > 0) {
      const revisionsTable = supabase.from("expense_revisions") as unknown as {
        select?: (cols: string) => {
          in?: (col: string, vals: string[]) => {
            order?: (
              col: string,
              opts: { ascending: boolean },
            ) => Promise<{
              data: Array<
                Database["public"]["Tables"]["expense_revisions"]["Row"]
              > | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
      const revIn = revisionsTable
        ?.select?.("id, expense_id, updated_by, old_snapshot, new_snapshot, created_at")
        ?.in?.("expense_id", expenseIds);
      if (revIn && typeof revIn.order === "function") {
        const { data, error } = await revIn.order("created_at", {
          ascending: false,
        });
        if (!error && Array.isArray(data)) {
          revisionRows = data;
        }
      }
    }
  } catch {
    // Ignore if expenses or expense_revisions isn't mocked.
  }

  const userIds = new Set<string>();
  for (const row of auditRows) {
    if (row.actor_id) userIds.add(row.actor_id);
    const meta =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : undefined;
    if (meta && Array.isArray(meta.member_changes)) {
      for (const change of meta.member_changes) {
        if (change && typeof change === "object" && typeof (change as { user_id?: unknown }).user_id === "string") {
          userIds.add((change as { user_id: string }).user_id);
        }
      }
    }
  }
  for (const s of settlementRows) {
    userIds.add(s.payer_id);
    userIds.add(s.recipient_id);
  }
  for (const rev of revisionRows) {
    if (rev.updated_by) userIds.add(rev.updated_by);
    for (const snap of [rev.old_snapshot, rev.new_snapshot]) {
      if (snap && typeof snap === "object" && !Array.isArray(snap)) {
        const breakdown = (snap as Record<string, unknown>).split_breakdown;
        if (Array.isArray(breakdown)) {
          for (const item of breakdown) {
            if (
              item &&
              typeof item === "object" &&
              typeof (item as { user_id?: unknown }).user_id === "string"
            ) {
              userIds.add((item as { user_id: string }).user_id);
            }
          }
        }
      }
    }
  }

  const usersById = new Map<string, { full_name: string; email: string }>();
  if (userIds.size > 0) {
    try {
      const usersTable = supabase.from("users") as unknown as {
        select?: (cols: string) => {
          in?: (col: string, vals: string[]) => Promise<{
            data: Array<{ id: string; full_name: string; email: string }> | null;
            error: { message?: string } | null;
          }>;
        };
      };
      const selector = usersTable?.select?.("id, full_name, email");
      if (selector && typeof selector.in === "function") {
        const { data: userRows } = await selector.in(
          "id",
          Array.from(userIds),
        );
        for (const u of userRows ?? []) {
          usersById.set(u.id, { full_name: u.full_name, email: u.email });
        }
      }
    } catch {
      // Ignore profile lookup errors in partial mocks.
    }
  }

  const entries: GroupAuditLogEntry[] = [];

  for (const row of auditRows) {
    const actorProfile = row.actor_id ? usersById.get(row.actor_id) : undefined;
    const actorName =
      actorProfile?.full_name ||
      actorProfile?.email ||
      (row.actor_id ? "Group Member" : "System");
    const rowMetadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : undefined;

    entries.push({
      id: row.id,
      groupId: row.group_id,
      category: classifyAuditCategory(row.event_type),
      eventType: row.event_type,
      actorId: row.actor_id,
      actorName,
      summary: row.summary,
      details: extractAuditDetails(row.event_type, rowMetadata, usersById),
      createdAt: row.created_at,
      metadata: rowMetadata,
    });
  }

  for (const settlement of settlementRows) {
    const payer = usersById.get(settlement.payer_id);
    const recipient = usersById.get(settlement.recipient_id);
    const payerName = payer?.full_name || payer?.email || "Member";
    const recipientName = recipient?.full_name || recipient?.email || "Member";
    const formattedAmount = formatMinorUnits(
      settlement.amount_cents,
      settlement.currency || group.base_currency,
    );

    entries.push({
      id: `settlement-${settlement.id}`,
      groupId: settlement.group_id,
      category: "LEDGER",
      eventType: "SETTLEMENT_RECORDED",
      actorId: settlement.payer_id,
      actorName: payerName,
      summary: `${payerName} settled ${formattedAmount} with ${recipientName}`,
      details: [`Payment rail: ${settlement.payment_rail}`],
      createdAt: settlement.settled_at,
    });
  }

  const expensesById = new Map(expenseRows.map((e) => [e.id, e]));
  for (const rev of revisionRows) {
    const actor = usersById.get(rev.updated_by);
    const actorName = actor?.full_name || actor?.email || "Member";
    const exp = expensesById.get(rev.expense_id);
    const oldSnap =
      rev.old_snapshot &&
      typeof rev.old_snapshot === "object" &&
      !Array.isArray(rev.old_snapshot)
        ? (rev.old_snapshot as Record<string, unknown>)
        : {};
    const newSnap =
      rev.new_snapshot &&
      typeof rev.new_snapshot === "object" &&
      !Array.isArray(rev.new_snapshot)
        ? (rev.new_snapshot as Record<string, unknown>)
        : {};

    const desc =
      (typeof newSnap.description === "string" && newSnap.description) ||
      (typeof oldSnap.description === "string" && oldSnap.description) ||
      exp?.description ||
      "Expense";
    const currency =
      (typeof newSnap.currency === "string" && newSnap.currency) ||
      (typeof oldSnap.currency === "string" && oldSnap.currency) ||
      exp?.currency ||
      group.base_currency;

    const details: string[] = [];
    const oldAmt =
      typeof oldSnap.amount_cents === "number" ? oldSnap.amount_cents : null;
    const newAmt =
      typeof newSnap.amount_cents === "number" ? newSnap.amount_cents : null;
    if (oldAmt !== null && newAmt !== null && oldAmt !== newAmt) {
      details.push(
        `Total: ${formatMinorUnits(oldAmt, currency)} -> ${formatMinorUnits(newAmt, currency)}`,
      );
    }

    const oldShares =
      oldSnap.shares_by_user &&
      typeof oldSnap.shares_by_user === "object" &&
      !Array.isArray(oldSnap.shares_by_user)
        ? (oldSnap.shares_by_user as Record<string, unknown>)
        : {};
    const newShares =
      newSnap.shares_by_user &&
      typeof newSnap.shares_by_user === "object" &&
      !Array.isArray(newSnap.shares_by_user)
        ? (newSnap.shares_by_user as Record<string, unknown>)
        : {};

    for (const uid of new Set([
      ...Object.keys(oldShares),
      ...Object.keys(newShares),
    ])) {
      const prevShare = Number(oldShares[uid] ?? 0);
      const nextShare = Number(newShares[uid] ?? 0);
      if (prevShare !== nextShare) {
        const uName =
          usersById.get(uid)?.full_name ||
          usersById.get(uid)?.email ||
          "Member";
        details.push(
          `${uName} share: ${formatMinorUnits(prevShare, currency)} -> ${formatMinorUnits(nextShare, currency)}`,
        );
      }
    }

    entries.push({
      id: `revision-${rev.id}`,
      groupId,
      category: "LEDGER",
      eventType: "EXPENSE_REVISION",
      actorId: rev.updated_by,
      actorName,
      summary: `${actorName} edited "${desc}"`,
      details,
      createdAt: rev.created_at,
    });
  }

  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    ok: true,
    groupId,
    entries,
  };
}
