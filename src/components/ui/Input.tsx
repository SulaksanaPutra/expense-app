"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label?: string;
  error?: string;
  hint?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      label,
      error,
      hint,
      prefix,
      suffix,
      id,
      className,
      containerClassName,
      disabled,
      required,
      ...props
    },
    ref,
  ) {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;

    const describedBy = [error ? errorId : null, hint ? hintId : null]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-[12px] font-semibold tracking-wide text-ink-muted-80"
          >
            {label}
            {required && (
              <span className="ml-0.5 text-red-600" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        <div
          className={cn(
            "flex h-11 items-center gap-2 rounded-md border bg-canvas px-3.5 transition-colors",
            error
              ? "border-red-500 focus-within:outline-2 focus-within:outline-red-500 focus-within:outline-offset-0"
              : "border-hairline focus-within:border-primary-focus focus-within:outline-2 focus-within:outline-primary-focus focus-within:outline-offset-0",
            disabled && "bg-canvas-parchment opacity-60 cursor-not-allowed",
          )}
        >
          {prefix && (
            <span className="inline-flex shrink-0 items-center text-[14px] text-ink-muted-48">
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            required={required}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={describedBy || undefined}
            className={cn(
              "w-full min-w-0 bg-transparent text-[15px] text-ink placeholder:text-ink-muted-48 focus:outline-none disabled:cursor-not-allowed",
              className,
            )}
            {...props}
          />
          {suffix && (
            <span className="inline-flex shrink-0 items-center text-[14px] text-ink-muted-48">
              {suffix}
            </span>
          )}
        </div>
        {hint && !error && (
          <p id={hintId} className="text-[12px] text-ink-muted-48">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-[12px] font-medium text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  },
);

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  shortcut?: string;
  onClear?: () => void;
  containerClassName?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      label,
      shortcut,
      onClear,
      value,
      onChange,
      placeholder = "Search...",
      id,
      className,
      containerClassName,
      disabled,
      ...props
    },
    ref,
  ) {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const hasValue =
      typeof value === "string"
        ? value.length > 0
        : typeof value === "number"
          ? true
          : false;

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-[12px] font-semibold tracking-wide text-ink-muted-80"
          >
            {label}
          </label>
        )}
        <div
          className={cn(
            "flex h-11 items-center gap-2.5 rounded-pill border border-hairline bg-canvas px-4 transition-colors",
            "focus-within:border-primary-focus focus-within:outline-2 focus-within:outline-primary-focus focus-within:outline-offset-0",
            disabled && "bg-canvas-parchment opacity-60 cursor-not-allowed",
          )}
        >
          <Search
            className="h-4 w-4 shrink-0 text-ink-muted-48"
            aria-hidden="true"
          />
          <input
            ref={ref}
            id={inputId}
            type="search"
            value={value}
            onChange={onChange}
            disabled={disabled}
            placeholder={placeholder}
            aria-label={props["aria-label"] ?? (label ? undefined : placeholder)}
            className={cn(
              "w-full min-w-0 bg-transparent text-[14px] text-ink placeholder:text-ink-muted-48 focus:outline-none disabled:cursor-not-allowed [&::-webkit-search-cancel-button]:appearance-none",
              className,
            )}
            {...props}
          />
          {hasValue && onClear && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear search"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-muted-48 hover:bg-canvas-parchment hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-focus"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {!hasValue && shortcut && (
            <kbd className="inline-flex shrink-0 items-center rounded-xs border border-hairline bg-surface-pearl px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink-muted-48">
              {shortcut}
            </kbd>
          )}
        </div>
      </div>
    );
  },
);
