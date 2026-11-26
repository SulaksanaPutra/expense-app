import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShellGroupSummary } from "@/components/shell/types";
import { parseCycleParam } from "@/components/shell/url-state";
import { isValidCurrencyCode } from "@/lib/money";
import type {
  Database,
  GroupType,
  SplitBreakdownItem,
} from "@/types/database";
import type {
  CreateGroupInput,
  SplitGroupDetail,
  SplitGroupMemberDetail,
  SplitGroupsPageData,
} from "./types";
import { createSignedInviteToken } from "./invite-token";
import {
  classifyAuditCategory,
  extractAuditDetails,
  recordGroupAuditEvent,
  type GroupAuditLogEntry,
} from "./audit-log";

const VALID_GROUP_TYPES: readonly GroupType[] = [
  "RESIDENTIAL",
  "TRIP",
  "RECURRING",
];

const ISO_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const [y, m, d] = value.split("-").map((part) => Number.parseInt(part, 10));
  const check = new Date(Date.UTC(y, m - 1, d));
  return (
    check.getUTCFullYear() === y &&
    check.getUTCMonth() === m - 1 &&
    check.getUTCDate() === d
  );
}

export type CreateGroupValidationResult =
  | { ok: true; data: CreateGroupInput }
  | { ok: false; errors: Record<string, string>; message: string };

export function validateCreateGroupPayload(
  raw: unknown,
): CreateGroupValidationResult {
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      errors: { form: "Invalid request payload." },
      message: "Invalid request payload.",
    };
  }

  const input = raw as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const rawName = typeof input.name === "string" ? input.name.trim() : "";
  if (!rawName) {
    errors.name = "Group name is required.";
  } else if (rawName.length < 2) {
    errors.name = "Group name must be at least 2 characters.";
  } else if (rawName.length > 80) {
    errors.name = "Group name must be 80 characters or fewer.";
  }

  const rawType =
    typeof input.group_type === "string" ? input.group_type.trim() : "";
  if (!VALID_GROUP_TYPES.includes(rawType as GroupType)) {
    errors.group_type =
      "Group type must be RESIDENTIAL, TRIP, or RECURRING.";
  }

  const rawCurrency =
    typeof input.base_currency === "string"
      ? input.base_currency.trim().toUpperCase()
      : "USD";
  if (!isValidCurrencyCode(rawCurrency)) {
    errors.base_currency = "Base currency must be a 3-letter ISO-4217 code.";
  }

  let budgetCents: number | null = null;
  if (
    input.operational_budget_cents !== undefined &&
    input.operational_budget_cents !== null &&
    input.operational_budget_cents !== ""
  ) {
    const num = Number(input.operational_budget_cents);
    if (!Number.isSafeInteger(num) || num < 0) {
      errors.operational_budget_cents =
        "Operational budget must be a non-negative integer in minor units.";
    } else {
      budgetCents = num;
    }
  }

  const anchorRaw =
    input.billing_cycle_anchor_day === undefined ||
    input.billing_cycle_anchor_day === null ||
    input.billing_cycle_anchor_day === ""
      ? 1
      : Number(input.billing_cycle_anchor_day);

  if (
    !Number.isInteger(anchorRaw) ||
    anchorRaw < 1 ||
    anchorRaw > 28
  ) {
    errors.billing_cycle_anchor_day =
      "Billing cycle anchor day must be a whole number between 1 and 28.";
  }

  let leaseEndDate: string | null = null;
  if (
    input.lease_end_date !== undefined &&
    input.lease_end_date !== null &&
    String(input.lease_end_date).trim() !== ""
  ) {
    const trimmedDate = String(input.lease_end_date).trim();
    if (!isValidIsoDate(trimmedDate)) {
      errors.lease_end_date = "Lease end date must be a valid YYYY-MM-DD date.";
    } else {
      leaseEndDate = trimmedDate;
    }
  }

  if (Object.keys(errors).length > 0) {
    const firstMsg = Object.values(errors)[0] ?? "Validation failed.";
    return { ok: false, errors, message: firstMsg };
  }

  return {
    ok: true,
    data: {
      name: rawName,
      group_type: rawType as GroupType,
      base_currency: rawCurrency,
      operational_budget_cents: budgetCents,
      billing_cycle_anchor_day: anchorRaw,
      lease_end_date: leaseEndDate,
    },
  };
}

