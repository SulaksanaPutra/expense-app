import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { hasSupabaseEnv, requireAuthenticatedUser } from "@/lib/auth/guards";
import { getExpensesPageData } from "@/lib/expenses/queries";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const user = await requireAuthenticatedUser("/dashboard");

  if (!hasSupabaseEnv()) {
    return (
      <DashboardClient
        initialExpenses={[]}
        currentUserId={user.id}
        userBaseCurrency="USD"
        initialGroups={[]}
        initialSettlements={[]}
        initialBillingCycles={[]}
      />
    );
  }

  const supabase = await createClient();
  const data = await getExpensesPageData(supabase, user.id);

  return (
    <DashboardClient
      initialExpenses={data.expenses}
      currentUserId={data.currentUserId}
      userBaseCurrency={data.userBaseCurrency}
      initialGroups={data.groups}
      initialSettlements={data.settlements}
      initialBillingCycles={data.billingCycles}
      initialReminderCooldowns={data.reminderCooldowns}
      loadError={data.loadError}
    />
  );
}
