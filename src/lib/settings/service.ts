import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
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
import { RECEIPT_STORAGE_QUOTA_BYTES } from "@/lib/expenses/split-engine";
import { computeEqualSharePercentages } from "@/lib/groups/invite-utils";
import { getInviteSigningSecret } from "@/lib/groups/invite-token";
import {
  formatMinorUnits,
  formatMinorUnitsDecimal,
  isValidCurrencyCode,
} from "@/lib/money";
import type {
  Database,
  ExpenseSplitMethod,
  GroupStatus,
  MemberRole,
  NotificationPrefs,
  PaymentRail,
  SavedPaymentMethod,
  SplitBreakdownItem,
  SplitMode,
} from "@/types/database";

export interface SettingsAuthUser {
  id: string;
  email?: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
}

export interface SettingsGroupSummary {
  id: string;
  name: string;
  slug: string;
  status: GroupStatus;
  baseCurrency: string;
  defaultSplitMode: SplitMode;
  simplifyDebts: boolean;
  currentUserRole: MemberRole;
}

export interface SettingsUserProfile {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  phoneNumber: string | null;
  phoneVerified: boolean;
  instantSettlementTag: string | null;
  baseCurrency: string;
  personalShareCapCents: number | null;
  receiptStorageUsedBytes: number;
  receiptStorageQuotaBytes: number;
  notificationPrefs: Required<
    Pick<
      NotificationPrefs,
      | "new_expense"
      | "settlement_confirmation"
      | "monthly_recap"
      | "sms_nudges_opt_in"
      | "auto_settlement_reminders"
      | "default_split_method"
    >
  > & {
    payment_methods: SavedPaymentMethod[];
  };
  createdAt: string;
}

export interface SettingsPageData {
  profile: SettingsUserProfile;
  groups: SettingsGroupSummary[];
  loadError: string | null;
}

export const DEFAULT_USER_PREFS: SettingsUserProfile["notificationPrefs"] = {
  new_expense: true,
  settlement_confirmation: true,
  monthly_recap: true,
  sms_nudges_opt_in: false,
  auto_settlement_reminders: true,
  default_split_method: "EQUAL",
  payment_methods: [],
};

const VALID_PAYMENT_RAILS: readonly PaymentRail[] = [
  "VENMO",
  "APPLE_CARD",
  "CASH",
  "OTHER",
];

const VALID_SPLIT_METHODS: readonly ExpenseSplitMethod[] = [
  "EQUAL",
  "PERCENTAGE",
  "EXACT",
];

export function normalizeInstantSettlementTag(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  const stripped = trimmed.replace(/^@+/, "");
  if (!stripped) {
    return { ok: true, value: null };
  }
  if (stripped.length > 60) {
    return {
      ok: false,
      message: "Instant settlement tag must be 60 characters or fewer.",
    };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(stripped)) {
    return {
      ok: false,
      message:
        "Instant settlement tag may only contain letters, numbers, dots, underscores, or hyphens.",
    };
  }
  return { ok: true, value: `@${stripped}` };
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

export function buildDefaultPaymentMethods(
  instantSettlementTag: string | null,
): SavedPaymentMethod[] {
  const tag = instantSettlementTag?.trim() || "";
  const methods: SavedPaymentMethod[] = [];
  if (tag) {
    methods.push({
      id: "pm-venmo-primary",
      label: "Venmo Settlement Rail",
      rail: "VENMO",
      handle: tag.startsWith("@") ? tag : `@${tag}`,
      is_default: true,
    });
  }
  return methods;
}

export function normalizePaymentMethods(
  raw: unknown,
): { ok: true; value: SavedPaymentMethod[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) {
    return { ok: true, value: [] };
  }
  if (raw.length > 10) {
    return {
      ok: false,
      message: "You can save up to 10 payment settlement handles.",
    };
  }
  const seenIds = new Set<string>();
  const normalized: SavedPaymentMethod[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== "object") {
      return { ok: false, message: "Invalid payment method entry." };
    }
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === "string" ? rec.label.trim() : "";
    const handle = typeof rec.handle === "string" ? rec.handle.trim() : "";
    const rail =
      typeof rec.rail === "string" &&
      VALID_PAYMENT_RAILS.includes(rec.rail.trim().toUpperCase() as PaymentRail)
        ? (rec.rail.trim().toUpperCase() as PaymentRail)
        : "OTHER";
    const id =
      typeof rec.id === "string" && rec.id.trim()
        ? rec.id.trim().slice(0, 64)
        : `pm-${i + 1}`;
    if (!label || label.length > 60) {
      return {
        ok: false,
        message: "Payment method label must be 1 to 60 characters.",
      };
    }
    if (!handle || handle.length > 64) {
      return {
        ok: false,
        message: "Payment handle or reference must be 1 to 64 characters.",
      };
    }
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    normalized.push({
      id,
      label,
      rail,
      handle,
      is_default: Boolean(rec.is_default),
    });
  }

  // Ensure at most one default item
  let foundDefault = false;
  for (const item of normalized) {
    if (item.is_default && !foundDefault) {
      foundDefault = true;
    } else if (item.is_default) {
      item.is_default = false;
    }
  }
  if (!foundDefault && normalized.length > 0) {
    normalized[0].is_default = true;
  }

  return { ok: true, value: normalized };
}

