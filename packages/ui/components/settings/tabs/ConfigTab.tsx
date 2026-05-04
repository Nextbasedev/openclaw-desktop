"use client"

import * as React from "react"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuFileText, LuRefreshCw } from "react-icons/lu"

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
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadFile = React.useCallback(async (file: ConfigFile) => {
    setSelected(file)
    setLoading(true)
    setError(null)
    try {
      const res = await invoke<ReadResponse>("middleware_memory_read", { input: { path: file.path } })
      setContent(res.content || "")
    } catch (err) {
      setContent("")
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadFile(CONFIG_FILES[0])
  }, [loadFile])

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
            <button
              type="button"
              onClick={() => loadFile(selected)}
              disabled={loading}
              className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LuRefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          {error ? (
            <div className="p-4 text-[12px] text-red-400">{error}</div>
          ) : (
            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-foreground/80 [overflow-wrap:anywhere]">
              {loading ? "Loading…" : content || "Empty file."}
            </pre>
          )}
        </section>
      </div>
    </div>
  )
}
