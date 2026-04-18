"use client"

import { useState, useEffect, useCallback } from "react"
import { LuArchive, LuRotateCcw } from "react-icons/lu"
import { fetchProjects } from "@/lib/api/projects"
import { fetchTopics, archiveTopic, type Topic } from "@/lib/api/topics"

type ArchivedItem = Topic & { projectName: string }

export function ArchiveTab() {
  const [items, setItems] = useState<ArchivedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { projects } = await fetchProjects()
      const allArchived: ArchivedItem[] = []

      for (const project of projects) {
        const { topics } = await fetchTopics(project.id)
        for (const topic of topics) {
          if (topic.archived) {
            allArchived.push({ ...topic, projectName: project.name })
          }
        }
      }

      allArchived.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      setItems(allArchived)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleRestore(topicId: string) {
    try {
      await archiveTopic(topicId, false)
      setItems((prev) => prev.filter((item) => item.id !== topicId))
    } catch (err) {
      setError(String(err))
    }
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr)
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Archive</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Archived conversations and topics. Restore anytime.
        </p>
      </div>

      {loading && (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-xl border border-border/50 bg-card" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-xl border border-border/50 bg-card px-5 py-8 text-center">
          <LuArchive size={20} className="mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No archived items yet.</p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
          {items.map((item, idx) => (
            <div
              key={item.id}
              className={`flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/10 ${idx > 0 ? "border-t border-border/20" : ""}`}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
                <LuArchive size={14} />
              </span>
              <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                <span className="truncate text-[13px] font-medium text-foreground">{item.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {item.projectName} &middot; {formatDate(item.updatedAt)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleRestore(item.id)}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <LuRotateCcw size={13} />
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
