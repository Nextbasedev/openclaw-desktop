"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { invoke } from "@/lib/ipc"
import { cn } from "@/lib/utils"
import { LuSearch, LuX, LuFolderGit2 } from "react-icons/lu"

type WorkspaceProject = {
  id: string
  name: string
  workspaceRoot: string
  repoRoot: string | null
  pinned: boolean
}

type Props = {
  open: boolean
  onClose: () => void
  onSelect: (repo: { name: string; path: string }) => void
}

export function RepoPickerDialog({ open, onClose, onSelect }: Props) {
  const [projects, setProjects] = useState<WorkspaceProject[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await invoke<{
        projects: Array<{
          id: string
          name: string
          workspaceRoot: string
          repoRoot: string | null
          pinned: boolean
        }>
      }>("middleware_projects_list", { input: {} })

      const all = res.projects ?? []
      const gitProjects = await Promise.all(
        all.map(async (p) => {
          const root = p.repoRoot ?? p.workspaceRoot
          try {
            const dir = await invoke<{
              entries: Array<{ name: string; isDir?: boolean }>
            }>("middleware_fs_read_dir", { path: root })
            const hasGit = dir.entries.some(
              (e) =>
                (e.name === ".git" || e.name === ".github") && e.isDir,
            )
            return hasGit ? p : null
          } catch {
            return null
          }
        }),
      )
      setProjects(
        gitProjects.filter(
          (p): p is WorkspaceProject => p !== null,
        ),
      )
    } catch {
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setQuery("")
      setProjects([])
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
  const filtered = projects.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.workspaceRoot.toLowerCase().includes(q),
  )

  const pinned = filtered.filter((p) => p.pinned)
  const unpinned = filtered.filter((p) => !p.pinned)

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
              Select Project
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground/60">
              Choose a project from your workspace
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
          >
            <LuX size={15} />
          </button>
        </div>

        <div className="px-5 pb-3">
          <div className="relative">
            <LuSearch
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects..."
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
              <p className="text-[11px] text-muted-foreground">
                Loading projects...
              </p>
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <Section label="Pinned" icon={LuFolderGit2}>
                  {pinned.map((p) => (
                    <ProjectRow
                      key={p.id}
                      project={p}
                      onSelect={onSelect}
                    />
                  ))}
                </Section>
              )}

              {unpinned.length > 0 && (
                <Section label="Projects" icon={LuFolderGit2}>
                  {unpinned.map((p) => (
                    <ProjectRow
                      key={p.id}
                      project={p}
                      onSelect={onSelect}
                    />
                  ))}
                </Section>
              )}

              {filtered.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10">
                  <LuFolderGit2
                    size={20}
                    className="text-muted-foreground/30"
                  />
                  <p className="text-[12px] text-muted-foreground">
                    {q
                      ? "No matching projects."
                      : "No projects in workspace."}
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
  label,
  icon: Icon,
  children,
}: {
  label: string
  icon: React.ElementType
  children: React.ReactNode
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

function ProjectRow({
  project,
  onSelect,
}: {
  project: WorkspaceProject
  onSelect: (r: { name: string; path: string }) => void
}) {
  const path = project.repoRoot ?? project.workspaceRoot

  return (
    <button
      type="button"
      onClick={() => onSelect({ name: project.name, path })}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
        "transition-colors hover:bg-secondary/40",
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary/40">
        <LuFolderGit2 size={14} className="text-muted-foreground" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-foreground/90">
          {project.name}
        </span>
        <span className="truncate text-[11px] text-muted-foreground/50">
          {path}
        </span>
      </div>
    </button>
  )
}
