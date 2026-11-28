"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowRight,
  Check,
  Copy,
  Eye,
  Link2,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
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
  Input,
  SegmentedControl,
  ToastContainer,
} from "@/components/ui";
import type { SegmentedOption, ToastItem } from "@/components/ui";
import { useActiveGroup } from "@/components/shell/ActiveGroupContext";
import { REALTIME_LEDGER_CHANGE_EVENT } from "@/components/shell/notifications";
import type {
  RealtimeLedgerChangeDetail,
  ShellGroupSummary,
} from "@/components/shell/types";
import { formatCycleLabel } from "@/components/shell/url-state";
import { cn } from "@/lib/cn";
import type { GroupAuditLogEntry } from "@/lib/groups/audit-log";
import { buildInviteJoinUrl } from "@/lib/groups/invite-utils";
import {
  formatCooldownLabel,
  getReminderCooldownKey,
  REMINDER_COOLDOWN_MS,
  type ReminderCooldownInfo,
} from "@/lib/groups/reminders";
import { resolveGroupCategory } from "@/lib/groups/service";
import type {
  SplitGroupDetail,
  SplitGroupMemberDetail,
  SplitGroupsPageData,
} from "@/lib/groups/types";
import { formatMinorUnits } from "@/lib/money";
import type { GroupStatus, MemberStatus, SplitMode } from "@/types/database";
import { AuditLogDrawer } from "./AuditLogDrawer";
import { CreateGroupModal } from "./CreateGroupModal";
import { EditRatiosModal } from "./EditRatiosModal";
import {
  formatSplitRuleLabel,
  GROUP_CATEGORY_LABELS,
  SplitGroupCard,
} from "./SplitGroupCard";

export interface SplitGroupsClientProps {
  initialData: SplitGroupsPageData;
  defaultCurrency?: string;
}

type GroupViewTab = "active" | "archived";
type SpotlightTab = "members" | "rules";

interface SimplifiedTransfer {
  payer: SplitGroupMemberDetail;
  recipient: SplitGroupMemberDetail;
  amountCents: number;
}

function buildInvitePath(group: SplitGroupDetail): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://ledgersplit.app";
  return buildInviteJoinUrl(group.slug, group.inviteToken, origin);
}

function computeSimplifiedTransfers(
  members: readonly SplitGroupMemberDetail[],
): SimplifiedTransfer[] {
  const debtors = members
    .filter((m) => m.netBalanceCents < 0)
    .map((m) => ({ member: m, remaining: Math.abs(Math.trunc(m.netBalanceCents)) }))
    .sort((a, b) => b.remaining - a.remaining);

  const creditors = members
    .filter((m) => m.netBalanceCents > 0)
    .map((m) => ({ member: m, remaining: Math.trunc(m.netBalanceCents) }))
    .sort((a, b) => b.remaining - a.remaining);

  const transfers: SimplifiedTransfer[] = [];
  let di = 0;
  let ci = 0;

  while (di < debtors.length && ci < creditors.length) {
    const debtor = debtors[di];
    const creditor = creditors[ci];
    const amount = Math.min(debtor.remaining, creditor.remaining);
    if (amount > 0) {
      transfers.push({
        payer: debtor.member,
        recipient: creditor.member,
        amountCents: amount,
      });
    }
    debtor.remaining -= amount;
    creditor.remaining -= amount;
    if (debtor.remaining === 0) di += 1;
    if (creditor.remaining === 0) ci += 1;
  }

  return transfers;
}

