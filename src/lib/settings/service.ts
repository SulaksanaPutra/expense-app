import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildFullLedgerCsv,
  evaluateExpenseLockAndSettlement,
  getUserShareCents,
  type ExpenseBillingCycleRecord,
  type ExpenseLedgerRecord,
  type ExpenseSettlementRecord,
  type FullLedgerCsvSettlementItem,
} from "@/lib/expenses/ledger";
import {
  formatMinorUnits,
  formatMinorUnitsDecimal,
  isValidCurrencyCode,
} from "@/lib/money";
import type {
  Database,
  NotificationPrefs,
  SplitBreakdownItem,
} from "@/types/database";
import {
  listSettlementHandles,
  type SettlementHandleItem,
} from "./settlement-handles";

export interface SettingsAuthUser {
  id: string;
  email?: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
}

export interface SettingsNotificationPrefs {
  new_expense_added: boolean;
  settlement_recorded: boolean;
  cycle_close_reminder: boolean;
  monthly_summary_digest: boolean;
}

export interface SettingsUserProfile {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  phoneNumber: string | null;
  timezone: string;
  displayCurrency: string;
  personalShareCapCents: number | null;
  autoIncludeInExpenses: boolean;
  notificationPrefs: SettingsNotificationPrefs;
  createdAt: string;
}

export interface SettingsPageData {
  profile: SettingsUserProfile;
  groupCount: number;
  settlementHandles: SettlementHandleItem[];
  loadError: string | null;
}

export const DEFAULT_USER_PREFS: SettingsNotificationPrefs = {
  new_expense_added: true,
  settlement_recorded: true,
  cycle_close_reminder: true,
  monthly_summary_digest: false,
};

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

interface SettingsUserRow {
  id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  timezone: string;
  base_currency: string;
  display_currency: string;
  personal_share_cap_cents: number | null;
  auto_include_in_expenses: boolean;
  notification_prefs: NotificationPrefs;
  created_at: string;
}

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("schema cache") || msg.includes("does not exist");
}

function readLegacyTimezone(rawPrefs: unknown): string {
  if (rawPrefs && typeof rawPrefs === "object") {
    const tz = (rawPrefs as Record<string, unknown>).timezone;
    if (typeof tz === "string" && tz.trim()) return tz.trim();
  }
  return DEFAULT_TIMEZONE;
}

function readLegacyAutoInclude(rawPrefs: unknown): boolean {
  if (rawPrefs && typeof rawPrefs === "object") {
    const val = (rawPrefs as Record<string, unknown>).auto_include_in_expenses;
    if (typeof val === "boolean") return val;
  }
  return true;
}

export function normalizePhoneNumber(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return {
      ok: false,
      message: "Enter a valid phone number (7 to 15 digits).",
    };
  }
  if (trimmed.length > 32) {
    return {
      ok: false,
      message: "Phone number must be 32 characters or fewer.",
    };
  }
  return { ok: true, value: trimmed };
}

export function validateTimezone(
  raw: unknown,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof raw !== "string") {
    return {
      ok: false,
      message: "Timezone must be a valid IANA timezone identifier.",
    };
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 80) {
    return {
      ok: false,
      message: "Timezone must be a valid IANA timezone identifier.",
    };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return { ok: true, value: trimmed };
  } catch {
    return {
      ok: false,
      message: `"${trimmed}" is not a valid IANA timezone identifier.`,
    };
  }
}

export function validateAvatarUrl(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  if (trimmed.startsWith("data:image/")) {
    if (
      !/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(
        trimmed,
      )
    ) {
      return {
        ok: false,
        message: "Avatar image must be a valid PNG, JPEG, WebP, or GIF file.",
      };
    }
    if (trimmed.length > 350_000) {
      return {
        ok: false,
        message: "Avatar image must be 250 KB or smaller after compression.",
      };
    }
    return { ok: true, value: trimmed };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return { ok: true, value: trimmed };
    }
  } catch {
    // Fall through
  }
  return {
    ok: false,
    message: "Avatar URL must be an https:// URL or valid uploaded image.",
  };
}

