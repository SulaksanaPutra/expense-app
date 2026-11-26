"use client";

import * as React from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Copy,
  Layers,
  Zap,
} from "lucide-react";
import {
  AvatarStack,
  Badge,
  Button,
  Card,
  Dropdown,
} from "@/components/ui";
import type { BadgeTone, DropdownItem } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { SplitGroupDetail } from "@/lib/groups/types";
import { formatMinorUnits } from "@/lib/money";
import type { GroupType } from "@/types/database";

const GROUP_TYPE_BADGE: Record<
  GroupType,
  { label: string; tone: BadgeTone }
> = {
  RESIDENTIAL: { label: "Primary Residence", tone: "info" },
  TRIP: { label: "Seasonal Trip", tone: "warning" },
  RECURRING: { label: "Recurring Flat", tone: "neutral" },
};

export interface SplitGroupCardProps {
  group: SplitGroupDetail;
  isSelected: boolean;
  onManageGroup: (groupId: string) => void;
  onQuickSplit: (groupId: string) => void;
  onCopyInviteLink: (group: SplitGroupDetail) => void;
}

export function SplitGroupCard({
  group,
  isSelected,
  onManageGroup,
  onQuickSplit,
  onCopyInviteLink,
}: SplitGroupCardProps) {
  const typeMeta = GROUP_TYPE_BADGE[group.groupType];
  const activeMembers = React.useMemo(
    () => group.members.filter((m) => m.status === "ACTIVE"),
    [group.members],
  );

  const netLedger = group.userNetLedgerCents;
  const formattedTurnover = formatMinorUnits(
    group.cycleTurnoverCents,
    group.baseCurrency,
  );
  const formattedNetLedger = formatMinorUnits(netLedger, group.baseCurrency, {
    showPlus: true,
  });

  const menuItems = React.useMemo<DropdownItem[]>(
    () => [
      {
        id: "manage-group",
        label: "Manage Group",
        icon: <Layers className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => onManageGroup(group.id),
      },
      {
        id: "quick-split",
        label: "Quick Split",
        icon: <Zap className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => onQuickSplit(group.id),
      },
      { id: "divider", separator: true },
      {
        id: "copy-invite",
        label: "Copy Invite Link",
        icon: <Copy className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => onCopyInviteLink(group),
      },
    ],
    [group, onCopyInviteLink, onManageGroup, onQuickSplit],
  );

  const memberCountLabel = `${activeMembers.length} ${
    activeMembers.length === 1 ? "member" : "members"
  } active`;

  return (
    <Card
      variant="section"
      padding="md"
      data-testid={`group-card-${group.id}`}
      data-selected={isSelected ? "true" : "false"}
      className={cn(
        "flex flex-col justify-between transition-colors",
        isSelected
          ? "border-primary ring-1 ring-primary/20"
          : "hover:border-ink-muted-48/50",
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              tone={typeMeta.tone}
              size="sm"
              dot
              data-group-type={group.groupType}
              aria-label={`Group type: ${typeMeta.label} (${group.groupType})`}
              className="uppercase tracking-wide"
            >
              {typeMeta.label}
            </Badge>
            {group.status === "NEEDS_RATIO_UPDATE" && (
              <Badge tone="warning" size="sm">
                Ratio Update Needed
              </Badge>
            )}
          </div>
          <Dropdown
            variant="action-menu"
            triggerAriaLabel={`Actions for ${group.name}`}
            items={menuItems}
          />
        </div>

        <div>
          <h2 className="font-display text-[20px] font-semibold tracking-tight text-ink">
            {group.name}
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted-48">
            {group.defaultSplitMode === "EQUAL" ? "Equal Split" : "Custom Ratios"} ·{" "}
            {group.baseCurrency} · Cycle day {group.billingCycleAnchorDay}
            {group.operationalBudgetCents !== null
              ? ` · Budget ${formatMinorUnits(
                  group.operationalBudgetCents,
                  group.baseCurrency,
                )}`
              : ""}
          </p>
        </div>

        <div className="flex items-center gap-2.5 py-0.5">
          <AvatarStack
            members={activeMembers.map((m) => ({
              id: m.userId,
              name: m.name,
            }))}
            max={3}
            size="md"
          />
          <span className="text-[12px] text-ink-muted-48">{memberCountLabel}</span>
        </div>

        <Card variant="sub-card" padding="sm" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] text-ink-muted-48">Cycle Turnover</span>
            <span className="text-[14px] font-semibold tabular-nums text-ink">
              {formattedTurnover}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 border-t border-hairline pt-2">
            <span className="text-[12px] text-ink-muted-48">Your Net Ledger</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[15px] font-semibold tabular-nums",
                netLedger > 0
                  ? "text-emerald-700"
                  : netLedger < 0
                    ? "text-red-600"
                    : "text-ink-muted-48",
              )}
            >
              {netLedger > 0 ? (
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              ) : netLedger < 0 ? (
                <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}
              {formattedNetLedger}
            </span>
          </div>
          <span
            className={cn(
              "text-right text-[11px] font-medium",
              netLedger > 0
                ? "text-emerald-700"
                : netLedger < 0
                  ? "text-red-600"
                  : "text-ink-muted-48",
            )}
          >
            {netLedger > 0
              ? "Settlement surplus owed to you"
              : netLedger < 0
                ? "Outstanding liability"
                : "Zero balance · Fully settled"}
          </span>
        </Card>
      </div>

      <div className="flex items-center gap-2.5 pt-5">
        <Button
          type="button"
          variant={isSelected ? "primary" : "secondary"}
          size="sm"
          fullWidth
          rightIcon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
          aria-pressed={isSelected}
          aria-label={`Manage Group ${group.name}`}
          onClick={() => onManageGroup(group.id)}
        >
          Manage Group
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Quick Split for ${group.name}`}
          onClick={() => onQuickSplit(group.id)}
        >
          Quick Split
        </Button>
      </div>
    </Card>
  );
}