export function SplitGroupsClient({
  initialData,
  defaultCurrency = "USD",
}: SplitGroupsClientProps) {
  const router = useRouter();
  const {
    activeGroupId,
    cycle,
    user: currentUser,
    setActiveGroup,
    upsertGroup,
  } = useActiveGroup();

  const [viewTab, setViewTab] = React.useState<GroupViewTab>("active");
  const [spotlightTab, setSpotlightTab] =
    React.useState<SpotlightTab>("members");

  const [createdGroups, setCreatedGroups] = React.useState<SplitGroupDetail[]>(
    [],
  );
  const [departedGroupIds, setDepartedGroupIds] = React.useState<string[]>([]);
  const [groupOverrides, setGroupOverrides] = React.useState<
    Record<string, Partial<SplitGroupDetail>>
  >({});

  const [groupModalState, setGroupModalState] = React.useState<{
    open: boolean;
    mode: "create" | "edit";
    group: SplitGroupDetail | null;
  }>({ open: false, mode: "create", group: null });

  const [editRatiosModalOpen, setEditRatiosModalOpen] = React.useState(false);
  const [auditDrawerOpen, setAuditDrawerOpen] = React.useState(false);
  const [inspectedArchivedId, setInspectedArchivedId] = React.useState<
    string | null
  >(null);
  const [leaveTargetGroup, setLeaveTargetGroup] =
    React.useState<SplitGroupDetail | null>(null);
  const [closeCycleTargetGroup, setCloseCycleTargetGroup] =
    React.useState<SplitGroupDetail | null>(null);
  const [archiveTargetGroup, setArchiveTargetGroup] =
    React.useState<SplitGroupDetail | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<{
    group: SplitGroupDetail;
    member: SplitGroupMemberDetail;
  } | null>(null);

  const [actionLoading, setActionLoading] = React.useState(false);
  const [copiedGroupId, setCopiedGroupId] = React.useState<string | null>(null);
  const [copyStatusText, setCopyStatusText] = React.useState("");
  const [regeneratingGroupId, setRegeneratingGroupId] = React.useState<
    string | null
  >(null);
  const [cooldownOverrides, setCooldownOverrides] = React.useState<
    Record<string, ReminderCooldownInfo>
  >({});
  const [sendingReminderKeys, setSendingReminderKeys] = React.useState<
    Record<string, boolean>
  >({});
  const [nowTickMs, setNowTickMs] = React.useState(() => Date.now());
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const toastCounterRef = React.useRef(0);
  const copyTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const handleRealtimeChange = (event: Event) => {
      const detail = (event as CustomEvent<RealtimeLedgerChangeDetail>).detail;
      if (!detail) return;
      if (detail.table === "groups" || detail.table === "group_members") {
        const groupId =
          (typeof detail.newRow?.group_id === "string" &&
            detail.newRow.group_id) ||
          (typeof detail.newRow?.id === "string" && detail.newRow.id) ||
          (typeof detail.oldRow?.group_id === "string" &&
            detail.oldRow.group_id) ||
          (typeof detail.oldRow?.id === "string" && detail.oldRow.id) ||
          null;
        if (groupId) {
          setGroupOverrides((prev) => {
            if (!(groupId in prev)) return prev;
            const next = { ...prev };
            delete next[groupId];
            return next;
          });
        }
      }
    };

    window.addEventListener(REALTIME_LEDGER_CHANGE_EVENT, handleRealtimeChange);
    return () =>
      window.removeEventListener(
        REALTIME_LEDGER_CHANGE_EVENT,
        handleRealtimeChange,
      );
  }, []);

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

  const handleSelectGroup = React.useCallback(
    (groupId: string) => {
      setInspectedArchivedId(null);
      setActiveGroup(groupId);
    },
    [setActiveGroup],
  );

  const openCreateModal = React.useCallback(() => {
    setGroupModalState({ open: true, mode: "create", group: null });
  }, []);

  const openEditModal = React.useCallback(
    (group: SplitGroupDetail) => {
      setInspectedArchivedId(null);
      setActiveGroup(group.id);
      setGroupModalState({ open: true, mode: "edit", group });
    },
    [setActiveGroup],
  );

  const handleOpenSplitRules = React.useCallback(
    (group: SplitGroupDetail) => {
      setInspectedArchivedId(null);
      setActiveGroup(group.id);
      setSpotlightTab("rules");
    },
    [setActiveGroup],
  );

  const handleOpenAuditLog = React.useCallback(
    (group: SplitGroupDetail) => {
      setInspectedArchivedId(null);
      setActiveGroup(group.id);
      setAuditDrawerOpen(true);
    },
    [setActiveGroup],
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
          { method: "POST" },
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
      setViewTab("active");
      setInspectedArchivedId(null);
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

  const handleGroupUpdated = React.useCallback(
    ({
      group,
      shellGroup,
      invitedEmails,
      removedMemberIds,
    }: {
      group: SplitGroupDetail;
      shellGroup: ShellGroupSummary;
      invitedEmails: string[];
      removedMemberIds: string[];
    }) => {
      const removedSet = new Set(removedMemberIds);
      setGroupOverrides((prev) => {
        const existing = allGroups.find((g) => g.id === group.id);
        const mergedMembers =
          group.members.length > 0
            ? group.members
            : (existing?.members ?? []).filter(
                (m) => !removedSet.has(m.userId),
              );

        return {
          ...prev,
          [group.id]: {
            ...prev[group.id],
            name: group.name,
            category: group.category,
            groupType: group.groupType,
            baseCurrency: group.baseCurrency,
            defaultSplitMode: group.defaultSplitMode,
            members: mergedMembers,
          },
        };
      });

      upsertGroup(shellGroup);
      pushToast({
        tone: "success",
        title: "Group updated",
        description:
          invitedEmails.length > 0
            ? `Saved changes to ${group.name} and invited ${invitedEmails.length} ${invitedEmails.length === 1 ? "member" : "members"}.`
            : `Saved changes to ${group.name}.`,
      });
      router.refresh();
    },
    [allGroups, pushToast, router, upsertGroup],
  );

  const handleArchiveGroupConfirm = React.useCallback(async () => {
    if (!archiveTargetGroup) return;
    setActionLoading(true);
    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(archiveTargetGroup.id)}/archive-rules`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "ARCHIVE",
            reason: "Archived by group admin.",
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        archivedAt?: string | null;
      };

      if (!response.ok) {
        pushToast({
          tone: "error",
          title: "Could not archive group",
          description: payload.error || "Failed to archive group.",
        });
        setActionLoading(false);
        return;
      }

      const archivedId = archiveTargetGroup.id;
      const archivedName = archiveTargetGroup.name;
      setGroupOverrides((prev) => ({
        ...prev,
        [archivedId]: {
          ...prev[archivedId],
          status: "ARCHIVED",
          archivedAt: payload.archivedAt ?? new Date().toISOString(),
        },
      }));
      setArchiveTargetGroup(null);
      setActionLoading(false);
      pushToast({
        tone: "success",
        title: "Group archived",
        description: `${archivedName} is now read-only under Archived.`,
      });
      router.refresh();
    } catch {
      pushToast({
        tone: "error",
        title: "Network error",
        description: "Unable to archive group. Please try again.",
      });
      setActionLoading(false);
    }
  }, [archiveTargetGroup, pushToast, router]);

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

  const handleCloseCycleConfirm = React.useCallback(async () => {
    if (!closeCycleTargetGroup) return;
    setActionLoading(true);
    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(closeCycleTargetGroup.id)}/billing-cycles/close`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cycle }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        lockedExpenseCount?: number;
      };
      if (!response.ok) {
        pushToast({
          tone: "error",
          title: "Close cycle failed",
          description: payload.error || "Unable to close billing cycle.",
        });
        setActionLoading(false);
        return;
      }

      const lockedCount = payload.lockedExpenseCount ?? 0;
      setGroupOverrides((prev) => ({
        ...prev,
        [closeCycleTargetGroup.id]: {
          ...prev[closeCycleTargetGroup.id],
          isCurrentCycleClosed: true,
        },
      }));
      const label = formatCycleLabel(cycle);
      pushToast({
        tone: "success",
        title: "Billing cycle closed & locked",
        description: `${label} for ${closeCycleTargetGroup.name} is now CLOSED (${lockedCount} ${lockedCount === 1 ? "expense" : "expenses"} locked).`,
      });
      setCloseCycleTargetGroup(null);
      setActionLoading(false);
      router.refresh();
    } catch {
      pushToast({
        tone: "error",
        title: "Network error",
        description: "Unable to close billing cycle. Please try again.",
      });
      setActionLoading(false);
    }
  }, [closeCycleTargetGroup, cycle, pushToast, router]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const cooldownMap = React.useMemo(() => {
    const map: Record<string, ReminderCooldownInfo> = {};
    for (const item of initialData.reminderCooldowns ?? []) {
      map[getReminderCooldownKey(item.groupId, item.debtorId)] = item;
    }
    for (const [key, item] of Object.entries(cooldownOverrides)) {
      map[key] = item;
    }
    return map;
  }, [cooldownOverrides, initialData.reminderCooldowns]);

  const getActiveCooldown = React.useCallback(
    (groupId: string, debtorId: string): ReminderCooldownInfo | null => {
      const key = getReminderCooldownKey(groupId, debtorId);
      const info = cooldownMap[key];
      if (!info) return null;
      const nextAllowedMs = Date.parse(info.nextAllowedAt);
      if (!Number.isFinite(nextAllowedMs) || nextAllowedMs <= nowTickMs) {
        return null;
      }
      const remainingMs = nextAllowedMs - nowTickMs;
      const remainingHours = Math.max(1, Math.ceil(remainingMs / 3_600_000));
      return {
        ...info,
        remainingMs,
        remainingHours,
      };
    },
    [cooldownMap, nowTickMs],
  );

  const handleSendMemberReminder = React.useCallback(
    async (group: SplitGroupDetail, member: SplitGroupMemberDetail) => {
      const key = getReminderCooldownKey(group.id, member.userId);
      if (sendingReminderKeys[key]) return;

      setSendingReminderKeys((prev) => ({ ...prev, [key]: true }));
      try {
        const response = await fetch(
          `/api/groups/${encodeURIComponent(group.id)}/reminders`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              debtor_id: member.userId,
              amount_cents: Math.abs(member.netBalanceCents),
            }),
          },
        );
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          channel?: "PUSH" | "EMAIL" | "SMS";
          cooldown?: ReminderCooldownInfo;
          remaining_hours?: number;
          next_allowed_at?: string;
          last_sent_at?: string;
        };

        if (response.status === 429) {
          const remainingHours = Math.max(
            1,
            Math.trunc(
              payload.cooldown?.remainingHours ?? payload.remaining_hours ?? 24,
            ),
          );
          const now = Date.now();
          const cooldown: ReminderCooldownInfo = payload.cooldown ?? {
            groupId: group.id,
            debtorId: member.userId,
            creditorId: "",
            channel: "PUSH",
            sentAt: payload.last_sent_at ?? new Date(now).toISOString(),
            nextAllowedAt:
              payload.next_allowed_at ??
              new Date(
                now + Math.min(REMINDER_COOLDOWN_MS, remainingHours * 3_600_000),
              ).toISOString(),
            remainingMs: remainingHours * 3_600_000,
            remainingHours,
          };
          setCooldownOverrides((prev) => ({ ...prev, [key]: cooldown }));
          pushToast({
            tone: "warning",
            title: "Reminder cooldown active",
            description:
              payload.error ||
              `${member.name}: ${formatCooldownLabel(cooldown.remainingHours)}.`,
          });
          return;
        }

        if (!response.ok || !payload.ok) {
          pushToast({
            tone: "error",
            title: "Could not send reminder",
            description:
              payload.error || "Unable to send settlement reminder.",
          });
          return;
        }

        const now = Date.now();
        const cooldown: ReminderCooldownInfo = payload.cooldown ?? {
          groupId: group.id,
          debtorId: member.userId,
          creditorId: "",
          channel: payload.channel ?? "PUSH",
          sentAt: new Date(now).toISOString(),
          nextAllowedAt: new Date(now + REMINDER_COOLDOWN_MS).toISOString(),
          remainingMs: REMINDER_COOLDOWN_MS,
          remainingHours: 24,
        };
        setCooldownOverrides((prev) => ({ ...prev, [key]: cooldown }));
        setNowTickMs(Date.now());

        const viaSms = payload.channel === "SMS";
        pushToast({
          tone: "success",
          title: viaSms ? "SMS reminder sent" : "Push reminder sent",
          description: viaSms
            ? `Dispatched SMS and in-app nudge to ${member.name}.`
            : `Sent Push/in-app settlement reminder to ${member.name}.`,
        });
        router.refresh();
      } catch {
        pushToast({
          tone: "error",
          title: "Network error",
          description: "Unable to send settlement reminder right now.",
        });
      } finally {
        setSendingReminderKeys((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [pushToast, router, sendingReminderKeys],
  );

  const viewOptions = React.useMemo<Array<SegmentedOption<GroupViewTab>>>(
    () => [
      { value: "active", label: `Active (${activeGroups.length})` },
      { value: "archived", label: `Archived (${archivedGroups.length})` },
    ],
    [activeGroups.length, archivedGroups.length],
  );

  const spotlightTabOptions = React.useMemo<
    Array<SegmentedOption<SpotlightTab>>
  >(
    () => [
      { value: "members", label: "Members & Balances" },
      { value: "rules", label: "Split Rules & Invite" },
    ],
    [],
  );

  const simplifiedTransfers = React.useMemo(
    () => (selectedGroup ? computeSimplifiedTransfers(selectedGroup.members) : []),
    [selectedGroup],
  );

  const cycleLabel = formatCycleLabel(cycle);

  const activeMemberCount = selectedGroup
    ? selectedGroup.members.filter((m) => m.status === "ACTIVE").length
    : 0;
  const perMemberCents =
    selectedGroup && activeMemberCount > 0
      ? Math.round(selectedGroup.cycleTurnoverCents / activeMemberCount)
      : 0;

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Page Header */}
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-on-surface sm:text-[30px]">
            Split Groups
          </h1>
          <p className="text-[14px] text-outline">
            Shared groups, member splits, and group balances.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            variant="pill-tabs"
            ariaLabel="Group status view"
            options={viewOptions}
            value={viewTab}
            onChange={(next) => {
              setViewTab(next);
              if (next === "active") {
                setInspectedArchivedId(null);
              }
            }}
          />
          <Button
            type="button"
            variant="primary"
            size="md"
            leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            onClick={openCreateModal}
          >
            Create Group
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
              leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => router.refresh()}
            >
              Retry
            </Button>
          }
        />
      )}

      {/* Active View */}
      {viewTab === "active" && (
        <>
          {!initialData.loadError && activeGroups.length === 0 && (
            <Card
              variant="section"
              padding="lg"
              className="flex flex-col items-center justify-center gap-4 py-14 text-center"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-outline-variant/60 bg-surface-container-low text-primary">
                <Users className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="max-w-md space-y-1">
                <h2 className="font-display text-[19px] font-semibold text-on-surface">
                  No active split groups yet
                </h2>
                <p className="text-[14px] leading-relaxed text-outline">
                  Create your first group to track shared expenses, assign split
                  ratios, and keep balances isolated per household or trip.
                </p>
              </div>
              <Button
                type="button"
                variant="primary"
                size="md"
                leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                onClick={openCreateModal}
              >
                Create Group
              </Button>
            </Card>
          )}

          {/* 4-Column Active Group Cards Grid */}
          {activeGroups.length > 0 && (
            <section
              aria-label="Active split groups"
              className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4"
            >
              {activeGroups.map((group) => (
                <SplitGroupCard
                  key={group.id}
                  group={group}
                  isSelected={selectedGroup?.id === group.id}
                  onSelectGroup={handleSelectGroup}
                  onEditGroup={openEditModal}
                  onOpenSplitRules={handleOpenSplitRules}
                  onOpenAuditLog={handleOpenAuditLog}
                  onArchiveGroup={(g) => setArchiveTargetGroup(g)}
                />
              ))}
            </section>
          )}
        </>
      )}

      {/* Archived View */}
      {viewTab === "archived" && (
        <section aria-label="Archived ledgers" className="flex flex-col gap-4">
          <AlertBanner
            tone="info"
            title="Archived Groups — Read-Only"
            description="Archived groups are frozen for historical reference. Inspect any archived ledger below."
          />
          {archivedGroups.length === 0 ? (
            <Card
              variant="section"
              padding="lg"
              className="flex flex-col items-center justify-center gap-2 py-12 text-center"
            >
              <Archive className="h-6 w-6 text-outline" aria-hidden="true" />
              <p className="text-[14px] font-medium text-on-surface">
                No archived groups
              </p>
              <p className="text-[13px] text-outline">
                Groups you archive from the active view will appear here.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {archivedGroups.map((archived) => {
                const cat = resolveGroupCategory(archived);
                return (
                  <Card
                    key={archived.id}
                    variant="section"
                    padding="md"
                    data-testid={`archived-group-card-${archived.id}`}
                    className="flex flex-col justify-between gap-4"
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge tone="neutral" size="sm">
                          {GROUP_CATEGORY_LABELS[cat]}
                        </Badge>
                        <Badge tone="neutral" size="sm">
                          Archived
                        </Badge>
                      </div>
                      <h3 className="truncate text-[16px] font-semibold text-on-surface">
                        {archived.name}
                      </h3>
                      <p className="text-[12px] text-outline tabular-nums">
                        {archived.baseCurrency} · {archived.members.length}{" "}
                        members · Net{" "}
                        {formatMinorUnits(
                          archived.userNetLedgerCents,
                          archived.baseCurrency,
                          { showPlus: true },
                        )}
                      </p>
                    </div>
                    <div className="flex items-center justify-between border-t border-outline-variant/40 pt-3">
                      <span className="text-[11px] font-medium text-outline">
                        Read-only
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
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Selected Group Spotlight Panel */}
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
              description="This ledger is archived. New expenses, settlements, split ratio changes, and member departures are disabled."
            />
          )}

          {selectedGroup.status === "NEEDS_RATIO_UPDATE" && (
            <AlertBanner
              tone="warning"
              title="Custom split ratios need review"
              description="A new member joined in custom ratio mode with a 0% default share. Review member allocations so active percentages sum to 100%."
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

          {/* Spotlight Header */}
          <div className="flex flex-col justify-between gap-4 border-b border-outline-variant/40 pb-4 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="truncate font-display text-[20px] font-semibold tracking-tight text-on-surface">
                  {selectedGroup.name}
                </h2>
                <Badge
                  tone="neutral"
                  size="sm"
                  className="border-outline-variant/60 bg-surface-container-low text-on-surface-variant"
                >
                  {formatSplitRuleLabel(selectedGroup)}
                </Badge>
                {selectedGroup.currentUserRole !== "ADMIN" && (
                  <Badge tone="neutral" size="sm">
                    View-only
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-[13px] text-outline tabular-nums">
                {formatMinorUnits(
                  selectedGroup.cycleTurnoverCents,
                  selectedGroup.baseCurrency,
                )}{" "}
                total ·{" "}
                {formatMinorUnits(perMemberCents, selectedGroup.baseCurrency)}{" "}
                per member
              </p>
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <SegmentedControl
                variant="pill-tabs"
                ariaLabel="Group detail tabs"
                options={spotlightTabOptions}
                value={spotlightTab}
                onChange={setSpotlightTab}
                className="w-full sm:w-auto [&>button]:flex-1 [&>button]:px-2.5 [&>button]:text-[12px] sm:[&>button]:flex-initial sm:[&>button]:px-4 sm:[&>button]:text-[13px]"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setAuditDrawerOpen(true)}
              >
                Audit Log
              </Button>
              {selectedGroup.status !== "ARCHIVED" && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={selectedGroup.currentUserRole !== "ADMIN"}
                  onClick={() => openEditModal(selectedGroup)}
                >
                  Edit Group
                </Button>
              )}
            </div>
          </div>

          {/* Tab 1: Members & Balances */}
          {spotlightTab === "members" && (
            <>
              <div>
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-outline tabular-nums">
                  GROUP MEMBERS ({selectedGroup.members.length})
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3 tabular-nums">
                  {selectedGroup.members.map((member) => {
                    const memberShareCents = Math.round(
                      (selectedGroup.cycleTurnoverCents *
                        member.sharePercentage) /
                        100,
                    );
                    const roleSubtitle =
                      member.status === "FORMER_MEMBER"
                        ? "Former Member"
                        : member.role === "ADMIN"
                          ? "Owner"
                          : "Member";

                    const currentMember = selectedGroup.members.find(
                      (m) => m.isCurrentUser,
                    );
                    const canRemindMember =
                      selectedGroup.status !== "ARCHIVED" &&
                      currentMember?.status === "ACTIVE" &&
                      !member.isCurrentUser &&
                      member.netBalanceCents < 0;
                    const reminderKey = getReminderCooldownKey(
                      selectedGroup.id,
                      member.userId,
                    );
                    const cooldown = getActiveCooldown(
                      selectedGroup.id,
                      member.userId,
                    );
                    const isSending = Boolean(sendingReminderKeys[reminderKey]);

                    return (
                      <Card
                        key={member.userId}
                        variant="sub-card"
                        padding="sm"
                        className="flex flex-col justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <Avatar name={member.name} size="md" />
                              <div className="min-w-0">
                                <h3 className="truncate text-[14px] font-semibold text-on-surface">
                                  {member.name}
                                  {member.isCurrentUser ? " (You)" : ""}
                                </h3>
                                <p className="truncate text-[12px] text-outline">
                                  {roleSubtitle}
                                </p>
                              </div>
                            </div>
                            {member.status === "FORMER_MEMBER" ? (
                              <Badge tone="warning" size="sm">
                                Former
                              </Badge>
                            ) : member.netBalanceCents > 0 ? (
                              <Badge tone="success" size="sm">
                                Owed to you
                              </Badge>
                            ) : member.netBalanceCents < 0 ? (
                              <Badge tone="danger" size="sm">
                                Owes group
                              </Badge>
                            ) : (
                              <Badge tone="neutral" size="sm">
                                Settled
                              </Badge>
                            )}
                          </div>

                          <div className="mt-3 space-y-1 border-t border-outline-variant/50 pt-3 text-[13px]">
                            <div className="flex justify-between gap-2">
                              <span className="text-outline">Paid:</span>
                              <span className="font-medium text-on-surface">
                                {formatMinorUnits(
                                  member.paidThisPeriodCents,
                                  selectedGroup.baseCurrency,
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-outline">Share:</span>
                              <span className="font-medium text-on-surface">
                                {formatMinorUnits(
                                  memberShareCents,
                                  selectedGroup.baseCurrency,
                                )}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-end justify-between gap-2 border-t border-outline-variant/50 pt-3">
                          <div>
                            <span className="block text-[11px] text-outline">
                              Net Position
                            </span>
                            <span
                              className={cn(
                                "text-[15px] font-semibold tabular-nums",
                                member.netBalanceCents > 0
                                  ? "text-emerald-700"
                                  : member.netBalanceCents < 0
                                    ? "text-red-600"
                                    : "text-outline",
                              )}
                            >
                              {formatMinorUnits(
                                member.netBalanceCents,
                                selectedGroup.baseCurrency,
                                { showPlus: true },
                              )}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {canRemindMember && (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                data-testid={`split-group-remind-${member.userId}`}
                                loading={isSending}
                                disabled={Boolean(cooldown) || isSending}
                                aria-label={
                                  cooldown
                                    ? `${formatCooldownLabel(cooldown.remainingHours)} for ${member.name}`
                                    : `Remind ${member.name}`
                                }
                                onClick={() =>
                                  void handleSendMemberReminder(
                                    selectedGroup,
                                    member,
                                  )
                                }
                                className="h-7 px-3 text-[11px]"
                              >
                                {cooldown
                                  ? formatCooldownLabel(cooldown.remainingHours)
                                  : "Remind"}
                              </Button>
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
                                  leftIcon={
                                    <UserMinus
                                      className="h-3.5 w-3.5"
                                      aria-hidden="true"
                                    />
                                  }
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
                        </div>

                        {member.status === "FORMER_MEMBER" && (
                          <span className="text-[11px] text-outline">
                            Excluded from new splits
                          </span>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>

              {/* WHO OWES WHOM */}
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-outline">
                    WHO OWES WHOM
                  </span>
                  <span className="text-[12px] text-outline tabular-nums">
                    {simplifiedTransfers.length === 0
                      ? "All balances settled"
                      : `${simplifiedTransfers.length} ${simplifiedTransfers.length === 1 ? "transfer" : "transfers"} to zero balances`}
                  </span>
                </div>

                {simplifiedTransfers.length === 0 ? (
                  <Card
                    variant="sub-card"
                    padding="sm"
                    className="text-center text-[13px] text-outline"
                  >
                    Everyone in {selectedGroup.name} is currently settled up.
                  </Card>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {simplifiedTransfers.map((transfer) => {
                      const reminderKey = getReminderCooldownKey(
                        selectedGroup.id,
                        transfer.payer.userId,
                      );
                      const cooldown = getActiveCooldown(
                        selectedGroup.id,
                        transfer.payer.userId,
                      );
                      const isSending = Boolean(
                        sendingReminderKeys[reminderKey],
                      );
                      return (
                        <div
                          key={`${transfer.payer.userId}-${transfer.recipient.userId}`}
                          className="flex flex-col justify-between gap-3 rounded-[14px] border border-outline-variant/60 bg-surface-container-lowest px-4 py-3 sm:flex-row sm:items-center"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar name={transfer.payer.name} size="sm" />
                            <span className="truncate text-[13px] font-medium text-on-surface">
                              {transfer.payer.isCurrentUser
                                ? "You"
                                : transfer.payer.name}
                            </span>
                            <ArrowRight
                              className="h-3.5 w-3.5 shrink-0 text-outline"
                              aria-hidden="true"
                            />
                            <span className="truncate text-[13px] font-medium text-on-surface">
                              {transfer.recipient.isCurrentUser
                                ? "You"
                                : transfer.recipient.name}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                            <span className="text-[14px] font-semibold text-on-surface tabular-nums">
                              {formatMinorUnits(
                                transfer.amountCents,
                                selectedGroup.baseCurrency,
                              )}
                            </span>
                            {selectedGroup.status !== "ARCHIVED" &&
                              !transfer.payer.isCurrentUser && (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  loading={isSending}
                                  disabled={Boolean(cooldown) || isSending}
                                  onClick={() =>
                                    void handleSendMemberReminder(
                                      selectedGroup,
                                      transfer.payer,
                                    )
                                  }
                                  className="h-8 px-3 text-[12px]"
                                >
                                  {cooldown
                                    ? formatCooldownLabel(
                                        cooldown.remainingHours,
                                      )
                                    : "Remind"}
                                </Button>
                              )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Tab 2: Split Rules & Invite */}
          {spotlightTab === "rules" && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <Card
                variant="sub-card"
                padding="md"
                className="flex flex-col justify-between gap-4 lg:col-span-6"
              >
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-outline">
                    Split Rules &amp; Cycle Governance
                  </span>
                  <h3 className="text-[16px] font-semibold text-on-surface">
                    {formatSplitRuleLabel(selectedGroup)}
                  </h3>
                  <p className="text-[13px] text-outline">
                    Base currency {selectedGroup.baseCurrency} · Cycle resets on
                    day {selectedGroup.billingCycleAnchorDay} of each month.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-outline-variant/50 pt-3">
                  {selectedGroup.currentUserRole === "ADMIN" &&
                  selectedGroup.status !== "ARCHIVED" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      leftIcon={
                        <SlidersHorizontal
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                      }
                      onClick={() => setEditRatiosModalOpen(true)}
                    >
                      Edit Ratios
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      leftIcon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => setEditRatiosModalOpen(true)}
                    >
                      View Ratios
                    </Button>
                  )}

                  {selectedGroup.currentUserRole === "ADMIN" &&
                    selectedGroup.status !== "ARCHIVED" &&
                    (selectedGroup.isCurrentCycleClosed ? (
                      <Badge tone="warning" size="sm">
                        Cycle Closed
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        leftIcon={
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        }
                        onClick={() => setCloseCycleTargetGroup(selectedGroup)}
                      >
                        Close &amp; Lock Cycle
                      </Button>
                    ))}
                </div>

                {selectedGroup.status !== "ARCHIVED" && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-outline-variant/50 pt-3">
                    {selectedGroup.currentUserRole === "ADMIN" && (
                      <Button
                        type="button"
                        variant="danger-soft"
                        size="sm"
                        leftIcon={
                          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                        }
                        onClick={() => setArchiveTargetGroup(selectedGroup)}
                      >
                        Archive Group
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="danger-soft"
                      size="sm"
                      leftIcon={
                        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      }
                      onClick={() => setLeaveTargetGroup(selectedGroup)}
                    >
                      Leave Group
                    </Button>
                  </div>
                )}
              </Card>

              <Card
                variant="sub-card"
                padding="md"
                data-testid="member-invitation-gateway"
                className="flex flex-col justify-between gap-3 lg:col-span-6"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold uppercase tracking-wider text-on-surface">
                      Shareable Invite Link
                    </span>
                    <Share2
                      className="h-4 w-4 text-primary"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="text-[12px] leading-relaxed text-outline">
                    Members joining via this signed link are onboarded into{" "}
                    {selectedGroup.name} using{" "}
                    {selectedGroup.defaultSplitMode === "EQUAL"
                      ? "equal split shares"
                      : "custom split ratios (0% initial share until reviewed)"}
                    .
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
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
                      value={buildInvitePath(selectedGroup)}
                      className="font-mono text-[12px]"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={() => void handleCopyInviteLink(selectedGroup)}
                    leftIcon={
                      copiedGroupId === selectedGroup.id ? (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      )
                    }
                  >
                    {copiedGroupId === selectedGroup.id ? "Copied" : "Copy"}
                  </Button>
                  <span role="status" aria-live="polite" className="sr-only">
                    {copyStatusText}
                  </span>
                </div>

                <div className="flex items-center justify-between border-t border-outline-variant/50 pt-2 text-[11px] text-outline">
                  <span>Slug: {selectedGroup.slug}</span>
                  {selectedGroup.currentUserRole === "ADMIN" &&
                  selectedGroup.status !== "ARCHIVED" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      loading={regeneratingGroupId === selectedGroup.id}
                      onClick={() =>
                        void handleRegenerateInviteLink(selectedGroup)
                      }
                      className="h-7 px-2.5 text-[11px] font-semibold text-primary"
                    >
                      Regenerate Link
                    </Button>
                  ) : (
                    <span>Member view · Copy only</span>
                  )}
                </div>
              </Card>
            </div>
          )}
        </Card>
      )}

      {/* Create / Edit Group Modal */}
      <CreateGroupModal
        open={groupModalState.open}
        mode={groupModalState.mode}
        group={groupModalState.group}
        currentUserName={currentUser?.fullName ?? "You"}
        currentUserEmail={currentUser?.email ?? ""}
        onClose={() =>
          setGroupModalState((prev) => ({ ...prev, open: false }))
        }
        defaultCurrency={defaultCurrency}
        onCreated={handleGroupCreated}
        onUpdated={handleGroupUpdated}
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

      {archiveTargetGroup && (
        <ConfirmDialog
          open={Boolean(archiveTargetGroup)}
          onClose={() => {
            if (!actionLoading) setArchiveTargetGroup(null);
          }}
          onConfirm={handleArchiveGroupConfirm}
          title={`Archive ${archiveTargetGroup.name}?`}
          variant="danger"
          loading={actionLoading}
          confirmLabel="Archive Group"
          description={`Current Net Ledger: ${formatMinorUnits(
            archiveTargetGroup.userNetLedgerCents,
            archiveTargetGroup.baseCurrency,
            { showPlus: true },
          )}. Archiving transitions ${archiveTargetGroup.name} to ARCHIVED (read-only), blocking new expenses, settlements, and split rule edits until restored.`}
        />
      )}

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

      {closeCycleTargetGroup && (
        <ConfirmDialog
          open={Boolean(closeCycleTargetGroup)}
          onClose={() => {
            if (!actionLoading) setCloseCycleTargetGroup(null);
          }}
          onConfirm={handleCloseCycleConfirm}
          title={`Close & Lock ${cycleLabel}?`}
          variant="danger"
          loading={actionLoading}
          confirmLabel="Close & Lock Cycle"
          description={`Closing ${cycleLabel} for ${closeCycleTargetGroup.name} permanently locks all expenses in this billing period. Future corrections will require logging an Offsetting Adjustment.`}
        />
      )}

      {toasts.length > 0 && (
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      )}
    </div>
  );
}
