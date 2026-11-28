import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { deleteArchivedGroup } from "@/lib/groups/archive";
import {
  toShellGroupSummary,
  updateSplitGroup,
  validateUpdateGroupPayload,
} from "@/lib/groups/service";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

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

  const validation = validateUpdateGroupPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.message, errors: validation.errors },
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

  const metaName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : null;

  const result = await updateSplitGroup(
    supabase,
    {
      id: user.id,
      email: user.email,
      fullName: metaName,
    },
    groupId,
    validation.data,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      group: result.group,
      shellGroup: toShellGroupSummary(result.group),
      invitedEmails: result.invitedEmails,
      removedMemberIds: result.removedMemberIds,
    },
    { status: 200 },
  );
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
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

  const result = await deleteArchivedGroup(supabase, user.id, groupId);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        ...(result.code ? { code: result.code } : {}),
        ...(result.unsettledMemberCount !== undefined
          ? { unsettledMemberCount: result.unsettledMemberCount }
          : {}),
      },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      groupId: result.groupId,
      groupName: result.groupName,
    },
    { status: 200 },
  );
}
