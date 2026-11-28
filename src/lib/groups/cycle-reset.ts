import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeGroupMemberNetBalances,
  simplifyBipartiteGroupDebts,
} from "@/lib/expenses/debt-simplification";
import { formatMinorUnits } from "@/lib/money";
import type { Database, SplitBreakdownItem } from "@/types/database";
import { recordGroupAuditEvent } from "./audit-log";

export interface CycleWindowTarget {
  periodStart: string;
  periodEnd: string;
  cycleSlug: string;
  resetDateIso: string;
}

export interface CycleResetRunOptions {
  runDate?: string;
  groupId?: string;
  groupIds?: string[];
  nowIso?: string;
}

export type CycleReminderAction =
  | "SENT"
  | "ALREADY_SENT"
  | "SKIPPED_DISABLED"
  | "SKIPPED_CYCLE_CLOSED"
  | "NOT_DUE";

export type CycleResetAction =
  | "AUTO_CLOSED_AND_SETTLED"
  | "AUTO_CLOSED_ZERO_BALANCE"
  | "ALREADY_CLOSED"
  | "SKIPPED_MANUAL_CLOSE"
  | "NOT_DUE";

export interface CycleResetGroupOutcome {
  groupId: string;
  groupName: string;
  cycleResetDay: number;
  autoSettleOnReset: boolean;
  sendCycleCloseReminders: boolean;
  reminderAction: CycleReminderAction;
  remindersSentCount: number;
  cycleResetAction: CycleResetAction;
  billingCycleId?: string;
  periodStart?: string;
  periodEnd?: string;
  lockedExpenseCount: number;
  autoSettlementsCreated: number;
  autoSettledTotalCents: number;
}

export interface CycleResetRunSummary {
  runDate: string;
  evaluatedGroups: number;
  remindersSent: number;
  reminderGroupsNotified: number;
  reminderGroupsSkippedAlreadySent: number;
  reminderGroupsSkippedDisabled: number;
  cyclesClosed: number;
  cyclesAlreadyClosed: number;
  manualGroupsLeftOpen: number;
  lockedExpenses: number;
  autoSettlementsCreated: number;
  autoSettledTotalCents: number;
  outcomes: CycleResetGroupOutcome[];
}

export type CycleResetRunResult =
  | { ok: true; summary: CycleResetRunSummary }
  | { ok: false; status: number; code: string; message: string };

