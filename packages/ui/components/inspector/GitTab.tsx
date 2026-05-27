"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { cn } from "@/lib/utils"
import { invoke } from "@/lib/ipc"
import { VscGitCommit, VscSourceControl, VscRefresh, VscArrowLeft, VscFile, VscMarkdown } from "react-icons/vsc"
import { LuChevronDown, LuFolderGit2 } from "react-icons/lu"
import { BranchDropdown } from "./BranchDropdown"
import { RepoPickerDialog } from "@/components/sidebar/RepoPickerDialog"
import {
  type FileState, type GitFile, type GitContextResponse, type BranchesResponse,
  STATE_CONFIG, parseStatusLine, parseCommitLine, parseGitShow, type FileDiff, type DiffLine, type GitDiffResponse,
} from "./git-helpers"

const GIT_TAB_SELECTION_STORAGE_KEY = "openclaw.gitTab.selectedProject.v1"

export type PickedRepo = { name: string; path: string }
export type GitTabSelection = {
  projectId: string | null
  repo: PickedRepo | null
}

let gitTabSelectionCache: GitTabSelection | null = null

export function parsePersistedGitTabSelection(raw: string | null): GitTabSelection | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<GitTabSelection>
    const projectId = typeof parsed.projectId === "string" && parsed.projectId ? parsed.projectId : null
    const repo = parsed.repo
    const validRepo = repo && typeof repo.name === "string" && typeof repo.path === "string"
      ? { name: repo.name, path: repo.path }
      : null
    return projectId || validRepo ? { projectId, repo: validRepo } : null
  } catch {
    return null
  }
}

function readPersistedGitTabSelection(): GitTabSelection | null {
  if (gitTabSelectionCache) return gitTabSelectionCache
  if (typeof window === "undefined") return null
  const sessionSelection = parsePersistedGitTabSelection(window.sessionStorage.getItem(GIT_TAB_SELECTION_STORAGE_KEY))
  if (sessionSelection) {
    gitTabSelectionCache = sessionSelection
    return sessionSelection
  }
  const localSelection = parsePersistedGitTabSelection(window.localStorage.getItem(GIT_TAB_SELECTION_STORAGE_KEY))
  gitTabSelectionCache = localSelection
  return localSelection
}

function persistGitTabSelection(selection: GitTabSelection) {
  gitTabSelectionCache = selection
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(GIT_TAB_SELECTION_STORAGE_KEY, JSON.stringify(selection))
    window.localStorage.setItem(GIT_TAB_SELECTION_STORAGE_KEY, JSON.stringify(selection))
  } catch { /* ignore */ }
}

export function getEffectiveGitTarget(projectId: string | null, selection: GitTabSelection | null) {
  const effectiveProjectId = projectId ?? selection?.projectId ?? null
  return {
    projectId: effectiveProjectId,
    repoPath: effectiveProjectId ? null : selection?.repo?.path ?? null,
  }
}

function StateBadge({ state }: { state: FileState }) {
  const config = STATE_CONFIG[state]
  return (
    <span className={cn(
      "inline-flex size-[18px] shrink-0 items-center justify-center rounded text-[10px] font-semibold",
      config.color,
    )}>
      {config.letter}
    </span>
  )
}

function GitPanelSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="size-4 animate-pulse rounded bg-secondary/50" />
          <div className="h-4 w-24 animate-pulse rounded bg-secondary/60" />
          <div className="ml-auto h-4 w-12 animate-pulse rounded bg-secondary/40" />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="h-4 w-16 animate-pulse rounded-full bg-secondary/40" />
          <div className="h-3 w-28 animate-pulse rounded bg-secondary/30" />
        </div>
        <div className="mt-4 flex items-center gap-4">
          <div className="h-7 w-24 animate-pulse rounded bg-secondary/50" />
          <div className="h-4 w-10 animate-pulse rounded bg-secondary/35" />
          <div className="h-4 w-10 animate-pulse rounded bg-secondary/30" />
        </div>
      </div>
      <div className="h-px bg-border/30" />
      <div className="mx-3 mt-2 overflow-hidden rounded-xl border border-border/40 bg-card/40 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
          <div className="h-3 w-16 animate-pulse rounded bg-secondary/50" />
          <div className="h-4 w-7 animate-pulse rounded-full bg-secondary/35" />
        </div>
        <div className="space-y-2 px-3 py-3">
          {["w-28", "w-36", "w-24", "w-32", "w-20"].map((width, index) => (
            <div key={index} className="flex items-center gap-2.5">
              <div className="size-[18px] animate-pulse rounded bg-secondary/50" />
              <div className={cn("h-3 animate-pulse rounded bg-secondary/40", width)} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 px-4">
        <div className="mb-3 h-3 w-24 animate-pulse rounded bg-secondary/40" />
        <div className="space-y-3">
          <div className="h-4 w-4/5 animate-pulse rounded bg-secondary/35" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-secondary/30" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-secondary/25" />
        </div>
      </div>
    </div>
  )
}

function GitDiffSkeleton() {
  return (
    <div className="space-y-2 p-4 font-mono">
      <div className="h-5 w-64 animate-pulse rounded bg-secondary/45" />
      <div className="h-4 w-[520px] animate-pulse rounded bg-secondary/35" />
      <div className="h-4 w-[460px] animate-pulse rounded bg-secondary/30" />
      <div className="h-4 w-[500px] animate-pulse rounded bg-secondary/35" />
      <div className="h-4 w-[420px] animate-pulse rounded bg-secondary/25" />
      <div className="h-4 w-[540px] animate-pulse rounded bg-secondary/30" />
    </div>
  )
}

type DiffViewMode = "unified" | "split"

function GitChangesToolbar({
  mode,
  onModeChange,
  onCollapseAll,
}: {
  mode: DiffViewMode
  onModeChange: (mode: DiffViewMode) => void
  onCollapseAll: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-lg border border-border/20 bg-white/[0.035] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        {(["unified", "split"] as DiffViewMode[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onModeChange(item)}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1 text-[11px] font-semibold capitalize transition-colors",
              mode === item
                ? "bg-white/10 text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
            )}
          >
            {item}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCollapseAll}
        className="cursor-pointer rounded-lg border border-border/20 bg-white/[0.035] px-3 py-1.5 text-[11px] font-semibold text-foreground/90 transition-colors hover:bg-white/[0.07]"
      >
        Collapse all
      </button>
    </div>
  )
}

function DiffFileHeader({
  path,
  additions,
  deletions,
  open,
  onClick,
}: {
  path: string
  additions: number
  deletions: number
  open: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 border-b border-border/20 bg-white/[0.025] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.045]"
    >
      <VscMarkdown className="size-3.5 shrink-0 text-sky-400/80" />
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">{path}</span>
      <span className="shrink-0 font-mono text-[12px] font-bold text-emerald-400">+{additions}</span>
      <span className="shrink-0 font-mono text-[12px] font-bold text-red-400">-{deletions}</span>
      <LuChevronDown
        size={14}
        className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
      />
    </button>
  )
}