export function normalizeNotificationPrefs(
  raw: unknown,
  fallbackTag: string | null = null,
): SettingsUserProfile["notificationPrefs"] {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const splitMethod =
    typeof obj.default_split_method === "string" &&
    VALID_SPLIT_METHODS.includes(obj.default_split_method as ExpenseSplitMethod)
      ? (obj.default_split_method as ExpenseSplitMethod)
      : "EQUAL";

  const pmResult = normalizePaymentMethods(obj.payment_methods);
  const paymentMethods =
    pmResult.ok && pmResult.value.length > 0
      ? pmResult.value
      : Array.isArray(obj.payment_methods)
        ? []
        : buildDefaultPaymentMethods(fallbackTag);

  return {
    new_expense:
      typeof obj.new_expense === "boolean"
        ? obj.new_expense
        : DEFAULT_USER_PREFS.new_expense,
    settlement_confirmation:
      typeof obj.settlement_confirmation === "boolean"
        ? obj.settlement_confirmation
        : DEFAULT_USER_PREFS.settlement_confirmation,
    monthly_recap:
      typeof obj.monthly_recap === "boolean"
        ? obj.monthly_recap
        : DEFAULT_USER_PREFS.monthly_recap,
    sms_nudges_opt_in:
      typeof obj.sms_nudges_opt_in === "boolean"
        ? obj.sms_nudges_opt_in
        : DEFAULT_USER_PREFS.sms_nudges_opt_in,
    auto_settlement_reminders:
      typeof obj.auto_settlement_reminders === "boolean"
        ? obj.auto_settlement_reminders
        : DEFAULT_USER_PREFS.auto_settlement_reminders,
    default_split_method: splitMethod,
    payment_methods: paymentMethods,
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
    phoneVerified: false,
    instantSettlementTag: null,
    baseCurrency: "USD",
    personalShareCapCents: null,
    receiptStorageUsedBytes: 0,
    receiptStorageQuotaBytes: RECEIPT_STORAGE_QUOTA_BYTES,
    notificationPrefs: { ...DEFAULT_USER_PREFS, payment_methods: [] },
    createdAt: new Date().toISOString(),
  };

  try {
    const [{ data: userRow, error: userErr }, { data: membershipRows, error: memErr }] =
      await Promise.all([
        supabase
          .from("users")
          .select(
            "id, full_name, email, phone_number, phone_verified, base_currency, display_currency, personal_share_cap_cents, auto_include_in_expenses, notification_prefs, created_at",
          )
          .eq("id", authUser.id)
          .maybeSingle(),
        supabase
          .from("group_members")
          .select("group_id, role, status")
          .eq("user_id", authUser.id)
          .eq("status", "ACTIVE"),
      ]);

    if (userErr) {
      return {
        profile: fallbackProfile,
        groups: [],
        loadError: userErr.message || "Unable to load profile settings.",
      };
    }

    const profile: SettingsUserProfile = userRow
      ? {
          id: userRow.id,
          fullName: userRow.full_name || fallbackProfile.fullName,
          email: userRow.email || fallbackProfile.email,
          avatarUrl: authUser.avatarUrl ?? null,
          phoneNumber: userRow.phone_number ?? null,
          phoneVerified: Boolean(userRow.phone_verified),
          instantSettlementTag: null,
          baseCurrency: userRow.base_currency || "USD",
          personalShareCapCents:
            userRow.personal_share_cap_cents !== null &&
            userRow.personal_share_cap_cents !== undefined
              ? Number(userRow.personal_share_cap_cents)
              : null,
          receiptStorageUsedBytes: Number(
            0,
          ),
          receiptStorageQuotaBytes: RECEIPT_STORAGE_QUOTA_BYTES,
          notificationPrefs: normalizeNotificationPrefs(
            userRow.notification_prefs,
            null,
          ),
          createdAt: userRow.created_at || fallbackProfile.createdAt,
        }
      : fallbackProfile;

    if (memErr || !membershipRows || membershipRows.length === 0) {
      return {
        profile,
        groups: [],
        loadError: memErr ? memErr.message : null,
      };
    }

    const roleByGroup = new Map<string, MemberRole>(
      membershipRows.map((m) => [m.group_id, m.role]),
    );
    const groupIds = membershipRows.map((m) => m.group_id);

    const { data: groupRows, error: groupErr } = await supabase
      .from("groups")
      .select(
        "id, name, slug, status, base_currency, default_split_mode, created_at",
      )
      .in("id", groupIds)
      .neq("status", "ARCHIVED")
      .order("created_at", { ascending: true });

    if (groupErr) {
      return {
        profile,
        groups: [],
        loadError: groupErr.message || "Unable to load active groups.",
      };
    }

    const groups: SettingsGroupSummary[] = (groupRows ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      status: g.status,
      baseCurrency: g.base_currency,
      defaultSplitMode: g.default_split_mode,
      simplifyDebts: true,
      currentUserRole: roleByGroup.get(g.id) ?? "MEMBER",
    }));

    return {
      profile,
      groups,
      loadError: null,
    };
  } catch (err) {
    return {
      profile: fallbackProfile,
      groups: [],
      loadError:
        err instanceof Error ? err.message : "Unable to load settings.",
    };
  }
}

