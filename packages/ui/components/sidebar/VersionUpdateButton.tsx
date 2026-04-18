"use client"

import { cn } from "@/lib/utils"

type VersionUpdateButtonProps = {
  onClick: () => void
  hasUpdate?: boolean
}

export function VersionUpdateButton({
  onClick,
  hasUpdate = true,
}: VersionUpdateButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-fit items-center gap-1.5 text-xs font-medium",
        "text-muted-foreground transition-all duration-200",
        " hover:text-foreground",
      )}
    >


      <span className="cursor-pointer">Version Update</span>

      {hasUpdate && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-chart-1 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-chart-1" />
        </span>
      )}
    </button>
  )
}


