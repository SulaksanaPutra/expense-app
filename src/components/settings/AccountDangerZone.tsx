"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import {
  AlertBanner,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
} from "@/components/ui";
import type { UserGroupBalanceSummary } from "@/lib/groups/departure";
import { formatMinorUnits } from "@/lib/money";

export interface AccountDangerZoneProps {
  balances: UserGroupBalanceSummary[];
}

export function AccountDangerZone({ balances }: AccountDangerZoneProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const unsettledGroups = React.useMemo(
    () => balances.filter((b) => b.netBalanceCents !== 0),
    [balances],
  );

  const blockedReason = React.useMemo(() => {
    if (unsettledGroups.length === 0) return undefined;
    const formattedList = unsettledGroups
      .map((g) => {
        const absFormatted = formatMinorUnits(
          Math.abs(g.netBalanceCents),
          g.baseCurrency,
        );
        const direction = g.netBalanceCents > 0 ? "owed to you" : "you owe";
        return `${g.groupName}: ${absFormatted} (${direction})`;
      })
      .join("; ");
    return `Account deletion is blocked due to unpaid group balances (${formattedList}). Settle all balances to zero first.`;
  }, [unsettledGroups]);

  const handleConfirmDelete = async () => {
    if (unsettledGroups.length > 0) return;
    setError(null);
    setIsDeleting(true);

    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        setError(
          payload.error ||
            "Unable to delete your account while unsettled balances remain.",
        );
        setIsDeleting(false);
        return;
      }

      setConfirmOpen(false);
      router.push("/login");
    } catch {
      setError("Network error while deleting account. Please try again.");
      setIsDeleting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl py-2">
      <Card padding="lg" className="w-full">
        <CardHeader className="items-start">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-600">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Account Departure</span>
            </div>
            <CardTitle>Delete Account</CardTitle>
            <CardDescription className="mt-1">
              Permanently delete your LedgerSplit account. Requires a $0.00 net
              balance across every split group.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="danger-soft"
            size="sm"
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => {
              setError(null);
              setConfirmOpen(true);
            }}
          >
            Delete Account
          </Button>
        </CardHeader>

        {unsettledGroups.length > 0 && (
          <div className="mt-4">
            <AlertBanner
              tone="warning"
              title="Unpaid balances prevent account deletion"
              description={`You currently have unsettled balances in ${unsettledGroups.length} ${unsettledGroups.length === 1 ? "group" : "groups"}. Clear all balances before deleting your account.`}
            />
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => {
          if (!isDeleting) setConfirmOpen(false);
        }}
        onConfirm={handleConfirmDelete}
        title="Delete LedgerSplit Account?"
        variant="danger"
        loading={isDeleting}
        confirmLabel="Delete Account"
        blockedReason={blockedReason}
        description={
          unsettledGroups.length > 0
            ? "Resolve the following unsettled group balances before deleting your account:"
            : "All of your group balances are $0.00. Confirming will permanently delete your account."
        }
      >
        {error && (
          <AlertBanner
            tone="error"
            title="Could not delete account"
            description={error}
          />
        )}

        {unsettledGroups.length > 0 && (
          <ul className="flex flex-col gap-2">
            {unsettledGroups.map((group) => (
              <li
                key={group.groupId}
                className="flex items-center justify-between gap-3 rounded-sm border border-hairline bg-canvas-parchment px-3 py-2 text-[13px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">
                    {group.groupName}
                  </p>
                  <p className="text-[11px] text-ink-muted-48">
                    {group.netBalanceCents > 0
                      ? "Settlement surplus owed to you"
                      : "Outstanding balance owed"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={
                      group.netBalanceCents > 0
                        ? "font-semibold tabular-nums text-emerald-700"
                        : "font-semibold tabular-nums text-red-600"
                    }
                  >
                    {group.formattedBalance}
                  </span>
                  <Link
                    href={`/split-groups?group=${encodeURIComponent(group.groupId)}`}
                    className="text-[12px] font-medium text-[#0066cc] hover:underline"
                    onClick={() => setConfirmOpen(false)}
                  >
                    View
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </section>
  );
}
