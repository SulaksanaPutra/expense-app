"use client";

import * as React from "react";
import { Clock, Eye, RotateCcw, Trash2 } from "lucide-react";
import {
  AvatarStack,
  Badge,
  Button,
  Card,
  Dropdown,
} from "@/components/ui";
import type { DropdownItem } from "@/components/ui";
import { resolveGroupCategory } from "@/lib/groups/service";
import type { SplitGroupDetail } from "@/lib/groups/types";
import { formatMinorUnits } from "@/lib/money";
import { formatSplitRuleLabel, GROUP_CATEGORY_LABELS } from "./SplitGroupCard";

export function formatArchivedDate(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

export interface ArchivedGroupCardProps {
  group: SplitGroupDetail;
  isRestoring: boolean;
  disableRestore: boolean;
  onViewFinalLedger: (group: SplitGroupDetail) => void;
  onOpenAuditLog: (group: SplitGroupDetail) => void;
  onRestoreGroup: (group: SplitGroupDetail) => void;
  onDeleteGroup: (group: SplitGroupDetail) => void;
}

export function ArchivedGroupCard({
  group,
  isRestoring,
  disableRestore,
  onViewFinalLedger,
  onOpenAuditLog,
  onRestoreGroup,
  onDeleteGroup,
}: ArchivedGroupCardProps) {
  const cat = resolveGroupCategory(group);
  const archivedDateLabel = formatArchivedDate(group.archivedAt);
  const isAdmin = group.currentUserRole === "ADMIN";
  const totalSettledCents = group.totalSettledCents ?? 0;
  const unsettledMembersCount = group.members.filter(
    (m) => m.netBalanceCents !== 0,
  ).length;
  const isSettled = group.isFullySettled && unsettledMembersCount === 0;

  const menuItems = React.useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [
      {
        id: "view-final-ledger",
        label: "View Final Ledger",
        icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" />,
        onSelect: () => onViewFinalLedger(group),
      },
      {
        id: "audit-log",
        label: "Audit Log",
        icon: <Clock className="h-3.5 w-3.5" aria-hidden="true" />,
        onSelect: () => onOpenAuditLog(group),
      },
    ];
    if (isAdmin) {
      items.push(
        { id: "divider", separator: true },
        {
          id: "restore-group",
          label: "Restore Group",
          icon: <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />,
          onSelect: () => onRestoreGroup(group),
        },
        {
          id: "delete-group",
          label: "Delete",
          danger: true,
          icon: <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />,
          onSelect: () => onDeleteGroup(group),
        },
      );
    }
    return items;
  }, [
    group,
    isAdmin,
    onDeleteGroup,
    onOpenAuditLog,
    onRestoreGroup,
    onViewFinalLedger,
  ]);

  return (
    <Card
      variant="section"
      padding="md"
      data-testid={`archived-group-card-${group.id}`}
      className="flex flex-col justify-between gap-4"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                tone="neutral"
                size="sm"
                className="border-outline-variant/60 bg-surface-container-low text-on-surface-variant"
              >
                {GROUP_CATEGORY_LABELS[cat]}
              </Badge>
              <Badge
                tone="neutral"
                size="sm"
                className="border-outline-variant/60 bg-surface-container-low text-outline"
              >
                Archived
              </Badge>
            </div>
            <h3 className="truncate font-display text-[17px] font-semibold tracking-tight text-on-surface">
              {group.name}
            </h3>
          </div>
          <Dropdown
            variant="action-menu"
            triggerAriaLabel={`Actions for ${group.name}`}
            items={menuItems}
          />
        </div>

        <div className="flex items-end justify-between gap-2 text-[12px] text-outline">
          <div className="space-y-2">
            <p className="font-medium text-on-surface">
              {formatSplitRuleLabel(group)}
            </p>
            <AvatarStack
              members={group.members.map((m) => ({
                id: m.userId,
                name: m.name,
              }))}
              max={4}
              size="sm"
            />
          </div>
          <span className="shrink-0 pb-0.5 text-[12px] text-outline">
            {archivedDateLabel ? `Archived ${archivedDateLabel}` : "Archived"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-divider-soft pt-3">
          <div className="rounded-[14px] border border-hairline bg-surface-pearl p-3">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-outline">
              TOTAL SETTLED
            </span>
            <span className="mt-1 block text-[16px] font-semibold text-on-surface">
              {formatMinorUnits(totalSettledCents, group.baseCurrency)}
            </span>
          </div>
          <div className="rounded-[14px] border border-hairline bg-surface-pearl p-3">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-outline">
                FINAL BALANCE
              </span>
              <Badge tone={isSettled ? "success" : "warning"} size="sm">
                {isSettled ? "Settled" : "Unsettled"}
              </Badge>
            </div>
            <span className="mt-1 block text-[16px] font-semibold text-on-surface">
              {formatMinorUnits(group.userNetLedgerCents, group.baseCurrency, {
                showPlus: group.userNetLedgerCents !== 0,
              })}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-divider-soft pt-3">
        {isAdmin && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={isRestoring}
            disabled={disableRestore}
            onClick={() => onRestoreGroup(group)}
          >
            <RotateCcw className="h-3.5 w-3.5 text-outline" aria-hidden="true" />
            Restore Group
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="bg-surface-pearl border-hairline hover:bg-surface-canvas"
          onClick={() => onViewFinalLedger(group)}
        >
          View Final Ledger
        </Button>
        {isAdmin && (
          <Button
            type="button"
            variant="danger-soft"
            size="sm"
            className="ml-auto"
            onClick={() => onDeleteGroup(group)}
          >
            Delete
          </Button>
        )}
      </div>
    </Card>
  );
}
