"use client";

import * as React from "react";
import { ActiveGroupProvider } from "./ActiveGroupContext";
import { MobileDrawer, Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import type {
  ShellGroupSummary,
  ShellNotificationItem,
  ShellUserSummary,
} from "./types";

export interface AppShellProps {
  groups: ShellGroupSummary[];
  user?: ShellUserSummary | null;
  initialGroupId?: string;
  initialCycle?: string;
  initialNotifications?: ShellNotificationItem[];
  onAddExpense?: () => void;
  children: React.ReactNode;
}

export function AppShell({
  groups,
  user = null,
  initialGroupId,
  initialCycle,
  initialNotifications,
  onAddExpense,
  children,
}: AppShellProps) {
  const mobileMenuButtonRef = React.useRef<HTMLButtonElement>(null);

  return (
    <ActiveGroupProvider
      groups={groups}
      user={user}
      initialGroupId={initialGroupId}
      initialCycle={initialCycle}
      initialNotifications={initialNotifications}
      onAddExpense={onAddExpense}
    >
      <div className="flex min-h-screen w-full overflow-x-clip bg-surface text-on-surface">
        <Sidebar />
        <MobileDrawer returnFocusRef={mobileMenuButtonRef} />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar mobileMenuButtonRef={mobileMenuButtonRef} />
          <main className="w-full min-w-0 flex-1">
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </ActiveGroupProvider>
  );
}
