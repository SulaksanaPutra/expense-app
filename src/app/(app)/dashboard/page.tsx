import {
  DashboardClient,
  type DashboardExpenseItem,
} from "@/components/dashboard/DashboardClient";
import { hasSupabaseEnv, requireAuthenticatedUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import type { SplitBreakdownItem } from "@/types/database";

export default async function DashboardPage() {
  const user = await requireAuthenticatedUser("/dashboard");
  let initialExpenses: DashboardExpenseItem[] = [];

  if (hasSupabaseEnv()) {
    try {
      const supabase = await createClient();
      const { data: groupRows } = await supabase
        .from("groups")
        .select("id, name, base_currency, billing_cycle_anchor_day, status")
        .neq("status", "ARCHIVED");

      if (groupRows && groupRows.length > 0) {
        const groupMap = new Map(groupRows.map((g) => [g.id, g]));
        const groupIds = groupRows.map((g) => g.id);

        const { data: expenseRows } = await supabase
          .from("expenses")
          .select(
            "id, group_id, paid_by, description, category, expense_date, amount_cents, currency, original_amount_cents, original_currency, split_method, split_breakdown, receipt_url",
          )
          .in("group_id", groupIds)
          .is("deleted_at", null)
          .order("expense_date", { ascending: false })
          .limit(50);

        const payerIds = Array.from(
          new Set((expenseRows ?? []).map((e) => e.paid_by)),
        );
        const payerMap = new Map<string, string>();
        if (payerIds.length > 0) {
          const { data: userRows } = await supabase
            .from("users")
            .select("id, full_name")
            .in("id", payerIds);
          for (const u of userRows ?? []) {
            payerMap.set(u.id, u.full_name || "Member");
          }
        }

        initialExpenses = (expenseRows ?? []).map((row) => {
          const group = groupMap.get(row.group_id);
          return {
            id: row.id,
            groupId: row.group_id,
            groupName: group?.name ?? "Split Group",
            groupBaseCurrency: group?.base_currency ?? row.currency,
            groupBillingAnchorDay: group?.billing_cycle_anchor_day ?? 1,
            paidBy: row.paid_by,
            payerName: payerMap.get(row.paid_by) ?? "Member",
            description: row.description,
            category: row.category,
            expenseDate: row.expense_date,
            amountCents: row.amount_cents,
            currency: row.currency,
            originalAmountCents: row.original_amount_cents,
            originalCurrency: row.original_currency,
            splitMethod: row.split_method,
            splitBreakdown: Array.isArray(row.split_breakdown)
              ? (row.split_breakdown as unknown as SplitBreakdownItem[])
              : [],
            receiptUrl: row.receipt_url ?? null,
          };
        });
      }
    } catch {
      initialExpenses = [];
    }
  }

  return (
    <DashboardClient
      initialExpenses={initialExpenses}
      currentUserId={user.id}
    />
  );
}