export function normalizeNotificationPrefs(
  raw: unknown,
): SettingsNotificationPrefs {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const newExpenseAdded =
    typeof obj.new_expense_added === "boolean"
      ? obj.new_expense_added
      : typeof obj.new_expense === "boolean"
        ? obj.new_expense
        : DEFAULT_USER_PREFS.new_expense_added;

  const settlementRecorded =
    typeof obj.settlement_recorded === "boolean"
      ? obj.settlement_recorded
      : typeof obj.settlement_confirmation === "boolean"
        ? obj.settlement_confirmation
        : DEFAULT_USER_PREFS.settlement_recorded;

  const cycleCloseReminder =
    typeof obj.cycle_close_reminder === "boolean"
      ? obj.cycle_close_reminder
      : typeof obj.auto_settlement_reminders === "boolean"
        ? obj.auto_settlement_reminders
        : DEFAULT_USER_PREFS.cycle_close_reminder;

  const monthlySummaryDigest =
    typeof obj.monthly_summary_digest === "boolean"
      ? obj.monthly_summary_digest
      : typeof obj.monthly_recap === "boolean"
        ? obj.monthly_recap
        : DEFAULT_USER_PREFS.monthly_summary_digest;

  return {
    new_expense_added: newExpenseAdded,
    settlement_recorded: settlementRecorded,
    cycle_close_reminder: cycleCloseReminder,
    monthly_summary_digest: monthlySummaryDigest,
  };
}

export async function getSettingsPageData(
  supabase: SupabaseClient<Database>,
  authUser: SettingsAuthUser,
): Promise<SettingsPageData> {
  const fallbackProfile: SettingsUserProfile = {
    id: authUser.id,
    fullName:
      authUser.fullName?.trim() ||
      authUser.email?.split("@")[0] ||
      "LedgerSplit User",
    email: authUser.email ?? "",
    avatarUrl: authUser.avatarUrl ?? null,
    phoneNumber: null,
    timezone: DEFAULT_TIMEZONE,
    displayCurrency: "USD",
    personalShareCapCents: null,
    autoIncludeInExpenses: true,
    notificationPrefs: { ...DEFAULT_USER_PREFS },
    createdAt: new Date().toISOString(),
  };

  try {
    const [
      { data: userRow, error: userErr },
      { data: membershipRows, error: memErr },
      handlesRes,
    ] = await Promise.all([
      supabase
        .from("users")
        .select(
          "id, full_name, email, phone_number, timezone, base_currency, display_currency, personal_share_cap_cents, auto_include_in_expenses, notification_prefs, created_at",
        )
        .eq("id", authUser.id)
        .maybeSingle(),
      supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", authUser.id)
        .eq("status", "ACTIVE"),
      Promise.resolve()
        .then(() => listSettlementHandles(supabase, authUser.id))
        .catch(() => ({ ok: true as const, handles: [] as SettlementHandleItem[] })),
    ]);

    const settlementHandles = handlesRes.ok ? handlesRes.handles : [];

    let resolvedUserRow: SettingsUserRow | null = userRow as SettingsUserRow | null;
    if (userErr && isMissingColumnError(userErr)) {
      const fb = await supabase
        .from("users")
        .select(
          "id, full_name, email, phone_number, base_currency, personal_share_cap_cents, notification_prefs, created_at",
        )
        .eq("id", authUser.id)
        .maybeSingle();
      if (fb.error) {
        return {
          profile: fallbackProfile,
          groupCount: 0,
          settlementHandles: [],
          loadError: fb.error.message || "Unable to load profile settings.",
        };
      }
      resolvedUserRow = fb.data
        ? ({
            ...fb.data,
            timezone: readLegacyTimezone(fb.data.notification_prefs),
            display_currency: fb.data.base_currency || "USD",
            auto_include_in_expenses: readLegacyAutoInclude(
              fb.data.notification_prefs,
            ),
          } as SettingsUserRow)
        : null;
    } else if (userErr) {
      return {
        profile: fallbackProfile,
        groupCount: 0,
        settlementHandles: [],
        loadError: userErr.message || "Unable to load profile settings.",
      };
    }

    const resolvedDisplayCurrency =
      resolvedUserRow?.display_currency ||
      resolvedUserRow?.base_currency ||
      "USD";

    const profile: SettingsUserProfile = resolvedUserRow
      ? {
          id: resolvedUserRow.id,
          fullName: resolvedUserRow.full_name || fallbackProfile.fullName,
          email: resolvedUserRow.email || fallbackProfile.email,
          avatarUrl: authUser.avatarUrl ?? null,
          phoneNumber: resolvedUserRow.phone_number ?? null,
          timezone: resolvedUserRow.timezone || DEFAULT_TIMEZONE,
          displayCurrency: resolvedDisplayCurrency,
          personalShareCapCents:
            resolvedUserRow.personal_share_cap_cents !== null &&
            resolvedUserRow.personal_share_cap_cents !== undefined
              ? Number(resolvedUserRow.personal_share_cap_cents)
              : null,
          autoIncludeInExpenses:
            typeof resolvedUserRow.auto_include_in_expenses === "boolean"
              ? resolvedUserRow.auto_include_in_expenses
              : true,
          notificationPrefs: normalizeNotificationPrefs(
            resolvedUserRow.notification_prefs,
          ),
          createdAt: resolvedUserRow.created_at || fallbackProfile.createdAt,
        }
      : fallbackProfile;

    const groupCount = memErr
      ? 0
      : new Set((membershipRows ?? []).map((m) => m.group_id)).size;

    return {
      profile,
      groupCount,
      settlementHandles,
      loadError: memErr ? memErr.message : null,
    };
  } catch (err) {
    return {
      profile: fallbackProfile,
      groupCount: 0,
      settlementHandles: [],
      loadError:
        err instanceof Error ? err.message : "Unable to load settings.",
    };
  }
}

