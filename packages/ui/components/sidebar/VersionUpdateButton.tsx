"use client"

import { Icons } from "@/components/icons"
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
        "group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all duration-200",
        "border-white/8 bg-white/[0.03] hover:border-white/14 hover:bg-white/[0.06]",
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/8 text-white/60 transition-colors group-hover:text-white/80">
        <Icons.Download size={16} strokeWidth={1.7} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white/80 group-hover:text-white/95">
          Version Update
        </p>
        <p className="text-xs text-white/35">
          {hasUpdate ? "New version available" : "You're up to date"}
        </p>
      </div>

      {hasUpdate && (
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
        </span>
      )}
    </button>
  )
}
