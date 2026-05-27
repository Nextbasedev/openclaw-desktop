"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { invoke } from "@/lib/ipc"
import { middlewareFetch } from "@/lib/middleware-client"
import { cn } from "@/lib/utils"
import {
  VscChevronDown,
  VscChevronRight,
  VscFolder,
  VscFolderOpened,
  VscFolderLibrary,
  VscSourceControl,
  VscGlobe,
  VscRefresh,
  VscSearch,
} from "react-icons/vsc"
import type { InspectorScope } from "./inspectorScope"

/* ── Types ── */

type FolderEntry = {
  name: string
  path: string
  absolutePath?: string
  type: "directory"
  hasGit?: boolean
  gitRoot?: string | null
  isProjectRoot?: boolean
  projectId?: string | null
  disabledReason?: string | null
}

type ProjectItem = {
  id: string
  name: string
  workspaceRoot?: string
  repoRoot?: string
  archived?: boolean
}

type FolderNode = FolderEntry & {
  children?: FolderNode[]
  loaded?: boolean
  loading?: boolean
}

/* ── Helpers ── */

function updateNode(nodes: FolderNode[], path: string, patch: Partial<FolderNode>): FolderNode[] {
  return nodes.map((n) => {
    if (n.path === path) return { ...n, ...patch }
    if (n.children) return { ...n, children: updateNode(n.children, path, patch) }
    return n
  })
}

function flattenAll(nodes: FolderNode[]): FolderNode[] {
  const out: FolderNode[] = []
  for (const n of nodes) {
    out.push(n)
    if (n.children) out.push(...flattenAll(n.children))
  }
  return out
}

async function fetchFolderTree(folderPath = "", showHidden = false): Promise<{ root: FolderEntry | null; entries: FolderEntry[]; error?: string }> {
  const params = new URLSearchParams()
  if (folderPath) params.set("path", folderPath)
  if (showHidden) params.set("showHidden", "true")
  const query = params.toString()
  return middlewareFetch(`/api/folders/tree${query ? `?${query}` : ""}`)
}

/* ── FolderRow ── */

