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
import type {
  MemberSettlementHandle,
  SimplifiedDebtEdge,
} from "@/lib/expenses/ledger";
import {
  formatMinorUnits,
  getCurrencyMinorDigits,
  getCurrencySymbol,
  parseCurrencyInputToMinorUnits,
} from "@/lib/money";
import type {
  Database,
  PaymentRail,
  SettlementHandleProvider,
} from "@/types/database";

export interface RecordSettlementModalProps {
  open: boolean;
  onClose: () => void;
  debts: SimplifiedDebtEdge[];
  currentUserId: string;
  initialDebtKey?: string | null;
  defaultPaymentRail?: PaymentRail;
  currentUserInstantTag?: string | null;
  onSettled?: (
    settlement: Database["public"]["Tables"]["settlements"]["Row"],
  ) => void;
}

const MANUAL_HANDLE_VALUE = "__manual__";

const PROVIDER_LABELS: Record<SettlementHandleProvider, string> = {
  VENMO: "Venmo",
  ZELLE: "Zelle",
  CASH_APP: "Cash App",
};

const PAYMENT_RAIL_OPTIONS: SelectOption[] = [
  { value: "VENMO", label: "Venmo" },
  { value: "ZELLE", label: "Zelle" },
  { value: "CASH_APP", label: "Cash App" },
  { value: "CASH", label: "Cash / In-Person" },
  { value: "BANK_SETTLEMENT", label: "Bank Transfer" },
  { value: "OTHER", label: "Other" },
];

const MANUAL_RAIL_OPTIONS: SelectOption[] = [
  { value: "CASH", label: "Cash / In-Person" },
  { value: "BANK_SETTLEMENT", label: "Bank Transfer" },
  { value: "OTHER", label: "Other" },
];

function formatMinorPlain(minorUnits: number, currency: string): string {
  const digits = getCurrencyMinorDigits(currency);
  return (minorUnits / 10 ** digits).toFixed(digits);
}

