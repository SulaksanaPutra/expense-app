import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import { createGroupSettlement } from "@/lib/groups/ledger-guards";
import { createClient } from "@/lib/supabase/server";
import type { PaymentRail } from "@/types/database";

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
  const result = await createGroupSettlement(supabase, {
    groupId: groupId.trim(),
    userId: user.id,
    payerId: typeof record.payer_id === "string" ? record.payer_id : "",
    recipientId:
      typeof record.recipient_id === "string" ? record.recipient_id : "",
    amountCents: Number(record.amount_cents),
    paymentRail:
      typeof record.payment_rail === "string"
        ? (record.payment_rail as PaymentRail)
        : "OTHER",
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
