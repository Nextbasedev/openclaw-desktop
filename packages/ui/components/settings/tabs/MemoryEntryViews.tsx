"use client"

import { useState } from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuFileText, LuX, LuSave } from "react-icons/lu"

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
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <LuX size={14} /> Close
        </button>
        <div className="h-4 w-px bg-border/40" />
        <FileIcon name={doc.name} />
        <span className="text-[14px] font-medium text-foreground">{doc.name}</span>
        <span className="text-[11px] text-muted-foreground">{formatSize(doc.size)}</span>
      </div>

      <div className="flex items-center gap-2">
        {!isEditing ? (
          <button type="button" onClick={onEdit} className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5",
            "text-[12px] font-medium text-foreground",
            "bg-foreground/5 ring-1 ring-border/40 transition-colors hover:bg-foreground/10",
          )}>Edit</button>
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

      {saveError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-[12px] text-destructive">{saveError}</p>
        </div>
      )}

      {isEditing ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
          className={cn(
            "min-h-[400px] w-full rounded-xl border border-border/50 bg-[#0a0a0c] p-4",
            "font-mono text-[12px] leading-relaxed text-foreground/90",
            "outline-none focus:border-foreground/20 resize-y",
          )} />
      ) : (
        <div className={cn("rounded-xl border border-border/50 bg-[#0a0a0c] p-4", "max-h-[500px] overflow-y-auto")}>
          <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-foreground/80">
            {content}
          </pre>
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
                "rounded-lg px-3 py-1.5 text-[12px] capitalize transition-colors",
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
              "min-h-[200px] w-full rounded-xl border border-border/50 bg-[#0a0a0c] p-4",
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
          "flex items-center gap-1.5 rounded-lg px-4 py-2",
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