function formatSettlementTag(
  tag: string | null | undefined,
  provider?: SettlementHandleProvider,
): string | null {
  const trimmed = tag?.trim() ?? "";
  if (!trimmed) return null;
  if (provider === "ZELLE") return trimmed;
  if (provider === "CASH_APP") {
    return trimmed.startsWith("$") ? trimmed : `$${trimmed.replace(/^@+/, "")}`;
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function getSortedRecipientHandles(
  debt: SimplifiedDebtEdge | null,
): MemberSettlementHandle[] {
  const handles = debt?.recipientSettlementHandles ?? [];
  if (handles.length === 0) return [];
  return [...handles].sort((a, b) =>
    a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1,
  );
}

function getDefaultHandle(
  handles: readonly MemberSettlementHandle[],
): MemberSettlementHandle | null {
  if (handles.length === 0) return null;
  return handles.find((h) => h.isDefault) ?? handles[0] ?? null;
}

export function getSettlementDebtKey(
  d: Pick<SimplifiedDebtEdge, "groupId" | "payerId" | "recipientId">,
): string {
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
  defaultPaymentRail = "VENMO",
  currentUserInstantTag = null,
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

  const initialHandles = getSortedRecipientHandles(defaultDebt);
  const initialDefaultHandle = getDefaultHandle(initialHandles);

  const [selectedKey, setSelectedKey] = React.useState<string>(
    defaultDebt ? getSettlementDebtKey(defaultDebt) : "",
  );
  const selectedDebt = React.useMemo(
    () =>
      debts.find((d) => getSettlementDebtKey(d) === selectedKey) ?? defaultDebt,
    [debts, defaultDebt, selectedKey],
  );

  const recipientHandles = React.useMemo(
    () => getSortedRecipientHandles(selectedDebt),
    [selectedDebt],
  );

  const [selectedHandleId, setSelectedHandleId] = React.useState<string>(
    initialDefaultHandle ? initialDefaultHandle.id : MANUAL_HANDLE_VALUE,
  );
  const [amountInput, setAmountInput] = React.useState<string>(
    selectedDebt
      ? formatMinorPlain(selectedDebt.amountCents, selectedDebt.currency)
      : "",
  );
  const [paymentRail, setPaymentRail] = React.useState<PaymentRail>(
    initialDefaultHandle ? initialDefaultHandle.provider : defaultPaymentRail,
  );
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const activeHandle = React.useMemo(
    () =>
      selectedHandleId !== MANUAL_HANDLE_VALUE
        ? (recipientHandles.find((h) => h.id === selectedHandleId) ??
          getDefaultHandle(recipientHandles))
        : null,
    [recipientHandles, selectedHandleId],
  );

  const effectivePaymentRail: PaymentRail = activeHandle
    ? activeHandle.provider
    : paymentRail;

  const handleDebtChange = (nextKey: string) => {
    setSelectedKey(nextKey);
    const match = debts.find((d) => getSettlementDebtKey(d) === nextKey) ?? null;
    if (match) {
      setAmountInput(formatMinorPlain(match.amountCents, match.currency));
      const nextHandles = getSortedRecipientHandles(match);
      const nextDefault = getDefaultHandle(nextHandles);
      if (nextDefault) {
        setSelectedHandleId(nextDefault.id);
        setPaymentRail(nextDefault.provider);
      } else {
        setSelectedHandleId(MANUAL_HANDLE_VALUE);
        setPaymentRail(defaultPaymentRail);
      }
    }
    setErrorMessage(null);
  };

  const handleSwitcherChange = (nextVal: string) => {
    setSelectedHandleId(nextVal);
    if (nextVal === MANUAL_HANDLE_VALUE) {
      if (
        paymentRail === "VENMO" ||
        paymentRail === "ZELLE" ||
        paymentRail === "CASH_APP"
      ) {
        setPaymentRail("CASH");
      }
    } else {
      const found = recipientHandles.find((h) => h.id === nextVal);
      if (found) {
        setPaymentRail(found.provider);
      }
    }
    setErrorMessage(null);
  };

  const currency = selectedDebt?.currency ?? "USD";
  const parsedAmountCents = parseCurrencyInputToMinorUnits(amountInput, currency);
  const isAmountValid = parsedAmountCents !== null && parsedAmountCents > 0;

  const effectiveRecipientTag =
    activeHandle?.handle ??
    selectedDebt?.recipientInstantTag ??
    (selectedDebt?.recipientId === currentUserId ? currentUserInstantTag : null);
  const recipientDisplayTag = formatSettlementTag(
    effectiveRecipientTag,
    activeHandle?.provider ??
      (effectivePaymentRail === "ZELLE" || effectivePaymentRail === "CASH_APP"
        ? effectivePaymentRail
        : "VENMO"),
  );
  const selfPayerDisplayTag =
    selectedDebt?.payerId === currentUserId
      ? formatSettlementTag(currentUserInstantTag)
      : null;

  const paymentDeepLink = React.useMemo(() => {
    if (!selectedDebt || !isAmountValid || parsedAmountCents === null) return null;
    const majorAmount = formatMinorPlain(parsedAmountCents, currency);

    if (effectivePaymentRail === "VENMO") {
      const recipientHandle = effectiveRecipientTag
        ? effectiveRecipientTag.trim().replace(/^@+/, "")
        : "";
      const note = encodeURIComponent(
        `LedgerSplit settlement — ${selectedDebt.groupName}`,
      );
      const recParam = recipientHandle
        ? `&recipients=${encodeURIComponent(recipientHandle)}`
        : "";
      return {
        href: `venmo://paycharge?txn=pay${recParam}&amount=${majorAmount}&note=${note}`,
        label: "Open Venmo",
      };
    }

    if (effectivePaymentRail === "CASH_APP" && effectiveRecipientTag) {
      const cleanCashtag = effectiveRecipientTag.trim().replace(/^[\$@]+/, "");
      if (cleanCashtag) {
        return {
          href: `https://cash.app/$${encodeURIComponent(cleanCashtag)}/${majorAmount}`,
          label: "Open Cash App",
        };
      }
    }

    return null;
  }, [
    currency,
    effectivePaymentRail,
    effectiveRecipientTag,
    isAmountValid,
    parsedAmountCents,
    selectedDebt,
  ]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!selectedDebt || !isAmountValid || parsedAmountCents === null) {
      setErrorMessage("Enter a settlement amount greater than zero.");
      return;
    }

    setIsSubmitting(true);
    try {
      const requestBody: Record<string, unknown> = {
        payer_id: selectedDebt.payerId,
        recipient_id: selectedDebt.recipientId,
        amount_cents: parsedAmountCents,
        payment_rail: effectivePaymentRail,
      };
      if (activeHandle) {
        requestBody.settlement_handle_id = activeHandle.id;
      }

      const response = await fetch(
        `/api/groups/${encodeURIComponent(selectedDebt.groupId)}/settlements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
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

  const handleOptions: SelectOption[] = React.useMemo(() => {
    if (recipientHandles.length === 0) return [];
    return [
      ...recipientHandles.map((h) => ({
        value: h.id,
        label: `${PROVIDER_LABELS[h.provider]} · ${formatSettlementTag(h.handle, h.provider) ?? h.handle}${h.isDefault ? " (Default)" : ""}`,
        description: h.displayNote ?? undefined,
      })),
      {
        value: MANUAL_HANDLE_VALUE,
        label: "Other / Manual Payment",
        description: "Cash, bank transfer, or unlinked rail",
      },
    ];
  }, [recipientHandles]);

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

  const activeProviderLabel =
    effectivePaymentRail === "VENMO"
      ? "Venmo"
      : effectivePaymentRail === "ZELLE"
        ? "Zelle"
        : effectivePaymentRail === "CASH_APP"
          ? "Cash App"
          : null;

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
                  <div className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
                    <span className="truncate">
                      {selectedDebt.payerId === currentUserId
                        ? "You"
                        : selectedDebt.payerName}
                    </span>
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 text-ink-muted-48"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {selectedDebt.recipientId === currentUserId
                        ? "You"
                        : selectedDebt.recipientName}
                    </span>
                  </div>
                  <Badge tone="neutral" size="sm" className="shrink-0">
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

            {recipientHandles.length > 0 ? (
              <>
                <Select
                  label="Recipient Settlement Handle"
                  aria-label="Settlement Handle"
                  options={handleOptions}
                  value={activeHandle ? activeHandle.id : MANUAL_HANDLE_VALUE}
                  onChange={handleSwitcherChange}
                />

                {selectedHandleId === MANUAL_HANDLE_VALUE && (
                  <Select
                    label="Manual Payment Rail"
                    aria-label="Payment Rail"
                    options={MANUAL_RAIL_OPTIONS}
                    value={
                      MANUAL_RAIL_OPTIONS.some((o) => o.value === paymentRail)
                        ? paymentRail
                        : "CASH"
                    }
                    onChange={(val) => setPaymentRail(val as PaymentRail)}
                  />
                )}
              </>
            ) : (
              <Select
                label="Payment Rail (Log & Link)"
                aria-label="Payment Rail"
                options={PAYMENT_RAIL_OPTIONS}
                value={paymentRail}
                onChange={(val) => setPaymentRail(val as PaymentRail)}
              />
            )}

            {selectedDebt && activeProviderLabel && (
              <div
                data-testid={
                  effectivePaymentRail === "VENMO"
                    ? "venmo-log-and-link"
                    : "settlement-log-and-link"
                }
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hairline bg-surface-pearl px-3.5 py-2.5 text-[12px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-ink">
                      {activeProviderLabel} Log &amp; Link
                    </span>
                    {activeHandle?.isDefault && (
                      <Badge tone="info" size="sm">
                        Default
                      </Badge>
                    )}
                  </div>
                  <span
                    data-testid="recipient-settlement-tag"
                    className="block truncate text-ink-muted-48"
                  >
                    {recipientDisplayTag
                      ? `Recipient handle: ${recipientDisplayTag}`
                      : `No ${activeProviderLabel} handle saved — records ledger settlement only.`}
                  </span>
                  {activeHandle?.displayNote && (
                    <span className="block truncate text-[11px] text-ink-muted-48">
                      {activeHandle.displayNote}
                    </span>
                  )}
                  {selfPayerDisplayTag && (
                    <span
                      data-testid="self-settlement-tag"
                      className="block truncate text-ink-muted-48"
                    >
                      Your handle: {selfPayerDisplayTag}
                    </span>
                  )}
                </div>
                {paymentDeepLink && (
                  <a
                    href={paymentDeepLink.href}
                    rel="noopener noreferrer"
                    target={
                      paymentDeepLink.href.startsWith("https://")
                        ? "_blank"
                        : undefined
                    }
                    className="inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-pill border border-hairline bg-canvas px-3 py-1.5 text-[12px] font-medium text-[#0066cc] hover:bg-canvas-parchment focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
                  >
                    <span>{paymentDeepLink.label}</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            )}

            {selectedDebt &&
              (effectivePaymentRail === "CASH" ||
                effectivePaymentRail === "BANK_SETTLEMENT" ||
                effectivePaymentRail === "OTHER") && (
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
