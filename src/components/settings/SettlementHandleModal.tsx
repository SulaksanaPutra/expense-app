"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import {
  AlertBanner,
  Button,
  Card,
  Dialog,
  Input,
  Select,
  Switch,
} from "@/components/ui";
import type { SelectOption } from "@/components/ui";
import type { SettlementHandleProvider } from "@/types/database";
import type { SettlementHandleItem } from "@/lib/settings/settlement-handles";

export interface SettlementHandleModalProps {
  open: boolean;
  mode: "add" | "edit";
  initialHandle?: SettlementHandleItem | null;
  defaultIsDefault?: boolean;
  onClose: () => void;
  onSaved: (
    handles: SettlementHandleItem[],
    saved: SettlementHandleItem,
    mode: "add" | "edit",
  ) => void;
  onDeleted: (handles: SettlementHandleItem[], deletedId: string) => void;
}

const PROVIDER_OPTIONS: SelectOption[] = [
  { value: "VENMO", label: "Venmo" },
  { value: "ZELLE", label: "Zelle" },
  { value: "CASH_APP", label: "Cash App" },
];

const HANDLE_PLACEHOLDERS: Record<SettlementHandleProvider, string> = {
  VENMO: "@jordan-davis",
  ZELLE: "+1 (415) 890-3412",
  CASH_APP: "$jordandavis",
};

const NOTE_PLACEHOLDERS: Record<SettlementHandleProvider, string> = {
  VENMO: "e.g., Personal Venmo",
  ZELLE: "e.g., Chase Zelle",
  CASH_APP: "e.g., Main Cash App",
};

function SettlementHandleModalContent({
  open,
  mode,
  initialHandle = null,
  defaultIsDefault = false,
  onClose,
  onSaved,
  onDeleted,
}: SettlementHandleModalProps) {
  const [provider, setProvider] = React.useState<SettlementHandleProvider>(
    initialHandle?.provider ?? "VENMO",
  );
  const [handleTag, setHandleTag] = React.useState(initialHandle?.handle ?? "");
  const [displayNote, setDisplayNote] = React.useState(
    initialHandle?.displayNote ?? "",
  );
  const [isDefault, setIsDefault] = React.useState(
    initialHandle ? initialHandle.isDefault : defaultIsDefault,
  );
  const [touchedHandle, setTouchedHandle] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const formId = React.useId();

  const trimmedHandle = handleTag.trim();
  const handleError =
    touchedHandle && !trimmedHandle
      ? "Enter a username, phone number, or email."
      : undefined;

  const isBusy = isSubmitting || isDeleting;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setTouchedHandle(true);

    if (!trimmedHandle) {
      setErrorMessage("Handle / Account Tag is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const endpoint =
        mode === "edit" && initialHandle
          ? `/api/settings/settlement-handles/${encodeURIComponent(initialHandle.id)}`
          : "/api/settings/settlement-handles";
      const method = mode === "edit" ? "PATCH" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          handle: trimmedHandle,
          display_note: displayNote.trim() || null,
          is_default: isDefault,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        handle?: SettlementHandleItem;
        handles?: SettlementHandleItem[];
      };

      if (!response.ok || !payload.handle || !Array.isArray(payload.handles)) {
        setErrorMessage(
          payload.error || "Unable to save settlement handle. Please try again.",
        );
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      onSaved(payload.handles, payload.handle, mode);
    } catch {
      setErrorMessage(
        "Network error while saving settlement handle. Please try again.",
      );
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (mode !== "edit" || !initialHandle || isBusy) return;
    setErrorMessage(null);
    setIsDeleting(true);

    try {
      const response = await fetch(
        `/api/settings/settlement-handles/${encodeURIComponent(initialHandle.id)}`,
        { method: "DELETE" },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        deletedId?: string;
        handles?: SettlementHandleItem[];
      };

      if (!response.ok || !Array.isArray(payload.handles)) {
        setErrorMessage(
          payload.error ||
            "Unable to delete settlement handle. Please try again.",
        );
        setIsDeleting(false);
        return;
      }

      setIsDeleting(false);
      onDeleted(payload.handles, payload.deletedId ?? initialHandle.id);
    } catch {
      setErrorMessage(
        "Network error while deleting settlement handle. Please try again.",
      );
      setIsDeleting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!isBusy) onClose();
      }}
      title={
        mode === "edit" ? "Edit Settlement Handle" : "Add Settlement Handle"
      }
      description="Add or update a payout handle shown on Settle Up links."
      size="sm"
      closeOnBackdropClick={!isBusy}
      closeOnEscape={!isBusy}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div>
            {mode === "edit" && initialHandle && (
              <Button
                type="button"
                variant="danger-soft"
                size="md"
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                loading={isDeleting}
                disabled={isSubmitting}
                onClick={handleDelete}
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={isBusy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="primary"
              size="md"
              loading={isSubmitting}
              disabled={isDeleting}
            >
              Save Handle
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={formId}
        onSubmit={handleSubmit}
        noValidate
        className="space-y-4"
      >
        {errorMessage && (
          <AlertBanner
            tone="error"
            title="Could not save handle"
            description={errorMessage}
          />
        )}

        <Select
          label="Provider"
          variant="pill-select"
          options={PROVIDER_OPTIONS}
          value={provider}
          onChange={(val) => setProvider(val as SettlementHandleProvider)}
          disabled={isBusy}
          className="h-11 w-full"
        />

        <Input
          label="Handle / Account Tag"
          shape="pill"
          value={handleTag}
          onChange={(e) => setHandleTag(e.target.value)}
          onBlur={() => setTouchedHandle(true)}
          error={handleError}
          placeholder={HANDLE_PLACEHOLDERS[provider]}
          hint="Username, phone number, or email peers send to."
          disabled={isBusy}
          required
        />

        <Input
          label="Display Note (Optional)"
          shape="pill"
          value={displayNote}
          onChange={(e) => setDisplayNote(e.target.value)}
          placeholder={NOTE_PLACEHOLDERS[provider]}
          disabled={isBusy}
        />

        <Card variant="sub-card" padding="sm" className="rounded-[14px]">
          <Switch
            className="w-full"
            tone="success"
            checked={isDefault}
            onCheckedChange={setIsDefault}
            disabled={isBusy}
            label="Set as default handle"
            description="Pre-selected when peers settle up with you."
          />
        </Card>
      </form>
    </Dialog>
  );
}

export function SettlementHandleModal(props: SettlementHandleModalProps) {
  const instanceKey = props.open
    ? `${props.mode}-${props.initialHandle?.id ?? "new"}-${props.defaultIsDefault ? "def" : "nodef"}`
    : "closed";
  return <SettlementHandleModalContent key={instanceKey} {...props} />;
}
