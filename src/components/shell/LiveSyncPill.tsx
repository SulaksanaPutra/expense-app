"use client";

import * as React from "react";
import { StatusPill } from "@/components/ui";
import { useActiveGroup } from "./ActiveGroupContext";

export interface LiveSyncPillProps {
  className?: string;
}

export function LiveSyncPill({ className }: LiveSyncPillProps) {
  const { liveSyncStatus } = useActiveGroup();

  const syncMeta = React.useMemo(() => {
    if (liveSyncStatus === "syncing") {
      return { tone: "warning" as const, label: "Syncing..." };
    }
    if (liveSyncStatus === "offline") {
      return { tone: "neutral" as const, label: "Offline" };
    }
    return { tone: "success" as const, label: "Live Sync" };
  }, [liveSyncStatus]);

  return (
    <StatusPill tone={syncMeta.tone} size="sm" dot className={className}>
      {syncMeta.label}
    </StatusPill>
  );
}
