"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Calculator,
  Camera,
  Check,
  CheckCircle2,
  CreditCard,
  Download,
  IdCard,
  Info,
  Plus,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Wallet,
  Zap,
} from "lucide-react";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  Dropdown,
  Input,
  ProgressRing,
  SegmentedControl,
  Select,
  Switch,
  ToastContainer,
} from "@/components/ui";
import type {
  DropdownItem,
  SegmentedOption,
  SelectOption,
  ToastItem,
} from "@/components/ui";
import { useActiveGroup } from "@/components/shell";
import { ALL_GROUPS_VALUE } from "@/components/shell/url-state";
import { RECEIPT_STORAGE_QUOTA_BYTES } from "@/lib/expenses/split-engine";
import type { UserGroupBalanceSummary } from "@/lib/groups/departure";
import {
  SUPPORTED_CURRENCIES,
  getCurrencyMinorDigits,
  getCurrencySymbol,
  parseCurrencyInputToMinorUnits,
} from "@/lib/money";
import type {
  SettingsGroupSummary,
  SettingsUserProfile,
} from "@/lib/settings/service";
import type {
  ExpenseSplitMethod,
  PaymentRail,
  SavedPaymentMethod,
} from "@/types/database";
import { AccountDangerZone } from "./AccountDangerZone";

export interface SettingsClientProps {
  initialProfile: SettingsUserProfile;
  groups: SettingsGroupSummary[];
  balances: UserGroupBalanceSummary[];
  loadError?: string | null;
}

const SPLIT_MODE_OPTIONS: Array<SegmentedOption<ExpenseSplitMethod>> = [
  { value: "EQUAL", label: "Equal Split" },
  { value: "PERCENTAGE", label: "Percentage" },
  { value: "EXACT", label: "Exact Shares" },
];

