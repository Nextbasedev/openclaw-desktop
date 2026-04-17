"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUp01Icon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

type SendButtonProps = {
  disabled: boolean
}

export function SendButton({ disabled }: SendButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex size-9 items-center justify-center rounded-full transition-colors",
        disabled
          ? "cursor-not-allowed bg-muted text-muted-foreground/50"
          : "bg-foreground text-background hover:bg-foreground/85"
      )}
      aria-label="Send message"
    >
      <HugeiconsIcon icon={ArrowUp01Icon} size={18} />
    </button>
  )
}
