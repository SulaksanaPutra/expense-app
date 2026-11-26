import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { regenerateGroupInviteLink } from "@/lib/groups/onboarding";
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

  const result = await regenerateGroupInviteLink(
    supabase,
    user.id,
    groupId.trim(),
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      groupId: result.groupId,
      slug: result.slug,
      inviteToken: result.inviteToken,
      inviteTokenVersion: result.inviteTokenVersion,
      invitePath: result.invitePath,
    },
    { status: 200 },
  );
}
