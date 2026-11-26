"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger-soft"
  | "danger"
  | "ghost"
  | "icon-circle";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "rounded-pill bg-primary text-on-primary hover:bg-primary-focus border border-transparent",
  secondary:
    "rounded-pill bg-canvas text-ink border border-hairline hover:bg-surface-pearl",
  "danger-soft":
    "rounded-pill bg-red-50 text-red-700 border border-red-200 hover:bg-red-100",
  danger:
    "rounded-pill bg-red-600 text-white border border-transparent hover:bg-red-700",
  ghost:
    "rounded-pill bg-transparent text-ink-muted-80 border border-transparent hover:bg-canvas-parchment hover:text-ink",
  "icon-circle":
    "rounded-full bg-canvas text-ink border border-hairline hover:bg-canvas-parchment p-0",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[13px] gap-1.5",
  md: "h-10 px-5 text-[14px] gap-2",
  lg: "h-11 px-6 text-[15px] gap-2",
};

const ICON_CIRCLE_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-9 w-9",
  md: "h-10 w-10",
  lg: "h-11 w-11",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      type = "button",
      className,
      children,
      ...props
    },
    ref,
  ) {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading ? "true" : undefined}
        className={cn(
          "inline-flex items-center justify-center font-medium leading-none transition-transform duration-150 select-none whitespace-nowrap",
          "focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2",
          !isDisabled && "active:scale-95 cursor-pointer",
          isDisabled && "opacity-50 cursor-not-allowed",
          VARIANT_CLASSES[variant],
          variant === "icon-circle"
            ? ICON_CIRCLE_SIZE_CLASSES[size]
            : SIZE_CLASSES[size],
          fullWidth && "w-full",
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          leftIcon && (
            <span className="inline-flex shrink-0 items-center" aria-hidden="true">
              {leftIcon}
            </span>
          )
        )}
        {children}
        {!loading && rightIcon && (
          <span className="inline-flex shrink-0 items-center" aria-hidden="true">
            {rightIcon}
          </span>
        )}
      </button>
    );
  },
);
