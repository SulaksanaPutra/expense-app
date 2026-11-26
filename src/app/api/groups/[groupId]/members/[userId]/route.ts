import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { removeGroupMember } from "@/lib/groups/departure";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ groupId: string; userId: string }>;
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  const { groupId, userId: targetUserId } = await context.params;
  if (!groupId || !groupId.trim() || !targetUserId || !targetUserId.trim()) {
    return NextResponse.json(
      { error: "Group ID and target user ID are required." },
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

  const result = await removeGroupMember(
    supabase,
    user.id,
    groupId.trim(),
    targetUserId.trim(),
  );

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        netBalanceCents: result.netBalanceCents,
      },
      { status: result.status },
    );
  }

  return NextResponse.json(result, { status: 200 });
}
