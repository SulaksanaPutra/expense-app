"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  LiveSyncStatus,
  ShellGroupSummary,
  ShellNotificationItem,
  ShellUserSummary,
} from "./types";
import {
  ALL_GROUPS_VALUE,
  buildShellHref,
  getCurrentCycleSlug,
  isValidCycleSlug,
  mergeShellSearchParams,
  parseCycleParam,
  parseGroupParam,
  stepCycleSlug,
} from "./url-state";

export const SIDEBAR_COLLAPSED_STORAGE_KEY = "ledgersplit:sidebar-collapsed";
const SIDEBAR_STORAGE_EVENT = "ledgersplit:sidebar-collapsed-change";

function subscribeSidebarCollapsed(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SIDEBAR_COLLAPSED_STORAGE_KEY) {
      callback();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SIDEBAR_STORAGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SIDEBAR_STORAGE_EVENT, callback);
  };
}

function getSidebarCollapsedSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getSidebarCollapsedServerSnapshot(): boolean {
  return false;
}

function writeSidebarCollapsed(next: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      next ? "true" : "false",
    );
    window.dispatchEvent(new Event(SIDEBAR_STORAGE_EVENT));
  } catch {
    // Ignore storage quota or private browsing errors.
  }
}

function subscribeOnlineStatus(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

function getOnlineServerSnapshot(): boolean {
  return true;
}

export interface ActiveGroupContextValue {
  pathname: string;
  groups: ShellGroupSummary[];
  activeGroupCount: number;
  activeGroupId: string;
  activeGroup: ShellGroupSummary | null;
  cycle: string;
  user: ShellUserSummary | null;
  updateReceiptStorageUsedBytes: (usedBytes: number) => void;
  liveSyncStatus: LiveSyncStatus;
  notifications: ShellNotificationItem[];
  unreadNotificationCount: number;
  markAllNotificationsRead: () => void;
  setActiveGroup: (groupId: string) => void;
  upsertGroup: (
    group: ShellGroupSummary,
    options?: { activate?: boolean },
  ) => void;
  setCycle: (cycle: string) => void;
  stepCycle: (deltaMonths: number) => void;
  buildNavHref: (
    targetPathname: string,
    extraParams?: Record<string, string | null | undefined>,
  ) => string;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: (open: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  addExpenseOpen: boolean;
  openAddExpense: () => void;
  closeAddExpense: () => void;
}

const ActiveGroupContext = React.createContext<ActiveGroupContextValue | null>(
  null,
);

export interface ActiveGroupProviderProps {
  groups: ShellGroupSummary[];
  user?: ShellUserSummary | null;
  initialGroupId?: string;
  initialCycle?: string;
  liveSyncStatus?: LiveSyncStatus;
  initialNotifications?: ShellNotificationItem[];
  onAddExpense?: () => void;
  children: React.ReactNode;
}

export function ActiveGroupProvider({
  groups,
  user = null,
  initialGroupId,
  initialCycle,
  liveSyncStatus: controlledSyncStatus,
  initialNotifications = [],
  onAddExpense,
  children,
}: ActiveGroupProviderProps) {
  const router = useRouter();
  const pathname = usePathname() || "/dashboard";
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();

  const [localGroups, setLocalGroups] = React.useState<ShellGroupSummary[]>([]);

  const nonArchivedGroups = React.useMemo(() => {
    const byId = new Map<string, ShellGroupSummary>();
    for (const g of groups) {
      if (g.status !== "ARCHIVED") {
        byId.set(g.id, g);
      }
    }
    for (const g of localGroups) {
      if (g.status !== "ARCHIVED" && !byId.has(g.id)) {
        byId.set(g.id, g);
      }
    }
    return Array.from(byId.values());
  }, [groups, localGroups]);

  const availableIds = React.useMemo(
    () => nonArchivedGroups.map((g) => g.id),
    [nonArchivedGroups],
  );

  const rawUrlGroup = searchParams.get("group");
  const rawUrlCycle = searchParams.get("cycle");

  const defaultCycle = React.useMemo(
    () => parseCycleParam(initialCycle, getCurrentCycleSlug()),
    [initialCycle],
  );

  const [optimistic, setOptimistic] = React.useState<{
    forSearchKey: string;
    group?: string;
    cycle?: string;
  }>({ forSearchKey: searchKey });

  const isOptimisticActive = optimistic.forSearchKey === searchKey;

  const activeGroupId = React.useMemo(() => {
    if (isOptimisticActive && optimistic.group !== undefined) {
      return parseGroupParam(optimistic.group, availableIds);
    }
    if (rawUrlGroup !== null) {
      return parseGroupParam(rawUrlGroup, availableIds);
    }
    return parseGroupParam(initialGroupId, availableIds);
  }, [
    availableIds,
    initialGroupId,
    isOptimisticActive,
    optimistic.group,
    rawUrlGroup,
  ]);

  const cycle = React.useMemo(() => {
    if (isOptimisticActive && optimistic.cycle !== undefined) {
      return parseCycleParam(optimistic.cycle, defaultCycle);
    }
    if (rawUrlCycle !== null) {
      return parseCycleParam(rawUrlCycle, defaultCycle);
    }
    return defaultCycle;
  }, [defaultCycle, isOptimisticActive, optimistic.cycle, rawUrlCycle]);

  const hasGroupInNav =
    rawUrlGroup !== null ||
    (isOptimisticActive && optimistic.group !== undefined) ||
    activeGroupId !== ALL_GROUPS_VALUE;

  const hasCycleInNav =
    isValidCycleSlug(rawUrlCycle) ||
    (isOptimisticActive && optimistic.cycle !== undefined) ||
    isValidCycleSlug(initialCycle);

  const activeGroup = React.useMemo(
    () => nonArchivedGroups.find((g) => g.id === activeGroupId) ?? null,
    [activeGroupId, nonArchivedGroups],
  );

  const upsertGroup = React.useCallback(
    (group: ShellGroupSummary, options?: { activate?: boolean }) => {
      setLocalGroups((prev) => {
        const idx = prev.findIndex((item) => item.id === group.id);
        if (idx === -1) {
          return [...prev, group];
        }
        const next = [...prev];
        next[idx] = group;
        return next;
      });

      if (options?.activate && group.status !== "ARCHIVED") {
        const nextCycleParam = hasCycleInNav ? cycle : undefined;

        setOptimistic((prev) => ({
          forSearchKey: searchKey,
          group: group.id,
          cycle:
            prev.forSearchKey === searchKey
              ? (prev.cycle ?? nextCycleParam)
              : nextCycleParam,
        }));

        const nextHref = mergeShellSearchParams(pathname, searchParams, {
          group: group.id,
          ...(nextCycleParam ? { cycle: nextCycleParam } : {}),
        });
        router.replace(nextHref, { scroll: false });
      }
    },
    [cycle, hasCycleInNav, pathname, router, searchKey, searchParams],
  );

  const setActiveGroup = React.useCallback(
    (nextGroupId: string) => {
      const normalized = parseGroupParam(nextGroupId, availableIds);
      const nextGroupParam = normalized;
      const nextCycleParam = hasCycleInNav ? cycle : undefined;

      setOptimistic((prev) => ({
        forSearchKey: searchKey,
        group: nextGroupParam,
        cycle:
          prev.forSearchKey === searchKey
            ? (prev.cycle ?? nextCycleParam)
            : nextCycleParam,
      }));

      const nextHref = mergeShellSearchParams(pathname, searchParams, {
        group: nextGroupParam,
        ...(nextCycleParam ? { cycle: nextCycleParam } : {}),
      });
      router.replace(nextHref, { scroll: false });
    },
    [
      availableIds,
      cycle,
      hasCycleInNav,
      pathname,
      router,
      searchKey,
      searchParams,
    ],
  );

  const setCycle = React.useCallback(
    (nextCycle: string) => {
      const normalizedCycle = parseCycleParam(nextCycle, cycle);
      const nextGroupParam = hasGroupInNav ? activeGroupId : undefined;

      setOptimistic((prev) => ({
        forSearchKey: searchKey,
        group:
          prev.forSearchKey === searchKey
            ? (prev.group ?? nextGroupParam)
            : nextGroupParam,
        cycle: normalizedCycle,
      }));

      const nextHref = mergeShellSearchParams(pathname, searchParams, {
        ...(nextGroupParam ? { group: nextGroupParam } : {}),
        cycle: normalizedCycle,
      });
      router.replace(nextHref, { scroll: false });
    },
    [
      activeGroupId,
      cycle,
      hasGroupInNav,
      pathname,
      router,
      searchKey,
      searchParams,
    ],
  );

  const stepCycle = React.useCallback(
    (deltaMonths: number) => {
      setCycle(stepCycleSlug(cycle, deltaMonths));
    },
    [cycle, setCycle],
  );

  const buildNavHref = React.useCallback(
    (
      targetPathname: string,
      extraParams?: Record<string, string | null | undefined>,
    ) => {
      return buildShellHref(
        targetPathname,
        {
          group: hasGroupInNav ? activeGroupId : null,
          cycle: hasCycleInNav ? cycle : null,
        },
        extraParams,
      );
    },
    [activeGroupId, cycle, hasCycleInNav, hasGroupInNav],
  );

  const sidebarCollapsed = React.useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    getSidebarCollapsedServerSnapshot,
  );

  const setSidebarCollapsed = React.useCallback((next: boolean) => {
    writeSidebarCollapsed(next);
  }, []);

  const toggleSidebarCollapsed = React.useCallback(() => {
    const current = getSidebarCollapsedSnapshot();
    writeSidebarCollapsed(!current);
  }, []);

  const isOnline = React.useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineSnapshot,
    getOnlineServerSnapshot,
  );

  const liveSyncStatus: LiveSyncStatus =
    controlledSyncStatus ?? (isOnline ? "subscribed" : "offline");

  const [mobileDrawerOpen, setMobileDrawerOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = React.useState(false);
  const [notifications, setNotifications] =
    React.useState<ShellNotificationItem[]>(initialNotifications);
  const [userStorageOverride, setUserStorageOverride] = React.useState<{
    userId: string;
    baseBytes: number | undefined;
    overrideBytes: number;
  } | null>(null);

  const effectiveUser = React.useMemo<ShellUserSummary | null>(() => {
    if (!user) return null;
    if (
      userStorageOverride &&
      userStorageOverride.userId === user.id &&
      userStorageOverride.baseBytes === user.receiptStorageUsedBytes
    ) {
      return {
        ...user,
        receiptStorageUsedBytes: userStorageOverride.overrideBytes,
      };
    }
    return user;
  }, [user, userStorageOverride]);

  const updateReceiptStorageUsedBytes = React.useCallback(
    (usedBytes: number) => {
      if (!user || !Number.isFinite(usedBytes) || usedBytes < 0) return;
      setUserStorageOverride({
        userId: user.id,
        baseBytes: user.receiptStorageUsedBytes,
        overrideBytes: Math.trunc(usedBytes),
      });
    },
    [user],
  );

  const markAllNotificationsRead = React.useCallback(() => {
    setNotifications((prev) => prev.map((item) => ({ ...item, unread: false })));
  }, []);

  const unreadNotificationCount = React.useMemo(
    () => notifications.filter((n) => n.unread).length,
    [notifications],
  );

  const openAddExpense = React.useCallback(() => {
    if (onAddExpense) {
      onAddExpense();
      return;
    }
    setAddExpenseOpen(true);
  }, [onAddExpense]);

  const closeAddExpense = React.useCallback(() => {
    setAddExpenseOpen(false);
  }, []);

  const value = React.useMemo<ActiveGroupContextValue>(
    () => ({
      pathname,
      groups: nonArchivedGroups,
      activeGroupCount: nonArchivedGroups.length,
      activeGroupId,
      activeGroup,
      cycle,
      user: effectiveUser,
      updateReceiptStorageUsedBytes,
      liveSyncStatus,
      notifications,
      unreadNotificationCount,
      markAllNotificationsRead,
      setActiveGroup,
      upsertGroup,
      setCycle,
      stepCycle,
      buildNavHref,
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebarCollapsed,
      mobileDrawerOpen,
      setMobileDrawerOpen,
      searchOpen,
      setSearchOpen,
      addExpenseOpen,
      openAddExpense,
      closeAddExpense,
    }),
    [
      activeGroup,
      activeGroupId,
      addExpenseOpen,
      buildNavHref,
      closeAddExpense,
      cycle,
      liveSyncStatus,
      markAllNotificationsRead,
      mobileDrawerOpen,
      nonArchivedGroups,
      notifications,
      openAddExpense,
      pathname,
      searchOpen,
      setActiveGroup,
      upsertGroup,
      setCycle,
      setSidebarCollapsed,
      sidebarCollapsed,
      stepCycle,
      toggleSidebarCollapsed,
      unreadNotificationCount,
      effectiveUser,
      updateReceiptStorageUsedBytes,
    ],
  );

  return (
    <ActiveGroupContext.Provider value={value}>
      {children}
    </ActiveGroupContext.Provider>
  );
}

export function useActiveGroup(): ActiveGroupContextValue {
  const ctx = React.useContext(ActiveGroupContext);
  if (!ctx) {
    throw new Error("useActiveGroup must be used within ActiveGroupProvider");
  }
  return ctx;
}
