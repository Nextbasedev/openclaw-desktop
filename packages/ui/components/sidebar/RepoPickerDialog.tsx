"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuSearch, LuX, LuFolderGit2, LuRefreshCw } from "react-icons/lu"

type RepoItem = {
  name: string
  path: string
  pinned?: boolean
}

type Props = {
  open: boolean
  onClose: () => void
  onSelect: (repo: { name: string; path: string }) => void
}

export function RepoPickerDialog({ open, onClose, onSelect }: Props) {
  const [repos, setRepos] = useState<RepoItem[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [scan, recent] = await Promise.all([
        invoke<{ repos: RepoItem[] }>("middleware_repos_scan", { input: {} }).catch(() => ({ repos: [] })),
        invoke<{ repos: RepoItem[] }>("middleware_repos_recent", { input: {} }).catch(() => ({ repos: [] })),
      ])
      const byPath = new Map<string, RepoItem>()
      for (const repo of [...(recent.repos ?? []), ...(scan.repos ?? [])]) {
        if (!repo.path) continue
        byPath.set(repo.path, { name: repo.name || repo.path.split(/[\\/]/).pop() || repo.path, path: repo.path, pinned: repo.pinned })
      }
      setRepos([...byPath.values()].sort((a, b) => a.name.localeCompare(b.name)))
    } catch (err) {
      setRepos([])
      setError(err instanceof Error ? err.message : "Could not scan repositories")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setQuery("")
      setRepos([])
      load()
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [open, load])

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open, onClose])

  if (typeof document === "undefined") return null

  const q = query.toLowerCase().trim()
  const filtered = repos.filter(
    (repo) => !q || repo.name.toLowerCase().includes(q) || repo.path.toLowerCase().includes(q),
  )

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="glass-overlay"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className={cn(
              "glass-dialog",
              "!max-w-lg !w-[92vw] !p-0",
              "flex flex-col max-h-[80vh]",
            )}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{
              opacity: { duration: 0.15 },
              scale: { type: "spring", stiffness: 400, damping: 28, mass: 0.8 },
              y: { type: "spring", stiffness: 400, damping: 28, mass: 0.8 },
            }}
            style={{ transformOrigin: "top center" }}
          >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">Select Repository</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground/60">
              Optional — choose a repo, or close this to create a plain workspace project.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={load}
              className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
              title="Rescan repositories"
            >
              <LuRefreshCw size={15} className={loading ? "animate-spin" : undefined} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
            >
              <LuX size={15} />
            </button>
          </div>
        </div>

        <div className="px-5 pb-3">
          <div className="relative">
            <LuSearch size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search repositories..."
              className={cn(
                "h-9 w-full rounded-lg border border-border/50 bg-secondary/30 pl-9 pr-3",
                "text-[13px] text-foreground outline-none",
                "placeholder:text-muted-foreground/50 focus:border-foreground/20",
              )}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loading ? (
            <div className="flex flex-col items-center gap-2 py-10">
              <div className="size-5 animate-spin rounded-full border-2 border-border/30 border-t-foreground/50" />
              <p className="text-[11px] text-muted-foreground">Scanning repositories...</p>
            </div>
          ) : filtered.length > 0 ? (
            <Section label="Repositories" icon={LuFolderGit2}>
              {filtered.map((repo) => (
                <RepoRow key={repo.path} repo={repo} onSelect={onSelect} />
              ))}
            </Section>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10">
              <LuFolderGit2 size={20} className="text-muted-foreground/30" />
              <p className="text-[12px] text-muted-foreground">
                {q ? "No matching repositories." : "No repositories found."}
              </p>
              {error && <p className="max-w-[320px] text-center text-[11px] text-red-400">{error}</p>}
            </div>
          )}
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Section({ label, icon: Icon, children }: { label: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <Icon size={11} className="text-muted-foreground/40" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{label}</span>
      </div>
      {children}
    </div>
  )
}

function RepoRow({ repo, onSelect }: { repo: RepoItem; onSelect: (r: { name: string; path: string }) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect({ name: repo.name, path: repo.path })}
      className={cn(
        "group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left",
        "transition-all duration-150 ease-out",
        "hover:border-white/[0.08] hover:bg-white/[0.075] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_24px_rgba(0,0,0,0.18)]",
        "focus-visible:border-white/[0.14] focus-visible:bg-white/[0.08] focus-visible:outline-none",
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary/40 transition-colors group-hover:bg-white/[0.09]">
        <LuFolderGit2 size={14} className="text-muted-foreground transition-colors group-hover:text-foreground/80" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-foreground/90">{repo.name}</span>
        <span className="truncate text-[11px] text-muted-foreground/50">{repo.path}</span>
      </div>
    </button>
  )
}
