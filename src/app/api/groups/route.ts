import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import {
  createSplitGroup,
  toShellGroupSummary,
  validateCreateGroupPayload,
} from "@/lib/groups/service";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
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

  const validation = validateCreateGroupPayload(body);
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

  const result = await createSplitGroup(
    supabase,
    {
      id: user.id,
      email: user.email,
      fullName: metaName,
    },
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
    },
    { status: 201 },
  );
}
