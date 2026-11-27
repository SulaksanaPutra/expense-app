import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { buildFullLedgerExport } from "@/lib/settings/service";
import { createClient } from "@/lib/supabase/server";

/**
 * Export full ledger history across all user groups in RFC-4180 CSV or JSON.
 *
 * Query params: `format` (`csv` | `json`).
 */
export async function GET(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  const rawFormat = (
    request.nextUrl.searchParams.get("format") ?? "csv"
  )
    .trim()
    .toLowerCase();

  if (rawFormat !== "csv" && rawFormat !== "json") {
    return NextResponse.json(
      { error: "Export format must be 'csv' or 'json'." },
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

  const result = await buildFullLedgerExport(supabase, user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  if (rawFormat === "json") {
    return new NextResponse(result.json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="ledgersplit-full-ledger-history.json"',
        "Cache-Control": "no-store",
      },
    });
  }

  return new NextResponse(result.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="ledgersplit-full-ledger-history.csv"',
      "Cache-Control": "no-store",
    },
  });
}