const CURRENCY_OPTIONS: SelectOption[] = SUPPORTED_CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} (${c.symbol})`,
  description: c.label,
}));

const RAIL_OPTIONS: SelectOption[] = [
  { value: "VENMO", label: "Venmo Settlement Rail" },
  { value: "APPLE_CARD", label: "Apple Card / Apple Cash" },
  { value: "CASH", label: "Cash / In-Person" },
  { value: "OTHER", label: "Other Digital Wallet" },
];

function stripAtPrefix(tag: string | null | undefined): string {
  return (tag ?? "").trim().replace(/^@+/, "");
}

function formatTagWithAt(tag: string | null | undefined): string | null {
  const stripped = stripAtPrefix(tag);
  return stripped ? `@${stripped}` : null;
}

function formatMinorUnitsForInput(
  cents: number | null | undefined,
  currency: string,
): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return "";
  }
  const digits = getCurrencyMinorDigits(currency);
  return (Math.trunc(cents) / 10 ** digits).toFixed(digits);
}

function formatMemberSinceLabel(isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return "Member";
  return `Member since ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed)}`;
}

function formatMegabytes(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  return `${(safe / (1024 * 1024)).toFixed(1)} MB`;
}

function formatQuotaPercentLabel(usedBytes: number, quotaBytes: number): string {
  if (usedBytes <= 0 || quotaBytes <= 0) return "0%";
  const pct = (Math.min(usedBytes, quotaBytes) / quotaBytes) * 100;
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

async function compressAvatarFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read selected image."));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const img = new Image();
      img.onerror = () => reject(new Error("Unsupported image format."));
      img.onload = () => {
        const maxDim = 160;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height, 1));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function SettingsClient({
  initialProfile,
  groups,
  balances,
  loadError = null,
}: SettingsClientProps) {
  const router = useRouter();
  const {
    activeGroupId,
    user: shellUser,
    updateUserPreferences,
    updateGroupPreferences,
  } = useActiveGroup();

  const [savedSnapshot, setSavedSnapshot] =
    React.useState<SettingsUserProfile>(initialProfile);

  // Profile & Identity state
  const [fullName, setFullName] = React.useState(initialProfile.fullName);
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(
    initialProfile.avatarUrl,
  );
  const [phoneNumber, setPhoneNumber] = React.useState(
    initialProfile.phoneNumber ?? "",
  );
  const [verifiedPhoneValue, setVerifiedPhoneValue] = React.useState<string | null>(
    initialProfile.phoneVerified ? initialProfile.phoneNumber : null,
  );
  const [instantTagInput, setInstantTagInput] = React.useState(
    stripAtPrefix(initialProfile.instantSettlementTag),
  );

  // Phone OTP verification flow state
  const [verifyOpen, setVerifyOpen] = React.useState(false);
  const [verifyChallengeToken, setVerifyChallengeToken] = React.useState("");
  const [verifyCodeInput, setVerifyCodeInput] = React.useState("");
  const [sandboxOtpHint, setSandboxOtpHint] = React.useState<string | null>(
    null,
  );
  const [verifyLoading, setVerifyLoading] = React.useState(false);
  const [verifyError, setVerifyError] = React.useState<string | null>(null);
  const otpFormRef = React.useRef<HTMLFormElement>(null);

  // Default Split & Settlement Rules state
  const [defaultSplitMethod, setDefaultSplitMethod] =
    React.useState<ExpenseSplitMethod>(
      initialProfile.notificationPrefs.default_split_method,
    );
  const [baseCurrency, setBaseCurrency] = React.useState(
    initialProfile.baseCurrency || "USD",
  );
  const [personalShareCapInput, setPersonalShareCapInput] = React.useState(
    formatMinorUnitsForInput(
      initialProfile.personalShareCapCents,
      initialProfile.baseCurrency || "USD",
    ),
  );
  const [simplifyByGroup, setSimplifyByGroup] = React.useState<
    Record<string, boolean>
  >(() =>
    Object.fromEntries(groups.map((g) => [g.id, Boolean(g.simplifyDebts)])),
  );
  const [autoSettlementReminders, setAutoSettlementReminders] = React.useState(
    initialProfile.notificationPrefs.auto_settlement_reminders,
  );

  // Payment Methods state
  const [paymentMethods, setPaymentMethods] = React.useState<
    SavedPaymentMethod[]
  >(initialProfile.notificationPrefs.payment_methods);
  const [addPaymentOpen, setAddPaymentOpen] = React.useState(false);
  const [pmLabel, setPmLabel] = React.useState("");
  const [pmRail, setPmRail] = React.useState<PaymentRail>("VENMO");
  const [pmHandle, setPmHandle] = React.useState("");
  const [pmDefault, setPmDefault] = React.useState(false);
  const [pmError, setPmError] = React.useState<string | null>(null);

  // Notifications state
  const [newExpenseNotif, setNewExpenseNotif] = React.useState(
    initialProfile.notificationPrefs.new_expense,
  );
  const [settlementNotif, setSettlementNotif] = React.useState(
    initialProfile.notificationPrefs.settlement_confirmation,
  );
  const [monthlyRecapNotif, setMonthlyRecapNotif] = React.useState(
    initialProfile.notificationPrefs.monthly_recap,
  );
  const [smsNudgesOptIn, setSmsNudgesOptIn] = React.useState(
    initialProfile.notificationPrefs.sms_nudges_opt_in,
  );

  // Form submission & validation state
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const toastCounterRef = React.useRef(0);
  const avatarInputRef = React.useRef<HTMLInputElement>(null);

  const pushToast = React.useCallback((toast: Omit<ToastItem, "id">) => {
    toastCounterRef.current += 1;
    setToasts((prev) => [
      ...prev,
      { ...toast, id: `settings-toast-${toastCounterRef.current}` },
    ]);
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const trimmedPhone = phoneNumber.trim();
  const isPhoneCurrentlyVerified =
    Boolean(trimmedPhone) &&
    verifiedPhoneValue !== null &&
    trimmedPhone === verifiedPhoneValue;

  const activeSettingsGroup = React.useMemo(
    () =>
      activeGroupId !== ALL_GROUPS_VALUE
        ? (groups.find((g) => g.id === activeGroupId) ?? null)
        : null,
    [activeGroupId, groups],
  );

  const canManageActiveGroupRules = Boolean(
    activeSettingsGroup &&
      activeSettingsGroup.currentUserRole === "ADMIN" &&
      activeSettingsGroup.status !== "ARCHIVED",
  );

  const simplifySwitchChecked = activeSettingsGroup
    ? (simplifyByGroup[activeSettingsGroup.id] ??
      activeSettingsGroup.simplifyDebts)
    : true;

  const simplifyDisabledReason = !activeSettingsGroup
    ? "Select a specific group in the sidebar to configure per-group debt simplification."
    : activeSettingsGroup.status === "ARCHIVED"
      ? "Archived groups are strictly read-only."
      : activeSettingsGroup.currentUserRole !== "ADMIN"
        ? `Only group admins can toggle Simplify Group Debts for ${activeSettingsGroup.name}.`
        : undefined;

  // WebOTP listener when verification input is open
  React.useEffect(() => {
    if (!verifyOpen || typeof window === "undefined") return;
    if (!("OTPCredential" in window) || !navigator.credentials?.get) return;

    const ac = new AbortController();
    navigator.credentials
      .get({
        otp: { transport: ["sms"] },
        signal: ac.signal,
      } as CredentialRequestOptions)
      .then((cred) => {
        const otp = cred as { code?: string } | null;
        if (otp?.code && /^\d{6}$/.test(otp.code)) {
          setVerifyCodeInput(otp.code);
          otpFormRef.current?.requestSubmit();
        }
      })
      .catch(() => {
        // Ignore AbortError or unsupported WebOTP environments
      });

    return () => {
      ac.abort();
    };
  }, [verifyOpen]);

  // Validation
  const nameError =
    touched.fullName && fullName.trim().length < 2
      ? "Enter your legal full name (at least 2 characters)."
      : undefined;

  const tagError = React.useMemo(() => {
    if (!touched.instantTag) return undefined;
    const stripped = stripAtPrefix(instantTagInput);
    if (!stripped) return undefined;
    if (!/^[a-zA-Z0-9._-]+$/.test(stripped)) {
      return "Use letters, numbers, dots, underscores, or hyphens only.";
    }
    return undefined;
  }, [instantTagInput, touched.instantTag]);

  const parsedPersonalShareCap = React.useMemo(() => {
    const trimmed = personalShareCapInput.trim();
    if (!trimmed) return { valid: true, cents: null as number | null };
    const cents = parseCurrencyInputToMinorUnits(trimmed, baseCurrency);
    return {
      valid: cents !== null,
      cents,
    };
  }, [baseCurrency, personalShareCapInput]);

  const capError =
    touched.personalCap && !parsedPersonalShareCap.valid
      ? `Enter a valid non-negative ${baseCurrency} amount (e.g. ${getCurrencyMinorDigits(baseCurrency) === 0 ? "160000" : "1600.00"}).`
      : undefined;

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      pushToast({
        tone: "error",
        title: "Invalid image file",
        description: "Select a PNG, JPEG, WebP, or GIF image for your avatar.",
      });
      return;
    }
    try {
      const compressed = await compressAvatarFile(file);
      setAvatarUrl(compressed);
      pushToast({
        tone: "info",
        title: "Photo ready",
        description: "Click Save Changes to apply your new profile photo.",
      });
    } catch {
      pushToast({
        tone: "error",
        title: "Unable to process photo",
        description: "Try choosing a smaller PNG or JPEG image.",
      });
    }
  };

  const handleStartPhoneVerification = async () => {
    setVerifyError(null);
    const digits = trimmedPhone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      setVerifyError("Enter a valid phone number (7 to 15 digits) before verifying.");
      return;
    }

    setVerifyLoading(true);
    try {
      const res = await fetch("/api/settings/phone-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          phone_number: trimmedPhone,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        challengeToken?: string;
        sandboxCode?: string;
      };
      if (!res.ok || !payload.challengeToken) {
        setVerifyError(payload.error || "Unable to send verification code.");
        setVerifyLoading(false);
        return;
      }

      setVerifyChallengeToken(payload.challengeToken);
      setSandboxOtpHint(payload.sandboxCode ?? null);
      setVerifyCodeInput("");
      setVerifyOpen(true);
      setVerifyLoading(false);
    } catch {
      setVerifyError("Network error while requesting verification code.");
      setVerifyLoading(false);
    }
  };

  const handleConfirmPhoneCode = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setVerifyError(null);
    const code = verifyCodeInput.trim();
    if (!/^\d{6}$/.test(code)) {
      setVerifyError("Enter the 6-digit verification code.");
      return;
    }

    setVerifyLoading(true);
    try {
      const res = await fetch("/api/settings/phone-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          phone_number: trimmedPhone,
          code,
          challengeToken: verifyChallengeToken,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        phoneNumber?: string;
        phoneVerified?: boolean;
      };
      if (!res.ok || !payload.phoneVerified) {
        setVerifyError(payload.error || "Incorrect verification code.");
        setVerifyLoading(false);
        return;
      }

      const verifiedNum = payload.phoneNumber ?? trimmedPhone;
      setPhoneNumber(verifiedNum);
      setVerifiedPhoneValue(verifiedNum);
      setVerifyOpen(false);
      setVerifyLoading(false);
      setSandboxOtpHint(null);
      pushToast({
        tone: "success",
        title: "Phone verified",
        description: `${verifiedNum} is verified. You can now opt in to SMS settlement nudges.`,
      });
    } catch {
      setVerifyError("Network error while verifying code.");
      setVerifyLoading(false);
    }
  };

  const handleAddPaymentMethod = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPmError(null);
    const label = pmLabel.trim();
    const handle = pmHandle.trim();
    if (!label) {
      setPmError("Enter a label (e.g. Apple Card / Debit or Venmo).");
      return;
    }
    if (!handle) {
      setPmError("Enter a handle or last-4 label (e.g. @alex-rivera-99 or •••• 4281).");
      return;
    }

    const newItem: SavedPaymentMethod = {
      id: `pm-${Date.now()}`,
      label,
      rail: pmRail,
      handle: pmRail === "VENMO" && !handle.startsWith("@") ? `@${handle}` : handle,
      is_default: pmDefault || paymentMethods.length === 0,
    };

    setPaymentMethods((prev) => {
      const cleared = newItem.is_default
        ? prev.map((item) => ({ ...item, is_default: false }))
        : prev;
      return [...cleared, newItem];
    });
    if (pmRail === "VENMO" && !instantTagInput.trim()) {
      setInstantTagInput(stripAtPrefix(newItem.handle));
    }

    setPmLabel("");
    setPmHandle("");
    setPmDefault(false);
    setAddPaymentOpen(false);
    pushToast({
      tone: "info",
      title: "Payment handle added",
      description: `${newItem.label} added. Click Save Changes to persist.`,
    });
  };

  const handleSetDefaultPaymentMethod = (id: string) => {
    setPaymentMethods((prev) =>
      prev.map((pm) => ({ ...pm, is_default: pm.id === id })),
    );
  };

  const handleRemovePaymentMethod = (id: string) => {
    setPaymentMethods((prev) => {
      const next = prev.filter((pm) => pm.id !== id);
      if (next.length > 0 && !next.some((pm) => pm.is_default)) {
        next[0] = { ...next[0], is_default: true };
      }
      return next;
    });
  };

  const handleExport = (format: "csv" | "json") => {
    const url = `/api/settings/export?format=${format}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `ledgersplit-full-ledger-history.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    pushToast({
      tone: "success",
      title: `${format.toUpperCase()} export started`,
      description: "Downloading full ledger history across all split groups.",
    });
  };

  const handleResetToDefaults = () => {
    setSaveError(null);
    setTouched({});
    // Restore identity fields to last saved values
    setFullName(savedSnapshot.fullName);
    setAvatarUrl(savedSnapshot.avatarUrl);
    setPhoneNumber(savedSnapshot.phoneNumber ?? "");
    setVerifiedPhoneValue(
      savedSnapshot.phoneVerified ? savedSnapshot.phoneNumber : null,
    );
    setInstantTagInput(stripAtPrefix(savedSnapshot.instantSettlementTag));

    // Restore split, settlement, and notification preferences to defaults
    setDefaultSplitMethod("EQUAL");
    setBaseCurrency("USD");
    setPersonalShareCapInput("");
    if (activeSettingsGroup && canManageActiveGroupRules) {
      setSimplifyByGroup((prev) => ({
        ...prev,
        [activeSettingsGroup.id]: true,
      }));
    }
    setAutoSettlementReminders(true);
    setNewExpenseNotif(true);
    setSettlementNotif(true);
    setMonthlyRecapNotif(true);
    setSmsNudgesOptIn(false);

    pushToast({
      tone: "info",
      title: "Defaults restored",
      description:
        "Rule and notification settings restored to defaults. Click Save Changes to persist.",
    });
  };

  const handleSaveChanges = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaveError(null);
    setTouched({
      fullName: true,
      instantTag: true,
      personalCap: true,
    });

    if (fullName.trim().length < 2) {
      setSaveError("Legal full name must be at least 2 characters.");
      return;
    }

    const strippedTag = stripAtPrefix(instantTagInput);
    if (strippedTag && !/^[a-zA-Z0-9._-]+$/.test(strippedTag)) {
      setSaveError(
        "Instant settlement tag may only contain letters, numbers, dots, underscores, or hyphens.",
      );
      return;
    }

    if (!parsedPersonalShareCap.valid) {
      setSaveError(`Enter a valid non-negative Personal Share Cap in ${baseCurrency}.`);
      return;
    }

    if (smsNudgesOptIn && !isPhoneCurrentlyVerified) {
      setSaveError(
        "Verify your phone number before enabling SMS settlement nudges.",
      );
      return;
    }

    const normalizedTag = formatTagWithAt(strippedTag);
    const syncedPaymentMethods = paymentMethods.map((pm) =>
      pm.id === "pm-venmo-primary" && normalizedTag
        ? { ...pm, handle: normalizedTag }
        : pm,
    );

    const requestBody: Record<string, unknown> = {
      full_name: fullName.trim(),
      phone_number: trimmedPhone || null,
      instant_settlement_tag: normalizedTag,
      base_currency: baseCurrency,
      personal_share_cap_cents: parsedPersonalShareCap.cents,
      avatar_url: avatarUrl,
      notification_prefs: {
        new_expense: newExpenseNotif,
        settlement_confirmation: settlementNotif,
        monthly_recap: monthlyRecapNotif,
        sms_nudges_opt_in: isPhoneCurrentlyVerified ? smsNudgesOptIn : false,
        auto_settlement_reminders: autoSettlementReminders,
        default_split_method: defaultSplitMethod,
        payment_methods: syncedPaymentMethods,
      },
    };

    if (activeSettingsGroup && canManageActiveGroupRules) {
      requestBody.active_group_id = activeSettingsGroup.id;
      requestBody.group_simplify_debts = simplifySwitchChecked;
      if (defaultSplitMethod === "EQUAL") {
        requestBody.group_default_split_mode = "EQUAL";
      } else if (defaultSplitMethod === "PERCENTAGE") {
        requestBody.group_default_split_mode = "CUSTOM_RATIOS";
      }
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        profile?: SettingsUserProfile;
        updatedGroup?: {
          id: string;
          defaultSplitMode: "EQUAL" | "CUSTOM_RATIOS";
          simplifyDebts: boolean;
        };
      };

      if (!response.ok || !payload.profile) {
        setSaveError(payload.error || "Unable to save settings. Please try again.");
        setIsSaving(false);
        return;
      }

      const saved = payload.profile;
      setSavedSnapshot(saved);
      setFullName(saved.fullName);
      setAvatarUrl(saved.avatarUrl);
      setPhoneNumber(saved.phoneNumber ?? "");
      setVerifiedPhoneValue(saved.phoneVerified ? saved.phoneNumber : null);
      setInstantTagInput(stripAtPrefix(saved.instantSettlementTag));
      setDefaultSplitMethod(saved.notificationPrefs.default_split_method);
      setBaseCurrency(saved.baseCurrency);
      setPersonalShareCapInput(
        formatMinorUnitsForInput(saved.personalShareCapCents, saved.baseCurrency),
      );
      setAutoSettlementReminders(
        saved.notificationPrefs.auto_settlement_reminders,
      );
      setNewExpenseNotif(saved.notificationPrefs.new_expense);
      setSettlementNotif(saved.notificationPrefs.settlement_confirmation);
      setMonthlyRecapNotif(saved.notificationPrefs.monthly_recap);
      setSmsNudgesOptIn(saved.notificationPrefs.sms_nudges_opt_in);
      setPaymentMethods(saved.notificationPrefs.payment_methods);

      const defaultPm = saved.notificationPrefs.payment_methods.find(
        (pm) => pm.is_default,
      );
      updateUserPreferences({
        fullName: saved.fullName,
        avatarUrl: saved.avatarUrl,
        baseCurrency: saved.baseCurrency,
        instantSettlementTag: saved.instantSettlementTag,
        personalShareCapCents: saved.personalShareCapCents,
        defaultSplitMethod: saved.notificationPrefs.default_split_method,
        defaultPaymentRail: defaultPm?.rail ?? "VENMO",
        receiptStorageUsedBytes: saved.receiptStorageUsedBytes,
      });

      if (payload.updatedGroup) {
        updateGroupPreferences(payload.updatedGroup.id, {
          defaultSplitMode: payload.updatedGroup.defaultSplitMode,
          simplifyDebts: payload.updatedGroup.simplifyDebts,
        });
      }

      setIsSaving(false);
      pushToast({
        tone: "success",
        title: "Settings saved",
        description:
          "Preferences persisted and synced across expenses, splits, and settlements.",
      });
      router.refresh();
    } catch {
      setSaveError("Network error while saving settings. Please try again.");
      setIsSaving(false);
    }
  };

  const liveStorageUsedBytes =
    shellUser?.receiptStorageUsedBytes ?? initialProfile.receiptStorageUsedBytes;
  const storageQuotaBytes =
    initialProfile.receiptStorageQuotaBytes || RECEIPT_STORAGE_QUOTA_BYTES;
  const usedMbText = formatMegabytes(liveStorageUsedBytes);
  const quotaPctLabel = formatQuotaPercentLabel(
    liveStorageUsedBytes,
    storageQuotaBytes,
  );

  const liveDisplayTag = formatTagWithAt(instantTagInput);
  const displayedPaymentMethods = React.useMemo(() => {
    const base = [...paymentMethods];
    if (
      liveDisplayTag &&
      !base.some((pm) => pm.rail === "VENMO" && pm.handle === liveDisplayTag)
    ) {
      const existingVenmoIdx = base.findIndex(
        (pm) => pm.id === "pm-venmo-primary",
      );
      if (existingVenmoIdx >= 0) {
        base[existingVenmoIdx] = {
          ...base[existingVenmoIdx],
          handle: liveDisplayTag,
        };
      }
    }
    return base;
  }, [liveDisplayTag, paymentMethods]);

  const currencySymbol = getCurrencySymbol(baseCurrency);

  return (
    <div className="flex flex-col gap-6 pb-8">
      {loadError && (
        <AlertBanner
          tone="error"
          title="Unable to load full settings"
          description={loadError}
        />
      )}

      {/* Editorial Page Header */}
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex max-w-2xl flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-[#0066cc] uppercase">
            <IdCard className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Account &amp; Ledger Configuration</span>
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Settings
          </h1>
          <p className="text-[14px] text-ink-muted-48">
            Manage your personal profile, linked settlement handles, default split
            rules, and notification preferences.
          </p>
        </div>

        <div className="inline-flex w-fit max-w-full flex-wrap items-center gap-2 rounded-pill border border-hairline bg-canvas px-3.5 py-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full bg-[#22c55e]"
          />
          <span className="text-[12px] font-medium text-ink">
            Auto-sync active
          </span>
          <Badge tone={liveDisplayTag ? "info" : "neutral"} size="sm">
            {liveDisplayTag ? `Venmo ${liveDisplayTag}` : "Tag not set"}
          </Badge>
        </div>
      </section>

      {saveError && (
        <AlertBanner
          tone="error"
          title="Could not save settings"
          description={saveError}
        />
      )}

      <form
        id="settings-form"
        noValidate
        onSubmit={handleSaveChanges}
        className="flex flex-col gap-6"
      >
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
          {/* Left Column (7 cols): Profile, Rules, Danger Zone */}
          <div className="flex flex-col gap-6 xl:col-span-7">
            {/* Section 1: Profile & Identity */}
            <Card variant="section" padding="lg" className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <IdCard className="h-5 w-5 text-[#0066cc]" aria-hidden="true" />
                  <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                    Profile &amp; Identity
                  </h2>
                </div>
                <span className="text-[12px] text-ink-muted-48">
                  {formatMemberSinceLabel(initialProfile.createdAt)}
                </span>
              </div>

              {/* Identity Summary Tile */}
              <Card
                variant="sub-card"
                padding="md"
                className="flex flex-col gap-4 sm:flex-row sm:items-center"
              >
                <Avatar
                  name={fullName || initialProfile.email || "User"}
                  src={avatarUrl}
                  size="lg"
                  className="h-16 w-16 text-[20px] ring-2 ring-canvas"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[17px] font-semibold tracking-tight text-ink">
                      {fullName.trim() || initialProfile.fullName}
                    </span>
                    <Badge
                      tone={isPhoneCurrentlyVerified ? "info" : "neutral"}
                      size="sm"
                    >
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      {isPhoneCurrentlyVerified
                        ? "Verified Splitter"
                        : "Email Verified"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-ink-muted-48">
                    {initialProfile.email}
                    {trimmedPhone ? ` · ${trimmedPhone}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    aria-label="Upload profile photo"
                    className="sr-only"
                    onChange={handleAvatarChange}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leftIcon={<Camera className="h-3.5 w-3.5" aria-hidden="true" />}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    Change Photo
                  </Button>
                </div>
              </Card>

              {/* Editable Identity Fields */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Legal Full Name"
                  name="full_name"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    setSaveError(null);
                  }}
                  onBlur={() =>
                    setTouched((prev) => ({ ...prev, fullName: true }))
                  }
                  error={nameError}
                />

                <Input
                  label="Primary Email"
                  name="email"
                  type="email"
                  value={initialProfile.email}
                  readOnly
                  disabled
                  hint="Verified via authentication provider"
                />

                <div className="flex flex-col gap-1.5">
                  <Input
                    label="Phone Number"
                    name="phone_number"
                    type="tel"
                    placeholder="+1 (555) 234-8901"
                    value={phoneNumber}
                    onChange={(e) => {
                      setPhoneNumber(e.target.value);
                      setVerifyError(null);
                      setSaveError(null);
                    }}
                    suffix={
                      isPhoneCurrentlyVerified ? (
                        <Badge tone="success" size="sm">
                          Verified
                        </Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          loading={verifyLoading && !verifyOpen}
                          disabled={!trimmedPhone}
                          onClick={handleStartPhoneVerification}
                          className="h-7 px-2 text-[11px] font-semibold text-[#0066cc]"
                        >
                          Verify
                        </Button>
                      )
                    }
                    hint={
                      isPhoneCurrentlyVerified
                        ? "Verified for SMS settlement nudges"
                        : "Verify phone to unlock SMS settlement nudges"
                    }
                  />
                </div>

                <Input
                  label="Instant Settlement Tag"
                  name="instant_settlement_tag"
                  type="text"
                  prefix="@"
                  suffix={
                    <Zap
                      className="h-3.5 w-3.5 text-amber-500"
                      aria-hidden="true"
                    />
                  }
                  placeholder="alex-rivera-99"
                  value={instantTagInput}
                  onChange={(e) => {
                    setInstantTagInput(e.target.value.replace(/^@+/, ""));
                    setSaveError(null);
                  }}
                  onBlur={() =>
                    setTouched((prev) => ({ ...prev, instantTag: true }))
                  }
                  error={tagError}
                  hint="Used in Venmo Log & Link settlement flows"
                />
              </div>
            </Card>

            {/* Section 2: Default Split & Settlement Rules */}
            <Card variant="section" padding="lg" className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Calculator
                    className="h-5 w-5 text-[#0066cc]"
                    aria-hidden="true"
                  />
                  <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                    Default Split &amp; Settlement Rules
                  </h2>
                </div>
                <Badge tone="neutral" size="sm">
                  {activeSettingsGroup
                    ? activeSettingsGroup.name
                    : "Personal Defaults"}
                </Badge>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[12px] font-semibold tracking-wide text-ink-muted-80">
                  Default Split Mode
                </span>
                <SegmentedControl
                  ariaLabel="Default Split Mode"
                  variant="split-method"
                  fullWidth
                  options={SPLIT_MODE_OPTIONS}
                  value={defaultSplitMethod}
                  onChange={(nextMode) => {
                    setDefaultSplitMethod(nextMode);
                    setSaveError(null);
                  }}
                />
                <p className="text-[12px] text-ink-muted-48">
                  Pre-selects the split method in Add Expense
                  {canManageActiveGroupRules && activeSettingsGroup
                    ? ` and updates ${activeSettingsGroup.name}'s default split mode.`
                    : "."}
                </p>
              </div>

              {/* Base Currency Row */}
              <Card
                variant="sub-card"
                padding="md"
                className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas text-[13px] font-semibold text-[#0066cc]">
                    {currencySymbol}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-semibold text-ink">
                      Base Currency
                    </span>
                    <span className="text-[12px] text-ink-muted-48">
                      Default currency for new groups and personal balance summaries
                    </span>
                  </div>
                </div>
                <Select
                  aria-label="Base Currency"
                  variant="pill-select"
                  options={CURRENCY_OPTIONS}
                  value={baseCurrency}
                  onChange={(val) => {
                    setBaseCurrency(val);
                    setSaveError(null);
                  }}
                  containerClassName="w-full sm:w-44"
                />
              </Card>

              {/* Personal Share Cap */}
              <Card variant="sub-card" padding="md" className="flex flex-col gap-2">
                <Input
                  label="Personal Share Cap"
                  name="personal_share_cap"
                  type="text"
                  inputMode="decimal"
                  prefix={currencySymbol}
                  placeholder={
                    getCurrencyMinorDigits(baseCurrency) === 0
                      ? "160000"
                      : "1600.00"
                  }
                  value={personalShareCapInput}
                  onChange={(e) => {
                    setPersonalShareCapInput(e.target.value);
                    setSaveError(null);
                  }}
                  onBlur={() =>
                    setTouched((prev) => ({ ...prev, personalCap: true }))
                  }
                  error={capError}
                  hint="Monthly threshold tracked on the Expenses Ledger Your Personal Share meter. Leave blank for no cap."
                  className="tabular-nums"
                />
              </Card>

              {/* Rule Switches */}
              <div className="flex flex-col gap-3">
                <Card variant="sub-card" padding="md">
                  <Switch
                    id="settings-simplify-debts"
                    label={
                      activeSettingsGroup
                        ? `Simplify Group Debts (${activeSettingsGroup.name})`
                        : "Simplify Group Debts"
                    }
                    description="Consolidate multi-person debts within the active group using bipartite graph netting."
                    checked={simplifySwitchChecked}
                    disabled={!canManageActiveGroupRules}
                    disabledReason={simplifyDisabledReason}
                    tone="success"
                    className="w-full items-start"
                    onCheckedChange={(checked) => {
                      if (!activeSettingsGroup || !canManageActiveGroupRules) {
                        return;
                      }
                      setSimplifyByGroup((prev) => ({
                        ...prev,
                        [activeSettingsGroup.id]: checked,
                      }));
                    }}
                  />
                </Card>

                <Card variant="sub-card" padding="md">
                  <Switch
                    id="settings-auto-reminders"
                    label="Automatic Settlement Reminders"
                    description="Enable scheduled debtor nudges 3 days before cycle close via push notification or SMS."
                    checked={autoSettlementReminders}
                    tone="success"
                    className="w-full items-start"
                    onCheckedChange={setAutoSettlementReminders}
                  />
                </Card>
              </div>
            </Card>
          </div>

          {/* Right Column (5 cols): Payment Methods, Notifications, Quota */}
          <div className="flex flex-col gap-6 xl:col-span-5">
            {/* Section 3: Payment Methods */}
            <Card variant="section" padding="lg" className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CreditCard
                    className="h-5 w-5 text-[#0066cc]"
                    aria-hidden="true"
                  />
                  <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                    Payment Methods
                  </h2>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => {
                    setPmError(null);
                    setAddPaymentOpen(true);
                  }}
                  className="text-[#0066cc]"
                >
                  Add
                </Button>
              </div>

              <p className="text-[12px] text-ink-muted-48">
                Saved settlement handles for Log &amp; Link payouts. No card
                numbers or bank funds are stored or processed.
              </p>

              {displayedPaymentMethods.length === 0 ? (
                <Card
                  variant="sub-card"
                  padding="md"
                  className="text-[12px] text-ink-muted-48"
                >
                  No settlement handles saved yet. Add your @instant_settlement_tag
                  or add a handle below.
                </Card>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {displayedPaymentMethods.map((pm) => {
                    const menuItems: DropdownItem[] = [
                      {
                        id: "default",
                        label: "Set as Default Rail",
                        disabled: Boolean(pm.is_default),
                        onSelect: () => handleSetDefaultPaymentMethod(pm.id),
                      },
                      {
                        id: "remove",
                        label: "Remove Handle",
                        danger: true,
                        onSelect: () => handleRemovePaymentMethod(pm.id),
                      },
                    ];

                    return (
                      <Card
                        key={pm.id}
                        variant="sub-card"
                        padding="sm"
                        className="flex items-center justify-between gap-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="inline-flex h-8 w-10 shrink-0 items-center justify-center rounded-sm border border-hairline bg-canvas text-[11px] font-bold text-[#0066cc]">
                            {pm.rail === "VENMO"
                              ? "V"
                              : pm.rail === "APPLE_CARD"
                                ? "AC"
                                : pm.rail === "CASH"
                                  ? "$"
                                  : "PM"}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-[13px] font-semibold text-ink">
                                {pm.label}
                              </span>
                              {pm.is_default && (
                                <Badge tone="info" size="sm">
                                  Default
                                </Badge>
                              )}
                            </div>
                            <span className="block truncate text-[12px] text-ink-muted-48">
                              {pm.handle}
                              {pm.rail === "VENMO" && (
                                <span className="ml-1.5 font-medium text-[#248a3d]">
                                  · Instant Payouts
                                </span>
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center">
                          <Dropdown
                            variant="action-menu"
                            align="right"
                            triggerAriaLabel={`Actions for ${pm.label}`}
                            items={menuItems}
                          />
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}

              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<Wallet className="h-4 w-4 text-[#0066cc]" aria-hidden="true" />}
                onClick={() => {
                  setPmError(null);
                  setAddPaymentOpen(true);
                }}
                className="w-full"
              >
                Add New Card or Digital Wallet
              </Button>
            </Card>

            {/* Section 4: Notifications & Export */}
            <Card variant="section" padding="lg" className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bell className="h-5 w-5 text-[#0066cc]" aria-hidden="true" />
                  <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                    Notifications
                  </h2>
                </div>
                <span className="text-[12px] text-ink-muted-48">
                  Push, Email &amp; SMS
                </span>
              </div>

              <div className="flex flex-col gap-4">
                <Switch
                  id="notif-new-expense"
                  label="New Expense Logged"
                  description="Alert immediately when group members add charges"
                  checked={newExpenseNotif}
                  tone="success"
                  className="w-full"
                  onCheckedChange={setNewExpenseNotif}
                />

                <Switch
                  id="notif-settlement-confirmation"
                  label="Settlement Confirmation"
                  description="When payments are completed or marked settled"
                  checked={settlementNotif}
                  tone="success"
                  className="w-full"
                  onCheckedChange={setSettlementNotif}
                />

                <Switch
                  id="notif-monthly-recap"
                  label="Monthly Recap & Digest"
                  description="Comprehensive breakdown on the 1st of every month"
                  checked={monthlyRecapNotif}
                  tone="success"
                  className="w-full"
                  onCheckedChange={setMonthlyRecapNotif}
                />

                <div className="border-t border-divider-soft pt-3">
                  <Switch
                    id="notif-sms-nudges"
                    label="Allow SMS settlement nudges"
                    description="Opt in to receive SMS reminders for unsettled peer balances"
                    checked={isPhoneCurrentlyVerified ? smsNudgesOptIn : false}
                    disabled={!isPhoneCurrentlyVerified}
                    disabledReason="Verify your phone number in Profile & Identity to enable SMS nudges."
                    tone="success"
                    className="w-full"
                    onCheckedChange={setSmsNudgesOptIn}
                  />
                </div>
              </div>

              {/* Export Ledger History */}
              <Card
                variant="sub-card"
                padding="md"
                className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Download
                    className="h-4 w-4 shrink-0 text-ink-muted-48"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <span className="block text-[13px] font-semibold text-ink">
                      Export Ledger History
                    </span>
                    <span className="block truncate text-[12px] text-ink-muted-48">
                      All groups, receipts, and settlements
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleExport("csv")}
                    className="h-8 px-3 text-[12px] text-[#0066cc]"
                  >
                    CSV
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleExport("json")}
                    className="h-8 px-3 text-[12px] text-[#0066cc]"
                  >
                    JSON
                  </Button>
                </div>
              </Card>
            </Card>

            {/* Section 5: Storage & Sync Quota */}
            <Card
              variant="section"
              padding="md"
              data-testid="storage-quota-card"
              className="flex items-center justify-between gap-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                  Storage &amp; Sync Quota
                </span>
                <p className="text-[13px] text-ink tabular-nums">
                  Using <strong className="font-semibold">{usedMbText}</strong>{" "}
                  of 500 MB cloud receipt archival
                </p>
                <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted-48">
                  <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>Shared across all active and archived split groups</span>
                </span>
              </div>

              <ProgressRing
                value={liveStorageUsedBytes}
                max={storageQuotaBytes}
                size={56}
                strokeWidth={5}
                tone="auto"
                label="Storage & Sync Quota"
                valueText={`${quotaPctLabel} (${usedMbText} of 500 MB)`}
                centerLabel={quotaPctLabel}
              />
            </Card>
          </div>
        </div>

        {/* Bottom Sticky Action Bar */}
        <div className="sticky bottom-4 z-20 flex justify-center">
          <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-3 rounded-pill border border-hairline bg-canvas/95 px-4 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.1)] backdrop-blur-xl sm:flex-nowrap">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSaving}
              leftIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={handleResetToDefaults}
            >
              Reset to Defaults
            </Button>
            <span
              aria-hidden="true"
              className="hidden h-4 w-px bg-hairline sm:inline-block"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={isSaving}
              leftIcon={<Check className="h-4 w-4" aria-hidden="true" />}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </form>

      {/* Account Departure / Delete Account Card */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <AccountDangerZone balances={balances} />
        </div>
      </div>

      {/* Phone Verification Dialog */}
      <Dialog
        open={verifyOpen}
        onClose={() => {
          if (!verifyLoading) setVerifyOpen(false);
        }}
        title="Verify Phone Number"
        description={`Confirm possession of ${trimmedPhone} to enable SMS settlement nudges.`}
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={verifyLoading}
              onClick={() => setVerifyOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="phone-otp-form"
              variant="primary"
              size="sm"
              loading={verifyLoading}
              leftIcon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            >
              Confirm Code
            </Button>
          </>
        }
      >
        <form
          id="phone-otp-form"
          ref={otpFormRef}
          method="POST"
          onSubmit={handleConfirmPhoneCode}
          className="flex flex-col gap-4"
        >
          {verifyError && (
            <AlertBanner
              tone="error"
              title="Verification failed"
              description={verifyError}
            />
          )}

          {sandboxOtpHint && (
            <AlertBanner
              tone="info"
              title="Sandbox verification code"
              description={`No SMS gateway is connected in this environment. Use code ${sandboxOtpHint} to verify.`}
            />
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="phone-otp-input"
              className="text-[12px] font-semibold tracking-wide text-ink-muted-80"
            >
              6-Digit Verification Code
            </label>
            <p id="phone-otp-hint" className="text-[12px] text-ink-muted-48">
              Enter the 6-digit code sent to {trimmedPhone}.
            </p>
            <div className="flex h-12 items-center gap-2 rounded-md border border-hairline bg-canvas px-3.5 focus-within:border-primary-focus focus-within:outline-2 focus-within:outline-primary-focus">
              <Smartphone
                className="h-4 w-4 shrink-0 text-ink-muted-48"
                aria-hidden="true"
              />
              <input
                id="phone-otp-input"
                name="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                aria-describedby="phone-otp-hint"
                value={verifyCodeInput}
                onChange={(e) => {
                  setVerifyCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setVerifyError(null);
                }}
                placeholder="123456"
                className="w-full bg-transparent font-mono text-[18px] tracking-[0.3em] text-ink focus:outline-none"
              />
            </div>
          </div>
        </form>
      </Dialog>

      {/* Add Payment Method Handle Dialog */}
      <Dialog
        open={addPaymentOpen}
        onClose={() => setAddPaymentOpen(false)}
        title="Add Settlement Handle"
        description="Save a payment handle or label for Log & Link settlement reminders."
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAddPaymentOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="add-payment-method-form"
              variant="primary"
              size="sm"
            >
              Add Handle
            </Button>
          </>
        }
      >
        <form
          id="add-payment-method-form"
          onSubmit={handleAddPaymentMethod}
          className="flex flex-col gap-4"
        >
          {pmError && (
            <AlertBanner
              tone="error"
              title="Invalid payment handle"
              description={pmError}
            />
          )}

          <Select
            label="Settlement Rail"
            aria-label="Settlement Rail"
            options={RAIL_OPTIONS}
            value={pmRail}
            onChange={(val) => setPmRail(val as PaymentRail)}
          />

          <Input
            label="Display Label"
            name="pm_label"
            required
            placeholder="e.g. Apple Card / Debit"
            value={pmLabel}
            onChange={(e) => setPmLabel(e.target.value)}
          />

          <Input
            label="Handle or Reference"
            name="pm_handle"
            required
            placeholder={
              pmRail === "VENMO" ? "@alex-rivera-99" : "e.g. •••• 4281"
            }
            value={pmHandle}
            onChange={(e) => setPmHandle(e.target.value)}
          />

          <Switch
            id="pm-set-default"
            label="Set as default settlement rail"
            checked={pmDefault}
            onCheckedChange={setPmDefault}
            className="w-full"
          />
        </form>
      </Dialog>

      {toasts.length > 0 && (
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      )}
    </div>
  );
}
