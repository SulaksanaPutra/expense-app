import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDefaultSplitExcludingFormerMembers } from "@/lib/groups/invite-utils";
import type {
  Database,
  ExpenseSplitMethod,
  SplitMode,
} from "@/types/database";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_MAX_CATCH_UP_MONTHS = 24;

export function isValidIsoDateString(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [yStr, mStr, dStr] = value.split("-");
  const y = Number.parseInt(yStr, 10);
  const m = Number.parseInt(mStr, 10);
  const d = Number.parseInt(dStr, 10);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}

/**
 * Computes the initial next_run_date (YYYY-MM-DD) for a monthly RecurringRule.
 * If dayOfMonth >= today's UTC day, schedules within the current month;
 * otherwise schedules for the same day in the following month.
 */
export function computeInitialNextRunDate(
  dayOfMonth: number,
  referenceDate: Date = new Date(),
): string {
  const safeDay = Math.min(Math.max(Math.trunc(dayOfMonth), 1), 28);
  const year = referenceDate.getUTCFullYear();
  const monthIdx = referenceDate.getUTCMonth();
  const currentDay = referenceDate.getUTCDate();

  const targetMonthIdx = safeDay >= currentDay ? monthIdx : monthIdx + 1;
  const target = new Date(Date.UTC(year, targetMonthIdx, safeDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Advances a YYYY-MM-DD run date by one monthly period snapped to dayOfMonth (1..28).
 */
export function computeNextMonthlyRunDate(
  currentRunDate: string,
  dayOfMonth: number,
): string {
  const safeDay = Math.min(Math.max(Math.trunc(dayOfMonth), 1), 28);
  const [yStr, mStr] = currentRunDate.slice(0, 10).split("-");
  const year = Number.parseInt(yStr, 10);
  const monthIdx = Number.parseInt(mStr, 10) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIdx)) {
    return computeInitialNextRunDate(safeDay);
  }
  const next = new Date(Date.UTC(year, monthIdx + 1, safeDay));
  return next.toISOString().slice(0, 10);
}

export interface MaterializedExpenseSummary {
  expenseId: string;
  ruleId: string;
  groupId: string;
  occurrenceDate: string;
  amountCents: number;
  currency: string;
}

export interface SkippedRecurringRuleSummary {
  ruleId: string;
  groupId: string;
  reason:
    | "GROUP_NOT_FOUND"
    | "GROUP_ARCHIVED"
    | "NO_ACTIVE_MEMBERS"
    | "PAYER_NOT_ACTIVE"
    | "NEEDS_RATIO_UPDATE"
    | "INVALID_CUSTOM_RATIOS"
    | "ALREADY_MATERIALIZED"
    | "INSERT_ERROR";
  message: string;
}

export interface MaterializeRecurringRulesSummary {
  runDate: string;
  evaluatedRuleCount: number;
  materializedCount: number;
  alreadyMaterializedCount: number;
  advancedRuleCount: number;
  materializedExpenses: MaterializedExpenseSummary[];
  skippedRules: SkippedRecurringRuleSummary[];
}

export type MaterializeRecurringRulesResult =
  | { ok: true; summary: MaterializeRecurringRulesSummary }
  | { ok: false; message: string };

export async function materializeDueRecurringRules(
  supabase: SupabaseClient<Database>,
  options?: {
    runDate?: string;
    groupId?: string;
    groupIds?: readonly string[];
    actorUserId?: string;
    maxCatchUpMonths?: number;
  },
): Promise<MaterializeRecurringRulesResult> {
  const runDate = options?.runDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  if (!isValidIsoDateString(runDate)) {
    return { ok: false, message: "runDate must be a valid YYYY-MM-DD date." };
  }

  const maxCatchUp = Math.max(
    1,
    Math.min(Math.trunc(options?.maxCatchUpMonths ?? DEFAULT_MAX_CATCH_UP_MONTHS), 60),
  );

  let rulesQuery = supabase
    .from("recurring_rules")
    .select(
      "id, group_id, created_by, paid_by, description, category, amount_cents, currency, frequency, day_of_month, split_rule, is_active, next_run_date",
    )
    .eq("is_active", true)
    .lte("next_run_date", runDate)
    .order("next_run_date", { ascending: true });

  if (options?.groupId) {
    rulesQuery = rulesQuery.eq("group_id", options.groupId);
  } else if (options?.groupIds && options.groupIds.length > 0) {
    rulesQuery = rulesQuery.in("group_id", [...options.groupIds]);
  } else if (options?.groupIds && options.groupIds.length === 0) {
    return {
      ok: true,
      summary: {
        runDate,
        evaluatedRuleCount: 0,
        materializedCount: 0,
        alreadyMaterializedCount: 0,
        advancedRuleCount: 0,
        materializedExpenses: [],
        skippedRules: [],
      },
    };
  }

  const { data: dueRules, error: rulesError } = await rulesQuery;
  if (rulesError) {
    return {
      ok: false,
      message: rulesError.message || "Unable to load due recurring rules.",
    };
  }

  const rules = dueRules ?? [];
  if (rules.length === 0) {
    return {
      ok: true,
      summary: {
        runDate,
        evaluatedRuleCount: 0,
        materializedCount: 0,
        alreadyMaterializedCount: 0,
        advancedRuleCount: 0,
        materializedExpenses: [],
        skippedRules: [],
      },
    };
  }

  const groupIds = Array.from(new Set(rules.map((r) => r.group_id)));
  const ruleIds = rules.map((r) => r.id);

  const [
    { data: groupRows, error: groupsError },
    { data: memberRows, error: membersError },
    { data: existingExpenseRows, error: existingError },
  ] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, status, base_currency, default_split_mode")
      .in("id", groupIds),
    supabase
      .from("group_members")
      .select("group_id, user_id, role, status, share_percentage, joined_at")
      .in("group_id", groupIds)
      .order("joined_at", { ascending: true }),
    supabase
      .from("expenses")
      .select(
        "id, recurring_rule_id, recurring_occurrence_date, expense_date, is_recurring_generated",
      )
      .in("recurring_rule_id", ruleIds)
      .is("deleted_at", null),
  ]);

  if (groupsError || membersError || existingError) {
    const err = groupsError || membersError || existingError;
    return {
      ok: false,
      message: err?.message || "Unable to load group context for recurring rules.",
    };
  }

  const groupMap = new Map((groupRows ?? []).map((g) => [g.id, g]));
  const membersByGroup = new Map<string, typeof memberRows>();
  for (const m of memberRows ?? []) {
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push(m);
    membersByGroup.set(m.group_id, list);
  }

  const existingOccurrenceKeys = new Set<string>();
  for (const exp of existingExpenseRows ?? []) {
    if (!exp.recurring_rule_id) continue;
    const occDate = exp.recurring_occurrence_date
      ? exp.recurring_occurrence_date.slice(0, 10)
      : exp.is_recurring_generated && exp.expense_date
        ? exp.expense_date.slice(0, 10)
        : null;
    if (occDate) {
      existingOccurrenceKeys.add(`${exp.recurring_rule_id}::${occDate}`);
    }
  }

  const materializedExpenses: MaterializedExpenseSummary[] = [];
  const skippedRules: SkippedRecurringRuleSummary[] = [];
  let alreadyMaterializedCount = 0;
  let advancedRuleCount = 0;

  for (const rule of rules) {
    const group = groupMap.get(rule.group_id);
    if (!group) {
      skippedRules.push({
        ruleId: rule.id,
        groupId: rule.group_id,
        reason: "GROUP_NOT_FOUND",
        message: "Referenced split group does not exist.",
      });
      continue;
    }

    if (group.status === "ARCHIVED") {
      skippedRules.push({
        ruleId: rule.id,
        groupId: rule.group_id,
        reason: "GROUP_ARCHIVED",
        message: `Group ${group.name} is ARCHIVED and read-only.`,
      });
      continue;
    }

    const groupMembers = membersByGroup.get(rule.group_id) ?? [];
    const activeMembers = groupMembers.filter((m) => m.status === "ACTIVE");
    if (activeMembers.length === 0) {
      skippedRules.push({
        ruleId: rule.id,
        groupId: rule.group_id,
        reason: "NO_ACTIVE_MEMBERS",
        message: "Group has no active members for splitting.",
      });
      continue;
    }

    const payerActive = activeMembers.some((m) => m.user_id === rule.paid_by);
    if (!payerActive) {
      skippedRules.push({
        ruleId: rule.id,
        groupId: rule.group_id,
        reason: "PAYER_NOT_ACTIVE",
        message: "Rule payer is no longer an active group member.",
      });
      continue;
    }

    const splitRule: SplitMode =
      rule.split_rule === "CUSTOM_RATIOS" ? "CUSTOM_RATIOS" : "EQUAL";

    if (splitRule === "CUSTOM_RATIOS") {
      if (group.status === "NEEDS_RATIO_UPDATE") {
        skippedRules.push({
          ruleId: rule.id,
          groupId: rule.group_id,
          reason: "NEEDS_RATIO_UPDATE",
          message:
            "Custom ratio splits are paused until group ratios are updated to 100%.",
        });
        continue;
      }

      const totalBps = activeMembers.reduce(
        (sum, m) => sum + Math.round(Number(m.share_percentage ?? 0) * 100),
        0,
      );
      if (totalBps !== 10_000) {
        skippedRules.push({
          ruleId: rule.id,
          groupId: rule.group_id,
          reason: "INVALID_CUSTOM_RATIOS",
          message: "Active member share percentages do not sum to 100.00%.",
        });
        continue;
      }
    }

    const amountCents = Math.trunc(Number(rule.amount_cents));
    const splitBreakdown = buildDefaultSplitExcludingFormerMembers({
      amountCents,
      paidBy: rule.paid_by,
      defaultSplitMode: splitRule,
      members: groupMembers.map((m) => ({
        userId: m.user_id,
        status: m.status,
        sharePercentage: Number(m.share_percentage ?? 0),
      })),
    });

    if (splitBreakdown.length === 0) {
      skippedRules.push({
        ruleId: rule.id,
        groupId: rule.group_id,
        reason: "NO_ACTIVE_MEMBERS",
        message: "Could not compute split breakdown for active members.",
      });
      continue;
    }

    const splitMethod: ExpenseSplitMethod =
      splitRule === "CUSTOM_RATIOS" ? "PERCENTAGE" : "EQUAL";

    const initialNextRunDate = rule.next_run_date.slice(0, 10);
    let occurrenceDate = initialNextRunDate;
    let iterations = 0;
    let ruleHadInsertError = false;

    while (
      isValidIsoDateString(occurrenceDate) &&
      occurrenceDate <= runDate &&
      iterations < maxCatchUp
    ) {
      const occKey = `${rule.id}::${occurrenceDate}`;
      if (existingOccurrenceKeys.has(occKey)) {
        alreadyMaterializedCount += 1;
        skippedRules.push({
          ruleId: rule.id,
          groupId: rule.group_id,
          reason: "ALREADY_MATERIALIZED",
          message: `Occurrence ${occurrenceDate} already materialized.`,
        });
      } else {
        const createdBy = options?.actorUserId ?? rule.created_by ?? rule.paid_by;
        const { data: insertedExpense, error: insertError } = await supabase
          .from("expenses")
          .insert({
            group_id: rule.group_id,
            created_by: createdBy,
            paid_by: rule.paid_by,
            description: rule.description,
            category: rule.category,
            expense_date: `${occurrenceDate}T00:00:00.000Z`,
            amount_cents: amountCents,
            currency: group.base_currency,
            split_method: splitMethod,
            split_breakdown: splitBreakdown,
            is_recurring_generated: true,
            recurring_rule_id: rule.id,
            recurring_occurrence_date: occurrenceDate,
          })
          .select("id, group_id, amount_cents, currency")
          .maybeSingle();

        if (insertError) {
          // Unique constraint violation (23505) means concurrent run materialized it already
          if (insertError.code === "23505") {
            alreadyMaterializedCount += 1;
            existingOccurrenceKeys.add(occKey);
            skippedRules.push({
              ruleId: rule.id,
              groupId: rule.group_id,
              reason: "ALREADY_MATERIALIZED",
              message: `Occurrence ${occurrenceDate} already materialized concurrently.`,
            });
          } else {
            ruleHadInsertError = true;
            skippedRules.push({
              ruleId: rule.id,
              groupId: rule.group_id,
              reason: "INSERT_ERROR",
              message:
                insertError.message || "Failed to materialize recurring expense.",
            });
            break;
          }
        } else if (insertedExpense) {
          existingOccurrenceKeys.add(occKey);
          materializedExpenses.push({
            expenseId: insertedExpense.id,
            ruleId: rule.id,
            groupId: insertedExpense.group_id,
            occurrenceDate,
            amountCents: Number(insertedExpense.amount_cents),
            currency: insertedExpense.currency,
          });
        }
      }

      occurrenceDate = computeNextMonthlyRunDate(
        occurrenceDate,
        rule.day_of_month,
      );
      iterations += 1;
    }

    if (!ruleHadInsertError && occurrenceDate !== initialNextRunDate) {
      const { error: updateErr } = await supabase
        .from("recurring_rules")
        .update({ next_run_date: occurrenceDate })
        .eq("id", rule.id)
        .eq("next_run_date", initialNextRunDate);

      if (!updateErr) {
        advancedRuleCount += 1;
      }
    }
  }

  return {
    ok: true,
    summary: {
      runDate,
      evaluatedRuleCount: rules.length,
      materializedCount: materializedExpenses.length,
      alreadyMaterializedCount,
      advancedRuleCount,
      materializedExpenses,
      skippedRules,
    },
  };
}
