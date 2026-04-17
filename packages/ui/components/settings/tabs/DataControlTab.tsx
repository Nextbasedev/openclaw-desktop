"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  Download04Icon,
  File01Icon,
  BubbleChatIcon,
  Globe02Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

type ExportItem = {
  id: string
  title: string
  description: string
  icon: IconSvgElement
}

const EXPORT_ITEMS: ExportItem[] = [
  {
    id: "full-export",
    title: "Full Export",
    description: "Everything as a .tar.gz archive (max 200MB)",
    icon: File01Icon,
  },
  {
    id: "conversations",
    title: "Conversations",
    description: "Chat messages (up to 50 sessions)",
    icon: BubbleChatIcon,
  },
  {
    id: "memory",
    title: "Memory",
    description: "Memory files, soul, and identity",
    icon: Globe02Icon,
  },
  {
    id: "config",
    title: "Config",
    description: "Gateway config, tools, agents, skills",
    icon: Settings02Icon,
  },
]

type DataControlTabProps = {
  items?: ExportItem[]
  onExport?: (id: string) => void
}

export function DataControlTab({
  items = EXPORT_ITEMS,
  onExport,
}: DataControlTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Export Agent Data
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Download your agent&apos;s data. Choose what to export below.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-border"
          >
            <div className="flex size-9 shrink-0 items-center justify-center text-muted-foreground">
              <HugeiconsIcon icon={item.icon} size={18} strokeWidth={1.5} />
            </div>

            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                {item.title}
              </span>
              <span className="text-xs text-muted-foreground">
                {item.description}
              </span>
            </div>

            <button
              type="button"
              onClick={() => onExport?.(item.id)}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50"
              aria-label={`Export ${item.title}`}
            >
              <HugeiconsIcon icon={Download04Icon} size={18} strokeWidth={1.5} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
