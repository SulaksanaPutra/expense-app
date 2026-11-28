"use client";

import * as React from "react";
import { Check, Copy, Link2, RefreshCw, Send } from "lucide-react";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Input,
  SegmentedControl,
  Select,
  Switch,
} from "@/components/ui";
import type { SegmentedOption, SelectOption } from "@/components/ui";
import type { ShellGroupSummary } from "@/components/shell/types";
import { cn } from "@/lib/cn";
import {
  computeEqualSharePercentages,
  validateCustomRatios,
  validateShareUnits,
} from "@/lib/groups/invite-utils";
import type {
  SplitGroupDetail,
  SplitGroupMemberDetail,
} from "@/lib/groups/types";
import type { SplitMode } from "@/types/database";

type UiSplitMethod = "EQUAL" | "PERCENTAGE" | "SHARES" | "CUSTOM";

function toUiSplitMethod(mode: SplitMode): UiSplitMethod {
  if (mode === "CUSTOM_RATIOS" || mode === "CUSTOM") return "CUSTOM";
  if (mode === "PERCENTAGE") return "PERCENTAGE";
  if (mode === "SHARES") return "SHARES";
  return "EQUAL";
}

const SPLIT_METHOD_OPTIONS: Array<SegmentedOption<UiSplitMethod>> = [
  { value: "EQUAL", label: "Equal" },
  { value: "PERCENTAGE", label: "Percentage (%)" },
  { value: "SHARES", label: "Shares" },
  { value: "CUSTOM", label: "Custom" },
];

const CURRENCY_OPTIONS: SelectOption[] = [
  { value: "USD", label: "USD ($) — US Dollar" },
  { value: "EUR", label: "EUR (€) — Euro" },
  { value: "GBP", label: "GBP (£) — British Pound" },
  { value: "CAD", label: "CAD ($) — Canadian Dollar" },
  { value: "AUD", label: "AUD ($) — Australian Dollar" },
  { value: "JPY", label: "JPY (¥) — Japanese Yen" },
  { value: "IDR", label: "IDR (Rp) — Indonesian Rupiah" },
];

const BASE_CYCLE_RESET_OPTIONS: Array<{
  value: string;
  label: string;
  day: number;
  autoSettle: boolean;
}> = [
  {
    value: "1-auto",
    label: "1st of month (Auto-settle)",
    day: 1,
    autoSettle: true,
  },
  {
    value: "1-manual",
    label: "1st of month (Manual close)",
    day: 1,
    autoSettle: false,
  },
  {
    value: "15-manual",
    label: "15th of month (Manual close)",
    day: 15,
    autoSettle: false,
  },
  {
    value: "28-manual",
    label: "28th of month (Manual close)",
    day: 28,
    autoSettle: false,
  },
];

function getCycleResetValue(day: number, autoSettle: boolean): string {
  const match = BASE_CYCLE_RESET_OPTIONS.find(
    (o) => o.day === day && o.autoSettle === autoSettle,
  );
  if (match) return match.value;
  return `${day}-${autoSettle ? "auto" : "manual"}`;
}

function parseCycleResetValue(value: string): {
  cycleResetDay: number;
  autoSettleOnReset: boolean;
} {
  const match = BASE_CYCLE_RESET_OPTIONS.find((o) => o.value === value);
  if (match) {
    return {
      cycleResetDay: match.day,
      autoSettleOnReset: match.autoSettle,
    };
  }
  const [dayStr, modeStr] = value.split("-");
  const parsedDay = Number.parseInt(dayStr ?? "1", 10);
  const clampedDay =
    Number.isInteger(parsedDay) && parsedDay >= 1 && parsedDay <= 28
      ? parsedDay
      : 1;
  return {
    cycleResetDay: clampedDay,
    autoSettleOnReset: modeStr === "auto",
  };
}

