import type { SupabaseClient } from "@supabase/supabase-js";
import { computePerGroupDebtEdges } from "@/lib/expenses/debt-simplification";
import { formatMinorUnits } from "@/lib/money";
import type {
  Database,
  ReminderChannel,
  SplitBreakdownItem,
} from "@/types/database";

export const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

export interface ReminderCooldownInfo {
  groupId: string;
  debtorId: string;
  creditorId: string;
  channel: ReminderChannel;
  sentAt: string;
  nextAllowedAt: string;
  remainingMs: number;
  remainingHours: number;
}

export interface SendReminderInput {
  groupId: string;
  creditorId: string;
  debtorId: string;
  amountCents?: number | null;
  nowMs?: number;
}

export interface BatchReminderTarget {
  groupId: string;
  debtorId: string;
  amountCents?: number | null;
}

export type ReminderDeliveryMode = "sms" | "sandbox_sms" | "push";

export type SendReminderResult =
  | {
      ok: true;
      reminder: Database["public"]["Tables"]["reminder_logs"]["Row"];
      channel: ReminderChannel;
      deliveryMode: ReminderDeliveryMode;
      cooldown: ReminderCooldownInfo;
      notification: Database["public"]["Tables"]["notifications"]["Row"];
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      cooldown?: ReminderCooldownInfo;
    };

export interface SendBatchRemindersResult {
  sent: Array<Extract<SendReminderResult, { ok: true }>>;
  rateLimited: Array<{
    groupId: string;
    debtorId: string;
    message: string;
    cooldown: ReminderCooldownInfo;
  }>;
  failed: Array<{
    groupId: string;
    debtorId: string;
    status: number;
    code: string;
    message: string;
  }>;
}

export interface TwilioDispatchResult {
  ok: boolean;
  mode: "twilio" | "sandbox";
  sid?: string;
  error?: string;
}

export function getReminderCooldownKey(groupId: string, debtorId: string): string {
  return `${groupId}::${debtorId}`;
}

export function formatCooldownLabel(remainingHours: number): string {
  const safeHours = Math.max(1, Math.trunc(remainingHours));
  return `Reminded today (${safeHours}h remaining)`;
}

export function computeReminderCooldown(params: {
  groupId: string;
  debtorId: string;
  creditorId: string;
  channel: ReminderChannel;
  sentAt: string;
  nowMs?: number;
}): ReminderCooldownInfo | null {
  const nowMs = params.nowMs ?? Date.now();
  const sentAtMs = Date.parse(params.sentAt);
  if (!Number.isFinite(sentAtMs)) {
    return null;
  }

  const elapsedMs = Math.max(0, nowMs - sentAtMs);
  if (elapsedMs >= REMINDER_COOLDOWN_MS) {
    return null;
  }

  const remainingMs = REMINDER_COOLDOWN_MS - elapsedMs;
  const remainingHours = Math.max(1, Math.ceil(remainingMs / MS_PER_HOUR));
  const nextAllowedAt = new Date(sentAtMs + REMINDER_COOLDOWN_MS).toISOString();

  return {
    groupId: params.groupId,
    debtorId: params.debtorId,
    creditorId: params.creditorId,
    channel: params.channel,
    sentAt: params.sentAt,
    nextAllowedAt,
    remainingMs,
    remainingHours,
  };
}

export function shouldDispatchSmsReminder(debtor: {
  phone_number?: string | null;
  phone_verified?: boolean | null;
  notification_prefs?: unknown;
}): { useSms: boolean; phoneNumber: string | null; reason: string } {
  const phone =
    typeof debtor.phone_number === "string" ? debtor.phone_number.trim() : "";
  const verified = Boolean(debtor.phone_verified);

  const rawPrefs =
    debtor.notification_prefs && typeof debtor.notification_prefs === "object"
      ? (debtor.notification_prefs as Record<string, unknown>)
      : {};
  const smsOptIn = rawPrefs.sms_nudges_opt_in === true;

  if (!smsOptIn) {
    return {
      useSms: false,
      phoneNumber: null,
      reason: "sms_nudges_opt_in_disabled",
    };
  }

  if (!verified || !phone) {
    return {
      useSms: false,
      phoneNumber: null,
      reason: "phone_not_verified",
    };
  }

  return {
    useSms: true,
    phoneNumber: phone,
    reason: "sms_opt_in_verified",
  };
}

