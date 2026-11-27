import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { updateGroupSimplifyDebts } from "@/lib/groups/service";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

/**
 * Toggle per-group bipartite debt simplification (`Group.simplify_debts`).
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid request payload." },
      { status: 400 },
    );
  }

  const record = body as Record<string, unknown>;
  if (typeof record.simplify_debts !== "boolean") {
    return NextResponse.json(
      { error: "simplify_debts must be a boolean." },
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

  const result = await updateGroupSimplifyDebts(
    supabase,
    user.id,
    groupId.trim(),
    record.simplify_debts,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      groupId: result.groupId,
      simplify_debts: result.simplifyDebts,
    },
    { status: 200 },
  );
}
