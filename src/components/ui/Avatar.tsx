"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  src?: string | null;
  initials?: string;
  size?: AvatarSize;
  toneClassName?: string;
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-[12px]",
  lg: "h-12 w-12 text-[16px]",
};

const TONE_PALETTE = [
  "bg-primary text-on-primary",
  "bg-emerald-600 text-white",
  "bg-indigo-600 text-white",
  "bg-amber-600 text-white",
  "bg-slate-700 text-white",
  "bg-rose-600 text-white",
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getToneFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return TONE_PALETTE[hash % TONE_PALETTE.length];
}

export function Avatar({
  name,
  src,
  initials,
  size = "md",
  toneClassName,
  className,
  ...props
}: AvatarProps) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const displayInitials = initials ?? getInitials(name);
  const imgFailed = Boolean(src) && failedSrc === src;
  const showImage = Boolean(src) && !imgFailed;

  return (
    <span
      role={showImage ? undefined : "img"}
      aria-label={showImage ? undefined : name}
      title={name}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none",
        SIZE_CLASSES[size],
        !showImage && (toneClassName ?? getToneFromName(name)),
        className,
      )}
      {...props}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt={name}
          onError={() => setFailedSrc(src ?? null)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{displayInitials}</span>
      )}
    </span>
  );
}

export interface AvatarStackMember {
  id: string;
  name: string;
  src?: string | null;
  initials?: string;
}

export interface AvatarStackProps extends React.HTMLAttributes<HTMLDivElement> {
  members: AvatarStackMember[];
  max?: number;
  size?: AvatarSize;
}

export function AvatarStack({
  members,
  max = 3,
  size = "sm",
  className,
  ...props
}: AvatarStackProps) {
  const visible = members.slice(0, max);
  const overflowCount = Math.max(0, members.length - max);
  const memberListLabel =
    props["aria-label"] ??
    `Members: ${members.map((m) => m.name).join(", ")}`;

  return (
    <div
      role="group"
      aria-label={memberListLabel}
      className={cn("inline-flex items-center -space-x-2", className)}
      {...props}
    >
      {visible.map((member) => (
        <Avatar
          key={member.id}
          name={member.name}
          src={member.src}
          initials={member.initials}
          size={size}
          className="ring-2 ring-canvas"
        />
      ))}
      {overflowCount > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-container-low font-semibold text-on-surface-variant ring-2 ring-canvas tabular-nums",
            SIZE_CLASSES[size],
          )}
        >
          +{overflowCount}
        </span>
      )}
    </div>
  );
}
