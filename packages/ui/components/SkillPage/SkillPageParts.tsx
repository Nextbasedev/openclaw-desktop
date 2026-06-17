"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors cursor-pointer",
        active
          ? "border-foreground/20 bg-card text-foreground"
          : "border-border/60 bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground",
      )}
    >
      {label}
      {count != null && count > 0 && (
        <span
          className={cn(
            "inline-flex min-w-[18px] items-center justify-center rounded-full px-1 py-px text-[10px] font-bold",
            active
              ? "bg-foreground/15 text-foreground"
              : "bg-muted-foreground/15 text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card px-5 py-12 text-center">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted/30 text-muted-foreground/60">
        {icon}
      </div>
      <p className="text-[14px] font-medium text-foreground">
        {title}
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground/70">
        {description}
      </p>
    </div>
  )
}

export function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="min-h-[140px] rounded-md border border-border/60 bg-card p-5 backdrop-blur-xl"
        >
          <div className="flex items-start gap-3.5">
            <div className="size-10 animate-pulse rounded-lg bg-foreground/[0.08]" />
            <div className="flex-1 space-y-2.5">
              <div className="h-4 w-32 animate-pulse rounded-md bg-foreground/[0.08]" />
              <div className="h-3 w-full animate-pulse rounded-md bg-foreground/[0.06]" />
              <div className="h-3 w-3/4 animate-pulse rounded-md bg-foreground/[0.05]" />
            </div>
            <div className="size-8 animate-pulse rounded-full bg-foreground/[0.06]" />
          </div>
          <div className="mt-auto flex items-center gap-2 pt-6">
            <div className="h-5 w-16 animate-pulse rounded-full bg-foreground/[0.06]" />
          </div>
        </div>
      ))}
    </div>
  )
}
