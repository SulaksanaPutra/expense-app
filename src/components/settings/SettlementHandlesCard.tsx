"use client";

import * as React from "react";
import {
  CheckCircle2,
  DollarSign,
  Pencil,
  Plus,
  Send,
  Trash2,
  Zap,
} from "lucide-react";
import { Badge, Button, Card, Dropdown } from "@/components/ui";
import type { DropdownItem } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  PROVIDER_LABELS,
  type SettlementHandleItem,
} from "@/lib/settings/settlement-handles";
import type { SettlementHandleProvider } from "@/types/database";

export interface SettlementHandlesCardProps {
  handles: SettlementHandleItem[];
  busyHandleId?: string | null;
  onAddHandle: () => void;
  onEditHandle: (handle: SettlementHandleItem) => void;
  onSetDefault: (handle: SettlementHandleItem) => void;
  onDeleteHandle: (handle: SettlementHandleItem) => void;
}

const PROVIDER_ICON_STYLE: Record<
  SettlementHandleProvider,
  { container: string; icon: React.ReactNode; handleClassName: string }
> = {
  VENMO: {
    container: "bg-[#e6f0fa] text-[#0066cc]",
    icon: <Send className="h-5 w-5" aria-hidden="true" />,
    handleClassName: "font-mono",
  },
  ZELLE: {
    container: "bg-[#f3e8ff] text-[#6d28d9]",
    icon: <Zap className="h-5 w-5" aria-hidden="true" />,
    handleClassName: "tabular-nums",
  },
  CASH_APP: {
    container: "bg-[#edfbf2] text-[#166534]",
    icon: <DollarSign className="h-5 w-5" aria-hidden="true" />,
    handleClassName: "font-mono",
  },
};

export function SettlementHandlesCard({
  handles,
  busyHandleId = null,
  onAddHandle,
  onEditHandle,
  onSetDefault,
  onDeleteHandle,
}: SettlementHandlesCardProps) {
  return (
    <Card
      variant="section"
      padding="md"
      className="space-y-4"
      data-testid="settlement-handles-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[17px] font-semibold tracking-[-0.015em] text-on-surface">
          Settlement Handles
        </h2>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={<Plus className="h-3.5 w-3.5" />}
          onClick={onAddHandle}
        >
          Add Handle
        </Button>
      </div>

      <p className="text-[12px] leading-relaxed text-outline">
        Shown to peers on Settle Up links. LedgerSplit never stores card numbers
        or processes payouts.
      </p>

      {handles.length === 0 ? (
        <Card
          variant="sub-card"
          padding="sm"
          className="flex flex-col items-start gap-3 rounded-[14px]"
        >
          <p className="text-[13px] text-on-surface-variant">
            No settlement handles configured yet. Add Venmo, Zelle, or Cash App
            so peers can settle up easily.
          </p>
        </Card>
      ) : (
        <div className="space-y-3 pt-1">
          {handles.map((item) => {
            const style = PROVIDER_ICON_STYLE[item.provider];
            const providerLabel = PROVIDER_LABELS[item.provider];
            const isRowBusy = busyHandleId === item.id;

            const menuItems: DropdownItem[] = [
              {
                id: "set-default",
                label: "Set as Default",
                icon: <CheckCircle2 className="h-3.5 w-3.5 text-outline" />,
                disabled: item.isDefault || isRowBusy,
                onSelect: () => onSetDefault(item),
              },
              {
                id: "edit",
                label: "Edit Handle",
                icon: <Pencil className="h-3.5 w-3.5 text-outline" />,
                disabled: isRowBusy,
                onSelect: () => onEditHandle(item),
              },
              {
                id: "divider",
                separator: true,
              },
              {
                id: "delete",
                label: "Delete",
                icon: <Trash2 className="h-3.5 w-3.5 text-danger" />,
                danger: true,
                disabled: isRowBusy,
                onSelect: () => onDeleteHandle(item),
              },
            ];

            return (
              <div
                key={item.id}
                data-testid={`settlement-handle-row-${item.id}`}
                data-default={item.isDefault ? "true" : "false"}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-[14px] border p-4 transition-colors",
                  item.isDefault
                    ? "border-[#d0e5fc] bg-[#f0f7ff]"
                    : "border-hairline bg-surface-pearl",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                      style.container,
                    )}
                  >
                    {style.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-on-surface">
                        {providerLabel}
                      </span>
                      {item.isDefault && (
                        <Badge tone="success" size="sm">
                          Default
                        </Badge>
                      )}
                    </div>
                    <p
                      className={cn(
                        "mt-0.5 truncate text-[13px] text-on-surface-variant",
                        style.handleClassName,
                      )}
                    >
                      {item.handle}
                    </p>
                    {item.displayNote && (
                      <p className="mt-0.5 truncate text-[11px] text-outline">
                        {item.displayNote}
                      </p>
                    )}
                  </div>
                </div>

                <Dropdown
                  items={menuItems}
                  variant="action-menu"
                  align="right"
                  disabled={isRowBusy}
                  triggerAriaLabel={`Actions for ${providerLabel} ${item.handle}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
