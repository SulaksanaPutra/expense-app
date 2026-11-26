"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export type SwitchTone = "success" | "primary";
export type SwitchSize = "sm" | "md";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  tone?: SwitchTone;
  size?: SwitchSize;
  id?: string;
  name?: string;
  className?: string;
  "aria-label"?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  disabledReason,
  tone = "success",
  size = "md",
  id,
  className,
  "aria-label": ariaLabel,
}: SwitchProps) {
  const generatedId = React.useId();
  const switchId = id ?? generatedId;
  const labelId = `${switchId}-label`;
  const descId = `${switchId}-desc`;
  const reasonId = `${switchId}-reason`;

  const toggle = () => {
    if (disabled) return;
    onCheckedChange(!checked);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  };

  const activeTrackClass =
    tone === "primary" ? "bg-primary" : "bg-[#22c55e]";

  const trackDimensions =
    size === "sm" ? "h-5 w-9" : "h-6 w-11";
  const thumbDimensions =
    size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const thumbTranslate =
    size === "sm"
      ? checked
        ? "translate-x-4"
        : "translate-x-0.5"
      : checked
        ? "translate-x-5"
        : "translate-x-0.5";

  const describedBy = [
    description ? descId : null,
    disabled && disabledReason ? reasonId : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cn("inline-flex items-center justify-between gap-3", className)}>
      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <label
              id={labelId}
              htmlFor={switchId}
              className={cn(
                "text-[14px] font-medium text-ink select-none",
                disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
              )}
            >
              {label}
            </label>
          )}
          {description && (
            <span id={descId} className="text-[12px] text-ink-muted-48">
              {description}
            </span>
          )}
          {disabled && disabledReason && (
            <span id={reasonId} className="text-[11px] text-ink-muted-48">
              {disabledReason}
            </span>
          )}
        </div>
      )}
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={!label ? ariaLabel : undefined}
        aria-labelledby={label ? labelId : undefined}
        aria-describedby={describedBy || undefined}
        disabled={disabled}
        title={disabled && disabledReason ? disabledReason : undefined}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-150",
          "focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2",
          trackDimensions,
          checked ? activeTrackClass : "bg-[#d2d2d7]",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none inline-block rounded-full bg-white shadow-xs transition-transform duration-150",
            thumbDimensions,
            thumbTranslate,
          )}
        />
      </button>
    </div>
  );
}
