"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { hasSupabasePublicEnv } from "@/lib/supabase/env";
import {
  mapDbNotificationToShellItem,
  mapRealtimeStatusToLiveSync,
  REALTIME_LEDGER_CHANGE_EVENT,
  type DbNotificationSelectRow,
} from "./notifications";
import type {
  LiveSyncStatus,
  RealtimeLedgerChangeDetail,
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
  updateUserPreferences: (patch: Partial<ShellUserSummary>) => void;
  updateGroupPreferences: (
    groupId: string,
    patch: Partial<ShellGroupSummary>,
  ) => void;
  liveSyncStatus: LiveSyncStatus;
  notifications: ShellNotificationItem[];
  unreadNotificationCount: number;
  markNotificationRead: (id: string) => void;
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
  const routerRef = React.useRef(router);
  React.useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const pathname = usePathname() || "/dashboard";
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();

  const [localGroups, setLocalGroups] = React.useState<ShellGroupSummary[]>([]);
  const [groupOverrides, setGroupOverrides] = React.useState<
    Record<string, Partial<ShellGroupSummary>>
  >({});

  const nonArchivedGroups = React.useMemo(() => {
    const byId = new Map<string, ShellGroupSummary>();
    for (const g of groups) {
      if (g.status !== "ARCHIVED") {
        const override = groupOverrides[g.id];
        byId.set(g.id, override ? { ...g, ...override } : g);
      }
    }
    for (const g of localGroups) {
      if (g.status !== "ARCHIVED" && !byId.has(g.id)) {
        const override = groupOverrides[g.id];
        byId.set(g.id, override ? { ...g, ...override } : g);
      }
    }
    return Array.from(byId.values());
  }, [groupOverrides, groups, localGroups]);

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

  const hasRealtimeEnv = hasSupabasePublicEnv();
  const shouldSubscribeRealtime =
    controlledSyncStatus === undefined && Boolean(user?.id) && hasRealtimeEnv;

  const [realtimeSyncState, setRealtimeSyncState] = React.useState<{
    sessionKey: string;
    status: LiveSyncStatus;
  }>({ sessionKey: "", status: "syncing" });
  const needsCatchupRef = React.useRef(false);
  const channelSeqRef = React.useRef(0);
  const currentRealtimeSessionKey =
    shouldSubscribeRealtime && isOnline && user?.id ? user.id : "";

  const liveSyncStatus: LiveSyncStatus =
    controlledSyncStatus !== undefined
      ? controlledSyncStatus
      : !isOnline
        ? "offline"
        : shouldSubscribeRealtime
          ? realtimeSyncState.sessionKey === currentRealtimeSessionKey
            ? realtimeSyncState.status
            : "syncing"
          : "subscribed";

  const [mobileDrawerOpen, setMobileDrawerOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = React.useState(false);
  const [readNotificationIds, setReadNotificationIds] = React.useState<
    Set<string>
  >(() => new Set());
  const [realtimeAddedNotifications, setRealtimeAddedNotifications] =
    React.useState<ShellNotificationItem[]>([]);
  const [realtimeNotificationPatches, setRealtimeNotificationPatches] =
    React.useState<Record<string, Partial<ShellNotificationItem>>>({});
  const [deletedNotificationIds, setDeletedNotificationIds] = React.useState<
    Set<string>
  >(() => new Set());
  const [userStorageOverride, setUserStorageOverride] = React.useState<{
    userId: string;
    baseBytes: number | undefined;
    overrideBytes: number;
  } | null>(null);
  const [userPrefOverride, setUserPrefOverride] = React.useState<{
    userId: string;
    patch: Partial<ShellUserSummary>;
  } | null>(null);

  React.useEffect(() => {
    if (!shouldSubscribeRealtime || !user?.id) {
      return;
    }

    if (!isOnline) {
      needsCatchupRef.current = true;
      return;
    }

    const sessionKey = user.id;
    let active = true;
    let refreshTimer: number | null = null;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const scheduleRefresh = () => {
      if (!active) return;
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (active) {
          routerRef.current.refresh?.();
        }
      }, 120);
    };

    const syncNotificationsFromApi = async () => {
      if (!active || typeof fetch !== "function") return;
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok || !active) return;
        const data = (await res.json()) as {
          notifications?: DbNotificationSelectRow[];
        };
        if (!active || !Array.isArray(data.notifications)) return;
        const mapped = data.notifications.map(mapDbNotificationToShellItem);
        setRealtimeAddedNotifications(mapped);
      } catch {
        // Non-fatal on transient network error during reconnect catch-up.
      }
    };

    const handleNotificationChange = (payload: {
      eventType?: string;
      new?: Record<string, unknown>;
      old?: Record<string, unknown>;
    }) => {
      if (!active) return;
      const eventType = payload.eventType;
      if (eventType === "INSERT" && payload.new) {
        const row = payload.new as unknown as DbNotificationSelectRow;
        if (row.id) {
          const item = mapDbNotificationToShellItem(row);
          setRealtimeAddedNotifications((prev) => {
            const withoutDup = prev.filter((n) => n.id !== item.id);
            return [item, ...withoutDup];
          });
          setDeletedNotificationIds((prev) => {
            if (!prev.has(item.id)) return prev;
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
        }
      } else if (eventType === "UPDATE" && payload.new) {
        const row = payload.new as unknown as Partial<DbNotificationSelectRow>;
        if (row.id) {
          setRealtimeNotificationPatches((prev) => ({
            ...prev,
            [row.id as string]: {
              ...(typeof row.is_read === "boolean"
                ? { unread: !row.is_read }
                : {}),
              ...(typeof row.title === "string" ? { title: row.title } : {}),
              ...(typeof row.description === "string"
                ? { description: row.description }
                : {}),
              ...(row.href !== undefined
                ? { href: row.href ?? undefined }
                : {}),
            },
          }));
        }
      } else if (eventType === "DELETE" && payload.old) {
        const oldId = payload.old.id;
        if (typeof oldId === "string" && oldId) {
          setDeletedNotificationIds((prev) => {
            const next = new Set(prev);
            next.add(oldId);
            return next;
          });
        }
      }
    };

    const handleLedgerTableChange = (
      table: string,
      payload: {
        eventType?: string;
        new?: Record<string, unknown>;
        old?: Record<string, unknown>;
      },
    ) => {
      if (!active) return;
      const eventType =
        payload.eventType === "INSERT" ||
        payload.eventType === "UPDATE" ||
        payload.eventType === "DELETE"
          ? payload.eventType
          : "UPDATE";
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent<RealtimeLedgerChangeDetail>(
            REALTIME_LEDGER_CHANGE_EVENT,
            {
              detail: {
                table,
                eventType,
                newRow: payload.new ?? null,
                oldRow: payload.old ?? null,
              },
            },
          ),
        );
      }
      scheduleRefresh();
    };

    const startSubscription = async () => {
      try {
        const authApi = supabase.auth as unknown as {
          getSession?: () => Promise<{
            data?: { session?: { access_token?: string } | null };
          }>;
        };
        if (typeof authApi?.getSession === "function") {
          const { data } = await authApi.getSession();
          const token = data?.session?.access_token;
          const realtimeApi = supabase.realtime as unknown as {
            setAuth?: (token?: string) => void;
          };
          if (token && typeof realtimeApi?.setAuth === "function") {
            realtimeApi.setAuth(token);
          }
        }
      } catch {
        // Non-fatal in unit-test mocks without auth.getSession.
      }

      if (!active) return;

      channelSeqRef.current += 1;
      channel = supabase
        .channel(`ledgersplit-live-${user.id}-${channelSeqRef.current}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          handleNotificationChange,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "expenses" },
          (payload) => handleLedgerTableChange("expenses", payload),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "expense_revisions" },
          (payload) => handleLedgerTableChange("expense_revisions", payload),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "settlements" },
          (payload) => handleLedgerTableChange("settlements", payload),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "billing_cycles" },
          (payload) => handleLedgerTableChange("billing_cycles", payload),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "groups" },
          (payload) => handleLedgerTableChange("groups", payload),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "group_members" },
          (payload) => handleLedgerTableChange("group_members", payload),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "recurring_rules" },
          (payload) => handleLedgerTableChange("recurring_rules", payload),
        )
        .subscribe((status) => {
          if (!active) return;
          const mappedStatus = mapRealtimeStatusToLiveSync(status, isOnline);
          setRealtimeSyncState({ sessionKey, status: mappedStatus });
          if (mappedStatus !== "subscribed") {
            needsCatchupRef.current = true;
          } else if (needsCatchupRef.current) {
            needsCatchupRef.current = false;
            void syncNotificationsFromApi();
            scheduleRefresh();
          }
        });
    };

    void startSubscription();

    return () => {
      active = false;
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      if (channel) {
        const removable = supabase as unknown as {
          removeChannel?: (ch: typeof channel) => Promise<unknown>;
        };
        if (typeof removable.removeChannel === "function") {
          void removable.removeChannel(channel);
        }
      }
    };
  }, [isOnline, shouldSubscribeRealtime, user?.id]);

  const notifications = React.useMemo<ShellNotificationItem[]>(() => {
    const byId = new Map<string, ShellNotificationItem>();
    for (const item of realtimeAddedNotifications) {
      if (!deletedNotificationIds.has(item.id)) {
        byId.set(item.id, item);
      }
    }
    for (const item of initialNotifications) {
      if (!deletedNotificationIds.has(item.id) && !byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }

    const merged = Array.from(byId.values()).map((item) => {
      const patch = realtimeNotificationPatches[item.id];
      const patched = patch ? { ...item, ...patch } : item;
      return readNotificationIds.has(patched.id)
        ? { ...patched, unread: false }
        : patched;
    });

    merged.sort((a, b) => {
      if (a.createdAt && b.createdAt) {
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      }
      return 0;
    });

    return merged.slice(0, 30);
  }, [
    deletedNotificationIds,
    initialNotifications,
    readNotificationIds,
    realtimeAddedNotifications,
    realtimeNotificationPatches,
  ]);

  const effectiveUser = React.useMemo<ShellUserSummary | null>(() => {
    if (!user) return null;
    let nextUser = user;
    if (userPrefOverride && userPrefOverride.userId === user.id) {
      nextUser = { ...nextUser, ...userPrefOverride.patch };
    }
    if (
      userStorageOverride &&
      userStorageOverride.userId === user.id &&
      userStorageOverride.baseBytes === user.receiptStorageUsedBytes
    ) {
      nextUser = {
        ...nextUser,
        receiptStorageUsedBytes: userStorageOverride.overrideBytes,
      };
    }
    return nextUser;
  }, [user, userPrefOverride, userStorageOverride]);

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

  const updateUserPreferences = React.useCallback(
    (patch: Partial<ShellUserSummary>) => {
      if (!user) return;
      setUserPrefOverride((prev) => ({
        userId: user.id,
        patch:
          prev && prev.userId === user.id ? { ...prev.patch, ...patch } : patch,
      }));
    },
    [user],
  );

  const updateGroupPreferences = React.useCallback(
    (groupId: string, patch: Partial<ShellGroupSummary>) => {
      if (!groupId) return;
      setGroupOverrides((prev) => ({
        ...prev,
        [groupId]: { ...(prev[groupId] ?? {}), ...patch },
      }));
    },
    [],
  );

  const markNotificationRead = React.useCallback((id: string) => {
    if (!id) return;
    setReadNotificationIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (typeof fetch === "function") {
      void fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      }).catch(() => {
        // Non-fatal in unit tests or offline contexts.
      });
    }
  }, []);

  const markAllNotificationsRead = React.useCallback(() => {
    setReadNotificationIds((prev) => {
      const next = new Set(prev);
      for (const item of notifications) {
        next.add(item.id);
      }
      return next;
    });
    if (typeof fetch === "function") {
      void fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {
        // Non-fatal in unit tests or offline contexts.
      });
    }
  }, [notifications]);

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
      updateUserPreferences,
      updateGroupPreferences,
      liveSyncStatus,
      notifications,
      unreadNotificationCount,
      markNotificationRead,
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
      markNotificationRead,
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
      updateUserPreferences,
      updateGroupPreferences,
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