export interface SplitRulesInviteTabProps {
  group: SplitGroupDetail;
  inviteLinkUrl: string;
  copiedGroupId: string | null;
  copyStatusText: string;
  regeneratingGroupId: string | null;
  onCopyInviteLink: (group: SplitGroupDetail) => void;
  onRegenerateInviteLink: (group: SplitGroupDetail) => void;
  onArchiveGroup: (group: SplitGroupDetail) => void;
  onLeaveGroup: (group: SplitGroupDetail) => void;
  onRemoveMember: (
    group: SplitGroupDetail,
    member: SplitGroupMemberDetail,
  ) => void;
  onRulesSaved: (
    group: SplitGroupDetail,
    shellGroup: ShellGroupSummary,
  ) => void;
  onSavingChange?: (saving: boolean) => void;
  onNotify: (toast: {
    tone: "success" | "error" | "info" | "warning";
    title: string;
    description: string;
  }) => void;
}

export function SplitRulesInviteTab({
  group,
  inviteLinkUrl,
  copiedGroupId,
  copyStatusText,
  regeneratingGroupId,
  onCopyInviteLink,
  onRegenerateInviteLink,
  onArchiveGroup,
  onLeaveGroup,
  onRemoveMember,
  onRulesSaved,
  onSavingChange,
  onNotify,
}: SplitRulesInviteTabProps) {
  const isAdmin = group.currentUserRole === "ADMIN";
  const isArchived = group.status === "ARCHIVED";
  const canEdit = isAdmin && !isArchived;

  const activeMembers = React.useMemo(
    () => group.members.filter((m) => m.status === "ACTIVE"),
    [group.members],
  );

  const [splitMethod, setSplitMethod] = React.useState<UiSplitMethod>(() =>
    toUiSplitMethod(group.defaultSplitMode),
  );
  const [percentagesByUser, setPercentagesByUser] = React.useState<
    Record<string, string>
  >(() => {
    const map: Record<string, string> = {};
    for (const m of activeMembers) {
      map[m.userId] = String(m.sharePercentage);
    }
    return map;
  });
  const [sharesByUser, setSharesByUser] = React.useState<
    Record<string, string>
  >(() => {
    const map: Record<string, string> = {};
    for (const m of activeMembers) {
      map[m.userId] = String(m.shareUnits ?? 1);
    }
    return map;
  });
  const [currency, setCurrency] = React.useState<string>(group.baseCurrency);
  const [cycleResetOption, setCycleResetOption] = React.useState<string>(() =>
    getCycleResetValue(
      group.cycleResetDay ?? group.billingCycleAnchorDay ?? 1,
      group.autoSettleOnReset ?? true,
    ),
  );
  const [allowAnyMemberAddExpense, setAllowAnyMemberAddExpense] =
    React.useState<boolean>(group.allowAnyMemberAddExpense ?? true);
  const [requireReceiptOver100, setRequireReceiptOver100] =
    React.useState<boolean>(group.requireReceiptOver100 ?? false);
  const [sendCycleCloseReminders, setSendCycleCloseReminders] =
    React.useState<boolean>(group.sendCycleCloseReminders ?? true);

  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = React.useState<string | null>(null);
  const [sendingInvite, setSendingInvite] = React.useState(false);

  const cycleResetOptions = React.useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = BASE_CYCLE_RESET_OPTIONS.map((o) => ({
      value: o.value,
      label: o.label,
    }));
    if (!opts.some((o) => o.value === cycleResetOption)) {
      const parsed = parseCycleResetValue(cycleResetOption);
      opts.push({
        value: cycleResetOption,
        label: `Day ${parsed.cycleResetDay} (${parsed.autoSettleOnReset ? "Auto-settle" : "Manual close"})`,
      });
    }
    return opts;
  }, [cycleResetOption]);

  const equalShareMap = React.useMemo(
    () => computeEqualSharePercentages(activeMembers.map((m) => m.userId)),
    [activeMembers],
  );

  const totalPercentage = React.useMemo(() => {
    return activeMembers.reduce((sum, m) => {
      const val = Number.parseFloat(percentagesByUser[m.userId] ?? "0");
      return sum + (Number.isFinite(val) ? val : 0);
    }, 0);
  }, [activeMembers, percentagesByUser]);

  const totalShareUnits = React.useMemo(() => {
    return activeMembers.reduce((sum, m) => {
      const val = Number.parseFloat(sharesByUser[m.userId] ?? "0");
      return sum + (Number.isFinite(val) ? val : 0);
    }, 0);
  }, [activeMembers, sharesByUser]);

  const isPctBalanced = Math.abs(totalPercentage - 100) <= 0.01;
  const isSharesValid = totalShareUnits > 0;

  const handleDistributeEqually = () => {
    const next: Record<string, string> = {};
    for (const m of activeMembers) {
      next[m.userId] = String(equalShareMap.get(m.userId) ?? 0);
    }
    setPercentagesByUser(next);
    setValidationError(null);
  };

  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setValidationError(null);

    const activeIds = activeMembers.map((m) => m.userId);
    let allocationsPayload: Array<{
      user_id: string;
      share_percentage?: number;
      share_units?: number;
    }> = [];

    if (splitMethod === "EQUAL") {
      allocationsPayload = activeIds.map((id) => ({
        user_id: id,
        share_percentage: equalShareMap.get(id) ?? 0,
        share_units: 1,
      }));
    } else if (splitMethod === "PERCENTAGE" || splitMethod === "CUSTOM") {
      const inputs = activeMembers.map((m) => ({
        userId: m.userId,
        sharePercentage: Number.parseFloat(percentagesByUser[m.userId] ?? "0"),
      }));
      const check = validateCustomRatios(inputs, activeIds);
      if (!check.ok) {
        setValidationError(check.message);
        return;
      }
      allocationsPayload = activeIds.map((id) => ({
        user_id: id,
        share_percentage: check.normalized.get(id) ?? 0,
      }));
    } else if (splitMethod === "SHARES") {
      const inputs = activeMembers.map((m) => ({
        userId: m.userId,
        shareUnits: Number.parseFloat(sharesByUser[m.userId] ?? "0"),
      }));
      const check = validateShareUnits(inputs, activeIds);
      if (!check.ok) {
        setValidationError(check.message);
        return;
      }
      allocationsPayload = activeIds.map((id) => ({
        user_id: id,
        share_units: check.unitsByUser.get(id) ?? 1,
        share_percentage: check.percentagesByUser.get(id) ?? 0,
      }));
    }

    const { cycleResetDay, autoSettleOnReset } =
      parseCycleResetValue(cycleResetOption);

    onSavingChange?.(true);
    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(group.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            default_split_mode: splitMethod,
            base_currency: currency,
            cycle_reset_day: cycleResetDay,
            auto_settle_on_reset: autoSettleOnReset,
            allow_any_member_add_expense: allowAnyMemberAddExpense,
            require_receipt_over_100: requireReceiptOver100,
            send_cycle_close_reminders: sendCycleCloseReminders,
            allocations: allocationsPayload,
          }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        group?: SplitGroupDetail;
        shellGroup?: ShellGroupSummary;
      };

      if (!response.ok || !payload.group || !payload.shellGroup) {
        const errMsg = payload.error || "Could not save split rules.";
        setValidationError(errMsg);
        onNotify({
          tone: "error",
          title: "Save failed",
          description: errMsg,
        });
        return;
      }

      onRulesSaved(payload.group, payload.shellGroup);
    } catch {
      const errMsg = "Network error while saving split rules.";
      setValidationError(errMsg);
      onNotify({
        tone: "error",
        title: "Network error",
        description: errMsg,
      });
    } finally {
      onSavingChange?.(false);
    }
  };

  const handleSendEmailInvite = async () => {
    if (!canEdit) return;
    const trimmed = inviteEmail.trim();
    if (!trimmed) {
      setInviteError("Please enter an email address.");
      return;
    }

    setInviteError(null);
    setInviteSuccess(null);
    setSendingInvite(true);

    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(group.id)}/invite`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        invite?: { invitedEmail: string; expiresAt: string };
      };

      if (!response.ok || !payload.invite) {
        const msg = payload.error || "Failed to send email invitation.";
        setInviteError(msg);
        onNotify({
          tone: "error",
          title: "Could not send invite",
          description: msg,
        });
        return;
      }

      setInviteEmail("");
      setInviteSuccess(
        `Invitation sent to ${payload.invite.invitedEmail} (14-day expiry).`,
      );
      onNotify({
        tone: "success",
        title: "Email invite sent",
        description: `Sent a 14-day group invitation to ${payload.invite.invitedEmail}.`,
      });
    } catch {
      setInviteError("Network error while sending email invite.");
    } finally {
      setSendingInvite(false);
    }
  };

  return (
    <form
      id="split-rules-form"
      onSubmit={handleSaveRules}
      className="grid grid-cols-1 gap-8 lg:grid-cols-2"
    >
      {/* LEFT COLUMN: DEFAULT SPLIT RULES */}
      <div className="min-w-0 space-y-6">
        <div>
          <h3 className="text-[14px] font-semibold text-on-surface">
            Default Split Rules
          </h3>
          <p className="mt-0.5 text-[12px] text-outline">
            Applied automatically to new expenses logged in this group.
          </p>
        </div>

        {validationError && (
          <AlertBanner
            tone="error"
            title="Split rule validation error"
            description={validationError}
          />
        )}

        {/* SPLIT CALCULATION METHOD */}
        <div className="space-y-2">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-outline">
            Split Calculation Method
          </span>
          <SegmentedControl
            variant="split-method"
            role="radiogroup"
            ariaLabel="Split calculation method"
            fullWidth
            options={SPLIT_METHOD_OPTIONS.map((opt) => ({
              ...opt,
              disabled: !canEdit,
            }))}
            value={splitMethod}
            onChange={(next) => {
              if (!canEdit) return;
              setSplitMethod(next);
              setValidationError(null);
            }}
            className="[&>button]:flex-1 [&>button]:px-2 [&>button]:text-[11px] sm:[&>button]:text-[12px]"
          />
        </div>

        {/* Per-member weights / percentages */}
        <div className="space-y-2.5">
          {activeMembers.map((member) => {
            const equalPct = equalShareMap.get(member.userId) ?? 0;
            const unitsNum = Number.parseFloat(
              sharesByUser[member.userId] ?? "0",
            );
            const sharePctPreview =
              totalShareUnits > 0 && Number.isFinite(unitsNum) && unitsNum >= 0
                ? ((unitsNum / totalShareUnits) * 100).toFixed(1)
                : "0.0";

            return (
              <div
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-outline-variant/60 bg-surface-container-low p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={member.name} size="md" />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-on-surface">
                      {member.name}
                      {member.isCurrentUser ? " (You)" : ""}
                    </div>
                    <div className="truncate text-[11px] text-outline">
                      {member.role === "ADMIN" ? "Primary Organizer" : "Member"}
                    </div>
                  </div>
                </div>

                {splitMethod === "EQUAL" && (
                  <span className="pr-1 text-[13px] font-semibold text-on-surface tabular-nums">
                    {equalPct.toFixed(1)}%
                  </span>
                )}

                {(splitMethod === "PERCENTAGE" || splitMethod === "CUSTOM") && (
                  <div className="w-28 shrink-0">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      aria-label={`${member.name} split percentage`}
                      disabled={!canEdit}
                      value={percentagesByUser[member.userId] ?? "0"}
                      onChange={(ev) => {
                        setPercentagesByUser((prev) => ({
                          ...prev,
                          [member.userId]: ev.target.value,
                        }));
                        setValidationError(null);
                      }}
                      suffix="%"
                      className="h-9 text-right text-[13px] tabular-nums"
                    />
                  </div>
                )}

                {splitMethod === "SHARES" && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-outline tabular-nums">
                      {sharePctPreview}%
                    </span>
                    <div className="w-28 shrink-0">
                      <Input
                        type="number"
                        step="0.5"
                        min="0"
                        aria-label={`${member.name} split shares`}
                        disabled={!canEdit}
                        value={sharesByUser[member.userId] ?? "1"}
                        onChange={(ev) => {
                          setSharesByUser((prev) => ({
                            ...prev,
                            [member.userId]: ev.target.value,
                          }));
                          setValidationError(null);
                        }}
                        suffix="x"
                        className="h-9 text-right text-[13px] tabular-nums"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {(splitMethod === "PERCENTAGE" || splitMethod === "CUSTOM") && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-0.5 text-[12px]">
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  isPctBalanced ? "text-emerald-700" : "text-red-600",
                )}
              >
                Total allocation: {totalPercentage.toFixed(2)}%{" "}
                {isPctBalanced ? "(Balanced)" : "(Must equal 100%)"}
              </span>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDistributeEqually}
                  className="h-7 px-2 text-[11px] text-primary"
                >
                  Distribute equally
                </Button>
              )}
            </div>
          )}

          {splitMethod === "SHARES" && (
            <div className="flex items-center justify-between px-1 pt-0.5 text-[12px]">
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  isSharesValid ? "text-emerald-700" : "text-red-600",
                )}
              >
                Total shares: {totalShareUnits.toFixed(2).replace(/\.00$/, "")}
                {!isSharesValid && " (Must be > 0)"}
              </span>
            </div>
          )}
        </div>

        {/* GROUP CURRENCY & CYCLE RESET DAY */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <Select
              label="GROUP CURRENCY"
              aria-label="Group currency"
              variant="pill-select"
              options={CURRENCY_OPTIONS}
              value={currency}
              onChange={setCurrency}
              disabled={!canEdit}
            />
          </div>
          <div className="min-w-0">
            <Select
              label="CYCLE RESET DAY"
              aria-label="Cycle reset day"
              variant="pill-select"
              options={cycleResetOptions}
              value={cycleResetOption}
              onChange={setCycleResetOption}
              disabled={!canEdit}
            />
          </div>
        </div>

        {/* AUTOMATION & POLICIES */}
        <div className="space-y-3 pt-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-outline">
            Automation &amp; Policies
          </span>

          <div className="rounded-[14px] border border-outline-variant/60 bg-surface-container-low p-3.5">
            <Switch
              id={`policy-add-expense-${group.id}`}
              label="Allow any member to add expenses"
              description="Co-tenants can log receipts directly without prior sign-off"
              checked={allowAnyMemberAddExpense}
              onCheckedChange={setAllowAnyMemberAddExpense}
              disabled={!canEdit}
              tone="success"
              size="md"
              className="w-full"
            />
          </div>

          <div className="rounded-[14px] border border-outline-variant/60 bg-surface-container-low p-3.5">
            <Switch
              id={`policy-receipt-100-${group.id}`}
              label="Require receipt for expenses over $100"
              description="Enforce image or PDF receipt attachment before splitting"
              checked={requireReceiptOver100}
              onCheckedChange={setRequireReceiptOver100}
              disabled={!canEdit}
              tone="success"
              size="md"
              className="w-full"
            />
          </div>

          <div className="rounded-[14px] border border-outline-variant/60 bg-surface-container-low p-3.5">
            <Switch
              id={`policy-cycle-reminders-${group.id}`}
              label="Send reminders when cycle closes"
              description="Automated notification 48 hours prior to monthly cut-off"
              checked={sendCycleCloseReminders}
              onCheckedChange={setSendCycleCloseReminders}
              disabled={!canEdit}
              tone="success"
              size="md"
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: INVITE & MEMBER ACCESS */}
      <div className="min-w-0 space-y-6">
        <div>
          <h3 className="text-[14px] font-semibold text-on-surface">
            Invite &amp; Member Access
          </h3>
          <p className="mt-0.5 text-[12px] text-outline">
            Manage invites, passkeys, and tenant permissions.
          </p>
        </div>

        {/* SHAREABLE INVITE LINK */}
        <div
          data-testid="member-invitation-gateway"
          className="space-y-2"
        >
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-outline">
            Shareable Invite Link
          </span>
          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <div className="min-w-0 flex-1 basis-full sm:basis-auto">
              <Input
                id="invite-link-input"
                type="text"
                readOnly
                aria-label="Group invite link"
                prefix={
                  <Link2
                    className="h-4 w-4 text-outline"
                    aria-hidden="true"
                  />
                }
                value={inviteLinkUrl}
                className="rounded-full font-mono text-[12px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => onCopyInviteLink(group)}
                leftIcon={
                  copiedGroupId === group.id ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )
                }
              >
                {copiedGroupId === group.id ? "Copied" : "Copy Link"}
              </Button>
              {canEdit && (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  aria-label="Regenerate Link"
                  title="Regenerate Link"
                  loading={regeneratingGroupId === group.id}
                  onClick={() => onRegenerateInviteLink(group)}
                  className="px-3.5"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
            <span role="status" aria-live="polite" className="sr-only">
              {copyStatusText}
            </span>
          </div>
          <p className="pl-1 text-[11px] text-outline tabular-nums">
            Expires in 14 days · Single passkey registration
            {!canEdit && " · Member view · Copy only"}
          </p>
        </div>

        {/* INVITE BY EMAIL */}
        <div className="space-y-2">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-outline">
            Invite by Email
          </span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <Input
                id={`invite-email-${group.id}`}
                type="email"
                placeholder="email@example.com"
                aria-label="Invite by email"
                disabled={!canEdit}
                value={inviteEmail}
                onChange={(ev) => {
                  setInviteEmail(ev.target.value);
                  setInviteError(null);
                  setInviteSuccess(null);
                }}
                error={inviteError ?? undefined}
                className="rounded-full text-[13px]"
              />
            </div>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={!canEdit || sendingInvite}
              loading={sendingInvite}
              leftIcon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => void handleSendEmailInvite()}
              className="shrink-0"
            >
              Send Invite
            </Button>
          </div>
          {inviteSuccess && (
            <p className="pl-1 text-[12px] font-medium text-emerald-700">
              {inviteSuccess}
            </p>
          )}
          {!canEdit && (
            <p className="pl-1 text-[11px] text-outline">
              Only Group Owners/Admins can send email invitations.
            </p>
          )}
        </div>

        {/* GROUP MEMBERS (N) */}
        <div className="space-y-2.5 pt-1">
          <span className="block px-1 text-[11px] font-semibold uppercase tracking-wider text-outline tabular-nums">
            Group Members ({group.members.length})
          </span>

          {group.members.map((member) => (
            <div
              key={member.userId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-outline-variant/60 bg-surface-container-lowest p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={member.name} size="md" />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-on-surface">
                    {member.name}
                    {member.isCurrentUser ? " (You)" : ""}
                  </div>
                  <div className="truncate text-[11px] text-outline">
                    {member.email}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {member.status === "FORMER_MEMBER" ? (
                  <Badge tone="warning" size="sm">
                    Former
                  </Badge>
                ) : member.role === "ADMIN" ? (
                  <Badge tone="neutral" size="sm">
                    Owner
                  </Badge>
                ) : (
                  <Badge tone="neutral" size="sm">
                    Member
                  </Badge>
                )}

                {canEdit &&
                  !member.isCurrentUser &&
                  member.status === "ACTIVE" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${member.name}`}
                      onClick={() => onRemoveMember(group, member)}
                      className="h-7 px-2 text-[12px] text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </Button>
                  )}
              </div>
            </div>
          ))}
        </div>

        {/* GROUP MAINTENANCE */}
        {!isArchived && (
          <div className="space-y-3 border-t border-outline-variant/40 pt-4">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-outline">
              Group Maintenance
            </span>
            <div className="flex flex-col justify-between gap-3 rounded-[14px] border border-outline-variant/60 bg-surface-container-low p-3.5 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-on-surface">
                  Archive or Leave Group
                </div>
                <div className="text-[11px] text-outline">
                  Archive to read-only or leave this split entity
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isAdmin && (
                  <Button
                    type="button"
                    variant="danger-soft"
                    size="sm"
                    onClick={() => onArchiveGroup(group)}
                  >
                    Archive Group
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onLeaveGroup(group)}
                >
                  Leave Group
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
