"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { Globe02Icon } from "@hugeicons/core-free-icons"

type WebSearchPillProps = {
  onDisable: () => void
}

export function WebSearchPill({ onDisable }: WebSearchPillProps) {
  return (
    <button
      type="button"
      onClick={onDisable}
      className="flex h-9 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3.5 text-sm font-medium text-primary transition-colors"
    >
      <HugeiconsIcon icon={Globe02Icon} size={16} />
      Web
    </button>
  )
}