export async function dispatchTwilioSms(params: {
  to: string;
  body: string;
}): Promise<TwilioDispatchResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim() ?? "";
  const messagingServiceSid =
    process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() ?? "";

  if (
    !accountSid ||
    !authToken ||
    (!fromNumber && !messagingServiceSid)
  ) {
    return {
      ok: true,
      mode: "sandbox",
      sid: `SM_SANDBOX_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    };
  }

  try {
    const formBody = new URLSearchParams({
      To: params.to,
      Body: params.body,
    });
    if (messagingServiceSid) {
      formBody.set("MessagingServiceSid", messagingServiceSid);
    } else {
      formBody.set("From", fromNumber);
    }

    const authHeader = Buffer.from(`${accountSid}:${authToken}`, "utf8").toString(
      "base64",
    );

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formBody.toString(),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        ok: false,
        mode: "twilio",
        error:
          errorText || `Twilio API returned HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      sid?: string;
    };

    return {
      ok: true,
      mode: "twilio",
      sid: payload.sid ?? undefined,
    };
  } catch (err) {
    return {
      ok: false,
      mode: "twilio",
      error:
        err instanceof Error
          ? err.message
          : "Network failure while dispatching Twilio SMS.",
    };
  }
}

export async function getActiveReminderCooldowns(
  supabase: SupabaseClient<Database>,
  creditorId: string,
  groupIds?: readonly string[],
  nowMs: number = Date.now(),
): Promise<ReminderCooldownInfo[]> {
  if (!creditorId || (groupIds && groupIds.length === 0)) {
    return [];
  }

  try {
    const cutoffIso = new Date(nowMs - REMINDER_COOLDOWN_MS).toISOString();
    let query = supabase
      .from("reminder_logs")
      .select("id, creditor_id, debtor_id, group_id, channel, sent_at")
      .eq("creditor_id", creditorId)
      .gte("sent_at", cutoffIso)
      .order("sent_at", { ascending: false });

    if (groupIds && groupIds.length > 0) {
      query = query.in("group_id", [...groupIds]);
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data)) {
      return [];
    }

    const latestByKey = new Map<string, ReminderCooldownInfo>();
    for (const row of data) {
      const key = getReminderCooldownKey(row.group_id, row.debtor_id);
      if (latestByKey.has(key)) continue;
      const cooldown = computeReminderCooldown({
        groupId: row.group_id,
        debtorId: row.debtor_id,
        creditorId: row.creditor_id,
        channel: row.channel,
        sentAt: row.sent_at,
        nowMs,
      });
      if (cooldown) {
        latestByKey.set(key, cooldown);
      }
    }

    return Array.from(latestByKey.values());
  } catch {
    return [];
  }
}

