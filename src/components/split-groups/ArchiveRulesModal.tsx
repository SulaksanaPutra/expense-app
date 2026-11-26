"use client";

import * as React from "react";
import { Archive, RefreshCw } from "lucide-react";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  Input,
  Select,
  Switch,
} from "@/components/ui";
import type { SelectOption } from "@/components/ui";
import type { GroupAuditLogEntry } from "@/lib/groups/audit-log";
import type { SplitGroupDetail } from "@/lib/groups/types";
import type { GroupStatus } from "@/types/database";

export interface ArchiveRulesSavedPayload {
  groupId: string;
  status: GroupStatus;
  tripAutoArchiveEnabled: boolean;
  tripAutoArchiveDays: number;
  residentialLeasePromptEnabled: boolean;
  leaseEndDate: string | null;
  leasePromptSnoozedUntil: string | null;
  archivedAt: string | null;
  auditEntry?: GroupAuditLogEntry;
}

export interface ArchiveRulesModalProps {
  open: boolean;
  onClose: () => void;
  groups: SplitGroupDetail[];
  initialGroupId?: string | null;
  onSaved: (payload: ArchiveRulesSavedPayload) => void;
  onArchiveCheckCompleted?: (summary: {
    autoArchivedGroupIds: string[];
    leasePromptGroupIds: string[];
  }) => void;
}

