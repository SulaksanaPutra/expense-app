import * as React from "react";
import { cn } from "@/lib/cn";

export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "category";

export type BadgeSize = "sm" | "md";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
  dotColor?: string;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-surface-container-low text-on-surface-variant border-hairline",
  info: "bg-primary/10 text-primary border-primary/20",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-700 border-red-200",
  category: "bg-surface-pearl text-on-surface-variant border-hairline",
};

const DOT_COLOR_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-outline",
  info: "bg-primary",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  category: "bg-primary",
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "px-2.5 py-0.5 text-[11px]",
  md: "px-3 py-1 text-[12px]",
};

export function Badge({
  tone = "neutral",
  size = "md",
  dot = false,
  dotColor,
  className,
  children,
  ...props
}: BadgeProps) {
  const showDot = dot || tone === "category";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border font-medium leading-none whitespace-nowrap tabular-nums",
        TONE_CLASSES[tone],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {showDot && (
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            !dotColor && DOT_COLOR_CLASSES[tone],
          )}
          style={dotColor ? { backgroundColor: dotColor } : undefined}
        />
      )}
      {children}
    </span>
  );
}

export type StatusPillProps = BadgeProps;

export function StatusPill(props: StatusPillProps) {
  return <Badge {...props} />;
}
