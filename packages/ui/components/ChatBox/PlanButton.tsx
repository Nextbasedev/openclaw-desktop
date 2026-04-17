"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { SparklesIcon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

type PlanButtonProps = {
  enabled: boolean
  onToggle: () => void
}

export function PlanButton({ enabled, onToggle }: PlanButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
        enabled
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <HugeiconsIcon icon={SparklesIcon} size={16} />
      Plan
    </button>
  )
}
