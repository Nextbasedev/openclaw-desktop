"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  PlusSignIcon,
  Image01Icon,
  File01Icon,
  Globe02Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type PlusMenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  webSearchEnabled: boolean
  onWebSearchToggle: () => void
}

export function PlusMenu({
  open,
  onOpenChange,
  webSearchEnabled,
  onWebSearchToggle,
}: PlusMenuProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex size-9 items-center justify-center rounded-full border transition-colors",
            "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          aria-label="Add"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-52 gap-1 p-2">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
        >
          <HugeiconsIcon icon={Image01Icon} size={18} />
          Upload media
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
        >
          <HugeiconsIcon icon={File01Icon} size={18} />
          Upload file
        </button>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted",
            webSearchEnabled
              ? "text-foreground font-medium"
              : "text-foreground"
          )}
          onClick={onWebSearchToggle}
        >
          <HugeiconsIcon icon={Globe02Icon} size={18} />
          Web search
          {webSearchEnabled && (
            <HugeiconsIcon
              icon={Tick01Icon}
              size={16}
              className="ml-auto text-primary"
            />
          )}
        </button>
      </PopoverContent>
    </Popover>
  )
}
