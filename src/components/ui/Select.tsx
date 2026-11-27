"use client";

import * as React from "react";
import { Check, ChevronDown, MoreVertical, Search } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export type SelectVariant = "default" | "pill-select" | "searchable-select";

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  error?: string;
  variant?: SelectVariant;
  menuPlacement?: "bottom" | "top";
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  id?: string;
  selectedLabel?: React.ReactNode;
  className?: string;
  containerClassName?: string;
  "aria-label"?: string;
}

export function Select({
  options,
  value,
  onChange,
  placeholder = "Select an option",
  label,
  error,
  variant = "default",
  menuPlacement = "bottom",
  searchable,
  searchPlaceholder = "Search options...",
  disabled = false,
  id,
  selectedLabel,
  className,
  containerClassName,
  "aria-label": ariaLabel,
}: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState<number>(-1);

  const generatedId = React.useId();
  const selectId = id ?? generatedId;
  const labelId = `${selectId}-label`;
  const listboxId = `${selectId}-listbox`;
  const errorId = `${selectId}-error`;

  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const isSearchable = searchable ?? variant === "searchable-select";
  const selectedOption = options.find((o) => o.value === value);

  const filteredOptions = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!isSearchable || !q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.description?.toLowerCase().includes(q),
    );
  }, [isSearchable, options, searchQuery]);

  const openMenu = React.useCallback(() => {
    const selectedIdx = options.findIndex(
      (opt) => opt.value === value && !opt.disabled,
    );
    const firstEnabled = options.findIndex((opt) => !opt.disabled);
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : firstEnabled);
    setOpen(true);
  }, [options, value]);

  React.useEffect(() => {
    if (open && isSearchable) {
      searchInputRef.current?.focus();
    }
  }, [open, isSearchable]);

  React.useEffect(() => {
    if (!open) return;

    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSearchQuery("");
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setSearchQuery("");
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  };

  const commitOption = (option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    closeMenu(true);
  };

  const clampedActiveIndex =
    filteredOptions.length === 0
      ? -1
      : activeIndex >= 0 && activeIndex < filteredOptions.length
        ? activeIndex
        : filteredOptions.findIndex((o) => !o.disabled);

  const moveActiveIndex = (step: 1 | -1) => {
    if (filteredOptions.length === 0) return;
    const len = filteredOptions.length;
    const start =
      clampedActiveIndex < 0 ? (step === 1 ? -1 : 0) : clampedActiveIndex;
    for (let offset = 1; offset <= len; offset += 1) {
      const idx = (start + step * offset + len) % len;
      if (!filteredOptions[idx]?.disabled) {
        setActiveIndex(idx);
        return;
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!open) {
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Enter" ||
        e.key === " "
      ) {
        e.preventDefault();
        openMenu();
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActiveIndex(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActiveIndex(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = filteredOptions.findIndex((o) => !o.disabled);
      if (first >= 0) setActiveIndex(first);
    } else if (e.key === "End") {
      e.preventDefault();
      for (let i = filteredOptions.length - 1; i >= 0; i -= 1) {
        if (!filteredOptions[i]?.disabled) {
          setActiveIndex(i);
          break;
        }
      }
    } else if (e.key === "Enter" || (e.key === " " && !isSearchable)) {
      e.preventDefault();
      const activeOpt = filteredOptions[clampedActiveIndex];
      if (activeOpt && !activeOpt.disabled) {
        commitOption(activeOpt);
      }
    } else if (e.key === "Tab") {
      closeMenu(false);
    }
  };

  const activeOptionId =
    open && clampedActiveIndex >= 0 && filteredOptions[clampedActiveIndex]
      ? `${selectId}-opt-${filteredOptions[clampedActiveIndex].value}`
      : undefined;

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={cn("relative flex flex-col gap-1.5", containerClassName)}
    >
      {label && (
        <label
          id={labelId}
          htmlFor={selectId}
          className="text-[12px] font-semibold tracking-wide text-ink-muted-80"
        >
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-labelledby={label ? `${labelId} ${selectId}` : undefined}
        aria-label={!label ? ariaLabel ?? placeholder : undefined}
        aria-describedby={error ? errorId : undefined}
        onClick={() => {
          if (disabled) return;
          if (open) {
            closeMenu(false);
          } else {
            openMenu();
          }
        }}
        className={cn(
          "inline-flex items-center justify-between gap-2 border bg-canvas text-left text-[14px] text-ink transition-colors",
          "focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2",
          variant === "pill-select"
            ? "h-10 rounded-pill px-4"
            : "h-11 rounded-md px-3.5",
          error ? "border-red-500" : "border-hairline hover:bg-surface-pearl",
          disabled ? "bg-canvas-parchment opacity-60 cursor-not-allowed" : "cursor-pointer",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selectedOption?.icon && (
            <span className="inline-flex shrink-0 items-center" aria-hidden="true">
              {selectedOption.icon}
            </span>
          )}
          <span
            className={cn(
              "truncate",
              !selectedOption && "text-ink-muted-48",
            )}
          >
            {selectedLabel ?? (selectedOption ? selectedOption.label : placeholder)}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-ink-muted-48 transition-transform duration-150",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className={cn(
            "absolute left-0 z-40 w-full min-w-[200px] overflow-hidden rounded-[14px] border border-hairline bg-canvas p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
            menuPlacement === "top"
              ? "bottom-full mb-1.5"
              : "top-full mt-1.5",
          )}
        >
          {isSearchable && (
            <div className="mb-1.5 flex items-center gap-2 rounded-sm border border-hairline bg-surface-pearl px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-muted-48" aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                className="w-full min-w-0 bg-transparent text-[13px] text-ink placeholder:text-ink-muted-48 focus:outline-none"
              />
            </div>
          )}
          <ul
            id={listboxId}
            role="listbox"
            aria-labelledby={label ? labelId : undefined}
            aria-label={!label ? ariaLabel ?? placeholder : undefined}
            aria-activedescendant={activeOptionId}
            className="max-h-60 overflow-y-auto"
          >
            {filteredOptions.length === 0 ? (
              <li className="px-3 py-2 text-[13px] text-ink-muted-48">
                No matching options
              </li>
            ) : (
              filteredOptions.map((option, idx) => {
                const isSelected = option.value === value;
                const isActive = idx === clampedActiveIndex;
                const optId = `${selectId}-opt-${option.value}`;

                return (
                  <li
                    key={option.value}
                    id={optId}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    onMouseEnter={() => {
                      if (!option.disabled) setActiveIndex(idx);
                    }}
                    onClick={() => commitOption(option)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-[13px] transition-colors",
                      option.disabled
                        ? "opacity-45 cursor-not-allowed"
                        : "cursor-pointer",
                      isActive && !option.disabled && "bg-canvas-parchment",
                      isSelected && "font-semibold text-primary",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {option.icon && (
                        <span className="inline-flex shrink-0 items-center" aria-hidden="true">
                          {option.icon}
                        </span>
                      )}
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{option.label}</span>
                        {option.description && (
                          <span className="truncate text-[11px] font-normal text-ink-muted-48">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </span>
                    {isSelected && (
                      <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className="text-[12px] font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export interface DropdownItem {
  id: string;
  label?: string;
  icon?: React.ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

export interface DropdownProps {
  items: DropdownItem[];
  trigger?: React.ReactNode;
  triggerAriaLabel?: string;
  variant?: "action-menu" | "button";
  align?: "left" | "right";
  disabled?: boolean;
  className?: string;
}

export function Dropdown({
  items,
  trigger,
  triggerAriaLabel = "Open actions menu",
  variant = "action-menu",
  align = "right",
  disabled = false,
  className,
}: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties | null>(
    null,
  );
  const generatedId = React.useId();
  const triggerId = `${generatedId}-trigger`;
  const menuId = `${generatedId}-menu`;

  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const computeMenuPosition = React.useCallback((): React.CSSProperties | null => {
    const triggerEl = triggerRef.current;
    if (!triggerEl) return null;
    const rect = triggerEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return null;
    }
    const viewportHeight = window.innerHeight || 800;
    const viewportWidth = window.innerWidth || 1280;
    const spaceBelow = viewportHeight - rect.bottom;
    const openUpward = spaceBelow < 210 && rect.top > 210;

    const nextStyle: React.CSSProperties = {
      position: "fixed",
      zIndex: 50,
    };
    if (openUpward) {
      nextStyle.bottom = Math.max(8, viewportHeight - rect.top + 6);
    } else {
      nextStyle.top = Math.min(viewportHeight - 16, rect.bottom + 6);
    }
    if (align === "right") {
      nextStyle.right = Math.max(8, viewportWidth - rect.right);
    } else {
      nextStyle.left = Math.max(8, rect.left);
    }
    return nextStyle;
  }, [align]);

  const openDropdown = React.useCallback(() => {
    setMenuStyle(computeMenuPosition());
    setOpen(true);
  }, [computeMenuPosition]);

  const closeDropdown = React.useCallback(() => {
    setOpen(false);
    setMenuStyle(null);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const handleReposition = () => {
      setMenuStyle(computeMenuPosition());
    };
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [open, computeMenuPosition]);

  const actionableItems = React.useMemo(
    () => items.filter((item) => !item.separator),
    [items],
  );

  const actionIndexMap = React.useMemo(() => {
    const map = new Map<string, number>();
    let cursor = 0;
    for (const item of items) {
      if (!item.separator) {
        map.set(item.id, cursor);
        cursor += 1;
      }
    }
    return map;
  }, [items]);

  React.useEffect(() => {
    if (!open) return;

    const handleOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        closeDropdown();
      }
    };

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open, closeDropdown]);

  const focusItem = (idx: number) => {
    itemRefs.current[idx]?.focus();
  };

  const findEnabledIndex = (start: number, step: 1 | -1): number => {
    const len = actionableItems.length;
    for (let offset = 1; offset <= len; offset += 1) {
      const idx = (start + step * offset + len) % len;
      if (!actionableItems[idx]?.disabled) return idx;
    }
    return -1;
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDropdown();
      queueMicrotask(() => {
        const first = actionableItems.findIndex((i) => !i.disabled);
        if (first >= 0) focusItem(first);
      });
    }
  };

  const handleMenuKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    actionIndex: number,
  ) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeDropdown();
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = findEnabledIndex(actionIndex, 1);
      if (next >= 0) focusItem(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = findEnabledIndex(actionIndex, -1);
      if (prev >= 0) focusItem(prev);
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = actionableItems.findIndex((i) => !i.disabled);
      if (first >= 0) focusItem(first);
    } else if (e.key === "End") {
      e.preventDefault();
      for (let i = actionableItems.length - 1; i >= 0; i -= 1) {
        if (!actionableItems[i]?.disabled) {
          focusItem(i);
          break;
        }
      }
    } else if (e.key === "Tab") {
      closeDropdown();
    }
  };

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerAriaLabel}
        onClick={() => {
          if (disabled) return;
          if (open) {
            closeDropdown();
          } else {
            openDropdown();
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "inline-flex items-center justify-center transition-colors",
          "focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2",
          variant === "action-menu" && !trigger
            ? "h-8 w-8 rounded-full text-ink-muted-48 hover:bg-canvas-parchment hover:text-ink"
            : "h-10 rounded-pill border border-hairline bg-canvas px-4 text-[14px] font-medium text-ink hover:bg-surface-pearl",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        )}
      >
        {trigger ?? <MoreVertical className="h-4 w-4" aria-hidden="true" />}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          style={menuStyle ?? undefined}
          className={cn(
            "z-40 min-w-[180px] rounded-[14px] border border-hairline bg-canvas p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
            !menuStyle && "absolute top-full mt-1.5",
            !menuStyle && (align === "right" ? "right-0" : "left-0"),
          )}
        >
          {items.map((item) => {
            if (item.separator) {
              return (
                <hr
                  key={item.id}
                  className="my-1 border-t border-divider-soft"
                />
              );
            }

            const currentIdx = actionIndexMap.get(item.id) ?? 0;

            return (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[currentIdx] = el;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  item.onSelect?.();
                  closeDropdown();
                  triggerRef.current?.focus();
                }}
                onKeyDown={(e) => handleMenuKeyDown(e, currentIdx)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-[13px] font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-[-2px]",
                  item.danger
                    ? "text-red-600 hover:bg-red-50 focus:bg-red-50"
                    : "text-ink hover:bg-canvas-parchment focus:bg-canvas-parchment",
                  item.disabled
                    ? "opacity-45 cursor-not-allowed"
                    : "cursor-pointer",
                )}
              >
                {item.icon && (
                  <span className="inline-flex shrink-0 items-center" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
