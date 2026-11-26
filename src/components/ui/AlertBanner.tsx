"use client";

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";

export type AlertTone = "info" | "warning" | "error" | "success";

export interface AlertBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
}

const TONE_STYLES: Record<
  AlertTone,
  { container: string; iconColor: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  info: {
    container: "bg-[#0066cc]/8 border-[#0066cc]/25 text-ink",
    iconColor: "text-[#0066cc]",
    Icon: Info,
  },
  success: {
    container: "bg-emerald-50 border-emerald-200 text-emerald-950",
    iconColor: "text-emerald-600",
    Icon: CheckCircle2,
  },
  warning: {
    container: "bg-amber-50 border-amber-200 text-amber-950",
    iconColor: "text-amber-600",
    Icon: AlertTriangle,
  },
  error: {
    container: "bg-red-50 border-red-200 text-red-950",
    iconColor: "text-red-600",
    Icon: AlertCircle,
  },
};

export function AlertBanner({
  tone = "info",
  title,
  description,
  action,
  onDismiss,
  className,
  children,
  ...props
}: AlertBannerProps) {
  const { container, iconColor, Icon } = TONE_STYLES[tone];
  const isUrgent = tone === "error" || tone === "warning";

  return (
    <div
      role={isUrgent ? "alert" : "status"}
      aria-live={isUrgent ? "assertive" : "polite"}
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 text-[13px]",
        container,
        className,
      )}
      {...props}
    >
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", iconColor)}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold leading-snug">{title}</p>}
        {description && (
          <div className={cn("leading-relaxed opacity-90", title && "mt-0.5")}>
            {description}
          </div>
        )}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss alert"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full opacity-70 hover:bg-black/5 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-primary-focus"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
