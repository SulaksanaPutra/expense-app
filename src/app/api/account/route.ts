import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { deleteUserAccount, getUserGroupBalances } from "@/lib/groups/departure";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const result = await getUserGroupBalances(supabase, user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  const unsettledGroups = result.balances.filter(
    (b) => b.netBalanceCents !== 0,
  );

  return NextResponse.json(
    {
      canDelete: unsettledGroups.length === 0,
      balances: result.balances,
      unsettledGroups,
    },
    { status: 200 },
  );
}

export async function DELETE() {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const adminSupabase = hasSupabaseAdminEnv() ? createAdminClient() : null;
  const result = await deleteUserAccount(supabase, user.id, adminSupabase);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        unsettledGroups: result.unsettledGroups,
      },
      { status: result.status },
    );
  }

  return NextResponse.json(result, { status: 200 });
}
