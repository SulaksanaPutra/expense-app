import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "@/lib/auth/guards";
import {
  getActiveReminderCooldowns,
  sendBatchSettlementReminders,
  sendSettlementReminder,
} from "@/lib/groups/reminders";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

/**
 * List active 24h settlement reminder cooldowns for the authenticated creditor in a group.
 */
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
    .select("user_id")
    .eq("group_id", groupId.trim())
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json(
      { error: "You are not a member of this split group." },
      { status: 403 },
    );
  }

  const cooldowns = await getActiveReminderCooldowns(supabase, user.id, [
    groupId.trim(),
  ]);

  return NextResponse.json({ ok: true, cooldowns }, { status: 200 });
}

/**
 * Dispatch settlement reminder(s) for a group with 24h cooldown and SMS opt-in gating.
 */
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
  const trimmedGroupId = groupId.trim();

  // Batch mode within group when debtor_ids array is provided
  if (Array.isArray(record.debtor_ids)) {
    const debtorIds = record.debtor_ids
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim());

    if (debtorIds.length === 0) {
      return NextResponse.json(
        { error: "At least one debtor_id is required." },
        { status: 400 },
      );
    }

    const batch = await sendBatchSettlementReminders(supabase, {
      creditorId: user.id,
      targets: debtorIds.map((debtorId) => ({
        groupId: trimmedGroupId,
        debtorId,
      })),
    });

    if (batch.sent.length === 0 && batch.rateLimited.length > 0) {
      const firstCooldown = batch.rateLimited[0].cooldown;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(firstCooldown.remainingMs / 1000),
      );
      return NextResponse.json(
        {
          error: batch.rateLimited[0].message,
          code: "REMINDER_COOLDOWN",
          remaining_hours: firstCooldown.remainingHours,
          retry_after_seconds: retryAfterSeconds,
          cooldown: firstCooldown,
          rateLimited: batch.rateLimited,
        },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSeconds) },
        },
      );
    }

    if (batch.sent.length === 0 && batch.failed.length > 0) {
      const firstFail = batch.failed[0];
      return NextResponse.json(
        { error: firstFail.message, code: firstFail.code },
        { status: firstFail.status },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        sent: batch.sent,
        rateLimited: batch.rateLimited,
        failed: batch.failed,
      },
      { status: 201 },
    );
  }

  // Single-debtor mode
  const debtorId =
    typeof record.debtor_id === "string" ? record.debtor_id.trim() : "";
  const amountCents =
    typeof record.amount_cents === "number" && Number.isFinite(record.amount_cents)
      ? record.amount_cents
      : undefined;

  const result = await sendSettlementReminder(supabase, {
    groupId: trimmedGroupId,
    creditorId: user.id,
    debtorId,
    amountCents,
  });

  if (!result.ok) {
    if (result.status === 429 && result.cooldown) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(result.cooldown.remainingMs / 1000),
      );
      return NextResponse.json(
        {
          error: result.message,
          code: result.code,
          remaining_hours: result.cooldown.remainingHours,
          retry_after_seconds: retryAfterSeconds,
          last_sent_at: result.cooldown.sentAt,
          next_allowed_at: result.cooldown.nextAllowedAt,
          cooldown: result.cooldown,
        },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSeconds) },
        },
      );
    }

    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      reminder: result.reminder,
      channel: result.channel,
      deliveryMode: result.deliveryMode,
      cooldown: result.cooldown,
      notification: result.notification,
    },
    { status: 201 },
  );
}
