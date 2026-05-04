"use client"

import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuFileText, LuX, LuSave, LuPencil, LuChevronLeft } from "react-icons/lu"

export type MemoryDocument = {
  path: string
  name: string
  size: number
}

const FILE_COLORS: Record<string, string> = {
  "SOUL.md": "text-purple-400 bg-purple-400/10",
  "USER.md": "text-blue-400 bg-blue-400/10",
  "IDENTITY.md": "text-amber-400 bg-amber-400/10",
  "AGENTS.md": "text-emerald-400 bg-emerald-400/10",
  "MEMORY.md": "text-pink-400 bg-pink-400/10",
  "TOOLS.md": "text-cyan-400 bg-cyan-400/10",
  "HEARTBEAT.md": "text-red-400 bg-red-400/10",
  "BOOTSTRAP.md": "text-orange-400 bg-orange-400/10",
}

export function FileIcon({ name }: { name: string }) {
  const colors = FILE_COLORS[name] ?? "text-muted-foreground bg-muted/40"
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", colors)}>
      <LuFileText size={14} />
    </span>
  )
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function MarkdownDocument({ content }: { content: string }) {
  return (
    <div className="prose prose-invert max-w-none text-[13px] leading-7 prose-headings:scroll-mt-20 prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-2xl prose-h1:text-foreground prose-h2:mt-8 prose-h2:border-b prose-h2:border-border/30 prose-h2:pb-2 prose-h2:text-xl prose-h2:text-foreground prose-h3:text-base prose-h3:text-foreground prose-p:text-foreground/75 prose-a:text-violet-300 prose-strong:text-foreground prose-code:rounded-md prose-code:bg-white/[0.07] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[12px] prose-code:text-violet-200 prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-border/40 prose-pre:bg-black/30 prose-blockquote:border-l-violet-400/50 prose-blockquote:text-muted-foreground prose-li:text-foreground/75 prose-hr:border-border/40 prose-table:text-[12px] prose-th:border prose-th:border-border/40 prose-th:bg-white/[0.04] prose-th:px-3 prose-th:py-2 prose-td:border prose-td:border-border/30 prose-td:px-3 prose-td:py-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content || "_This file is empty._"}
      </ReactMarkdown>
    </div>
  )
}

export function DocView({
  doc, content, isEditing, onBack, onEdit, onSaved,
}: {
  doc: MemoryDocument; content: string; isEditing: boolean
  onBack: () => void; onEdit: () => void; onSaved: (c: string) => void
}) {
  const [draft, setDraft] = useState(content)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true); setSaveError(null)
    try {
      await invoke("middleware_memory_write", { input: { path: doc.path || doc.name, content: draft } })
      onSaved(draft)
    } catch (err) { setSaveError(String(err)) }
    finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <LuChevronLeft size={14} /> Back
        </button>
        <div className="h-4 w-px bg-border/40" />
        <FileIcon name={doc.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-foreground">{doc.name}</div>
          <div className="text-[11px] text-muted-foreground">Markdown document · {formatSize(doc.size)}</div>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing ? (
            <button type="button" onClick={onEdit} className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5",
              "text-[12px] font-medium text-foreground",
              "bg-foreground/5 ring-1 ring-border/40 transition-colors hover:bg-foreground/10",
            )}><LuPencil size={13} /> Edit</button>
          ) : (
            <>
            <button type="button" onClick={handleSave} disabled={saving} className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5",
              "text-[12px] font-medium text-foreground",
              "bg-foreground/10 ring-1 ring-border/40 transition-colors hover:bg-foreground/15",
              saving && "opacity-50",
            )}>
              <LuSave size={13} /> {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={onBack}
              className="rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground">
              Cancel
            </button>
            </>
          )}
        </div>
      </div>

      {saveError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-[12px] text-destructive">{saveError}</p>
        </div>
      )}

      {isEditing ? (
        <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/60 shadow-sm">
          <div className="flex items-center gap-2 border-b border-border/30 px-4 py-3">
            <LuPencil size={14} className="text-muted-foreground" />
            <span className="text-[12px] font-medium text-muted-foreground">Edit document</span>
          </div>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={true}
            className={cn(
              "min-h-[560px] w-full resize-y bg-transparent p-5",
              "font-sans text-[14px] leading-7 text-foreground/85",
              "outline-none placeholder:text-muted-foreground/40",
            )} />
        </div>
      ) : (
        <div className={cn("rounded-2xl border border-border/50 bg-card/60 shadow-sm", "max-h-[640px] overflow-y-auto p-6")}>
          <MarkdownDocument content={content} />
        </div>
      )}
    </div>
  )
}

export function NewEntry({ onBack }: { onBack: () => void }) {
  const [content, setContent] = useState("")
  const [category, setCategory] = useState("other")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const categories = ["preference", "fact", "decision", "entity", "other"]

  async function handleStore() {
    if (!content.trim()) return
    setSaving(true); setError(null)
    try {
      await invoke("middleware_memory_store", { input: { content: content.trim(), category } })
      onBack()
    } catch (err) { setError(String(err)) }
    finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <LuX size={14} /> Back
        </button>
        <div className="h-4 w-px bg-border/40" />
        <span className="text-[14px] font-medium text-foreground">New Memory Entry</span>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Category</label>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)} className={cn(
                "rounded-md px-3 py-1.5 text-[12px] capitalize transition-colors",
                c === category
                  ? "bg-foreground/10 text-foreground ring-1 ring-foreground/20"
                  : "bg-card text-muted-foreground ring-1 ring-border/30 hover:bg-muted/20",
              )}>{c}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Content</label>
          <textarea value={content} onChange={(e) => setContent(e.target.value)}
            placeholder="What should the agent remember?"
            className={cn(
              "min-h-[200px] w-full rounded-md border border-border/50 bg-[#0a0a0c] p-4",
              "font-mono text-[12px] leading-relaxed text-foreground/90",
              "outline-none placeholder:text-muted-foreground/40 focus:border-foreground/20 resize-y",
            )} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-[12px] text-destructive">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={handleStore} disabled={saving || !content.trim()} className={cn(
          "flex items-center gap-1.5 rounded-md px-4 py-2",
          "text-[13px] font-medium text-foreground",
          "bg-foreground/10 ring-1 ring-border/40 transition-colors hover:bg-foreground/15",
          (saving || !content.trim()) && "opacity-40 pointer-events-none",
        )}>
          <LuSave size={14} /> {saving ? "Storing..." : "Store Memory"}
        </button>
      </div>
    </div>
  )
}
