import type { GroupStatus, GroupType, SplitMode } from "@/types/database";

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
  activeSplitCount: number;
  members: ShellGroupMember[];
}

export interface ShellUserSummary {
  id: string;
  fullName: string;
  email: string;
  avatarUrl?: string | null;
  receiptStorageUsedBytes?: number;
}

export interface ShellNotificationItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  unread: boolean;
  href?: string;
}

export type LiveSyncStatus = "subscribed" | "syncing" | "offline";
