import type {
  GroupCategory,
  GroupStatus,
  GroupType,
  MemberRole,
  MemberStatus,
  SplitMode,
} from "@/types/database";
import type { GroupAuditLogEntry } from "./audit-log";
import type { ReminderCooldownInfo } from "./reminders";

export interface CreateGroupInput {
  name: string;
  category: GroupCategory;
  group_type: GroupType;
  base_currency: string;
  default_split_mode: SplitMode;
  operational_budget_cents: number | null;
  billing_cycle_anchor_day: number;
  lease_end_date: string | null;
  member_emails: string[];
}

export interface UpdateGroupInput {
  name?: string;
  category?: GroupCategory;
  base_currency?: string;
  default_split_mode?: SplitMode;
  add_member_emails?: string[];
  remove_member_ids?: string[];
}

export interface SplitGroupMemberDetail {
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  sharePercentage: number;
  paidThisPeriodCents: number;
  netBalanceCents: number;
  isCurrentUser: boolean;
}

export interface SplitGroupDetail {
  id: string;
  name: string;
  slug: string;
  groupType: GroupType;
  category?: GroupCategory;
  status: GroupStatus;
  baseCurrency: string;
  defaultSplitMode: SplitMode;
  simplifyDebts: boolean;
  operationalBudgetCents: number | null;
  billingCycleAnchorDay: number;
  leaseEndDate: string | null;
  tripAutoArchiveEnabled?: boolean;
  tripAutoArchiveDays?: number;
  residentialLeasePromptEnabled?: boolean;
  zeroBalanceSince?: string | null;
  leasePromptSnoozedUntil?: string | null;
  shouldPromptLeaseArchive?: boolean;
  daysSinceLeaseEnd?: number | null;
  archivedAt?: string | null;
  inviteToken: string;
  inviteTokenVersion?: number;
  cycleTurnoverCents: number;
  cycleTransactionCount: number;
  userNetLedgerCents: number;
  recurringRuleCount: number;
  isFullySettled: boolean;
  isCurrentCycleClosed?: boolean;
  members: SplitGroupMemberDetail[];
  currentUserRole: MemberRole | null;
  auditLogs?: GroupAuditLogEntry[];
}

export interface SplitGroupsPageData {
  activeGroups: SplitGroupDetail[];
  archivedGroups: SplitGroupDetail[];
  cycleSlug: string;
  reminderCooldowns?: ReminderCooldownInfo[];
  loadError: string | null;
}
