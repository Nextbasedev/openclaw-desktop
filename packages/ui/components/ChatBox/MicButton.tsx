"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { Mic01Icon } from "@hugeicons/core-free-icons"

export function MicButton() {
  return (
    <button
      type="button"
      className="flex size-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      aria-label="Voice input"
    >
      <HugeiconsIcon icon={Mic01Icon} size={18} />
    </button>
  )
}
