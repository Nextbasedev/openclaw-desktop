"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuSearch, LuX, LuGitBranch, LuClock, LuFolderGit2 } from "react-icons/lu"

type RepoEntry = {
  name: string
  path: string
  isRecent: boolean
  selectedAt?: string
}

type Props = {
  open: boolean
  onClose: () => void
  onSelect: (repo: { name: string; path: string }) => void
}

export function RepoPickerDialog({ open, onClose, onSelect }: Props) {
  const [recent, setRecent] = useState<RepoEntry[]>([])
  const [scanned, setScanned] = useState<RepoEntry[]>([])
  const [scanning, setScanning] = useState(false)
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await invoke<{ repos: RepoEntry[] }>(
        "middleware_repos_recent", { input: {} },
      )
      setRecent(res.repos ?? [])
    } catch {}

    setScanning(true)
    try {
      const res = await invoke<{ repos: RepoEntry[] }>(
        "middleware_repos_scan", { input: {} },
      )
      setScanned(res.repos ?? [])
    } catch {}
    finally { setScanning(false) }
  }, [])

  useEffect(() => {
    if (open) {
      setQuery("")
      setRecent([])
      setScanned([])
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

  if (!open) return null

  const q = query.toLowerCase().trim()
  const filterFn = (r: RepoEntry) =>
    !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)

  const recentPaths = new Set(recent.map((r) => r.path))
  const filteredRecent = recent.filter(filterFn)
  const filteredScanned = scanned
    .filter((r) => !recentPaths.has(r.path))
    .filter(filterFn)

  return createPortal(
    <div className="glass-overlay" onClick={onClose}>
      <div
        className={cn(
          "glass-dialog",
          "!max-w-lg !w-[92vw] !p-0",
          "flex flex-col max-h-[80vh]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">
              Pick a Repository
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground/60">
              Select a git repository for your project
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
          >
            <LuX size={15} />
          </button>
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
          {filteredRecent.length > 0 && (
            <Section label="Recent" icon={LuClock}>
              {filteredRecent.map((repo) => (
                <RepoRow key={repo.path} repo={repo} onSelect={onSelect} />
              ))}
            </Section>
          )}

          {scanning ? (
            <div className="flex flex-col items-center gap-2 py-10">
              <div className="size-5 animate-spin rounded-full border-2 border-border/30 border-t-foreground/50" />
              <p className="text-[11px] text-muted-foreground">
                Scanning for repositories...
              </p>
            </div>
          ) : (
            <>
              {filteredScanned.length > 0 && (
                <Section label="Discovered" icon={LuFolderGit2}>
                  {filteredScanned.map((repo) => (
                    <RepoRow key={repo.path} repo={repo} onSelect={onSelect} />
                  ))}
                </Section>
              )}
              {filteredRecent.length === 0 && filteredScanned.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10">
                  <LuGitBranch size={20} className="text-muted-foreground/30" />
                  <p className="text-[12px] text-muted-foreground">
                    {q ? "No matching repositories." : "No git repositories found."}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Section({
  label, icon: Icon, children,
}: {
  label: string; icon: React.ElementType; children: React.ReactNode
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <Icon size={11} className="text-muted-foreground/40" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
          {label}
        </span>
      </div>
      {children}
    </div>
  )
}

function RepoRow({
  repo, onSelect,
}: {
  repo: RepoEntry; onSelect: (r: { name: string; path: string }) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect({ name: repo.name, path: repo.path })}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
        "transition-colors hover:bg-secondary/40",
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary/40">
        <LuGitBranch size={14} className="text-muted-foreground" />
      </div>
      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <span className="truncate text-[13px] font-medium text-foreground/90">
          {repo.name}
        </span>
        <span className="truncate text-[11px] text-muted-foreground/50">
          {repo.path}
        </span>
      </div>
    </button>
  )
}