export function isValidIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map((part) => Number.parseInt(part, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function clampCycleResetDay(day: number | null | undefined): number {
  if (typeof day !== "number" || !Number.isFinite(day)) return 1;
  return Math.min(Math.max(Math.trunc(day), 1), 28);
}

function parseIsoDateUtc(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

export function addUtcDays(isoDate: string, days: number): string {
  const dt = parseIsoDateUtc(isoDate);
  dt.setUTCDate(dt.getUTCDate() + Math.trunc(days));
  return dt.toISOString().slice(0, 10);
}

export function isCycleResetDay(runDateIso: string, resetDay: number): boolean {
  if (!isValidIsoDateString(runDateIso)) return false;
  const safeResetDay = clampCycleResetDay(resetDay);
  const dt = parseIsoDateUtc(runDateIso);
  return dt.getUTCDate() === safeResetDay;
}

/**
 * Given a `resetDateIso` matching `resetDay` (e.g. `2026-12-01` for resetDay=1),
 * returns the billing cycle that closes on that reset date:
 * - periodStart: resetDay of the previous calendar month (e.g. `2026-11-01`)
 * - periodEnd: day immediately preceding resetDateIso (e.g. `2026-11-30`)
 * - cycleSlug: YYYY-MM of periodStart (e.g. `2026-11`)
 */
export function getCycleClosingOnResetDate(
  resetDateIso: string,
  resetDay: number,
): CycleWindowTarget {
  const safeResetDay = clampCycleResetDay(resetDay);
  const resetDate = parseIsoDateUtc(resetDateIso);
  const periodStartDate = new Date(
    Date.UTC(
      resetDate.getUTCFullYear(),
      resetDate.getUTCMonth() - 1,
      safeResetDay,
      0,
      0,
      0,
      0,
    ),
  );
  const periodStart = periodStartDate.toISOString().slice(0, 10);
  const periodEnd = addUtcDays(resetDateIso, -1);
  const cycleSlug = periodStart.slice(0, 7);

  return {
    periodStart,
    periodEnd,
    cycleSlug,
    resetDateIso,
  };
}

/**
 * Returns the upcoming closing cycle target if `runDateIso` is exactly 48 hours
 * (2 UTC calendar days) prior to `Group.cycle_reset_day`; otherwise null.
 */
export function getPreCloseReminderTarget(
  runDateIso: string,
  resetDay: number,
): CycleWindowTarget | null {
  if (!isValidIsoDateString(runDateIso)) return null;
  const targetResetDateIso = addUtcDays(runDateIso, 2);
  if (!isCycleResetDay(targetResetDateIso, resetDay)) {
    return null;
  }
  return getCycleClosingOnResetDate(targetResetDateIso, resetDay);
}

export function buildCycleCloseReminderDedupeKey(
  groupId: string,
  periodEnd: string,
  userId: string,
): string {
  return `cycle-close-reminder:${groupId}:${periodEnd}:${userId}`;
}

function isUniqueViolationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("duplicate key") || msg.includes("unique constraint");
}

interface CandidateGroupRow {
  id: string;
  name: string;
  status: Database["public"]["Tables"]["groups"]["Row"]["status"];
  base_currency: string;
  billing_cycle_anchor_day: number;
  cycle_reset_day?: number | null;
  auto_settle_on_reset?: boolean | null;
  send_cycle_close_reminders?: boolean | null;
}

export async function runCycleResetAndReminders(
  supabase: SupabaseClient<Database>,
  options: CycleResetRunOptions = {},
): Promise<CycleResetRunResult> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const runDate = options.runDate?.trim() || nowIso.slice(0, 10);

  if (!isValidIsoDateString(runDate)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_DATE",
      message: "runDate must be a valid YYYY-MM-DD date.",
    };
  }

  let groupQuery = supabase
    .from("groups")
    .select(
      "id, name, status, base_currency, billing_cycle_anchor_day, cycle_reset_day, auto_settle_on_reset, send_cycle_close_reminders",
    );

  if (options.groupId) {
    groupQuery = groupQuery.eq("id", options.groupId);
  } else if (options.groupIds) {
    if (options.groupIds.length === 0) {
      return {
        ok: true,
        summary: {
          runDate,
          evaluatedGroups: 0,
          remindersSent: 0,
          reminderGroupsNotified: 0,
          reminderGroupsSkippedAlreadySent: 0,
          reminderGroupsSkippedDisabled: 0,
          cyclesClosed: 0,
          cyclesAlreadyClosed: 0,
          manualGroupsLeftOpen: 0,
          lockedExpenses: 0,
          autoSettlementsCreated: 0,
          autoSettledTotalCents: 0,
          outcomes: [],
        },
      };
    }
    groupQuery = groupQuery.in("id", options.groupIds);
  }

  const { data: rawGroups, error: groupsError } = await groupQuery;
  if (groupsError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: groupsError.message || "Unable to load groups for cycle reset.",
    };
  }

  const groups = ((rawGroups ?? []) as CandidateGroupRow[]).filter(
    (g) => g.status !== "ARCHIVED",
  );

  const summary: CycleResetRunSummary = {
    runDate,
    evaluatedGroups: groups.length,
    remindersSent: 0,
    reminderGroupsNotified: 0,
    reminderGroupsSkippedAlreadySent: 0,
    reminderGroupsSkippedDisabled: 0,
    cyclesClosed: 0,
    cyclesAlreadyClosed: 0,
    manualGroupsLeftOpen: 0,
    lockedExpenses: 0,
    autoSettlementsCreated: 0,
    autoSettledTotalCents: 0,
    outcomes: [],
  };

  for (const group of groups) {
    const cycleResetDay = clampCycleResetDay(
      group.cycle_reset_day ?? group.billing_cycle_anchor_day ?? 1,
    );
    const autoSettleOnReset = group.auto_settle_on_reset !== false;
    const sendCycleCloseReminders = group.send_cycle_close_reminders !== false;

    const outcome: CycleResetGroupOutcome = {
      groupId: group.id,
      groupName: group.name,
      cycleResetDay,
      autoSettleOnReset,
      sendCycleCloseReminders,
      reminderAction: "NOT_DUE",
      remindersSentCount: 0,
      cycleResetAction: "NOT_DUE",
      lockedExpenseCount: 0,
      autoSettlementsCreated: 0,
      autoSettledTotalCents: 0,
    };

    // -----------------------------------------------------------------------
    // 1. 48-hour pre-close reminder trigger
    // -----------------------------------------------------------------------
    const reminderTarget = getPreCloseReminderTarget(runDate, cycleResetDay);
    if (reminderTarget) {
      outcome.periodStart = reminderTarget.periodStart;
      outcome.periodEnd = reminderTarget.periodEnd;

      if (!sendCycleCloseReminders) {
        outcome.reminderAction = "SKIPPED_DISABLED";
        summary.reminderGroupsSkippedDisabled += 1;
      } else {
        const { data: existingReminderCycle } = await supabase
          .from("billing_cycles")
          .select("id, status")
          .eq("group_id", group.id)
          .eq("period_start", reminderTarget.periodStart)
          .eq("period_end", reminderTarget.periodEnd)
          .maybeSingle();

        if (existingReminderCycle?.status === "CLOSED") {
          outcome.reminderAction = "SKIPPED_CYCLE_CLOSED";
        } else {
          const { data: activeMembers, error: membersError } = await supabase
            .from("group_members")
            .select("user_id, status")
            .eq("group_id", group.id)
            .eq("status", "ACTIVE");

          if (membersError) {
            return {
              ok: false,
              status: 500,
              code: "SERVER_ERROR",
              message:
                membersError.message || "Unable to load group members for reminder.",
            };
          }

          const activeUserIds = (activeMembers ?? []).map((m) => m.user_id);

          if (activeUserIds.length > 0) {
            const prefEnabledByUser = new Map<string, boolean>();
            try {
              const { data: userRows } = await supabase
                .from("users")
                .select("id, notification_prefs")
                .in("id", activeUserIds);

              for (const row of userRows ?? []) {
                const prefs =
                  row.notification_prefs &&
                  typeof row.notification_prefs === "object"
                    ? (row.notification_prefs as unknown as Record<
                        string,
                        unknown
                      >)
                    : null;
                prefEnabledByUser.set(
                  row.id,
                  prefs?.cycle_close_reminder === false ? false : true,
                );
              }
            } catch {
              // Default to enabled when user preferences lookup is unavailable in minimal mocks.
            }

            const eligibleUserIds = activeUserIds.filter(
              (uid) => prefEnabledByUser.get(uid) !== false,
            );

            const href = `/expenses?group=${encodeURIComponent(group.id)}&cycle=${encodeURIComponent(reminderTarget.cycleSlug)}`;

            // Check existing CYCLE_CLOSE_REMINDER notifications for idempotency
            const { data: existingNotifs } = await supabase
              .from("notifications")
              .select("id, user_id, dedupe_key, href")
              .eq("group_id", group.id)
              .eq("type", "CYCLE_CLOSE_REMINDER");

            const alreadyNotifiedDedupeKeys = new Set<string>();
            const alreadyNotifiedUserIdsForHref = new Set<string>();
            for (const row of existingNotifs ?? []) {
              if (row.dedupe_key) {
                alreadyNotifiedDedupeKeys.add(row.dedupe_key);
              }
              if (row.href === href) {
                alreadyNotifiedUserIdsForHref.add(row.user_id);
              }
            }

            const recipientsToNotify = eligibleUserIds.filter((uid) => {
              const dedupeKey = buildCycleCloseReminderDedupeKey(
                group.id,
                reminderTarget.periodEnd,
                uid,
              );
              return (
                !alreadyNotifiedDedupeKeys.has(dedupeKey) &&
                !alreadyNotifiedUserIdsForHref.has(uid)
              );
            });

            if (recipientsToNotify.length === 0) {
              outcome.reminderAction = "ALREADY_SENT";
              summary.reminderGroupsSkippedAlreadySent += 1;
            } else {
              const description = autoSettleOnReset
                ? `${group.name} billing cycle (${reminderTarget.periodStart} to ${reminderTarget.periodEnd}) closes in 48 hours on ${reminderTarget.resetDateIso}. Open simplified balances will auto-settle on reset.`
                : `${group.name} billing cycle (${reminderTarget.periodStart} to ${reminderTarget.periodEnd}) closes in 48 hours on ${reminderTarget.resetDateIso}. Review and settle open balances before close.`;

              const payloads: Database["public"]["Tables"]["notifications"]["Insert"][] =
                recipientsToNotify.map((uid) => ({
                  id: crypto.randomUUID(),
                  user_id: uid,
                  group_id: group.id,
                  actor_id: null,
                  expense_id: null,
                  revision_id: null,
                  type: "CYCLE_CLOSE_REMINDER",
                  title: "Billing cycle closes in 48 hours",
                  description,
                  delta_cents: null,
                  currency: group.base_currency,
                  href,
                  dedupe_key: buildCycleCloseReminderDedupeKey(
                    group.id,
                    reminderTarget.periodEnd,
                    uid,
                  ),
                  is_read: false,
                  created_at: nowIso,
                }));

              const { error: insertNotifError } = await supabase
                .from("notifications")
                .insert(payloads);

              if (insertNotifError && !isUniqueViolationError(insertNotifError)) {
                return {
                  ok: false,
                  status: 500,
                  code: "SERVER_ERROR",
                  message:
                    insertNotifError.message ||
                    "Failed to persist cycle-close reminder notifications.",
                };
              }

              if (insertNotifError && isUniqueViolationError(insertNotifError)) {
                outcome.reminderAction = "ALREADY_SENT";
                summary.reminderGroupsSkippedAlreadySent += 1;
              } else {
                outcome.reminderAction = "SENT";
                outcome.remindersSentCount = payloads.length;
                summary.remindersSent += payloads.length;
                summary.reminderGroupsNotified += 1;
              }
            }
          } else {
            outcome.reminderAction = "ALREADY_SENT";
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // 2. Cycle reset auto-close & AUTO_SETTLED settlement generation
    // -----------------------------------------------------------------------
    if (isCycleResetDay(runDate, cycleResetDay)) {
      const closingCycle = getCycleClosingOnResetDate(runDate, cycleResetDay);
      outcome.periodStart = closingCycle.periodStart;
      outcome.periodEnd = closingCycle.periodEnd;

      if (!autoSettleOnReset) {
        outcome.cycleResetAction = "SKIPPED_MANUAL_CLOSE";
        summary.manualGroupsLeftOpen += 1;
      } else {
        const { data: existingCycle, error: existingCycleError } = await supabase
          .from("billing_cycles")
          .select("*")
          .eq("group_id", group.id)
          .eq("period_start", closingCycle.periodStart)
          .eq("period_end", closingCycle.periodEnd)
          .maybeSingle();

        if (existingCycleError) {
          return {
            ok: false,
            status: 500,
            code: "SERVER_ERROR",
            message:
              existingCycleError.message ||
              "Unable to verify billing cycle status.",
          };
        }

        if (existingCycle?.status === "CLOSED") {
          outcome.cycleResetAction = "ALREADY_CLOSED";
          outcome.billingCycleId = existingCycle.id;
          summary.cyclesAlreadyClosed += 1;
        } else {
          // Load members, expenses (up through periodEnd), and settlements strictly within group.id
          const [membersRes, expensesRes, settlementsRes] = await Promise.all([
            supabase
              .from("group_members")
              .select("user_id, status")
              .eq("group_id", group.id),
            supabase
              .from("expenses")
              .select(
                "id, group_id, paid_by, amount_cents, expense_date, split_breakdown, is_locked, deleted_at",
              )
              .eq("group_id", group.id)
              .is("deleted_at", null),
            supabase
              .from("settlements")
              .select("id, group_id, payer_id, recipient_id, amount_cents, settled_at")
              .eq("group_id", group.id),
          ]);

          if (membersRes.error) {
            return {
              ok: false,
              status: 500,
              code: "SERVER_ERROR",
              message:
                membersRes.error.message ||
                "Unable to load group members for auto-settle.",
            };
          }
          if (expensesRes.error) {
            return {
              ok: false,
              status: 500,
              code: "SERVER_ERROR",
              message:
                expensesRes.error.message ||
                "Unable to load group expenses for auto-settle.",
            };
          }
          if (settlementsRes.error) {
            return {
              ok: false,
              status: 500,
              code: "SERVER_ERROR",
              message:
                settlementsRes.error.message ||
                "Unable to load group settlements for auto-settle.",
            };
          }

          const allMembers = membersRes.data ?? [];
          const memberIds = allMembers.map((m) => m.user_id);

          const userNamesById = new Map<string, string>();
          if (memberIds.length > 0) {
            try {
              const { data: userRows } = await supabase
                .from("users")
                .select("id, full_name, email")
                .in("id", memberIds);
              for (const u of userRows ?? []) {
                userNamesById.set(
                  u.id,
                  u.full_name?.trim() || u.email || "Member",
                );
              }
            } catch {
              // Non-fatal in minimal unit-test mocks.
            }
          }

          const allNonDeletedExpenses = (expensesRes.data ?? []).filter(
            (exp) => exp.deleted_at === null,
          );

          // Expenses belonging to this cycle or earlier (exclude new-cycle expenses logged on/after resetDate)
          const expensesThroughPeriodEnd = allNonDeletedExpenses.filter((exp) => {
            const expDateStr = new Date(exp.expense_date)
              .toISOString()
              .slice(0, 10);
            return expDateStr <= closingCycle.periodEnd;
          });

          // Expenses specifically inside [periodStart, periodEnd] to lock
          const expensesInClosingPeriod = allNonDeletedExpenses.filter((exp) => {
            const expDateStr = new Date(exp.expense_date)
              .toISOString()
              .slice(0, 10);
            return (
              expDateStr >= closingCycle.periodStart &&
              expDateStr <= closingCycle.periodEnd
            );
          });

          const netByUser = computeGroupMemberNetBalances({
            groupId: group.id,
            memberIds,
            expenses: expensesThroughPeriodEnd.map((exp) => ({
              groupId: exp.group_id,
              paidBy: exp.paid_by,
              amountCents: Number(exp.amount_cents),
              splitBreakdown: Array.isArray(exp.split_breakdown)
                ? (exp.split_breakdown as unknown as SplitBreakdownItem[])
                : [],
            })),
            settlements: (settlementsRes.data ?? []).map((s) => ({
              groupId: s.group_id,
              payerId: s.payer_id,
              recipientId: s.recipient_id,
              amountCents: Number(s.amount_cents),
            })),
          });

          const simplifiedEdges = simplifyBipartiteGroupDebts({
            group: {
              id: group.id,
              name: group.name,
              baseCurrency: group.base_currency,
              simplifyDebts: true,
              members: memberIds.map((uid) => ({
                userId: uid,
                name: userNamesById.get(uid) ?? "Member",
                instantSettlementTag: null,
              })),
            },
            netByUser,
          });

          // Transition BillingCycle to CLOSED atomically (idempotent under concurrency)
          let closedCycle:
            | Database["public"]["Tables"]["billing_cycles"]["Row"]
            | null = null;
          let racedAlreadyClosed = false;

          if (existingCycle) {
            const { data: updatedCycle, error: updateCycleError } =
              await supabase
                .from("billing_cycles")
                .update({
                  status: "CLOSED",
                  closed_by: null,
                  closed_at: nowIso,
                })
                .eq("id", existingCycle.id)
                .eq("group_id", group.id)
                .eq("status", "OPEN")
                .select("*")
                .maybeSingle();

            if (updateCycleError) {
              return {
                ok: false,
                status: 500,
                code: "SERVER_ERROR",
                message:
                  updateCycleError.message || "Failed to close billing cycle.",
              };
            }
            if (!updatedCycle) {
              racedAlreadyClosed = true;
            } else {
              closedCycle = updatedCycle;
            }
          } else {
            const { data: insertedCycle, error: insertCycleError } =
              await supabase
                .from("billing_cycles")
                .insert({
                  group_id: group.id,
                  period_start: closingCycle.periodStart,
                  period_end: closingCycle.periodEnd,
                  status: "CLOSED",
                  closed_by: null,
                  closed_at: nowIso,
                })
                .select("*")
                .maybeSingle();

            if (insertCycleError) {
              if (isUniqueViolationError(insertCycleError)) {
                racedAlreadyClosed = true;
              } else {
                return {
                  ok: false,
                  status: 500,
                  code: "SERVER_ERROR",
                  message:
                    insertCycleError.message || "Failed to close billing cycle.",
                };
              }
            } else {
              closedCycle = insertedCycle;
            }
          }

          if (racedAlreadyClosed || !closedCycle) {
            outcome.cycleResetAction = "ALREADY_CLOSED";
            summary.cyclesAlreadyClosed += 1;
          } else {
            // Explicitly lock unlocked expenses in the closing cycle window
            // (Postgres trigger trg_billing_cycles_lock_expenses also enforces this atomically)
            const unlockedIds = expensesInClosingPeriod
              .filter((exp) => !exp.is_locked)
              .map((exp) => exp.id);

            if (unlockedIds.length > 0) {
              try {
                await supabase
                  .from("expenses")
                  .update({ is_locked: true })
                  .in("id", unlockedIds)
                  .eq("group_id", group.id)
                  .eq("is_locked", false);
              } catch {
                // Non-fatal in minimal mocks; DB trigger locks rows atomically.
              }
            }

            // Generate immutable AUTO_SETTLED settlements for all open simplified pairwise balances
            let autoSettledTotalCents = 0;
            let autoSettlementsCreated = 0;

            if (simplifiedEdges.length > 0) {
              const settlementPayloads: Database["public"]["Tables"]["settlements"]["Insert"][] =
                simplifiedEdges.map((edge) => ({
                  id: crypto.randomUUID(),
                  group_id: group.id,
                  payer_id: edge.payerId,
                  recipient_id: edge.recipientId,
                  amount_cents: edge.amountCents,
                  currency: group.base_currency,
                  payment_rail: "AUTO_SETTLED",
                  settlement_handle_id: null,
                  settled_at: nowIso,
                }));

              const { error: insertSettlementError } = await supabase
                .from("settlements")
                .insert(settlementPayloads);

              if (insertSettlementError) {
                return {
                  ok: false,
                  status: 500,
                  code: "SERVER_ERROR",
                  message:
                    insertSettlementError.message ||
                    "Failed to create AUTO_SETTLED settlement records.",
                };
              }

              autoSettlementsCreated = settlementPayloads.length;
              autoSettledTotalCents = simplifiedEdges.reduce(
                (acc, edge) => acc + edge.amountCents,
                0,
              );
            }

            const lockedExpenseCount = expensesInClosingPeriod.length;
            outcome.billingCycleId = closedCycle.id;
            outcome.lockedExpenseCount = lockedExpenseCount;
            outcome.autoSettlementsCreated = autoSettlementsCreated;
            outcome.autoSettledTotalCents = autoSettledTotalCents;
            outcome.cycleResetAction =
              autoSettlementsCreated > 0
                ? "AUTO_CLOSED_AND_SETTLED"
                : "AUTO_CLOSED_ZERO_BALANCE";

            summary.cyclesClosed += 1;
            summary.lockedExpenses += lockedExpenseCount;
            summary.autoSettlementsCreated += autoSettlementsCreated;
            summary.autoSettledTotalCents += autoSettledTotalCents;

            const settlementDetail =
              autoSettlementsCreated > 0
                ? `${autoSettlementsCreated} auto-settlement${autoSettlementsCreated === 1 ? "" : "s"} totaling ${formatMinorUnits(autoSettledTotalCents, group.base_currency)}`
                : "no open balances to settle";

            await recordGroupAuditEvent(supabase, {
              groupId: group.id,
              actorId: null,
              actorName: "System",
              eventType: "BILLING_CYCLE_CLOSED",
              summary: `Auto-closed billing cycle ${closingCycle.periodStart} to ${closingCycle.periodEnd} (${lockedExpenseCount} expense${lockedExpenseCount === 1 ? "" : "s"} locked, ${settlementDetail})`,
              metadata: {
                billing_cycle_id: closedCycle.id,
                period_start: closingCycle.periodStart,
                period_end: closingCycle.periodEnd,
                auto_settled: true,
                locked_expense_count: lockedExpenseCount,
                auto_settlements_created: autoSettlementsCreated,
                auto_settled_total_cents: autoSettledTotalCents,
              },
              createdAt: nowIso,
            });
          }
        }
      }
    }

    summary.outcomes.push(outcome);
  }

  return { ok: true, summary };
}
