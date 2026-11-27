"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  Dropdown,
  SearchInput,
  Select,
  ToastContainer,
} from "@/components/ui";
import type { DropdownItem, ToastItem } from "@/components/ui";
import { AddEditExpenseModal } from "@/components/expenses";
import { cn } from "@/lib/cn";
import { formatMinorUnits } from "@/lib/money";
import { useActiveGroup } from "./ActiveGroupContext";
import { buildShellHref, getCyclePickerOptions } from "./url-state";

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
    notifications,
    unreadNotificationCount,
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
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchExpenses, setSearchExpenses] = React.useState<
    GlobalSearchExpenseResult[]
  >([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const toastCounterRef = React.useRef(0);
  const notifContainerRef = React.useRef<HTMLDivElement>(null);
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

  const handleSignOut = React.useCallback(() => {
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

  const displayName = user?.fullName?.trim() || user?.email || "LedgerSplit User";

  const profileMenuItems = React.useMemo<DropdownItem[]>(
    () => [
      {
        id: "settings",
        label: "Settings",
        icon: <Settings className="h-4 w-4" aria-hidden="true" />,
        onSelect: () => {
          router.push(buildNavHref("/settings"));
        },
      },
      { id: "profile-divider", separator: true },
      {
        id: "sign-out",
        label: "Sign Out",
        danger: true,
        icon: <LogOut className="h-4 w-4" aria-hidden="true" />,
        onSelect: handleSignOut,
      },
    ],
    [buildNavHref, handleSignOut, router],
  );

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
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/85 backdrop-blur-xl">
        <div className="flex h-16 w-full items-center justify-between gap-1.5 px-3 sm:gap-2 sm:px-6 lg:px-8">
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
              className="shrink-0 lg:hidden"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </Button>

            <div
              role="group"
              aria-label="Billing cycle picker"
              className="flex min-w-0 flex-1 items-center gap-0.5 rounded-pill border border-hairline bg-canvas-parchment px-1 py-0.5 sm:flex-none"
            >
              <span className="hidden shrink-0 sm:inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Previous billing cycle"
                  onClick={() => stepCycle(-1)}
                  className="h-7 w-7 px-0 text-ink-muted-80 hover:bg-canvas"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
              </span>
              <Select
                aria-label="Select billing cycle"
                variant="pill-select"
                options={cycleOptions}
                value={cycle}
                onChange={setCycle}
                containerClassName="min-w-0 flex-1 sm:flex-none"
                className="h-7 w-full min-w-0 max-w-full border-transparent bg-transparent !px-2 text-[11px] font-semibold tracking-tight text-ink hover:bg-canvas sm:w-auto sm:!px-2.5 sm:text-[12px]"
              />
              <span className="hidden shrink-0 sm:inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Next billing cycle"
                  onClick={() => stepCycle(1)}
                  className="h-7 w-7 px-0 text-ink-muted-80 hover:bg-canvas"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2.5">
            <button
              type="button"
              aria-label="Search expenses and groups"
              aria-haspopup="dialog"
              onClick={() => setSearchOpen(true)}
              className="hidden h-9 items-center gap-2 rounded-pill border border-hairline bg-canvas-parchment px-3 text-[12px] text-ink-muted-48 transition-colors hover:border-ink-muted-48/40 hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2 md:inline-flex"
            >
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="w-32 truncate text-left lg:w-40">
                Search transactions...
              </span>
              <kbd className="rounded-xs border border-hairline bg-canvas px-1.5 py-0.5 font-sans text-[10px] font-medium text-ink-muted-48">
                ⌘K
              </kbd>
            </button>

            <Button
              type="button"
              variant="icon-circle"
              size="sm"
              aria-label="Search expenses and groups"
              aria-haspopup="dialog"
              onClick={() => setSearchOpen(true)}
              className="md:hidden"
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
                aria-haspopup="true"
                onClick={() => setNotifOpen((prev) => !prev)}
                className="relative"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                {unreadNotificationCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-canvas"
                  />
                )}
              </Button>

              {notifOpen && (
                <div
                  role="region"
                  aria-label="Notifications"
                  className="absolute top-full right-0 z-40 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-[18px] border border-hairline bg-canvas p-3 shadow-[0_12px_32px_rgba(0,0,0,0.1)]"
                >
                  <div className="mb-2 flex items-center justify-between gap-2 border-b border-divider-soft pb-2">
                    <span className="text-[13px] font-semibold text-ink">
                      Notifications
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={markAllNotificationsRead}
                      disabled={unreadNotificationCount === 0}
                      className="h-7 px-2 text-[12px] text-[#0066cc]"
                    >
                      Mark all read
                    </Button>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="py-4 text-center text-[12px] leading-relaxed text-ink-muted-48">
                      All caught up. New expenses, share revisions, and
                      settlement nudges appear here.
                    </p>
                  ) : (
                    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                      {notifications.map((item) => (
                        <li
                          key={item.id}
                          className={cn(
                            "rounded-sm px-2.5 py-2 text-left transition-colors",
                            item.unread ? "bg-canvas-parchment" : "bg-canvas",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12px] font-semibold text-ink">
                              {item.title}
                            </span>
                            <span className="text-[11px] text-ink-muted-48">
                              {item.timestamp}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[12px] text-ink-muted-80">
                            {item.description}
                          </p>
                        </li>
                      ))}
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
              className="!px-2 sm:!px-3.5"
            >
              <span className="hidden sm:inline">Add Expense</span>
            </Button>

            <Dropdown
              align="right"
              variant="button"
              triggerAriaLabel="User profile menu"
              items={profileMenuItems}
              className="[&>button]:h-9 [&>button]:border-transparent [&>button]:bg-transparent [&>button]:px-1 [&>button]:hover:bg-canvas-parchment"
              trigger={
                <span className="inline-flex items-center gap-1">
                  <Avatar
                    name={displayName}
                    src={user?.avatarUrl}
                    size="md"
                  />
                  <ChevronDown
                    className="h-3.5 w-3.5 text-ink-muted-48"
                    aria-hidden="true"
                  />
                </span>
              }
            />

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
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
                  Matching Expenses
                </span>
                {visibleSearching && (
                  <span className="text-[11px] text-ink-muted-48">
                    Searching...
                  </span>
                )}
              </div>
              {visibleSearchExpenses.length === 0 ? (
                !visibleSearching && (
                  <p className="rounded-sm bg-canvas-parchment px-3 py-2.5 text-[12px] text-ink-muted-48">
                    No matching expense records found.
                  </p>
                )
              ) : (
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {visibleSearchExpenses.map((exp) => (
                    <li key={exp.id}>
                      <button
                        type="button"
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
                        className="flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-canvas-parchment focus-visible:outline-2 focus-visible:outline-primary-focus"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {exp.description}
                          </span>
                          <span className="block truncate text-[11px] text-ink-muted-48">
                            {exp.groupName} · {exp.category} ·{" "}
                            {exp.expenseDate.slice(0, 10)}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-[12px] text-ink">
                          {formatMinorUnits(exp.amountCents, exp.currency)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
              Split Groups
            </span>
            {filteredGroups.length === 0 ? (
              <p className="rounded-sm bg-canvas-parchment px-3 py-3 text-[13px] text-ink-muted-48">
                No matching groups found.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {filteredGroups.map((group) => (
                  <li key={group.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchOpen(false);
                        setSearchQuery("");
                        router.push(
                          buildNavHref("/split-groups", { group: group.id }),
                        );
                      }}
                      className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-canvas-parchment focus-visible:outline-2 focus-visible:outline-primary-focus"
                    >
                      <span className="font-medium">{group.name}</span>
                      <span className="text-[12px] text-ink-muted-48">
                        {group.activeSplitCount} splits · {group.baseCurrency}
                      </span>
                    </button>
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
