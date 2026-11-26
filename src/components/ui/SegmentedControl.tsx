"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export type SegmentedControlVariant = "pill-tabs" | "split-method";

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  badge?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string = string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  variant?: SegmentedControlVariant;
  ariaLabel?: string;
  fullWidth?: boolean;
  idPrefix?: string;
  className?: string;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  variant = "split-method",
  ariaLabel = "Options",
  fullWidth = false,
  idPrefix,
  className,
}: SegmentedControlProps<T>) {
  const generatedPrefix = React.useId();
  const prefix = idPrefix ?? generatedPrefix;
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const selectAndFocus = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    tabRefs.current[index]?.focus();
    onChange(option.value);
  };

  const findNextEnabledIndex = (start: number, step: 1 | -1): number => {
    const len = options.length;
    for (let offset = 1; offset <= len; offset += 1) {
      const idx = (start + step * offset + len) % len;
      if (!options[idx]?.disabled) return idx;
    }
    return start;
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (options.length === 0) return;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      selectAndFocus(findNextEnabledIndex(index, 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      selectAndFocus(findNextEnabledIndex(index, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = options.findIndex((o) => !o.disabled);
      if (first >= 0) selectAndFocus(first);
    } else if (e.key === "End") {
      e.preventDefault();
      for (let i = options.length - 1; i >= 0; i -= 1) {
        if (!options[i]?.disabled) {
          selectAndFocus(i);
          break;
        }
      }
    }
  };

  const containerStyle =
    variant === "pill-tabs"
      ? "bg-canvas border border-hairline p-1 rounded-pill"
      : "bg-canvas-parchment border border-hairline/60 p-1 rounded-pill";

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex max-w-full flex-nowrap items-center gap-1 overflow-x-auto",
        containerStyle,
        fullWidth && "w-full",
        className,
      )}
    >
      {options.map((option, idx) => {
        const isSelected = option.value === value;
        const tabId = `${prefix}-tab-${option.value}`;

        const activeTabStyle =
          variant === "pill-tabs"
            ? "bg-primary text-on-primary"
            : "bg-canvas text-ink border border-hairline/70";
        const inactiveTabStyle =
          "bg-transparent text-ink-muted-80 hover:text-ink border border-transparent";

        return (
          <button
            key={option.value}
            ref={(el) => {
              tabRefs.current[idx] = el;
            }}
            id={tabId}
            type="button"
            role="tab"
            aria-selected={isSelected}
            tabIndex={isSelected ? 0 : -1}
            disabled={option.disabled}
            onClick={() => {
              if (!option.disabled) onChange(option.value);
            }}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-pill px-4 py-2 text-[13px] font-medium whitespace-nowrap transition-colors",
              "focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2",
              fullWidth && "flex-1",
              isSelected ? activeTabStyle : inactiveTabStyle,
              option.disabled
                ? "opacity-45 cursor-not-allowed"
                : "cursor-pointer",
            )}
          >
            {option.icon && (
              <span className="inline-flex shrink-0 items-center" aria-hidden="true">
                {option.icon}
              </span>
            )}
            <span>{option.label}</span>
            {option.badge}
          </button>
        );
      })}
    </div>
  );
}

export const Tabs = SegmentedControl;

export interface TabPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  active: boolean;
  tabId?: string;
}

export function TabPanel({
  active,
  tabId,
  className,
  children,
  ...props
}: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      aria-labelledby={tabId}
      hidden={!active}
      tabIndex={active ? 0 : undefined}
      className={cn("focus-visible:outline-none", className)}
      {...props}
    >
      {children}
    </div>
  );
}
