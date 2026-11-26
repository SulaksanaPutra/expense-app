import { ProtectedRoutePlaceholder } from "@/components/auth/ProtectedRoutePlaceholder";
import { AccountDangerZone } from "@/components/settings/AccountDangerZone";
import { hasSupabaseEnv, requireAuthenticatedUser } from "@/lib/auth/guards";
import {
  getUserGroupBalances,
  type UserGroupBalanceSummary,
} from "@/lib/groups/departure";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const user = await requireAuthenticatedUser("/settings");

  let balances: UserGroupBalanceSummary[] = [];
  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const res = await getUserGroupBalances(supabase, user.id);
    if (res.ok) {
      balances = res.balances;
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-12">
      <ProtectedRoutePlaceholder
        title="Settings"
        description="Profile preferences, settlement handles, notifications, and storage quota."
        userEmail={user.email ?? undefined}
      />
      <AccountDangerZone balances={balances} />
    </div>
  );
}
