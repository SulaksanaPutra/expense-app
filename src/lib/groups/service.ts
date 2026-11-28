import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShellGroupSummary } from "@/components/shell/types";
import { parseCycleParam } from "@/components/shell/url-state";
import {
  isBillingCycleClosedForWindow,
  type ExpenseBillingCycleRecord,
} from "@/lib/expenses/ledger";
import { isValidCurrencyCode } from "@/lib/money";
import type {
  Database,
  GroupCategory,
  GroupType,
  SplitBreakdownItem,
  SplitMode,
} from "@/types/database";
import type {
  CreateGroupInput,
  SplitGroupDetail,
  SplitGroupMemberDetail,
  SplitGroupsPageData,
  UpdateGroupInput,
} from "./types";
import { createSignedInviteToken } from "./invite-token";
import {
  DEFAULT_TRIP_AUTO_ARCHIVE_DAYS,
  evaluateResidentialLeasePrompt,
  evaluateTripAutoArchive,
} from "./archive";
import {
  classifyAuditCategory,
  extractAuditDetails,
  recordGroupAuditEvent,
  type GroupAuditLogEntry,
} from "./audit-log";
import { getActiveReminderCooldowns } from "./reminders";

const VALID_GROUP_TYPES: readonly GroupType[] = [
  "RESIDENTIAL",
  "TRIP",
  "RECURRING",
];

export const VALID_GROUP_CATEGORIES: readonly GroupCategory[] = [
  "HOME",
  "TRIP",
  "DINING",
  "UTILITIES",
  "OTHER",
];

export const VALID_DEFAULT_SPLIT_MODES: readonly SplitMode[] = [
  "EQUAL",
  "PERCENTAGE",
  "SHARES",
  "CUSTOM",
  "CUSTOM_RATIOS",
];

const ISO_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


function isMissingSchemaColumnError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

function isLegacySplitModeConstraintError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return err.code === "23514" && msg.includes("default_split_mode");
}

function toLegacySplitMode(mode: SplitMode): "EQUAL" | "CUSTOM_RATIOS" {
  return mode === "EQUAL" ? "EQUAL" : "CUSTOM_RATIOS";
}

export function categoryToGroupType(category: GroupCategory): GroupType {
  switch (category) {
    case "HOME":
      return "RESIDENTIAL";
    case "TRIP":
      return "TRIP";
    case "DINING":
    case "UTILITIES":
    case "OTHER":
      return "RECURRING";
  }
}

export function groupTypeToCategory(groupType: GroupType): GroupCategory {
  switch (groupType) {
    case "RESIDENTIAL":
      return "HOME";
    case "TRIP":
      return "TRIP";
    case "RECURRING":
      return "UTILITIES";
  }
}

export function resolveGroupCategory(group: {
  category?: GroupCategory | null;
  groupType?: GroupType | null;
}): GroupCategory {
  if (
    group.category &&
    VALID_GROUP_CATEGORIES.includes(group.category)
  ) {
    return group.category;
  }
  if (group.groupType && VALID_GROUP_TYPES.includes(group.groupType)) {
    return groupTypeToCategory(group.groupType);
  }
  return "OTHER";
}

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

