import { execSync, execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { getDb } from "../db/connection.js"
import { nowIso } from "../db/helpers.js"

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

  const repoRoot = projectRepoRoot(input.projectId)
  execFileSync("git", ["remote", "add", input.remoteName, input.remoteUrl], {
    cwd: repoRoot,
    timeout: 10000,
  })

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
  const repoRoot = projectRepoRoot(input.projectId)
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

export function gitRemoteRemove(input: {
  projectId: string
  remoteName: string
}) {
  const repoRoot = projectRepoRoot(input.projectId)
  execFileSync("git", ["remote", "remove", input.remoteName], {
    cwd: repoRoot,
    timeout: 10000,
  })

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

export function gitContext(input: { projectId: string; topicId?: string }) {
  const repoRoot = projectRepoRoot(input.projectId)
  const isGit = hasGitRepo(repoRoot)
  if (!isGit) {
    return {
      hasGit: false,
      currentBranch: null,
      uncommittedChanges: [],
      recentCommits: [],
      trackedBranches: [],
    }
  }

  const currentBranch = detectCurrentBranch(repoRoot)

  let uncommittedChanges: string[] = []
  try {
    const status = execSync("git status --porcelain", {
      cwd: repoRoot,
      timeout: 5000,
    })
      .toString()
      .trim()
    if (status) {
      uncommittedChanges = status.split("\n")
    }
  } catch {
    /* ignore */
  }

  let recentCommits: string[] = []
  try {
    const log = execSync("git log --oneline -10", {
      cwd: repoRoot,
      timeout: 5000,
    })
      .toString()
      .trim()
    if (log) {
      recentCommits = log.split("\n")
    }
  } catch {
    /* ignore */
  }

  let trackedBranches: Array<{
    branchName: string
    detectedAt: string
  }> = []
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
    uncommittedChanges,
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

  const repoRoot = projectRepoRoot(input.projectId)
  const createFlag = input.create ? "-c" : ""

  try {
    const args = input.create
      ? ["switch", "-c", input.branchName]
      : ["switch", input.branchName]
    execFileSync("git", args, { cwd: repoRoot, timeout: 10000 })
  } catch {
    const fallbackArgs = input.create
      ? ["checkout", "-b", input.branchName]
      : ["checkout", input.branchName]
    execFileSync("git", fallbackArgs, { cwd: repoRoot, timeout: 10000 })
  }

  const currentBranch = detectCurrentBranch(repoRoot)
  return { ok: true, branch: currentBranch }
}

export function gitBranches(input: { projectId: string }) {
  const repoRoot = projectRepoRoot(input.projectId)

  let local: string[] = []
  try {
    const raw = execFileSync("git", ["branch", "--format=%(refname:short)"], {
      cwd: repoRoot,
      timeout: 5000,
    })
      .toString()
      .trim()
    if (raw) {
      local = raw.split("\n").filter(Boolean)
    }
  } catch {
    /* ignore */
  }

  let remote: string[] = []
  try {
    const raw = execFileSync("git", ["branch", "-r", "--format=%(refname:short)"], {
      cwd: repoRoot,
      timeout: 5000,
    })
      .toString()
      .trim()
    if (raw) {
      remote = raw.split("\n").filter(Boolean)
    }
  } catch {
    /* ignore */
  }

  const current = detectCurrentBranch(repoRoot)

  return { local, remote, current }
}
