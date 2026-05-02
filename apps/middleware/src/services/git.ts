import { execFileSync } from "node:child_process"
import type { Store, Project } from "./store.js"
import { HttpError } from "../lib/http-error.js"

function repo(project: Project) { return project.repoRoot || project.workspaceRoot }
function git(cwd: string, args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10000 }).trim() }
function tryGit(cwd: string, args: string[]) { try { return git(cwd, args) } catch { return null } }

function fileState(status: string) {
  if (status.includes("A")) return "added"
  if (status.includes("D")) return "deleted"
  if (status.includes("R")) return "renamed"
  if (status.includes("C")) return "copied"
  if (status.includes("?")) return "untracked"
  if (status.includes("M")) return "modified"
  return "unknown"
}

function parsePorcelain(text: string) {
  return text.split("\n").filter(Boolean).map(line => {
    const match = line.match(/^(.{1,2})\s+(.+)$/)
    const status = match?.[1]?.trim() || "modified"
    const rawPath = match?.[2]?.trim() || line.trim()
    const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop()!.trim() : rawPath
    return { path, state: fileState(status), status }
  })
}

function parseNumstat(text: string) {
  const stats = new Map<string, { additions: number; deletions: number }>()
  for (const line of text.split("\n").filter(Boolean)) {
    const [additionsRaw, deletionsRaw, filePath] = line.split("\t")
    if (!filePath) continue
    stats.set(filePath, {
      additions: additionsRaw === "-" ? 0 : Number(additionsRaw || 0),
      deletions: deletionsRaw === "-" ? 0 : Number(deletionsRaw || 0),
    })
  }
  return stats
}

function changedFiles(cwd: string) {
  const files = parsePorcelain(tryGit(cwd, ["status", "--porcelain", "-u"]) ?? "")
  const stats = parseNumstat([
    tryGit(cwd, ["diff", "--numstat"]),
    tryGit(cwd, ["diff", "--cached", "--numstat"]),
  ].filter(Boolean).join("\n"))
  return files.map(file => ({ ...file, ...(stats.get(file.path) ?? { additions: 0, deletions: 0 }) }))
}

function recentCommits(cwd: string) {
  const raw = tryGit(cwd, ["log", "-10", "--pretty=format:%H%x1f%s%x1f%cr"])
  if (!raw) return []
  return raw.split("\n").filter(Boolean).map(line => {
    const [hash = "", message = "", date = ""] = line.split("\x1f")
    return { hash, shortHash: hash.slice(0, 7), message, date, additions: 0, deletions: 0 }
  })
}

function aheadBehind(cwd: string) {
  const raw = tryGit(cwd, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
  const [ahead = "0", behind = "0"] = (raw ?? "0 0").split(/\s+/)
  return { ahead: Number(ahead || 0), behind: Number(behind || 0) }
}

export function gitRoutes(store: Store) {
  function get(projectId: string) { const p = store.getProject(projectId); if (!p) throw new HttpError(404, "Project not found", "NOT_FOUND"); return p }
  return {
    status: (projectId: string) => {
      const p = get(projectId)
      const cwd = repo(p)
      const repoRoot = tryGit(cwd, ["rev-parse", "--show-toplevel"])
      if (!repoRoot) {
        return {
          projectId,
          repoRoot: cwd,
          hasGit: false,
          mode: "local",
          source: "local-fs",
          branch: null,
          currentBranch: null,
          upstream: null,
          remoteUrl: null,
          ahead: 0,
          behind: 0,
          clean: true,
          dirty: false,
          changedFiles: [],
          files: [],
          recentCommits: [],
          summary: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0 },
          error: "Not a git repository",
        }
      }
      const branch = tryGit(cwd, ["branch", "--show-current"]) || tryGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
      const upstream = tryGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
      const remoteName = upstream?.split("/")[0] || "origin"
      const remoteUrl = tryGit(cwd, ["remote", "get-url", remoteName])
      const files = changedFiles(cwd)
      const totals = files.reduce((acc, file) => {
        acc.totalAdditions += file.additions ?? 0
        acc.totalDeletions += file.deletions ?? 0
        return acc
      }, { totalFiles: files.length, totalAdditions: 0, totalDeletions: 0 })
      return {
        projectId,
        repoRoot,
        hasGit: true,
        mode: "local",
        source: "local-fs",
        branch,
        currentBranch: branch,
        upstream,
        remoteUrl,
        ...aheadBehind(cwd),
        clean: files.length === 0,
        dirty: files.length > 0,
        changedFiles: files,
        files,
        recentCommits: recentCommits(cwd),
        summary: totals,
      }
    },
    diff: (projectId: string, filePath: string) => {
      const p = get(projectId); const cwd = repo(p)
      const repoRoot = tryGit(cwd, ["rev-parse", "--show-toplevel"])
      if (!repoRoot) return { mode: "local", source: "local-fs", repoRoot: cwd, path: filePath, state: "unknown", oldContent: null, newContent: null, patch: null, additions: 0, deletions: 0, error: "Not a git repository", checkedAt: new Date().toISOString() }
      const patch = [tryGit(cwd, ["diff", "--cached", "--", filePath]), tryGit(cwd, ["diff", "--", filePath])].filter(Boolean).join("\n") || null
      const state = changedFiles(cwd).find(file => file.path === filePath)?.state ?? "modified"
      const stats = parseNumstat([tryGit(cwd, ["diff", "--numstat", "--", filePath]), tryGit(cwd, ["diff", "--cached", "--numstat", "--", filePath])].filter(Boolean).join("\n")).get(filePath) ?? { additions: 0, deletions: 0 }
      return { mode: "local", source: "local-fs", repoRoot, path: filePath, state, oldContent: null, newContent: null, patch, ...stats, checkedAt: new Date().toISOString() }
    },
    branches: (projectId: string) => {
      const p = get(projectId); const cwd = repo(p)
      const local = (tryGit(cwd, ["branch", "--format", "%(refname:short)"]) ?? "").split("\n").filter(Boolean)
      const remote = (tryGit(cwd, ["branch", "-r", "--format", "%(refname:short)"]) ?? "").split("\n").filter(Boolean)
      const current = tryGit(cwd, ["branch", "--show-current"])
      return { local, remote, current, branches: local }
    },
    checkout: (projectId: string, branch: string) => { const p = get(projectId); git(repo(p), ["checkout", branch]); return { ok: true, branch } },
  }
}
