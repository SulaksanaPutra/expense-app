import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { acceptGroupInvite } from "@/lib/groups/onboarding";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!hasSupabaseEnv() || !hasSupabaseAdminEnv()) {
    return NextResponse.json(
      { error: "Supabase invite onboarding environment is not configured." },
      { status: 503 },
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
      { error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  const record = body as Record<string, unknown>;
  const slug = typeof record.slug === "string" ? record.slug.trim() : "";
  const token = typeof record.token === "string" ? record.token.trim() : "";

  if (!slug) {
    return NextResponse.json(
      { error: "Group slug is required.", code: "MISSING_SLUG" },
      { status: 400 },
    );
  }

  if (!token) {
    return NextResponse.json(
      { error: "Invite token is required.", code: "MISSING_TOKEN" },
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
      { error: "Authentication required to accept an invite." },
      { status: 401 },
    );
  }

  const metaName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : null;

  const adminSupabase = createAdminClient();
  const result = await acceptGroupInvite(adminSupabase, {
    slug,
    token,
    authUser: {
      id: user.id,
      email: user.email,
      fullName: metaName,
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json(result, { status: 200 });
}
