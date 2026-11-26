import { ProtectedRoutePlaceholder } from "@/components/auth/ProtectedRoutePlaceholder";
import { requireAuthenticatedUser } from "@/lib/auth/guards";

export default async function ExpensesPage() {
  const user = await requireAuthenticatedUser("/expenses");

  return (
    <ProtectedRoutePlaceholder
      title="Expenses"
      description="Itemized shared ledger transactions and recurring expense rules."
      userEmail={user.email ?? undefined}
    />
  );
}
