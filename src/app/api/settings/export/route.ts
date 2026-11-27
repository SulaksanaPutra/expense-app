import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { buildFullLedgerExport } from "@/lib/settings/service";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
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

  const format =
    request.nextUrl.searchParams.get("format")?.toLowerCase() === "json"
      ? "json"
      : "csv";

  const result = await buildFullLedgerExport(supabase, user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  if (format === "json") {
    return new NextResponse(result.json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="ledgersplit-full-ledger-history.json"',
      },
    });
  }

  return new NextResponse(result.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="ledgersplit-full-ledger-history.csv"',
    },
  });
}
