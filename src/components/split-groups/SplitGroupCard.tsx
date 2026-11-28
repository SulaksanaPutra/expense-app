"use client";

import * as React from "react";
import {
  Archive,
  Clock,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import {
  AvatarStack,
  Badge,
  Card,
  Dropdown,
} from "@/components/ui";
import type { DropdownItem } from "@/components/ui";
import { cn } from "@/lib/cn";
import { resolveGroupCategory } from "@/lib/groups/service";
import type { SplitGroupDetail } from "@/lib/groups/types";
import { formatMinorUnits } from "@/lib/money";
import type { GroupCategory } from "@/types/database";

export const GROUP_CATEGORY_LABELS: Record<GroupCategory, string> = {
  HOME: "Home",
  TRIP: "Trip",
  DINING: "Dining",
  UTILITIES: "Utilities",
  OTHER: "Other",
};

export function formatSplitRuleLabel(group: SplitGroupDetail): string {
  const activeCount = group.members.filter((m) => m.status === "ACTIVE").length;

  if (group.defaultSplitMode === "EQUAL") {
    if (activeCount === 2) {
      return "2-Way (50/50)";
    }
    if (activeCount > 0) {
      const pct = 100 / activeCount;
      const pctLabel = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
      return `${activeCount}-Way Equal (${pctLabel})`;
    }
    return "Equal Split";
  }

  if (group.defaultSplitMode === "PERCENTAGE") {
    return "Percentage Split";
  }

  if (group.defaultSplitMode === "SHARES") {
    return "Shares Split";
  }

  return "Itemized Custom";
}

export interface SplitGroupCardProps {
  group: SplitGroupDetail;
  isSelected: boolean;
  onSelectGroup: (groupId: string) => void;
  onEditGroup: (group: SplitGroupDetail) => void;
  onOpenSplitRules: (group: SplitGroupDetail) => void;
  onOpenAuditLog: (group: SplitGroupDetail) => void;
  onArchiveGroup: (group: SplitGroupDetail) => void;
}

export function SplitGroupCard({
  group,
  isSelected,
  onSelectGroup,
  onEditGroup,
  onOpenSplitRules,
  onOpenAuditLog,
  onArchiveGroup,
}: SplitGroupCardProps) {
  const category = resolveGroupCategory(group);
  const categoryLabel = GROUP_CATEGORY_LABELS[category];
  const isArchived = group.status === "ARCHIVED";

  const activeMembers = React.useMemo(
    () => group.members.filter((m) => m.status === "ACTIVE"),
    [group.members],
  );

  const splitRuleLabel = React.useMemo(
    () => formatSplitRuleLabel(group),
    [group],
  );

  const netLedger = group.userNetLedgerCents;
  const formattedTurnover = formatMinorUnits(
    group.cycleTurnoverCents,
    group.baseCurrency,
  );
  const formattedNetLedger = formatMinorUnits(netLedger, group.baseCurrency, {
    showPlus: true,
  });

  const menuItems = React.useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [
      {
        id: "edit-group",
        label: "Edit Group",
        icon: <Pencil className="h-3.5 w-3.5" aria-hidden="true" />,
        disabled: isArchived,
        onSelect: () => onEditGroup(group),
      },
      {
        id: "split-rules-invite",
        label: "Split Rules & Invite",
        icon: <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />,
        onSelect: () => onOpenSplitRules(group),
      },
      {
        id: "audit-log",
        label: "Audit Log",
        icon: <Clock className="h-3.5 w-3.5" aria-hidden="true" />,
        onSelect: () => onOpenAuditLog(group),
      },
    ];

    if (!isArchived) {
      items.push(
        { id: "divider", separator: true },
        {
          id: "archive-group",
          label: "Archive Group",
          danger: true,
          icon: <Archive className="h-3.5 w-3.5" aria-hidden="true" />,
          onSelect: () => onArchiveGroup(group),
        },
      );
    }

    return items;
  }, [
    group,
    isArchived,
    onArchiveGroup,
    onEditGroup,
    onOpenAuditLog,
    onOpenSplitRules,
  ]);

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectGroup(group.id);
    }
  };

  return (
    <Card
      variant="section"
      padding="md"
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`Select group ${group.name}`}
      data-testid={`group-card-${group.id}`}
      data-selected={isSelected ? "true" : "false"}
      onClick={() => onSelectGroup(group.id)}
      onKeyDown={handleCardKeyDown}
      className={cn(
        "flex cursor-pointer flex-col justify-between transition-all focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2",
        isSelected
          ? "border-primary ring-2 ring-primary/15"
          : "border-outline-variant/60 hover:border-outline",
      )}
    >
      <div>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              tone="neutral"
              size="sm"
              data-group-category={category}
              className="border-outline-variant/60 bg-surface-container-low text-on-surface-variant"
            >
              {categoryLabel}
            </Badge>
            {group.status === "NEEDS_RATIO_UPDATE" && (
              <Badge tone="warning" size="sm">
                Ratio Update Needed
              </Badge>
            )}
          </div>
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Dropdown
              variant="action-menu"
              triggerAriaLabel={`Actions for ${group.name}`}
              items={menuItems}
            />
          </div>
        </div>

        <h3 className="truncate font-display text-[17px] font-semibold tracking-tight text-on-surface">
          {group.name}
        </h3>
        <p className="mt-0.5 truncate text-[13px] text-outline">
          {splitRuleLabel}
        </p>

        <div className="mt-4 mb-5">
          <AvatarStack
            members={activeMembers.map((m) => ({
              id: m.userId,
              name: m.name,
            }))}
            max={4}
            size="sm"
          />
        </div>
      </div>

      <div className="flex items-end justify-between gap-2 border-t border-outline-variant/40 pt-3 tabular-nums">
        <div className="min-w-0">
          <span className="block text-[11px] text-outline">Cycle Spend</span>
          <span className="mt-0.5 block truncate text-[14px] font-semibold text-on-surface">
            {formattedTurnover}
          </span>
        </div>
        <div className="shrink-0 text-right">
          <span className="block text-[11px] text-outline">Your Net</span>
          {netLedger === 0 ? (
            <Badge
              tone="neutral"
              size="sm"
              className="mt-0.5 border-outline-variant/60 bg-surface-container-low text-on-surface-variant"
            >
              Settled
            </Badge>
          ) : (
            <span
              className={cn(
                "mt-0.5 block text-[14px] font-semibold",
                netLedger > 0 ? "text-emerald-700" : "text-red-600",
              )}
            >
              {formattedNetLedger}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
