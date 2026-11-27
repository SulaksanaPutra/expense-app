"use client";

import * as React from "react";
import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  Dialog,
  Input,
  Select,
} from "@/components/ui";
import type { SelectOption } from "@/components/ui";
import type { SimplifiedDebtEdge } from "@/lib/expenses/ledger";
import {
  formatMinorUnits,
  getCurrencyMinorDigits,
  getCurrencySymbol,
  parseCurrencyInputToMinorUnits,
} from "@/lib/money";
import type { Database, PaymentRail } from "@/types/database";

export interface RecordSettlementModalProps {
  open: boolean;
  onClose: () => void;
  debts: SimplifiedDebtEdge[];
  currentUserId: string;
  initialDebtKey?: string | null;
  onSettled?: (settlement: Database["public"]["Tables"]["settlements"]["Row"]) => void;
}

const PAYMENT_RAIL_OPTIONS: SelectOption[] = [
  { value: "VENMO", label: "Venmo (@instant_tag / deep link)" },
  { value: "APPLE_CARD", label: "Apple Card / Apple Cash" },
  { value: "CASH", label: "Cash / In-Person" },
  { value: "OTHER", label: "Bank Transfer / Other" },
];

function formatMinorPlain(minorUnits: number, currency: string): string {
  const digits = getCurrencyMinorDigits(currency);
  return (minorUnits / 10 ** digits).toFixed(digits);
}

