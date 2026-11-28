import type { Database, NotificationType } from "@/types/database";
import type { ShellNotificationItem } from "./types";

export const REALTIME_LEDGER_CHANGE_EVENT = "ledgersplit:realtime-change";

export function formatNotificationTimestamp(isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return isoString;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(parsed);
}

export function getNotificationTypeLabel(
  type?: NotificationType,
): string | null {
  switch (type) {
    case "NEW_EXPENSE":
      return "New expense";
    case "EXPENSE_REVISION":
      return "Share revision";
    case "SETTLEMENT_CONFIRMATION":
      return "Settlement";
    case "REMINDER_NUDGE":
      return "Reminder";
    case "LEASE_ARCHIVE_PROMPT":
      return "Cycle summary";
    default:
      return null;
  }
}

export type DbNotificationSelectRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  | "id"
  | "type"
  | "title"
  | "description"
  | "delta_cents"
  | "currency"
  | "href"
  | "is_read"
  | "created_at"
>;

export function mapDbNotificationToShellItem(
  row: DbNotificationSelectRow,
): ShellNotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    timestamp: formatNotificationTimestamp(row.created_at),
    createdAt: row.created_at,
    unread: !row.is_read,
    href: row.href ?? undefined,
    deltaCents:
      row.delta_cents !== null && row.delta_cents !== undefined
        ? Number(row.delta_cents)
        : null,
    currency: row.currency ?? null,
  };
}
