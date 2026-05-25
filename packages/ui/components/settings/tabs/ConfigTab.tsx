"use client"

import * as React from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { middlewareFetch } from "@/lib/middleware-client"
import { localSyncClearAll } from "@/lib/localFirstSync"
import { persistentCacheClearAll } from "@/lib/persistentCache"
import { LuFileText, LuRefreshCw, LuPencil, LuSave, LuX, LuTrash2 } from "react-icons/lu"

type ConfigFile = {
  path: string
  label: string
  description: string
}

const CONFIG_FILES: ConfigFile[] = [
  { path: "SOUL.md", label: "Soul", description: "Assistant personality, tone, and core behavior." },
  { path: "AGENTS.md", label: "Agents", description: "Workspace operating rules and safety heuristics." },
  { path: "MEMORY.md", label: "Main memory", description: "Long-term curated memory and project context." },
  { path: "USER.md", label: "User", description: "Human profile, preferences, timezone, and working style." },
  { path: "IDENTITY.md", label: "Identity", description: "Assistant name, vibe, and identity notes." },
  { path: "TOOLS.md", label: "Tools", description: "Local environment notes, broken tools, and setup specifics." },
  { path: "HEARTBEAT.md", label: "Heartbeat", description: "Proactive background wake instructions." },
]

type ReadResponse = { content: string }

export function ConfigTab() {
  const [selected, setSelected] = React.useState<ConfigFile>(CONFIG_FILES[0])
  const [content, setContent] = React.useState("")
  const [draft, setDraft] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteResult, setDeleteResult] = React.useState<string | null>(null)
  const loadRequestRef = React.useRef(0)
  const selectedPathRef = React.useRef(CONFIG_FILES[0].path)

  async function handleDeleteAllChats() {
    if (!confirm("Delete ALL chats? This removes all desktop and imported Telegram chats, messages, and projections. This cannot be undone.")) return
    setDeleting(true)
    setDeleteResult(null)
    try {
      const result = await middlewareFetch<{ ok: boolean; deleted: number; sessionsCleaned: number }>("/api/chats", { method: "DELETE", timeoutMs: 60_000 })
      setDeleteResult(`Deleted ${result.deleted} chats, cleaned ${result.sessionsCleaned} sessions.`)
    } catch (error) {
      // Deletion likely succeeded server-side even if we timed out
      setDeleteResult(error instanceof Error && error.message.includes("timed out")
        ? "Chats deleted (server cleanup still finishing)."
        : `Failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      // Always clear frontend caches and refresh sidebar
      await Promise.all([localSyncClearAll(), persistentCacheClearAll()]).catch(() => {})
      window.dispatchEvent(new CustomEvent("sidebar:refresh"))
      setDeleting(false)
    }
  }
  const [saving, setSaving] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)

  const loadFile = React.useCallback(async (file: ConfigFile) => {
    const requestId = ++loadRequestRef.current
    selectedPathRef.current = file.path
    setSelected(file)
    setLoading(true)
    setError(null)
    setStatus(null)
    setEditing(false)
    try {
      const res = await invoke<ReadResponse>("middleware_memory_read", { input: { path: file.path } })
      if (loadRequestRef.current !== requestId || selectedPathRef.current !== file.path) return
      setContent(res.content || "")
      setDraft(res.content || "")
    } catch (err) {
      if (loadRequestRef.current !== requestId || selectedPathRef.current !== file.path) return
      setContent("")
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (loadRequestRef.current === requestId && selectedPathRef.current === file.path) {
        setLoading(false)
      }
    }
  }, [])

  React.useEffect(() => {
    void loadFile(CONFIG_FILES[0])
  }, [loadFile])

  async function saveFile() {
    const pathAtSave = selected.path
    const draftAtSave = draft
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      await invoke("middleware_memory_write", { input: { path: pathAtSave, content: draftAtSave } })
      if (selectedPathRef.current !== pathAtSave) return
      setContent(draftAtSave)
      setEditing(false)
      setStatus("Saved.")
    } catch (err) {
      if (selectedPathRef.current !== pathAtSave) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function cancelEdit() {
    setDraft(content)
    setEditing(false)
    setError(null)
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Config</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Important workspace files for identity, rules, memory, and local setup.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-md border border-border/50 bg-card/40">
          {CONFIG_FILES.map((file, index) => {
            const active = selected.path === file.path
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => loadFile(file)}
                className={cn(
                  "flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors",
                  index > 0 && "border-t border-border/30",
                  active ? "bg-foreground/[0.06] text-foreground" : "text-muted-foreground hover:bg-muted/20 hover:text-foreground",
                )}
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/40">
                  <LuFileText size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{file.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/75">{file.path}</span>
                </span>
              </button>
            )
          })}
        </div>

        <section className="min-w-0 overflow-hidden rounded-md border border-border/50 bg-card/40">
          <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
            <div className="min-w-0">
              <h3 className="truncate text-[13px] font-medium text-foreground">{selected.label}</h3>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{selected.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={saveFile}
                    disabled={saving}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LuSave size={12} />
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LuX size={12} />
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    disabled={loading}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LuPencil size={12} />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => loadFile(selected)}
                    disabled={loading}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LuRefreshCw size={12} className={loading ? "animate-spin" : ""} />
                    Refresh
                  </button>
                </>
              )}
            </div>
          </div>

          {error && <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-[12px] text-red-400">{error}</div>}
          {status && !error && <div className="border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-[12px] text-emerald-400">{status}</div>}
          {editing ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              className="min-h-[520px] w-full resize-y bg-transparent p-4 font-mono text-[12px] leading-relaxed text-foreground/85 outline-none placeholder:text-muted-foreground/40"
            />
          ) : (
            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-foreground/80 [overflow-wrap:anywhere]">
              {loading ? "Loading…" : content || "Empty file."}
            </pre>
          )}
        </section>
      </div>

      <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/5 p-5">
        <div className="flex items-center gap-3">
          <LuTrash2 size={16} className="shrink-0 text-red-400" />
          <div className="flex-1">
            <p className="text-[13px] font-medium text-foreground">Delete All Chats</p>
            <p className="text-[11px] text-muted-foreground">Removes all desktop and imported chats, messages, and cached projections. Cannot be undone.</p>
            {deleteResult && <p className={`mt-1 text-[11px] ${deleteResult.startsWith("Failed") ? "text-red-400" : "text-green-400"}`}>{deleteResult}</p>}
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