async function resolveOwedAmountCents(
  supabase: SupabaseClient<Database>,
  params: {
    groupId: string;
    groupName: string;
    baseCurrency: string;
    simplifyDebts: boolean;
    creditorId: string;
    debtorId: string;
  },
): Promise<number | null> {
  try {
    const [{ data: memberRows }, { data: expenseRows }, { data: settlementRows }] =
      await Promise.all([
        supabase
          .from("group_members")
          .select("user_id")
          .eq("group_id", params.groupId),
        supabase
          .from("expenses")
          .select("group_id, paid_by, amount_cents, split_breakdown")
          .eq("group_id", params.groupId)
          .is("deleted_at", null),
        supabase
          .from("settlements")
          .select("group_id, payer_id, recipient_id, amount_cents")
          .eq("group_id", params.groupId),
      ]);

    if (!expenseRows) return null;

    const edges = computePerGroupDebtEdges({
      group: {
        id: params.groupId,
        name: params.groupName,
        baseCurrency: params.baseCurrency,
        simplifyDebts: params.simplifyDebts,
        members: (memberRows ?? []).map((m) => ({
          userId: m.user_id,
          name: "Member",
          instantSettlementTag: null,
        })),
      },
      expenses: expenseRows.map((e) => ({
        groupId: e.group_id,
        paidBy: e.paid_by,
        amountCents: Number(e.amount_cents),
        splitBreakdown: Array.isArray(e.split_breakdown)
          ? (e.split_breakdown as unknown as SplitBreakdownItem[])
          : [],
      })),
      settlements: (settlementRows ?? []).map((s) => ({
        groupId: s.group_id,
        payerId: s.payer_id,
        recipientId: s.recipient_id,
        amountCents: Number(s.amount_cents),
      })),
    });

    const match = edges.find(
      (edge) =>
        edge.payerId === params.debtorId &&
        edge.recipientId === params.creditorId,
    );
    return match ? match.amountCents : null;
  } catch {
    return null;
  }
}

