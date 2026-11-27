import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import {
  softDeleteGroupExpense,
  updateGroupExpense,
} from "@/lib/groups/ledger-guards";
import { createClient } from "@/lib/supabase/server";
import type {
  ExchangeRateSource,
  ExpenseSplitMethod,
  SplitBreakdownItem,
} from "@/types/database";

interface RouteContext {
  params: Promise<{ groupId: string; expenseId: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  const { groupId, expenseId } = await context.params;
  if (!groupId?.trim() || !expenseId?.trim()) {
    return NextResponse.json(
      { error: "Group ID and Expense ID are required." },
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
  const result = await updateGroupExpense(supabase, {
    groupId: groupId.trim(),
    expenseId: expenseId.trim(),
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
    originalAmountCents:
      record.original_amount_cents === null ||
      record.original_amount_cents === undefined
        ? null
        : Number(record.original_amount_cents),
    originalCurrency:
      typeof record.original_currency === "string"
        ? record.original_currency
        : null,
    exchangeRate:
      record.exchange_rate === null || record.exchange_rate === undefined
        ? null
        : Number(record.exchange_rate),
    exchangeRateSource:
      typeof record.exchange_rate_source === "string"
        ? (record.exchange_rate_source as ExchangeRateSource)
        : null,
    receiptUrl:
      record.receipt_url === undefined
        ? undefined
        : typeof record.receipt_url === "string"
          ? record.receipt_url
          : null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      expense: result.expense,
      revision: result.revision,
      notifications: result.notifications,
    },
    { status: 200 },
  );
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json(
      { error: "Supabase environment is not configured." },
      { status: 503 },
    );
  }

  const { groupId, expenseId } = await context.params;
  if (!groupId?.trim() || !expenseId?.trim()) {
    return NextResponse.json(
      { error: "Group ID and Expense ID are required." },
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

  const result = await softDeleteGroupExpense(supabase, {
    groupId: groupId.trim(),
    expenseId: expenseId.trim(),
    userId: user.id,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      expenseId: result.expenseId,
      groupId: result.groupId,
      deletedAt: result.deletedAt,
    },
    { status: 200 },
  );
}
