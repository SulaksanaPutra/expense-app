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

export type ToastTone = "info" | "warning" | "error" | "success";

export interface ToastItem {
  id: string;
  tone?: ToastTone;
  title: string;
  description?: string;
  duration?: number;
  dismissible?: boolean;
}

export interface ToastProps extends ToastItem {
  onDismiss: (id: string) => void;
}

const TONE_MAP: Record<
  ToastTone,
  { accent: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  info: { accent: "text-[#0066cc]", Icon: Info },
  success: { accent: "text-emerald-600", Icon: CheckCircle2 },
  warning: { accent: "text-amber-600", Icon: AlertTriangle },
  error: { accent: "text-red-600", Icon: AlertCircle },
};

export function Toast({
  id,
  tone = "info",
  title,
  description,
  duration = 5000,
  dismissible = true,
  onDismiss,
}: ToastProps) {
  const [paused, setPaused] = React.useState(false);
  const { accent, Icon } = TONE_MAP[tone];

  React.useEffect(() => {
    if (duration <= 0 || paused) return;
    const timer = window.setTimeout(() => {
      onDismiss(id);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [duration, id, onDismiss, paused]);

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[14px] border border-hairline bg-canvas p-4 text-ink shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", accent)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-snug text-ink">{title}</p>
        {description && (
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted-80">
            {description}
          </p>
        )}
      </div>
      {dismissible && (
        <button
          type="button"
          onClick={() => onDismiss(id)}
          aria-label="Close notification"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-muted-48 hover:bg-canvas-parchment hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-focus"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  className?: string;
}

export function ToastContainer({
  toasts,
  onDismiss,
  className,
}: ToastContainerProps) {
  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2.5",
        className,
      )}
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

interface ToastContextValue {
  toasts: ToastItem[];
  pushToast: (toast: Omit<ToastItem, "id">) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const counterRef = React.useRef(0);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = React.useCallback((toast: Omit<ToastItem, "id">) => {
    counterRef.current += 1;
    const id = `toast-${counterRef.current}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    return id;
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, pushToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