export async function sendSettlementReminder(
  supabase: SupabaseClient<Database>,
  input: SendReminderInput,
): Promise<SendReminderResult> {
  const groupId = input.groupId?.trim();
  const creditorId = input.creditorId?.trim();
  const debtorId = input.debtorId?.trim();
  const nowMs = input.nowMs ?? Date.now();

  if (!groupId || !creditorId || !debtorId) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REMINDER_TARGET",
      message: "group_id and debtor_id are required.",
    };
  }

  if (creditorId === debtorId) {
    return {
      ok: false,
      status: 400,
      code: "SELF_REMINDER_NOT_ALLOWED",
      message: "You cannot send a settlement reminder to yourself.",
    };
  }

  // 1. Validate group exists and is not ARCHIVED
  const { data: groupRow, error: groupErr } = await supabase
    .from("groups")
    .select("id, name, status, base_currency, simplify_debts")
    .eq("id", groupId)
    .maybeSingle();

  if (groupErr) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: groupErr.message || "Unable to load split group.",
    };
  }

  if (!groupRow) {
    return {
      ok: false,
      status: 404,
      code: "GROUP_NOT_FOUND",
      message: "Split group was not found.",
    };
  }

  if (groupRow.status === "ARCHIVED") {
    return {
      ok: false,
      status: 409,
      code: "GROUP_ARCHIVED",
      message: "Archived groups are strictly read-only.",
    };
  }

  // 2. Verify active membership of creditor and group membership of debtor
  const { data: memberRows, error: memErr } = await supabase
    .from("group_members")
    .select("user_id, role, status")
    .eq("group_id", groupId)
    .in("user_id", [creditorId, debtorId]);

  if (memErr) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: memErr.message || "Unable to verify group membership.",
    };
  }

  const creditorMembership = (memberRows ?? []).find(
    (m) => m.user_id === creditorId,
  );
  if (!creditorMembership || creditorMembership.status !== "ACTIVE") {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message:
        "Only active group members can send settlement reminders.",
    };
  }

  const debtorMembership = (memberRows ?? []).find(
    (m) => m.user_id === debtorId,
  );
  if (!debtorMembership) {
    return {
      ok: false,
      status: 404,
      code: "DEBTOR_NOT_IN_GROUP",
      message: "Recipient is not a member of this split group.",
    };
  }

  // 3. Enforce strict 24-hour cooldown per (creditor_id, debtor_id, group_id)
  const cutoffIso = new Date(nowMs - REMINDER_COOLDOWN_MS).toISOString();
  const { data: recentLogs, error: cooldownErr } = await supabase
    .from("reminder_logs")
    .select("id, creditor_id, debtor_id, group_id, channel, sent_at")
    .eq("creditor_id", creditorId)
    .eq("debtor_id", debtorId)
    .eq("group_id", groupId)
    .gte("sent_at", cutoffIso)
    .order("sent_at", { ascending: false })
    .limit(1);

  if (cooldownErr) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: cooldownErr.message || "Unable to check reminder cooldown.",
    };
  }

  const latestLog = (recentLogs ?? [])[0];
  if (latestLog) {
    const cooldown = computeReminderCooldown({
      groupId,
      debtorId,
      creditorId,
      channel: latestLog.channel,
      sentAt: latestLog.sent_at,
      nowMs,
    });
    if (cooldown) {
      return {
        ok: false,
        status: 429,
        code: "REMINDER_COOLDOWN",
        message: `Reminder already sent within the last 24 hours (${cooldown.remainingHours}h remaining).`,
        cooldown,
      };
    }
  }

  // 4. Fetch creditor & debtor user profiles (SMS opt-in + verified phone gating)
  const { data: userRows, error: userErr } = await supabase
    .from("users")
    .select(
      "id, full_name, email, phone_number, phone_verified, notification_prefs",
    )
    .in("id", [creditorId, debtorId]);

  if (userErr) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: userErr.message || "Unable to load reminder participant details.",
    };
  }

  const creditorRow = (userRows ?? []).find((u) => u.id === creditorId);
  const debtorRow = (userRows ?? []).find((u) => u.id === debtorId);
  if (!debtorRow) {
    return {
      ok: false,
      status: 404,
      code: "DEBTOR_NOT_FOUND",
      message: "Recipient user profile was not found.",
    };
  }

  const creditorName =
    creditorRow?.full_name?.trim() ||
    creditorRow?.email?.trim() ||
    "A group member";

  let amountCents: number | null =
    typeof input.amountCents === "number" &&
    Number.isFinite(input.amountCents) &&
    input.amountCents > 0
      ? Math.trunc(input.amountCents)
      : null;

  if (amountCents === null) {
    amountCents = await resolveOwedAmountCents(supabase, {
      groupId,
      groupName: groupRow.name,
      baseCurrency: groupRow.base_currency,
      simplifyDebts: Boolean(groupRow.simplify_debts),
      creditorId,
      debtorId,
    });
  }

  const amountSuffix =
    amountCents && amountCents > 0
      ? ` for ${formatMinorUnits(amountCents, groupRow.base_currency)}`
      : "";
  const reminderMessage = `${creditorName} sent you a settlement reminder${amountSuffix} in ${groupRow.name}.`;

  // 5. Evaluate SMS consent + phone verification -> dispatch Twilio SMS or Push/in-app fallback
  const smsGate = shouldDispatchSmsReminder(debtorRow);
  let channel: ReminderChannel = "PUSH";
  let deliveryMode: ReminderDeliveryMode = "push";

  if (smsGate.useSms && smsGate.phoneNumber) {
    const smsResult = await dispatchTwilioSms({
      to: smsGate.phoneNumber,
      body: `LedgerSplit: ${reminderMessage}`,
    });
    if (smsResult.ok) {
      channel = "SMS";
      deliveryMode = smsResult.mode === "twilio" ? "sms" : "sandbox_sms";
    } else {
      // Fallback to Push/in-app if external SMS gateway fails
      channel = "PUSH";
      deliveryMode = "push";
    }
  }

  // 6. Persist ReminderLog entry
  const sentAtIso = new Date(nowMs).toISOString();
  const reminderId = crypto.randomUUID();

  const { data: insertedReminder, error: insertErr } = await supabase
    .from("reminder_logs")
    .insert({
      id: reminderId,
      creditor_id: creditorId,
      debtor_id: debtorId,
      group_id: groupId,
      channel,
      sent_at: sentAtIso,
    })
    .select("*")
    .single();

  if (insertErr || !insertedReminder) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: insertErr?.message || "Failed to log settlement reminder.",
    };
  }

  // 7. Persist in-app notification for the debtor (no .select() due to SELECT RLS user_id = auth.uid())
  const notificationRecord: Database["public"]["Tables"]["notifications"]["Row"] =
    {
      id: crypto.randomUUID(),
      user_id: debtorId,
      group_id: groupId,
      actor_id: creditorId,
      expense_id: null,
      revision_id: null,
      type: "REMINDER_NUDGE",
      title: "Settlement reminder",
      description: reminderMessage,
      delta_cents: amountCents && amountCents > 0 ? amountCents : null,
      currency: amountCents && amountCents > 0 ? groupRow.base_currency : null,
      href: `/dashboard?group=${encodeURIComponent(groupId)}`,
      is_read: false,
      created_at: sentAtIso,
    };

  let notifPersistError: string | null = null;
  try {
    const notifTable = supabase.from("notifications");
    if (notifTable && typeof notifTable.insert === "function") {
      const { error: notifErr } = await notifTable.insert({
        id: notificationRecord.id,
        user_id: notificationRecord.user_id,
        group_id: notificationRecord.group_id,
        actor_id: notificationRecord.actor_id,
        type: notificationRecord.type,
        title: notificationRecord.title,
        description: notificationRecord.description,
        delta_cents: notificationRecord.delta_cents,
        currency: notificationRecord.currency,
        href: notificationRecord.href,
        is_read: false,
        created_at: sentAtIso,
      });
      if (notifErr) {
        notifPersistError =
          notifErr.message || "Failed to persist reminder notification.";
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      !/notifications|insert|from/i.test(err.message)
    ) {
      notifPersistError = err.message;
    }
  }

  if (notifPersistError) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: notifPersistError,
    };
  }

  const cooldown = computeReminderCooldown({
    groupId,
    debtorId,
    creditorId,
    channel: insertedReminder.channel,
    sentAt: insertedReminder.sent_at,
    nowMs,
  }) ?? {
    groupId,
    debtorId,
    creditorId,
    channel: insertedReminder.channel,
    sentAt: insertedReminder.sent_at,
    nextAllowedAt: new Date(nowMs + REMINDER_COOLDOWN_MS).toISOString(),
    remainingMs: REMINDER_COOLDOWN_MS,
    remainingHours: 24,
  };

  return {
    ok: true,
    reminder: insertedReminder,
    channel: insertedReminder.channel,
    deliveryMode,
    cooldown,
    notification: notificationRecord,
  };
}

