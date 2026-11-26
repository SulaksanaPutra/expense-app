import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import {
  archiveGroup,
  snoozeResidentialLeasePrompt,
  unarchiveGroup,
  updateGroupArchiveRules,
} from "@/lib/groups/archive";
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

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid request payload." },
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

  const record = body as Record<string, unknown>;
  const action =
    typeof record.action === "string" ? record.action.trim().toUpperCase() : "";

  let result;
  if (action === "ARCHIVE") {
    const reason =
      typeof record.reason === "string" ? record.reason : undefined;
    result = await archiveGroup(supabase, user.id, groupId.trim(), reason);
  } else if (action === "UNARCHIVE") {
    result = await unarchiveGroup(supabase, user.id, groupId.trim());
  } else if (action === "SNOOZE_LEASE_PROMPT") {
    const snoozeDays =
      typeof record.snooze_days === "number" ? record.snooze_days : 30;
    result = await snoozeResidentialLeasePrompt(
      supabase,
      user.id,
      groupId.trim(),
      snoozeDays,
    );
  } else {
    result = await updateGroupArchiveRules(supabase, user.id, groupId.trim(), {
      trip_auto_archive_enabled:
        typeof record.trip_auto_archive_enabled === "boolean"
          ? record.trip_auto_archive_enabled
          : undefined,
      trip_auto_archive_days:
        record.trip_auto_archive_days !== undefined
          ? Number(record.trip_auto_archive_days)
          : undefined,
      residential_lease_prompt_enabled:
        typeof record.residential_lease_prompt_enabled === "boolean"
          ? record.residential_lease_prompt_enabled
          : undefined,
      lease_end_date:
        record.lease_end_date === null ||
        typeof record.lease_end_date === "string"
          ? record.lease_end_date
          : undefined,
    });
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json(result, { status: 200 });
}
