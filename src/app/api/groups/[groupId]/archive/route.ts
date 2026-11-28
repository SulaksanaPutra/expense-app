import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { archiveGroup } from "@/lib/groups/archive";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
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

  let reason: string | undefined;
  try {
    const body = (await request.json().catch(() => null)) as {
      reason?: unknown;
    } | null;
    if (body && typeof body.reason === "string") {
      reason = body.reason;
    }
  } catch {
    reason = undefined;
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

  const result = await archiveGroup(supabase, user.id, groupId, reason);
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