export interface UpdateSettingsInput {
  full_name?: unknown;
  phone_number?: unknown;
  timezone?: unknown;
  display_currency?: unknown;
  personal_share_cap_cents?: unknown;
  auto_include_in_expenses?: unknown;
  avatar_url?: unknown;
  notification_prefs?: unknown;
}

export type UpdateSettingsResult =
  | {
      ok: true;
      profile: SettingsUserProfile;
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

export async function updateUserSettings(
  supabase: SupabaseClient<Database>,
  authUser: SettingsAuthUser,
  rawInput: unknown,
): Promise<UpdateSettingsResult> {
  if (!rawInput || typeof rawInput !== "object") {
    return {
      ok: false,
      status: 400,
      code: "INVALID_PAYLOAD",
      message: "Invalid settings request payload.",
    };
  }

  const input = rawInput as UpdateSettingsInput;

  const existingRes = await supabase
    .from("users")
    .select(
      "id, full_name, email, phone_number, timezone, base_currency, display_currency, personal_share_cap_cents, auto_include_in_expenses, notification_prefs, created_at",
    )
    .eq("id", authUser.id)
    .maybeSingle();

  let existingRow: SettingsUserRow | null = existingRes.data as SettingsUserRow | null;
  let useLegacyUserColumns = false;

  if (existingRes.error && isMissingColumnError(existingRes.error)) {
    useLegacyUserColumns = true;
    const fb = await supabase
      .from("users")
      .select(
        "id, full_name, email, phone_number, base_currency, personal_share_cap_cents, notification_prefs, created_at",
      )
      .eq("id", authUser.id)
      .maybeSingle();
    if (fb.error) {
      return {
        ok: false,
        status: 500,
        code: "SERVER_ERROR",
        message: fb.error.message || "Unable to load user profile.",
      };
    }
    existingRow = fb.data
      ? ({
          ...fb.data,
          timezone: readLegacyTimezone(fb.data.notification_prefs),
          display_currency: fb.data.base_currency || "USD",
          auto_include_in_expenses: readLegacyAutoInclude(
            fb.data.notification_prefs,
          ),
        } as SettingsUserRow)
      : null;
  } else if (existingRes.error) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: existingRes.error.message || "Unable to load user profile.",
    };
  }

  if (!existingRow) {
    return {
      ok: false,
      status: 404,
      code: "USER_NOT_FOUND",
      message: "User profile record was not found.",
    };
  }

  // Validate full_name
  let nextFullName = existingRow.full_name;
  if (input.full_name !== undefined) {
    if (typeof input.full_name !== "string") {
      return {
        ok: false,
        status: 400,
        code: "INVALID_FULL_NAME",
        message: "Full name must be a text value.",
      };
    }
    const trimmed = input.full_name.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_FULL_NAME",
        message: "Full name must be between 2 and 100 characters.",
      };
    }
    nextFullName = trimmed;
  }

  // Validate phone_number
  let nextPhoneNumber = existingRow.phone_number;
  if (input.phone_number !== undefined) {
    const phoneCheck = normalizePhoneNumber(
      input.phone_number === null ? null : String(input.phone_number),
    );
    if (!phoneCheck.ok) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_PHONE",
        message: phoneCheck.message,
      };
    }
    nextPhoneNumber = phoneCheck.value;
  }

  // Validate timezone
  let nextTimezone = existingRow.timezone || DEFAULT_TIMEZONE;
  if (input.timezone !== undefined) {
    const tzCheck = validateTimezone(input.timezone);
    if (!tzCheck.ok) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_TIMEZONE",
        message: tzCheck.message,
      };
    }
    nextTimezone = tzCheck.value;
  }

  // Validate display_currency
  let nextDisplayCurrency =
    existingRow.display_currency || existingRow.base_currency || "USD";
  if (input.display_currency !== undefined) {
    const code =
      typeof input.display_currency === "string"
        ? input.display_currency.trim().toUpperCase()
        : "";
    if (!isValidCurrencyCode(code)) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_CURRENCY",
        message: "Display currency must be a valid 3-letter ISO-4217 code.",
      };
    }
    nextDisplayCurrency = code;
  }

  // Validate personal_share_cap_cents (BIGINT integer minor units only)
  let nextCapCents: number | null =
    existingRow.personal_share_cap_cents !== null &&
    existingRow.personal_share_cap_cents !== undefined
      ? Number(existingRow.personal_share_cap_cents)
      : null;

  if (input.personal_share_cap_cents !== undefined) {
    if (
      input.personal_share_cap_cents === null ||
      input.personal_share_cap_cents === ""
    ) {
      nextCapCents = null;
    } else {
      const num = Number(input.personal_share_cap_cents);
      if (!Number.isSafeInteger(num) || num < 0) {
        return {
          ok: false,
          status: 400,
          code: "INVALID_PERSONAL_CAP",
          message:
            "Personal monthly share cap must be a non-negative integer in minor units.",
        };
      }
      nextCapCents = num;
    }
  }

  // Validate auto_include_in_expenses
  let nextAutoInclude =
    typeof existingRow.auto_include_in_expenses === "boolean"
      ? existingRow.auto_include_in_expenses
      : true;
  if (input.auto_include_in_expenses !== undefined) {
    if (typeof input.auto_include_in_expenses !== "boolean") {
      return {
        ok: false,
        status: 400,
        code: "INVALID_AUTO_INCLUDE",
        message: "auto_include_in_expenses must be a boolean.",
      };
    }
    nextAutoInclude = input.auto_include_in_expenses;
  }

  // Validate avatar_url (optional; stored on Supabase Auth metadata)
  let nextAvatarUrl = authUser.avatarUrl ?? null;
  let avatarChanged = false;
  if (input.avatar_url !== undefined) {
    const avatarCheck = validateAvatarUrl(
      input.avatar_url === null ? null : String(input.avatar_url),
    );
    if (!avatarCheck.ok) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_AVATAR",
        message: avatarCheck.message,
      };
    }
    if (avatarCheck.value !== nextAvatarUrl) {
      nextAvatarUrl = avatarCheck.value;
      avatarChanged = true;
    }
  }

  // Validate & merge notification_prefs (4 v2 switches)
  const currentPrefs = normalizeNotificationPrefs(existingRow.notification_prefs);
  const nextPrefs: SettingsNotificationPrefs = { ...currentPrefs };

  if (input.notification_prefs !== undefined) {
    if (
      !input.notification_prefs ||
      typeof input.notification_prefs !== "object"
    ) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_NOTIFICATION_PREFS",
        message: "notification_prefs must be an object.",
      };
    }
    const rawPrefs = input.notification_prefs as Record<string, unknown>;

    const booleanKeys: Array<keyof SettingsNotificationPrefs> = [
      "new_expense_added",
      "settlement_recorded",
      "cycle_close_reminder",
      "monthly_summary_digest",
    ];

    for (const key of booleanKeys) {
      if (rawPrefs[key] !== undefined) {
        if (typeof rawPrefs[key] !== "boolean") {
          return {
            ok: false,
            status: 400,
            code: "INVALID_NOTIFICATION_PREFS",
            message: `${key} must be a boolean.`,
          };
        }
        nextPrefs[key] = rawPrefs[key] as boolean;
      }
    }
  }

  let updatedUser: SettingsUserRow | null = null;
  let updateErr: { message?: string } | null = null;

  if (!useLegacyUserColumns) {
    const v2Res = await supabase
      .from("users")
      .update({
        full_name: nextFullName,
        phone_number: nextPhoneNumber,
        timezone: nextTimezone,
        base_currency: nextDisplayCurrency,
        display_currency: nextDisplayCurrency,
        personal_share_cap_cents: nextCapCents,
        auto_include_in_expenses: nextAutoInclude,
        notification_prefs: nextPrefs as NotificationPrefs,
      })
      .eq("id", authUser.id)
      .select(
        "id, full_name, email, phone_number, timezone, base_currency, display_currency, personal_share_cap_cents, auto_include_in_expenses, notification_prefs, created_at",
      )
      .maybeSingle();

    if (v2Res.error && isMissingColumnError(v2Res.error)) {
      useLegacyUserColumns = true;
    } else {
      updatedUser = v2Res.data as SettingsUserRow | null;
      updateErr = v2Res.error;
    }
  }

  if (useLegacyUserColumns) {
    const legacyPrefs = {
      ...nextPrefs,
      timezone: nextTimezone,
      auto_include_in_expenses: nextAutoInclude,
    } as NotificationPrefs;

    const fbRes = await supabase
      .from("users")
      .update({
        full_name: nextFullName,
        phone_number: nextPhoneNumber,
        base_currency: nextDisplayCurrency,
        personal_share_cap_cents: nextCapCents,
        notification_prefs: legacyPrefs,
      })
      .eq("id", authUser.id)
      .select(
        "id, full_name, email, phone_number, base_currency, personal_share_cap_cents, notification_prefs, created_at",
      )
      .maybeSingle();

    updateErr = fbRes.error;
    updatedUser = fbRes.data
      ? ({
          ...fbRes.data,
          timezone: readLegacyTimezone(fbRes.data.notification_prefs),
          display_currency: fbRes.data.base_currency || nextDisplayCurrency,
          auto_include_in_expenses: readLegacyAutoInclude(
            fbRes.data.notification_prefs,
          ),
        } as SettingsUserRow)
      : null;
  }

  if (updateErr || !updatedUser) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: updateErr?.message || "Failed to persist user settings.",
    };
  }

  // Sync full_name and avatar_url to Supabase Auth user metadata when supported
  if (avatarChanged || nextFullName !== existingRow.full_name) {
    const authClient = supabase.auth as unknown as {
      updateUser?: (attrs: { data: Record<string, unknown> }) => Promise<unknown>;
    };
    if (typeof authClient?.updateUser === "function") {
      try {
        await authClient.updateUser({
          data: {
            full_name: nextFullName,
            avatar_url: nextAvatarUrl,
          },
        });
      } catch {
        // Non-fatal in mocked or offline unit-test clients
      }
    }
  }

  return {
    ok: true,
    profile: {
      id: updatedUser.id,
      fullName: updatedUser.full_name,
      email: updatedUser.email,
      avatarUrl: nextAvatarUrl,
      phoneNumber: updatedUser.phone_number ?? null,
      timezone: updatedUser.timezone || DEFAULT_TIMEZONE,
      displayCurrency:
        updatedUser.display_currency || updatedUser.base_currency || "USD",
      personalShareCapCents:
        updatedUser.personal_share_cap_cents !== null &&
        updatedUser.personal_share_cap_cents !== undefined
          ? Number(updatedUser.personal_share_cap_cents)
          : null,
      autoIncludeInExpenses:
        typeof updatedUser.auto_include_in_expenses === "boolean"
          ? updatedUser.auto_include_in_expenses
          : true,
      notificationPrefs: normalizeNotificationPrefs(
        updatedUser.notification_prefs,
      ),
      createdAt: updatedUser.created_at,
    },
  };
}