function parseEmailList(
  raw: unknown,
  fieldKey: string,
  errors: Record<string, string>,
): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors[fieldKey] = "Member emails must be an array of email addresses.";
    return [];
  }
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      errors[fieldKey] = "Each member email must be a valid email address.";
      return [];
    }
    const normalized = item.trim().toLowerCase();
    if (!normalized) continue;
    if (!EMAIL_REGEX.test(normalized)) {
      errors[fieldKey] = `Invalid email address: ${item}`;
      return [];
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      emails.push(normalized);
    }
  }
  return emails;
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

  let resolvedCategory: GroupCategory = "HOME";
  let resolvedType: GroupType = "RESIDENTIAL";

  const hasCategory =
    input.category !== undefined &&
    input.category !== null &&
    String(input.category).trim() !== "";
  const hasGroupType =
    input.group_type !== undefined &&
    input.group_type !== null &&
    String(input.group_type).trim() !== "";

  if (hasCategory) {
    const normalizedCategory = String(input.category).trim().toUpperCase();
    if (!VALID_GROUP_CATEGORIES.includes(normalizedCategory as GroupCategory)) {
      errors.category =
        "Category must be HOME, TRIP, DINING, UTILITIES, or OTHER.";
    } else {
      resolvedCategory = normalizedCategory as GroupCategory;
      resolvedType = categoryToGroupType(resolvedCategory);
    }
  }

  if (hasGroupType) {
    const normalizedType = String(input.group_type).trim().toUpperCase();
    if (!VALID_GROUP_TYPES.includes(normalizedType as GroupType)) {
      errors.group_type =
        "Group type must be RESIDENTIAL, TRIP, or RECURRING.";
    } else {
      resolvedType = normalizedType as GroupType;
      if (!hasCategory) {
        resolvedCategory = groupTypeToCategory(resolvedType);
      }
    }
  } else if (!hasCategory) {
    errors.category =
      "Category must be HOME, TRIP, DINING, UTILITIES, or OTHER.";
  }

  const rawSplitMode =
    input.default_split_mode === undefined ||
    input.default_split_mode === null ||
    String(input.default_split_mode).trim() === ""
      ? "EQUAL"
      : String(input.default_split_mode).trim().toUpperCase();

  let resolvedSplitMode: SplitMode = "EQUAL";
  if (!VALID_DEFAULT_SPLIT_MODES.includes(rawSplitMode as SplitMode)) {
    errors.default_split_mode =
      "Default split method must be EQUAL, PERCENTAGE, SHARES, or CUSTOM.";
  } else {
    resolvedSplitMode = rawSplitMode as SplitMode;
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

  const memberEmails = parseEmailList(
    input.member_emails,
    "member_emails",
    errors,
  );

  if (Object.keys(errors).length > 0) {
    const firstMsg = Object.values(errors)[0] ?? "Validation failed.";
    return { ok: false, errors, message: firstMsg };
  }

  return {
    ok: true,
    data: {
      name: rawName,
      category: resolvedCategory,
      group_type: resolvedType,
      base_currency: rawCurrency,
      default_split_mode: resolvedSplitMode,
      operational_budget_cents: budgetCents,
      billing_cycle_anchor_day: anchorRaw,
      lease_end_date: leaseEndDate,
      member_emails: memberEmails,
    },
  };
}

export type UpdateGroupValidationResult =
  | { ok: true; data: UpdateGroupInput }
  | { ok: false; errors: Record<string, string>; message: string };

