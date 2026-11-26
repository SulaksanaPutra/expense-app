"use client";

import * as React from "react";
import { History, RefreshCw, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  SegmentedControl,
} from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { cn } from "@/lib/cn";
import type {
  GroupAuditCategory,
  GroupAuditLogEntry,
} from "@/lib/groups/audit-log";
import type { SplitGroupDetail } from "@/lib/groups/types";

export interface AuditLogDrawerProps {
  open: boolean;
  onClose: () => void;
  group: SplitGroupDetail;
}

type AuditFilter = "ALL" | GroupAuditCategory;

const FILTER_OPTIONS: Array<{ value: AuditFilter; label: string }> = [
  { value: "ALL", label: "All Events" },
  { value: "RATIOS", label: "Ratios & Rules" },
  { value: "GOVERNANCE", label: "Governance" },
  { value: "LEDGER", label: "Ledger" },
];

const CATEGORY_META: Record<
  GroupAuditCategory,
  { label: string; tone: BadgeTone }
> = {
  RATIOS: { label: "Ratios & Rules", tone: "info" },
  GOVERNANCE: { label: "Governance", tone: "warning" },
  LEDGER: { label: "Ledger", tone: "success" },
};

function formatAuditTimestamp(isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return isoString;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function mergeAuditEntries(
  primary: GroupAuditLogEntry[],
  secondary: GroupAuditLogEntry[],
): GroupAuditLogEntry[] {
  const byId = new Map<string, GroupAuditLogEntry>();
  for (const item of secondary) {
    byId.set(item.id, item);
  }
  for (const item of primary) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function AuditLogDrawer({ open, onClose, group }: AuditLogDrawerProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const pointerDownOutsideRef = React.useRef(false);
  const titleId = React.useId();

  const [filter, setFilter] = React.useState<AuditFilter>("ALL");
  const [fetchedEntries, setFetchedEntries] = React.useState<
    GroupAuditLogEntry[] | null
  >(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (typeof dialog.showModal === "function") {
        try {
          if (!dialog.open) dialog.showModal();
        } catch {
          dialog.setAttribute("open", "");
        }
      } else {
        dialog.setAttribute("open", "");
      }
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
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await fetch(
          `/api/groups/${encodeURIComponent(group.id)}/audit-log`,
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error || "Unable to load audit log.");
        }
        const payload = (await response.json()) as {
          entries?: GroupAuditLogEntry[];
        };
        if (!cancelled) {
          setFetchedEntries(
            Array.isArray(payload.entries) ? payload.entries : [],
          );
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? err.message
              : "Unable to load audit log history.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [group.id, open, refreshTick]);

  const handleRefresh = React.useCallback(() => {
    setRefreshTick((prev) => prev + 1);
  }, []);

  const entries = React.useMemo(() => {
    const localEntries = group.auditLogs ?? [];
    if (fetchedEntries === null) {
      return localEntries;
    }
    return mergeAuditEntries(localEntries, fetchedEntries);
  }, [fetchedEntries, group.auditLogs]);

  const filteredEntries = React.useMemo(() => {
    if (filter === "ALL") return entries;
    return entries.filter((entry) => entry.category === filter);
  }, [entries, filter]);

  const handleCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDialogElement>) => {
    pointerDownOutsideRef.current =
      sheetRef.current !== null &&
      !sheetRef.current.contains(e.target as Node);
  };

  const handleClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (
      sheetRef.current &&
      !sheetRef.current.contains(e.target as Node) &&
      (pointerDownOutsideRef.current || e.target === dialogRef.current)
    ) {
      onClose();
    }
    pointerDownOutsideRef.current = false;
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      {...({ closedby: "any" } as Record<string, string>)}
      className={cn(
        "fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 text-ink backdrop:bg-ink/45",
        !open && "hidden",
      )}
    >
      {open && (
        <div className="flex h-full w-full justify-end">
          <div
            ref={sheetRef}
            data-testid="audit-log-drawer"
            className="flex h-full w-[min(480px,95vw)] flex-col border-l border-hairline bg-canvas text-ink shadow-[0_16px_40px_rgba(0,0,0,0.16)]"
          >
            <div className="sticky top-0 z-10 flex flex-col gap-4 border-b border-divider-soft bg-canvas px-6 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#0066cc]">
                    <History className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Governance &amp; Ratio Audit</span>
                  </div>
                  <h2
                    id={titleId}
                    className="font-display text-[19px] font-semibold tracking-tight text-ink"
                  >
                    {group.name} · Audit Log
                  </h2>
                  <p className="mt-0.5 text-[12px] text-ink-muted-48">
                    Chronological trail of split rule changes, ratio updates,
                    and member governance events.
                  </p>
                </div>
                <button
                  type="button"
                  autoFocus
                  onClick={onClose}
                  aria-label="Close audit log"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas text-ink-muted-80 transition-colors hover:bg-canvas-parchment hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <SegmentedControl
                ariaLabel="Filter audit log events"
                variant="pill-tabs"
                options={FILTER_OPTIONS}
                value={filter}
                onChange={(val) => setFilter(val as AuditFilter)}
              />
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {isLoading && entries.length === 0 && (
                <p
                  role="status"
                  className="py-12 text-center text-[13px] text-ink-muted-48"
                >
                  Loading audit history...
                </p>
              )}

              {loadError && entries.length === 0 && (
                <AlertBanner
                  tone="error"
                  title="Could not load audit history"
                  description={loadError}
                  action={
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                      onClick={handleRefresh}
                    >
                      Retry
                    </Button>
                  }
                />
              )}

              {!isLoading && !loadError && filteredEntries.length === 0 && (
                <Card
                  variant="sub-card"
                  padding="md"
                  className="flex flex-col items-center gap-2 py-10 text-center"
                >
                  <ShieldCheck
                    className="h-6 w-6 text-ink-muted-48"
                    aria-hidden="true"
                  />
                  <p className="text-[14px] font-semibold text-ink">
                    No matching audit events yet
                  </p>
                  <p className="max-w-xs text-[12px] leading-relaxed text-ink-muted-48">
                    {filter === "ALL"
                      ? "Ratio updates, split mode changes, invite regenerations, and member joins will appear here."
                      : "Switch to All Events or perform an action in this category to see history."}
                  </p>
                </Card>
              )}

              {filteredEntries.length > 0 && (
                <ol
                  aria-label="Group audit log entries"
                  className="flex flex-col gap-3"
                >
                  {filteredEntries.map((entry) => {
                    const meta = CATEGORY_META[entry.category];
                    return (
                      <li key={entry.id}>
                        <Card
                          variant="sub-card"
                          padding="sm"
                          className="flex flex-col gap-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge tone={meta.tone} size="sm">
                              {meta.label}
                            </Badge>
                            <time
                              dateTime={entry.createdAt}
                              className="text-[11px] text-ink-muted-48"
                            >
                              {formatAuditTimestamp(entry.createdAt)}
                            </time>
                          </div>

                          <p className="text-[13px] font-semibold text-ink">
                            {entry.summary}
                          </p>

                          <div className="flex items-center gap-1.5 text-[11px] text-ink-muted-48">
                            <SlidersHorizontal
                              className="h-3 w-3 shrink-0"
                              aria-hidden="true"
                            />
                            <span>Actor: {entry.actorName}</span>
                          </div>

                          {entry.details.length > 0 && (
                            <ul className="mt-1 space-y-1 border-t border-hairline pt-2 text-[12px] text-ink-muted-80">
                              {entry.details.map((detail, idx) => (
                                <li key={`${entry.id}-detail-${idx}`}>
                                  {detail}
                                </li>
                              ))}
                            </ul>
                          )}
                        </Card>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>

            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-divider-soft bg-canvas px-6 py-4">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={isLoading}
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={handleRefresh}
              >
                Refresh
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onClose}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
