"use client"

import { useState, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { invoke } from "@/lib/ipc"
import { VscGitCommit, VscSourceControl, VscRefresh, VscCloud } from "react-icons/vsc"
import { LuChevronDown, LuFolderGit2 } from "react-icons/lu"
import { BranchDropdown } from "./BranchDropdown"
import { RepoPickerDialog } from "@/components/sidebar/RepoPickerDialog"
import {
  type FileState, type GitFile, type GitContextResponse, type BranchesResponse,
  STATE_CONFIG, parseStatusLine, parseCommitLine,
} from "./git-helpers"

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

export function GitTab({ projectId }: { projectId: string | null }) {
  const [context, setContext] = useState<GitContextResponse | null>(null)
  const [branches, setBranches] = useState<BranchesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [branchDropdown, setBranchDropdown] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const [isLocal, setIsLocal] = useState<boolean | null>(null)

  useEffect(() => {
    invoke<{ isLocal: boolean }>("middleware_connect_status", { input: {} })
      .then((s) => setIsLocal(s.isLocal))
      .catch(() => setIsLocal(true))
  }, [])

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [ctx, br] = await Promise.all([
        invoke<GitContextResponse>("middleware_git_context", { input: { projectId } }),
        invoke<BranchesResponse>("middleware_git_branches", { input: { projectId } }),
      ])
      setContext(ctx)
      setBranches(br)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => {
    setContext(null)
    setBranches(null)
    load()
  }, [load])

  const handleSwitchBranch = useCallback(async (branchName: string) => {
    if (!projectId || switching) return
    setSwitching(true)
    setBranchDropdown(false)
    try {
      await invoke("middleware_git_switch_branch", {
        input: { projectId, branchName },
      })
      await load()
    } catch { /* ignore */ }
    finally { setSwitching(false) }
  }, [projectId, switching, load])

  const handleRepoSelect = useCallback(async (repo: { name: string; path: string }) => {
    if (!projectId) return
    setRepoPickerOpen(false)
    try {
      await invoke("middleware_projects_update", {
        input: { projectId, repoRoot: repo.path, workspaceRoot: repo.path },
      })
      await invoke("middleware_repos_select", {
        input: { path: repo.path, name: repo.name },
      })
      setContext(null)
      setBranches(null)
      await load()
    } catch { /* ignore */ }
  }, [projectId, load])

  if (isLocal === false) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
        <VscCloud className="size-10 text-muted-foreground/20" />
        <div className="text-center">
          <p className="text-[13px] font-medium text-foreground/80">Remote Gateway</p>
          <p className="mt-1 text-[11px] text-muted-foreground/50">
            Git integration is currently supported for local connections only.
          </p>
        </div>
      </div>
    )
  }

  if (!projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4">
        <VscSourceControl className="size-8 text-muted-foreground/20" />
        <p className="text-center text-[12px] text-muted-foreground/60">
          Select a topic to view git info
        </p>
      </div>
    )
  }

  if (loading && !context) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="size-5 animate-spin rounded-full border-2 border-border/30 border-t-foreground/50" />
      </div>
    )
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

  const files = (context?.uncommittedChanges ?? [])
    .map(parseStatusLine)
    .filter(Boolean) as GitFile[]

  const commits = (context?.recentCommits ?? []).map(parseCommitLine)
  const allBranches = branches?.local ?? []

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
                {switching ? "Switching…" : (context?.currentBranch ?? "—")}
              </span>
              <LuChevronDown size={12} className="shrink-0 text-muted-foreground" />
            </button>

            {branchDropdown && allBranches.length > 0 && (
              <BranchDropdown
                branches={allBranches}
                current={context?.currentBranch ?? null}
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

        <div className="mt-3 flex gap-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[18px] font-semibold tabular-nums text-foreground">
              {files.length}
            </span>
            <span className="text-[11px] text-muted-foreground">changed</span>
          </div>
        </div>
      </div>

      <div className="h-px bg-border/30" />

      {/* Changed files */}
      {files.length > 0 && (
        <div className="py-3">
          <p className="mb-2 px-4 text-[11px] font-medium text-muted-foreground">
            Changes
          </p>
          <div className="flex flex-col">
            {files.map((file) => {
              const fileName = file.path.split("/").pop() ?? file.path
              const dirPath = file.path.split("/").slice(0, -1).join("/")
              return (
                <div
                  key={file.path}
                  className="flex items-center gap-2.5 px-4 py-[6px] transition-colors hover:bg-secondary/30"
                >
                  <StateBadge state={file.state} />
                  <div className="flex flex-1 flex-col min-w-0">
                    <span className="truncate text-[12px] text-foreground">{fileName}</span>
                    {dirPath && (
                      <span className="truncate text-[10px] text-muted-foreground/60">{dirPath}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {files.length > 0 && commits.length > 0 && <div className="h-px bg-border/30" />}

      {/* Commit history */}
      {commits.length > 0 && (
        <div className="py-3">
          <p className="mb-2 px-4 text-[11px] font-medium text-muted-foreground">
            Recent commits
          </p>
          <div className="flex flex-col">
            {commits.map((commit, i) => (
              <div
                key={commit.hash}
                className="flex items-start gap-2.5 px-4 py-2 transition-colors hover:bg-secondary/30"
              >
                <div className="relative mt-[3px] flex flex-col items-center">
                  <VscGitCommit className="size-3.5 shrink-0 text-muted-foreground/50" />
                  {i < commits.length - 1 && (
                    <div className="absolute top-4 w-px bg-border/30" style={{ height: 20 }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[12px] text-foreground leading-snug">
                    {commit.message}
                  </p>
                  <code className="mt-1 text-[10px] text-sky-400/60">{commit.hash}</code>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {files.length === 0 && commits.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
          <VscSourceControl className="size-6 text-muted-foreground/20" />
          <p className="text-[12px] text-muted-foreground/60">Clean working tree</p>
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

