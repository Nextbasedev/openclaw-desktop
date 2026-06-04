"use client"

import { useState, useEffect, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuBrain, LuSearch, LuChevronDown, LuChevronRight } from "react-icons/lu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

type RecallEntry = {
  content?: string
  text?: string
  path?: string
  line?: number
  totalScore?: number
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

const PAGE_SIZE = 20

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

function entryContent(entry: RecallEntry): string {
  return entry.content ?? entry.text ?? ""
}

function memoryTitle(entry: RecallEntry): string {
  const file = entry.path?.split("/").pop()?.replace(/\.md$/, "")
  if (!file) return "Memory note"
  const date = new Date(`${file}T00:00:00`)
  if (Number.isNaN(date.getTime())) return "Memory note"
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function MarkdownMemory({ content }: { content: string }) {
  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none text-[13px] leading-7 prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-xl prose-h1:text-foreground prose-h2:mt-7 prose-h2:border-b prose-h2:border-border/30 prose-h2:pb-2 prose-h2:text-lg prose-h2:text-foreground prose-h3:text-base prose-h3:text-foreground prose-p:text-foreground/75 prose-strong:text-foreground prose-code:rounded-md prose-code:bg-black/[0.06] dark:prose-code:bg-white/[0.07] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[12px] prose-code:text-violet-700 dark:prose-code:text-violet-200 prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-border/40 prose-pre:bg-black/[0.04] dark:prose-pre:bg-black/30 prose-blockquote:border-l-violet-400/50 prose-blockquote:text-muted-foreground prose-li:text-foreground/75 prose-hr:border-border/40">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content || "_This memory note is empty._"}
      </ReactMarkdown>
    </div>
  )
}

function EntryCard({ entry }: { entry: RecallEntry }) {
  const [expanded, setExpanded] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [documentContent, setDocumentContent] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [loadingDocument, setLoadingDocument] = useState(false)
  const content = entryContent(entry)
  const preview =
    content.length > 120
      ? content.slice(0, 120) + "..."
      : content
  const cat = entry.category ?? "other"
  const catColor = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.other

  async function openMemoryNote() {
    setDialogOpen(true)
    if (!entry.path || documentContent || loadingDocument) return
    setLoadingDocument(true)
    setDocumentError(null)
    try {
      const res = await invoke<{ content: string }>("middleware_memory_read", {
        input: { path: entry.path },
      })
      setDocumentContent(res.content ?? "")
    } catch (err) {
      setDocumentError(String(err))
    } finally {
      setLoadingDocument(false)
    }
  }

  return (
    <>
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
              {expanded ? content : preview}
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
              <ScoreBadge score={entry.totalScore ?? 0} />
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
        {expanded && entry.path && (
          <div className="border-t border-border/30 px-4 pb-3 pt-2">
            <button
              type="button"
              onClick={openMemoryNote}
              className="rounded-lg bg-secondary/40 px-3 py-1.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-secondary/70 hover:text-foreground"
            >
              Open full memory note
            </button>
          </div>
        )}
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[82vh] overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-border/30 px-6 py-4 pr-12">
            <DialogTitle className="text-[16px] font-semibold text-foreground">
              {memoryTitle(entry)}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground">
              Full memory note, rendered for reading.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(82vh-104px)] overflow-y-auto px-6 py-5">
            {loadingDocument ? (
              <p className="text-[13px] text-muted-foreground">Opening memory note...</p>
            ) : documentError ? (
              <p className="text-[13px] text-destructive">{documentError}</p>
            ) : (
              <MarkdownMemory content={documentContent ?? content} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function MemoryRecall() {
  const [entries, setEntries] = useState<RecallEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)

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

  useEffect(() => {
    setPage(1)
  }, [query])

  const filtered = entries.filter((e) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      entryContent(e).toLowerCase().includes(q) ||
      (e.category ?? "").toLowerCase().includes(q) ||
      (e.tags ?? []).some((t) => t.toLowerCase().includes(q))
    )
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pageEntries = filtered.slice(pageStart, pageStart + PAGE_SIZE)

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
            "h-9 w-full rounded-md border border-border/50 bg-card pl-9 pr-3",
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
          {pageEntries.map((entry, idx) => (
            <EntryCard
              key={`${entry.date ?? pageStart + idx}-${pageStart + idx}`}
              entry={entry}
            />
          ))}
        </div>
      )}

      {!loading && !error && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground/50">
            Showing {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={currentPage === 1}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px]",
                "text-muted-foreground ring-1 ring-border/40 transition-colors hover:bg-muted/20 hover:text-foreground",
                currentPage === 1 && "pointer-events-none opacity-40",
              )}
            >
              <LuChevronRight size={13} className="rotate-180" />
              Prev
            </button>
            <span className="px-2 text-[11px] text-muted-foreground/60">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              disabled={currentPage === totalPages}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px]",
                "text-muted-foreground ring-1 ring-border/40 transition-colors hover:bg-muted/20 hover:text-foreground",
                currentPage === totalPages && "pointer-events-none opacity-40",
              )}
            >
              Next
              <LuChevronRight size={13} />
            </button>
          </div>
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
