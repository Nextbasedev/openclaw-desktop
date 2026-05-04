"use client"

import { useState, useEffect, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuFileText, LuSearch, LuPlus, LuChevronRight } from "react-icons/lu"
import {
  type MemoryDocument,
  FileIcon,
  formatSize,
  DocView,
  NewEntry,
} from "./MemoryEntryViews"

type ViewState =
  | { mode: "list" }
  | { mode: "view"; doc: MemoryDocument; content: string }
  | { mode: "edit"; doc: MemoryDocument; content: string }
  | { mode: "new" }

const PAGE_SIZE = 20

export function MemoryDocuments() {
  const [docs, setDocs] = useState<MemoryDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [view, setView] = useState<ViewState>({ mode: "list" })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await invoke<{ documents: MemoryDocument[] }>(
        "middleware_memory_list",
        { input: {} },
      )
      setDocs(res.documents ?? [])
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

  const filtered = docs.filter((d) => {
    if (!query.trim()) return true
    return d.name.toLowerCase().includes(query.toLowerCase())
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pageDocs = filtered.slice(pageStart, pageStart + PAGE_SIZE)

  async function openDoc(doc: MemoryDocument) {
    try {
      const res = await invoke<{ content: string }>(
        "middleware_memory_read",
        { input: { path: doc.path || doc.name } },
      )
      setView({ mode: "view", doc, content: res.content ?? "" })
    } catch (err) {
      setError(String(err))
    }
  }

  if (view.mode === "view" || view.mode === "edit") {
    return (
      <DocView
        doc={view.doc}
        content={view.content}
        isEditing={view.mode === "edit"}
        onBack={() => { setView({ mode: "list" }); load() }}
        onEdit={() =>
          setView({ mode: "edit", doc: view.doc, content: view.content })
        }
        onSaved={(c) => setView({ mode: "view", doc: view.doc, content: c })}
      />
    )
  }

  if (view.mode === "new") {
    return <NewEntry onBack={() => { setView({ mode: "list" }); load() }} />
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Workspace files that shape personality and context.
        </p>
        <button
          type="button"
          onClick={() => setView({ mode: "new" })}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5",
            "text-[12px] font-medium text-foreground",
            "bg-foreground/5 ring-1 ring-border/40",
            "transition-colors hover:bg-foreground/10",
          )}
        >
          <LuPlus size={13} />
          New Entry
        </button>
      </div>

      <div className="relative">
        <LuSearch
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter memory files..."
          className={cn(
            "h-9 w-full rounded-lg border border-border/50 bg-card pl-9 pr-3",
            "text-[13px] text-foreground outline-none",
            "placeholder:text-muted-foreground/60 focus:border-foreground/20",
          )}
        />
      </div>

      {loading && <ListSkeleton />}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-xl border border-border/50 bg-card px-5 py-10 text-center">
          <LuFileText size={22} className="mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {query ? "No matching files." : "No memory files found."}
          </p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
          {pageDocs.map((doc, idx) => (
            <button
              key={doc.path}
              type="button"
              onClick={() => openDoc(doc)}
              className={cn(
                "flex w-full items-center gap-3.5 px-4 py-3 text-left",
                "transition-colors hover:bg-muted/10",
                idx > 0 && "border-t border-border/20",
              )}
            >
              <FileIcon name={doc.name} />
              <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                <span className="truncate text-[13px] font-medium text-foreground">
                  {doc.name}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatSize(doc.size)}
                </span>
              </div>
              <LuChevronRight size={14} className="shrink-0 text-muted-foreground/40" />
            </button>
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
        {docs.length} file{docs.length !== 1 ? "s" : ""} in workspace
      </p>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="animate-pulse space-y-1.5">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-[52px] rounded-xl border border-border/30 bg-card" />
      ))}
    </div>
  )
}
