import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { leaveGroup } from "@/lib/groups/departure";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  const { groupId } = await context.params;
  if (!groupId || !groupId.trim()) {
    return NextResponse.json(
      { error: "Group ID is required." },
      { status: 400 },
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

  const result = await leaveGroup(supabase, user.id, groupId.trim());

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        groupId: result.groupId,
        groupName: result.groupName,
        baseCurrency: result.baseCurrency,
        netBalanceCents: result.netBalanceCents,
        formattedBalance: result.formattedBalance,
      },
      { status: result.status },
    );
  }

  return NextResponse.json(result, { status: 200 });
}
