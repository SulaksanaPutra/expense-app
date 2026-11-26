"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronsLeft,
  ChevronsRight,
  Layers,
  LayoutDashboard,
  ReceiptText,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { AvatarStack, Badge, Button, Select } from "@/components/ui";
import type { SelectOption } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useActiveGroup } from "./ActiveGroupContext";
import { ALL_GROUPS_VALUE } from "./url-state";

interface NavItemConfig {
  id: "dashboard" | "expenses" | "split-groups" | "settings";
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

const NAV_ITEMS: NavItemConfig[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    path: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    id: "expenses",
    label: "Expenses",
    path: "/expenses",
    icon: ReceiptText,
  },
  {
    id: "split-groups",
    label: "Split Groups",
    path: "/split-groups",
    icon: Users,
  },
  {
    id: "settings",
    label: "Settings",
    path: "/settings",
    icon: SlidersHorizontal,
  },
];

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[#0066cc] text-white"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 7h16" />
        <path d="M4 12h10" />
        <path d="M4 17h16" />
        <circle cx="18" cy="12" r="2" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

interface SidebarContentProps {
  collapsed: boolean;
  isMobile?: boolean;
  onNavigate?: () => void;
  onCloseMobile?: () => void;
}

function SidebarContent({
  collapsed,
  isMobile = false,
  onNavigate,
  onCloseMobile,
}: SidebarContentProps) {
  const {
    pathname,
    groups,
    activeGroupCount,
    activeGroupId,
    activeGroup,
    setActiveGroup,
    buildNavHref,
    toggleSidebarCollapsed,
    setSidebarCollapsed,
  } = useActiveGroup();

  const groupOptions = React.useMemo<SelectOption[]>(() => {
    const allOption: SelectOption = {
      value: ALL_GROUPS_VALUE,
      label: "All Groups",
      description: `${groups.length} active ${groups.length === 1 ? "group" : "groups"}`,
    };
    const groupItems: SelectOption[] = groups.map((group) => ({
      value: group.id,
      label: group.name,
      description: `${group.activeSplitCount} active ${group.activeSplitCount === 1 ? "split" : "splits"}`,
    }));
    return [allOption, ...groupItems];
  }, [groups]);

  const displayMembers = React.useMemo(() => {
    if (activeGroup) {
      return activeGroup.members;
    }
    const unique = new Map<string, (typeof groups)[number]["members"][number]>();
    for (const group of groups) {
      for (const member of group.members) {
        if (!unique.has(member.id)) {
          unique.set(member.id, member);
        }
      }
    }
    return Array.from(unique.values());
  }, [activeGroup, groups]);

  const totalActiveSplits = React.useMemo(
    () => groups.reduce((acc, g) => acc + g.activeSplitCount, 0),
    [groups],
  );

  const splitSummaryText = activeGroup
    ? `${activeGroup.activeSplitCount} active ${activeGroup.activeSplitCount === 1 ? "split" : "splits"}`
    : `${totalActiveSplits} active ${totalActiveSplits === 1 ? "split" : "splits"}`;

  return (
    <div className="flex h-full flex-col justify-between gap-6 p-4">
      <div className="flex flex-col gap-6">
        <div
          className={cn(
            "flex items-center px-1",
            collapsed ? "justify-center" : "justify-between gap-2",
          )}
        >
          <Link
            href={buildNavHref("/dashboard")}
            onClick={onNavigate}
            aria-label={collapsed ? "LedgerSplit — Dashboard" : undefined}
            className="flex min-w-0 items-center gap-2.5 rounded-sm focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
          >
            <BrandMark />
            {!collapsed && (
              <span className="truncate font-display text-[17px] font-semibold tracking-[-0.02em] text-ink">
                LedgerSplit
              </span>
            )}
          </Link>
          {!collapsed && !isMobile && (
            <Badge tone="neutral" size="sm" className="uppercase tracking-wider">
              SHARED
            </Badge>
          )}
          {isMobile && onCloseMobile && (
            <Button
              type="button"
              variant="icon-circle"
              size="sm"
              autoFocus
              aria-label="Close navigation menu"
              onClick={onCloseMobile}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>

        <nav
          aria-label={isMobile ? "Mobile primary" : "Primary"}
          className="flex flex-col gap-1"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.path || pathname.startsWith(`${item.path}/`);
            const showGroupCount = item.id === "split-groups";

            return (
              <Link
                key={item.id}
                href={buildNavHref(item.path)}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                aria-label={
                  collapsed
                    ? showGroupCount
                      ? `${item.label} (${activeGroupCount})`
                      : item.label
                    : undefined
                }
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center rounded-pill transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2",
                  collapsed
                    ? "h-10 w-10 justify-center self-center px-0"
                    : "justify-between px-3.5 py-2.5",
                  isActive
                    ? "bg-[#0066cc] font-medium text-white"
                    : "font-medium text-ink-muted-80 hover:bg-canvas-parchment hover:text-ink",
                )}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon
                    className={cn(
                      "h-[18px] w-[18px] shrink-0",
                      isActive ? "text-white" : "text-ink-muted-48",
                    )}
                    aria-hidden={true}
                  />
                  {!collapsed && (
                    <span className="truncate text-[14px]">{item.label}</span>
                  )}
                </span>
                {!collapsed && showGroupCount && (
                  <Badge
                    tone={isActive ? "info" : "neutral"}
                    size="sm"
                    className={cn(
                      isActive &&
                        "border-white/25 bg-white/20 text-white",
                    )}
                  >
                    {activeGroupCount}
                  </Badge>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-3">
        {collapsed ? (
          <Button
            type="button"
            variant="icon-circle"
            size="md"
            aria-label={`Active group: ${activeGroup ? activeGroup.name : "All Groups"}`}
            title={activeGroup ? activeGroup.name : "All Groups"}
            onClick={() => setSidebarCollapsed(false)}
            className="self-center"
          >
            <Layers className="h-4 w-4 text-[#0066cc]" aria-hidden="true" />
          </Button>
        ) : (
          <div className="flex flex-col gap-2.5 rounded-[18px] border border-hairline bg-canvas-parchment p-3.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted-48">
              Active Group
            </span>
            <Select
              aria-label="Active Group"
              variant="pill-select"
              menuPlacement="top"
              options={groupOptions}
              value={activeGroupId}
              onChange={setActiveGroup}
              className="h-9 bg-canvas px-3 text-[13px] font-semibold text-ink"
            />
            <div className="flex items-center justify-between gap-2 px-0.5">
              <span className="truncate text-[12px] font-medium text-[#0066cc]">
                {splitSummaryText}
              </span>
              {displayMembers.length > 0 && (
                <AvatarStack members={displayMembers} max={2} size="sm" />
              )}
            </div>
          </div>
        )}

        {!isMobile && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            onClick={toggleSidebarCollapsed}
            className={cn(
              "text-ink-muted-48 hover:text-ink",
              collapsed ? "w-10 self-center px-0" : "w-full justify-center",
            )}
            leftIcon={
              collapsed ? (
                <ChevronsRight className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
              )
            }
          >
            {!collapsed && "Collapse Sidebar"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const { sidebarCollapsed } = useActiveGroup();

  return (
    <aside
      data-testid="desktop-sidebar"
      data-collapsed={sidebarCollapsed ? "true" : "false"}
      aria-label="Sidebar navigation"
      className={cn(
        "hidden shrink-0 border-r border-hairline bg-canvas transition-[width] duration-200 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col",
        sidebarCollapsed ? "w-[72px]" : "w-[248px]",
      )}
    >
      <SidebarContent collapsed={sidebarCollapsed} />
    </aside>
  );
}

export interface MobileDrawerProps {
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}

export function MobileDrawer({ returnFocusRef }: MobileDrawerProps) {
  const { mobileDrawerOpen, setMobileDrawerOpen } = useActiveGroup();
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (mobileDrawerOpen) {
      if (typeof dialog.showModal === "function") {
        try {
          if (!dialog.open) dialog.showModal();
        } catch {
          dialog.setAttribute("open", "");
        }
      } else {
        dialog.setAttribute("open", "");
      }
      document.body.style.overflow = "hidden";
    } else {
      if (typeof dialog.close === "function") {
        try {
          if (dialog.open) dialog.close();
        } catch {
          dialog.removeAttribute("open");
        }
      } else {
        dialog.removeAttribute("open");
      }
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileDrawerOpen]);

  const closeDrawer = React.useCallback(() => {
    setMobileDrawerOpen(false);
    queueMicrotask(() => {
      returnFocusRef?.current?.focus();
    });
  }, [returnFocusRef, setMobileDrawerOpen]);

  const handleCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    closeDrawer();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      closeDrawer();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      id="mobile-nav-drawer"
      aria-label="Mobile navigation"
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      className={cn(
        "fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-ink/45 lg:hidden",
        !mobileDrawerOpen && "hidden",
      )}
    >
      {mobileDrawerOpen && (
        <div className="flex h-full w-[min(288px,85vw)] flex-col border-r border-hairline bg-canvas text-ink shadow-[0_16px_40px_rgba(0,0,0,0.16)]">
          <SidebarContent
            collapsed={false}
            isMobile
            onNavigate={closeDrawer}
            onCloseMobile={closeDrawer}
          />
        </div>
      )}
    </dialog>
  );
}
