import * as React from "react";
import { cn } from "@/lib/cn";

export type CardVariant = "kpi" | "section" | "sub-card" | "spotlight";
export type CardPadding = "none" | "sm" | "md" | "lg";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
}

const VARIANT_CLASSES: Record<CardVariant, string> = {
  kpi: "bg-canvas border border-hairline rounded-[18px]",
  section: "bg-canvas border border-hairline rounded-[18px]",
  "sub-card": "bg-surface-container-low border border-hairline rounded-[18px]",
  spotlight: "bg-canvas border border-hairline rounded-[18px]",
};

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: "p-0",
  sm: "p-4",
  md: "p-4 md:p-6",
  lg: "p-6 md:p-8",
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "section", padding = "md", className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(VARIANT_CLASSES[variant], PADDING_CLASSES[padding], className)}
      {...props}
    >
      {children}
    </div>
  );
});

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4", className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "font-display text-[17px] font-semibold leading-snug tracking-[-0.015em] text-on-surface",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-[13px] leading-relaxed text-outline", className)}
      {...props}
    />
  );
}
