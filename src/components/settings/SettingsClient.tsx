"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Card,
  Input,
  Select,
  Switch,
  ToastContainer,
} from "@/components/ui";
import type { SelectOption, ToastItem } from "@/components/ui";
import { useActiveGroup } from "@/components/shell";
import type { UserGroupBalanceSummary } from "@/lib/groups/departure";
import {
  SUPPORTED_CURRENCIES,
  getCurrencyMinorDigits,
  getCurrencySymbol,
  parseCurrencyInputToMinorUnits,
} from "@/lib/money";
import type { SettingsUserProfile } from "@/lib/settings/service";
import { AccountDangerZone } from "./AccountDangerZone";

export interface SettingsClientProps {
  initialProfile: SettingsUserProfile;
  groupCount?: number;
  balances: UserGroupBalanceSummary[];
  loadError?: string | null;
}

const BASE_TIMEZONE_OPTIONS: SelectOption[] = [
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PST)" },
  { value: "America/Denver", label: "America/Denver (MST)" },
  { value: "America/Chicago", label: "America/Chicago (CST)" },
  { value: "America/New_York", label: "America/New_York (EST)" },
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
  { value: "Europe/London", label: "Europe/London (GMT)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GST)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT)" },
  { value: "Asia/Makassar", label: "Asia/Makassar (WITA)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST)" },
];

