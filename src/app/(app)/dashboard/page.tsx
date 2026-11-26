import { ProtectedRoutePlaceholder } from "@/components/auth/ProtectedRoutePlaceholder";
import { requireAuthenticatedUser } from "@/lib/auth/guards";

export default async function DashboardPage() {
  const user = await requireAuthenticatedUser("/dashboard");

  return (
    <ProtectedRoutePlaceholder
      title="Dashboard"
      description="Monthly spend overview, peer balances, and recent shared transactions."
      userEmail={user.email ?? undefined}
    />
  );
}
