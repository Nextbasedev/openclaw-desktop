export type FileState = "modified" | "added" | "deleted" | "renamed" | "untracked"

export interface GitFile {
  path: string
  state: FileState
}

export interface DiffLine {
  type: "addition" | "deletion" | "normal" | "hunk"
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export interface FileDiff {
  path: string
  additions: number
  deletions: number
  lines: DiffLine[]
}

export interface GitContextResponse {
  hasGit: boolean
  currentBranch: string | null
  uncommittedChanges: string[]
  recentCommits: any[]
  trackedBranches: Array<{ branchName: string; detectedAt: string }>
  summary?: {
    totalFiles: number
    totalAdditions: number
    totalDeletions: number
  }
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
  if (typeof line !== "string" || line.length < 4) return null
  const xy = line.substring(0, 2)
  const filePath = line.substring(3)
  let state: FileState = "modified"
  if (xy.includes("A")) state = "added"
  else if (xy.includes("D")) state = "deleted"
  else if (xy.includes("R")) state = "renamed"
  else if (xy === "??") state = "untracked"
  return { path: filePath, state }
}

export function parseCommitLine(line: any) {
  if (typeof line === "object" && line !== null) {
    return {
      hash: String(line.hash || line.id || line.commit || "empty"),
      message: String(line.message || line.subject || line.text || ""),
      additions: Number(line.additions || 0),
      deletions: Number(line.deletions || 0),
      shortHash: String(line.shortHash || (line.hash && String(line.hash).substring(0, 7)) || ""),
      date: String(line.date || ""),
    }
  }
  if (typeof line !== "string") return { hash: String(line || "empty"), message: "", additions: 0, deletions: 0, shortHash: "", date: "" }
  const spaceIdx = line.indexOf(" ")
  if (spaceIdx === -1) return { hash: line, message: "", additions: 0, deletions: 0, shortHash: line.substring(0, 7), date: "" }
  return { 
    hash: line.substring(0, spaceIdx), 
    message: line.substring(spaceIdx + 1),
    additions: 0,
    deletions: 0,
    shortHash: line.substring(0, 7),
    date: ""
  }
}

export function parseGitShow(raw: string): FileDiff[] {
  if (!raw || !raw.trim()) return []
  
  const files: FileDiff[] = []
  const lines = raw.split("\n")
  let currentFile: FileDiff | null = null
  
  let oldLine = 0
  let newLine = 0

  for (let line of lines) {
    if (line.startsWith("diff --git")) {
      if (currentFile) files.push(currentFile)
      
      const parts = line.split(" ")
      let path = "unknown"
      if (parts.length >= 4) {
        path = parts[3].substring(2)
      }
      
      currentFile = {
        path,
        additions: 0,
        deletions: 0,
        lines: [],
      }
      oldLine = 0
      newLine = 0
      continue
    }

    if (!currentFile) continue

    if (line.startsWith("---") || line.startsWith("index ")) continue
    
    if (line.startsWith("+++")) {
      if (line.startsWith("+++ b/")) {
        currentFile.path = line.substring(6)
      }
      continue
    }

    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      currentFile.lines.push({ type: "hunk", content: line })
    } else if (line.startsWith("+")) {
      currentFile.additions++
      currentFile.lines.push({ 
        type: "addition", 
        content: line.substring(1),
        newLineNumber: newLine++
      })
    } else if (line.startsWith("-")) {
      currentFile.deletions++
      currentFile.lines.push({ 
        type: "deletion", 
        content: line.substring(1),
        oldLineNumber: oldLine++
      })
    } else {
      currentFile.lines.push({ 
        type: "normal", 
        content: line.startsWith(" ") ? line.substring(1) : line,
        oldLineNumber: oldLine++,
        newLineNumber: newLine++
      })
    }
  }

  if (currentFile) files.push(currentFile)
  return files
}
