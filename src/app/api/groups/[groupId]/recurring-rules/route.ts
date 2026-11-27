import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import {
  createGroupRecurringRule,
  deleteGroupRecurringRule,
  updateGroupRecurringRule,
} from "@/lib/groups/ledger-guards";
import { createClient } from "@/lib/supabase/server";
import type { RecurringFrequency, SplitMode } from "@/types/database";

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

  const { data: membership } = await supabase
    .from("group_members")
    .select("status")
    .eq("group_id", groupId.trim())
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json(
      { error: "You are not a member of this split group." },
      { status: 403 },
    );
  }

  const { data: rules, error: rulesError } = await supabase
    .from("recurring_rules")
    .select(
      "id, group_id, created_by, paid_by, description, category, amount_cents, currency, frequency, day_of_month, split_rule, is_active, next_run_date, created_at, updated_at",
    )
    .eq("group_id", groupId.trim())
    .order("day_of_month", { ascending: true });

  if (rulesError) {
    return NextResponse.json(
      { error: rulesError.message || "Unable to load recurring rules." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, rules: rules ?? [] }, { status: 200 });
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
    frequency:
      typeof record.frequency === "string"
        ? (record.frequency as RecurringFrequency)
        : undefined,
    dayOfMonth: Number(record.day_of_month ?? 1),
    splitRule:
      typeof record.split_rule === "string"
        ? (record.split_rule as SplitMode)
        : undefined,
    nextRunDate:
      typeof record.next_run_date === "string"
        ? record.next_run_date
        : undefined,
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
    category:
      typeof record.category === "string" ? record.category : undefined,
    frequency:
      typeof record.frequency === "string"
        ? (record.frequency as RecurringFrequency)
        : undefined,
    dayOfMonth:
      record.day_of_month !== undefined
        ? Number(record.day_of_month)
        : undefined,
    splitRule:
      typeof record.split_rule === "string"
        ? (record.split_rule as SplitMode)
        : undefined,
    paidBy: typeof record.paid_by === "string" ? record.paid_by : undefined,
    nextRunDate:
      typeof record.next_run_date === "string"
        ? record.next_run_date
        : undefined,
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
