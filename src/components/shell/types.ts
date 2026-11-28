import type {
  ExpenseSplitMethod,
  GroupStatus,
  GroupType,
  MemberStatus,
  NotificationType,
  PaymentRail,
  SplitMode,
} from "@/types/database";

export interface ShellGroupMember {
  id: string;
  name: string;
  src?: string | null;
  initials?: string;
  sharePercentage?: number;
}

export interface ShellGroupSummary {
  id: string;
  name: string;
  slug?: string;
  status: GroupStatus;
  groupType: GroupType;
  baseCurrency: string;
  defaultSplitMode?: SplitMode;
  simplifyDebts?: boolean;
  currentUserStatus?: MemberStatus | null;
  activeSplitCount: number;
  members: ShellGroupMember[];
}

export interface ShellUserSummary {
  id: string;
  fullName: string;
  email: string;
  avatarUrl?: string | null;
  displayCurrency?: string;
  baseCurrency?: string;
  instantSettlementTag?: string | null;
  personalShareCapCents?: number | null;
  defaultSplitMethod?: ExpenseSplitMethod;
  defaultPaymentRail?: PaymentRail;
  receiptStorageUsedBytes?: number;
}

export interface ShellNotificationItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  createdAt?: string;
  unread: boolean;
  href?: string;
  type?: NotificationType;
  deltaCents?: number | null;
  currency?: string | null;
}

export interface RealtimeLedgerChangeDetail {
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  newRow: Record<string, unknown> | null;
  oldRow: Record<string, unknown> | null;
}