function FolderRow({
  node,
  depth,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggle,
}: {
  node: FolderNode
  depth: number
  selectedPath: string | null
  expandedPaths: Set<string>
  onSelect: (node: FolderNode) => void
  onToggle: (node: FolderNode) => void
}) {
  const selected = selectedPath === node.path
  const expanded = expandedPaths.has(node.path)
  const disabled = Boolean(node.disabledReason)

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(node)}
        onDoubleClick={() => onToggle(node)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
          "disabled:cursor-default disabled:opacity-45",
          selected ? "bg-secondary text-foreground" : "text-foreground/82 hover:bg-secondary/45",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span
          className="flex size-4 shrink-0 cursor-pointer items-center justify-center text-muted-foreground"
          onClick={(e) => { e.stopPropagation(); onToggle(node) }}
        >
          {expanded ? <VscChevronDown className="size-3" /> : <VscChevronRight className="size-3" />}
        </span>
        {expanded
          ? <VscFolderOpened className="size-3.5 shrink-0 text-muted-foreground/70" />
          : <VscFolder className="size-3.5 shrink-0 text-muted-foreground/70" />
        }
        <span className="min-w-0 flex-1 truncate">{node.name || "root"}</span>
        {node.hasGit && (
          <VscSourceControl
            className="size-3.5 shrink-0 text-muted-foreground/55"
            aria-label="Git repository"
          />
        )}
        {node.loading && <span className="text-[10px] text-muted-foreground/45">…</span>}
      </button>
      {expanded && node.children?.map((child) => (
        <FolderRow
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          expandedPaths={expandedPaths}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </>
  )
}

/* ── Main picker ── */

type InspectorScopePickerProps = {
  title?: string
  description?: string
  onSelectScope: (scope: InspectorScope) => void
}

export function InspectorScopePicker({
  title = "Choose workspace for this chat",
  description = "This controls Workspace and Git for this chat.",
  onSelectScope,
}: InspectorScopePickerProps) {
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [rootInfo, setRootInfo] = useState<FolderEntry | null>(null)
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<FolderNode | null>(null)
  const [search, setSearch] = useState("")
  const [showHidden, setShowHidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRoot = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tree, projectsResult] = await Promise.all([
        fetchFolderTree("", showHidden),
        invoke<{ projects?: ProjectItem[] }>("middleware_projects_list", { input: { all: true } }).catch(() => ({ projects: [] })),
      ])
      setRootInfo(tree.root ?? null)
      setFolders((tree.entries ?? []).map((e) => ({ ...e, children: [], loaded: false })))
      setProjects((projectsResult.projects ?? []).filter((p) => !p.archived))
      if (tree.error) setError(tree.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load folders")
    } finally {
      setLoading(false)
    }
  }, [showHidden])

  useEffect(() => { void loadRoot() }, [loadRoot])

  const toggleFolder = useCallback(async (node: FolderNode) => {
    if (node.disabledReason) return
    const isExpanded = expandedPaths.has(node.path)
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (isExpanded) next.delete(node.path)
      else next.add(node.path)
      return next
    })
    if (isExpanded || node.loaded || node.loading) return
    setFolders((prev) => updateNode(prev, node.path, { loading: true }))
    try {
      const tree = await fetchFolderTree(node.path, showHidden)
      setFolders((prev) => updateNode(prev, node.path, {
        children: (tree.entries ?? []).map((e) => ({ ...e, children: [], loaded: false })),
        loaded: true,
        loading: false,
      }))
    } catch {
      setFolders((prev) => updateNode(prev, node.path, { children: [], loaded: true, loading: false }))
    }
  }, [expandedPaths, showHidden])

  const visibleFolders = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return folders
    return flattenAll(folders).filter((f) =>
      f.name.toLowerCase().includes(term) ||
      f.path.toLowerCase().includes(term) ||
      (f.absolutePath ?? "").toLowerCase().includes(term),
    )
  }, [folders, search])

  const selectedStatus = selected
    ? selected.disabledReason
      ?? (selected.hasGit ? "Git repository detected for this folder." : "Workspace-only folder. Git can be connected later.")
    : "Select a folder, or use the global workspace."

  const confirmFolder = useCallback(async () => {
    if (!selected || selected.disabledReason || connecting) return
    // If folder is already an existing project, just select it
    if (selected.projectId) {
      onSelectScope({ kind: "project", projectId: selected.projectId })
      return
    }
    setConnecting(true)
    try {
      // Check if an existing project already uses this path
      const existing = projects.find((p) => {
        const root = p.workspaceRoot || p.repoRoot
        return root && selected.absolutePath && root === selected.absolutePath
      })
      if (existing) {
        onSelectScope({ kind: "project", projectId: existing.id })
        return
      }
      // Create a new project from this folder
      const name = selected.name || selected.absolutePath?.split(/[\\/]/).pop() || "Workspace"
      const created = await invoke<{ project?: ProjectItem }>("middleware_projects_create", {
        input: {
          name,
          workspaceRoot: selected.absolutePath,
          repoRoot: selected.gitRoot ?? undefined,
        },
      })
      if (created.project?.id) {
        onSelectScope({ kind: "project", projectId: created.project.id })
      }
    } finally {
      setConnecting(false)
    }
  }, [connecting, onSelectScope, projects, selected])

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* Header */}
      <div className="border-b border-border/40 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-border/40 bg-secondary/30">
            <VscFolderLibrary className="size-5 text-muted-foreground/70" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-foreground/90">{title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/60">{description}</p>
          </div>
        </div>
        {/* Search */}
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-border/40 bg-background/40 px-2">
          <VscSearch className="size-3.5 text-muted-foreground/55" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search folders…"
            className="h-8 min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/40"
          />
          <button type="button" onClick={loadRoot} className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground">
            <VscRefresh className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Folder browser */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="mb-2 flex items-center justify-between gap-3 px-2">
          {rootInfo && (
            <p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/45" title={rootInfo.absolutePath || rootInfo.path}>
              {rootInfo.absolutePath || rootInfo.path}
            </p>
          )}
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground/60">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} className="size-3 accent-foreground" />
            Show hidden
          </label>
        </div>
          {loading ? (
            <p className="px-3 py-8 text-center text-[12px] text-muted-foreground/55">Loading folders…</p>
          ) : error ? (
            <p className="px-3 py-8 text-center text-[12px] text-red-300/70">{error}</p>
          ) : visibleFolders.length > 0 ? (
            visibleFolders.map((f) => (
              <FolderRow
                key={f.path}
                node={f}
                depth={0}
                selectedPath={selected?.path ?? null}
                expandedPaths={search.trim() ? new Set() : expandedPaths}
                onSelect={setSelected}
                onToggle={toggleFolder}
              />
            ))
          ) : (
            <p className="px-3 py-8 text-center text-[12px] text-muted-foreground/55">No folders found.</p>
          )}
      </div>

      {/* Footer: selection status + confirm */}
      <div className="border-t border-border/40 px-4 py-3">
        <p className="truncate text-[11px] text-foreground/80" title={selected?.absolutePath || selected?.path || undefined}>
          Selected: {selected ? (selected.absolutePath || selected.path) : "None"}
        </p>
        <p className="mt-1 truncate text-[10px] text-muted-foreground/55">{selectedStatus}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSelectScope({ kind: "global" })}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/45 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <VscGlobe className="size-3.5" />
            Global Workspace
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSelectScope({ kind: "unset" })}
              className="cursor-pointer rounded-lg border border-border/45 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selected || Boolean(selected.disabledReason) || connecting}
              onClick={confirmFolder}
              className="glass-btn-primary cursor-pointer px-3 py-1.5 text-[11px] disabled:cursor-default disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Use this folder"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
