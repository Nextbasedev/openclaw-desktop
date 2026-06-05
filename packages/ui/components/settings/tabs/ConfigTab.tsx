"use client"

import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuFileText, LuRefreshCw, LuPencil, LuSave, LuX } from "react-icons/lu"

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

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none px-2 py-1 text-[13px] leading-7 prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-[20px] prose-h1:text-foreground prose-h2:mt-7 prose-h2:border-b prose-h2:border-border/25 prose-h2:pb-2 prose-h2:text-[17px] prose-h2:text-foreground prose-h3:text-[14px] prose-h3:text-foreground prose-p:text-foreground/78 prose-strong:text-foreground prose-code:rounded-md prose-code:bg-black/[0.055] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[12px] prose-code:text-violet-700 prose-code:before:content-none prose-code:after:content-none dark:prose-code:bg-white/[0.07] dark:prose-code:text-violet-200 prose-pre:border prose-pre:border-border/30 prose-pre:bg-black/[0.04] dark:prose-pre:bg-black/30 prose-blockquote:border-l-violet-400/50 prose-blockquote:text-muted-foreground prose-li:text-foreground/78 prose-hr:border-border/35 prose-table:text-[12px] prose-th:border prose-th:border-border/35 prose-th:bg-black/[0.035] prose-th:px-3 prose-th:py-2 dark:prose-th:bg-white/[0.04] prose-td:border prose-td:border-border/25 prose-td:px-3 prose-td:py-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || "_Empty file._"}</ReactMarkdown>
    </div>
  )
}

export function ConfigTab() {
  const [selected, setSelected] = React.useState<ConfigFile>(CONFIG_FILES[0])
  const [content, setContent] = React.useState("")
  const [draft, setDraft] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const loadRequestRef = React.useRef(0)
  const selectedPathRef = React.useRef(CONFIG_FILES[0].path)
  const [saving, setSaving] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadFile = React.useCallback(async (file: ConfigFile) => {
    const requestId = ++loadRequestRef.current
    selectedPathRef.current = file.path
    setSelected(file)
    setLoading(true)
    setError(null)
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
    try {
      await invoke("middleware_memory_write", { input: { path: pathAtSave, content: draftAtSave } })
      if (selectedPathRef.current !== pathAtSave) return
      setContent(draftAtSave)
      setEditing(false)
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
    <div className="flex h-full min-h-0 w-full bg-transparent">
      <aside className="sticky top-0 flex h-full w-[230px] shrink-0 animate-in slide-in-from-left-8 fade-in-0 flex-col bg-black/[0.01] duration-300 dark:bg-white/[0.01]">
        <div className="border-b border-black/[0.025] px-5 py-6 dark:border-white/[0.03]">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold tracking-tight text-foreground">Config</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground/60">
              Workspace identity, rules, memory, and setup files.
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
          {CONFIG_FILES.map((file) => {
            const active = selected.path === file.path
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => loadFile(file)}
                className={cn(
                  "flex w-full cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3 text-left transition-all duration-200",
                  active ? "bg-black/[0.045] text-foreground dark:bg-white/[0.055]" : "text-muted-foreground/78 hover:translate-x-0.5 hover:bg-black/[0.025] hover:text-foreground dark:hover:bg-white/[0.03]",
                )}
              >
                <span className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                  active ? "bg-black/[0.045] text-foreground dark:bg-white/[0.055]" : "bg-black/[0.02] text-muted-foreground/60 dark:bg-white/[0.025]",
                )}>
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

      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col px-7 py-6">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-2 pb-4 pr-12">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-[13px] font-semibold text-foreground">{selected.label}</h3>
                <span className="rounded-full bg-black/[0.045] dark:bg-white/[0.045] px-2 py-0.5 text-[10px] font-medium text-muted-foreground/70">
                  {selected.path}
                </span>
              </div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground/65">{selected.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-xl bg-black/[0.028] p-1 dark:bg-white/[0.035]">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={saveFile}
                    disabled={saving}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LuSave size={12} />
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-black/[0.045] hover:text-foreground dark:hover:bg-white/[0.055] disabled:cursor-not-allowed disabled:opacity-60"
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
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-black/[0.045] hover:text-foreground dark:hover:bg-white/[0.055] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LuPencil size={12} />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => loadFile(selected)}
                    disabled={loading}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-black/[0.045] hover:text-foreground dark:hover:bg-white/[0.055] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LuRefreshCw size={12} className={loading ? "animate-spin" : ""} />
                    Refresh
                  </button>
                </>
              )}
            </div>
          </div>

          {error && <div className="mx-4 mt-3 rounded-xl bg-red-500/10 px-4 py-2 text-[12px] text-red-400">{error}</div>}
          {editing ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              className="min-h-0 w-full flex-1 resize-none overflow-auto bg-transparent px-2 py-1 font-mono text-[12px] leading-relaxed text-foreground/85 outline-none placeholder:text-muted-foreground/40"
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              {loading ? (
                <pre className="px-2 py-1 font-mono text-[12px] leading-relaxed text-foreground/80">Loading…</pre>
              ) : (
                <MarkdownPreview content={content} />
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
