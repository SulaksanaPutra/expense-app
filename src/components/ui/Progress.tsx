import * as React from "react";
import { cn } from "@/lib/cn";

export type ProgressTone = "primary" | "success" | "warning" | "danger" | "auto";

export interface ProgressSegment {
  id: string;
  label: string;
  value: number;
  color: string;
}

export interface ProgressBarProps {
  value: number;
  min?: number;
  max?: number;
  label?: string;
  valueText?: string;
  showPercentage?: boolean;
  tone?: ProgressTone;
  size?: "sm" | "md" | "lg";
  segments?: ProgressSegment[];
  className?: string;
}

function resolveToneColor(tone: ProgressTone, percent: number): string {
  if (tone === "auto") {
    if (percent >= 90) return "bg-red-600";
    if (percent >= 75) return "bg-amber-500";
    return "bg-primary";
  }
  switch (tone) {
    case "success":
      return "bg-emerald-500";
    case "warning":
      return "bg-amber-500";
    case "danger":
      return "bg-red-600";
    case "primary":
    default:
      return "bg-primary";
  }
}

const HEIGHT_CLASSES = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-3.5",
};

export function ProgressBar({
  value,
  min = 0,
  max = 100,
  label = "Progress",
  valueText,
  showPercentage = false,
  tone = "primary",
  size = "md",
  segments,
  className,
}: ProgressBarProps) {
  const safeMax = max > min ? max : min + 100;
  const clamped = Math.min(Math.max(value, min), safeMax);
  const percent = Math.round(((clamped - min) / (safeMax - min)) * 100);

  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
      {(showPercentage || valueText) && (
        <div className="flex items-center justify-between text-[12px] text-ink-muted-48">
          <span>{label}</span>
          <span className="font-medium text-ink-muted-80">
            {valueText ?? `${percent}%`}
          </span>
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={min}
        aria-valuemax={safeMax}
        aria-valuetext={valueText}
        className={cn(
          "flex w-full overflow-hidden rounded-full bg-divider-soft",
          HEIGHT_CLASSES[size],
        )}
      >
        {segments && segments.length > 0 ? (
          segments.map((seg) => {
            const segPercent = Math.max(
              0,
              Math.min(100, (seg.value / (safeMax - min)) * 100),
            );
            if (segPercent <= 0) return null;
            return (
              <div
                key={seg.id}
                title={`${seg.label}: ${Math.round(segPercent)}%`}
                className="h-full transition-[width] duration-300 first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${segPercent}%`,
                  backgroundColor: seg.color,
                }}
              />
            );
          })
        ) : (
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300",
              resolveToneColor(tone, percent),
            )}
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
    </div>
  );
}

export interface ProgressRingProps {
  value: number;
  min?: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  valueText?: string;
  centerLabel?: React.ReactNode;
  tone?: ProgressTone;
  className?: string;
}

function resolveRingStroke(tone: ProgressTone, percent: number): string {
  if (tone === "auto") {
    if (percent >= 90) return "#dc2626";
    if (percent >= 75) return "#f59e0b";
    return "#0066cc";
  }
  switch (tone) {
    case "success":
      return "#22c55e";
    case "warning":
      return "#f59e0b";
    case "danger":
      return "#dc2626";
    case "primary":
    default:
      return "#0066cc";
  }
}

export function ProgressRing({
  value,
  min = 0,
  max = 100,
  size = 64,
  strokeWidth = 6,
  label = "Quota progress",
  valueText,
  centerLabel,
  tone = "primary",
  className,
}: ProgressRingProps) {
  const safeMax = max > min ? max : min + 100;
  const clamped = Math.min(Math.max(value, min), safeMax);
  const percent = Math.round(((clamped - min) / (safeMax - min)) * 100);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (percent / 100) * circumference;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={min}
      aria-valuemax={safeMax}
      aria-valuetext={valueText ?? `${percent}%`}
      style={{ width: size, height: size }}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#f0f0f0"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={resolveRingStroke(tone, percent)}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] font-semibold text-ink"
      >
        {centerLabel ?? `${percent}%`}
      </div>
    </div>
  );
}
