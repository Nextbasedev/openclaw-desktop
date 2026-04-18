"use client"

import { cn } from "@/lib/utils"

type VersionUpdateButtonProps = {
  onClick: () => void
  hasUpdate?: boolean
  collapsed?: boolean
}

export function VersionUpdateButton({
  onClick,
  hasUpdate = true,
  collapsed = false,
}: VersionUpdateButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Version Update"
      className={cn(
        "group flex items-center text-xs font-medium text-muted-foreground transition-all duration-200 hover:text-foreground",
        collapsed ? "w-full justify-center gap-0" : "w-fit gap-1.5",
      )}
    >
      {!collapsed && <span className="cursor-pointer">Version Update</span>}

      {hasUpdate && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-chart-1 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-chart-1" />
        </span>
      )}
    </button>
  )
}
