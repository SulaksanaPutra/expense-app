import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  wrapperClassName?: string;
  bordered?: boolean;
}

export function Table({
  wrapperClassName,
  bordered = true,
  className,
  children,
  ...props
}: TableProps) {
  return (
    <div
      className={cn(
        "w-full overflow-x-auto",
        bordered && "rounded-[14px] border border-hairline",
        wrapperClassName,
      )}
    >
      <table
        className={cn(
          "w-full border-collapse text-left text-[14px] text-on-surface",
          className,
        )}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "border-b border-hairline bg-surface-pearl text-[11px] font-semibold uppercase tracking-wider text-outline",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn("divide-y divide-divider-soft bg-canvas", className)}
      {...props}
    />
  );
}

export function TableRow({
  className,
  onClick,
  onKeyDown,
  tabIndex,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  const isClickable = Boolean(onClick);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
    onKeyDown?.(e);
    if (
      isClickable &&
      !e.defaultPrevented &&
      e.target === e.currentTarget &&
      (e.key === "Enter" || e.key === " ")
    ) {
      e.preventDefault();
      onClick?.(e as unknown as React.MouseEvent<HTMLTableRowElement>);
    }
  };

  return (
    <tr
      onClick={onClick}
      onKeyDown={isClickable || onKeyDown ? handleKeyDown : undefined}
      tabIndex={tabIndex ?? (isClickable ? 0 : undefined)}
      className={cn(
        "transition-colors hover:bg-surface-pearl/70",
        isClickable &&
          "cursor-pointer focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-[-2px]",
        className,
      )}
      {...props}
    />
  );
}

export type SortDirection = "asc" | "desc" | null;

export interface TableHeadProps
  extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
  sortDirection?: SortDirection;
  onSort?: () => void;
}

export function TableHead({
  sortable = false,
  sortDirection = null,
  onSort,
  className,
  children,
  ...props
}: TableHeadProps) {
  const ariaSort = sortable
    ? sortDirection === "asc"
      ? "ascending"
      : sortDirection === "desc"
        ? "descending"
        : "none"
    : undefined;

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn("px-4 py-3 font-semibold whitespace-nowrap", className)}
      {...props}
    >
      {sortable && onSort ? (
        <button
          type="button"
          onClick={onSort}
          className="inline-flex items-center gap-1.5 uppercase tracking-wider text-inherit hover:text-on-surface focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2"
        >
          <span>{children}</span>
          {sortDirection === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          ) : sortDirection === "desc" ? (
            <ArrowDown className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
          )}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function TableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-4 py-3.5 align-middle", className)} {...props} />
  );
}

export interface TableEmptyProps {
  colSpan: number;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function TableEmpty({
  colSpan,
  title = "No records found",
  description,
  action,
}: TableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
          <p className="text-[14px] font-semibold text-on-surface">{title}</p>
          {description && (
            <p className="text-[13px] text-outline">{description}</p>
          )}
          {action && <div className="mt-2">{action}</div>}
        </div>
      </td>
    </tr>
  );
}
