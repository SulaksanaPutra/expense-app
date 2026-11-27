import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { buildScopedLedgerExport } from "@/lib/expenses/export";
import { createClient } from "@/lib/supabase/server";

/**
 * Export cycle- and group-scoped ledger transactions in RFC-4180 CSV or JSON.
 *
 * Query params: `group` (`all` or group UUID), `cycle` (`YYYY-MM`), `format` (`csv` | `json`).
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

  const groupId = request.nextUrl.searchParams.get("group") ?? "all";
  const cycleSlug = request.nextUrl.searchParams.get("cycle");

  const result = await buildScopedLedgerExport(supabase, user.id, {
    groupId,
    cycleSlug,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  const safeScope = result.scopeLabel.replace(/[^a-zA-Z0-9._-]/g, "-");
  const safeCycle = result.cycleSlug.replace(/[^0-9-]/g, "");

  if (rawFormat === "json") {
    return new NextResponse(result.json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="ledgersplit-${safeScope}-${safeCycle}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new NextResponse(result.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ledgersplit-${safeScope}-${safeCycle}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
