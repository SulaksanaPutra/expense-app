import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { unarchiveGroup } from "@/lib/groups/archive";
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

  const result = await unarchiveGroup(supabase, user.id, groupId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      groupId: result.groupId,
      status: result.status,
      archivedAt: result.archivedAt,
      auditEntry: result.auditEntry,
    },
    { status: 200 },
  );
}
