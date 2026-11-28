import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { createGroupExpense } from "@/lib/groups/ledger-guards";
import { createClient } from "@/lib/supabase/server";
import type {
  ExpenseSplitMethod,
  SplitBreakdownItem,
} from "@/types/database";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
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

  const { data: member } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId.trim())
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json(
      { error: "You are not a member of this split group." },
      { status: 403 },
    );
  }

  const { data: expenses, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("group_id", groupId.trim())
    .is("deleted_at", null)
    .order("expense_date", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Unable to load group expenses." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, expenses: expenses ?? [] }, { status: 200 });
}

export async function POST(request: NextRequest, context: RouteContext) {
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

  const record = body as Record<string, unknown>;
  const result = await createGroupExpense(supabase, {
    groupId: groupId.trim(),
    userId: user.id,
    paidBy: typeof record.paid_by === "string" ? record.paid_by : undefined,
    description:
      typeof record.description === "string" ? record.description : "",
    category:
      typeof record.category === "string" ? record.category : "General",
    amountCents: Number(record.amount_cents),
    expenseDate:
      typeof record.expense_date === "string" ? record.expense_date : undefined,
    splitMethod:
      typeof record.split_method === "string"
        ? (record.split_method as ExpenseSplitMethod)
        : undefined,
    splitBreakdown: Array.isArray(record.split_breakdown)
      ? (record.split_breakdown as SplitBreakdownItem[])
      : undefined,
    receiptUrl:
      typeof record.receipt_url === "string" ? record.receipt_url : null,
    adjustmentForExpenseId:
      typeof record.adjustment_for_expense_id === "string" &&
      record.adjustment_for_expense_id.trim()
        ? record.adjustment_for_expense_id.trim()
        : null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, expense: result.expense }, { status: 201 });
}