export interface UpdateSettingsInput {
  full_name?: unknown;
  phone_number?: unknown;
  instant_settlement_tag?: unknown;
  base_currency?: unknown;
  personal_share_cap_cents?: unknown;
  avatar_url?: unknown;
  notification_prefs?: unknown;
  active_group_id?: unknown;
  group_simplify_debts?: unknown;
  group_default_split_mode?: unknown;
}

export type UpdateSettingsResult =
  | {
      ok: true;
      profile: SettingsUserProfile;
      updatedGroup?: {
        id: string;
        defaultSplitMode: SplitMode;
        simplifyDebts: boolean;
      };
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

  const { data: existingRow, error: existingErr } = await supabase
    .from("users")
    .select(
      "id, full_name, email, phone_number, phone_verified, base_currency, display_currency, personal_share_cap_cents, auto_include_in_expenses, notification_prefs, created_at",
    )
    .eq("id", authUser.id)
    .maybeSingle();

  if (existingErr) {
    return {
      ok: false,
      status: 500,
      code: "SERVER_ERROR",
      message: existingErr.message || "Unable to load user profile.",
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
        message: "Legal full name must be a text value.",
      };
    }
    const trimmed = input.full_name.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_FULL_NAME",
        message: "Legal full name must be between 2 and 100 characters.",
      };
    }
    nextFullName = trimmed;
  }

  // Validate phone_number
  let nextPhoneNumber = existingRow.phone_number;
  let nextPhoneVerified = Boolean(existingRow.phone_verified);
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
    if (phoneCheck.value !== existingRow.phone_number) {
      nextPhoneNumber = phoneCheck.value;
      nextPhoneVerified = false;
    }
  }

  // Validate instant_settlement_tag
  let nextTag: string | null = null;
  if (input.instant_settlement_tag !== undefined) {
    const tagCheck = normalizeInstantSettlementTag(
      input.instant_settlement_tag === null
        ? null
        : String(input.instant_settlement_tag),
    );
    if (!tagCheck.ok) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_SETTLEMENT_TAG",
        message: tagCheck.message,
      };
    }
    nextTag = tagCheck.value;
  }

  // Validate base_currency
  let nextBaseCurrency = existingRow.base_currency || "USD";
  if (input.base_currency !== undefined) {
    const code =
      typeof input.base_currency === "string"
        ? input.base_currency.trim().toUpperCase()
        : "";
    if (!isValidCurrencyCode(code)) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_CURRENCY",
        message: "Base currency must be a valid 3-letter ISO-4217 code.",
      };
    }
    nextBaseCurrency = code;
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
            "Personal share cap must be a non-negative integer in minor units.",
        };
      }
      nextCapCents = num;
    }
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

  // Validate & merge notification_prefs
  const currentPrefs = normalizeNotificationPrefs(
    existingRow.notification_prefs,
    nextTag,
  );
  const nextPrefs = { ...currentPrefs };

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

    if (rawPrefs.new_expense !== undefined) {
      if (typeof rawPrefs.new_expense !== "boolean") {
        return {
          ok: false,
          status: 400,
          code: "INVALID_NOTIFICATION_PREFS",
          message: "new_expense must be a boolean.",
        };
      }
      nextPrefs.new_expense = rawPrefs.new_expense;
    }

    if (rawPrefs.settlement_confirmation !== undefined) {
      if (typeof rawPrefs.settlement_confirmation !== "boolean") {
        return {
          ok: false,
          status: 400,
          code: "INVALID_NOTIFICATION_PREFS",
          message: "settlement_confirmation must be a boolean.",
        };
      }
      nextPrefs.settlement_confirmation = rawPrefs.settlement_confirmation;
    }

    if (rawPrefs.monthly_recap !== undefined) {
      if (typeof rawPrefs.monthly_recap !== "boolean") {
        return {
          ok: false,
          status: 400,
          code: "INVALID_NOTIFICATION_PREFS",
          message: "monthly_recap must be a boolean.",
        };
      }
      nextPrefs.monthly_recap = rawPrefs.monthly_recap;
    }

    if (rawPrefs.auto_settlement_reminders !== undefined) {
      if (typeof rawPrefs.auto_settlement_reminders !== "boolean") {
        return {
          ok: false,
          status: 400,
          code: "INVALID_NOTIFICATION_PREFS",
          message: "auto_settlement_reminders must be a boolean.",
        };
      }
      nextPrefs.auto_settlement_reminders = rawPrefs.auto_settlement_reminders;
    }

    if (rawPrefs.default_split_method !== undefined) {
      if (
        typeof rawPrefs.default_split_method !== "string" ||
        !VALID_SPLIT_METHODS.includes(
          rawPrefs.default_split_method as ExpenseSplitMethod,
        )
      ) {
        return {
          ok: false,
          status: 400,
          code: "INVALID_SPLIT_METHOD",
          message:
            "default_split_method must be EQUAL, PERCENTAGE, or EXACT.",
        };
      }
      nextPrefs.default_split_method =
        rawPrefs.default_split_method as ExpenseSplitMethod;
    }

    if (rawPrefs.payment_methods !== undefined) {
      const pmRes = normalizePaymentMethods(rawPrefs.payment_methods);
      if (!pmRes.ok) {
        return {
          ok: false,
          status: 400,
          code: "INVALID_PAYMENT_METHODS",
          message: pmRes.message,
        };
      }
      nextPrefs.payment_methods = pmRes.value;
    }

    if (rawPrefs.sms_nudges_opt_in !== undefined) {
      if (typeof rawPrefs.sms_nudges_opt_in !== "boolean") {
        return {
          ok: false,
          status: 400,
          code: "INVALID_NOTIFICATION_PREFS",
          message: "sms_nudges_opt_in must be a boolean.",
        };
      }
      if (rawPrefs.sms_nudges_opt_in && (!nextPhoneVerified || !nextPhoneNumber)) {
        return {
          ok: false,
          status: 400,
          code: "PHONE_VERIFICATION_REQUIRED",
          message:
            "Verify your phone number before opting in to SMS settlement nudges.",
        };
      }
      nextPrefs.sms_nudges_opt_in = rawPrefs.sms_nudges_opt_in;
    }
  }

  // Enforce invariant: unverified/cleared phone disables SMS nudges
  if (!nextPhoneVerified || !nextPhoneNumber) {
    nextPrefs.sms_nudges_opt_in = false;
  }

  // Keep Venmo settlement rail handle synced when user has a primary Venmo entry or adds tag
  if (input.instant_settlement_tag !== undefined) {
    const withoutAuto = nextPrefs.payment_methods.filter(
      (pm) => pm.id !== "pm-venmo-primary",
    );
    if (nextTag) {
      const hasDefault = withoutAuto.some((pm) => pm.is_default);
      nextPrefs.payment_methods = [
        {
          id: "pm-venmo-primary",
          label: "Venmo Settlement Rail",
          rail: "VENMO",
          handle: nextTag,
          is_default: !hasDefault,
        },
        ...withoutAuto,
      ];
    } else {
      nextPrefs.payment_methods = withoutAuto;
    }
  }

  // Optional active-group rule mutations (ADMIN-gated)
  let updatedGroup:
    | {
        id: string;
        defaultSplitMode: SplitMode;
        simplifyDebts: boolean;
      }
    | undefined;

  const activeGroupId =
    typeof input.active_group_id === "string" &&
    input.active_group_id.trim() &&
    input.active_group_id.trim() !== "all"
      ? input.active_group_id.trim()
      : null;

  const wantsGroupSplitMode =
    input.group_default_split_mode === "EQUAL" ||
    input.group_default_split_mode === "CUSTOM_RATIOS";

  if (
    input.group_default_split_mode !== undefined &&
    !wantsGroupSplitMode
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_GROUP_SPLIT_MODE",
      message: "group_default_split_mode must be EQUAL or CUSTOM_RATIOS.",
    };
  }

  if (activeGroupId && wantsGroupSplitMode) {
    if (wantsGroupSplitMode) {
      const targetMode = input.group_default_split_mode as SplitMode;
      const { data: groupRow, error: groupErr } = await supabase
        .from("groups")
        .select("id, status, default_split_mode")
        .eq("id", activeGroupId)
        .maybeSingle();

      if (groupErr) {
        return {
          ok: false,
          status: 500,
          code: "SERVER_ERROR",
          message: groupErr.message || "Unable to load active group.",
        };
      }
      if (!groupRow) {
        return {
          ok: false,
          status: 404,
          code: "NOT_FOUND",
          message: "Active group not found.",
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

      const { data: memberRow, error: memberErr } = await supabase
        .from("group_members")
        .select("role, status")
        .eq("group_id", activeGroupId)
        .eq("user_id", authUser.id)
        .maybeSingle();

      if (memberErr) {
        return {
          ok: false,
          status: 500,
          code: "SERVER_ERROR",
          message: memberErr.message || "Unable to verify group role.",
        };
      }
      if (
        !memberRow ||
        memberRow.status !== "ACTIVE" ||
        memberRow.role !== "ADMIN"
      ) {
        return {
          ok: false,
          status: 403,
          code: "FORBIDDEN",
          message: "Only active group admins can update group split rules.",
        };
      }

      if (targetMode === "CUSTOM_RATIOS") {
        const { data: activeMembers } = await supabase
          .from("group_members")
          .select("user_id, share_percentage, joined_at")
          .eq("group_id", activeGroupId)
          .eq("status", "ACTIVE")
          .order("joined_at", { ascending: true });

        const rows = activeMembers ?? [];
        const totalBps = rows.reduce(
          (sum, r) => sum + Math.round(Number(r.share_percentage ?? 0) * 100),
          0,
        );
        if (rows.length > 0 && totalBps !== 10_000) {
          const equalMap = computeEqualSharePercentages(
            rows.map((r) => r.user_id),
          );
          for (const r of rows) {
            await supabase
              .from("group_members")
              .update({ share_percentage: equalMap.get(r.user_id) ?? 0 })
              .eq("group_id", activeGroupId)
              .eq("user_id", r.user_id);
          }
        }
      }

      const { error: modeUpdateErr } = await supabase
        .from("groups")
        .update({ default_split_mode: targetMode })
        .eq("id", activeGroupId);

      if (modeUpdateErr) {
        return {
          ok: false,
          status: 500,
          code: "SERVER_ERROR",
          message:
            modeUpdateErr.message || "Failed to update group default split mode.",
        };
      }

      updatedGroup = {
        id: activeGroupId,
        defaultSplitMode: targetMode,
        simplifyDebts: true,
      };
    } else if (updatedGroup) {
      const { data: refreshedGroup } = await supabase
        .from("groups")
        .select("default_split_mode")
        .eq("id", activeGroupId)
        .maybeSingle();
      if (refreshedGroup) {
        updatedGroup.defaultSplitMode = refreshedGroup.default_split_mode;
      }
    }
  }

  const { data: updatedUser, error: updateErr } = await supabase
    .from("users")
    .update({
      full_name: nextFullName,
      phone_number: nextPhoneNumber,
      phone_verified: nextPhoneVerified,
      base_currency: nextBaseCurrency,
      display_currency: nextBaseCurrency,
      personal_share_cap_cents: nextCapCents,
      notification_prefs: nextPrefs as NotificationPrefs,
    })
    .eq("id", authUser.id)
    .select(
      "id, full_name, email, phone_number, phone_verified, base_currency, display_currency, personal_share_cap_cents, auto_include_in_expenses, notification_prefs, created_at",
    )
    .maybeSingle();

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
      phoneVerified: Boolean(updatedUser.phone_verified),
      instantSettlementTag: nextTag,
      baseCurrency: updatedUser.base_currency || "USD",
      personalShareCapCents:
        updatedUser.personal_share_cap_cents !== null &&
        updatedUser.personal_share_cap_cents !== undefined
          ? Number(updatedUser.personal_share_cap_cents)
          : null,
      receiptStorageUsedBytes: Number(
        0,
      ),
      receiptStorageQuotaBytes: RECEIPT_STORAGE_QUOTA_BYTES,
      notificationPrefs: normalizeNotificationPrefs(
        updatedUser.notification_prefs,
        nextTag,
      ),
      createdAt: updatedUser.created_at,
    },
    updatedGroup,
  };
}

