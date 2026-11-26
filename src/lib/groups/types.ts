import type {
  GroupStatus,
  GroupType,
  MemberRole,
  MemberStatus,
  SplitMode,
} from "@/types/database";
import type { GroupAuditLogEntry } from "./audit-log";

export interface CreateGroupInput {
  name: string;
  group_type: GroupType;
  base_currency: string;
  operational_budget_cents: number | null;
  billing_cycle_anchor_day: number;
  lease_end_date: string | null;
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
  status: GroupStatus;
  baseCurrency: string;
  defaultSplitMode: SplitMode;
  simplifyDebts: boolean;
  operationalBudgetCents: number | null;
  billingCycleAnchorDay: number;
  leaseEndDate: string | null;
  inviteToken: string;
  inviteTokenVersion?: number;
  cycleTurnoverCents: number;
  cycleTransactionCount: number;
  userNetLedgerCents: number;
  recurringRuleCount: number;
  isFullySettled: boolean;
  members: SplitGroupMemberDetail[];
  currentUserRole: MemberRole | null;
  auditLogs?: GroupAuditLogEntry[];
}

export interface SplitGroupsPageData {
  activeGroups: SplitGroupDetail[];
  archivedGroups: SplitGroupDetail[];
  cycleSlug: string;
  loadError: string | null;
}
