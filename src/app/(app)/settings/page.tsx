import { SettingsClient } from "@/components/settings";
import { hasSupabaseEnv, requireAuthenticatedUser } from "@/lib/auth/guards";
import {
  getUserGroupBalances,
  type UserGroupBalanceSummary,
} from "@/lib/groups/departure";
import {
  DEFAULT_USER_PREFS,
  getSettingsPageData,
  type SettingsPageData,
} from "@/lib/settings/service";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const user = await requireAuthenticatedUser("/settings");

  const authUserSummary = {
    id: user.id,
    email: user.email ?? null,
    fullName:
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : null,
    avatarUrl:
      typeof user.user_metadata?.avatar_url === "string"
        ? user.user_metadata.avatar_url
        : null,
  };

  let settingsData: SettingsPageData = {
    profile: {
      id: user.id,
      fullName:
        authUserSummary.fullName ||
        authUserSummary.email?.split("@")[0] ||
        "LedgerSplit User",
      email: user.email ?? "",
      avatarUrl: authUserSummary.avatarUrl,
      phoneNumber: null,
      phoneVerified: false,
      instantSettlementTag: null,
      baseCurrency: "USD",
      personalShareCapCents: null,
      receiptStorageUsedBytes: 0,
      receiptStorageQuotaBytes: 524_288_000,
      notificationPrefs: { ...DEFAULT_USER_PREFS, payment_methods: [] },
      createdAt: new Date().toISOString(),
    },
    groups: [],
    loadError: null,
  };

  let balances: UserGroupBalanceSummary[] = [];

  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const [loadedSettings, balanceRes] = await Promise.all([
      getSettingsPageData(supabase, authUserSummary),
      getUserGroupBalances(supabase, user.id),
    ]);
    settingsData = loadedSettings;
    if (balanceRes.ok) {
      balances = balanceRes.balances;
    }
  }

  return (
    <SettingsClient
      initialProfile={settingsData.profile}
      groups={settingsData.groups}
      balances={balances}
      loadError={settingsData.loadError}
    />
  );
}
