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
  onSettled,
}: RecordSettlementModalProps) {
  const formId = React.useId();

  const debtKey = (d: SimplifiedDebtEdge) =>
    `${d.groupId}::${d.payerId}::${d.recipientId}`;

  const defaultDebt =
    debts.find((d) => d.payerId === currentUserId) ?? debts[0] ?? null;

  const [selectedKey, setSelectedKey] = React.useState<string>(
    defaultDebt ? debtKey(defaultDebt) : "",
  );
  const selectedDebt = React.useMemo(
    () => debts.find((d) => debtKey(d) === selectedKey) ?? defaultDebt,
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
    const match = debts.find((d) => debtKey(d) === nextKey);
    if (match) {
      setAmountInput(formatMinorPlain(match.amountCents, match.currency));
    }
    setErrorMessage(null);
  };

  const currency = selectedDebt?.currency ?? "USD";
  const parsedAmountCents = parseCurrencyInputToMinorUnits(amountInput, currency);
  const isAmountValid = parsedAmountCents !== null && parsedAmountCents > 0;

  const venmoDeepLink = React.useMemo(() => {
    if (!selectedDebt || !isAmountValid || parsedAmountCents === null) return null;
    const recipientHandle = selectedDebt.recipientInstantTag
      ? selectedDebt.recipientInstantTag.replace(/^@/, "")
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

      onSettled?.(payload.settlement);
      onClose();
    } catch {
      setErrorMessage("Network error while recording settlement.");
      setIsSubmitting(false);
    }
  };

  const debtOptions: SelectOption[] = debts.map((d) => ({
    value: debtKey(d),
    label: `${d.payerId === currentUserId ? "You" : d.payerName} → ${d.recipientId === currentUserId ? "You" : d.recipientName} (${formatMinorUnits(d.amountCents, d.currency)})`,
    description: d.groupName,
  }));

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
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              value={selectedDebt ? debtKey(selectedDebt) : ""}
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
                <p className="text-[12px] text-ink-muted-48 tabular-nums">
                  Full unsettled balance:{" "}
                  <strong className="text-ink">
                    {formatMinorUnits(selectedDebt.amountCents, currency)}
                  </strong>
                </p>
              </Card>
            )}

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
              className="text-[18px] font-semibold tabular-nums"
            />

            <Select
              label="Payment Rail (Log & Link)"
              aria-label="Payment Rail"
              options={PAYMENT_RAIL_OPTIONS}
              value={paymentRail}
              onChange={(val) => setPaymentRail(val as PaymentRail)}
            />

            {selectedDebt && paymentRail === "VENMO" && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hairline bg-surface-pearl px-3.5 py-2.5 text-[12px]">
                <div className="min-w-0">
                  <span className="block font-medium text-ink">
                    Venmo Log &amp; Link
                  </span>
                  <span className="block truncate text-ink-muted-48">
                    {selectedDebt.recipientInstantTag
                      ? `Recipient handle: ${selectedDebt.recipientInstantTag}`
                      : "No @instant_settlement_tag saved — records ledger settlement only."}
                  </span>
                </div>
                {venmoDeepLink && (
                  <a
                    href={venmoDeepLink}
                    className="inline-flex items-center gap-1 rounded-pill border border-hairline bg-canvas px-3 py-1.5 text-[12px] font-medium text-[#0066cc] hover:bg-canvas-parchment"
                  >
                    <span>Open Venmo</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            )}
          </>
        )}
      </form>
    </Dialog>
  );
}
