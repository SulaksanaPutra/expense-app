"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export type DialogSize = "sm" | "md" | "lg";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: DialogSize;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdropClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  className,
}: DialogProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const pointerDownTargetRef = React.useRef<EventTarget | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (document.activeElement instanceof HTMLElement) {
        previousFocusRef.current = document.activeElement;
      }

      if (typeof dialog.showModal === "function") {
        try {
          if (!dialog.open) dialog.showModal();
        } catch {
          dialog.setAttribute("open", "");
        }
      } else {
        dialog.setAttribute("open", "");
      }

      const autoFocused = dialog.querySelector<HTMLElement>("[autofocus]");
      if (autoFocused) {
        autoFocused.focus();
      } else if (
        !document.activeElement ||
        !dialog.contains(document.activeElement)
      ) {
        const focusables = getFocusableElements(dialog);
        focusables[0]?.focus();
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

      const prev = previousFocusRef.current;
      if (prev && prev.isConnected) {
        prev.focus();
      }
      previousFocusRef.current = null;
    }
  }, [open]);

  const handleCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    if (closeOnEscape) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      if (!closeOnEscape) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key === "Tab" && dialogRef.current) {
      const focusables = getFocusableElements(dialogRef.current);
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDialogElement>) => {
    pointerDownTargetRef.current = e.target;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (!closeOnBackdropClick) return;
    const startedOnBackdrop =
      pointerDownTargetRef.current === null ||
      pointerDownTargetRef.current === dialogRef.current;
    pointerDownTargetRef.current = null;

    if (e.target === dialogRef.current && startedOnBackdrop) {
      onClose();
    }
  };

  const closedByValue = closeOnBackdropClick
    ? "any"
    : closeOnEscape
      ? "closerequest"
      : "none";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onClick={handleBackdropClick}
      {...({ closedby: closedByValue } as Record<string, string>)}
      className={cn(
        "fixed inset-0 m-auto w-[calc(100%-2rem)] bg-transparent p-0 text-ink backdrop:bg-ink/45",
        SIZE_CLASSES[size],
        !open && "hidden",
      )}
    >
      {open && (
        <div
          className={cn(
            "flex max-h-[90vh] w-full flex-col overflow-hidden rounded-[18px] border border-hairline bg-canvas text-ink",
            className,
          )}
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-divider-soft bg-canvas px-6 py-4">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="font-display text-[19px] font-semibold leading-snug tracking-[-0.015em] text-ink"
              >
                {title}
              </h2>
              {description && (
                <p
                  id={descriptionId}
                  className="mt-1 text-[13px] leading-relaxed text-ink-muted-48"
                >
                  {description}
                </p>
              )}
            </div>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas text-ink-muted-80 transition-colors hover:bg-canvas-parchment hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

          {footer && (
            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 border-t border-divider-soft bg-canvas px-6 py-4">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export const Modal = Dialog;
