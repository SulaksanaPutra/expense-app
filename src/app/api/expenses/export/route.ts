import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { buildScopedLedgerExport } from "@/lib/expenses/export";
import type {
  ExpenseOwnershipFilter,
  ExpenseSortOption,
  ExpenseStatusFilter,
} from "@/lib/expenses/ledger";
import { createClient } from "@/lib/supabase/server";

function parseOwnershipParam(raw: string | null): ExpenseOwnershipFilter {
  if (raw === "paid-by-me" || raw === "split-with-me") return raw;
  return "all";
}

function parseStatusParam(raw: string | null): ExpenseStatusFilter {
  if (raw === "settled" || raw === "pending") return raw;
  return "all";
}

function parseSortParam(raw: string | null): ExpenseSortOption {
  if (
    raw === "date-desc" ||
    raw === "date-asc" ||
    raw === "amount-desc" ||
    raw === "amount-asc" ||
    raw === "share-desc"
  ) {
    return raw;
  }
  return "date-desc";
}

/**
 * Export cycle- and group-scoped ledger transactions in RFC-4180 CSV or JSON.
 *
 * Query params: `group` (`all` or group UUID), `cycle` (`YYYY-MM`), `format` (`csv` | `json`),
 * and optional ledger filters (`cat`, `ownership`, `status`, `q`, `sort`).
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
  const category = request.nextUrl.searchParams.get("cat") ?? "all";
  const ownership = parseOwnershipParam(
    request.nextUrl.searchParams.get("ownership") ??
      request.nextUrl.searchParams.get("tab"),
  );
  const status = parseStatusParam(request.nextUrl.searchParams.get("status"));
  const searchQuery = request.nextUrl.searchParams.get("q") ?? "";
  const sortBy = parseSortParam(request.nextUrl.searchParams.get("sort"));

  const result = await buildScopedLedgerExport(supabase, user.id, {
    groupId,
    cycleSlug,
    category,
    ownership,
    status,
    searchQuery,
    sortBy,
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