interface PhoneChallengePayload {
  u: string;
  p: string;
  c: string;
  exp: number;
}

export function createPhoneVerificationChallenge(params: {
  userId: string;
  phoneNumber: string;
  nowMs?: number;
  codeOverride?: string;
  secret?: string;
}): { code: string; challengeToken: string; expiresAt: string } {
  const nowMs = params.nowMs ?? Date.now();
  const expiresAtMs = nowMs + 10 * 60 * 1000;
  const code =
    params.codeOverride ?? String(randomInt(100000, 1000000));
  const payload: PhoneChallengePayload = {
    u: params.userId,
    p: params.phoneNumber,
    c: code,
    exp: expiresAtMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", getInviteSigningSecret(params.secret))
    .update(encoded)
    .digest("base64url");

  return {
    code,
    challengeToken: `${encoded}.${sig}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function verifyPhoneVerificationChallenge(params: {
  userId: string;
  phoneNumber: string;
  code: string;
  challengeToken: string;
  nowMs?: number;
  secret?: string;
}): { ok: true } | { ok: false; message: string } {
  const parts = params.challengeToken.trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, message: "Invalid verification challenge token." };
  }
  const [encoded, providedSig] = parts;
  const expectedSig = createHmac(
    "sha256",
    getInviteSigningSecret(params.secret),
  )
    .update(encoded)
    .digest("base64url");

  const sigA = Buffer.from(providedSig, "utf8");
  const sigB = Buffer.from(expectedSig, "utf8");
  if (sigA.length !== sigB.length || !timingSafeEqual(sigA, sigB)) {
    return { ok: false, message: "Verification signature check failed." };
  }

  let parsed: PhoneChallengePayload;
  try {
    parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as PhoneChallengePayload;
  } catch {
    return { ok: false, message: "Malformed verification challenge." };
  }

  const nowMs = params.nowMs ?? Date.now();
  if (typeof parsed.exp !== "number" || nowMs > parsed.exp) {
    return {
      ok: false,
      message: "Verification code expired. Request a new code.",
    };
  }
  if (parsed.u !== params.userId || parsed.p !== params.phoneNumber) {
    return {
      ok: false,
      message: "Phone number does not match the verification challenge.",
    };
  }
  if (parsed.c !== params.code.trim()) {
    return {
      ok: false,
      message: "Incorrect 6-digit verification code.",
    };
  }

  return { ok: true };
}

export async function buildFullLedgerExport(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{
  ok: true;
  csv: string;
  json: string;
} | { ok: false; message: string }> {
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
    .select("id, name, slug, group_type, status, base_currency, billing_cycle_anchor_day")
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
    const baseCurrency = (group?.base_currency || row.currency || "USD").toUpperCase();
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

  const csvSettlements: FullLedgerCsvSettlementItem[] = (settlementRows ?? []).map(
    (s) => {
      const group = groupMap.get(s.group_id);
      const baseCurrency = (group?.base_currency || s.currency || "USD").toUpperCase();
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
    },
  );

  const csv = buildFullLedgerCsv({
    expenses: ledgerRecords,
    settlements: csvSettlements,
    currentUserId: userId,
  });

  const ledgerById = new Map(ledgerRecords.map((r) => [r.id, r]));
  const jsonExpenses = (expenseRows ?? []).map((row) => {
    const ledger = ledgerById.get(row.id);
    const group = groupMap.get(row.group_id);
    const baseCurrency = (group?.base_currency || row.currency || "USD").toUpperCase();
    const amountCents = Math.trunc(Number(row.amount_cents));
    const shareCents = ledger ? getUserShareCents(ledger, userId) : 0;
    const status = ledger?.isLocked
      ? "LOCKED"
      : ledger?.isSettledForUser
        ? "Settled"
        : "Pending";
    const origMinor: number | null = null;
    const origCurrency: string | null = null;

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
      fx_audit:
        origMinor !== null && origCurrency
          ? {
              original_amount_cents: origMinor,
              original_amount_formatted: formatMinorUnits(origMinor, origCurrency),
              original_amount_decimal: formatMinorUnitsDecimal(
                origMinor,
                origCurrency,
              ),
              original_currency: origCurrency,
              exchange_rate: null,
              exchange_rate_source: null,
            }
          : null,
    };
  });

  const jsonSettlements = (settlementRows ?? []).map((s) => {
    const group = groupMap.get(s.group_id);
    const baseCurrency = (group?.base_currency || s.currency || "USD").toUpperCase();
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