export async function buildFullLedgerExport(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<
  {
    ok: true;
    csv: string;
    json: string;
  } | { ok: false; message: string }
> {
  const { data: membershipRows, error: memErr } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);

  if (memErr) {
    return {
      ok: false,
      message: memErr.message || "Unable to verify group memberships for export.",
    };
  }

  const memberGroupIds = Array.from(
    new Set((membershipRows ?? []).map((m) => m.group_id)),
  );

  if (memberGroupIds.length === 0) {
    const emptyJson = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        userId,
        groups: [],
        expenses: [],
        settlements: [],
      },
      null,
      2,
    );
    return {
      ok: true,
      csv: buildFullLedgerCsv({
        expenses: [],
        settlements: [],
        currentUserId: userId,
      }),
      json: emptyJson,
    };
  }

  const { data: groups, error: groupErr } = await supabase
    .from("groups")
    .select(
      "id, name, slug, group_type, status, base_currency, billing_cycle_anchor_day",
    )
    .in("id", memberGroupIds)
    .order("created_at", { ascending: true });

  if (groupErr) {
    return {
      ok: false,
      message: groupErr.message || "Unable to load groups for export.",
    };
  }

  const groupList = groups ?? [];
  const groupIds = groupList.map((g) => g.id);

  if (groupIds.length === 0) {
    const emptyJson = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        userId,
        groups: [],
        expenses: [],
        settlements: [],
      },
      null,
      2,
    );
    return {
      ok: true,
      csv: buildFullLedgerCsv({
        expenses: [],
        settlements: [],
        currentUserId: userId,
      }),
      json: emptyJson,
    };
  }

  const [
    { data: expenseRows, error: expErr },
    { data: settlementRows, error: setErr },
    billingCyclesRes,
  ] = await Promise.all([
    supabase
      .from("expenses")
      .select("*")
      .in("group_id", groupIds)
      .is("deleted_at", null)
      .order("expense_date", { ascending: false }),
    supabase
      .from("settlements")
      .select("*")
      .in("group_id", groupIds)
      .order("settled_at", { ascending: false }),
    Promise.resolve(
      supabase
        .from("billing_cycles")
        .select("id, group_id, period_start, period_end, status")
        .in("group_id", groupIds),
    ).catch(() => ({ data: null, error: null })),
  ]);

  if (expErr || setErr) {
    return {
      ok: false,
      message:
        expErr?.message || setErr?.message || "Unable to export ledger history.",
    };
  }

  const relatedUserIds = Array.from(
    new Set([
      ...(expenseRows ?? []).map((e) => e.paid_by),
      ...(settlementRows ?? []).map((s) => s.payer_id),
      ...(settlementRows ?? []).map((s) => s.recipient_id),
    ]),
  );
  const usersById = new Map<string, string>();
  if (relatedUserIds.length > 0) {
    const { data: userRows } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", relatedUserIds);
    for (const u of userRows ?? []) {
      usersById.set(u.id, u.full_name || "Member");
    }
  }

  const groupMap = new Map(groupList.map((g) => [g.id, g]));
  const billingCycles: ExpenseBillingCycleRecord[] = (
    billingCyclesRes?.data ?? []
  ).map((bc) => ({
    id: bc.id,
    groupId: bc.group_id,
    periodStart: bc.period_start,
    periodEnd: bc.period_end,
    status: bc.status,
  }));

  const settlementRecords: ExpenseSettlementRecord[] = (settlementRows ?? []).map(
    (s) => ({
      id: s.id,
      groupId: s.group_id,
      payerId: s.payer_id,
      recipientId: s.recipient_id,
      amountCents: Math.trunc(Number(s.amount_cents)),
      currency: s.currency,
      settledAt: s.settled_at,
    }),
  );

  const ledgerRecords: ExpenseLedgerRecord[] = (expenseRows ?? []).map((row) => {
    const group = groupMap.get(row.group_id);
    const baseCurrency = (
      group?.base_currency ||
      row.currency ||
      "USD"
    ).toUpperCase();
    const breakdown: SplitBreakdownItem[] = Array.isArray(row.split_breakdown)
      ? (row.split_breakdown as unknown as SplitBreakdownItem[])
      : [];
    const lockEval = evaluateExpenseLockAndSettlement({
      expense: {
        id: row.id,
        groupId: row.group_id,
        paidBy: row.paid_by,
        expenseDate: row.expense_date,
        isLocked: Boolean(row.is_locked),
        splitBreakdown: breakdown,
      },
      currentUserId: userId,
      billingCycles,
      settlements: settlementRecords,
    });

    return {
      id: row.id,
      groupId: row.group_id,
      groupName: group?.name ?? "Split Group",
      groupBaseCurrency: baseCurrency,
      groupBillingAnchorDay: group?.billing_cycle_anchor_day ?? 1,
      createdBy: row.created_by,
      paidBy: row.paid_by,
      payerName: usersById.get(row.paid_by) ?? "Member",
      description: row.description,
      category: row.category,
      expenseDate: row.expense_date,
      amountCents: Math.trunc(Number(row.amount_cents)),
      currency: baseCurrency,
      originalAmountCents: null,
      originalCurrency: null,
      exchangeRate: null,
      exchangeRateSource: null,
      splitMethod: row.split_method,
      splitBreakdown: breakdown,
      receiptUrl: row.receipt_url ?? null,
      isRecurringGenerated: false,
      recurringRuleId: null,
      adjustmentForExpenseId: row.adjustment_for_expense_id ?? null,
      isLocked: lockEval.isLocked,
      isCycleClosed: lockEval.isCycleClosed,
      isSettledByWatermark: lockEval.isSettledByWatermark,
      isSettledForUser: lockEval.isSettledForUser,
    };
  });

  const csvSettlements: FullLedgerCsvSettlementItem[] = (
    settlementRows ?? []
  ).map((s) => {
    const group = groupMap.get(s.group_id);
    const baseCurrency = (
      group?.base_currency ||
      s.currency ||
      "USD"
    ).toUpperCase();
    return {
      id: s.id,
      groupId: s.group_id,
      groupName: group?.name ?? "Split Group",
      groupBaseCurrency: baseCurrency,
      payerId: s.payer_id,
      payerName: usersById.get(s.payer_id) ?? "Member",
      recipientId: s.recipient_id,
      recipientName: usersById.get(s.recipient_id) ?? "Member",
      amountCents: Math.trunc(Number(s.amount_cents)),
      paymentRail: s.payment_rail,
      settledAt: s.settled_at,
    };
  });

  const csv = buildFullLedgerCsv({
    expenses: ledgerRecords,
    settlements: csvSettlements,
    currentUserId: userId,
  });

  const ledgerById = new Map(ledgerRecords.map((r) => [r.id, r]));
  const jsonExpenses = (expenseRows ?? []).map((row) => {
    const ledger = ledgerById.get(row.id);
    const group = groupMap.get(row.group_id);
    const baseCurrency = (
      group?.base_currency ||
      row.currency ||
      "USD"
    ).toUpperCase();
    const amountCents = Math.trunc(Number(row.amount_cents));
    const shareCents = ledger ? getUserShareCents(ledger, userId) : 0;
    const status = ledger?.isLocked
      ? "LOCKED"
      : ledger?.isSettledForUser
        ? "Settled"
        : "Pending";

    return {
      ...row,
      amount_cents: amountCents,
      currency: baseCurrency,
      base_currency: baseCurrency,
      group_name: group?.name ?? "Split Group",
      payer_name: usersById.get(row.paid_by) ?? "Member",
      amount_formatted: formatMinorUnits(amountCents, baseCurrency),
      amount_decimal: formatMinorUnitsDecimal(amountCents, baseCurrency),
      your_share_cents: shareCents,
      your_share_formatted: formatMinorUnits(shareCents, baseCurrency),
      your_share_decimal: formatMinorUnitsDecimal(shareCents, baseCurrency),
      status,
      fx_audit: null,
    };
  });

  const jsonSettlements = (settlementRows ?? []).map((s) => {
    const group = groupMap.get(s.group_id);
    const baseCurrency = (
      group?.base_currency ||
      s.currency ||
      "USD"
    ).toUpperCase();
    const amountCents = Math.trunc(Number(s.amount_cents));
    return {
      ...s,
      amount_cents: amountCents,
      currency: baseCurrency,
      base_currency: baseCurrency,
      group_name: group?.name ?? "Split Group",
      payer_name: usersById.get(s.payer_id) ?? "Member",
      recipient_name: usersById.get(s.recipient_id) ?? "Member",
      amount_formatted: formatMinorUnits(amountCents, baseCurrency),
      amount_decimal: formatMinorUnitsDecimal(amountCents, baseCurrency),
    };
  });

  const json = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      userId,
      groups: groupList,
      expenses: jsonExpenses,
      settlements: jsonSettlements,
    },
    null,
    2,
  );

  return { ok: true, csv, json };
}