export function ArchiveRulesModal({
  open,
  onClose,
  groups,
  initialGroupId,
  onSaved,
  onArchiveCheckCompleted,
}: ArchiveRulesModalProps) {
  const formId = React.useId();

  const [targetGroupId, setTargetGroupId] = React.useState<string>(() => {
    if (initialGroupId && groups.some((g) => g.id === initialGroupId)) {
      return initialGroupId;
    }
    return groups[0]?.id ?? "";
  });

  const targetGroup = React.useMemo(
    () => groups.find((g) => g.id === targetGroupId) ?? groups[0] ?? null,
    [groups, targetGroupId],
  );

  const [tripEnabled, setTripEnabled] = React.useState<boolean>(
    targetGroup?.tripAutoArchiveEnabled ?? true,
  );
  const [tripDaysInput, setTripDaysInput] = React.useState<string>(
    String(targetGroup?.tripAutoArchiveDays ?? 14),
  );
  const [leasePromptEnabled, setLeasePromptEnabled] = React.useState<boolean>(
    targetGroup?.residentialLeasePromptEnabled ?? true,
  );
  const [leaseEndDate, setLeaseEndDate] = React.useState<string>(
    targetGroup?.leaseEndDate ?? "",
  );
  const [error, setError] = React.useState<string | null>(null);
  const [checkNotice, setCheckNotice] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isChecking, setIsChecking] = React.useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = React.useState(false);

  const handleSelectTargetGroup = React.useCallback(
    (nextId: string) => {
      setTargetGroupId(nextId);
      const nextGroup = groups.find((g) => g.id === nextId);
      if (nextGroup) {
        setTripEnabled(nextGroup.tripAutoArchiveEnabled ?? true);
        setTripDaysInput(String(nextGroup.tripAutoArchiveDays ?? 14));
        setLeasePromptEnabled(
          nextGroup.residentialLeasePromptEnabled ?? true,
        );
        setLeaseEndDate(nextGroup.leaseEndDate ?? "");
        setError(null);
        setCheckNotice(null);
      }
    },
    [groups],
  );

  const groupOptions = React.useMemo<SelectOption[]>(
    () =>
      groups.map((g) => ({
        value: g.id,
        label: g.name,
        description: `${g.groupType} · ${g.status}`,
      })),
    [groups],
  );

  const isAdmin = targetGroup?.currentUserRole === "ADMIN";
  const isArchived = targetGroup?.status === "ARCHIVED";
  const canEditRules = Boolean(targetGroup && isAdmin && !isArchived);

  const handleSaveRules = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!targetGroup || !canEditRules) return;
    setError(null);

    const parsedDays = Number.parseInt(tripDaysInput.trim(), 10);
    if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 365) {
      setError("Trip auto-archive days must be a whole number between 1 and 365.");
      return;
    }

    const trimmedLease = leaseEndDate.trim();
    if (trimmedLease !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedLease)) {
      setError("Lease end date must be a valid YYYY-MM-DD date.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(targetGroup.id)}/archive-rules`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trip_auto_archive_enabled: tripEnabled,
            trip_auto_archive_days: parsedDays,
            residential_lease_prompt_enabled: leasePromptEnabled,
            lease_end_date: trimmedLease || null,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
      } & Partial<ArchiveRulesSavedPayload>;

      if (!response.ok || !payload.groupId || !payload.status) {
        setError(payload.error || "Unable to save archive rules.");
        setIsSubmitting(false);
        return;
      }

      onSaved({
        groupId: payload.groupId,
        status: payload.status,
        tripAutoArchiveEnabled:
          payload.tripAutoArchiveEnabled ?? tripEnabled,
        tripAutoArchiveDays: payload.tripAutoArchiveDays ?? parsedDays,
        residentialLeasePromptEnabled:
          payload.residentialLeasePromptEnabled ?? leasePromptEnabled,
        leaseEndDate: payload.leaseEndDate ?? (trimmedLease || null),
        leasePromptSnoozedUntil: payload.leasePromptSnoozedUntil ?? null,
        archivedAt: payload.archivedAt ?? null,
        auditEntry: payload.auditEntry,
      });
      setIsSubmitting(false);
      onClose();
    } catch {
      setError("Network error while saving archive rules. Please try again.");
      setIsSubmitting(false);
    }
  };

  const handleArchiveAction = async (action: "ARCHIVE" | "UNARCHIVE") => {
    if (!targetGroup || !isAdmin) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(targetGroup.id)}/archive-rules`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
      } & Partial<ArchiveRulesSavedPayload>;

      if (!response.ok || !payload.groupId || !payload.status) {
        setError(payload.error || "Unable to update group archive status.");
        setIsSubmitting(false);
        return;
      }

      onSaved({
        groupId: payload.groupId,
        status: payload.status,
        tripAutoArchiveEnabled:
          payload.tripAutoArchiveEnabled ?? tripEnabled,
        tripAutoArchiveDays: payload.tripAutoArchiveDays ?? 14,
        residentialLeasePromptEnabled:
          payload.residentialLeasePromptEnabled ?? leasePromptEnabled,
        leaseEndDate: payload.leaseEndDate ?? null,
        leasePromptSnoozedUntil: payload.leasePromptSnoozedUntil ?? null,
        archivedAt: payload.archivedAt ?? null,
        auditEntry: payload.auditEntry,
      });
      setArchiveConfirmOpen(false);
      setIsSubmitting(false);
      onClose();
    } catch {
      setError("Network error while updating archive state.");
      setIsSubmitting(false);
    }
  };

  const handleRunArchiveCheck = async () => {
    setError(null);
    setCheckNotice(null);
    setIsChecking(true);
    try {
      const response = await fetch("/api/groups/archive-check", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        autoArchivedGroupIds?: string[];
        leasePromptGroupIds?: string[];
      };

      if (!response.ok) {
        setError(payload.error || "Failed to run archive rules check.");
        setIsChecking(false);
        return;
      }

      const archivedCount = payload.autoArchivedGroupIds?.length ?? 0;
      const promptCount = payload.leasePromptGroupIds?.length ?? 0;
      setCheckNotice(
        `Evaluated archive rules: ${archivedCount} trip group(s) auto-archived, ${promptCount} residential lease prompt(s) active.`,
      );
      onArchiveCheckCompleted?.({
        autoArchivedGroupIds: payload.autoArchivedGroupIds ?? [],
        leasePromptGroupIds: payload.leasePromptGroupIds ?? [],
      });
    } catch {
      setError("Network error while evaluating archive rules.");
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Group Archive Rules"
        description="Configure automated trip zero-balance archival, residential lease prompts, and manual read-only archiving."
        size="md"
        closeOnBackdropClick={!isSubmitting}
        closeOnEscape={!isSubmitting}
        footer={
          targetGroup ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {isAdmin && !isArchived && (
                  <Button
                    type="button"
                    variant="danger-soft"
                    size="sm"
                    leftIcon={<Archive className="h-3.5 w-3.5" />}
                    disabled={isSubmitting}
                    onClick={() => setArchiveConfirmOpen(true)}
                  >
                    Archive Group
                  </Button>
                )}
                {isAdmin && isArchived && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={isSubmitting}
                    onClick={() => void handleArchiveAction("UNARCHIVE")}
                  >
                    Restore Group
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  {canEditRules ? "Cancel" : "Close"}
                </Button>
                {canEditRules && (
                  <Button
                    type="submit"
                    form={formId}
                    variant="primary"
                    loading={isSubmitting}
                  >
                    Save Rules
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Button type="button" variant="primary" onClick={onClose}>
              Close
            </Button>
          )
        }
      >
        {groups.length === 0 ? (
          <p className="text-[13px] text-ink-muted-48">
            Create or join a split group first to configure archive rules.
          </p>
        ) : (
          <form
            id={formId}
            noValidate
            onSubmit={handleSaveRules}
            className="flex flex-col gap-4"
          >
            {error && (
              <AlertBanner
                tone="error"
                title="Archive configuration error"
                description={error}
              />
            )}

            {checkNotice && (
              <AlertBanner
                tone="info"
                title="Archive check complete"
                description={checkNotice}
              />
            )}

            {targetGroup && !isAdmin && (
              <AlertBanner
                tone="info"
                title="View-only archive rules"
                description="Only a Group Admin can modify archive rules or archive a group."
              />
            )}

            {targetGroup && isArchived && (
              <AlertBanner
                tone="warning"
                title="Group is Archived (Read-Only)"
                description="Expenses, settlements, recurring rules, and rule edits are locked while archived."
              />
            )}

            <Select
              label="Target Split Group"
              options={groupOptions}
              value={targetGroup?.id ?? ""}
              onChange={handleSelectTargetGroup}
            />

            <Card variant="sub-card" padding="sm" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink">
                  Seasonal Trip Auto-Archive
                </span>
                <Badge tone="warning" size="sm">
                  TRIP
                </Badge>
              </div>

              <Switch
                label="Auto-archive settled trip groups"
                description="Transitions TRIP groups to ARCHIVED after all pairwise balances stay at zero."
                checked={tripEnabled}
                onCheckedChange={setTripEnabled}
                disabled={!canEditRules}
                disabledReason={
                  !isAdmin
                    ? "Admin only"
                    : isArchived
                      ? "Group is archived"
                      : undefined
                }
              />

              <Input
                label="Zero-balance days threshold"
                name="trip_auto_archive_days"
                type="number"
                min={1}
                max={365}
                value={tripDaysInput}
                disabled={!canEditRules || !tripEnabled}
                hint="Default is 14 consecutive days with zero balances."
                onChange={(e) => setTripDaysInput(e.target.value)}
              />

              {targetGroup?.groupType === "TRIP" && (
                <p className="text-[12px] text-ink-muted-48">
                  {targetGroup.isFullySettled
                    ? targetGroup.zeroBalanceSince
                      ? `Zero-balance tracking active since ${targetGroup.zeroBalanceSince.slice(0, 10)}.`
                      : "All balances are zero; tracking starts on next check."
                    : "Group currently has open unsettled balances."}
                </p>
              )}
            </Card>

            <Card variant="sub-card" padding="sm" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink">
                  Residential Lease Expiration Prompt
                </span>
                <Badge tone="info" size="sm">
                  RESIDENTIAL
                </Badge>
              </div>

              <Switch
                label="Prompt 7 days post-lease end"
                description="Surfaces an archival prompt 7 days after the configured lease end date."
                checked={leasePromptEnabled}
                onCheckedChange={setLeasePromptEnabled}
                disabled={!canEditRules}
                disabledReason={
                  !isAdmin
                    ? "Admin only"
                    : isArchived
                      ? "Group is archived"
                      : undefined
                }
              />

              <Input
                label="Lease End Date"
                name="lease_end_date"
                type="date"
                value={leaseEndDate}
                disabled={!canEditRules}
                hint="Leave blank if this group has no lease end date."
                onChange={(e) => setLeaseEndDate(e.target.value)}
              />
            </Card>

            <div className="flex items-center justify-between rounded-md border border-hairline bg-canvas-parchment px-3.5 py-2.5">
              <div className="text-[12px] text-ink-muted-80">
                Evaluate 14-day trip auto-archive and 7-day lease prompts now.
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={isChecking}
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={() => void handleRunArchiveCheck()}
              >
                Run Check
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {targetGroup && (
        <ConfirmDialog
          open={archiveConfirmOpen}
          onClose={() => setArchiveConfirmOpen(false)}
          onConfirm={() => handleArchiveAction("ARCHIVE")}
          title={`Archive ${targetGroup.name}?`}
          description="Archiving makes this group strictly read-only. No new expenses, settlements, or recurring rules can be logged while archived."
          confirmLabel="Archive Group"
          variant="danger"
          loading={isSubmitting}
        />
      )}
    </>
  );
}