export function buildGroupSlug(name: string, suffix?: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  const cleanBase = base || "split-group";
  const token = suffix ?? crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${cleanBase}-${token}`;
}

export function getBillingCycleWindow(
  cycleSlug: string,
  anchorDay = 1,
): { startMs: number; endMs: number } {
  const safeCycle = parseCycleParam(cycleSlug);
  const [yearStr, monthStr] = safeCycle.split("-");
  const year = Number.parseInt(yearStr, 10);
  const monthIdx = Number.parseInt(monthStr, 10) - 1;
  const clampedAnchor = Math.min(Math.max(Math.trunc(anchorDay), 1), 28);

  const startMs = Date.UTC(year, monthIdx, clampedAnchor, 0, 0, 0, 0);
  const endMs = Date.UTC(year, monthIdx + 1, clampedAnchor, 0, 0, 0, 0);
  return { startMs, endMs };
}

export interface LedgerExpenseInput {
  group_id: string;
  paid_by: string;
  amount_cents: number;
  expense_date: string;
  split_breakdown: SplitBreakdownItem[];
  deleted_at: string | null;
}

export interface LedgerSettlementInput {
  group_id: string;
  payer_id: string;
  recipient_id: string;
  amount_cents: number;
}

export function computeGroupLedgerMetrics(params: {
  expenses: LedgerExpenseInput[];
  settlements: LedgerSettlementInput[];
  memberIds: string[];
  currentUserId: string;
  cycleSlug: string;
  anchorDay: number;
}): {
  cycleTurnoverCents: number;
  cycleTransactionCount: number;
  paidThisPeriodByUser: Map<string, number>;
  netBalanceByUser: Map<string, number>;
  userNetLedgerCents: number;
  isFullySettled: boolean;
} {
  const {
    expenses,
    settlements,
    memberIds,
    currentUserId,
    cycleSlug,
    anchorDay,
  } = params;

  const { startMs, endMs } = getBillingCycleWindow(cycleSlug, anchorDay);
  const paidThisPeriodByUser = new Map<string, number>();
  const netBalanceByUser = new Map<string, number>();

  for (const id of memberIds) {
    paidThisPeriodByUser.set(id, 0);
    netBalanceByUser.set(id, 0);
  }

  let cycleTurnoverCents = 0;
  let cycleTransactionCount = 0;

  for (const expense of expenses) {
    if (expense.deleted_at) continue;

    const amountCents = Math.trunc(expense.amount_cents);
    const expenseMs = Date.parse(expense.expense_date);
    const inCycle =
      Number.isFinite(expenseMs) && expenseMs >= startMs && expenseMs < endMs;

    if (inCycle) {
      cycleTurnoverCents += amountCents;
      cycleTransactionCount += 1;
      paidThisPeriodByUser.set(
        expense.paid_by,
        (paidThisPeriodByUser.get(expense.paid_by) ?? 0) + amountCents,
      );
    }

    netBalanceByUser.set(
      expense.paid_by,
      (netBalanceByUser.get(expense.paid_by) ?? 0) + amountCents,
    );

    const breakdown = Array.isArray(expense.split_breakdown)
      ? expense.split_breakdown
      : [];
    for (const part of breakdown) {
      if (!part || typeof part.user_id !== "string") continue;
      const shareCents = Math.trunc(part.share_cents ?? 0);
      netBalanceByUser.set(
        part.user_id,
        (netBalanceByUser.get(part.user_id) ?? 0) - shareCents,
      );
    }
  }

  for (const settlement of settlements) {
    const amountCents = Math.trunc(settlement.amount_cents);
    netBalanceByUser.set(
      settlement.payer_id,
      (netBalanceByUser.get(settlement.payer_id) ?? 0) + amountCents,
    );
    netBalanceByUser.set(
      settlement.recipient_id,
      (netBalanceByUser.get(settlement.recipient_id) ?? 0) - amountCents,
    );
  }

  const userNetLedgerCents = netBalanceByUser.get(currentUserId) ?? 0;
  const isFullySettled = Array.from(netBalanceByUser.values()).every(
    (bal) => bal === 0,
  );

  return {
    cycleTurnoverCents,
    cycleTransactionCount,
    paidThisPeriodByUser,
    netBalanceByUser,
    userNetLedgerCents,
    isFullySettled,
  };
}

export function toShellGroupSummary(group: SplitGroupDetail): ShellGroupSummary {
  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    status: group.status,
    groupType: group.groupType,
    baseCurrency: group.baseCurrency,
    activeSplitCount: group.cycleTransactionCount,
    members: group.members
      .filter((m) => m.status === "ACTIVE")
      .map((m) => ({
        id: m.userId,
        name: m.name,
      })),
  };
}

export interface CreateGroupAuthUser {
  id: string;
  email?: string | null;
  fullName?: string | null;
}

export type CreateSplitGroupResult =
  | { ok: true; group: SplitGroupDetail }
  | { ok: false; message: string; status: number };

export async function createSplitGroup(
  supabase: SupabaseClient<Database>,
  authUser: CreateGroupAuthUser,
  input: CreateGroupInput,
): Promise<CreateSplitGroupResult> {
  const groupId = crypto.randomUUID();
  const slug = buildGroupSlug(input.name);
  const inviteTokenVersion = 1;
  const inviteToken = createSignedInviteToken({
    groupId,
    slug,
    version: inviteTokenVersion,
  });

  const { error: groupInsertError } = await supabase.from("groups").insert({
    id: groupId,
    name: input.name,
    slug,
    group_type: input.group_type,
    status: "ACTIVE",
    base_currency: input.base_currency,
    default_split_mode: "EQUAL",
    simplify_debts: true,
    operational_budget_cents: input.operational_budget_cents,
    billing_cycle_anchor_day: input.billing_cycle_anchor_day,
    lease_end_date: input.lease_end_date,
    invite_token: inviteToken,
    invite_token_version: inviteTokenVersion,
    created_by: authUser.id,
  });

  if (groupInsertError) {
    return {
      ok: false,
      message: groupInsertError.message || "Failed to create split group.",
      status: 500,
    };
  }

  let { error: memberInsertError } = await supabase
    .from("group_members")
    .insert({
      group_id: groupId,
      user_id: authUser.id,
      role: "ADMIN",
      status: "ACTIVE",
      share_percentage: 100,
    });

  // Recover if the auth user lacks a synced public.users profile row yet.
  if (
    memberInsertError &&
    memberInsertError.code === "23503" &&
    authUser.email
  ) {
    const fallbackName =
      authUser.fullName?.trim() ||
      authUser.email.split("@")[0] ||
      "LedgerSplit User";

    await supabase.from("users").upsert(
      {
        id: authUser.id,
        email: authUser.email,
        full_name: fallbackName,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );

    const retry = await supabase.from("group_members").insert({
      group_id: groupId,
      user_id: authUser.id,
      role: "ADMIN",
      status: "ACTIVE",
      share_percentage: 100,
    });
    memberInsertError = retry.error;
  }

  if (memberInsertError) {
    // Best-effort cleanup of the group row if membership insertion fails.
    try {
      await supabase.from("groups").delete().eq("id", groupId);
    } catch {
      // Ignore cleanup failure; RLS blocks unjoined groups from visibility.
    }

    return {
      ok: false,
      message:
        memberInsertError.message ||
        "Failed to assign creator as group admin.",
      status: 500,
    };
  }

  let creatorName = authUser.fullName?.trim() || authUser.email || "You";
  let creatorEmail = authUser.email ?? "";

  try {
    const { data: profileRow } = await supabase
      .from("users")
      .select("id, full_name, email")
      .eq("id", authUser.id)
      .maybeSingle();
    if (profileRow) {
      creatorName = profileRow.full_name || creatorName;
      creatorEmail = profileRow.email || creatorEmail;
    }
  } catch {
    // Fallback to auth metadata when profile lookup is unavailable.
  }

  const initialAuditEntry = await recordGroupAuditEvent(supabase, {
    groupId,
    actorId: authUser.id,
    actorName: creatorName,
    eventType: "GROUP_CREATED",
    summary: `Created ${input.name} (${input.group_type}) with ${creatorName} as Admin`,
    metadata: {
      next_split_mode: "EQUAL",
      details: [
        `Base currency: ${input.base_currency}`,
        `Initial split mode: Equal Split (100% creator share)`,
      ],
    },
  });

  const group: SplitGroupDetail = {
    id: groupId,
    name: input.name,
    slug,
    groupType: input.group_type,
    status: "ACTIVE",
    baseCurrency: input.base_currency,
    defaultSplitMode: "EQUAL",
    simplifyDebts: true,
    operationalBudgetCents: input.operational_budget_cents,
    billingCycleAnchorDay: input.billing_cycle_anchor_day,
    leaseEndDate: input.lease_end_date,
    inviteToken,
    inviteTokenVersion,
    cycleTurnoverCents: 0,
    cycleTransactionCount: 0,
    userNetLedgerCents: 0,
    recurringRuleCount: 0,
    isFullySettled: true,
    currentUserRole: "ADMIN",
    auditLogs: [initialAuditEntry],
    members: [
      {
        userId: authUser.id,
        name: creatorName,
        email: creatorEmail,
        role: "ADMIN",
        status: "ACTIVE",
        sharePercentage: 100,
        paidThisPeriodCents: 0,
        netBalanceCents: 0,
        isCurrentUser: true,
      },
    ],
  };

  return { ok: true, group };
}

export async function getSplitGroupsPageData(
  supabase: SupabaseClient<Database>,
  currentUserId: string,
  cycleSlugInput?: string,
): Promise<SplitGroupsPageData> {
  const cycleSlug = parseCycleParam(cycleSlugInput);

  try {
    const { data: groupRows, error: groupsError } = await supabase
      .from("groups")
      .select(
        "id, name, slug, group_type, status, base_currency, default_split_mode, simplify_debts, operational_budget_cents, billing_cycle_anchor_day, lease_end_date, invite_token, invite_token_version, created_at",
      )
      .order("created_at", { ascending: true });

    if (groupsError) {
      return {
        activeGroups: [],
        archivedGroups: [],
        cycleSlug,
        loadError: groupsError.message || "Unable to load split groups.",
      };
    }

    if (!groupRows || groupRows.length === 0) {
      return {
        activeGroups: [],
        archivedGroups: [],
        cycleSlug,
        loadError: null,
      };
    }

    const groupIds = groupRows.map((g) => g.id);

    const [
      { data: memberRows, error: membersError },
      { data: expenseRows, error: expensesError },
      { data: settlementRows, error: settlementsError },
      { data: recurringRows, error: recurringError },
    ] = await Promise.all([
      supabase
        .from("group_members")
        .select("group_id, user_id, role, status, share_percentage, joined_at")
        .in("group_id", groupIds)
        .order("joined_at", { ascending: true }),
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
      supabase
        .from("recurring_rules")
        .select("group_id, is_active")
        .in("group_id", groupIds)
        .eq("is_active", true),
    ]);

    if (membersError || expensesError || settlementsError || recurringError) {
      const firstErr =
        membersError || expensesError || settlementsError || recurringError;
      return {
        activeGroups: [],
        archivedGroups: [],
        cycleSlug,
        loadError: firstErr?.message || "Unable to load group ledger details.",
      };
    }

    const userIds = Array.from(
      new Set((memberRows ?? []).map((m) => m.user_id)),
    );
    const usersById = new Map<
      string,
      { id: string; full_name: string; email: string }
    >();

    if (userIds.length > 0) {
      const { data: userRows } = await supabase
        .from("users")
        .select("id, full_name, email")
        .in("id", userIds);

      for (const u of userRows ?? []) {
        usersById.set(u.id, u);
      }
    }

    const membersByGroup = new Map<string, typeof memberRows>();
    for (const row of memberRows ?? []) {
      const list = membersByGroup.get(row.group_id) ?? [];
      list.push(row);
      membersByGroup.set(row.group_id, list);
    }

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

    const recurringCountByGroup = new Map<string, number>();
    for (const row of recurringRows ?? []) {
      recurringCountByGroup.set(
        row.group_id,
        (recurringCountByGroup.get(row.group_id) ?? 0) + 1,
      );
    }

    const auditLogsByGroup = new Map<string, GroupAuditLogEntry[]>();
    try {
      const auditTable = supabase.from("group_audit_logs") as unknown as {
        select?: (cols: string) => {
          in?: (col: string, vals: string[]) => {
            order?: (
              col: string,
              opts: { ascending: boolean },
            ) => Promise<{
              data: Array<
                Database["public"]["Tables"]["group_audit_logs"]["Row"]
              > | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
      const inQuery = auditTable
        ?.select?.("id, group_id, actor_id, event_type, summary, metadata, created_at")
        ?.in?.("group_id", groupIds);
      if (inQuery && typeof inQuery.order === "function") {
        const { data: auditRows, error: auditError } = await inQuery.order(
          "created_at",
          { ascending: false },
        );
        if (!auditError && Array.isArray(auditRows)) {
          for (const row of auditRows) {
            const actorProfile = row.actor_id
              ? usersById.get(row.actor_id)
              : undefined;
            const rowMetadata =
              row.metadata &&
              typeof row.metadata === "object" &&
              !Array.isArray(row.metadata)
                ? (row.metadata as Record<string, unknown>)
                : undefined;
            const entry: GroupAuditLogEntry = {
              id: row.id,
              groupId: row.group_id,
              category: classifyAuditCategory(row.event_type),
              eventType: row.event_type,
              actorId: row.actor_id,
              actorName:
                actorProfile?.full_name ||
                actorProfile?.email ||
                (row.actor_id ? "Group Member" : "System"),
              summary: row.summary,
              details: extractAuditDetails(
                row.event_type,
                rowMetadata,
                usersById,
              ),
              createdAt: row.created_at,
              metadata: rowMetadata,
            };
            const list = auditLogsByGroup.get(row.group_id) ?? [];
            list.push(entry);
            auditLogsByGroup.set(row.group_id, list);
          }
        }
      }
    } catch {
      // Gracefully skip if audit table is unmocked or unavailable.
    }

    const activeGroups: SplitGroupDetail[] = [];
    const archivedGroups: SplitGroupDetail[] = [];

    for (const g of groupRows) {
      const groupMembers = membersByGroup.get(g.id) ?? [];
      const memberIds = groupMembers.map((m) => m.user_id);

      const metrics = computeGroupLedgerMetrics({
        expenses: expensesByGroup.get(g.id) ?? [],
        settlements: settlementsByGroup.get(g.id) ?? [],
        memberIds,
        currentUserId,
        cycleSlug,
        anchorDay: g.billing_cycle_anchor_day,
      });

      const members: SplitGroupMemberDetail[] = groupMembers.map((m) => {
        const profile = usersById.get(m.user_id);
        return {
          userId: m.user_id,
          name: profile?.full_name || profile?.email || "Member",
          email: profile?.email ?? "",
          role: m.role,
          status: m.status,
          sharePercentage: Number(m.share_percentage),
          paidThisPeriodCents: metrics.paidThisPeriodByUser.get(m.user_id) ?? 0,
          netBalanceCents: metrics.netBalanceByUser.get(m.user_id) ?? 0,
          isCurrentUser: m.user_id === currentUserId,
        };
      });

      const currentMember = members.find((m) => m.isCurrentUser) ?? null;

      const detail: SplitGroupDetail = {
        id: g.id,
        name: g.name,
        slug: g.slug,
        groupType: g.group_type,
        status: g.status,
        baseCurrency: g.base_currency,
        defaultSplitMode: g.default_split_mode,
        simplifyDebts: g.simplify_debts,
        operationalBudgetCents: g.operational_budget_cents,
        billingCycleAnchorDay: g.billing_cycle_anchor_day,
        leaseEndDate: g.lease_end_date,
        inviteToken: g.invite_token,
        inviteTokenVersion: g.invite_token_version ?? 1,
        cycleTurnoverCents: metrics.cycleTurnoverCents,
        cycleTransactionCount: metrics.cycleTransactionCount,
        userNetLedgerCents: metrics.userNetLedgerCents,
        recurringRuleCount: recurringCountByGroup.get(g.id) ?? 0,
        isFullySettled: metrics.isFullySettled,
        members,
        currentUserRole: currentMember?.role ?? null,
        auditLogs: auditLogsByGroup.get(g.id),
      };

      if (g.status === "ARCHIVED") {
        archivedGroups.push(detail);
      } else {
        activeGroups.push(detail);
      }
    }

    return {
      activeGroups,
      archivedGroups,
      cycleSlug,
      loadError: null,
    };
  } catch (err) {
    return {
      activeGroups: [],
      archivedGroups: [],
      cycleSlug,
      loadError:
        err instanceof Error ? err.message : "Unable to load split groups.",
    };
  }
}
