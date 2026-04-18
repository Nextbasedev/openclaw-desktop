"use client"

import { Icons } from "@/components/icons"

type ExportItem = {
  id: string
  title: string
  description: string
  Icon: React.ElementType
}

const EXPORT_ITEMS: ExportItem[] = [
  {
    id: "full-export",
    title: "Full Export",
    description: "Everything as a .tar.gz archive (max 200MB)",
    Icon: Icons.File,
  },
  {
    id: "conversations",
    title: "Conversations",
    description: "Chat messages (up to 50 sessions)",
    Icon: Icons.BubbleChat,
  },
  {
    id: "memory",
    title: "Memory",
    description: "Memory files, soul, and identity",
    Icon: Icons.Globe,
  },
  {
    id: "config",
    title: "Config",
    description: "Gateway config, tools, agents, skills",
    Icon: Icons.Settings,
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
        {items.map((item) => {
          const ItemIcon = item.Icon
          return (
            <div
              key={item.id}
              className="flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-border"
            >
              <div className="flex size-9 shrink-0 items-center justify-center text-muted-foreground">
                <ItemIcon size={18} strokeWidth={1.5} />
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
                <Icons.Download size={18} strokeWidth={1.5} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

