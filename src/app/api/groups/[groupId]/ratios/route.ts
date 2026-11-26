import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { updateGroupSplitRatios } from "@/lib/groups/onboarding";
import { createClient } from "@/lib/supabase/server";
import type { SplitMode } from "@/types/database";

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

  const record = body as Record<string, unknown>;
  const rawMode =
    typeof record.default_split_mode === "string"
      ? record.default_split_mode.trim()
      : "";

  if (rawMode !== "EQUAL" && rawMode !== "CUSTOM_RATIOS") {
    return NextResponse.json(
      { error: "default_split_mode must be EQUAL or CUSTOM_RATIOS." },
      { status: 400 },
    );
  }

  const rawAllocations = Array.isArray(record.allocations)
    ? record.allocations
    : [];
  const allocations = rawAllocations.map((item) => {
    const obj = (item && typeof item === "object" ? item : {}) as Record<
      string,
      unknown
    >;
    return {
      userId: typeof obj.user_id === "string" ? obj.user_id : "",
      sharePercentage:
        typeof obj.share_percentage === "number"
          ? obj.share_percentage
          : Number(obj.share_percentage),
    };
  });

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

  const result = await updateGroupSplitRatios(
    supabase,
    user.id,
    groupId.trim(),
    {
      defaultSplitMode: rawMode as SplitMode,
      allocations,
    },
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.status },
    );
  }

  return NextResponse.json(result, { status: 200 });
}
