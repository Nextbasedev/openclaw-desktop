"use client"

import { useState } from "react"
import { LuArchive, LuMessageSquare, LuBrain, LuWrench, LuDownload, LuTrash2 } from "react-icons/lu"
import { middlewareFetch } from "@/lib/middleware-client"

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
    Icon: LuArchive,
  },
  {
    id: "conversations",
    title: "Conversations",
    description: "Chat messages (up to 50 sessions)",
    Icon: LuMessageSquare,
  },
  {
    id: "memory",
    title: "Memory",
    description: "Memory files, soul, and identity",
    Icon: LuBrain,
  },
  {
    id: "config",
    title: "Config",
    description: "Gateway config, tools, agents, skills",
    Icon: LuWrench,
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
  const [deleting, setDeleting] = useState(false)
  const [deleteResult, setDeleteResult] = useState<string | null>(null)

  async function handleDeleteAllChats() {
    if (!confirm("Delete ALL chats? This removes all desktop and imported Telegram chats, messages, and projections. This cannot be undone.")) return
    setDeleting(true)
    setDeleteResult(null)
    try {
      const result = await middlewareFetch<{ ok: boolean; deleted: number; sessionsCleaned: number }>("/api/chats", { method: "DELETE" })
      setDeleteResult(`Deleted ${result.deleted} chats, cleaned ${result.sessionsCleaned} sessions.`)
      window.dispatchEvent(new CustomEvent("sidebar:refresh"))
    } catch (error) {
      setDeleteResult(`Failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setDeleting(false)
    }
  }

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

      <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
        {items.map((item, idx) => {
          const ItemIcon = item.Icon
          return (
            <div
              key={item.id}
              className={`flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/20 ${idx > 0 ? "border-t border-border/30" : ""}`}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
                <ItemIcon size={15} />
              </span>

              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-[13px] font-medium text-foreground">
                  {item.title}
                </span>
                <span className="text-[11px] leading-tight text-muted-foreground">
                  {item.description}
                </span>
              </div>

              <button
                type="button"
                onClick={() => onExport?.(item.id)}
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50"
                aria-label={`Export ${item.title}`}
              >
                <LuDownload size={15} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-4">
        <h2 className="text-lg font-semibold text-foreground">Danger Zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Destructive actions that cannot be undone.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-red-500/30 bg-red-500/5">
        <div className="flex items-center gap-4 px-5 py-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
            <LuTrash2 size={15} />
          </span>
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-[13px] font-medium text-foreground">Delete All Chats</span>
            <span className="text-[11px] leading-tight text-muted-foreground">
              Removes all desktop and imported chats, messages, and cached data. Start fresh.
            </span>
            {deleteResult && (
              <span className={`mt-1 text-[11px] ${deleteResult.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>
                {deleteResult}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleDeleteAllChats}
            disabled={deleting}
            className="cursor-pointer rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete All"}
          </button>
        </div>
      </div>
    </div>
  )
}
