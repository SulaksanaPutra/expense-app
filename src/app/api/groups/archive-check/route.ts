import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { runArchiveRulesEvaluation } from "@/lib/groups/archive";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
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

  const result = await runArchiveRulesEvaluation(supabase);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      ...result.summary,
    },
    { status: 200 },
  );
}
