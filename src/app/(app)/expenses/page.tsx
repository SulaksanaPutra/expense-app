import { ExpensesClient } from "@/components/expenses";
import { hasSupabaseEnv, requireAuthenticatedUser } from "@/lib/auth/guards";
import { getExpensesPageData } from "@/lib/expenses/queries";
import { createClient } from "@/lib/supabase/server";

export default async function ExpensesPage() {
  const user = await requireAuthenticatedUser("/expenses");

  if (!hasSupabaseEnv()) {
    return (
      <ExpensesClient
        currentUserId={user.id}
        userBaseCurrency="USD"
        personalShareCapCents={null}
        initialGroups={[]}
        initialExpenses={[]}
        initialSettlements={[]}
        initialBillingCycles={[]}
        initialRecurringRules={[]}
      />
    );
  }

  const supabase = await createClient();
  const data = await getExpensesPageData(supabase, user.id);

  return (
    <ExpensesClient
      currentUserId={data.currentUserId}
      userBaseCurrency={data.userBaseCurrency}
      personalShareCapCents={data.personalShareCapCents}
      initialGroups={data.groups}
      initialExpenses={data.expenses}
      initialSettlements={data.settlements}
      initialBillingCycles={data.billingCycles}
      initialRecurringRules={data.recurringRules}
      loadError={data.loadError}
    />
  );
}
