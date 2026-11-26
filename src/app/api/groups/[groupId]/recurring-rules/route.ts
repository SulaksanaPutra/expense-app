import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import {
  createGroupRecurringRule,
  deleteGroupRecurringRule,
  updateGroupRecurringRule,
} from "@/lib/groups/ledger-guards";
import { createClient } from "@/lib/supabase/server";
import type { SplitMode } from "@/types/database";

interface RouteContext {
  params: Promise<{ groupId: string }>;
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
  const result = await createGroupRecurringRule(supabase, {
    groupId: groupId.trim(),
    userId: user.id,
    paidBy: typeof record.paid_by === "string" ? record.paid_by : undefined,
    description:
      typeof record.description === "string" ? record.description : "",
    category:
      typeof record.category === "string" ? record.category : "General",
    amountCents: Number(record.amount_cents),
    dayOfMonth: Number(record.day_of_month ?? 1),
    splitRule:
      typeof record.split_rule === "string"
        ? (record.split_rule as SplitMode)
        : undefined,
    nextRunDate:
      typeof record.next_run_date === "string"
        ? record.next_run_date
        : new Date().toISOString().slice(0, 10),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, rule: result.rule }, { status: 201 });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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
  const ruleId = typeof record.rule_id === "string" ? record.rule_id : "";
  if (!ruleId.trim()) {
    return NextResponse.json(
      { error: "rule_id is required." },
      { status: 400 },
    );
  }

  const result = await updateGroupRecurringRule(supabase, {
    groupId: groupId.trim(),
    userId: user.id,
    ruleId: ruleId.trim(),
    isActive:
      typeof record.is_active === "boolean" ? record.is_active : undefined,
    amountCents:
      record.amount_cents !== undefined
        ? Number(record.amount_cents)
        : undefined,
    description:
      typeof record.description === "string" ? record.description : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, rule: result.rule }, { status: 200 });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
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

  const ruleId = request.nextUrl.searchParams.get("rule_id") ?? "";
  if (!ruleId.trim()) {
    return NextResponse.json(
      { error: "rule_id query parameter is required." },
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

  const result = await deleteGroupRecurringRule(supabase, {
    groupId: groupId.trim(),
    userId: user.id,
    ruleId: ruleId.trim(),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, ruleId: result.ruleId }, { status: 200 });
}
