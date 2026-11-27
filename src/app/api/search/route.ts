import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { getCycleSlugForDate } from "@/lib/expenses/ledger";
import { createClient } from "@/lib/supabase/server";

function sanitizeIlikePattern(raw: string): string {
  return raw.replace(/[%_\\,()]/g, " ").trim();
}

export interface SearchExpenseMatch {
  id: string;
  groupId: string;
  groupName: string;
  description: string;
  category: string;
  amountCents: number;
  currency: string;
  expenseDate: string;
  cycleSlug: string;
}

export interface SearchGroupMatch {
  id: string;
  name: string;
  slug: string;
  baseCurrency: string;
  status: string;
}

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

  const rawQuery = request.nextUrl.searchParams.get("q") ?? "";
  const cleaned = sanitizeIlikePattern(rawQuery);

  const { data: groupRows, error: groupsError } = await supabase
    .from("groups")
    .select("id, name, slug, base_currency, status, billing_cycle_anchor_day")
    .neq("status", "ARCHIVED")
    .order("created_at", { ascending: true });

  if (groupsError) {
    return NextResponse.json(
      { error: groupsError.message || "Failed to search groups." },
      { status: 500 },
    );
  }

  const allGroups = groupRows ?? [];
  const groupMap = new Map(allGroups.map((g) => [g.id, g]));
  const lowerQ = rawQuery.trim().toLowerCase();

  const matchingGroups: SearchGroupMatch[] = allGroups
    .filter(
      (g) =>
        !lowerQ ||
        g.name.toLowerCase().includes(lowerQ) ||
        g.slug.toLowerCase().includes(lowerQ),
    )
    .slice(0, 6)
    .map((g) => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      baseCurrency: g.base_currency,
      status: g.status,
    }));

  if (allGroups.length === 0) {
    return NextResponse.json({
      groups: matchingGroups,
      expenses: [] as SearchExpenseMatch[],
    });
  }

  const groupIds = allGroups.map((g) => g.id);

  let expenseQuery = supabase
    .from("expenses")
    .select(
      "id, group_id, description, category, amount_cents, currency, expense_date",
    )
    .in("group_id", groupIds)
    .is("deleted_at", null)
    .order("expense_date", { ascending: false })
    .limit(8);

  if (cleaned) {
    expenseQuery = expenseQuery.or(
      `description.ilike.%${cleaned}%,category.ilike.%${cleaned}%`,
    );
  }

  const { data: expenseRows, error: expensesError } = await expenseQuery;

  if (expensesError) {
    return NextResponse.json(
      { error: expensesError.message || "Failed to search expenses." },
      { status: 500 },
    );
  }

  const matchingExpenses: SearchExpenseMatch[] = (expenseRows ?? []).map((e) => {
    const group = groupMap.get(e.group_id);
    const anchorDay = group?.billing_cycle_anchor_day ?? 1;
    return {
      id: e.id,
      groupId: e.group_id,
      groupName: group?.name ?? "Split Group",
      description: e.description,
      category: e.category,
      amountCents: Number(e.amount_cents),
      currency: e.currency,
      expenseDate: e.expense_date,
      cycleSlug: getCycleSlugForDate(e.expense_date, anchorDay),
    };
  });

  return NextResponse.json({
    groups: matchingGroups,
    expenses: matchingExpenses,
  });
}
