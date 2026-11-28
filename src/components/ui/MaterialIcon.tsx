import * as React from "react";
import { cn } from "@/lib/cn";

export interface MaterialIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: number;
  filled?: boolean;
  label?: string;
}

export function MaterialIcon({
  name,
  size = 20,
  filled = false,
  label,
  className,
  style,
  ...props
}: MaterialIconProps) {
  return (
    <span
      className={cn("material-symbols-outlined shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        fontSize: `${size}px`,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' ${Math.max(20, Math.min(48, size))}`,
        ...style,
      }}
      {...props}
    >
      {name}
    </span>
  );
}
