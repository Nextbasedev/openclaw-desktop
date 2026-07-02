"use client"

import { memo, useState } from "react"
import { LuLoader, LuLayers } from "react-icons/lu"
import { VscChevronDown, VscChevronRight } from "react-icons/vsc"
import { cn } from "@/lib/utils"
import { MarkdownContent } from "./MarkdownContent"
import type { CompactionMarker } from "./types"

function formatTokens(tokens: number | null | undefined): string | null {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return null
  if (tokens < 1000) return `${tokens} tokens`
  return `${Math.round(tokens / 1000)}K tokens`
}

/**
 * Live, in-progress compaction indicator: a horizontal divider with a centered
 * pill reading "Compacting automatically" and a small spinner. Shown while
 * OCPlatform is compacting the session context (no summary available yet).
 */
export const CompactionDividerLive = memo(function CompactionDividerLive() {
  return (
    <div className="mx-auto my-4 flex max-w-[44rem] items-center gap-3 px-4" data-compaction-live="true">
      <div className="h-px flex-1 bg-border/40" />
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-3 py-1",
          "text-[12px] font-medium text-muted-foreground",
        )}
      >
        <LuLoader className="size-3 animate-spin" />
        <span>Compacting automatically</span>
      </div>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  )
})

/**
 * Resolved compaction marker: a horizontal divider whose centered pill is a
 * button. Clicking it expands a details box below the divider showing the
 * OCPlatform-authored compaction summary (goal/progress) verbatim.
 */
export const CompactionDivider = memo(function CompactionDivider({
  marker,
}: {
  marker: CompactionMarker
}) {
  const [open, setOpen] = useState(false)
  const hasSummary = Boolean(marker.summary?.trim())
  const tokenLabel = formatTokens(marker.tokensBefore)

  return (
    <div className="mx-auto my-4 max-w-[44rem] px-4" data-compaction-marker={marker.id}>
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/40" />
        <button
          type="button"
          onClick={() => hasSummary && setOpen((value) => !value)}
          disabled={!hasSummary}
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-3 py-1",
            "text-[12px] font-medium text-muted-foreground transition-colors",
            hasSummary ? "cursor-pointer hover:text-foreground hover:border-border/60" : "cursor-default",
          )}
          aria-expanded={hasSummary ? open : undefined}
        >
          <LuLayers className="size-3" />
          <span>Compacted automatically</span>
          {tokenLabel ? <span className="text-muted-foreground/50">· {tokenLabel}</span> : null}
          {hasSummary
            ? (open ? <VscChevronDown className="size-3" /> : <VscChevronRight className="size-3" />)
            : null}
        </button>
        <div className="h-px flex-1 bg-border/40" />
      </div>

      {hasSummary ? (
        <div
          className="mt-2 grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div
              className={cn(
                "rounded-lg border border-border/30 bg-muted/25 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground",
                "transition-all duration-300 ease-out",
                open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
              )}
            >
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/50">
                Compaction summary
              </div>
              <MarkdownContent text={marker.summary} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
})
