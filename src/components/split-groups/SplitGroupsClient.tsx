"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  History,
  Home,
  Link2,
  LogOut,
  Plus,
  ReceiptText,
  RefreshCw,
  Repeat,
  Share2,
  SlidersHorizontal,
  UserMinus,
  Users,
} from "lucide-react";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ProgressBar,
  ToastContainer,
} from "@/components/ui";
import type { ToastItem } from "@/components/ui";
import { useActiveGroup } from "@/components/shell/ActiveGroupContext";
import type { ShellGroupSummary } from "@/components/shell/types";
import { formatCycleLabel } from "@/components/shell/url-state";
import { cn } from "@/lib/cn";
import type { GroupAuditLogEntry } from "@/lib/groups/audit-log";
import { buildInviteJoinUrl } from "@/lib/groups/invite-utils";
import type {
  SplitGroupDetail,
  SplitGroupMemberDetail,
  SplitGroupsPageData,
} from "@/lib/groups/types";
import { formatMinorUnits } from "@/lib/money";
import type { GroupStatus, MemberStatus, SplitMode } from "@/types/database";
import {
  ArchiveRulesModal,
  type ArchiveRulesSavedPayload,
} from "./ArchiveRulesModal";
import { AuditLogDrawer } from "./AuditLogDrawer";
import { CreateGroupModal } from "./CreateGroupModal";
import { EditRatiosModal } from "./EditRatiosModal";
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
  return buildInviteJoinUrl(group.slug, group.inviteToken, origin);
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
  const [departedGroupIds, setDepartedGroupIds] = React.useState<string[]>([]);
  const [groupOverrides, setGroupOverrides] = React.useState<
    Record<string, Partial<SplitGroupDetail>>
  >({});
  const [createModalOpen, setCreateModalOpen] = React.useState(false);
  const [editRatiosModalOpen, setEditRatiosModalOpen] = React.useState(false);
  const [auditDrawerOpen, setAuditDrawerOpen] = React.useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = React.useState(false);
  const [archivedExpanded, setArchivedExpanded] = React.useState(false);
  const [inspectedArchivedId, setInspectedArchivedId] = React.useState<
    string | null
  >(null);
  const [leaveTargetGroup, setLeaveTargetGroup] =
    React.useState<SplitGroupDetail | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<{
    group: SplitGroupDetail;
    member: SplitGroupMemberDetail;
  } | null>(null);
  const [archivePromptTarget, setArchivePromptTarget] =
    React.useState<SplitGroupDetail | null>(null);
  const [dismissedLeasePromptIds, setDismissedLeasePromptIds] = React.useState<
    string[]
  >([]);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [copiedGroupId, setCopiedGroupId] = React.useState<string | null>(null);
  const [copyStatusText, setCopyStatusText] = React.useState("");
  const [regeneratingGroupId, setRegeneratingGroupId] = React.useState<
    string | null
  >(null);
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const toastCounterRef = React.useRef(0);
  const copyTimerRef = React.useRef<number | null>(null);

  const allGroups = React.useMemo(() => {
    const departedSet = new Set(departedGroupIds);
    const baseCombined = [
      ...initialData.activeGroups,
      ...initialData.archivedGroups,
    ];
    const incomingIds = new Set(baseCombined.map((g) => g.id));
    const pendingLocal = createdGroups.filter((g) => !incomingIds.has(g.id));
    return [...baseCombined, ...pendingLocal]
      .filter((g) => !departedSet.has(g.id))
      .map((group) => {
        const override = groupOverrides[group.id];
        return override ? { ...group, ...override } : group;
      });
  }, [
    createdGroups,
    departedGroupIds,
    groupOverrides,
    initialData.activeGroups,
    initialData.archivedGroups,
  ]);

  const activeGroups = React.useMemo(
    () => allGroups.filter((g) => g.status !== "ARCHIVED"),
    [allGroups],
  );

  const archivedGroups = React.useMemo(
    () => allGroups.filter((g) => g.status === "ARCHIVED"),
    [allGroups],
  );

  const leasePromptGroups = React.useMemo(() => {
    const dismissedSet = new Set(dismissedLeasePromptIds);
    return activeGroups.filter(
      (g) => g.shouldPromptLeaseArchive && !dismissedSet.has(g.id),
    );
  }, [activeGroups, dismissedLeasePromptIds]);

  const pushToast = React.useCallback((toast: Omit<ToastItem, "id">) => {
    toastCounterRef.current += 1;
    const id = `sg-toast-${toastCounterRef.current}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const selectedGroup = React.useMemo(() => {
    if (inspectedArchivedId) {
      const archivedMatch = archivedGroups.find(
        (g) => g.id === inspectedArchivedId,
      );
      if (archivedMatch) return archivedMatch;
    }
    if (activeGroups.length === 0) {
      return archivedGroups[0] ?? null;
    }
    if (activeGroupId && activeGroupId !== "all") {
      const matched = activeGroups.find((g) => g.id === activeGroupId);
      if (matched) return matched;
    }
    return activeGroups[0];
  }, [activeGroupId, activeGroups, archivedGroups, inspectedArchivedId]);

  const handleManageGroup = React.useCallback(
    (groupId: string) => {
      setInspectedArchivedId(null);
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
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }

      try {
        if (!navigator?.clipboard?.writeText) {
          throw new Error("Clipboard API unavailable");
        }
        await navigator.clipboard.writeText(link);
        setCopiedGroupId(group.id);
        setCopyStatusText("Copied");
        pushToast({
          tone: "success",
          title: "Invite link copied",
          description: `Copied invitation URL for ${group.name}.`,
        });
        copyTimerRef.current = window.setTimeout(() => {
          setCopiedGroupId((curr) => (curr === group.id ? null : curr));
          setCopyStatusText("");
        }, 2000);
      } catch {
        setCopiedGroupId(null);
        setCopyStatusText("Copy failed");
        pushToast({
          tone: "info",
          title: "Copy failed",
          description: "Select and copy the invitation link manually.",
        });
        copyTimerRef.current = window.setTimeout(() => {
          setCopyStatusText("");
        }, 2000);
      }
    },
    [pushToast],
  );

  const handleRegenerateInviteLink = React.useCallback(
    async (group: SplitGroupDetail) => {
      if (group.currentUserRole !== "ADMIN") return;
      setRegeneratingGroupId(group.id);

      try {
        const response = await fetch(
          `/api/groups/${encodeURIComponent(group.id)}/invite/regenerate`,
          {
            method: "POST",
          },
        );
        const payload = (await response.json()) as {
          error?: string;
          inviteToken?: string;
          inviteTokenVersion?: number;
        };

        if (!response.ok || !payload.inviteToken) {
          pushToast({
            tone: "error",
            title: "Could not regenerate link",
            description:
              payload.error ||
              "Failed to rotate invite link. Please try again.",
          });
          return;
        }

        setGroupOverrides((prev) => {
          const existingLogs =
            prev[group.id]?.auditLogs ?? group.auditLogs ?? [];
          const nextVersion = payload.inviteTokenVersion;
          const regenEntry: GroupAuditLogEntry = {
            id: `local-regen-${group.id}-${Date.now()}`,
            groupId: group.id,
            category: "GOVERNANCE",
            eventType: "INVITE_LINK_REGENERATED",
            actorId: null,
            actorName: "Group Admin",
            summary: `Regenerated invite link${nextVersion ? ` (v${nextVersion})` : ""} and revoked prior links`,
            details: nextVersion
              ? [`Active invite token version: v${nextVersion}`]
              : [],
            createdAt: new Date().toISOString(),
          };

          return {
            ...prev,
            [group.id]: {
              ...prev[group.id],
              inviteToken: payload.inviteToken,
              inviteTokenVersion: payload.inviteTokenVersion,
              auditLogs: [regenEntry, ...existingLogs],
            },
          };
        });
        setCopiedGroupId(null);
        pushToast({
          tone: "success",
          title: "Invite link regenerated",
          description: "All previous invite links for this group are now revoked.",
        });
        router.refresh();
      } catch {
        pushToast({
          tone: "error",
          title: "Network error",
          description: "Could not regenerate invite link. Please try again.",
        });
      } finally {
        setRegeneratingGroupId(null);
      }
    },
    [pushToast, router],
  );

  const handleRatiosSaved = React.useCallback(
    (result: {
      groupId: string;
      groupStatus: GroupStatus;
      defaultSplitMode: SplitMode;
      memberShares: Array<{ userId: string; sharePercentage: number }>;
      auditEntry?: GroupAuditLogEntry;
    }) => {
      const shareByUser = new Map(
        result.memberShares.map((item) => [item.userId, item.sharePercentage]),
      );

      setGroupOverrides((prev) => {
        const currentGroup = activeGroups.find((g) => g.id === result.groupId);
        if (!currentGroup) return prev;
        const existingLogs =
          prev[result.groupId]?.auditLogs ?? currentGroup.auditLogs ?? [];
        const nextAuditLogs = result.auditEntry
          ? [result.auditEntry, ...existingLogs]
          : existingLogs;

        return {
          ...prev,
          [result.groupId]: {
            ...prev[result.groupId],
            status: result.groupStatus,
            defaultSplitMode: result.defaultSplitMode,
            auditLogs: nextAuditLogs,
            members: currentGroup.members.map((member) => ({
              ...member,
              sharePercentage:
                shareByUser.get(member.userId) ?? member.sharePercentage,
            })),
          },
        };
      });

      pushToast({
        tone: "success",
        title: "Split ratios updated",
        description:
          result.defaultSplitMode === "EQUAL"
            ? "Equal split allocation saved for all active members."
            : "Custom split ratios saved and group status restored to active.",
      });
      router.refresh();
    },
    [activeGroups, pushToast, router],
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

  const handleLeaveGroupConfirm = React.useCallback(async () => {
    if (!leaveTargetGroup) return;
    setActionLoading(true);
    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(leaveTargetGroup.id)}/leave`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        pushToast({
          tone: "error",
          title: "Cannot leave group",
          description:
            payload.error || "Unable to leave group. Please try again.",
        });
        setActionLoading(false);
        return;
      }

      const departedId = leaveTargetGroup.id;
      const departedName = leaveTargetGroup.name;
      setDepartedGroupIds((prev) =>
        prev.includes(departedId) ? prev : [...prev, departedId],
      );
      setLeaveTargetGroup(null);
      setActionLoading(false);
      pushToast({
        tone: "success",
        title: "Left split group",
        description: `You have departed ${departedName}.`,
      });
      router.refresh();
    } catch {
      pushToast({
        tone: "error",
        title: "Network error",
        description: "Unable to leave group. Please try again.",
      });
      setActionLoading(false);
    }
  }, [leaveTargetGroup, pushToast, router]);

  const handleRemoveMemberConfirm = React.useCallback(async () => {
    if (!removeTarget) return;
    const { group, member } = removeTarget;
    setActionLoading(true);

    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(group.id)}/members/${encodeURIComponent(member.userId)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as {
        error?: string;
        transition?: "FORMER_MEMBER" | "REMOVED";
        groupStatus?: GroupStatus;
        memberShares?: Array<{
          userId: string;
          status: MemberStatus;
          sharePercentage: number;
        }>;
        auditEntry?: GroupAuditLogEntry;
      };

      if (!response.ok) {
        pushToast({
          tone: "error",
          title: "Could not remove member",
          description:
            payload.error || "Failed to remove member. Please try again.",
        });
        setActionLoading(false);
        return;
      }

      const shareByUser = new Map(
        (payload.memberShares ?? []).map((item) => [item.userId, item]),
      );

      setGroupOverrides((prev) => {
        const current = allGroups.find((g) => g.id === group.id) ?? group;
        const existingLogs =
          prev[group.id]?.auditLogs ?? current.auditLogs ?? [];
        const nextAuditLogs = payload.auditEntry
          ? [payload.auditEntry, ...existingLogs]
          : existingLogs;

        const nextMembers =
          payload.transition === "REMOVED"
            ? current.members
                .filter((m) => m.userId !== member.userId)
                .map((m) => ({
                  ...m,
                  sharePercentage:
                    shareByUser.get(m.userId)?.sharePercentage ??
                    m.sharePercentage,
                }))
            : current.members.map((m) => {
                if (m.userId === member.userId) {
                  return {
                    ...m,
                    status: "FORMER_MEMBER" as MemberStatus,
                    role: "MEMBER" as const,
                    sharePercentage: 0,
                  };
                }
                return {
                  ...m,
                  sharePercentage:
                    shareByUser.get(m.userId)?.sharePercentage ??
                    m.sharePercentage,
                };
              });

        return {
          ...prev,
          [group.id]: {
            ...prev[group.id],
            status: payload.groupStatus ?? current.status,
            members: nextMembers,
            auditLogs: nextAuditLogs,
          },
        };
      });

      setRemoveTarget(null);
      setActionLoading(false);
      pushToast({
        tone: "success",
        title:
          payload.transition === "FORMER_MEMBER"
            ? "Member transitioned to Former Member"
            : "Member removed",
        description:
          payload.transition === "FORMER_MEMBER"
            ? `${member.name} is excluded from future splits and can still settle remaining balances.`
            : `${member.name} has been removed from ${group.name}.`,
      });
      router.refresh();
    } catch {
      pushToast({
        tone: "error",
        title: "Network error",
        description: "Could not remove member. Please try again.",
      });
      setActionLoading(false);
    }
  }, [allGroups, pushToast, removeTarget, router]);

  const handleArchiveRulesSaved = React.useCallback(
    (payload: ArchiveRulesSavedPayload) => {
      setGroupOverrides((prev) => {
        const current = allGroups.find((g) => g.id === payload.groupId);
        if (!current) return prev;
        const existingLogs =
          prev[payload.groupId]?.auditLogs ?? current.auditLogs ?? [];
        const nextAuditLogs = payload.auditEntry
          ? [payload.auditEntry, ...existingLogs]
          : existingLogs;

        return {
          ...prev,
          [payload.groupId]: {
            ...prev[payload.groupId],
            status: payload.status,
            tripAutoArchiveEnabled: payload.tripAutoArchiveEnabled,
            tripAutoArchiveDays: payload.tripAutoArchiveDays,
            residentialLeasePromptEnabled:
              payload.residentialLeasePromptEnabled,
            leaseEndDate: payload.leaseEndDate,
            leasePromptSnoozedUntil: payload.leasePromptSnoozedUntil,
            archivedAt: payload.archivedAt,
            shouldPromptLeaseArchive:
              payload.status === "ARCHIVED"
                ? false
                : current.shouldPromptLeaseArchive,
            auditLogs: nextAuditLogs,
          },
        };
      });

      if (payload.status === "ARCHIVED") {
        setInspectedArchivedId(payload.groupId);
        setArchivedExpanded(true);
      } else if (inspectedArchivedId === payload.groupId) {
        setInspectedArchivedId(null);
      }

      pushToast({
        tone: "success",
        title:
          payload.status === "ARCHIVED"
            ? "Group archived"
            : "Archive rules updated",
        description:
          payload.status === "ARCHIVED"
            ? "This ledger is now read-only under Archived Ledgers."
            : "Archive rule settings saved.",
      });
      router.refresh();
    },
    [allGroups, inspectedArchivedId, pushToast, router],
  );

  const handleArchiveFromPrompt = React.useCallback(async () => {
    if (!archivePromptTarget) return;
    setActionLoading(true);
    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(archivePromptTarget.id)}/archive-rules`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "ARCHIVE",
            reason: `Archived following residential lease end (${archivePromptTarget.leaseEndDate ?? "post-lease prompt"}).`,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
      } & Partial<ArchiveRulesSavedPayload>;

      if (!response.ok || !payload.groupId || !payload.status) {
        pushToast({
          tone: "error",
          title: "Could not archive group",
          description: payload.error || "Failed to archive group.",
        });
        setActionLoading(false);
        return;
      }

      handleArchiveRulesSaved({
        groupId: payload.groupId,
        status: payload.status,
        tripAutoArchiveEnabled:
          payload.tripAutoArchiveEnabled ??
          archivePromptTarget.tripAutoArchiveEnabled ??
          true,
        tripAutoArchiveDays:
          payload.tripAutoArchiveDays ??
          archivePromptTarget.tripAutoArchiveDays ??
          14,
        residentialLeasePromptEnabled:
          payload.residentialLeasePromptEnabled ??
          archivePromptTarget.residentialLeasePromptEnabled ??
          true,
        leaseEndDate:
          payload.leaseEndDate ?? archivePromptTarget.leaseEndDate,
        leasePromptSnoozedUntil: payload.leasePromptSnoozedUntil ?? null,
        archivedAt: payload.archivedAt ?? null,
        auditEntry: payload.auditEntry,
      });
      setArchivePromptTarget(null);
      setActionLoading(false);
    } catch {
      pushToast({
        tone: "error",
        title: "Network error",
        description: "Unable to archive group. Please try again.",
      });
      setActionLoading(false);
    }
  }, [archivePromptTarget, handleArchiveRulesSaved, pushToast]);

  const handleSnoozeLeasePrompt = React.useCallback(
    async (group: SplitGroupDetail) => {
      if (group.currentUserRole !== "ADMIN") {
        setDismissedLeasePromptIds((prev) =>
          prev.includes(group.id) ? prev : [...prev, group.id],
        );
        return;
      }

      try {
        const response = await fetch(
          `/api/groups/${encodeURIComponent(group.id)}/archive-rules`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "SNOOZE_LEASE_PROMPT",
              snooze_days: 30,
            }),
          },
        );
        if (response.ok) {
          const payload = (await response.json()) as {
            leasePromptSnoozedUntil?: string | null;
          };
          setGroupOverrides((prev) => ({
            ...prev,
            [group.id]: {
              ...prev[group.id],
              shouldPromptLeaseArchive: false,
              leasePromptSnoozedUntil:
                payload.leasePromptSnoozedUntil ?? null,
            },
          }));
          pushToast({
            tone: "info",
            title: "Lease prompt snoozed",
            description: `Archive prompt for ${group.name} snoozed for 30 days.`,
          });
          router.refresh();
          return;
        }
      } catch {
        // Fallback to local dismissal when offline
      }

      setDismissedLeasePromptIds((prev) =>
        prev.includes(group.id) ? prev : [...prev, group.id],
      );
    },
    [pushToast, router],
  );

  const handleArchiveCheckCompleted = React.useCallback(
    (summary: { autoArchivedGroupIds: string[] }) => {
      if (summary.autoArchivedGroupIds.length > 0) {
        setGroupOverrides((prev) => {
          const next = { ...prev };
          for (const id of summary.autoArchivedGroupIds) {
            next[id] = {
              ...next[id],
              status: "ARCHIVED",
              shouldPromptLeaseArchive: false,
            };
          }
          return next;
        });
        setArchivedExpanded(true);
      }
      router.refresh();
    },
    [router],
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

      {/* Residential 7-Day Post-Lease Archive Prompts */}
      {leasePromptGroups.map((promptGroup) => (
        <AlertBanner
          key={`lease-prompt-${promptGroup.id}`}
          tone="warning"
          title={`Lease ended for ${promptGroup.name}`}
          description={`The configured lease ended ${promptGroup.daysSinceLeaseEnd ?? 7} days ago (${promptGroup.leaseEndDate}). Archive this group to lock it as read-only, or dismiss this reminder.`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {promptGroup.currentUserRole === "ADMIN" && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setArchivePromptTarget(promptGroup)}
                >
                  Archive Group
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handleSnoozeLeasePrompt(promptGroup)}
              >
                {promptGroup.currentUserRole === "ADMIN" ? "Snooze" : "Dismiss"}
              </Button>
            </div>
          }
        />
      ))}

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
              onLeaveGroup={(g) => setLeaveTargetGroup(g)}
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
          {selectedGroup.status === "ARCHIVED" && (
            <AlertBanner
              tone="info"
              title="Archived Group — Read-Only"
              description="This ledger is archived. New expenses, settlements, recurring rules, split ratio changes, and member departures are disabled."
              action={
                selectedGroup.currentUserRole === "ADMIN" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setArchiveModalOpen(true)}
                  >
                    Manage Archive
                  </Button>
                ) : undefined
              }
            />
          )}

          {selectedGroup.status === "NEEDS_RATIO_UPDATE" && (
            <AlertBanner
              tone="warning"
              title="Custom split ratios need review"
              description="A new member joined in CUSTOM_RATIOS mode with a 0% default share. Review member allocations so active percentages sum to 100%."
              action={
                selectedGroup.currentUserRole === "ADMIN" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditRatiosModalOpen(true)}
                  >
                    Edit Ratios
                  </Button>
                ) : undefined
              }
            />
          )}

          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#0066cc]">
                  Spotlight Partition
                </span>
                <Badge tone="neutral" size="sm">
                  {selectedGroup.defaultSplitMode === "EQUAL"
                    ? "Equal Split"
                    : "Custom Ratios"}
                </Badge>
                {selectedGroup.currentUserRole !== "ADMIN" && (
                  <Badge tone="neutral" size="sm">
                    View-only
                  </Badge>
                )}
              </div>
              <h2 className="font-display text-[21px] font-semibold tracking-tight text-ink">
                {selectedGroup.name} · Split Rules &amp; Ratios
              </h2>
              <p className="text-[13px] text-ink-muted-48">
                Member contributions for {cycleLabel} and cumulative unsettled
                balances in {selectedGroup.baseCurrency}.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedGroup.currentUserRole === "ADMIN" &&
              selectedGroup.status !== "ARCHIVED" ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
                  onClick={() => setEditRatiosModalOpen(true)}
                >
                  Edit Ratios
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Eye className="h-3.5 w-3.5" />}
                  onClick={() => setEditRatiosModalOpen(true)}
                >
                  View Ratios
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={<History className="h-3.5 w-3.5" />}
                onClick={() => setAuditDrawerOpen(true)}
              >
                Log
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={selectedGroup.status === "ARCHIVED"}
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
              {selectedGroup.status !== "ARCHIVED" &&
                selectedGroup.members.some((m) => m.isCurrentUser) && (
                  <Button
                    type="button"
                    variant="danger-soft"
                    size="sm"
                    leftIcon={<LogOut className="h-3.5 w-3.5" />}
                    onClick={() => setLeaveTargetGroup(selectedGroup)}
                  >
                    Leave Group
                  </Button>
                )}
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
                    {member.status === "FORMER_MEMBER" ? (
                      <Badge tone="warning" size="sm">
                        Former
                      </Badge>
                    ) : member.netBalanceCents === 0 ? (
                      <Badge tone="neutral" size="sm">
                        Balanced
                      </Badge>
                    ) : null}
                  </div>

                  {(member.status === "FORMER_MEMBER" ||
                    (selectedGroup.currentUserRole === "ADMIN" &&
                      selectedGroup.status !== "ARCHIVED" &&
                      !member.isCurrentUser &&
                      member.status === "ACTIVE")) && (
                    <div className="flex items-center justify-between gap-2 pt-1 text-[11px]">
                      {member.status === "FORMER_MEMBER" ? (
                        <span className="text-ink-muted-48">
                          Excluded from new splits
                        </span>
                      ) : (
                        <span />
                      )}
                      {selectedGroup.currentUserRole === "ADMIN" &&
                        selectedGroup.status !== "ARCHIVED" &&
                        !member.isCurrentUser &&
                        member.status === "ACTIVE" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove ${member.name}`}
                            leftIcon={<UserMinus className="h-3.5 w-3.5" />}
                            onClick={() =>
                              setRemoveTarget({
                                group: selectedGroup,
                                member,
                              })
                            }
                            className="h-7 px-2 text-[11px] text-red-600 hover:bg-red-50"
                          >
                            Remove
                          </Button>
                        )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Assigned Habitat & Member Invitation Gateway */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <Card
              variant="sub-card"
              padding="md"
              data-testid="assigned-habitat-card"
              className="flex flex-col justify-between gap-4 lg:col-span-6"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#0066cc]">
                    Assigned Habitat
                  </span>
                  <h3 className="text-[16px] font-semibold text-ink">
                    {selectedGroup.name}
                  </h3>
                  <p className="text-[12px] text-ink-muted-80">
                    {selectedGroup.operationalBudgetCents !== null
                      ? `${formatMinorUnits(
                          selectedGroup.operationalBudgetCents,
                          selectedGroup.baseCurrency,
                        )} Monthly Target`
                      : "No Monthly Budget Cap"}
                  </p>
                  <p className="text-[12px] text-ink-muted-48">
                    Base currency {selectedGroup.baseCurrency} · Anchored on day{" "}
                    {selectedGroup.billingCycleAnchorDay} of each month
                  </p>
                </div>
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas text-ink-muted-48">
                  <Home className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3 text-[12px] text-ink-muted-48">
                <span>
                  {selectedGroup.leaseEndDate
                    ? `Lease ends ${selectedGroup.leaseEndDate}`
                    : "No lease end date configured"}
                </span>
                <span className="font-medium text-ink-muted-80">
                  {selectedGroup.recurringRuleCount > 0
                    ? `Auto-ingestion active (${selectedGroup.recurringRuleCount})`
                    : selectedGroup.simplifyDebts
                      ? "Debt simplification on"
                      : "Direct peer balances"}
                </span>
              </div>
            </Card>

            <Card
              variant="sub-card"
              padding="md"
              data-testid="member-invitation-gateway"
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
                    : "custom split ratios (0% initial share until reviewed)"}
                  .
                </p>
              </div>

              <div className="flex items-center gap-2 rounded-pill border border-hairline bg-canvas px-3 py-1.5">
                <Link2
                  className="h-4 w-4 shrink-0 text-ink-muted-48"
                  aria-hidden="true"
                />
                <input
                  id="invite-link-input"
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
                <span role="status" aria-live="polite" className="sr-only">
                  {copyStatusText}
                </span>
              </div>

              <div className="flex items-center justify-between border-t border-hairline pt-2 text-[11px] text-ink-muted-48">
                <span>Slug: {selectedGroup.slug}</span>
                {selectedGroup.currentUserRole === "ADMIN" &&
                selectedGroup.status !== "ARCHIVED" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    loading={regeneratingGroupId === selectedGroup.id}
                    onClick={() => void handleRegenerateInviteLink(selectedGroup)}
                    className="h-7 px-2.5 text-[11px] font-semibold text-[#0066cc]"
                  >
                    Regenerate Link
                  </Button>
                ) : (
                  <span>Member view · Copy only</span>
                )}
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
      {archivedGroups.length > 0 && (
        <section aria-label="Archived ledgers" className="flex flex-col gap-3">
          <button
            type="button"
            aria-expanded={archivedExpanded}
            aria-controls="archived-ledgers-panel"
            onClick={() => setArchivedExpanded((prev) => !prev)}
            className="flex w-fit items-center gap-2 rounded-pill border border-hairline bg-canvas px-4 py-2 text-[13px] font-medium text-ink-muted-80 transition-colors hover:bg-surface-pearl focus-visible:outline-2 focus-visible:outline-primary-focus"
          >
            <Archive className="h-4 w-4 text-ink-muted-48" aria-hidden="true" />
            <span>Archived Ledgers ({archivedGroups.length})</span>
            {archivedExpanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>

          {archivedExpanded && (
            <div
              id="archived-ledgers-panel"
              className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
            >
              {archivedGroups.map((archived) => (
                <Card
                  key={archived.id}
                  variant="sub-card"
                  padding="md"
                  data-testid={`archived-group-card-${archived.id}`}
                  className="flex flex-col justify-between gap-3"
                >
                  <div className="flex flex-col gap-2">
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
                      {archived.members.length} members · Net{" "}
                      {formatMinorUnits(
                        archived.userNetLedgerCents,
                        archived.baseCurrency,
                        { showPlus: true },
                      )}
                    </p>
                  </div>
                  <div className="flex items-center justify-between border-t border-hairline pt-2.5">
                    <span className="text-[11px] font-medium text-ink-muted-48">
                      Writes locked
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setInspectedArchivedId(archived.id)}
                    >
                      Inspect Ledger
                    </Button>
                  </div>
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

      {selectedGroup && (
        <EditRatiosModal
          key={`${selectedGroup.id}-${selectedGroup.members.filter((m) => m.status === "ACTIVE").length}-${selectedGroup.defaultSplitMode}-${selectedGroup.currentUserRole ?? "none"}`}
          open={editRatiosModalOpen}
          onClose={() => setEditRatiosModalOpen(false)}
          group={selectedGroup}
          onSaved={handleRatiosSaved}
        />
      )}

      {selectedGroup && (
        <AuditLogDrawer
          key={selectedGroup.id}
          open={auditDrawerOpen}
          onClose={() => setAuditDrawerOpen(false)}
          group={selectedGroup}
        />
      )}

      <ArchiveRulesModal
        key={`${selectedGroup?.id ?? "none"}-${archiveModalOpen ? "open" : "closed"}`}
        open={archiveModalOpen}
        onClose={() => setArchiveModalOpen(false)}
        groups={allGroups}
        initialGroupId={selectedGroup?.id ?? null}
        onSaved={handleArchiveRulesSaved}
        onArchiveCheckCompleted={handleArchiveCheckCompleted}
      />

      {leaveTargetGroup && (
        <ConfirmDialog
          open={Boolean(leaveTargetGroup)}
          onClose={() => {
            if (!actionLoading) setLeaveTargetGroup(null);
          }}
          onConfirm={handleLeaveGroupConfirm}
          title={`Leave ${leaveTargetGroup.name}`}
          variant="danger"
          loading={actionLoading}
          confirmLabel="Leave Group"
          blockedReason={(() => {
            const selfMember = leaveTargetGroup.members.find(
              (m) => m.isCurrentUser,
            );
            const balance =
              selfMember?.netBalanceCents ??
              leaveTargetGroup.userNetLedgerCents;
            if (balance === 0) return undefined;
            const formattedAbs = formatMinorUnits(
              Math.abs(balance),
              leaveTargetGroup.baseCurrency,
            );
            return `Unpaid balance of ${formattedAbs} (${balance > 0 ? "owed to you" : "you owe"}) prevents leaving ${leaveTargetGroup.name}. Settle to ${formatMinorUnits(0, leaveTargetGroup.baseCurrency)} first.`;
          })()}
          description={(() => {
            const selfMember = leaveTargetGroup.members.find(
              (m) => m.isCurrentUser,
            );
            const balance =
              selfMember?.netBalanceCents ??
              leaveTargetGroup.userNetLedgerCents;
            if (balance !== 0) {
              return `Your current net balance in ${leaveTargetGroup.name} is ${formatMinorUnits(balance, leaveTargetGroup.baseCurrency, { showPlus: true })}.`;
            }
            return `Your net balance in ${leaveTargetGroup.name} is ${formatMinorUnits(0, leaveTargetGroup.baseCurrency)}. Confirming will remove you from this group and update active split shares.`;
          })()}
        />
      )}

      {removeTarget && (
        <ConfirmDialog
          open={Boolean(removeTarget)}
          onClose={() => {
            if (!actionLoading) setRemoveTarget(null);
          }}
          onConfirm={handleRemoveMemberConfirm}
          title={`Remove ${removeTarget.member.name}?`}
          variant="danger"
          loading={actionLoading}
          confirmLabel={
            removeTarget.member.netBalanceCents !== 0
              ? "Mark as Former Member"
              : "Remove Member"
          }
          description={
            removeTarget.member.netBalanceCents !== 0
              ? `${removeTarget.member.name} has an unsettled balance of ${formatMinorUnits(removeTarget.member.netBalanceCents, removeTarget.group.baseCurrency, { showPlus: true })}. Removing them transitions their membership to FORMER_MEMBER: they are excluded from all future default splits while retaining settlement access until cleared.`
              : `${removeTarget.member.name} has a ${formatMinorUnits(0, removeTarget.group.baseCurrency)} balance and will be removed from ${removeTarget.group.name}.`
          }
        />
      )}

      {archivePromptTarget && (
        <ConfirmDialog
          open={Boolean(archivePromptTarget)}
          onClose={() => {
            if (!actionLoading) setArchivePromptTarget(null);
          }}
          onConfirm={handleArchiveFromPrompt}
          title={`Archive ${archivePromptTarget.name}?`}
          variant="danger"
          loading={actionLoading}
          confirmLabel="Archive Group"
          description={`Lease ended on ${archivePromptTarget.leaseEndDate}. Archiving transitions ${archivePromptTarget.name} to ARCHIVED (read-only), blocking all new expenses, settlements, and recurring rules.`}
        />
      )}

      {toasts.length > 0 && (
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      )}
    </div>
  );
}
