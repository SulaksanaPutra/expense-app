import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { getSettingsPageData, updateUserSettings } from "@/lib/settings/service";
import { createClient } from "@/lib/supabase/server";

function extractAuthUserMeta(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}) {
  return {
    id: user.id,
    email: user.email ?? null,
    fullName:
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : null,
    avatarUrl:
      typeof user.user_metadata?.avatar_url === "string"
        ? user.user_metadata.avatar_url
        : null,
  };
}

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

  const data = await getSettingsPageData(supabase, extractAuthUserMeta(user));
  if (data.loadError) {
    return NextResponse.json({ error: data.loadError }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      profile: data.profile,
      groupCount: data.groupCount,
      settlementHandles: data.settlementHandles,
    },
    { status: 200 },
  );
}

export async function PATCH(request: NextRequest) {
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

  const result = await updateUserSettings(
    supabase,
    extractAuthUserMeta(user),
    body,
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json(result, { status: 200 });
}
