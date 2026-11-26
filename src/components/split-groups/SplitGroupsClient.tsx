"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Link2,
  Plus,
  ReceiptText,
  RefreshCw,
  Repeat,
  Share2,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  ProgressBar,
  ToastContainer,
} from "@/components/ui";
import type { ToastItem } from "@/components/ui";
import { useActiveGroup } from "@/components/shell/ActiveGroupContext";
import type { ShellGroupSummary } from "@/components/shell/types";
import { formatCycleLabel } from "@/components/shell/url-state";
import { cn } from "@/lib/cn";
import type {
  SplitGroupDetail,
  SplitGroupsPageData,
} from "@/lib/groups/types";
import { formatMinorUnits } from "@/lib/money";
import { CreateGroupModal } from "./CreateGroupModal";
import { SplitGroupCard } from "./SplitGroupCard";

export interface SplitGroupsClientProps {
  initialData: SplitGroupsPageData;
  defaultCurrency?: string;
}

function buildInvitePath(group: SplitGroupDetail): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://ledgersplit.app";
  return `${origin}/join/${group.slug}?token=${encodeURIComponent(group.inviteToken)}`;
}

export function SplitGroupsClient({
  initialData,
  defaultCurrency = "USD",
}: SplitGroupsClientProps) {
  const router = useRouter();
  const {
    activeGroupId,
    cycle,
    setActiveGroup,
    upsertGroup,
    openAddExpense,
  } = useActiveGroup();

  const [createdGroups, setCreatedGroups] = React.useState<SplitGroupDetail[]>(
    [],
  );
  const [createModalOpen, setCreateModalOpen] = React.useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = React.useState(false);
  const [archivedExpanded, setArchivedExpanded] = React.useState(false);
  const [copiedGroupId, setCopiedGroupId] = React.useState<string | null>(null);
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const toastCounterRef = React.useRef(0);

  const activeGroups = React.useMemo(() => {
    const incomingIds = new Set(initialData.activeGroups.map((g) => g.id));
    const pendingLocal = createdGroups.filter((g) => !incomingIds.has(g.id));
    return [...initialData.activeGroups, ...pendingLocal];
  }, [createdGroups, initialData.activeGroups]);

  const pushToast = React.useCallback((toast: Omit<ToastItem, "id">) => {
    toastCounterRef.current += 1;
    const id = `sg-toast-${toastCounterRef.current}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const selectedGroup = React.useMemo(() => {
    if (activeGroups.length === 0) return null;
    if (activeGroupId && activeGroupId !== "all") {
      const matched = activeGroups.find((g) => g.id === activeGroupId);
      if (matched) return matched;
    }
    return activeGroups[0];
  }, [activeGroupId, activeGroups]);

  const handleManageGroup = React.useCallback(
    (groupId: string) => {
      setActiveGroup(groupId);
    },
    [setActiveGroup],
  );

  const handleQuickSplit = React.useCallback(
    (groupId: string) => {
      setActiveGroup(groupId);
      openAddExpense();
    },
    [openAddExpense, setActiveGroup],
  );

  const handleCopyInviteLink = React.useCallback(
    async (group: SplitGroupDetail) => {
      const link = buildInvitePath(group);
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(link);
        }
        setCopiedGroupId(group.id);
        pushToast({
          tone: "success",
          title: "Invite link copied",
          description: `Copied invitation URL for ${group.name}.`,
        });
        window.setTimeout(() => {
          setCopiedGroupId((curr) => (curr === group.id ? null : curr));
        }, 2000);
      } catch {
        pushToast({
          tone: "info",
          title: "Invite link ready",
          description: "Select and copy the invitation link manually.",
        });
      }
    },
    [pushToast],
  );

  const handleGroupCreated = React.useCallback(
    ({
      group,
      shellGroup,
    }: {
      group: SplitGroupDetail;
      shellGroup: ShellGroupSummary;
    }) => {
      setCreatedGroups((prev) => {
        if (prev.some((item) => item.id === group.id)) {
          return prev;
        }
        return [...prev, group];
      });
      upsertGroup(shellGroup, { activate: true });
      pushToast({
        tone: "success",
        title: "Split group created",
        description: `${group.name} is now your active group.`,
      });
      router.refresh();
    },
    [pushToast, router, upsertGroup],
  );

  const cycleLabel = formatCycleLabel(cycle);

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Page Header */}
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex max-w-2xl flex-col gap-1">
          <div className="mb-0.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
            <span className="text-[#0066cc]">Expense Architecture</span>
            <span aria-hidden="true">·</span>
            <span>Active Ledgers ({activeGroups.length})</span>
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Split Groups
          </h1>
          <p className="text-[14px] leading-relaxed text-ink-muted-48">
            Manage shared living spaces, trips, and recurring multi-party
            balances with isolated per-group ledgers.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="secondary"
            size="md"
            leftIcon={<SlidersHorizontal className="h-4 w-4 text-ink-muted-48" />}
            onClick={() => setArchiveModalOpen(true)}
          >
            Archive Rules
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setCreateModalOpen(true)}
          >
            Create New Group
          </Button>
        </div>
      </section>

      {/* Error State */}
      {initialData.loadError && (
        <AlertBanner
          tone="error"
          title="Could not load split groups"
          description={initialData.loadError}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => router.refresh()}
            >
              Retry
            </Button>
          }
        />
      )}

      {/* Empty State */}
      {!initialData.loadError && activeGroups.length === 0 && (
        <Card
          variant="section"
          padding="lg"
          className="flex flex-col items-center justify-center gap-4 py-14 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-canvas-parchment text-[#0066cc]">
            <Users className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="max-w-md space-y-1">
            <h2 className="font-display text-[19px] font-semibold text-ink">
              No active split groups yet
            </h2>
            <p className="text-[14px] leading-relaxed text-ink-muted-48">
              Create your first group to track shared expenses, assign split
              ratios, and keep balances isolated per household or trip.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="md"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setCreateModalOpen(true)}
          >
            Create New Group
          </Button>
        </Card>
      )}

      {/* Active Groups 3-Column Grid */}
      {activeGroups.length > 0 && (
        <section
          aria-label="Active split groups"
          className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3"
        >
          {activeGroups.map((group) => (
            <SplitGroupCard
              key={group.id}
              group={group}
              isSelected={selectedGroup?.id === group.id}
              onManageGroup={handleManageGroup}
              onQuickSplit={handleQuickSplit}
              onCopyInviteLink={handleCopyInviteLink}
            />
          ))}
        </section>
      )}

      {/* Spotlight Partition Panel */}
      {selectedGroup && (
        <Card
          variant="spotlight"
          padding="lg"
          data-testid="spotlight-partition"
          className="flex flex-col gap-6"
        >
          {selectedGroup.status === "NEEDS_RATIO_UPDATE" && (
            <AlertBanner
              tone="warning"
              title="Custom split ratios need review"
              description="A new member joined in CUSTOM_RATIOS mode with a 0% default share. Review member allocations so active percentages sum to 100%."
            />
          )}

          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#0066cc]">
                  Spotlight Partition
                </span>
                <Badge tone="neutral" size="sm">
                  {selectedGroup.defaultSplitMode === "EQUAL"
                    ? "Equal Split"
                    : "Custom Ratios"}
                </Badge>
              </div>
              <h2 className="font-display text-[21px] font-semibold tracking-tight text-ink">
                {selectedGroup.name} · Split Rules &amp; Ratios
              </h2>
              <p className="text-[13px] text-ink-muted-48">
                Member contributions for {cycleLabel} and cumulative unsettled
                balances in {selectedGroup.baseCurrency}.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleQuickSplit(selectedGroup.id)}
              >
                Log Expense
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  router.push(
                    `/expenses?group=${encodeURIComponent(selectedGroup.id)}&cycle=${encodeURIComponent(cycle)}`,
                  )
                }
              >
                View Ledger
              </Button>
            </div>
          </div>

          {/* Per-Member Allocation Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {selectedGroup.members.map((member) => {
              const periodSharePercent =
                selectedGroup.cycleTurnoverCents > 0
                  ? Math.min(
                      100,
                      Math.round(
                        (member.paidThisPeriodCents /
                          selectedGroup.cycleTurnoverCents) *
                          100,
                      ),
                    )
                  : 0;

              const roleText = [
                member.isCurrentUser ? "You" : null,
                member.status === "FORMER_MEMBER"
                  ? "Former Member"
                  : member.role === "ADMIN"
                    ? "Admin"
                    : "Member",
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <Card
                  key={member.userId}
                  variant="sub-card"
                  padding="sm"
                  className="flex flex-col justify-between gap-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={member.name} size="md" />
                      <div className="min-w-0">
                        <h3 className="truncate text-[14px] font-semibold text-ink">
                          {member.name}
                        </h3>
                        <p className="truncate text-[11px] font-medium text-[#0066cc]">
                          {roleText}
                        </p>
                      </div>
                    </div>
                    <Badge tone="neutral" size="sm">
                      {member.sharePercentage}%
                    </Badge>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12px] text-ink-muted-48">
                      Paid This Period
                    </span>
                    <span className="text-[20px] font-semibold tracking-tight tabular-nums text-ink">
                      {formatMinorUnits(
                        member.paidThisPeriodCents,
                        selectedGroup.baseCurrency,
                      )}
                    </span>
                    <ProgressBar
                      value={periodSharePercent}
                      max={100}
                      label={`${member.name} share of period spend`}
                      size="sm"
                      tone="primary"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-hairline pt-2.5 text-[12px]">
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        member.netBalanceCents > 0
                          ? "text-emerald-700"
                          : member.netBalanceCents < 0
                            ? "text-red-600"
                            : "text-ink-muted-48",
                      )}
                    >
                      {member.netBalanceCents > 0
                        ? `Owed ${formatMinorUnits(
                            member.netBalanceCents,
                            selectedGroup.baseCurrency,
                            { showPlus: true },
                          )}`
                        : member.netBalanceCents < 0
                          ? `Due ${formatMinorUnits(
                              member.netBalanceCents,
                              selectedGroup.baseCurrency,
                            )}`
                          : "Settled"}
                    </span>
                    {member.status === "FORMER_MEMBER" && (
                      <Badge tone="warning" size="sm">
                        Former
                      </Badge>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Group Configuration & Member Invitation Gateway */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <Card
              variant="sub-card"
              padding="md"
              className="flex flex-col justify-between gap-4 lg:col-span-6"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#0066cc]">
                    Cycle &amp; Budget Policy
                  </span>
                  <h3 className="text-[16px] font-semibold text-ink">
                    {selectedGroup.operationalBudgetCents !== null
                      ? `${formatMinorUnits(
                          selectedGroup.operationalBudgetCents,
                          selectedGroup.baseCurrency,
                        )} Monthly Target`
                      : "No Monthly Budget Cap"}
                  </h3>
                  <p className="text-[12px] text-ink-muted-48">
                    Base currency {selectedGroup.baseCurrency} · Anchored on day{" "}
                    {selectedGroup.billingCycleAnchorDay} of each month
                  </p>
                </div>
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas text-ink-muted-48">
                  <Calendar className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3 text-[12px] text-ink-muted-48">
                <span>
                  {selectedGroup.leaseEndDate
                    ? `Lease ends ${selectedGroup.leaseEndDate}`
                    : "No lease end date configured"}
                </span>
                <span className="font-medium text-ink-muted-80">
                  {selectedGroup.simplifyDebts
                    ? "Debt simplification on"
                    : "Direct peer balances"}
                </span>
              </div>
            </Card>

            <Card
              variant="sub-card"
              padding="md"
              className="flex flex-col justify-between gap-3 lg:col-span-6"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold uppercase tracking-wider text-ink">
                    Member Invitation Gateway
                  </span>
                  <Share2
                    className="h-4 w-4 text-[#0066cc]"
                    aria-hidden="true"
                  />
                </div>
                <p className="text-[12px] leading-relaxed text-ink-muted-48">
                  Members joining via this signed link are onboarded into{" "}
                  {selectedGroup.name} using{" "}
                  {selectedGroup.defaultSplitMode === "EQUAL"
                    ? "equal split shares"
                    : "custom split ratios"}
                  .
                </p>
              </div>

              <div className="flex items-center gap-2 rounded-pill border border-hairline bg-canvas px-3 py-1.5">
                <Link2
                  className="h-4 w-4 shrink-0 text-ink-muted-48"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  readOnly
                  aria-label="Group invite link"
                  value={buildInvitePath(selectedGroup)}
                  className="w-full min-w-0 bg-transparent font-mono text-[12px] text-ink focus:outline-none"
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => void handleCopyInviteLink(selectedGroup)}
                  leftIcon={
                    copiedGroupId === selectedGroup.id ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )
                  }
                >
                  {copiedGroupId === selectedGroup.id ? "Copied" : "Copy"}
                </Button>
              </div>

              <div className="flex items-center justify-between border-t border-hairline pt-2 text-[11px] text-ink-muted-48">
                <span>Slug: {selectedGroup.slug}</span>
                <span>
                  {selectedGroup.currentUserRole === "ADMIN"
                    ? "Admin access"
                    : "Member view"}
                </span>
              </div>
            </Card>
          </div>
        </Card>
      )}

      {/* 3-Column Summary Strip */}
      {selectedGroup && (
        <section
          aria-label="Selected group activity summary"
          className="grid grid-cols-1 gap-6 md:grid-cols-3"
        >
          <Card variant="kpi" padding="md" className="flex items-center gap-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#0066cc]/20 bg-[#0066cc]/10 text-[#0066cc]">
              <ReceiptText className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="flex flex-col">
              <span className="text-[12px] text-ink-muted-48">
                Monthly Logged Vouchers
              </span>
              <span className="text-[18px] font-semibold tracking-tight text-ink">
                {selectedGroup.cycleTransactionCount}{" "}
                {selectedGroup.cycleTransactionCount === 1
                  ? "Transaction"
                  : "Transactions"}
              </span>
            </div>
          </Card>

          <Card variant="kpi" padding="md" className="flex items-center gap-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
              <Repeat className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="flex flex-col">
              <span className="text-[12px] text-ink-muted-48">
                Recurring Rules
              </span>
              <span className="text-[18px] font-semibold tracking-tight text-ink">
                {selectedGroup.recurringRuleCount} Active
              </span>
            </div>
          </Card>

          <Card variant="kpi" padding="md" className="flex items-center gap-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="flex flex-col">
              <span className="text-[12px] text-ink-muted-48">
                Ledger Consensus
              </span>
              <span className="text-[18px] font-semibold tracking-tight text-ink">
                {selectedGroup.isFullySettled ? "Fully Settled" : "Open Balances"}
              </span>
            </div>
          </Card>
        </section>
      )}

      {/* Collapsible Archived Ledgers */}
      {initialData.archivedGroups.length > 0 && (
        <section aria-label="Archived ledgers" className="flex flex-col gap-3">
          <button
            type="button"
            aria-expanded={archivedExpanded}
            onClick={() => setArchivedExpanded((prev) => !prev)}
            className="flex w-fit items-center gap-2 rounded-pill border border-hairline bg-canvas px-4 py-2 text-[13px] font-medium text-ink-muted-80 transition-colors hover:bg-surface-pearl focus-visible:outline-2 focus-visible:outline-primary-focus"
          >
            <Archive className="h-4 w-4 text-ink-muted-48" aria-hidden="true" />
            <span>
              Archived Ledgers ({initialData.archivedGroups.length})
            </span>
            {archivedExpanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>

          {archivedExpanded && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {initialData.archivedGroups.map((archived) => (
                <Card
                  key={archived.id}
                  variant="sub-card"
                  padding="md"
                  className="flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold text-ink">
                      {archived.name}
                    </span>
                    <Badge tone="neutral" size="sm">
                      ARCHIVED
                    </Badge>
                  </div>
                  <p className="text-[12px] text-ink-muted-48">
                    Read-only · {archived.baseCurrency} ·{" "}
                    {archived.members.length} members
                  </p>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      <CreateGroupModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        defaultCurrency={defaultCurrency}
        onCreated={handleGroupCreated}
      />

      <Dialog
        open={archiveModalOpen}
        onClose={() => setArchiveModalOpen(false)}
        title="Group Archive Rules"
        description="Automated lifecycle policies that transition completed groups to read-only archived state."
        size="sm"
        footer={
          <Button
            type="button"
            variant="primary"
            onClick={() => setArchiveModalOpen(false)}
          >
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-4 text-[13px] leading-relaxed text-ink-muted-80">
          <Card variant="sub-card" padding="sm" className="space-y-1">
            <p className="font-semibold text-ink">Seasonal Trip Auto-Archive</p>
            <p className="text-ink-muted-48">
              Trip groups automatically transition to ARCHIVED after all
              pairwise balances remain zero for 14 consecutive days.
            </p>
          </Card>
          <Card variant="sub-card" padding="sm" className="space-y-1">
            <p className="font-semibold text-ink">
              Residential Lease Expiration Prompt
            </p>
            <p className="text-ink-muted-48">
              Residential groups prompt the group Admin to archive 7 days after
              the configured lease end date.
              {selectedGroup?.leaseEndDate
                ? ` Current selected group lease ends ${selectedGroup.leaseEndDate}.`
                : ""}
            </p>
          </Card>
        </div>
      </Dialog>

      {toasts.length > 0 && (
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      )}
    </div>
  );
}
