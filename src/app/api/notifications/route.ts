import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
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

  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id, user_id, group_id, actor_id, expense_id, revision_id, type, title, description, delta_cents, currency, href, is_read, created_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to load notifications." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, notifications: data ?? [] }, { status: 200 });
}

export async function PATCH(request: NextRequest) {
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

  let ids: string[] | null = null;
  try {
    const body = (await request.json().catch(() => null)) as
      | { ids?: unknown }
      | null;
    if (body && Array.isArray(body.ids)) {
      ids = body.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    }
  } catch {
    ids = null;
  }

  let query = supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", user.id)
    .eq("is_read", false);

  if (ids && ids.length > 0) {
    query = query.in("id", ids);
  }

  const { error } = await query;
  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to update notifications." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
