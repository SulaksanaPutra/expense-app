"use client";

import * as React from "react";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  Input,
  SegmentedControl,
} from "@/components/ui";
import { computeEqualSharePercentages } from "@/lib/groups/invite-utils";
import type { SplitGroupDetail } from "@/lib/groups/types";
import type { GroupStatus, SplitMode } from "@/types/database";

export interface EditRatiosModalProps {
  open: boolean;
  onClose: () => void;
  group: SplitGroupDetail;
  onSaved: (result: {
    groupId: string;
    groupStatus: GroupStatus;
    defaultSplitMode: SplitMode;
    memberShares: Array<{ userId: string; sharePercentage: number }>;
  }) => void;
}

const SPLIT_MODE_OPTIONS = [
  { value: "EQUAL", label: "Equal Split" },
  { value: "CUSTOM_RATIOS", label: "Custom Ratios" },
];

export function EditRatiosModal({
  open,
  onClose,
  group,
  onSaved,
}: EditRatiosModalProps) {
  const formId = React.useId();

  const activeMembers = React.useMemo(
    () => group.members.filter((m) => m.status === "ACTIVE"),
    [group.members],
  );

  const [splitMode, setSplitMode] = React.useState<SplitMode>(
    group.defaultSplitMode,
  );
  const [ratioInputs, setRatioInputs] = React.useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        activeMembers.map((member) => [
          member.userId,
          String(member.sharePercentage),
        ]),
      ),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const resetForm = React.useCallback(() => {
    setSplitMode(group.defaultSplitMode);
    setRatioInputs(
      Object.fromEntries(
        activeMembers.map((member) => [
          member.userId,
          String(member.sharePercentage),
        ]),
      ),
    );
    setError(null);
    setIsSubmitting(false);
  }, [activeMembers, group.defaultSplitMode]);

  const equalShares = React.useMemo(
    () => computeEqualSharePercentages(activeMembers.map((m) => m.userId)),
    [activeMembers],
  );

  const customTotalBps = React.useMemo(() => {
    let sumBps = 0;
    for (const member of activeMembers) {
      const raw = ratioInputs[member.userId] ?? "0";
      const num = Number(raw);
      if (Number.isFinite(num) && num >= 0) {
        sumBps += Math.round(num * 100);
      }
    }
    return sumBps;
  }, [activeMembers, ratioInputs]);

  const isCustomBalanced = customTotalBps === 10_000;

  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const allocations = activeMembers.map((member) => {
      if (splitMode === "EQUAL") {
        return {
          user_id: member.userId,
          share_percentage: equalShares.get(member.userId) ?? 0,
        };
      }
      const parsed = Number(ratioInputs[member.userId] ?? "");
      return {
        user_id: member.userId,
        share_percentage: parsed,
      };
    });

    if (splitMode === "CUSTOM_RATIOS") {
      for (const item of allocations) {
        if (
          !Number.isFinite(item.share_percentage) ||
          item.share_percentage < 0 ||
          item.share_percentage > 100
        ) {
          setError("Each member share must be a number between 0 and 100.");
          return;
        }
      }
      if (!isCustomBalanced) {
        setError(
          `Custom split ratios must sum to 100.00% (currently ${(customTotalBps / 100).toFixed(2)}%).`,
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(group.id)}/ratios`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            default_split_mode: splitMode,
            allocations,
          }),
        },
      );

      const payload = (await response.json()) as {
        error?: string;
        groupId?: string;
        groupStatus?: GroupStatus;
        defaultSplitMode?: SplitMode;
        memberShares?: Array<{ userId: string; sharePercentage: number }>;
      };

      if (!response.ok || !payload.memberShares || !payload.groupStatus) {
        setError(payload.error || "Unable to save split ratios.");
        setIsSubmitting(false);
        return;
      }

      onSaved({
        groupId: payload.groupId ?? group.id,
        groupStatus: payload.groupStatus,
        defaultSplitMode: payload.defaultSplitMode ?? splitMode,
        memberShares: payload.memberShares,
      });
      setIsSubmitting(false);
      onClose();
    } catch {
      setError("Network error while saving split ratios. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Edit Split Rules & Ratios"
      description={`Configure default split mode and active member shares for ${group.name}. Past expense snapshots are never modified.`}
      size="md"
      closeOnBackdropClick={!isSubmitting}
      closeOnEscape={!isSubmitting}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={isSubmitting}
            disabled={splitMode === "CUSTOM_RATIOS" && !isCustomBalanced}
          >
            Save Ratios
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        {error && (
          <AlertBanner
            tone="error"
            title="Could not update split ratios"
            description={error}
          />
        )}

        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold tracking-wide text-ink-muted-80">
            Default Split Mode
          </span>
          <SegmentedControl
            aria-label="Default Split Mode"
            options={SPLIT_MODE_OPTIONS}
            value={splitMode}
            onChange={(val) => {
              setSplitMode(val as SplitMode);
              setError(null);
            }}
          />
        </div>

        <div className="flex flex-col gap-3">
          {activeMembers.map((member) => {
            const equalValue = equalShares.get(member.userId) ?? 0;
            return (
              <Card
                key={member.userId}
                variant="sub-card"
                padding="sm"
                className="flex items-center justify-between gap-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={member.name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink">
                      {member.name}
                    </p>
                    <p className="truncate text-[11px] text-ink-muted-48">
                      {member.role === "ADMIN" ? "Admin" : "Member"}
                    </p>
                  </div>
                </div>

                {splitMode === "EQUAL" ? (
                  <Badge tone="neutral" size="md">
                    {equalValue}%
                  </Badge>
                ) : (
                  <div className="w-28 shrink-0">
                    <Input
                      aria-label={`${member.name} share percentage`}
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      suffix="%"
                      value={ratioInputs[member.userId] ?? "0"}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRatioInputs((prev) => ({
                          ...prev,
                          [member.userId]: val,
                        }));
                        setError(null);
                      }}
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {splitMode === "CUSTOM_RATIOS" && (
          <div className="flex items-center justify-between rounded-md border border-hairline bg-canvas-parchment px-3.5 py-2.5 text-[13px]">
            <span className="font-medium text-ink-muted-80">
              Total Allocation
            </span>
            <span
              className={
                isCustomBalanced
                  ? "font-semibold tabular-nums text-emerald-700"
                  : "font-semibold tabular-nums text-amber-700"
              }
            >
              {(customTotalBps / 100).toFixed(2)}% of 100.00%
            </span>
          </div>
        )}
      </form>
    </Dialog>
  );
}
