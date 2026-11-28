import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getActiveReminderCooldowns,
  type ReminderCooldownInfo,
} from "@/lib/groups/reminders";
import type { Database, SplitBreakdownItem } from "@/types/database";
import {
  evaluateExpenseLockAndSettlement,
  type ExpenseBillingCycleRecord,
  type ExpenseGroupInfo,
  type ExpenseLedgerRecord,
  type ExpenseSettlementRecord,
} from "./ledger";

export interface ExpensesPageData {
  currentUserId: string;
  userBaseCurrency: string;
  personalShareCapCents: number | null;
  groups: ExpenseGroupInfo[];
  expenses: ExpenseLedgerRecord[];
  settlements: ExpenseSettlementRecord[];
  billingCycles: ExpenseBillingCycleRecord[];
  reminderCooldowns: ReminderCooldownInfo[];
  loadError: string | null;
}

export async function getExpensesPageData(
  supabase: SupabaseClient<Database>,
  currentUserId: string,
): Promise<ExpensesPageData> {
  const empty: ExpensesPageData = {
    currentUserId,
    userBaseCurrency: "USD",
    personalShareCapCents: null,
    groups: [],
    expenses: [],
    settlements: [],
    billingCycles: [],
    reminderCooldowns: [],
    loadError: null,
  };

  try {
    const [{ data: userProfile }, { data: groupRows, error: groupsError }] =
      await Promise.all([
        supabase
          .from("users")
          .select("id, display_currency, base_currency, personal_share_cap_cents")
          .eq("id", currentUserId)
          .maybeSingle(),
        supabase
          .from("groups")
          .select(
            "id, name, slug, status, base_currency, default_split_mode, operational_budget_cents, billing_cycle_anchor_day, cycle_reset_day, auto_settle_on_reset, created_at",
          )
          .neq("status", "ARCHIVED")
          .order("created_at", { ascending: true }),
      ]);

    const userBaseCurrency = userProfile?.display_currency ?? userProfile?.base_currency ?? "USD";
    const personalShareCapCents =
      userProfile?.personal_share_cap_cents !== null &&
      userProfile?.personal_share_cap_cents !== undefined
        ? Number(userProfile.personal_share_cap_cents)
        : null;

    if (groupsError) {
      return {
        ...empty,
        userBaseCurrency,
        personalShareCapCents,
        loadError: groupsError.message || "Unable to load split groups.",
      };
    }

    if (!groupRows || groupRows.length === 0) {
      return {
        ...empty,
        userBaseCurrency,
        personalShareCapCents,
      };
    }

    const groupIds = groupRows.map((g) => g.id);

    const [
      { data: memberRows, error: membersError },
      { data: expenseRows, error: expensesError },
      { data: settlementRows, error: settlementsError },
      { data: billingCycleRows, error: billingCyclesError },
      reminderCooldowns,
    ] = await Promise.all([
      supabase
        .from("group_members")
        .select("group_id, user_id, role, status, joined_at")
        .in("group_id", groupIds)
        .order("joined_at", { ascending: true }),
      supabase
        .from("expenses")
        .select(
          "id, group_id, created_by, paid_by, description, category, expense_date, amount_cents, currency, split_method, split_breakdown, receipt_url, adjustment_for_expense_id, is_locked",
        )
        .in("group_id", groupIds)
        .is("deleted_at", null)
        .order("expense_date", { ascending: false }),
      supabase
        .from("settlements")
        .select(
          "id, group_id, payer_id, recipient_id, amount_cents, currency, settled_at",
        )
        .in("group_id", groupIds)
        .order("settled_at", { ascending: false }),
      supabase
        .from("billing_cycles")
        .select("id, group_id, period_start, period_end, status")
        .in("group_id", groupIds),
      getActiveReminderCooldowns(supabase, currentUserId, groupIds),
    ]);

    if (
      membersError ||
      expensesError ||
      settlementsError ||
      billingCyclesError
    ) {
      const firstErr =
        membersError ||
        expensesError ||
        settlementsError ||
        billingCyclesError;
      return {
        ...empty,
        userBaseCurrency,
        personalShareCapCents,
        loadError: firstErr?.message || "Unable to load expenses ledger.",
      };
    }

    const userIds = Array.from(
      new Set([
        ...(memberRows ?? []).map((m) => m.user_id),
        ...(expenseRows ?? []).map((e) => e.paid_by),
      ]),
    );

    const usersById = new Map<
      string,
      { id: string; full_name: string; instant_settlement_tag: string | null }
    >();
    if (userIds.length > 0) {
      const [{ data: userRows }, handleResult] = await Promise.all([
        supabase.from("users").select("id, full_name").in("id", userIds),
        Promise.resolve()
          .then(() =>
            supabase
              .from("settlement_handles")
              .select("user_id, handle, is_default")
              .in("user_id", userIds),
          )
          .catch(() => ({ data: [] as Array<{ user_id: string; handle: string; is_default: boolean }> })),
      ]);
      const handleRows = handleResult?.data ?? [];
      const defaultHandleByUser = new Map<string, string>();
      for (const h of handleRows ?? []) {
        if (h.is_default || !defaultHandleByUser.has(h.user_id)) {
          defaultHandleByUser.set(h.user_id, h.handle);
        }
      }
      for (const u of userRows ?? []) {
        usersById.set(u.id, {
          id: u.id,
          full_name: u.full_name || "Member",
          instant_settlement_tag: defaultHandleByUser.get(u.id) ?? null,
        });
      }
    }

    const membersByGroup = new Map<string, typeof memberRows>();
    for (const m of memberRows ?? []) {
      const list = membersByGroup.get(m.group_id) ?? [];
      list.push(m);
      membersByGroup.set(m.group_id, list);
    }

    const groups: ExpenseGroupInfo[] = groupRows.map((g) => {
      const gMembers = membersByGroup.get(g.id) ?? [];
      const currentMembership = gMembers.find((m) => m.user_id === currentUserId);
      return {
        id: g.id,
        name: g.name,
        slug: g.slug,
        status: g.status,
        baseCurrency: g.base_currency,
        defaultSplitMode: g.default_split_mode,
        simplifyDebts: true,
        operationalBudgetCents:
          g.operational_budget_cents !== null &&
          g.operational_budget_cents !== undefined
            ? Number(g.operational_budget_cents)
            : null,
        billingCycleAnchorDay: g.cycle_reset_day ?? g.billing_cycle_anchor_day ?? 1,
        cycleResetDay: g.cycle_reset_day ?? g.billing_cycle_anchor_day ?? 1,
        autoSettleOnReset: g.auto_settle_on_reset ?? true,
        currentUserRole: currentMembership?.role ?? null,
        currentUserStatus: currentMembership?.status ?? null,
        members: gMembers.map((m) => {
          const u = usersById.get(m.user_id);
          return {
            userId: m.user_id,
            name: u?.full_name ?? "Member",
            status: m.status,
            instantSettlementTag: u?.instant_settlement_tag ?? null,
          };
        }),
      };
    });

    const groupMap = new Map(groups.map((g) => [g.id, g]));

    const settlements: ExpenseSettlementRecord[] = (settlementRows ?? []).map(
      (s) => ({
        id: s.id,
        groupId: s.group_id,
        payerId: s.payer_id,
        recipientId: s.recipient_id,
        amountCents: Number(s.amount_cents),
        currency: s.currency,
        settledAt: s.settled_at,
      }),
    );

    const billingCycles: ExpenseBillingCycleRecord[] = (
      billingCycleRows ?? []
    ).map((bc) => ({
      id: bc.id,
      groupId: bc.group_id,
      periodStart: bc.period_start,
      periodEnd: bc.period_end,
      status: bc.status,
    }));

    const expenses: ExpenseLedgerRecord[] = (expenseRows ?? []).map((row) => {
      const group = groupMap.get(row.group_id);
      const breakdown: SplitBreakdownItem[] = Array.isArray(row.split_breakdown)
        ? (row.split_breakdown as unknown as SplitBreakdownItem[])
        : [];
      const lockEval = evaluateExpenseLockAndSettlement({
        expense: {
          id: row.id,
          groupId: row.group_id,
          paidBy: row.paid_by,
          expenseDate: row.expense_date,
          isLocked: Boolean(row.is_locked),
          splitBreakdown: breakdown,
        },
        currentUserId,
        billingCycles,
        settlements,
      });

      return {
        id: row.id,
        groupId: row.group_id,
        groupName: group?.name ?? "Split Group",
        groupBaseCurrency: group?.baseCurrency ?? row.currency,
        groupBillingAnchorDay: group?.billingCycleAnchorDay ?? 1,
        createdBy: row.created_by,
        paidBy: row.paid_by,
        payerName: usersById.get(row.paid_by)?.full_name ?? "Member",
        description: row.description,
        category: row.category,
        expenseDate: row.expense_date,
        amountCents: Number(row.amount_cents),
        currency: row.currency,
        originalAmountCents: null,
        originalCurrency: null,
        exchangeRate: null,
        exchangeRateSource: null,
        splitMethod: row.split_method,
        splitBreakdown: breakdown,
        receiptUrl: row.receipt_url ?? null,
        isRecurringGenerated: false,
        recurringRuleId: null,
        adjustmentForExpenseId: row.adjustment_for_expense_id ?? null,
        isLocked: lockEval.isLocked,
        isCycleClosed: lockEval.isCycleClosed,
        isSettledByWatermark: lockEval.isSettledByWatermark,
        isSettledForUser: lockEval.isSettledForUser,
      };
    });

    return {
      currentUserId,
      userBaseCurrency,
      personalShareCapCents,
      groups,
      expenses,
      settlements,
      billingCycles,
      reminderCooldowns,
      loadError: null,
    };
  } catch (err) {
    return {
      ...empty,
      loadError:
        err instanceof Error ? err.message : "Unable to load expenses ledger.",
    };
  }
}
