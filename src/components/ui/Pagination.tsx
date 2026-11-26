"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  pageSize?: number;
  itemLabel?: string;
  className?: string;
}

function getPageNumbers(
  current: number,
  total: number,
): Array<number | "ellipsis"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: Array<number | "ellipsis"> = [1];

  if (current > 3) {
    pages.push("ellipsis");
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let p = start; p <= end; p += 1) {
    pages.push(p);
  }

  if (current < total - 2) {
    pages.push("ellipsis");
  }

  pages.push(total);
  return pages;
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  pageSize,
  itemLabel = "items",
  className,
}: PaginationProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const safeCurrent = Math.min(Math.max(1, currentPage), safeTotalPages);
  const pages = getPageNumbers(safeCurrent, safeTotalPages);

  const showSummary =
    typeof totalItems === "number" && typeof pageSize === "number" && pageSize > 0;
  const startItem =
    totalItems === 0 ? 0 : (safeCurrent - 1) * (pageSize ?? 1) + 1;
  const endItem = Math.min(safeCurrent * (pageSize ?? 1), totalItems ?? 0);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 pt-4",
        className,
      )}
    >
      {showSummary ? (
        <p className="text-[13px] text-ink-muted-48">
          Showing <span className="font-medium text-ink">{startItem}</span> to{" "}
          <span className="font-medium text-ink">{endItem}</span> of{" "}
          <span className="font-medium text-ink">{totalItems}</span> {itemLabel}
        </p>
      ) : (
        <span />
      )}

      <nav aria-label="Pagination" className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={safeCurrent <= 1}
          onClick={() => onPageChange(safeCurrent - 1)}
          className={cn(
            "inline-flex h-8 items-center justify-center rounded-pill border border-hairline bg-canvas px-3 text-[13px] font-medium text-ink-muted-80 transition-colors",
            "focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2",
            safeCurrent <= 1
              ? "opacity-45 cursor-not-allowed"
              : "hover:bg-canvas-parchment hover:text-ink cursor-pointer",
          )}
        >
          Previous
        </button>

        <div className="flex items-center gap-1">
          {pages.map((page, index) => {
            if (page === "ellipsis") {
              return (
                <span
                  key={`ellipsis-${index}`}
                  aria-hidden="true"
                  className="px-1.5 text-[13px] text-ink-muted-48"
                >
                  ...
                </span>
              );
            }

            const isCurrent = page === safeCurrent;
            return (
              <button
                key={page}
                type="button"
                aria-current={isCurrent ? "page" : undefined}
                aria-label={`Page ${page}`}
                onClick={() => onPageChange(page)}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-medium transition-colors cursor-pointer",
                  "focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2",
                  isCurrent
                    ? "bg-primary text-on-primary"
                    : "border border-hairline bg-canvas text-ink-muted-80 hover:bg-canvas-parchment hover:text-ink",
                )}
              >
                {page}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={safeCurrent >= safeTotalPages}
          onClick={() => onPageChange(safeCurrent + 1)}
          className={cn(
            "inline-flex h-8 items-center justify-center rounded-pill border border-hairline bg-canvas px-3 text-[13px] font-medium text-ink-muted-80 transition-colors",
            "focus-visible:outline-2 focus-visible:outline-primary-focus focus-visible:outline-offset-2",
            safeCurrent >= safeTotalPages
              ? "opacity-45 cursor-not-allowed"
              : "hover:bg-canvas-parchment hover:text-ink cursor-pointer",
          )}
        >
          Next
        </button>
      </nav>
    </div>
  );
}
