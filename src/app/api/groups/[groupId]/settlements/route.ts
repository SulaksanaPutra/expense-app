import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { createGroupSettlement } from "@/lib/groups/ledger-guards";
import { createClient } from "@/lib/supabase/server";
import type { PaymentRail } from "@/types/database";

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

  const { data: settlements, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("group_id", groupId.trim())
    .order("settled_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Unable to load group settlements." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, settlements: settlements ?? [] },
    { status: 200 },
  );
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
  const paymentRail =
    record.payment_rail === undefined || record.payment_rail === null
      ? "OTHER"
      : typeof record.payment_rail === "string"
        ? (record.payment_rail.trim().toUpperCase() as PaymentRail)
        : ("__INVALID__" as PaymentRail);

  const result = await createGroupSettlement(supabase, {
    groupId: groupId.trim(),
    userId: user.id,
    payerId: typeof record.payer_id === "string" ? record.payer_id : "",
    recipientId:
      typeof record.recipient_id === "string" ? record.recipient_id : "",
    amountCents: Number(record.amount_cents),
    paymentRail,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json(
    { ok: true, settlement: result.settlement },
    { status: 201 },
  );
}
