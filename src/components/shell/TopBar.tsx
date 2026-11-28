"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Keyboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  User,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  SearchInput,
  SegmentedControl,
  Select,
  ToastContainer,
} from "@/components/ui";
import type { SegmentedOption, ToastItem } from "@/components/ui";
import { AddEditExpenseModal } from "@/components/expenses";
import { cn } from "@/lib/cn";
import { formatMinorUnits } from "@/lib/money";
import { useActiveGroup } from "./ActiveGroupContext";
import { getNotificationTypeLabel } from "./notifications";
import type { ShellNotificationItem } from "./types";
import {
  buildShellHref,
  formatCycleLabel,
  getCyclePickerOptions,
} from "./url-state";

interface GlobalSearchExpenseResult {
  id: string;
  groupId: string;
  groupName: string;
  description: string;
  category: string;
  amountCents: number;
  currency: string;
  expenseDate: string;
  cycleSlug: string;
}

type NotificationFilter = "all" | "unread";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "CA$",
  AUD: "A$",
  JPY: "¥",
  CHF: "CHF",
  SGD: "S$",
  INR: "₹",
};

function formatCurrencyBadge(currencyCode?: string | null): string {
  const code = (currencyCode || "USD").trim().toUpperCase();
  if (CURRENCY_SYMBOLS[code]) {
    return `${code} (${CURRENCY_SYMBOLS[code]})`;
  }
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    const symbol = parts.find((p) => p.type === "currency")?.value;
    if (symbol && symbol !== code) {
      return `${code} (${symbol})`;
    }
  } catch {
    // Fallback to bare ISO code.
  }
  return code;
}

function getNotificationActorName(item: ShellNotificationItem): string | null {
  if (item.type === "LEASE_ARCHIVE_PROMPT") {
    return null;
  }
  const source = `${item.title} ${item.description}`.trim();
  const match = source.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+/);
  if (match && !["New", "Share", "Settlement", "Cycle", "You"].includes(match[1])) {
    return match[1];
  }
  return item.title;
}

