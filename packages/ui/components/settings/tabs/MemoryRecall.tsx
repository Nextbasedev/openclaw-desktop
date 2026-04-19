"use client"

import { useState, useEffect, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuBrain, LuSearch, LuChevronDown, LuChevronRight } from "react-icons/lu"

type RecallEntry = {
  content: string
  totalScore: number
  category?: string
  date?: string
  importance?: number
  tags?: string[]
  [key: string]: unknown
}

const CATEGORY_COLORS: Record<string, string> = {
  preference: "text-violet-400 bg-violet-400/10",
  fact: "text-sky-400 bg-sky-400/10",
  decision: "text-amber-400 bg-amber-400/10",
  entity: "text-emerald-400 bg-emerald-400/10",
  other: "text-zinc-400 bg-zinc-400/10",
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color =
    pct >= 70
      ? "text-emerald-400 bg-emerald-400/10"
      : pct >= 40
        ? "text-amber-400 bg-amber-400/10"
        : "text-zinc-400 bg-zinc-400/10"
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
        color,
      )}
    >
      {pct}%
    </span>
  )
}

function EntryCard({ entry }: { entry: RecallEntry }) {
  const [expanded, setExpanded] = useState(false)
  const preview =
    entry.content.length > 120
      ? entry.content.slice(0, 120) + "..."
      : entry.content
  const cat = entry.category ?? "other"
  const catColor = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.other

  return (
    <div
      className={cn(
        "rounded-xl border border-border/30 bg-card transition-colors",
        "hover:border-border/50",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary/40">
          <LuBrain size={13} className="text-muted-foreground" />
        </div>

        <div className="flex flex-1 flex-col gap-1.5 min-w-0">
          <p className="text-[12px] leading-relaxed text-foreground/80">
            {expanded ? entry.content : preview}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-medium capitalize",
                catColor,
              )}
            >
              {cat}
            </span>
            <ScoreBadge score={entry.totalScore} />
            {entry.date && (
              <span className="text-[10px] text-muted-foreground/50">
                {formatDate(entry.date)}
              </span>
            )}
            {entry.tags?.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-1 shrink-0 text-muted-foreground/40">
          {expanded ? (
            <LuChevronDown size={13} />
          ) : (
            <LuChevronRight size={13} />
          )}
        </div>
      </button>
    </div>
  )
}

export function MemoryRecall() {
  const [entries, setEntries] = useState<RecallEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await invoke<{ entries: RecallEntry[] }>(
        "middleware_memory_recall",
        { input: {} },
      )
      setEntries(res.entries ?? [])
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = entries.filter((e) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      e.content.toLowerCase().includes(q) ||
      (e.category ?? "").toLowerCase().includes(q) ||
      (e.tags ?? []).some((t) => t.toLowerCase().includes(q))
    )
  })

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Scored memory chunks from short-term recall.
      </p>

      <div className="relative">
        <LuSearch
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recall entries..."
          className={cn(
            "h-9 w-full rounded-lg border border-border/50 bg-card pl-9 pr-3",
            "text-[13px] text-foreground outline-none",
            "placeholder:text-muted-foreground/60 focus:border-foreground/20",
          )}
        />
      </div>

      {loading && <RecallSkeleton />}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-xl border border-border/50 bg-card px-5 py-10 text-center">
          <LuBrain
            size={22}
            className="mx-auto mb-2 text-muted-foreground/30"
          />
          <p className="text-sm text-muted-foreground">
            {query ? "No matching entries." : "No recall entries found."}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/50">
            Recall data appears after the agent processes conversations.
          </p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="flex flex-col gap-2">
          {filtered.map((entry, idx) => (
            <EntryCard key={`${entry.date ?? idx}-${idx}`} entry={entry} />
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/50">
        {entries.length} chunk{entries.length !== 1 ? "s" : ""} in recall
      </p>
    </div>
  )
}

function RecallSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[72px] rounded-xl border border-border/30 bg-card"
        />
      ))}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}
