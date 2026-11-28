"use client";

import * as React from "react";
import {
  CheckCircle2,
  Download,
  PlusSquare,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  Dialog,
  SearchInput,
  SegmentedControl,
} from "@/components/ui";
import type { BadgeTone, SegmentedOption } from "@/components/ui";
import {
  buildAuditLogExportPayload,
  filterAuditLogEntries,
  type AuditLogUiFilter,
  type GroupAuditLogEntry,
} from "@/lib/groups/audit-log";
import type { SplitGroupDetail } from "@/lib/groups/types";

export interface AuditLogDrawerProps {
  open: boolean;
  onClose: () => void;
  group: SplitGroupDetail;
}

const FILTER_OPTIONS: Array<SegmentedOption<AuditLogUiFilter>> = [
  { value: "ALL", label: "All Events" },
  { value: "EXPENSES", label: "Expenses" },
  { value: "RULES", label: "Rules" },
  { value: "SETTLEMENTS", label: "Settlements" },
];

function getEntryBadgeMeta(entry: GroupAuditLogEntry): {
  label: string;
  tone: BadgeTone;
} {
  switch (entry.eventType) {
    case "EXPENSE_ADDED":
      return { label: "Expense Added", tone: "neutral" };
    case "EXPENSE_REVISION":
      return { label: "Expense Edited", tone: "warning" };
    case "SETTLEMENT_RECORDED":
      return { label: "Settled", tone: "success" };
    case "RATIOS_UPDATED":
    case "SPLIT_MODE_CHANGED":
    case "NEEDS_RATIO_UPDATE_CLEARED":
    case "NEEDS_RATIO_UPDATE_FLAGGED":
      return { label: "Rule Updated", tone: "info" };
    case "MEMBER_JOINED":
      return { label: "Member Joined", tone: "neutral" };
    case "MEMBER_REMOVED":
    case "MEMBER_LEFT":
      return { label: "Member Removed", tone: "warning" };
    case "INVITE_LINK_REGENERATED":
      return { label: "Invite Updated", tone: "info" };
    case "GROUP_CREATED":
      return { label: "Group Created", tone: "info" };
    case "GROUP_ARCHIVED":
      return { label: "Archived", tone: "warning" };
    default:
      return { label: "Event", tone: "neutral" };
  }
}

function renderEntryIcon(entry: GroupAuditLogEntry) {
  if (
    entry.eventType === "EXPENSE_ADDED" ||
    entry.eventType === "EXPENSE_REVISION"
  ) {
    return (
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8f1fb] text-[#0066cc]">
        <PlusSquare className="h-4 w-4" aria-hidden="true" />
      </span>
    );
  }
  if (entry.eventType === "SETTLEMENT_RECORDED") {
    return (
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      </span>
    );
  }
  if (
    entry.eventType === "MEMBER_JOINED" ||
    entry.eventType === "MEMBER_REMOVED" ||
    entry.eventType === "MEMBER_LEFT"
  ) {
    return (
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant">
        <UserPlus className="h-4 w-4" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8f1fb] text-[#0066cc]">
      <Settings className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

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
  const [filter, setFilter] = React.useState<AuditLogUiFilter>("ALL");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [fetchedEntries, setFetchedEntries] = React.useState<
    GroupAuditLogEntry[] | null
  >(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);

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

  const filteredEntries = React.useMemo(
    () => filterAuditLogEntries(entries, filter, searchQuery),
    [entries, filter, searchQuery],
  );

  const handleExportLog = React.useCallback(() => {
    const payload = buildAuditLogExportPayload(group.name, filteredEntries);
    const blob = new Blob([payload], { type: "application/json" });
    if (typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${group.slug || "group"}-audit-log.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(url);
    }
  }, [filteredEntries, group.name, group.slug]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Audit Log · ${group.name}`}
      description="Chronological record of group expenses, split edits, and settlements."
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-outline tabular-nums">
            Showing {filteredEntries.length} of {entries.length}{" "}
            {entries.length === 1 ? "event" : "events"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
              disabled={filteredEntries.length === 0}
              onClick={handleExportLog}
            >
              Export Log
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
      }
    >
      <div data-testid="audit-log-drawer" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedControl
            ariaLabel="Filter audit log events"
            variant="pill-tabs"
            options={FILTER_OPTIONS}
            value={filter}
            onChange={(val) => setFilter(val)}
            className="w-full sm:w-auto"
          />
          <SearchInput
            size="sm"
            aria-label="Filter log"
            placeholder="Filter log..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery("")}
            containerClassName="w-full sm:w-52"
          />
        </div>

        {isLoading && entries.length === 0 && (
          <p
            role="status"
            className="py-10 text-center text-[13px] text-outline"
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
                leftIcon={
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                }
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
              className="h-6 w-6 text-outline"
              aria-hidden="true"
            />
            <p className="text-[14px] font-semibold text-on-surface">
              No matching audit events
            </p>
            <p className="max-w-xs text-[12px] leading-relaxed text-outline">
              {searchQuery.trim()
                ? "Try clearing your search text or switching event filters."
                : filter === "ALL"
                  ? "Expenses, split rule updates, member joins, and settlements will appear here."
                  : "Switch to All Events or perform an action in this category to see history."}
            </p>
          </Card>
        )}

        {filteredEntries.length > 0 && (
          <ol
            aria-label="Group audit log entries"
            className="divide-y divide-outline-variant/40"
          >
            {filteredEntries.map((entry) => {
              const badgeMeta = getEntryBadgeMeta(entry);
              const primaryDetail = entry.details[0];
              return (
                <li
                  key={entry.id}
                  className="flex flex-col justify-between gap-2.5 py-3.5 first:pt-1 last:pb-1 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    {renderEntryIcon(entry)}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium leading-snug text-on-surface">
                        {entry.summary}
                      </p>
                      <p className="mt-0.5 text-[12px] text-outline tabular-nums">
                        {primaryDetail ? `${primaryDetail} · ` : ""}
                        <time dateTime={entry.createdAt}>
                          {formatAuditTimestamp(entry.createdAt)}
                        </time>
                      </p>
                      {entry.details.length > 1 && (
                        <ul className="mt-1 space-y-0.5 text-[11px] text-on-surface-variant">
                          {entry.details.slice(1).map((detail, idx) => (
                            <li key={`${entry.id}-detail-${idx}`}>{detail}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 self-start sm:self-center">
                    <Badge tone={badgeMeta.tone} size="sm">
                      {badgeMeta.label}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Dialog>
  );
}
