import * as React from "react";
import { AppShell } from "@/components/shell";
import type {
  ShellGroupMember,
  ShellGroupSummary,
  ShellUserSummary,
} from "@/components/shell";
import { getAuthenticatedUser, hasSupabaseEnv } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

async function loadShellContext(): Promise<{
  user: ShellUserSummary | null;
  groups: ShellGroupSummary[];
}> {
  const authUser = await getAuthenticatedUser();
  if (!authUser) {
    return { user: null, groups: [] };
  }

  const metaName =
    typeof authUser.user_metadata?.full_name === "string"
      ? authUser.user_metadata.full_name
      : undefined;

  let shellUser: ShellUserSummary = {
    id: authUser.id,
    fullName: metaName || authUser.email || "LedgerSplit User",
    email: authUser.email ?? "",
  };

  if (!hasSupabaseEnv()) {
    return { user: shellUser, groups: [] };
  }

  try {
    const supabase = await createClient();

    const [{ data: profile }, { data: groupRows }] = await Promise.all([
      supabase
        .from("users")
        .select("id, full_name, email, receipt_storage_used_bytes")
        .eq("id", authUser.id)
        .maybeSingle(),
      supabase
        .from("groups")
        .select(
          "id, name, slug, group_type, status, base_currency, default_split_mode",
        )
        .neq("status", "ARCHIVED")
        .order("created_at", { ascending: true }),
    ]);

    if (profile) {
      shellUser = {
        id: profile.id,
        fullName: profile.full_name || shellUser.fullName,
        email: profile.email || shellUser.email,
        receiptStorageUsedBytes: Number(profile.receipt_storage_used_bytes ?? 0),
      };
    }

    if (!groupRows || groupRows.length === 0) {
      return { user: shellUser, groups: [] };
    }

    const groupIds = groupRows.map((g) => g.id);

    const [{ data: memberRows }, { data: expenseRows }] = await Promise.all([
      supabase
        .from("group_members")
        .select("group_id, user_id, status, share_percentage, joined_at")
        .in("group_id", groupIds)
        .eq("status", "ACTIVE")
        .order("joined_at", { ascending: true }),
      supabase
        .from("expenses")
        .select("group_id")
        .in("group_id", groupIds)
        .is("deleted_at", null),
    ]);

    const userIds = Array.from(
      new Set((memberRows ?? []).map((m) => m.user_id)),
    );

    const usersById = new Map<string, { id: string; full_name: string }>();
    if (userIds.length > 0) {
      const { data: userRows } = await supabase
        .from("users")
        .select("id, full_name")
        .in("id", userIds);
      for (const u of userRows ?? []) {
        usersById.set(u.id, u);
      }
    }

    const membersByGroup = new Map<string, ShellGroupMember[]>();
    for (const row of memberRows ?? []) {
      const memberProfile = usersById.get(row.user_id);
      const list = membersByGroup.get(row.group_id) ?? [];
      list.push({
        id: row.user_id,
        name: memberProfile?.full_name || "Member",
        sharePercentage: Number(row.share_percentage ?? 0),
      });
      membersByGroup.set(row.group_id, list);
    }

    const splitCountByGroup = new Map<string, number>();
    for (const row of expenseRows ?? []) {
      splitCountByGroup.set(
        row.group_id,
        (splitCountByGroup.get(row.group_id) ?? 0) + 1,
      );
    }

    const groups: ShellGroupSummary[] = groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      groupType: g.group_type,
      status: g.status,
      baseCurrency: g.base_currency,
      defaultSplitMode: g.default_split_mode,
      activeSplitCount: splitCountByGroup.get(g.id) ?? 0,
      members: membersByGroup.get(g.id) ?? [],
    }));

    return { user: shellUser, groups };
  } catch {
    return { user: shellUser, groups: [] };
  }
}

export default async function AuthenticatedAppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user, groups } = await loadShellContext();

  return (
    <React.Suspense
      fallback={<div className="min-h-screen w-full bg-canvas-parchment" />}
    >
      <AppShell groups={groups} user={user}>
        {children}
      </AppShell>
    </React.Suspense>
  );
}