export async function sendBatchSettlementReminders(
  supabase: SupabaseClient<Database>,
  params: {
    creditorId: string;
    targets: readonly BatchReminderTarget[];
    nowMs?: number;
  },
): Promise<SendBatchRemindersResult> {
  const seen = new Set<string>();
  const uniqueTargets: BatchReminderTarget[] = [];

  for (const target of params.targets) {
    const groupId = target.groupId?.trim();
    const debtorId = target.debtorId?.trim();
    if (!groupId || !debtorId) continue;
    const key = getReminderCooldownKey(groupId, debtorId);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueTargets.push({
      groupId,
      debtorId,
      amountCents: target.amountCents,
    });
  }

  const sent: Array<Extract<SendReminderResult, { ok: true }>> = [];
  const rateLimited: SendBatchRemindersResult["rateLimited"] = [];
  const failed: SendBatchRemindersResult["failed"] = [];

  for (const target of uniqueTargets) {
    const res = await sendSettlementReminder(supabase, {
      groupId: target.groupId,
      creditorId: params.creditorId,
      debtorId: target.debtorId,
      amountCents: target.amountCents,
      nowMs: params.nowMs,
    });

    if (res.ok) {
      sent.push(res);
    } else if (res.status === 429 && res.cooldown) {
      rateLimited.push({
        groupId: target.groupId,
        debtorId: target.debtorId,
        message: res.message,
        cooldown: res.cooldown,
      });
    } else {
      failed.push({
        groupId: target.groupId,
        debtorId: target.debtorId,
        status: res.status,
        code: res.code,
        message: res.message,
      });
    }
  }

  return { sent, rateLimited, failed };
}