export function validateUpdateGroupPayload(
  raw: unknown,
): UpdateGroupValidationResult {
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      errors: { form: "Invalid request payload." },
      message: "Invalid request payload.",
    };
  }

  const input = raw as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const data: UpdateGroupInput = {};

  if (input.name !== undefined) {
    const rawName = typeof input.name === "string" ? input.name.trim() : "";
    if (!rawName) {
      errors.name = "Group name is required.";
    } else if (rawName.length < 2) {
      errors.name = "Group name must be at least 2 characters.";
    } else if (rawName.length > 80) {
      errors.name = "Group name must be 80 characters or fewer.";
    } else {
      data.name = rawName;
    }
  }

  if (input.category !== undefined) {
    const normalized =
      typeof input.category === "string"
        ? input.category.trim().toUpperCase()
        : "";
    if (!VALID_GROUP_CATEGORIES.includes(normalized as GroupCategory)) {
      errors.category =
        "Category must be HOME, TRIP, DINING, UTILITIES, or OTHER.";
    } else {
      data.category = normalized as GroupCategory;
    }
  }

  if (input.base_currency !== undefined) {
    const rawCurrency =
      typeof input.base_currency === "string"
        ? input.base_currency.trim().toUpperCase()
        : "";
    if (!isValidCurrencyCode(rawCurrency)) {
      errors.base_currency = "Base currency must be a 3-letter ISO-4217 code.";
    } else {
      data.base_currency = rawCurrency;
    }
  }

  if (input.default_split_mode !== undefined) {
    const rawSplitMode =
      typeof input.default_split_mode === "string"
        ? input.default_split_mode.trim().toUpperCase()
        : "";
    if (!VALID_DEFAULT_SPLIT_MODES.includes(rawSplitMode as SplitMode)) {
      errors.default_split_mode =
        "Default split method must be EQUAL, PERCENTAGE, SHARES, or CUSTOM.";
    } else {
      data.default_split_mode = rawSplitMode as SplitMode;
    }
  }

  if (input.add_member_emails !== undefined) {
    data.add_member_emails = parseEmailList(
      input.add_member_emails,
      "add_member_emails",
      errors,
    );
  }

  if (input.remove_member_ids !== undefined) {
    if (!Array.isArray(input.remove_member_ids)) {
      errors.remove_member_ids = "Removed member IDs must be an array.";
    } else {
      const ids: string[] = [];
      for (const id of input.remove_member_ids) {
        if (typeof id !== "string" || !id.trim()) {
          errors.remove_member_ids = "Invalid member ID in remove_member_ids.";
          break;
        }
        ids.push(id.trim());
      }
      data.remove_member_ids = Array.from(new Set(ids));
    }
  }

  if (Object.keys(errors).length > 0) {
    const firstMsg = Object.values(errors)[0] ?? "Validation failed.";
    return { ok: false, errors, message: firstMsg };
  }

  if (Object.keys(data).length === 0) {
    return {
      ok: false,
      errors: { form: "At least one field must be provided to update." },
      message: "At least one field must be provided to update.",
    };
  }

  return { ok: true, data };
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
  shareThisPeriodByUser: Map<string, number>;
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
  const shareThisPeriodByUser = new Map<string, number>();
  const netBalanceByUser = new Map<string, number>();

  for (const id of memberIds) {
    paidThisPeriodByUser.set(id, 0);
    shareThisPeriodByUser.set(id, 0);
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
      if (inCycle) {
        shareThisPeriodByUser.set(
          part.user_id,
          (shareThisPeriodByUser.get(part.user_id) ?? 0) + shareCents,
        );
      }
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
    shareThisPeriodByUser,
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
    category: resolveGroupCategory(group),
    baseCurrency: group.baseCurrency,
    defaultSplitMode: group.defaultSplitMode,
    activeSplitCount: group.cycleTransactionCount,
    members: group.members
      .filter((m) => m.status === "ACTIVE")
      .map((m) => ({
        id: m.userId,
        name: m.name,
        sharePercentage: m.sharePercentage,
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

  let { error: groupInsertError } = await supabase.from("groups").insert({
    id: groupId,
    name: input.name,
    slug,
    group_type: input.group_type,
    category: input.category,
    status: "ACTIVE",
    base_currency: input.base_currency,
    default_split_mode: input.default_split_mode,
    operational_budget_cents: input.operational_budget_cents,
    billing_cycle_anchor_day: input.billing_cycle_anchor_day,
    cycle_reset_day: input.billing_cycle_anchor_day,
    invite_token: inviteToken,
    invite_token_version: inviteTokenVersion,
    created_by: authUser.id,
  });

  if (
    isMissingSchemaColumnError(groupInsertError) ||
    isLegacySplitModeConstraintError(groupInsertError)
  ) {
    const retry = await supabase.from("groups").insert({
      id: groupId,
      name: input.name,
      slug,
      group_type: input.group_type,
      status: "ACTIVE",
      base_currency: input.base_currency,
      default_split_mode: toLegacySplitMode(input.default_split_mode),
      operational_budget_cents: input.operational_budget_cents,
      billing_cycle_anchor_day: input.billing_cycle_anchor_day,
      invite_token: inviteToken,
      invite_token_version: inviteTokenVersion,
      created_by: authUser.id,
    });
    groupInsertError = retry.error;
  }

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

  const normalizedCreatorEmail = creatorEmail.trim().toLowerCase();
  const emailsToInvite = (input.member_emails ?? []).filter(
    (email) => email !== normalizedCreatorEmail,
  );

  if (emailsToInvite.length > 0) {
    try {
      const inviteRows = emailsToInvite.map((email) => ({
        group_id: groupId,
        invited_email: email,
        invited_by: authUser.id,
        token: crypto.randomUUID().replace(/-/g, ""),
        status: "PENDING" as const,
      }));
      const invitesTable = supabase.from("group_invites") as unknown as {
        insert?: (rows: typeof inviteRows) => Promise<{ error: unknown }>;
      };
      if (typeof invitesTable?.insert === "function") {
        await invitesTable.insert(inviteRows);
      }
    } catch {
      // Best-effort invite creation when table is unavailable in unit mocks.
    }
  }

  const initialAuditEntry = await recordGroupAuditEvent(supabase, {
    groupId,
    actorId: authUser.id,
    actorName: creatorName,
    eventType: "GROUP_CREATED",
    summary: `Created ${input.name} (${input.category}) with ${creatorName} as Admin`,
    metadata: {
      next_split_mode: input.default_split_mode,
      details: [
        `Category: ${input.category}`,
        `Base currency: ${input.base_currency}`,
        `Initial split mode: ${input.default_split_mode}`,
      ],
    },
  });

  const group: SplitGroupDetail = {
    id: groupId,
    name: input.name,
    slug,
    groupType: input.group_type,
    category: input.category,
    status: "ACTIVE",
    baseCurrency: input.base_currency,
    defaultSplitMode: input.default_split_mode,
    simplifyDebts: true,
    operationalBudgetCents: input.operational_budget_cents,
    billingCycleAnchorDay: input.billing_cycle_anchor_day,
    leaseEndDate: input.lease_end_date,
    tripAutoArchiveEnabled: true,
    tripAutoArchiveDays: DEFAULT_TRIP_AUTO_ARCHIVE_DAYS,
    residentialLeasePromptEnabled: true,
    zeroBalanceSince: null,
    leasePromptSnoozedUntil: null,
    shouldPromptLeaseArchive: false,
    daysSinceLeaseEnd: null,
    archivedAt: null,
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

export type UpdateSplitGroupResult =
  | {
      ok: true;
      group: SplitGroupDetail;
      invitedEmails: string[];
      removedMemberIds: string[];
    }
  | { ok: false; message: string; status: number };

export async function updateSplitGroup(
  supabase: SupabaseClient<Database>,
  authUser: CreateGroupAuthUser,
  groupId: string,
  input: UpdateGroupInput,
): Promise<UpdateSplitGroupResult> {
  let { data: existingGroup, error: fetchError } = await supabase
    .from("groups")
    .select(
      "id, name, slug, group_type, category, status, base_currency, default_split_mode, operational_budget_cents, billing_cycle_anchor_day, trip_auto_archive_enabled, trip_auto_archive_days, residential_lease_prompt_enabled, zero_balance_since, lease_prompt_snoozed_until, archived_at, invite_token, invite_token_version",
    )
    .eq("id", groupId)
    .maybeSingle();

  if (isMissingSchemaColumnError(fetchError)) {
    const fallback = await supabase
      .from("groups")
      .select(
        "id, name, slug, group_type, status, base_currency, default_split_mode, operational_budget_cents, billing_cycle_anchor_day, trip_auto_archive_enabled, trip_auto_archive_days, residential_lease_prompt_enabled, zero_balance_since, lease_prompt_snoozed_until, archived_at, invite_token, invite_token_version",
      )
      .eq("id", groupId)
      .maybeSingle();
    existingGroup = fallback.data
      ? ({
          ...fallback.data,
          category: groupTypeToCategory(fallback.data.group_type),
        } as typeof existingGroup)
      : null;
    fetchError = fallback.error;
  }

  if (fetchError) {
    return {
      ok: false,
      message: fetchError.message || "Unable to load group.",
      status: 500,
    };
  }

  if (!existingGroup) {
    return { ok: false, message: "Group not found.", status: 404 };
  }

  if (existingGroup.status === "ARCHIVED") {
    return {
      ok: false,
      message: "Archived groups are read-only and cannot be edited.",
      status: 403,
    };
  }

  const { data: membership, error: memberErr } = await supabase
    .from("group_members")
    .select("role, status")
    .eq("group_id", groupId)
    .eq("user_id", authUser.id)
    .maybeSingle();

  if (memberErr) {
    return {
      ok: false,
      message: memberErr.message || "Unable to verify group permissions.",
      status: 500,
    };
  }

  if (!membership || membership.role !== "ADMIN" || membership.status !== "ACTIVE") {
    return {
      ok: false,
      message: "Only active group admins can edit group settings.",
      status: 403,
    };
  }

  const updatePatch: Database["public"]["Tables"]["groups"]["Update"] = {};
  if (input.name !== undefined) {
    updatePatch.name = input.name;
  }
  if (input.category !== undefined) {
    updatePatch.category = input.category;
    updatePatch.group_type = categoryToGroupType(input.category);
  }
  if (input.base_currency !== undefined) {
    updatePatch.base_currency = input.base_currency;
  }
  if (input.default_split_mode !== undefined) {
    updatePatch.default_split_mode = input.default_split_mode;
  }

  if (Object.keys(updatePatch).length > 0) {
    let { error: updateError } = await supabase
      .from("groups")
      .update(updatePatch)
      .eq("id", groupId);

    if (
      isMissingSchemaColumnError(updateError) ||
      isLegacySplitModeConstraintError(updateError)
    ) {
      const legacyPatch: Database["public"]["Tables"]["groups"]["Update"] = {
        ...updatePatch,
      };
      delete legacyPatch.category;
      if (legacyPatch.default_split_mode) {
        legacyPatch.default_split_mode = toLegacySplitMode(
          legacyPatch.default_split_mode,
        );
      }
      if (Object.keys(legacyPatch).length > 0) {
        const retry = await supabase
          .from("groups")
          .update(legacyPatch)
          .eq("id", groupId);
        updateError = retry.error;
      } else {
        updateError = null;
      }
    }

    if (updateError) {
      return {
        ok: false,
        message: updateError.message || "Failed to update group.",
        status: 500,
      };
    }
  }

  const removedMemberIds: string[] = [];
  if (input.remove_member_ids && input.remove_member_ids.length > 0) {
    for (const targetUserId of input.remove_member_ids) {
      if (targetUserId === authUser.id) continue;
      const { error: removeErr } = await supabase
        .from("group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", targetUserId);
      if (!removeErr) {
        removedMemberIds.push(targetUserId);
      }
    }
  }

  const invitedEmails: string[] = [];
  if (input.add_member_emails && input.add_member_emails.length > 0) {
    const normalizedActorEmail = (authUser.email ?? "").trim().toLowerCase();
    const candidates = input.add_member_emails.filter(
      (email) => email !== normalizedActorEmail,
    );
    if (candidates.length > 0) {
      try {
        const inviteRows = candidates.map((email) => ({
          group_id: groupId,
          invited_email: email,
          invited_by: authUser.id,
          token: crypto.randomUUID().replace(/-/g, ""),
          status: "PENDING" as const,
        }));
        const invitesTable = supabase.from("group_invites") as unknown as {
          insert?: (rows: typeof inviteRows) => Promise<{ error: unknown }>;
        };
        if (typeof invitesTable?.insert === "function") {
          const { error: inviteErr } = await invitesTable.insert(inviteRows);
          if (!inviteErr) {
            invitedEmails.push(...candidates);
          }
        }
      } catch {
        // Non-fatal in partial mock environments.
      }
    }
  }

  const nextCategory =
    input.category ??
    existingGroup.category ??
    groupTypeToCategory(existingGroup.group_type);
  const nextGroupType =
    input.category !== undefined
      ? categoryToGroupType(input.category)
      : existingGroup.group_type;
  const nextName = input.name ?? existingGroup.name;
  const nextCurrency = input.base_currency ?? existingGroup.base_currency;
  const nextSplitMode =
    input.default_split_mode ?? existingGroup.default_split_mode;

  const actorName = authUser.fullName?.trim() || authUser.email || "Group Admin";

  if (
    input.default_split_mode &&
    input.default_split_mode !== existingGroup.default_split_mode
  ) {
    await recordGroupAuditEvent(supabase, {
      groupId,
      actorId: authUser.id,
      actorName,
      eventType: "SPLIT_MODE_CHANGED",
      summary: `Updated ${nextName} split method to ${nextSplitMode}`,
      metadata: {
        previous_split_mode: existingGroup.default_split_mode,
        next_split_mode: nextSplitMode,
      },
    });
  }

  // Hydrate updated members list cleanly
  let members: SplitGroupMemberDetail[] = [];
  try {
    const { data: memberRows } = await supabase
      .from("group_members")
      .select("group_id, user_id, role, status, share_percentage, joined_at")
      .eq("group_id", groupId)
      .order("joined_at", { ascending: true });

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

    members = (memberRows ?? []).map((m) => {
      const profile = usersById.get(m.user_id);
      return {
        userId: m.user_id,
        name: profile?.full_name || profile?.email || "Member",
        email: profile?.email ?? "",
        role: m.role,
        status: m.status,
        sharePercentage: Number(m.share_percentage),
        paidThisPeriodCents: 0,
        netBalanceCents: 0,
        isCurrentUser: m.user_id === authUser.id,
      };
    });
  } catch {
    members = [];
  }

  const updatedGroup: SplitGroupDetail = {
    id: existingGroup.id,
    name: nextName,
    slug: existingGroup.slug,
    groupType: nextGroupType,
    category: nextCategory,
    status: existingGroup.status,
    baseCurrency: nextCurrency,
    defaultSplitMode: nextSplitMode,
    simplifyDebts: true,
    operationalBudgetCents: existingGroup.operational_budget_cents,
    billingCycleAnchorDay: existingGroup.billing_cycle_anchor_day,
    leaseEndDate: null,
    tripAutoArchiveEnabled: existingGroup.trip_auto_archive_enabled ?? true,
    tripAutoArchiveDays:
      existingGroup.trip_auto_archive_days ?? DEFAULT_TRIP_AUTO_ARCHIVE_DAYS,
    residentialLeasePromptEnabled:
      existingGroup.residential_lease_prompt_enabled ?? true,
    zeroBalanceSince: existingGroup.zero_balance_since ?? null,
    leasePromptSnoozedUntil: existingGroup.lease_prompt_snoozed_until ?? null,
    archivedAt: existingGroup.archived_at ?? null,
    inviteToken: existingGroup.invite_token,
    inviteTokenVersion: existingGroup.invite_token_version ?? 1,
    cycleTurnoverCents: 0,
    cycleTransactionCount: 0,
    userNetLedgerCents: 0,
    recurringRuleCount: 0,
    isFullySettled: true,
    currentUserRole: "ADMIN",
    members,
  };

  return {
    ok: true,
    group: updatedGroup,
    invitedEmails,
    removedMemberIds,
  };
}

export async function getSplitGroupsPageData(
  supabase: SupabaseClient<Database>,
  currentUserId: string,
  cycleSlugInput?: string,
): Promise<SplitGroupsPageData> {
  const cycleSlug = parseCycleParam(cycleSlugInput);

  try {
    let { data: groupRows, error: groupsError } = await supabase
      .from("groups")
      .select(
        "id, name, slug, group_type, category, status, base_currency, default_split_mode, operational_budget_cents, billing_cycle_anchor_day, trip_auto_archive_enabled, trip_auto_archive_days, residential_lease_prompt_enabled, zero_balance_since, lease_prompt_snoozed_until, archived_at, invite_token, invite_token_version, created_at",
      )
      .order("created_at", { ascending: true });

    if (isMissingSchemaColumnError(groupsError)) {
      const fallback = await supabase
        .from("groups")
        .select(
          "id, name, slug, group_type, status, base_currency, default_split_mode, operational_budget_cents, billing_cycle_anchor_day, trip_auto_archive_enabled, trip_auto_archive_days, residential_lease_prompt_enabled, zero_balance_since, lease_prompt_snoozed_until, archived_at, invite_token, invite_token_version, created_at",
        )
        .order("created_at", { ascending: true });
      groupRows = (fallback.data ?? []).map((row) => ({
        ...row,
        category: groupTypeToCategory(row.group_type),
      })) as typeof groupRows;
      groupsError = fallback.error;
    }

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
      { data: billingCycleRows },
      reminderCooldowns,
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
      Promise.resolve()
        .then(() =>
          supabase
            .from("billing_cycles")
            .select("id, group_id, period_start, period_end, status")
            .in("group_id", groupIds),
        )
        .catch(() => ({ data: [] })),
      getActiveReminderCooldowns(supabase, currentUserId, groupIds),
    ]);

    if (membersError || expensesError || settlementsError) {
      const firstErr = membersError || expensesError || settlementsError;
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
    const now = new Date();
    const nowIso = now.toISOString();

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

      const tripAutoArchiveEnabled = g.trip_auto_archive_enabled ?? true;
      const tripAutoArchiveDays =
        g.trip_auto_archive_days ?? DEFAULT_TRIP_AUTO_ARCHIVE_DAYS;
      const residentialLeasePromptEnabled =
        g.residential_lease_prompt_enabled ?? true;
      let zeroBalanceSince = g.zero_balance_since ?? null;
      const leasePromptSnoozedUntil = g.lease_prompt_snoozed_until ?? null;
      let effectiveStatus = g.status;
      let archivedAt = g.archived_at ?? null;

      if (g.group_type === "TRIP" && effectiveStatus !== "ARCHIVED") {
        const tripEval = evaluateTripAutoArchive(
          {
            groupType: g.group_type,
            status: effectiveStatus,
            tripAutoArchiveEnabled,
            tripAutoArchiveDays,
            isFullySettled: metrics.isFullySettled,
            zeroBalanceSince,
          },
          now,
        );

        if (tripEval.shouldAutoArchive) {
          effectiveStatus = "ARCHIVED";
          archivedAt = nowIso;
          zeroBalanceSince = tripEval.nextZeroBalanceSince;
          try {
            const groupsTable = supabase.from("groups") as unknown as {
              update?: (patch: Record<string, unknown>) => {
                eq?: (col: string, val: string) => Promise<{ error: unknown }>;
              };
            };
            const updater = groupsTable?.update?.({
              status: "ARCHIVED",
              archived_at: nowIso,
              zero_balance_since: zeroBalanceSince,
            });
            if (updater && typeof updater.eq === "function") {
              await updater.eq("id", g.id);
              const autoArchiveEntry = await recordGroupAuditEvent(supabase, {
                groupId: g.id,
                actorId: null,
                actorName: "System",
                eventType: "GROUP_ARCHIVED",
                summary: `Auto-archived ${g.name} after ${tripEval.daysAtZeroBalance} days at zero balance`,
                metadata: {
                  archive_reason: `Trip auto-archive triggered (${tripEval.daysAtZeroBalance} days at $0.00 balance).`,
                },
              });
              const list = auditLogsByGroup.get(g.id) ?? [];
              list.unshift(autoArchiveEntry);
              auditLogsByGroup.set(g.id, list);
            }
          } catch {
            // Non-fatal in read-only or partial mock contexts.
          }
        } else if (tripEval.nextZeroBalanceSince !== zeroBalanceSince) {
          zeroBalanceSince = tripEval.nextZeroBalanceSince;
          try {
            const groupsTable = supabase.from("groups") as unknown as {
              update?: (patch: Record<string, unknown>) => {
                eq?: (col: string, val: string) => Promise<{ error: unknown }>;
              };
            };
            const updater = groupsTable?.update?.({
              zero_balance_since: zeroBalanceSince,
            });
            if (updater && typeof updater.eq === "function") {
              await updater.eq("id", g.id);
            }
          } catch {
            // Non-fatal in read-only or partial mock contexts.
          }
        }
      }

      const leaseEval = evaluateResidentialLeasePrompt(
        {
          groupType: g.group_type,
          status: effectiveStatus,
          residentialLeasePromptEnabled,
          leaseEndDate: null,
          leasePromptSnoozedUntil,
        },
        now,
      );

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
          shareThisPeriodCents: metrics.shareThisPeriodByUser.get(m.user_id) ?? 0,
          netBalanceCents: metrics.netBalanceByUser.get(m.user_id) ?? 0,
          isCurrentUser: m.user_id === currentUserId,
        };
      });

      const currentMember = members.find((m) => m.isCurrentUser) ?? null;

      const billingCyclesForGroup: ExpenseBillingCycleRecord[] = (
        billingCycleRows ?? []
      )
        .filter((bc) => bc.group_id === g.id)
        .map((bc) => ({
          id: bc.id,
          groupId: bc.group_id,
          periodStart: bc.period_start,
          periodEnd: bc.period_end,
          status: bc.status,
        }));

      const isCurrentCycleClosed = isBillingCycleClosedForWindow(
        g.id,
        cycleSlug,
        g.billing_cycle_anchor_day,
        billingCyclesForGroup,
      );

      const detail: SplitGroupDetail = {
        id: g.id,
        name: g.name,
        slug: g.slug,
        groupType: g.group_type,
        category: g.category ?? groupTypeToCategory(g.group_type),
        status: effectiveStatus,
        baseCurrency: g.base_currency,
        defaultSplitMode: g.default_split_mode,
        simplifyDebts: true,
        operationalBudgetCents: g.operational_budget_cents,
        billingCycleAnchorDay: g.billing_cycle_anchor_day,
        leaseEndDate: null,
        tripAutoArchiveEnabled,
        tripAutoArchiveDays,
        residentialLeasePromptEnabled,
        zeroBalanceSince,
        leasePromptSnoozedUntil,
        shouldPromptLeaseArchive: leaseEval.shouldPromptLeaseArchive,
        daysSinceLeaseEnd: leaseEval.daysSinceLeaseEnd,
        archivedAt,
        inviteToken: g.invite_token,
        inviteTokenVersion: g.invite_token_version ?? 1,
        cycleTurnoverCents: metrics.cycleTurnoverCents,
        cycleTransactionCount: metrics.cycleTransactionCount,
        userNetLedgerCents: metrics.userNetLedgerCents,
        recurringRuleCount: recurringCountByGroup.get(g.id) ?? 0,
        isFullySettled: metrics.isFullySettled,
        isCurrentCycleClosed,
        members,
        currentUserRole: currentMember?.role ?? null,
        auditLogs: auditLogsByGroup.get(g.id),
      };

      if (effectiveStatus === "ARCHIVED") {
        archivedGroups.push(detail);
      } else {
        activeGroups.push(detail);
      }
    }

    return {
      activeGroups,
      archivedGroups,
      cycleSlug,
      reminderCooldowns,
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
