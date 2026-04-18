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
        "group flex w-full items-center gap-2.5 font-medium",
        "text-muted-foreground transition-all duration-200",
        " hover:text-foreground",
      )}
    >
      {/* Arrow-up icon */}
      <span className="flex  size-4 shrink-0 items-center justify-center">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" x2="12" y1="3" y2="15" />
        </svg>
      </span>

      <span className="flex-1">Version Update</span>

      {hasUpdate && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-chart-1 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-chart-1" />
        </span>
      )}
    </button>
  )
}


