"use client";

import * as React from "react";
import { Paperclip, Plus, ReceiptText } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  SearchInput,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import type { SelectOption } from "@/components/ui";
import { LiveSyncPill, useActiveGroup } from "@/components/shell";
import { ALL_GROUPS_VALUE, formatCycleLabel } from "@/components/shell/url-state";
import { getBillingCycleWindow } from "@/lib/groups/service";
import { formatMinorUnits } from "@/lib/money";
import type { ExpenseSplitMethod, SplitBreakdownItem } from "@/types/database";

export interface DashboardExpenseItem {
  id: string;
  groupId: string;
  groupName: string;
  groupBaseCurrency: string;
  groupBillingAnchorDay: number;
  paidBy: string;
  payerName: string;
  description: string;
  category: string;
  expenseDate: string;
  amountCents: number;
  currency: string;
  originalAmountCents: number | null;
  originalCurrency: string | null;
  splitMethod: ExpenseSplitMethod;
  splitBreakdown: SplitBreakdownItem[];
  receiptUrl?: string | null;
}

export interface DashboardClientProps {
  initialExpenses: DashboardExpenseItem[];
  currentUserId: string;
}

const SPLIT_METHOD_LABEL: Record<ExpenseSplitMethod, string> = {
  EQUAL: "Split Evenly",
  PERCENTAGE: "By Percentage",
  EXACT: "Exact Amounts",
};

function formatExpenseDateShort(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function DashboardClient({
  initialExpenses,
  currentUserId,
}: DashboardClientProps) {
  const {
    groups,
    activeGroupId,
    activeGroup,
    cycle,
    setActiveGroup,
    openAddExpense,
  } = useActiveGroup();

  const [searchQuery, setSearchQuery] = React.useState("");

  const groupFilterOptions = React.useMemo<SelectOption[]>(
    () => [
      { value: ALL_GROUPS_VALUE, label: "All Groups" },
      ...groups.map((g) => ({
        value: g.id,
        label: g.name,
      })),
    ],
    [groups],
  );

  const visibleExpenses = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return initialExpenses.filter((exp) => {
      if (activeGroupId !== ALL_GROUPS_VALUE && exp.groupId !== activeGroupId) {
        return false;
      }

      const { startMs, endMs } = getBillingCycleWindow(
        cycle,
        exp.groupBillingAnchorDay || 1,
      );
      const expMs = Date.parse(exp.expenseDate);
      if (!Number.isFinite(expMs) || expMs < startMs || expMs >= endMs) {
        return false;
      }

      if (q) {
        const matchesDesc = exp.description.toLowerCase().includes(q);
        const matchesCat = exp.category.toLowerCase().includes(q);
        const matchesGroup = exp.groupName.toLowerCase().includes(q);
        if (!matchesDesc && !matchesCat && !matchesGroup) {
          return false;
        }
      }

      return true;
    });
  }, [activeGroupId, cycle, initialExpenses, searchQuery]);

  const cycleLabel = formatCycleLabel(cycle);

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Page Header */}
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
              Dashboard Overview
            </h1>
            <LiveSyncPill />
          </div>
          <p className="text-[14px] text-ink-muted-48">
            {activeGroup
              ? `${activeGroup.name} · ${cycleLabel}`
              : `All active groups · ${cycleLabel}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Select
            aria-label="Filter dashboard by group"
            variant="pill-select"
            options={groupFilterOptions}
            value={activeGroupId}
            onChange={setActiveGroup}
            className="h-9 bg-canvas text-[13px] font-medium"
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            onClick={openAddExpense}
          >
            Quick Add
          </Button>
        </div>
      </section>

      {/* Recent Shared Transactions */}
      <Card variant="section" padding="md" className="flex flex-col gap-4">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas-parchment text-[#0066cc]">
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                Recent Shared Transactions
              </h2>
              <p className="text-[12px] text-ink-muted-48">
                Itemized expenses logged for {cycleLabel}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <SearchInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClear={() => setSearchQuery("")}
              placeholder="Filter by merchant..."
              containerClassName="w-full sm:w-56"
              className="text-[13px]"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-[14px] border border-hairline">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description &amp; Group</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Paid By</TableHead>
                <TableHead>Split</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleExpenses.length === 0 ? (
                <TableEmpty
                  colSpan={6}
                  title="No shared transactions in this period"
                  description={
                    groups.length === 0
                      ? "Create a split group first, then use Quick Add to log shared expenses."
                      : `No expenses logged for ${cycleLabel}. Use Quick Add to record your first split.`
                  }
                  action={
                    groups.length > 0 ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                        onClick={openAddExpense}
                      >
                        Quick Add
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                visibleExpenses.map((exp) => {
                  const myShare = exp.splitBreakdown.find(
                    (b) => b.user_id === currentUserId,
                  );

                  return (
                    <TableRow key={exp.id}>
                      <TableCell className="whitespace-nowrap text-[12px] text-ink-muted-80">
                        {formatExpenseDateShort(exp.expenseDate)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-ink">
                              {exp.description}
                            </span>
                            {exp.receiptUrl && (
                              <a
                                href={`/api/receipts?path=${encodeURIComponent(exp.receiptUrl)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`View receipt for ${exp.description}`}
                                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-muted-48 transition-colors hover:bg-canvas-parchment hover:text-[#0066cc] focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
                              >
                                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                              </a>
                            )}
                          </div>
                          <span className="text-[11px] text-ink-muted-48">
                            {exp.groupName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge tone="neutral" size="sm">
                          {exp.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Avatar name={exp.payerName} size="sm" />
                          <span className="text-[12px] font-medium text-ink">
                            {exp.paidBy === currentUserId
                              ? "You"
                              : exp.payerName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[12px] text-ink-muted-80">
                        <div className="flex flex-col">
                          <span>{SPLIT_METHOD_LABEL[exp.splitMethod]}</span>
                          {myShare && (
                            <span className="text-[11px] text-[#0066cc] tabular-nums">
                              Your share:{" "}
                              {formatMinorUnits(
                                myShare.share_cents,
                                exp.currency,
                              )}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-[13px] font-semibold tabular-nums text-ink">
                            {formatMinorUnits(exp.amountCents, exp.currency)}
                          </span>
                          {exp.originalAmountCents !== null &&
                            exp.originalCurrency && (
                              <span className="text-[11px] tabular-nums text-ink-muted-48">
                                Orig:{" "}
                                {formatMinorUnits(
                                  exp.originalAmountCents,
                                  exp.originalCurrency,
                                )}
                              </span>
                            )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
