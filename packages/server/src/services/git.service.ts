import { execSync, execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { getDb } from "../db/connection.js"
import { nowIso } from "../db/helpers.js"
import { parseChangedFiles, parseRecentCommits, getAheadBehind, buildSummary, gitHelper } from "./git-parsers.js"

function projectRepoRoot(projectId: string): string {
  const db = getDb()
  const row = db
    .prepare("SELECT repo_root, workspace_root FROM projects WHERE id = ?")
    .get(projectId) as
    | { repo_root: string | null; workspace_root: string }
    | undefined
  if (!row) throw new Error(`Project not found: ${projectId}`)
  return row.repo_root || row.workspace_root
}

function getEffectiveRepoRoot(projectId: string | null | undefined): string {
  let root = projectId ? projectRepoRoot(projectId) : process.cwd()
  if (!hasGitRepo(root)) {
    const fallback = findNearestGitRoot(process.cwd())
    if (fallback) root = fallback
  }
  return root
}

function detectCurrentBranch(repoRoot: string): string | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoRoot,
      timeout: 5000,
    })
      .toString()
      .trim()
    if (!branch || branch === "HEAD") return null
    return branch
  } catch {
    return null
  }
}

function hasGitRepo(repoRoot: string): boolean {
  try {
    const gitDir = path.join(repoRoot, ".git")
    return fs.existsSync(gitDir)
  } catch {
    return false
  }
}

function findNearestGitRoot(startDir: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      timeout: 5000,
    })
      .toString()
      .trim()
  } catch {
    return null
  }
}

function parseRemoteOutput(
  raw: string,
): Array<{ name: string; url: string; type: string }> {
  if (!raw) return []
  const lines = raw.split("\n").filter(Boolean)
  const remotes: Array<{ name: string; url: string; type: string }> = []
  for (const line of lines) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)$/)
    if (match) {
      remotes.push({ name: match[1], url: match[2], type: match[3] })
    }
  }
  return remotes
}

export function gitRemoteAdd(input: {
  projectId: string
  remoteName: string
  remoteUrl: string
}) {
  if (input.remoteName.startsWith("-")) {
    throw new Error("Remote name must not start with '-'")
  }
  const validPrefixes = ["https://", "git://", "ssh://", "git@"]
  const urlOk = validPrefixes.some((p) => input.remoteUrl.startsWith(p))
  if (!urlOk) {
    throw new Error(
      `Invalid remote URL. Must start with one of: ${validPrefixes.join(", ")}`,
    )
  }

  const repoRoot = getEffectiveRepoRoot(input.projectId)
  gitHelper(["remote", "add", input.remoteName, input.remoteUrl], repoRoot)

  const db = getDb()
  const remotesRaw = execSync("git remote -v", {
    cwd: repoRoot,
    timeout: 5000,
  })
    .toString()
    .trim()
  db.prepare(
    "UPDATE projects SET remotes_json = ?, updated_at = ? WHERE id = ?",
  ).run(JSON.stringify(parseRemoteOutput(remotesRaw)), nowIso(), input.projectId)

  return {
    ok: true,
    remoteName: input.remoteName,
    remoteUrl: input.remoteUrl,
  }
}

export function gitRemoteList(input: { projectId: string }) {
  const repoRoot = getEffectiveRepoRoot(input.projectId)
  try {
    const raw = execSync("git remote -v", {
      cwd: repoRoot,
      timeout: 5000,
    })
      .toString()
      .trim()
    return { remotes: parseRemoteOutput(raw) }
  } catch {
    return { remotes: [] }
  }
}

export function gitRemoteRemove(input: {
  projectId: string
  remoteName: string
}) {
  const repoRoot = getEffectiveRepoRoot(input.projectId)
  gitHelper(["remote", "remove", input.remoteName], repoRoot)

  const db = getDb()
  const remotesRaw = execSync("git remote -v", {
    cwd: repoRoot,
    timeout: 5000,
  })
    .toString()
    .trim()
  db.prepare(
    "UPDATE projects SET remotes_json = ?, updated_at = ? WHERE id = ?",
  ).run(JSON.stringify(parseRemoteOutput(remotesRaw)), nowIso(), input.projectId)

  return { ok: true, remoteName: input.remoteName }
}

export function gitContext(input: { projectId?: string; topicId?: string }) {
  const repoRoot = getEffectiveRepoRoot(input.projectId)
  const isGit = hasGitRepo(repoRoot)

  if (!isGit) {
    return {
      hasGit: false,
      currentBranch: null,
      aheadBehind: { ahead: 0, behind: 0 },
      summary: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0 },
      changedFiles: [],
      recentCommits: [],
      trackedBranches: [],
    }
  }

  const currentBranch = detectCurrentBranch(repoRoot)
  const aheadBehind = getAheadBehind(repoRoot)
  const changedFiles = parseChangedFiles(repoRoot)
  const summary = buildSummary(changedFiles)
  const recentCommits = parseRecentCommits(repoRoot, 10)

  let trackedBranches: Array<{ branchName: string; detectedAt: string }> = []
  if (input.topicId) {
    const db = getDb()
    const rows = db
      .prepare(
        "SELECT branch_name, detected_at FROM topic_git_context WHERE topic_id = ? AND project_id = ?",
      )
      .all(input.topicId, input.projectId) as Array<{
      branch_name: string
      detected_at: string
    }>
    trackedBranches = rows.map((r) => ({
      branchName: r.branch_name,
      detectedAt: r.detected_at,
    }))
  }

  return {
    hasGit: true,
    currentBranch,
    aheadBehind,
    summary,
    changedFiles,
    recentCommits,
    trackedBranches,
  }
}

export function gitSwitchBranch(input: {
  projectId: string
  branchName: string
  create?: boolean
}) {
  if (input.branchName.startsWith("-")) {
    throw new Error("Branch name must not start with '-'")
  }

  const repoRoot = getEffectiveRepoRoot(input.projectId)

  try {
    const args = input.create
      ? ["switch", "-c", input.branchName]
      : ["switch", input.branchName]
    gitHelper(args, repoRoot)
  } catch {
    const fallbackArgs = input.create
      ? ["checkout", "-b", input.branchName]
      : ["checkout", input.branchName]
    gitHelper(fallbackArgs, repoRoot)
  }

  const currentBranch = detectCurrentBranch(repoRoot)
  return { ok: true, branch: currentBranch }
}

export function gitBranches(input: { projectId: string }) {
  const repoRoot = getEffectiveRepoRoot(input.projectId)

  let local: string[] = []
  try {
    const raw = gitHelper(["branch", "--format=%(refname:short)"], repoRoot)
    if (raw) {
      local = raw.split("\n").filter(Boolean)
    }
  } catch {
    /* ignore */
  }

  let remote: string[] = []
  try {
    const raw = gitHelper(["branch", "-r", "--format=%(refname:short)"], repoRoot)
    if (raw) {
      remote = raw.split("\n").filter(Boolean)
    }
  } catch {
    /* ignore */
  }

  const current = detectCurrentBranch(repoRoot)

  return { local, remote, current }
}

export function gitCommitDetails(input: { projectId: string; hash: string }) {
  const repoRoot = getEffectiveRepoRoot(input.projectId)
  try {
    const hash = String(input.hash).trim()
    const diff = gitHelper(["show", "--pretty=format:", hash], repoRoot)
    return { ok: true, diff }
  } catch (err) {
    throw new Error(`Failed to get commit diff: ${err instanceof Error ? err.message : String(err)}`)
  }
}