function DiffLines({ diff, mode }: { diff: FileDiff; mode: DiffViewMode }) {
  if (mode === "split") {
    return (
      <div className="min-w-[760px] font-mono text-[12px] leading-[1.65]">
        {diff.lines.map((line, idx) => {
          if (line.type === "hunk") {
            return (
              <div key={idx} className="grid grid-cols-2 border-y border-white/5 bg-[#161b22] text-[11px] font-bold text-[#7d8590]">
                <div className="px-4 py-1.5">{line.content}</div>
                <div className="border-l border-white/10 px-4 py-1.5">{line.content}</div>
              </div>
            )
          }
          const isAdd = line.type === "addition"
          const isDel = line.type === "deletion"
          return (
            <div key={idx} className="grid grid-cols-2 border-b border-white/[0.025]">
              <DiffLineCell line={line} side="old" muted={isAdd} tone={isDel ? "del" : "normal"} />
              <DiffLineCell line={line} side="new" muted={isDel} tone={isAdd ? "add" : "normal"} split />
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="min-w-[720px] font-mono text-[12px] leading-[1.65]">
      {diff.lines.map((line, idx) => {
        if (line.type === "hunk") {
          return (
            <div key={idx} className="border-y border-white/5 bg-[#161b22] px-4 py-1.5 text-[11px] font-bold text-[#7d8590]">
              {line.content}
            </div>
          )
        }
        const tone = line.type === "addition" ? "add" : line.type === "deletion" ? "del" : "normal"
        return <DiffLineCell key={idx} line={line} side="both" tone={tone} />
      })}
    </div>
  )
}

function DiffLineCell({
  line,
  side,
  tone,
  muted = false,
  split = false,
}: {
  line: DiffLine
  side: "old" | "new" | "both"
  tone: "add" | "del" | "normal"
  muted?: boolean
  split?: boolean
}) {
  const sign = tone === "add" ? "+" : tone === "del" ? "-" : " "
  const number = side === "old" ? line.oldLineNumber : side === "new" ? line.newLineNumber : (line.oldLineNumber ?? line.newLineNumber)
  return (
    <div
      className={cn(
        "flex min-w-0 transition-colors",
        split && "border-l border-white/10",
        muted && "opacity-30",
        tone === "add" && "bg-[#12351f] text-[#d7ffe0]",
        tone === "del" && "bg-[#3a1719] text-[#ffe0e0]",
        tone === "normal" && "bg-[#0b0b0c] text-[#d6d6d8] hover:bg-white/[0.04]",
      )}
    >
      <div className="w-10 shrink-0 select-none px-2 text-right text-[10px] tabular-nums text-muted-foreground/45">
        {muted ? "" : (number ?? "")}
      </div>
      <div className={cn("w-6 shrink-0 select-none text-center text-[13px] font-bold", tone === "add" && "text-emerald-300", tone === "del" && "text-red-300", tone === "normal" && "text-muted-foreground/30")}>{muted ? "" : sign}</div>
      <div className="flex-1 whitespace-pre px-3 font-medium">{muted ? "" : line.content}</div>
    </div>
  )
}

type GitTabProps = {
  projectId: string | null
  selection?: GitTabSelection | null
  onSelectionChange?: (selection: GitTabSelection) => void
}

export function GitTab({ projectId, selection, onSelectionChange }: GitTabProps) {
  const persistedSelectionRef = useRef<GitTabSelection | null>(null)
  if (persistedSelectionRef.current === null) {
    persistedSelectionRef.current = readPersistedGitTabSelection()
  }

  const [internalSelection, setInternalSelection] = useState<GitTabSelection>(() => {
    if (projectId) return { projectId, repo: null }
    return persistedSelectionRef.current ?? { projectId: null, repo: null }
  })
  const [context, setContext] = useState<GitContextResponse | null>(null)
  const [branches, setBranches] = useState<BranchesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [branchDropdown, setBranchDropdown] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<{ hash: string; message: string } | null>(null)
  const [selectedChangedFile, setSelectedChangedFile] = useState<GitFile | null>(null)
  const activeSelection = selection ?? internalSelection
  const { projectId: effectiveProjectId, repoPath: effectiveRepoPath } = getEffectiveGitTarget(projectId, activeSelection)
  const skipNextAutoLoadRef = useRef<string | null>(null)
  const loadSeqRef = useRef(0)

  const updateSelection = useCallback((nextSelection: GitTabSelection) => {
    setInternalSelection(nextSelection)
    onSelectionChange?.(nextSelection)
    persistGitTabSelection(nextSelection)
  }, [onSelectionChange])

  const loadGitTarget = useCallback(async (targetProjectId: string | null, targetRepoPath: string | null = null) => {
    if (!targetProjectId && !targetRepoPath) return
    const seq = ++loadSeqRef.current
    setLoading(true)
    setContext(null)
    setBranches(null)
    try {
      const ctx = targetProjectId
        ? await invoke<GitContextResponse>("middleware_git_status", { input: { projectId: targetProjectId } })
        : await invoke<GitContextResponse>("middleware_git_status_for_repo", { input: { repoPath: targetRepoPath } })
      if (seq !== loadSeqRef.current) return
      let br: BranchesResponse | null = null
      if (ctx.mode !== "remote") {
        try {
          br = targetProjectId
            ? await invoke<BranchesResponse>("middleware_git_branches", { input: { projectId: targetProjectId } })
            : await invoke<BranchesResponse>("middleware_git_branches_for_repo", { input: { repoPath: targetRepoPath } })
        } catch {
          br = null
        }
      }
      if (seq !== loadSeqRef.current) return
      setContext(ctx)
      setBranches(br)
      setSelectedChangedFile(null)
    } catch { /* ignore */ }
    finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    await loadGitTarget(effectiveProjectId, effectiveRepoPath)
  }, [effectiveProjectId, effectiveRepoPath, loadGitTarget])

  useEffect(() => {
    if (!projectId) return
    updateSelection({ projectId, repo: null })
  }, [projectId, updateSelection])

  useEffect(() => {
    if (!effectiveProjectId && !effectiveRepoPath) {
      setContext(null)
      setBranches(null)
      setLoading(false)
      return
    }

    const targetKey = effectiveProjectId ?? effectiveRepoPath
    if (targetKey && skipNextAutoLoadRef.current === targetKey) {
      skipNextAutoLoadRef.current = null
      return
    }

    void loadGitTarget(effectiveProjectId, effectiveRepoPath)
  }, [effectiveProjectId, effectiveRepoPath, loadGitTarget])

  const handleSwitchBranch = useCallback(async (branchName: string) => {
    if ((!effectiveProjectId && !effectiveRepoPath) || switching) return
    setSwitching(true)
    setBranchDropdown(false)
    try {
      if (effectiveProjectId) {
        await invoke("middleware_git_switch_branch", {
          input: { projectId: effectiveProjectId, branchName },
        })
      } else if (effectiveRepoPath) {
        await invoke("middleware_git_switch_branch_for_repo", {
          input: { repoPath: effectiveRepoPath, branchName },
        })
      }
      await load()
    } catch { /* ignore */ }
    finally { setSwitching(false) }
  }, [effectiveProjectId, effectiveRepoPath, switching, load])

  const handleRepoSelect = useCallback(async (repo: { name: string; path: string }) => {
    setRepoPickerOpen(false)
    setContext(null)
    setBranches(null)

    const nextSelection = effectiveProjectId
      ? { projectId: effectiveProjectId, repo: null }
      : { projectId: null, repo }
    updateSelection(nextSelection)

    try {
      await invoke("middleware_repos_select", {
        input: { path: repo.path, name: repo.name },
      })

      if (effectiveProjectId) {
        await invoke("middleware_projects_update", {
          input: {
            projectId: effectiveProjectId,
            repoRoot: repo.path,
            workspaceRoot: repo.path,
          },
        })
        await loadGitTarget(effectiveProjectId, null)
        return
      }

      setLoading(true)
      skipNextAutoLoadRef.current = repo.path
      await loadGitTarget(null, repo.path)
    } catch { /* ignore */ }
  }, [effectiveProjectId, loadGitTarget, updateSelection])

  if (!effectiveProjectId && !activeSelection.repo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4">
        <VscSourceControl className="size-8 text-muted-foreground/20" />
        <div className="text-center">
          <p className="text-[13px] font-medium text-foreground/80">
            No project selected
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/60">
            Use the same repository picker to load git branches, changes, and commits.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRepoPickerOpen(true)}
          className="glass-btn-primary px-4 py-1.5 text-[12px]"
        >
          Select a Project
        </button>
        <RepoPickerDialog
          open={repoPickerOpen}
          onClose={() => setRepoPickerOpen(false)}
          onSelect={handleRepoSelect}
        />
      </div>
    )
  }

  if (loading && !context) {
    return <GitPanelSkeleton />
  }

  if (context && !context.hasGit) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
        <LuFolderGit2 className="size-10 text-muted-foreground/20" />
        <div className="text-center">
          <p className="text-[13px] font-medium text-foreground/80">No repository connected</p>
          <p className="mt-1 text-[11px] text-muted-foreground/50">
            Connect a git repository to see branches, changes, and commits.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRepoPickerOpen(true)}
          className="glass-btn-primary px-4 py-1.5 text-[12px]"
        >
          Connect Repository
        </button>
        <RepoPickerDialog
          open={repoPickerOpen}
          onClose={() => setRepoPickerOpen(false)}
          onSelect={handleRepoSelect}
        />
      </div>
    )
  }

  if (selectedCommit) {
    return (
      <CommitDetailView
        projectId={effectiveProjectId}
        repoPath={effectiveRepoPath}
        hash={selectedCommit.hash}
        message={selectedCommit.message}
        onBack={() => setSelectedCommit(null)}
      />
    )
  }

  if (selectedChangedFile) {
    return (
      <ChangedFileDiffView
        projectId={effectiveProjectId}
        repoPath={effectiveRepoPath}
        file={selectedChangedFile}
        onBack={() => setSelectedChangedFile(null)}
      />
    )
  }

  const files = context?.changedFiles?.length
    ? context.changedFiles
    : ((context?.uncommittedChanges ?? [])
      .map(parseStatusLine)
      .filter(Boolean) as GitFile[])

  const commits = (context?.recentCommits ?? []).map(parseCommitLine)
  const allBranches = branches?.local ?? []
  const totalAdditions = context?.summary?.totalAdditions ?? files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const totalDeletions = context?.summary?.totalDeletions ?? files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Branch status */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <VscSourceControl className="size-4 shrink-0 text-muted-foreground/70" />
          <div className="relative flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setBranchDropdown((v) => !v)}
              disabled={switching}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium",
                "transition-colors hover:bg-secondary/40",
                switching && "opacity-50",
              )}
            >
              <span className="truncate">
                {switching ? "Switching…" : (context?.currentBranch ?? context?.branch ?? "—")}
              </span>
              <LuChevronDown size={12} className="shrink-0 text-muted-foreground" />
            </button>

            {branchDropdown && context?.mode !== "remote" && allBranches.length > 0 && (
              <BranchDropdown
                branches={allBranches}
                current={context?.currentBranch ?? context?.branch ?? null}
                onSelect={handleSwitchBranch}
                onClose={() => setBranchDropdown(false)}
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => setRepoPickerOpen(true)}
            className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            Change
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            <VscRefresh className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/60">
          {context?.mode && (
            <span className="rounded-full border border-border/30 px-2 py-0.5 uppercase tracking-wide">
              {context.mode === "remote" ? "Remote OpenClaw" : "Local"}
            </span>
          )}
          {context?.upstream && <span className="truncate">{context.upstream}</span>}
          {typeof context?.ahead === "number" && typeof context?.behind === "number" && (context.ahead > 0 || context.behind > 0) && (
            <span>{context.ahead} ahead / {context.behind} behind</span>
          )}
        </div>

        <div className="mt-3 flex items-center gap-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[18px] font-semibold tabular-nums text-foreground">
              {context?.summary?.totalFiles ?? files.length}
            </span>
            <span className="text-[11px] text-muted-foreground">Files changed</span>
          </div>
          {totalAdditions > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-500">
              <span className="text-[13px] opacity-70">+</span>
              <span className="tabular-nums">{totalAdditions}</span>
            </div>
          )}
          {totalDeletions > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-medium text-red-500">
              <span className="text-[13px] opacity-70">-</span>
              <span className="tabular-nums">{totalDeletions}</span>
            </div>
          )}
        </div>
      </div>

      <div className="h-px bg-border/30" />

      {/* Changed files */}
      {files.length > 0 && (
        <div className="mx-3 mt-2 overflow-hidden rounded-xl border border-border/40 bg-card/40 shadow-sm">
          <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
              Changes
            </p>
            <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] text-muted-foreground">
              {files.length}
            </span>
          </div>
          <div className="divide-y divide-border/20">
            {files.map((file) => {
              const fileName = file.path.split("/").pop() ?? file.path
              const dirPath = file.path.split("/").slice(0, -1).join("/")
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedChangedFile(file)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-secondary/35 active:bg-secondary/50"
                >
                  <StateBadge state={file.state} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[12px] font-medium text-foreground/90">{fileName}</span>
                    {dirPath && (
                      <span className="truncate text-[10px] text-muted-foreground/55">{dirPath}</span>
                    )}
                  </div>
                  {typeof file.additions === "number" && typeof file.deletions === "number" && (file.additions > 0 || file.deletions > 0) && (
                    <div className="ml-1 flex shrink-0 gap-1.5 font-mono text-[10px]">
                      {file.additions > 0 && <span className="text-emerald-500">+{file.additions}</span>}
                      {file.deletions > 0 && <span className="text-red-500">-{file.deletions}</span>}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {files.length > 0 && commits.length > 0 && <div className="h-4" />}

      {/* Commit history */}
      {commits.length > 0 && (
        <div className="py-3">
          <p className="mb-2 px-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-70">
            Recent history
          </p>
          <div className="flex flex-col">
            {commits.map((commit, i) => (
              <div
                key={`${commit.hash}-${i}`}
                className="group flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-secondary/40 active:bg-secondary/60"
                onClick={() => setSelectedCommit({ hash: commit.hash, message: commit.message })}
              >
                <div className="relative mt-1 flex flex-col items-center shrink-0">
                  <VscGitCommit className="size-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                  {i < commits.length - 1 && (
                    <div className="absolute top-4 w-px bg-border/20" style={{ height: "calc(100% + 12px)" }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-[12px] font-medium text-foreground/90 group-hover:text-foreground transition-colors">
                      {commit.message}
                    </p>
                    <div className="flex items-center gap-1.5 font-mono text-[9px] whitespace-nowrap">
                      <span className="text-emerald-500 font-bold">+{commit.additions || 0}</span>
                      <span className="text-red-500 font-bold">-{commit.deletions || 0}</span>
                    </div>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <code className="text-[10px] text-muted-foreground/30 tabular-nums">
                      {commit.shortHash || commit.hash.substring(0, 7)}
                    </code>
                    <span className="text-[10px] text-muted-foreground/30 italic">
                      {commit.date}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <RepoPickerDialog
        open={repoPickerOpen}
        onClose={() => setRepoPickerOpen(false)}
        onSelect={handleRepoSelect}
      />
    </div>
  )
}

function CommitDetailView({
  projectId,
  repoPath,
  hash,
  message,
  onBack,
}: {
  projectId: string | null
  repoPath: string | null
  hash: string
  message: string
  onBack: () => void
}) {
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<DiffViewMode>("unified")
  const requestRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestRef.current
    const requestKey = `${projectId ?? ""}:${repoPath ?? ""}:${hash}`
    async function loadDiff() {
      if (!projectId && !repoPath) { setLoading(false); return }
      setLoading(true)
      try {
        const res = await invoke<{ diff: string }>("middleware_git_commit_details", {
          input: { projectId, repoRoot: repoPath, hash },
        })
        if (requestRef.current !== requestId || requestKey !== `${projectId ?? ""}:${repoPath ?? ""}:${hash}`) return
        const parsed = parseGitShow(res.diff)
        setDiffs(parsed)
        setSelectedFile(parsed.length > 0 ? parsed[0].path : null)
      } catch (err) {
        if (requestRef.current !== requestId) return
        console.error(err)
      } finally {
        if (requestRef.current === requestId) setLoading(false)
      }
    }
    loadDiff()
    return () => { requestRef.current += 1 }
  }, [projectId, repoPath, hash])

  const openFile = selectedFile
  const currentFileDiff = diffs?.find(f => f.path === openFile)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0f0f10] text-foreground">
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 py-2">
        <button
          onClick={onBack}
          className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <VscArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold text-foreground">{message}</h3>
          <code className="text-[10px] text-muted-foreground/55 font-mono">{hash.substring(0, 8)}</code>
        </div>
        <GitChangesToolbar
          mode={diffMode}
          onModeChange={setDiffMode}
          onCollapseAll={() => setSelectedFile(null)}
        />
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <GitDiffSkeleton />
        ) : !diffs?.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground/60">
            <VscFile size={40} className="opacity-30" />
            <p className="text-[13px]">No files changed</p>
          </div>
        ) : (
          <div className="min-w-0 divide-y divide-white/10">
            {diffs.map((file) => {
              const open = file.path === openFile
              return (
                <div key={file.path} className="bg-[#101011]">
                  <DiffFileHeader
                    path={file.path}
                    additions={file.additions}
                    deletions={file.deletions}
                    open={open}
                    onClick={() => setSelectedFile(open ? null : file.path)}
                  />
                  {open && (
                    <div className="overflow-auto bg-[#050505] text-[#e6edf3]">
                      {currentFileDiff ? <DiffLines diff={currentFileDiff} mode={diffMode} /> : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ChangedFileDiffView({
  projectId,
  repoPath,
  file,
  onBack,
}: {
  projectId: string | null
  repoPath: string | null
  file: GitFile
  onBack: () => void
}) {
  const [diff, setDiff] = useState<GitDiffResponse | null>(null)
  const [parsedDiff, setParsedDiff] = useState<FileDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const requestRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestRef.current
    const requestKey = `${projectId ?? ""}:${repoPath ?? ""}:${file.path}`
    async function loadDiff() {
      if (!projectId && !repoPath) return
      setLoading(true)
      try {
        const res = projectId
          ? await invoke<GitDiffResponse>("middleware_git_diff", {
            input: { projectId, path: file.path },
          })
          : await invoke<GitDiffResponse>("middleware_git_diff_for_repo", {
            input: { repoPath, path: file.path },
          })
        if (requestRef.current !== requestId || requestKey !== `${projectId ?? ""}:${repoPath ?? ""}:${file.path}`) return
        setDiff(res)
        const parsed = res.patch ? parseGitShow(res.patch) : []
        setParsedDiff(parsed[0] ?? null)
      } catch (err) {
        if (requestRef.current !== requestId) return
        console.error(err)
        setDiff(null)
        setParsedDiff(null)
      } finally {
        if (requestRef.current === requestId) setLoading(false)
      }
    }
    void loadDiff()
    return () => { requestRef.current += 1 }
  }, [projectId, repoPath, file.path])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background/50 backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-border/20 px-4 py-3 shrink-0 bg-secondary/5 backdrop-blur-md">
        <button
          onClick={onBack}
          className="rounded-md p-1.5 transition-colors hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <VscArrowLeft size={16} />
        </button>
        <StateBadge state={file.state} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-bold text-foreground">{file.path}</h3>
          <p className="text-[10px] text-muted-foreground/50">
            {diff?.mode === "remote" ? "Remote OpenClaw diff" : "Local workspace diff"}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-black text-[#e6edf3] dark:bg-black">
        {loading ? (
          <GitDiffSkeleton />
        ) : !parsedDiff ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground/60">
            <VscFile size={40} className="opacity-30" />
            <p className="text-[13px]">Diff unavailable</p>
            {diff?.error && <p className="max-w-sm text-[11px]">{diff.error}</p>}
          </div>
        ) : (
          <div className="min-w-max flex flex-col font-mono text-[12px] leading-[1.6]">
            {parsedDiff.lines.map((line, idx) => {
              if (line.type === "hunk") {
                return (
                  <div key={idx} className="bg-[#161b22] text-[#7d8590] py-1.5 px-4 sticky top-0 z-10 border-y border-white/5 my-2 select-none text-[11px] font-bold opacity-80 backdrop-blur-sm">
                    {line.content}
                  </div>
                )
              }
              const isAdd = line.type === "addition"
              const isDel = line.type === "deletion"
              return (
                <div
                  key={idx}
                  className={cn(
                    "flex w-full group transition-colors",
                    isAdd && "bg-[#2ea04333] hover:bg-[#2ea04344]",
                    isDel && "bg-[#f8514933] hover:bg-[#f8514944]",
                    !isAdd && !isDel && "hover:bg-white/5",
                  )}
                >
                  <div className="flex shrink-0 select-none border-r border-white/5 bg-black/40">
                    <div className={cn("w-10 px-2 text-right text-[10px] tabular-nums", isDel ? "bg-[#f8514944] text-red-300" : "text-muted-foreground opacity-30")}>{line.oldLineNumber ?? ""}</div>
                    <div className={cn("w-10 px-2 text-right text-[10px] tabular-nums border-l border-white/5", isAdd ? "bg-[#2ea04344] text-emerald-300" : "text-muted-foreground opacity-30")}>{line.newLineNumber ?? ""}</div>
                  </div>
                  <div className={cn("w-6 shrink-0 flex items-center justify-center select-none text-[13px] font-bold", isAdd && "text-[#7ee787]", isDel && "text-[#ffa198]", !isAdd && !isDel && "text-muted-foreground/30")}>{isAdd ? "+" : isDel ? "-" : " "}</div>
                  <div className={cn("flex-1 px-4 whitespace-pre font-medium", isAdd && "text-[#e6ffec]", isDel && "text-[#fff0f0]")}>{line.content}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