const CURRENCY_OPTIONS: SelectOption[] = SUPPORTED_CURRENCIES.map((c) => ({
  value: c.code,
  label: c.label,
}));

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
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed)}`;
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
  groupCount = 0,
  balances,
  loadError = null,
}: SettingsClientProps) {
  const router = useRouter();
  const { updateUserPreferences } = useActiveGroup();

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
  const [timezone, setTimezone] = React.useState(
    initialProfile.timezone || "America/Los_Angeles",
  );

  // Display Currency & Personal Budget state
  const [displayCurrency, setDisplayCurrency] = React.useState(
    initialProfile.displayCurrency || "USD",
  );
  const [personalShareCapInput, setPersonalShareCapInput] = React.useState(
    formatMinorUnitsForInput(
      initialProfile.personalShareCapCents,
      initialProfile.displayCurrency || "USD",
    ),
  );
  const [autoIncludeInExpenses, setAutoIncludeInExpenses] = React.useState(
    initialProfile.autoIncludeInExpenses,
  );

  // Notifications state (4 v2 switches)
  const [newExpenseAdded, setNewExpenseAdded] = React.useState(
    initialProfile.notificationPrefs.new_expense_added,
  );
  const [settlementRecorded, setSettlementRecorded] = React.useState(
    initialProfile.notificationPrefs.settlement_recorded,
  );
  const [cycleCloseReminder, setCycleCloseReminder] = React.useState(
    initialProfile.notificationPrefs.cycle_close_reminder,
  );
  const [monthlySummaryDigest, setMonthlySummaryDigest] = React.useState(
    initialProfile.notificationPrefs.monthly_summary_digest,
  );

  // Form submission & validation state
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const toastCounterRef = React.useRef(0);
  const avatarInputRef = React.useRef<HTMLInputElement>(null);
  const emailInputId = React.useId();

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

  const timezoneOptions = React.useMemo<SelectOption[]>(() => {
    if (
      !timezone ||
      BASE_TIMEZONE_OPTIONS.some((opt) => opt.value === timezone)
    ) {
      return BASE_TIMEZONE_OPTIONS;
    }
    return [{ value: timezone, label: timezone }, ...BASE_TIMEZONE_OPTIONS];
  }, [timezone]);

  const trimmedPhone = phoneNumber.trim();

  // Validation
  const nameError =
    touched.fullName && fullName.trim().length < 2
      ? "Enter your full name (at least 2 characters)."
      : undefined;

  const phoneError = React.useMemo(() => {
    if (!touched.phoneNumber || !trimmedPhone) return undefined;
    const digits = trimmedPhone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      return "Enter a valid phone number (7 to 15 digits).";
    }
    return undefined;
  }, [touched.phoneNumber, trimmedPhone]);

  const parsedPersonalShareCap = React.useMemo(() => {
    const trimmed = personalShareCapInput.trim();
    if (!trimmed) return { valid: true, cents: null as number | null };
    const cents = parseCurrencyInputToMinorUnits(trimmed, displayCurrency);
    return {
      valid: cents !== null,
      cents,
    };
  }, [displayCurrency, personalShareCapInput]);

  const capError =
    touched.personalCap && !parsedPersonalShareCap.valid
      ? `Enter a valid non-negative ${displayCurrency} amount (e.g. ${getCurrencyMinorDigits(displayCurrency) === 0 ? "160000" : "1600.00"}).`
      : undefined;

  const isDirty = React.useMemo(() => {
    const savedCapStr = formatMinorUnitsForInput(
      savedSnapshot.personalShareCapCents,
      savedSnapshot.displayCurrency || "USD",
    );
    return (
      fullName !== savedSnapshot.fullName ||
      avatarUrl !== savedSnapshot.avatarUrl ||
      trimmedPhone !== (savedSnapshot.phoneNumber ?? "") ||
      timezone !== savedSnapshot.timezone ||
      displayCurrency !== savedSnapshot.displayCurrency ||
      personalShareCapInput.trim() !== savedCapStr ||
      autoIncludeInExpenses !== savedSnapshot.autoIncludeInExpenses ||
      newExpenseAdded !== savedSnapshot.notificationPrefs.new_expense_added ||
      settlementRecorded !==
        savedSnapshot.notificationPrefs.settlement_recorded ||
      cycleCloseReminder !==
        savedSnapshot.notificationPrefs.cycle_close_reminder ||
      monthlySummaryDigest !==
        savedSnapshot.notificationPrefs.monthly_summary_digest
    );
  }, [
    autoIncludeInExpenses,
    avatarUrl,
    cycleCloseReminder,
    displayCurrency,
    fullName,
    monthlySummaryDigest,
    newExpenseAdded,
    personalShareCapInput,
    savedSnapshot,
    settlementRecorded,
    timezone,
    trimmedPhone,
  ]);

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

  const handleDiscardChanges = () => {
    setSaveError(null);
    setTouched({});
    setFullName(savedSnapshot.fullName);
    setAvatarUrl(savedSnapshot.avatarUrl);
    setPhoneNumber(savedSnapshot.phoneNumber ?? "");
    setTimezone(savedSnapshot.timezone || "America/Los_Angeles");
    setDisplayCurrency(savedSnapshot.displayCurrency || "USD");
    setPersonalShareCapInput(
      formatMinorUnitsForInput(
        savedSnapshot.personalShareCapCents,
        savedSnapshot.displayCurrency || "USD",
      ),
    );
    setAutoIncludeInExpenses(savedSnapshot.autoIncludeInExpenses);
    setNewExpenseAdded(savedSnapshot.notificationPrefs.new_expense_added);
    setSettlementRecorded(savedSnapshot.notificationPrefs.settlement_recorded);
    setCycleCloseReminder(savedSnapshot.notificationPrefs.cycle_close_reminder);
    setMonthlySummaryDigest(
      savedSnapshot.notificationPrefs.monthly_summary_digest,
    );

    pushToast({
      tone: "info",
      title: "Changes discarded",
      description: "Reverted all fields to your last saved settings.",
    });
  };

  const handleSaveChanges = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaveError(null);
    setTouched({
      fullName: true,
      phoneNumber: true,
      personalCap: true,
    });

    if (fullName.trim().length < 2) {
      setSaveError("Full name must be at least 2 characters.");
      return;
    }

    if (trimmedPhone) {
      const digits = trimmedPhone.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) {
        setSaveError("Enter a valid phone number (7 to 15 digits).");
        return;
      }
    }

    if (!parsedPersonalShareCap.valid) {
      setSaveError(
        `Enter a valid non-negative Personal Monthly Share Cap in ${displayCurrency}.`,
      );
      return;
    }

    const requestBody = {
      full_name: fullName.trim(),
      phone_number: trimmedPhone || null,
      timezone,
      display_currency: displayCurrency,
      personal_share_cap_cents: parsedPersonalShareCap.cents,
      auto_include_in_expenses: autoIncludeInExpenses,
      avatar_url: avatarUrl,
      notification_prefs: {
        new_expense_added: newExpenseAdded,
        settlement_recorded: settlementRecorded,
        cycle_close_reminder: cycleCloseReminder,
        monthly_summary_digest: monthlySummaryDigest,
      },
    };

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
      };

      if (!response.ok || !payload.profile) {
        setSaveError(
          payload.error || "Unable to save settings. Please try again.",
        );
        setIsSaving(false);
        return;
      }

      const saved = payload.profile;
      setSavedSnapshot(saved);
      setFullName(saved.fullName);
      setAvatarUrl(saved.avatarUrl);
      setPhoneNumber(saved.phoneNumber ?? "");
      setTimezone(saved.timezone);
      setDisplayCurrency(saved.displayCurrency);
      setPersonalShareCapInput(
        formatMinorUnitsForInput(
          saved.personalShareCapCents,
          saved.displayCurrency,
        ),
      );
      setAutoIncludeInExpenses(saved.autoIncludeInExpenses);
      setNewExpenseAdded(saved.notificationPrefs.new_expense_added);
      setSettlementRecorded(saved.notificationPrefs.settlement_recorded);
      setCycleCloseReminder(saved.notificationPrefs.cycle_close_reminder);
      setMonthlySummaryDigest(saved.notificationPrefs.monthly_summary_digest);
      setTouched({});

      updateUserPreferences({
        fullName: saved.fullName,
        avatarUrl: saved.avatarUrl,
        displayCurrency: saved.displayCurrency,
        baseCurrency: saved.displayCurrency,
        personalShareCapCents: saved.personalShareCapCents,
        autoIncludeInExpenses: saved.autoIncludeInExpenses,
      });

      setIsSaving(false);
      pushToast({
        tone: "success",
        title: "Settings saved",
        description:
          "Your profile, currency, budget, and notification preferences have been updated.",
      });
      router.refresh();
    } catch {
      setSaveError("Network error while saving settings. Please try again.");
      setIsSaving(false);
    }
  };

  const currencySymbol = getCurrencySymbol(displayCurrency);

  return (
    <form
      onSubmit={handleSaveChanges}
      noValidate
      className="flex flex-col gap-6 pb-8"
    >
      {loadError && (
        <AlertBanner
          tone="error"
          title="Unable to load full settings"
          description={loadError}
        />
      )}

      {saveError && (
        <AlertBanner
          tone="error"
          title="Could not save settings"
          description={saveError}
        />
      )}

      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 pt-1 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h1 className="font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] text-on-surface">
            Settings
          </h1>
          <p className="mt-1 text-[14px] text-outline">
            Manage your profile, personal currency &amp; budget, settlement
            handles, notifications, and security.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={!isDirty || isSaving}
            onClick={handleDiscardChanges}
          >
            Discard Changes
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={isSaving}
          >
            Save Changes
          </Button>
        </div>
      </div>

      {/* 12-Column Responsive Grid */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* LEFT COLUMN (7 cols) */}
        <div className="flex flex-col gap-6 lg:col-span-7">
          {/* Card 1: Profile & Identity */}
          <Card variant="section" padding="md" className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-[17px] font-semibold tracking-[-0.015em] text-on-surface">
                Profile &amp; Identity
              </h2>
              <span className="text-[12px] tabular-nums text-outline">
                {formatMemberSinceLabel(savedSnapshot.createdAt)}
              </span>
            </div>

            {/* Avatar + Identity Sub-Card */}
            <Card
              variant="sub-card"
              padding="sm"
              className="flex flex-col justify-between gap-4 rounded-[14px] sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 items-center gap-4">
                <Avatar
                  size="lg"
                  name={fullName || savedSnapshot.fullName}
                  src={avatarUrl}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[16px] font-semibold text-on-surface">
                      {fullName.trim() || savedSnapshot.fullName}
                    </span>
                    <Badge tone="success" size="sm">
                      Verified User
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-outline">
                    {savedSnapshot.email}
                    {trimmedPhone ? ` · ${trimmedPhone}` : ""}
                  </p>
                </div>
              </div>

              <div className="shrink-0">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={handleAvatarChange}
                  className="sr-only"
                  aria-label="Upload profile photo"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  Change Photo
                </Button>
              </div>
            </Card>

            {/* 2x2 Form Grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Full Name"
                shape="pill"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onBlur={() =>
                  setTouched((prev) => ({ ...prev, fullName: true }))
                }
                error={nameError}
                placeholder="Jordan Doe"
                required
              />

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={emailInputId}
                    className="text-[12px] font-semibold tracking-wide text-on-surface-variant"
                  >
                    Primary Email
                  </label>
                  <span className="text-[11px] text-outline">
                    Managed via Google SSO
                  </span>
                </div>
                <Input
                  id={emailInputId}
                  type="email"
                  shape="pill"
                  value={savedSnapshot.email}
                  disabled
                  readOnly
                  suffix={
                    <Lock className="h-4 w-4 text-outline" aria-hidden="true" />
                  }
                />
              </div>

              <Input
                label="Phone Number"
                shape="pill"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                onBlur={() =>
                  setTouched((prev) => ({ ...prev, phoneNumber: true }))
                }
                error={phoneError}
                placeholder="+1 (415) 890-3412"
                className="tabular-nums"
                hint="Used for Zelle settlement identity & SMS reminders"
              />

              <div className="flex flex-col gap-1.5">
                <Select
                  label="Timezone"
                  variant="pill-select"
                  searchable
                  searchPlaceholder="Search timezones..."
                  options={timezoneOptions}
                  value={timezone}
                  onChange={setTimezone}
                  className="h-11 w-full"
                />
                <p className="text-[12px] text-outline">
                  Syncs timestamps on shared receipt audits
                </p>
              </div>
            </div>
          </Card>

          {/* Card 2: Display Currency & Personal Budget */}
          <Card variant="section" padding="md" className="space-y-6">
            <div>
              <h2 className="font-display text-[17px] font-semibold tracking-[-0.015em] text-on-surface">
                Display Currency &amp; Personal Budget
              </h2>
              <p className="mt-0.5 text-[12px] text-outline">
                Configure your primary conversion currency and individual
                spending alert threshold.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Select
                  label="Display Currency"
                  variant="pill-select"
                  options={CURRENCY_OPTIONS}
                  value={displayCurrency}
                  onChange={setDisplayCurrency}
                  className="h-11 w-full"
                />
                <p className="text-[12px] text-outline">
                  Rollup currency for Dashboard &amp; Expenses totals
                </p>
              </div>

              <Input
                label="Personal Monthly Share Cap"
                shape="pill"
                inputMode="decimal"
                value={personalShareCapInput}
                onChange={(e) => setPersonalShareCapInput(e.target.value)}
                onBlur={() =>
                  setTouched((prev) => ({ ...prev, personalCap: true }))
                }
                prefix={currencySymbol}
                suffix="/ month"
                error={capError}
                placeholder="1600.00"
                className="tabular-nums"
                hint="Drives the Monthly Cap meter on Expenses Ledger"
              />
            </div>

            <Card
              variant="sub-card"
              padding="sm"
              className="rounded-[14px]"
            >
              <Switch
                className="w-full"
                tone="success"
                checked={autoIncludeInExpenses}
                onCheckedChange={setAutoIncludeInExpenses}
                label="Auto-include me in new expenses"
                description="Pre-select yourself as a participant when creating a split."
              />
            </Card>
          </Card>
        </div>

        {/* RIGHT COLUMN (5 cols) */}
        <div className="flex flex-col gap-6 lg:col-span-5">
          {/* Card 3: Notifications */}
          <Card variant="section" padding="md" className="space-y-4">
            <div>
              <h2 className="font-display text-[17px] font-semibold tracking-[-0.015em] text-on-surface">
                Notifications
              </h2>
              <p className="mt-0.5 text-[12px] text-outline">
                Customize real-time push and email alerts for expense activity.
              </p>
            </div>

            <div className="flex flex-col gap-4 pt-1">
              <Switch
                className="w-full"
                tone="success"
                checked={newExpenseAdded}
                onCheckedChange={setNewExpenseAdded}
                label="New expense added"
                description="Push & email when someone splits a bill with you"
              />
              <Switch
                className="w-full"
                tone="success"
                checked={settlementRecorded}
                onCheckedChange={setSettlementRecorded}
                label="Settlement recorded"
                description="Push & email when a peer marks a balance paid"
              />
              <Switch
                className="w-full"
                tone="success"
                checked={cycleCloseReminder}
                onCheckedChange={setCycleCloseReminder}
                label="Cycle close reminder"
                description="Email 48h before your monthly cycle resets"
              />
              <Switch
                className="w-full"
                tone="success"
                checked={monthlySummaryDigest}
                onCheckedChange={setMonthlySummaryDigest}
                label="Monthly summary digest"
                description="Email recap on day 1 of each cycle"
              />
            </div>
          </Card>

          {/* Card 4: Data & Account */}
          <Card variant="section" padding="md" className="space-y-5">
            <h2 className="font-display text-[17px] font-semibold tracking-[-0.015em] text-on-surface">
              Data &amp; Account
            </h2>

            <Card
              variant="sub-card"
              padding="sm"
              className="flex flex-col justify-between gap-3 rounded-[14px] sm:flex-row sm:items-center"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-on-surface">
                  Export Ledger Archive
                </div>
                <p className="mt-0.5 text-[11px] text-outline">
                  All groups, expenses, and settlements
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleExport("csv")}
                >
                  CSV
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleExport("json")}
                >
                  JSON
                </Button>
              </div>
            </Card>

            <AccountDangerZone
              embedded
              balances={balances}
              groupCount={groupCount}
            />
          </Card>
        </div>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </form>
  );
}