function formatSettlementTag(tag: string | null | undefined): string | null {
  const trimmed = tag?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

export function getSettlementDebtKey(d: Pick<SimplifiedDebtEdge, "groupId" | "payerId" | "recipientId">): string {
  return `${d.groupId}::${d.payerId}::${d.recipientId}`;
}

export function RecordSettlementModal(props: RecordSettlementModalProps) {
  if (!props.open) {
    return (
      <Dialog open={false} onClose={props.onClose} title="Record Settlement">
        {null}
      </Dialog>
    );
  }
  return <RecordSettlementModalInner {...props} />;
}

function RecordSettlementModalInner({
  open,
  onClose,
  debts,
  currentUserId,
  initialDebtKey,
  onSettled,
}: RecordSettlementModalProps) {
  const formId = React.useId();
  const amountHintId = React.useId();

  const defaultDebt =
    (initialDebtKey
      ? debts.find((d) => getSettlementDebtKey(d) === initialDebtKey)
      : null) ??
    debts.find((d) => d.payerId === currentUserId) ??
    debts[0] ??
    null;

  const [selectedKey, setSelectedKey] = React.useState<string>(
    defaultDebt ? getSettlementDebtKey(defaultDebt) : "",
  );
  const selectedDebt = React.useMemo(
    () => debts.find((d) => getSettlementDebtKey(d) === selectedKey) ?? defaultDebt,
    [debts, defaultDebt, selectedKey],
  );

  const [amountInput, setAmountInput] = React.useState<string>(
    selectedDebt
      ? formatMinorPlain(selectedDebt.amountCents, selectedDebt.currency)
      : "",
  );
  const [paymentRail, setPaymentRail] = React.useState<PaymentRail>("VENMO");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleDebtChange = (nextKey: string) => {
    setSelectedKey(nextKey);
    const match = debts.find((d) => getSettlementDebtKey(d) === nextKey);
    if (match) {
      setAmountInput(formatMinorPlain(match.amountCents, match.currency));
    }
    setErrorMessage(null);
  };

  const currency = selectedDebt?.currency ?? "USD";
  const parsedAmountCents = parseCurrencyInputToMinorUnits(amountInput, currency);
  const isAmountValid = parsedAmountCents !== null && parsedAmountCents > 0;
  const recipientDisplayTag = formatSettlementTag(
    selectedDebt?.recipientInstantTag,
  );

  const venmoDeepLink = React.useMemo(() => {
    if (!selectedDebt || !isAmountValid || parsedAmountCents === null) return null;
    const recipientHandle = selectedDebt.recipientInstantTag
      ? selectedDebt.recipientInstantTag.trim().replace(/^@+/, "")
      : "";
    const majorAmount = formatMinorPlain(parsedAmountCents, currency);
    const note = encodeURIComponent(
      `LedgerSplit settlement — ${selectedDebt.groupName}`,
    );
    const recParam = recipientHandle
      ? `&recipients=${encodeURIComponent(recipientHandle)}`
      : "";
    return `venmo://paycharge?txn=pay${recParam}&amount=${majorAmount}&note=${note}`;
  }, [currency, isAmountValid, parsedAmountCents, selectedDebt]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!selectedDebt || !isAmountValid || parsedAmountCents === null) {
      setErrorMessage("Enter a settlement amount greater than zero.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/groups/${encodeURIComponent(selectedDebt.groupId)}/settlements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payer_id: selectedDebt.payerId,
            recipient_id: selectedDebt.recipientId,
            amount_cents: parsedAmountCents,
            payment_rail: paymentRail,
          }),
        },
      );

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        settlement?: Database["public"]["Tables"]["settlements"]["Row"];
      };

      if (!response.ok || !payload.settlement) {
        setErrorMessage(payload.error || "Unable to record settlement.");
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      onSettled?.(payload.settlement);
      onClose();
    } catch {
      setErrorMessage("Network error while recording settlement.");
      setIsSubmitting(false);
    }
  };

  const debtOptions: SelectOption[] = debts.map((d) => ({
    value: getSettlementDebtKey(d),
    label: `${d.payerId === currentUserId ? "You" : d.payerName} → ${d.recipientId === currentUserId ? "You" : d.recipientName} (${formatMinorUnits(d.amountCents, d.currency)})`,
    description: d.groupName,
  }));

  const settlementProgressHint = React.useMemo(() => {
    if (!selectedDebt || !isAmountValid || parsedAmountCents === null) {
      return null;
    }
    if (parsedAmountCents < selectedDebt.amountCents) {
      const remaining = selectedDebt.amountCents - parsedAmountCents;
      return `Partial payment: ${formatMinorUnits(remaining, currency)} will remain unsettled.`;
    }
    if (parsedAmountCents === selectedDebt.amountCents) {
      return `Full settlement: clears this balance to ${formatMinorUnits(0, currency)}.`;
    }
    const excess = parsedAmountCents - selectedDebt.amountCents;
    return `Exceeds owed balance of ${formatMinorUnits(selectedDebt.amountCents, currency)} by ${formatMinorUnits(excess, currency)}.`;
  }, [currency, isAmountValid, parsedAmountCents, selectedDebt]);

  return (
    <Dialog
      open={open}
      onClose={isSubmitting ? () => {} : onClose}
      title="Record Settlement"
      description="Log a full or partial payment within a single group ledger."
      size="md"
      closeOnBackdropClick={!isSubmitting}
      closeOnEscape={!isSubmitting}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isSubmitting}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            size="sm"
            loading={isSubmitting}
            disabled={!selectedDebt || !isAmountValid || isSubmitting}
            leftIcon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          >
            Mark as Settled
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
      >
        {errorMessage && (
          <AlertBanner
            tone="error"
            title="Could not record settlement"
            description={errorMessage}
          />
        )}

        {debts.length === 0 ? (
          <AlertBanner
            tone="info"
            title="All balances settled"
            description="There are no open unsettled balances in the selected group scope."
          />
        ) : (
          <>
            <Select
              label="Settlement Pair"
              aria-label="Settlement Pair"
              options={debtOptions}
              value={selectedDebt ? getSettlementDebtKey(selectedDebt) : ""}
              onChange={handleDebtChange}
            />

            {selectedDebt && (
              <Card variant="sub-card" padding="sm" className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <div className="flex items-center gap-1.5 font-semibold text-ink">
                    <span>
                      {selectedDebt.payerId === currentUserId
                        ? "You"
                        : selectedDebt.payerName}
                    </span>
                    <ArrowRight
                      className="h-3.5 w-3.5 text-ink-muted-48"
                      aria-hidden="true"
                    />
                    <span>
                      {selectedDebt.recipientId === currentUserId
                        ? "You"
                        : selectedDebt.recipientName}
                    </span>
                  </div>
                  <Badge tone="neutral" size="sm">
                    {selectedDebt.groupName}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-muted-48">
                  <p className="tabular-nums">
                    Full unsettled balance:{" "}
                    <strong className="text-ink">
                      {formatMinorUnits(selectedDebt.amountCents, currency)}
                    </strong>
                  </p>
                  {parsedAmountCents !== selectedDebt.amountCents && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAmountInput(
                          formatMinorPlain(selectedDebt.amountCents, currency),
                        );
                        setErrorMessage(null);
                      }}
                      className="h-6 px-2 text-[11px] font-medium text-[#0066cc]"
                    >
                      Use full balance
                    </Button>
                  )}
                </div>
              </Card>
            )}

            <div className="flex flex-col gap-1.5">
              <Input
                label={`Settlement Amount (${currency})`}
                name="settlement_amount"
                type="text"
                inputMode="decimal"
                required
                autoFocus
                prefix={getCurrencySymbol(currency)}
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  setErrorMessage(null);
                }}
                error={
                  amountInput.trim() !== "" && !isAmountValid
                    ? "Enter a valid positive amount."
                    : undefined
                }
                aria-describedby={
                  settlementProgressHint ? amountHintId : undefined
                }
                className="text-[18px] font-semibold tabular-nums"
              />
              {settlementProgressHint && (
                <p
                  id={amountHintId}
                  data-testid="settlement-progress-hint"
                  className="text-[12px] text-ink-muted-48 tabular-nums"
                >
                  {settlementProgressHint}
                </p>
              )}
            </div>

            <Select
              label="Payment Rail (Log & Link)"
              aria-label="Payment Rail"
              options={PAYMENT_RAIL_OPTIONS}
              value={paymentRail}
              onChange={(val) => setPaymentRail(val as PaymentRail)}
            />

            {selectedDebt && paymentRail === "VENMO" && (
              <div
                data-testid="venmo-log-and-link"
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hairline bg-surface-pearl px-3.5 py-2.5 text-[12px]"
              >
                <div className="min-w-0">
                  <span className="block font-medium text-ink">
                    Venmo Log &amp; Link
                  </span>
                  <span
                    data-testid="recipient-settlement-tag"
                    className="block truncate text-ink-muted-48"
                  >
                    {recipientDisplayTag
                      ? `Recipient handle: ${recipientDisplayTag}`
                      : "No @instant_settlement_tag saved — records ledger settlement only."}
                  </span>
                </div>
                {venmoDeepLink && (
                  <a
                    href={venmoDeepLink}
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[28px] items-center gap-1 rounded-pill border border-hairline bg-canvas px-3 py-1.5 text-[12px] font-medium text-[#0066cc] hover:bg-canvas-parchment focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
                  >
                    <span>Open Venmo</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            )}

            {selectedDebt && paymentRail === "APPLE_CARD" && (
              <div className="rounded-md border border-hairline bg-surface-pearl px-3.5 py-2.5 text-[12px]">
                <span className="block font-medium text-ink">
                  Apple Card / Apple Cash Log &amp; Link
                </span>
                <span className="block text-ink-muted-48">
                  {recipientDisplayTag
                    ? `Recipient handle: ${recipientDisplayTag} — complete transfer externally, then click Mark as Settled.`
                    : "Complete your Apple Cash transfer externally, then click Mark as Settled to log the immutable event."}
                </span>
              </div>
            )}

            {selectedDebt &&
              (paymentRail === "CASH" || paymentRail === "OTHER") && (
                <p className="text-[12px] text-ink-muted-48">
                  Records an immutable settlement event in {currency}. No funds
                  move through LedgerSplit servers.
                </p>
              )}
          </>
        )}
      </form>
    </Dialog>
  );
}
