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
  STATE_CONFIG, parseStatusLine, parseCommitLine, parseGitShow, type FileDiff,
} from "./git-helpers"

type ProjectSummary = {
  id: string
  name: string
  profileId?: string
  workspaceRoot?: string
  repoRoot?: string | null
  archived?: boolean
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

export function GitTab({ projectId }: { projectId: string | null }) {
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null)
  const [context, setContext] = useState<GitContextResponse | null>(null)
  const [branches, setBranches] = useState<BranchesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [branchDropdown, setBranchDropdown] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<{ hash: string; message: string } | null>(null)
  const effectiveProjectId = projectId ?? pickedProjectId ?? null
  const skipNextAutoLoadRef = useRef<string | null>(null)

  const loadProject = useCallback(async (targetProjectId: string | null) => {
    if (!targetProjectId) return
    setLoading(true)
    try {
      const [ctx, br] = await Promise.all([
        invoke<GitContextResponse>("middleware_git_context", {
          input: { projectId: targetProjectId },
        }),
        invoke<BranchesResponse>("middleware_git_branches", {
          input: { projectId: targetProjectId },
        }),
      ])
      setContext(ctx)
      setBranches(br)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  const load = useCallback(async () => {
    await loadProject(effectiveProjectId)
  }, [effectiveProjectId, loadProject])

  useEffect(() => {
    if (!effectiveProjectId) {
      setContext(null)
      setBranches(null)
      setLoading(false)
      return
    }

    if (skipNextAutoLoadRef.current === effectiveProjectId) {
      skipNextAutoLoadRef.current = null
      return
    }

    void loadProject(effectiveProjectId)
  }, [effectiveProjectId, loadProject])

  const handleSwitchBranch = useCallback(async (branchName: string) => {
    if (!effectiveProjectId || switching) return
    setSwitching(true)
    setBranchDropdown(false)
    try {
      await invoke("middleware_git_switch_branch", {
        input: { projectId: effectiveProjectId, branchName },
      })
      await load()
    } catch { /* ignore */ }
    finally { setSwitching(false) }
  }, [effectiveProjectId, switching, load])

  const handleRepoSelect = useCallback(async (repo: { name: string; path: string }) => {
    setRepoPickerOpen(false)
    try {
      let targetProjectId = effectiveProjectId

      if (!targetProjectId) {
        const projectList = await invoke<{ projects: ProjectSummary[] }>(
          "middleware_projects_list",
        )
        const matchingProject = (projectList.projects ?? []).find((project) =>
          !project.archived &&
          (project.repoRoot === repo.path || project.workspaceRoot === repo.path),
        )

        if (matchingProject?.id) {
          targetProjectId = matchingProject.id
        } else {
          let profileId = "prof_local_main"
          try {
            const profileRes = await invoke<{
              profiles: Array<{ id: string }>
            }>("middleware_profiles_list")
            if (profileRes.profiles?.[0]?.id) {
              profileId = profileRes.profiles[0].id
            }
          } catch {
            // ignore
          }

          const created = await invoke<{ project: { id: string } }>(
            "middleware_projects_create",
            {
              input: {
                name: repo.name,
                profileId,
                workspaceRoot: repo.path,
                repoRoot: repo.path,
              },
            },
          )
          targetProjectId = created.project.id
        }

        setLoading(true)
        skipNextAutoLoadRef.current = targetProjectId
        setPickedProjectId(targetProjectId)
      }

      if (!targetProjectId) return

      await invoke("middleware_projects_update", {
        input: {
          projectId: targetProjectId,
          repoRoot: repo.path,
          workspaceRoot: repo.path,
        },
      })
      await invoke("middleware_repos_select", {
        input: { path: repo.path, name: repo.name },
      })
      setContext(null)
      setBranches(null)
      await loadProject(targetProjectId)
    } catch { /* ignore */ }
  }, [effectiveProjectId, loadProject])

  if (!effectiveProjectId) {
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

  if (selectedCommit) {
    return (
      <CommitDetailView
        projectId={effectiveProjectId}
        hash={selectedCommit.hash}
        message={selectedCommit.message}
        onBack={() => setSelectedCommit(null)}
      />
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

        <div className="mt-3 flex items-center gap-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[18px] font-semibold tabular-nums text-foreground">
              {context?.summary?.totalFiles ?? files.length}
            </span>
            <span className="text-[11px] text-muted-foreground">Files changed</span>
          </div>
          {(context?.summary?.totalAdditions ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-500">
              <span className="text-[13px] opacity-70">+</span>
              <span className="tabular-nums">{context?.summary?.totalAdditions}</span>
            </div>
          )}
          {(context?.summary?.totalDeletions ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-medium text-red-500">
              <span className="text-[13px] opacity-70">-</span>
              <span className="tabular-nums">{context?.summary?.totalDeletions}</span>
            </div>
          )}
        </div>
      </div>

      <div className="h-px bg-border/30" />

      {/* Changed files */}
      {files.length > 0 && (
        <div className="py-3 text-center border bg-gray-500 bg-opacity-25 rounded-md mx-4 mt-2">
          <p className="mb-2 px-4 text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-left opacity-70">
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
                    <span className="truncate text-left text-[12px] text-foreground">{fileName}</span>
                    {dirPath && (
                      <span className="truncate text-left text-[10px] text-muted-foreground/60">{dirPath}</span>
                    )}
                  </div>
                </div>
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
  hash,
  message,
  onBack,
}: {
  projectId: string | null
  hash: string
  message: string
  onBack: () => void
}) {
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  useEffect(() => {
    async function loadDiff() {
      if (!projectId) return
      setLoading(true)
      try {
        const res = await invoke<{ diff: string }>("middleware_git_commit_details", {
          input: { projectId, hash },
        })
        const parsed = parseGitShow(res.diff)
        setDiffs(parsed)
        if (parsed.length > 0) setSelectedFile(parsed[0].path)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadDiff()
  }, [projectId, hash])

  const currentFileDiff = diffs?.find(f => f.path === selectedFile)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background/50 backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-border/20 px-4 py-3 shrink-0 bg-secondary/5 backdrop-blur-md">
        <button
          onClick={onBack}
          className="rounded-md p-1.5 transition-colors hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <VscArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-bold text-foreground">
            {message}
          </h3>
          <code className="text-[10px] text-muted-foreground/50 font-mono">
            {hash.substring(0, 8)}
          </code>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Side: File List (GitHub Desktop style) */}
        <div className="w-[200px] shrink-0 border-r border-border/10 flex flex-col bg-muted/5 backdrop-blur-sm">
          <div className="px-3 py-2 border-b border-border/10">
             <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
               Changed Files
             </span>
          </div>
          <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
            {loading ? (
              <div className="p-4 text-center">
                 <div className="size-4 animate-spin rounded-full border-2 border-border/20 border-t-primary mx-auto" />
              </div>
            ) : diffs?.length === 0 ? (
              <div className="p-4 text-center text-[11px] text-muted-foreground italic">
                No files changed
              </div>
            ) : (
              diffs?.map((file) => (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file.path)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-[11px] transition-all",
                    selectedFile === file.path 
                      ? "bg-secondary/80 text-foreground font-medium shadow-sm" 
                      : "text-muted-foreground hover:bg-secondary/30 hover:text-foreground cursor-pointer"
                  )}
                >
                  <span className="truncate flex-1">{file.path.split('/').pop()}</span>
                  <div className="flex gap-1.5 font-mono text-[9px] ml-1">
                    <span className="text-emerald-500">+{file.additions}</span>
                    <span className="text-red-500">-{file.deletions}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Side: Diff View */}
        <div className="flex-1 flex flex-col overflow-hidden relative bg-white/5 backdrop-blur-sm">
          {!selectedFile ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 opacity-40">
               <VscFile size={48} className="text-muted-foreground/20" />
               <div className="text-center">
                 <p className="text-[14px] font-medium">No file selected</p>
                 <p className="text-[11px] text-muted-foreground">Select a file to view changes</p>
               </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
               <div className="px-3 py-2 border-b border-border/10 bg-muted/5 flex items-center gap-2">
                  <VscMarkdown className="size-3.5 text-muted-foreground/60" />
                  <span className="text-[11px] font-medium text-muted-foreground truncate italic">
                    {selectedFile}
                  </span>
               </div>
               <div className="flex-1 overflow-auto bg-black text-[#e6edf3] dark:bg-black">
                  {!currentFileDiff && !loading ? (
                    <div className="p-20 text-center text-muted-foreground/40 italic text-[13px]">
                      Diff unavailable
                    </div>
                  ) : (
                    <div className="min-w-max flex flex-col font-mono text-[12px] leading-[1.6]">
                      {currentFileDiff?.lines.map((line, idx) => {
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
                              !isAdd && !isDel && "hover:bg-white/5"
                            )}
                          >
                            {/* Line numbers gutter */}
                            <div className="flex shrink-0 select-none border-r border-white/5 bg-black/40">
                              <div className={cn(
                                "w-10 px-2 text-right text-[10px] tabular-nums transition-opacity",
                                isDel ? "bg-[#f8514944] text-red-300 opacity-100" : "text-muted-foreground opacity-30 group-hover:opacity-60"
                              )}>
                                {line.oldLineNumber ?? ""}
                              </div>
                              <div className={cn(
                                "w-10 px-2 text-right text-[10px] tabular-nums transition-opacity border-l border-white/5",
                                isAdd ? "bg-[#2ea04344] text-emerald-300 opacity-100" : "text-muted-foreground opacity-30 group-hover:opacity-60"
                              )}>
                                {line.newLineNumber ?? ""}
                              </div>
                            </div>

                            {/* Diff sign gutter */}
                            <div className={cn(
                              "w-6 shrink-0 flex items-center justify-center select-none text-[13px] font-bold",
                              isAdd && "text-[#7ee787]",
                              isDel && "text-[#ffa198]",
                              !isAdd && !isDel && "text-muted-foreground/30"
                            )}>
                              {isAdd ? "+" : isDel ? "-" : " "}
                            </div>

                            {/* Content */}
                            <div className={cn(
                              "flex-1 px-4 whitespace-pre font-medium",
                              isAdd && "text-[#e6ffec]",
                              isDel && "text-[#fff0f0]",
                            )}>
                              {line.content}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
