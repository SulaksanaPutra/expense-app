import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { sendGroupEmailInvite } from "@/lib/groups/onboarding";
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 },
    );
  }

  const rawEmail =
    body &&
    typeof body === "object" &&
    typeof (body as Record<string, unknown>).email === "string"
      ? (body as Record<string, unknown>).email as string
      : "";

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

  const metaName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : null;

  const result = await sendGroupEmailInvite(
    supabase,
    {
      id: user.id,
      email: user.email,
      fullName: metaName,
    },
    groupId.trim(),
    rawEmail,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json({ invite: result.invite }, { status: 201 });
}
