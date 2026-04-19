import { execFileSync } from "node:child_process"

type FileState =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"

export type GitChangedFile = {
  path: string
  fileName: string
  dirPath: string
  state: FileState
  additions: number
  deletions: number
}

export type CommitFile = {
  path: string
  additions: number
  deletions: number
}

export type GitCommitEntry = {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
  additions: number
  deletions: number
  filesChanged: number
  files: CommitFile[]
}

export type AheadBehind = { ahead: number; behind: number }

export type GitSummary = {
  totalFiles: number
  totalAdditions: number
  totalDeletions: number
}

const STATUS_MAP: Record<string, FileState> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  "?": "untracked",
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, timeout: 10_000 })
    .toString()
    .replace(/\r/g, "")
    .replace(/\n+$/, "")
}

function splitPath(filePath: string) {
  const parts = filePath.split("/")
  return {
    fileName: parts.pop() ?? filePath,
    dirPath: parts.join("/"),
  }
}

export function parseChangedFiles(repoRoot: string): GitChangedFile[] {
  let statusLines: string[] = []
  try {
    const raw = git(["status", "--porcelain", "-u"], repoRoot)
    if (raw) statusLines = raw.split("\n")
  } catch {
    return []
  }

  const numstatMap = new Map<string, { add: number; del: number }>()
  try {
    const staged = git(["diff", "--cached", "--numstat"], repoRoot)
    const unstaged = git(["diff", "--numstat"], repoRoot)
    for (const line of [...staged.split("\n"), ...unstaged.split("\n")]) {
      if (!line) continue
      const [add, del, file] = line.split("\t")
      if (!file) continue
      const prev = numstatMap.get(file) ?? { add: 0, del: 0 }
      prev.add += add === "-" ? 0 : Number(add)
      prev.del += del === "-" ? 0 : Number(del)
      numstatMap.set(file, prev)
    }
  } catch {
    /* numstat unavailable */
  }

  const files: GitChangedFile[] = []
  const seen = new Set<string>()

  for (const line of statusLines) {
    if (line.length < 4) continue
    const xy = line.substring(0, 2)
    let filePath = line.substring(3)

    const renameIdx = filePath.indexOf(" -> ")
    if (renameIdx !== -1) filePath = filePath.substring(renameIdx + 4)

    if (seen.has(filePath)) continue
    seen.add(filePath)

    const code = xy[0] !== " " && xy[0] !== "?" ? xy[0] : xy[1]
    const state = STATUS_MAP[code] ?? "modified"
    const stats = numstatMap.get(filePath) ?? { add: 0, del: 0 }
    const { fileName, dirPath } = splitPath(filePath)

    files.push({
      path: filePath,
      fileName,
      dirPath,
      state,
      additions: stats.add,
      deletions: stats.del,
    })
  }

  return files
}

const COMMIT_SEP = "---COMMIT---"

export function parseRecentCommits(
  repoRoot: string,
  count = 10,
): GitCommitEntry[] {
  let raw: string
  try {
    raw = git(
      [
        "log",
        `--format=${COMMIT_SEP}%H|%h|%s|%aN|%ar`,
        "--numstat",
        `-${count}`,
      ],
      repoRoot,
    )
  } catch {
    return []
  }
  if (!raw) return []

  const chunks = raw.split(COMMIT_SEP).filter(Boolean)
  const commits: GitCommitEntry[] = []

  for (const chunk of chunks) {
    const lines = chunk.split("\n")
    const header = lines[0]
    if (!header) continue

    const [hash, shortHash, message, author, date] = header.split("|")
    let additions = 0
    let deletions = 0
    const files: CommitFile[] = []

    for (const line of lines.slice(1)) {
      if (!line || !line.includes("\t")) continue
      const [add, del, p] = line.split("\t")
      if (!p) continue
      const a = add === "-" ? 0 : Number(add)
      const d = del === "-" ? 0 : Number(del)
      additions += a
      deletions += d
      files.push({ path: p, additions: a, deletions: d })
    }

    commits.push({
      hash,
      shortHash,
      message,
      author,
      date,
      additions,
      deletions,
      filesChanged: files.length,
      files,
    })
  }

  return commits
}

export function getAheadBehind(repoRoot: string): AheadBehind {
  try {
    const raw = git(
      ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      repoRoot,
    )
    const [ahead, behind] = raw.split("\t").map(Number)
    return { ahead: ahead || 0, behind: behind || 0 }
  } catch {
    return { ahead: 0, behind: 0 }
  }
}

export function buildSummary(files: GitChangedFile[]): GitSummary {
  let totalAdditions = 0
  let totalDeletions = 0
  for (const f of files) {
    totalAdditions += f.additions
    totalDeletions += f.deletions
  }
  return { totalFiles: files.length, totalAdditions, totalDeletions }
}
