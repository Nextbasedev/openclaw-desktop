export type FileState = "modified" | "added" | "deleted" | "renamed" | "untracked"

export interface GitFile {
  path: string
  state: FileState
}

export interface GitContextResponse {
  hasGit: boolean
  currentBranch: string | null
  uncommittedChanges: string[]
  recentCommits: string[]
  trackedBranches: Array<{ branchName: string; detectedAt: string }>
}

export interface BranchesResponse {
  local: string[]
  remote: string[]
  current: string | null
}

export const STATE_CONFIG: Record<FileState, { letter: string; color: string }> = {
  modified: { letter: "M", color: "text-amber-400 bg-amber-400/10" },
  added: { letter: "A", color: "text-emerald-400 bg-emerald-400/10" },
  deleted: { letter: "D", color: "text-red-400 bg-red-400/10" },
  renamed: { letter: "R", color: "text-blue-400 bg-blue-400/10" },
  untracked: { letter: "?", color: "text-purple-400 bg-purple-400/10" },
}

export function parseStatusLine(line: string): GitFile | null {
  if (line.length < 4) return null
  const xy = line.substring(0, 2)
  const filePath = line.substring(3)
  let state: FileState = "modified"
  if (xy.includes("A")) state = "added"
  else if (xy.includes("D")) state = "deleted"
  else if (xy.includes("R")) state = "renamed"
  else if (xy === "??") state = "untracked"
  return { path: filePath, state }
}

export function parseCommitLine(line: string) {
  const spaceIdx = line.indexOf(" ")
  if (spaceIdx === -1) return { hash: line, message: "" }
  return { hash: line.substring(0, spaceIdx), message: line.substring(spaceIdx + 1) }
}
