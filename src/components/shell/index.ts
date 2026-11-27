export {
  ActiveGroupProvider,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  useActiveGroup,
} from "./ActiveGroupContext";
export type {
  ActiveGroupContextValue,
  ActiveGroupProviderProps,
} from "./ActiveGroupContext";

export { AppShell } from "./AppShell";
export type { AppShellProps } from "./AppShell";

export { MobileDrawer, Sidebar } from "./Sidebar";
export type { MobileDrawerProps } from "./Sidebar";

export { TopBar } from "./TopBar";
export type { TopBarProps } from "./TopBar";

export { LiveSyncPill } from "./LiveSyncPill";
export type { LiveSyncPillProps } from "./LiveSyncPill";

export type {
  LiveSyncStatus,
  RealtimeLedgerChangeDetail,
  ShellGroupMember,
  ShellGroupSummary,
  ShellNotificationItem,
  ShellUserSummary,
} from "./types";

export {
  REALTIME_LEDGER_CHANGE_EVENT,
  formatNotificationTimestamp,
  getNotificationTypeLabel,
  mapDbNotificationToShellItem,
  mapRealtimeStatusToLiveSync,
} from "./notifications";

export {
  ALL_GROUPS_VALUE,
  buildShellHref,
  formatCycleLabel,
  formatCycleSlug,
  getCurrentCycleSlug,
  getCyclePickerOptions,
  isValidCycleSlug,
  mergeShellSearchParams,
  parseCycleParam,
  parseGroupParam,
  stepCycleSlug,
} from "./url-state";
export type { CycleOption, ShellQueryState } from "./url-state";
