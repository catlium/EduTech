"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ResourceCard({
  icon,
  title,
  subtitle,
  badges,
  actions,
  onClick,
  id,
  className,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  badges?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
  id?: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "group flex items-start gap-3 rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
        onClick && "cursor-pointer",
        className,
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {icon && (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
        {badges && <div className="flex flex-wrap items-center gap-1.5 pt-0.5">{badges}</div>}
      </div>
      {actions && (
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}