export interface TopBarProps {
  mobileMenuButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export function TopBar({ mobileMenuButtonRef }: TopBarProps) {
  const router = useRouter();
  const {
    groups,
    activeGroupId,
    cycle,
    user,
    updateReceiptStorageUsedBytes,
    notifications,
    unreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead,
    setCycle,
    stepCycle,
    buildNavHref,
    mobileDrawerOpen,
    setMobileDrawerOpen,
    searchOpen,
    setSearchOpen,
    addExpenseOpen,
    openAddExpense,
    closeAddExpense,
  } = useActiveGroup();

  const [notifOpen, setNotifOpen] = React.useState(false);
  const [notifFilter, setNotifFilter] = React.useState<NotificationFilter>("all");
  const [accountMenuOpen, setAccountMenuOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchExpenses, setSearchExpenses] = React.useState<
    GlobalSearchExpenseResult[]
  >([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const toastCounterRef = React.useRef(0);
  const notifContainerRef = React.useRef<HTMLDivElement>(null);
  const accountContainerRef = React.useRef<HTMLDivElement>(null);
  const signOutFormRef = React.useRef<HTMLFormElement>(null);

  const pushToast = React.useCallback((toast: Omit<ToastItem, "id">) => {
    toastCounterRef.current += 1;
    const id = `shell-toast-${toastCounterRef.current}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const cycleOptions = React.useMemo(
    () => getCyclePickerOptions(cycle),
    [cycle],
  );

  React.useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setNotifOpen(false);
        setAccountMenuOpen(false);
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [setSearchOpen]);

  React.useEffect(() => {
    if (!notifOpen) return;

    const handleOutside = (event: MouseEvent) => {
      if (
        notifContainerRef.current &&
        !notifContainerRef.current.contains(event.target as Node)
      ) {
        setNotifOpen(false);
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotifOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [notifOpen]);

  React.useEffect(() => {
    if (!accountMenuOpen) return;

    const handleOutside = (event: MouseEvent) => {
      if (
        accountContainerRef.current &&
        !accountContainerRef.current.contains(event.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [accountMenuOpen]);

  const handleSignOut = React.useCallback(() => {
    setAccountMenuOpen(false);
    const form = signOutFormRef.current;
    if (!form) return;
    if (typeof form.requestSubmit === "function") {
      try {
        form.requestSubmit();
        return;
      } catch {
        // Fallback to submit() when requestSubmit is unsupported.
      }
    }
    form.submit();
  }, []);

  const handleExportMonthlyLedger = React.useCallback(() => {
    setAccountMenuOpen(false);
    const params = new URLSearchParams({
      group: activeGroupId,
      cycle,
      format: "csv",
    });
    const exportUrl = `/api/expenses/export?${params.toString()}`;
    if (typeof document !== "undefined") {
      const link = document.createElement("a");
      link.href = exportUrl;
      link.download = `ledgersplit-${cycle}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    pushToast({
      tone: "info",
      title: "Export started",
      description: `Downloading ${formatCycleLabel(cycle, "long")} ledger CSV.`,
    });
  }, [activeGroupId, cycle, pushToast]);

  const displayName = user?.fullName?.trim() || user?.email || "LedgerSplit User";
  const displayEmail = user?.email?.trim() || "";
  const defaultCurrencyLabel = formatCurrencyBadge(
    user?.displayCurrency || user?.baseCurrency || "USD",
  );

  const notificationFilterOptions = React.useMemo<
    Array<SegmentedOption<NotificationFilter>>
  >(
    () => [
      { value: "all", label: "All" },
      { value: "unread", label: `Unread (${unreadNotificationCount})` },
    ],
    [unreadNotificationCount],
  );

  const visibleNotifications = React.useMemo(() => {
    if (notifFilter === "unread") {
      return notifications.filter((item) => item.unread);
    }
    return notifications;
  }, [notifFilter, notifications]);

  const filteredGroups = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, searchQuery]);

  React.useEffect(() => {
    if (!searchOpen) {
      return;
    }

    const q = searchQuery.trim();
    if (!q) {
      return;
    }

    if (typeof fetch !== "function") {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setSearchExpenses([]);
          return;
        }
        const data = (await res.json()) as {
          expenses?: GlobalSearchExpenseResult[];
        };
        if (!controller.signal.aborted && Array.isArray(data.expenses)) {
          setSearchExpenses(data.expenses);
        }
      } catch {
        if (!controller.signal.aborted) {
          setSearchExpenses([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchOpen, searchQuery]);

  const trimmedSearchQuery = searchQuery.trim();
  const visibleSearchExpenses =
    searchOpen && trimmedSearchQuery.length > 0 ? searchExpenses : [];
  const visibleSearching =
    searchOpen && trimmedSearchQuery.length > 0 && isSearching;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    setSearchOpen(false);
    setSearchQuery("");
    setSearchExpenses([]);
    setIsSearching(false);
    router.push(
      buildNavHref("/expenses", trimmed ? { q: trimmed } : undefined),
    );
  };

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-outline-variant/60 bg-surface-container-lowest/85 backdrop-blur-md">
        <div className="flex h-16 w-full items-center justify-between gap-1.5 px-2.5 sm:gap-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none sm:gap-3">
            <Button
              ref={mobileMenuButtonRef}
              type="button"
              variant="icon-circle"
              size="sm"
              aria-label="Open navigation menu"
              aria-expanded={mobileDrawerOpen}
              aria-controls="mobile-nav-drawer"
              onClick={() => setMobileDrawerOpen(true)}
              className="!h-8 !w-8 shrink-0 lg:!hidden"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </Button>

            <div
              role="group"
              aria-label="Billing cycle picker"
              className="flex h-9 min-w-0 flex-1 items-center gap-0.5 rounded-full border border-outline-variant/60 bg-surface-container-lowest px-1 shadow-2xs sm:flex-none"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Previous billing cycle"
                onClick={() => stepCycle(-1)}
                className="!h-7 !w-6 shrink-0 !px-0 text-on-surface-variant hover:bg-surface-container-low sm:!w-7"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Button>
              <Select
                aria-label="Select billing cycle"
                variant="pill-select"
                options={cycleOptions}
                value={cycle}
                selectedLabel={
                  <>
                    <span className="sm:hidden">
                      {formatCycleLabel(cycle, "short")}
                    </span>
                    <span className="hidden sm:inline">
                      {formatCycleLabel(cycle, "long")}
                    </span>
                  </>
                }
                onChange={setCycle}
                containerClassName="min-w-0 flex-1 sm:flex-none"
                className="!h-7 w-full min-w-0 max-w-full border-transparent bg-transparent !gap-1 !px-1 text-[12px] font-semibold tracking-tight text-on-surface hover:bg-surface-container-low sm:w-auto sm:!gap-2 sm:!px-2.5 sm:text-[13px]"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Next billing cycle"
                onClick={() => stepCycle(1)}
                className="!h-7 !w-6 shrink-0 !px-0 text-on-surface-variant hover:bg-surface-container-low sm:!w-7"
              >
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="Search expenses and groups"
              aria-haspopup="dialog"
              onClick={() => setSearchOpen(true)}
              className="!hidden h-9 w-56 justify-between border-outline-variant/60 bg-surface-container-low px-3 text-body-sm font-normal text-outline hover:border-outline/40 hover:bg-surface-container-lowest hover:text-on-surface md:!inline-flex lg:w-64"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Search className="h-4 w-4 shrink-0 text-outline" aria-hidden="true" />
                <span className="truncate">Search transactions...</span>
              </span>
              <kbd className="rounded border border-outline-variant/60 bg-surface-container-lowest px-1.5 py-0.5 font-sans text-[10px] font-medium text-outline">
                ⌘K
              </kbd>
            </Button>

            <Button
              type="button"
              variant="icon-circle"
              size="sm"
              aria-label="Search expenses and groups"
              aria-haspopup="dialog"
              onClick={() => setSearchOpen(true)}
              className="!h-8 !w-8 border-outline-variant/60 md:!hidden"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </Button>

            <div ref={notifContainerRef} className="relative">
              <Button
                type="button"
                variant="icon-circle"
                size="sm"
                aria-label={
                  unreadNotificationCount > 0
                    ? `Notifications (${unreadNotificationCount} unread)`
                    : "Notifications"
                }
                aria-expanded={notifOpen}
                aria-controls="topbar-notifications-popover"
                onClick={() => {
                  setAccountMenuOpen(false);
                  setNotifOpen((prev) => !prev);
                }}
                className="relative !h-8 !w-8 border-outline-variant/60 bg-surface-container-lowest sm:!h-9 sm:!w-9"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                {unreadNotificationCount > 0 && (
                  <span
                    aria-hidden="true"
                    data-testid="notification-unread-dot"
                    className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-error ring-2 ring-surface-container-lowest"
                  />
                )}
              </Button>

              {notifOpen && (
                <div
                  id="topbar-notifications-popover"
                  role="region"
                  aria-label="Notifications"
                  className="fixed inset-x-3 top-[4.25rem] z-40 overflow-hidden rounded-[18px] border border-hairline bg-surface-container-lowest shadow-[0_16px_40px_rgba(0,0,0,0.08)] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-divider-soft px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold tracking-tight text-on-surface">
                        Notifications
                      </span>
                      {unreadNotificationCount > 0 && (
                        <Badge tone="info" size="sm" className="tabular-nums">
                          {unreadNotificationCount} unread
                        </Badge>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={markAllNotificationsRead}
                      disabled={unreadNotificationCount === 0}
                      className="h-7 px-2 text-[12px] font-medium text-primary hover:bg-primary/5 hover:text-primary"
                    >
                      Mark all read
                    </Button>
                  </div>

                  <div className="border-b border-divider-soft bg-surface-pearl px-4 py-2.5">
                    <SegmentedControl
                      variant="pill-tabs"
                      ariaLabel="Filter notifications"
                      options={notificationFilterOptions}
                      value={notifFilter}
                      onChange={setNotifFilter}
                      className="[&>button]:px-3 [&>button]:py-1 [&>button]:text-[12px]"
                    />
                  </div>

                  {visibleNotifications.length === 0 ? (
                    <p className="px-4 py-6 text-center text-[12px] leading-relaxed text-outline">
                      {notifFilter === "unread"
                        ? "No unread notifications."
                        : "All caught up. New expenses, share revisions, and settlement nudges appear here."}
                    </p>
                  ) : (
                    <ul className="max-h-80 divide-y divide-divider-soft overflow-y-auto tabular-nums">
                      {visibleNotifications.map((item) => {
                        const typeLabel = getNotificationTypeLabel(item.type);
                        const actorName = getNotificationActorName(item);
                        const handleSelect = () => {
                          if (item.unread) {
                            markNotificationRead(item.id);
                          }
                          if (item.href) {
                            setNotifOpen(false);
                            router.push(item.href);
                          }
                        };
                        return (
                          <li key={item.id}>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={handleSelect}
                              className={cn(
                                "h-auto w-full items-start justify-start gap-3 rounded-none px-4 py-3.5 text-left font-normal whitespace-normal active:scale-100",
                                item.unread
                                  ? "bg-surface-pearl hover:bg-surface-container-low/70"
                                  : "bg-surface-container-lowest hover:bg-surface-pearl",
                              )}
                            >
                              {actorName ? (
                                <Avatar
                                  name={actorName}
                                  size="md"
                                  className="mt-0.5 ring-2 ring-surface-container-lowest"
                                />
                              ) : (
                                <span
                                  aria-hidden="true"
                                  className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary"
                                >
                                  <Calendar className="h-4 w-4" aria-hidden="true" />
                                </span>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-[12.5px] font-semibold leading-snug text-on-surface">
                                    {item.title}
                                  </span>
                                  {item.unread && (
                                    <span
                                      aria-hidden="true"
                                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                                    />
                                  )}
                                </div>
                                <p className="mt-0.5 text-[12px] leading-snug text-on-surface-variant">
                                  {item.description}
                                </p>
                                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-outline">
                                  <span>{item.timestamp}</span>
                                  {typeLabel && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>{typeLabel}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <Button
              type="button"
              variant="primary"
              size="sm"
              aria-label="Add Expense"
              onClick={openAddExpense}
              leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
              className="h-8 !px-2 sm:h-9 sm:!px-4"
            >
              <span className="hidden sm:inline">Add Expense</span>
            </Button>

            <div ref={accountContainerRef} className="relative">
              <Button
                type="button"
                variant="icon-circle"
                size="sm"
                aria-label="User profile menu"
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                aria-controls="topbar-account-menu"
                onClick={() => {
                  setNotifOpen(false);
                  setAccountMenuOpen((prev) => !prev);
                }}
                className="!h-8 !w-8 border-transparent bg-transparent p-0 hover:bg-transparent sm:!h-9 sm:!w-9"
              >
                <Avatar
                  name={displayName}
                  src={user?.avatarUrl}
                  size="md"
                  toneClassName="bg-primary-container text-on-primary"
                  className="h-8 w-8 text-[12px] sm:h-9 sm:w-9 sm:text-[13px]"
                />
              </Button>

              {accountMenuOpen && (
                <div
                  id="topbar-account-menu"
                  role="menu"
                  aria-label="User account menu"
                  className="fixed right-3 top-[4.25rem] z-40 w-[min(18rem,calc(100vw-1.5rem))] overflow-hidden rounded-[18px] border border-hairline bg-surface-container-lowest shadow-[0_16px_40px_rgba(0,0,0,0.08)] sm:absolute sm:top-full sm:right-0 sm:mt-2 sm:w-72"
                >
                  <div className="flex items-center gap-3 border-b border-divider-soft p-4">
                    <Avatar
                      name={displayName}
                      src={user?.avatarUrl}
                      size="md"
                      toneClassName="bg-primary-container text-on-primary"
                      className="h-10 w-10 text-[13px]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold leading-tight text-on-surface">
                        {displayName}
                      </p>
                      {displayEmail && (
                        <p className="mt-0.5 truncate text-[12px] leading-tight text-outline">
                          {displayEmail}
                        </p>
                      )}
                    </div>
                  </div>

                  <Card
                    variant="sub-card"
                    padding="none"
                    className="mx-3 mt-3 flex items-center justify-between rounded-[14px] border-hairline bg-surface px-3 py-2.5 text-[12px]"
                  >
                    <span className="font-medium text-outline">
                      Default Currency
                    </span>
                    <span className="font-semibold text-on-surface tabular-nums">
                      {defaultCurrencyLabel}
                    </span>
                  </Card>

                  <div className="mt-1 flex flex-col gap-0.5 p-2">
                    <Button
                      type="button"
                      role="menuitem"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        router.push(buildNavHref("/settings"));
                      }}
                      leftIcon={
                        <User className="h-3.5 w-3.5 text-outline" aria-hidden="true" />
                      }
                      className="h-8 w-full justify-start rounded-lg px-2.5 text-[12.5px] font-medium text-on-surface hover:bg-surface-pearl active:scale-100"
                    >
                      Account &amp; Profile
                    </Button>

                    <Button
                      type="button"
                      role="menuitem"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        router.push(buildNavHref("/settings"));
                      }}
                      leftIcon={
                        <Settings className="h-3.5 w-3.5 text-outline" aria-hidden="true" />
                      }
                      className="h-8 w-full justify-start rounded-lg px-2.5 text-[12.5px] font-medium text-on-surface hover:bg-surface-pearl active:scale-100"
                    >
                      Settings
                    </Button>

                    <Button
                      type="button"
                      role="menuitem"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setSearchOpen(true);
                      }}
                      className="h-8 w-full justify-between rounded-lg px-2.5 text-[12.5px] font-medium text-on-surface hover:bg-surface-pearl active:scale-100"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Keyboard className="h-3.5 w-3.5 text-outline" aria-hidden="true" />
                        <span className="truncate">Keyboard Shortcuts</span>
                      </span>
                      <kbd className="rounded-md border border-hairline bg-surface-container-lowest px-1.5 py-0.5 font-mono text-[11px] font-medium text-outline">
                        ⌘K
                      </kbd>
                    </Button>

                    <Button
                      type="button"
                      role="menuitem"
                      variant="ghost"
                      size="sm"
                      onClick={handleExportMonthlyLedger}
                      leftIcon={
                        <Download className="h-3.5 w-3.5 text-outline" aria-hidden="true" />
                      }
                      className="h-8 w-full justify-start rounded-lg px-2.5 text-[12.5px] font-medium text-on-surface hover:bg-surface-pearl active:scale-100"
                    >
                      Export Monthly Ledger
                    </Button>
                  </div>

                  <div className="mx-2 my-1 border-t border-divider-soft" />

                  <div className="p-2 pt-1">
                    <Button
                      type="button"
                      role="menuitem"
                      variant="ghost"
                      size="sm"
                      onClick={handleSignOut}
                      leftIcon={
                        <LogOut className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
                      }
                      className="h-8 w-full justify-start rounded-lg px-2.5 text-[12.5px] font-medium text-danger hover:bg-red-50 hover:text-danger active:scale-100"
                    >
                      Sign Out
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <form
              ref={signOutFormRef}
              action="/auth/signout"
              method="POST"
              className="hidden"
              aria-hidden="true"
            />
          </div>
        </div>
      </header>

      <Dialog
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false);
          setSearchQuery("");
        }}
        title="Quick Search"
        description="Jump to expenses or switch into an active split group."
        size="md"
      >
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-4">
          <SearchInput
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery("")}
            placeholder="Search expenses, merchants, or split groups..."
            shortcut="Enter"
          />

          {searchQuery.trim().length > 0 && (
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              className="justify-between"
            >
              <span>
                Search expenses for &ldquo;{searchQuery.trim()}&rdquo;
              </span>
              <Badge tone="info" size="sm">
                Expenses
              </Badge>
            </Button>
          )}

          {trimmedSearchQuery.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-label-sm uppercase tracking-wider text-outline">
                  Matching Expenses
                </span>
                {visibleSearching && (
                  <span className="text-[11px] text-outline">Searching...</span>
                )}
              </div>
              {visibleSearchExpenses.length === 0 ? (
                !visibleSearching && (
                  <p className="rounded-sm bg-surface-container-low px-3 py-2.5 text-[12px] text-outline">
                    No matching expense records found.
                  </p>
                )
              ) : (
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {visibleSearchExpenses.map((exp) => (
                    <li key={exp.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setSearchOpen(false);
                          setSearchQuery("");
                          router.push(
                            buildShellHref(
                              "/expenses",
                              { group: exp.groupId, cycle: exp.cycleSlug },
                              { q: exp.description },
                            ),
                          );
                        }}
                        className="h-auto w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-[13px] font-normal text-on-surface hover:bg-surface-container-low active:scale-100"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {exp.description}
                          </span>
                          <span className="block truncate text-[11px] text-outline">
                            {exp.groupName} · {exp.category} ·{" "}
                            {exp.expenseDate.slice(0, 10)}
                          </span>
                        </span>
                        <span className="shrink-0 text-[12px] font-semibold text-on-surface tabular-nums">
                          {formatMinorUnits(exp.amountCents, exp.currency)}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-label-sm uppercase tracking-wider text-outline">
              Split Groups
            </span>
            {filteredGroups.length === 0 ? (
              <p className="rounded-sm bg-surface-container-low px-3 py-3 text-[13px] text-outline">
                No matching groups found.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {filteredGroups.map((group) => (
                  <li key={group.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setSearchOpen(false);
                        setSearchQuery("");
                        router.push(
                          buildNavHref("/split-groups", { group: group.id }),
                        );
                      }}
                      className="h-auto w-full items-center justify-between rounded-sm px-3 py-2 text-left text-[13px] font-normal text-on-surface hover:bg-surface-container-low active:scale-100"
                    >
                      <span className="font-medium">{group.name}</span>
                      <span className="text-[12px] text-outline tabular-nums">
                        {group.activeSplitCount} splits · {group.baseCurrency}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </form>
      </Dialog>

      <AddEditExpenseModal
        open={addExpenseOpen}
        onClose={closeAddExpense}
        mode="create"
        groups={groups}
        activeGroupId={activeGroupId}
        currentUser={user}
        cycle={cycle}
        onReceiptStorageUsedBytesChange={updateReceiptStorageUsedBytes}
        onCreated={(expense) => {
          pushToast({
            tone: "success",
            title: "Expense logged",
            description: `${expense.description} (${formatMinorUnits(expense.amount_cents, expense.currency)}) saved.`,
          });
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("ledgersplit:expense-created", { detail: expense }),
            );
          }
          router.refresh();
        }}
      />

      {toasts.length > 0 && (
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      )}
    </>
  );
}
