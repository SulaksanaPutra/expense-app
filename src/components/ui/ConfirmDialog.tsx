"use client";

import * as React from "react";
import { AlertBanner } from "./AlertBanner";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export type ConfirmDialogVariant = "default" | "danger";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  loading?: boolean;
  disabled?: boolean;
  blockedReason?: string;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
  disabled = false,
  blockedReason,
}: ConfirmDialogProps) {
  const isDanger = variant === "danger";
  const isConfirmDisabled = disabled || Boolean(blockedReason);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      closeOnBackdropClick={!loading}
      closeOnEscape={!loading}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={loading}
            autoFocus={isDanger}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={isDanger ? "danger" : "primary"}
            onClick={() => void onConfirm()}
            loading={loading}
            disabled={isConfirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {description && (
          <p className="text-[14px] leading-relaxed text-ink-muted-80">
            {description}
          </p>
        )}
        {blockedReason && (
          <AlertBanner tone="warning" title="Action Blocked" description={blockedReason} />
        )}
        {children}
      </div>
    </Dialog>
  );
}
