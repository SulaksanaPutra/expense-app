"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronsLeft,
  ChevronsRight,
  Layers,
  LayoutGrid,
  ReceiptText,
  Settings,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  AvatarStack,
  Badge,
  Button,
  Card,
  Select,
} from "@/components/ui";
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
    icon: LayoutGrid,
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
    icon: Settings,
  },
];

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-container text-on-primary shadow-sm"
    >
      <Wallet className="h-4 w-4" aria-hidden="true" />
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
      description: `${group.activeSplitCount} ${group.activeSplitCount === 1 ? "split" : "splits"}`,
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

  const splitCount = activeGroup
    ? activeGroup.activeSplitCount
    : totalActiveSplits;
  const splitPillText = `${splitCount} ${splitCount === 1 ? "split" : "splits"}`;

  return (
    <div className="flex h-full flex-col justify-between gap-6 p-4">
      <div className="flex flex-col gap-6">
        <div
          className={cn(
            "flex items-center px-2 py-1",
            collapsed ? "justify-center px-0" : "justify-between gap-2",
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
              <span className="truncate font-display text-headline-md text-on-surface">
                LedgerSplit
              </span>
            )}
          </Link>
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
                  "flex h-10 items-center rounded-full transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2",
                  collapsed
                    ? "w-10 justify-center self-center px-0"
                    : "justify-between px-3.5",
                  isActive
                    ? "bg-primary-container font-semibold text-on-primary"
                    : "font-medium text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface",
                )}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon
                    className={cn(
                      "h-[18px] w-[18px] shrink-0",
                      isActive ? "text-on-primary" : "text-outline",
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
                      "px-2 py-0.5 text-[11px] tabular-nums",
                      isActive
                        ? "border-white/25 bg-white/20 text-on-primary"
                        : "border-outline-variant/60 bg-surface-container-low text-on-surface-variant",
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

      <div className="flex flex-col">
        {collapsed ? (
          <Button
            type="button"
            variant="icon-circle"
            size="md"
            aria-label={`Active group: ${activeGroup ? activeGroup.name : "All Groups"}`}
            title={activeGroup ? activeGroup.name : "All Groups"}
            onClick={() => setSidebarCollapsed(false)}
            className="mb-2 self-center"
          >
            <Layers
              className="h-4 w-4 text-primary-container"
              aria-hidden="true"
            />
          </Button>
        ) : (
          <Card
            variant="sub-card"
            padding="none"
            className="mb-2 flex flex-col gap-2.5 rounded-[14px] border-outline-variant/60 bg-surface-container-low p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-label-sm uppercase tracking-wider text-outline">
                ACTIVE GROUP
              </span>
              <Badge
                tone="info"
                size="sm"
                className="border-outline-variant/60 bg-surface-container-lowest px-2 py-0.5 text-[11px] font-semibold text-primary-container tabular-nums"
              >
                {splitPillText}
              </Badge>
            </div>
            <Select
              aria-label="Active Group"
              variant="pill-select"
              menuPlacement="top"
              options={groupOptions}
              value={activeGroupId}
              onChange={setActiveGroup}
              className="h-9 bg-surface-container-lowest px-3 text-[13px] font-semibold text-on-surface"
            />
            {displayMembers.length > 0 && (
              <div className="flex items-center pt-0.5">
                <AvatarStack members={displayMembers} max={2} size="sm" />
              </div>
            )}
          </Card>
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
              "h-9 text-body-sm text-outline hover:bg-surface-container-low hover:text-on-surface",
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
        "hidden shrink-0 border-r border-outline-variant/60 bg-surface-container-lowest transition-[width] duration-200 lg:sticky lg:top-0 lg:z-30 lg:flex lg:h-screen lg:flex-col",
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
  const overlayRef = React.useRef<HTMLDivElement>(null);

  const closeDrawer = React.useCallback(() => {
    setMobileDrawerOpen(false);
    queueMicrotask(() => {
      returnFocusRef?.current?.focus();
    });
  }, [returnFocusRef, setMobileDrawerOpen]);

  React.useEffect(() => {
    if (!mobileDrawerOpen) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";

    const handleDocKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
      }
    };

    document.addEventListener("keydown", handleDocKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleDocKeyDown);
    };
  }, [closeDrawer, mobileDrawerOpen]);

  if (!mobileDrawerOpen) {
    return null;
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) {
      closeDrawer();
    }
  };

  return (
    <div
      ref={overlayRef}
      id="mobile-nav-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Mobile navigation"
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex bg-on-surface/45 backdrop-blur-[2px] lg:hidden"
    >
      <div className="flex h-full w-[min(288px,85vw)] flex-col border-r border-outline-variant/60 bg-surface-container-lowest text-on-surface shadow-[0_16px_40px_rgba(0,0,0,0.16)]">
        <SidebarContent
          collapsed={false}
          isMobile
          onNavigate={closeDrawer}
          onCloseMobile={closeDrawer}
        />
      </div>
    </div>
  );
}
