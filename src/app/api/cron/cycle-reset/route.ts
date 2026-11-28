import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import {
  isValidIsoDateString,
  runCycleResetAndReminders,
} from "@/lib/groups/cycle-reset";
import { createAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

async function handleCycleResetCron(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  let bodyRunDate: string | undefined;
  let bodyGroupId: string | undefined;
  if (request.method === "POST") {
    const contentLength = request.headers.get("content-length");
    if (contentLength !== "0") {
      try {
        const text = await request.text();
        if (text.trim()) {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          if (typeof parsed.run_date === "string") {
            bodyRunDate = parsed.run_date.trim();
          } else if (typeof parsed.date === "string") {
            bodyRunDate = parsed.date.trim();
          }
          if (typeof parsed.group_id === "string") {
            bodyGroupId = parsed.group_id.trim();
          } else if (typeof parsed.groupId === "string") {
            bodyGroupId = parsed.groupId.trim();
          }
        }
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON request body." },
          { status: 400 },
        );
      }
    }
  }

  const queryDate = request.nextUrl.searchParams.get("date")?.trim();
  const queryGroupId = request.nextUrl.searchParams.get("groupId")?.trim();
  const runDate = bodyRunDate || queryDate || undefined;
  const groupId = bodyGroupId || queryGroupId || undefined;

  if (runDate !== undefined && !isValidIsoDateString(runDate)) {
    return NextResponse.json(
      { error: "date must be a valid YYYY-MM-DD date." },
      { status: 400 },
    );
  }

  const cronSecret = process.env.CRON_SECRET?.trim();
  const bearerToken = extractBearerToken(request);

  if (bearerToken !== null) {
    if (!cronSecret || bearerToken !== cronSecret) {
      return NextResponse.json(
        { error: "Unauthorized cron invocation." },
        { status: 401 },
      );
    }

    if (!hasSupabaseAdminEnv()) {
      return NextResponse.json(
        { error: "Supabase service role environment is not configured." },
        { status: 503 },
      );
    }

    const admin = createAdminClient();
    const result = await runCycleResetAndReminders(admin, {
      runDate,
      groupId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status: result.status },
      );
    }

    return NextResponse.json({ ok: true, ...result.summary }, { status: 200 });
  }

  // Fallback for authenticated Group Admin invocation (scoped strictly to user's active ADMIN groups)
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Authentication or valid CRON_SECRET required." },
      { status: 401 },
    );
  }

  const { data: memberships, error: memError } = await supabase
    .from("group_members")
    .select("group_id, role, status")
    .eq("user_id", user.id)
    .eq("status", "ACTIVE")
    .eq("role", "ADMIN");

  if (memError) {
    return NextResponse.json(
      { error: memError.message || "Unable to verify group memberships." },
      { status: 500 },
    );
  }

  const adminGroupIds = (memberships ?? []).map((m) => m.group_id);
  if (groupId && !adminGroupIds.includes(groupId)) {
    return NextResponse.json(
      { error: "Only an active group admin can trigger cycle reset for this group." },
      { status: 403 },
    );
  }

  const result = await runCycleResetAndReminders(supabase, {
    runDate,
    groupId,
    groupIds: groupId ? undefined : adminGroupIds,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, ...result.summary }, { status: 200 });
}

export async function GET(request: NextRequest) {
  return handleCycleResetCron(request);
}

export async function POST(request: NextRequest) {
  return handleCycleResetCron(request);
}
