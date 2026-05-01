import { execFileSync } from "node:child_process"
import type { Store, Project } from "./store.js"
import { HttpError } from "../lib/http-error.js"

function repo(project: Project) { return project.repoRoot || project.workspaceRoot }
function git(cwd: string, args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10000 }).trim() }
function parsePorcelain(text: string) {
  return text.split("\n").filter(Boolean).map(line => {
    const match = line.match(/^(.{1,2})\s+(.+)$/)
    return {
      status: match?.[1]?.trim() || "modified",
      path: match?.[2]?.trim() || line.trim(),
    }
  })
}
export function gitRoutes(store: Store) {
  function get(projectId: string) { const p = store.getProject(projectId); if (!p) throw new HttpError(404, "Project not found", "NOT_FOUND"); return p }
  return {
    status: (projectId: string) => { const p = get(projectId); const cwd = repo(p); const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]); let upstream: string | null = null; try { upstream = git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) } catch {} const porcelain = git(cwd, ["status", "--porcelain"]); return { projectId, repoRoot: cwd, branch, upstream, dirty: Boolean(porcelain), files: parsePorcelain(porcelain) } },
    diff: (projectId: string, filePath: string) => { const p = get(projectId); const cwd = repo(p); const patch = git(cwd, ["diff", "--", filePath]); return { path: filePath, patch, additions: (patch.match(/^\+/gm) ?? []).length, deletions: (patch.match(/^-/gm) ?? []).length } },
    branches: (projectId: string) => { const p = get(projectId); return { branches: git(repo(p), ["branch", "--format", "%(refname:short)"]).split("\n").filter(Boolean) } },
    checkout: (projectId: string, branch: string) => { const p = get(projectId); git(repo(p), ["checkout", branch]); return { ok: true, branch } },
  }
}
