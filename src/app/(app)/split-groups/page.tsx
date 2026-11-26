import { SplitGroupsClient } from "@/components/split-groups";
import { parseCycleParam } from "@/components/shell/url-state";
import { hasSupabaseEnv, requireAuthenticatedUser } from "@/lib/auth/guards";
import { getSplitGroupsPageData } from "@/lib/groups/service";
import type { SplitGroupsPageData } from "@/lib/groups/types";
import { createClient } from "@/lib/supabase/server";

interface SplitGroupsPageProps {
  searchParams?: Promise<{
    cycle?: string;
    group?: string;
  }>;
}

export default async function SplitGroupsPage({
  searchParams,
}: SplitGroupsPageProps) {
  const user = await requireAuthenticatedUser("/split-groups");
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const cycleSlug = parseCycleParam(resolvedSearchParams.cycle);

  let defaultCurrency = "USD";
  let pageData: SplitGroupsPageData = {
    activeGroups: [],
    archivedGroups: [],
    cycleSlug,
    loadError: null,
  };

  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const [{ data: profile }, groupsData] = await Promise.all([
      supabase
        .from("users")
        .select("base_currency")
        .eq("id", user.id)
        .maybeSingle(),
      getSplitGroupsPageData(supabase, user.id, cycleSlug),
    ]);

    if (profile?.base_currency) {
      defaultCurrency = profile.base_currency;
    }
    pageData = groupsData;
  }

  return (
    <SplitGroupsClient
      initialData={pageData}
      defaultCurrency={defaultCurrency}
    />
  );
}
