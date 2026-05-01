import crypto from "node:crypto"
import { execSync, execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { getDb } from "../db/connection.js"
import { nowIso } from "../db/helpers.js"
import { connectToOpenClawGateway } from "middleware"
import { ensureGatewayClient } from "../gateway/client.js"
import { getProfileToken } from "../auth/secrets.js"
import { parseChangedFiles, parseRecentCommits, getAheadBehind, buildSummary, gitHelper } from "./git-parsers.js"

type ProjectEnvironment = {
  projectId: string
  profileId: string
  profileMode: string
  gatewayUrl: string | null
  workspaceRoot: string
  repoRoot: string | null
}

type NormalizedGitStatus = {
  mode: "local" | "remote"
  source: "local-fs" | "openclaw-gateway"
  repoRoot: string | null
  hasGit: boolean
  branch: string | null
  upstream: string | null
  remoteUrl: string | null
  ahead: number
  behind: number
  clean: boolean
  changedFiles: ReturnType<typeof parseChangedFiles>
  recentCommits: ReturnType<typeof parseRecentCommits>
  checkedAt: string
  error?: string
}

type GitDiffResult = {
  mode: "local" | "remote"
  source: "local-fs" | "openclaw-gateway"
  repoRoot: string | null
  path: string | null
  state: "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "unknown"
  oldContent: string | null
  newContent: string | null
  patch: string | null
  additions: number
  deletions: number
  checkedAt: string
  error?: string
}

const GATEWAY_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.admin",
] as const

const GIT_PROBE_CLIENT = {
  id: "openclaw-control-ui",
  displayName: "Jarvis Git Probe",
  version: "0.0.1",
  platform: "desktop",
  mode: "webchat",
}

function projectEnvironment(projectId: string): ProjectEnvironment {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT p.id, p.profile_id, p.workspace_root, p.repo_root,
              pr.mode, pr.gateway_url
       FROM projects p
       LEFT JOIN profiles pr ON pr.id = p.profile_id
       WHERE p.id = ?`,
    )
    .get(projectId) as
    | {
        id: string
        profile_id: string
        workspace_root: string
        repo_root: string | null
        mode: string | null
        gateway_url: string | null
      }
    | undefined
  if (!row) throw new Error(`Project not found: ${projectId}`)
  return {
    projectId: row.id,
    profileId: row.profile_id,
    profileMode: row.mode ?? "local",
    gatewayUrl: row.gateway_url,
    workspaceRoot: row.workspace_root,
    repoRoot: row.repo_root,
  }
}

function isLocalGatewayUrl(gatewayUrl: string | null): boolean {
  if (!gatewayUrl) return true
  try {
    const url = new URL(gatewayUrl.replace("ws://", "http://").replace("wss://", "https://"))
    return ["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(url.hostname)
  } catch {
    return false
  }
}

function isRemoteEnvironment(env: ProjectEnvironment): boolean {
  const mode = env.profileMode.toLowerCase()
  if (mode === "remote") return true
  // The UI currently does not expose an explicit local/remote profile mode.
  // Treat a non-local Gateway URL as remote even when older/default profile rows
  // still say "local", otherwise users who paste a remote Gateway URL still see
  // local git state by mistake.
  if (!isLocalGatewayUrl(env.gatewayUrl)) return true
  if (mode === "local") return false
  return false
}

async function connectProjectGateway(env: ProjectEnvironment) {
  const token = getProfileToken(env.profileId) ?? undefined
  if (env.gatewayUrl || token) {
    return connectToOpenClawGateway({
      scopes: GATEWAY_SCOPES,
      client: GIT_PROBE_CLIENT,
      gatewayUrl: env.gatewayUrl ?? undefined,
      token,
    })
  }
  return ensureGatewayClient()
}

function projectRepoRoot(projectId: string): string {
  const env = projectEnvironment(projectId)
  return env.repoRoot || env.workspaceRoot
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

function detectUpstream(repoRoot: string): string | null {
  try {
    const raw = gitHelper(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repoRoot)
    return raw || null
  } catch {
    return null
  }
}

function remoteNameFromUpstream(upstream: string | null): string | null {
  if (!upstream) return null
  const idx = upstream.indexOf("/")
  if (idx <= 0) return null
  return upstream.slice(0, idx)
}

function detectRemoteUrl(repoRoot: string, upstream: string | null): string | null {
  const remoteName = remoteNameFromUpstream(upstream) ?? "origin"
  try {
    const raw = gitHelper(["remote", "get-url", remoteName], repoRoot)
    return raw || null
  } catch {
    return null
  }
}

function localGitStatusForRoot(repoRoot: string): NormalizedGitStatus {
  const checkedAt = nowIso()
  if (!hasGitRepo(repoRoot)) {
    return {
      mode: "local",
      source: "local-fs",
      repoRoot,
      hasGit: false,
      branch: null,
      upstream: null,
      remoteUrl: null,
      ahead: 0,
      behind: 0,
      clean: true,
      changedFiles: [],
      recentCommits: [],
      checkedAt,
    }
  }

  const changedFiles = parseChangedFiles(repoRoot)
  const upstream = detectUpstream(repoRoot)
  const aheadBehind = getAheadBehind(repoRoot)

  return {
    mode: "local",
    source: "local-fs",
    repoRoot,
    hasGit: true,
    branch: detectCurrentBranch(repoRoot),
    upstream,
    remoteUrl: detectRemoteUrl(repoRoot, upstream),
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    clean: changedFiles.length === 0,
    changedFiles,
    recentCommits: parseRecentCommits(repoRoot, 10),
    checkedAt,
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? text).trim()
  const first = candidate.indexOf("{")
  const last = candidate.lastIndexOf("}")
  if (first === -1 || last === -1 || last <= first) return null
  try {
    return JSON.parse(candidate.slice(first, last + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return ""
      const b = block as Record<string, unknown>
      if (typeof b.text === "string") return b.text
      if (typeof b.content === "string") return b.content
      if (Array.isArray(b.content)) return contentToText(b.content)
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function latestParseableJson(messages: Array<{ role?: string; content?: unknown; text?: string }>): Record<string, unknown> | null {
  for (const message of [...messages].reverse()) {
    const text = typeof message.text === "string" ? message.text : contentToText(message.content)
    const parsed = extractJsonObject(text)
    if (parsed) return parsed
  }
  return null
}

function normalizeRemoteGitStatus(raw: Record<string, unknown>, env: ProjectEnvironment): NormalizedGitStatus {
  const files = Array.isArray(raw.changedFiles) ? raw.changedFiles : []
  const changedFiles = files.map((file) => {
    const f = file as Record<string, unknown>
    const p = typeof f.path === "string" ? f.path : ""
    const parts = p.split("/")
    return {
      path: p,
      fileName: typeof f.fileName === "string" ? f.fileName : (parts.pop() ?? p),
      dirPath: typeof f.dirPath === "string" ? f.dirPath : parts.join("/"),
      state: ["modified", "added", "deleted", "renamed", "copied", "untracked"].includes(String(f.state))
        ? (f.state as ReturnType<typeof parseChangedFiles>[number]["state"])
        : "modified",
      additions: Number(f.additions ?? 0) || 0,
      deletions: Number(f.deletions ?? 0) || 0,
    }
  }).filter((file) => file.path)

  return {
    mode: "remote",
    source: "openclaw-gateway",
    repoRoot: typeof raw.repoRoot === "string" ? raw.repoRoot : (env.repoRoot || env.workspaceRoot || null),
    hasGit: Boolean(raw.hasGit),
    branch: typeof raw.branch === "string" ? raw.branch : null,
    upstream: typeof raw.upstream === "string" ? raw.upstream : null,
    remoteUrl: typeof raw.remoteUrl === "string" ? raw.remoteUrl : null,
    ahead: Number(raw.ahead ?? 0) || 0,
    behind: Number(raw.behind ?? 0) || 0,
    clean: typeof raw.clean === "boolean" ? raw.clean : changedFiles.length === 0,
    changedFiles,
    recentCommits: [],
    checkedAt: nowIso(),
    error: typeof raw.error === "string" ? raw.error : undefined,
  }
}

function validateGitFilePath(filePath: string): string {
  const trimmed = filePath.trim()
  if (!trimmed) throw new Error("path is required")
  if (trimmed.includes("\0")) throw new Error("path must not contain null bytes")
  if (path.isAbsolute(trimmed)) throw new Error("path must be relative")
  if (trimmed.split(/[\\/]+/).includes("..")) throw new Error("path must not contain '..'")
  if (trimmed.startsWith("-")) throw new Error("path must not start with '-'")
  return trimmed.replace(/\\/g, "/")
}

function fileStateFromStatus(repoRoot: string, filePath: string): GitDiffResult["state"] {
  const file = parseChangedFiles(repoRoot).find((f) => f.path === filePath)
  return file?.state ?? "unknown"
}

function numstatForPath(repoRoot: string, filePath: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const args of [["diff", "--numstat", "--", filePath], ["diff", "--cached", "--numstat", "--", filePath]]) {
    try {
      const raw = gitHelper(args, repoRoot)
      for (const line of raw.split("\n")) {
        if (!line) continue
        const [add, del] = line.split("\t")
        additions += add === "-" ? 0 : Number(add) || 0
        deletions += del === "-" ? 0 : Number(del) || 0
      }
    } catch {
      // ignore
    }
  }
  return { additions, deletions }
}

function safeGitShow(repoRoot: string, filePath: string): string | null {
  try {
    return execFileSync("git", ["show", `HEAD:${filePath}`], {
      cwd: repoRoot,
      timeout: 10_000,
      maxBuffer: 5 * 1024 * 1024,
    }).toString()
  } catch {
    return null
  }
}

function safeReadWorkspaceFile(repoRoot: string, filePath: string): string | null {
  const resolved = path.resolve(repoRoot, filePath)
  if (!resolved.startsWith(path.resolve(repoRoot) + path.sep) && resolved !== path.resolve(repoRoot)) {
    throw new Error("path escapes repo root")
  }
  try {
    return fs.readFileSync(resolved, "utf8")
  } catch {
    return null
  }
}

function localGitDiffForRoot(repoRoot: string, filePath: string): GitDiffResult {
  const relPath = validateGitFilePath(filePath)
  if (!hasGitRepo(repoRoot)) {
    return {
      mode: "local",
      source: "local-fs",
      repoRoot,
      path: relPath,
      state: "unknown",
      oldContent: null,
      newContent: null,
      patch: null,
      additions: 0,
      deletions: 0,
      checkedAt: nowIso(),
      error: "Not a git repository",
    }
  }

  const state = fileStateFromStatus(repoRoot, relPath)
  const stats = numstatForPath(repoRoot, relPath)
  let patch: string | null = null
  try {
    const unstaged = gitHelper(["diff", "--", relPath], repoRoot)
    const staged = gitHelper(["diff", "--cached", "--", relPath], repoRoot)
    patch = [staged, unstaged].filter(Boolean).join("\n") || null
  } catch {
    patch = null
  }

  return {
    mode: "local",
    source: "local-fs",
    repoRoot,
    path: relPath,
    state,
    oldContent: state === "untracked" ? null : safeGitShow(repoRoot, relPath),
    newContent: state === "deleted" ? null : safeReadWorkspaceFile(repoRoot, relPath),
    patch,
    additions: stats.additions,
    deletions: stats.deletions,
    checkedAt: nowIso(),
  }
}

function normalizeRemoteGitDiff(raw: Record<string, unknown>, env: ProjectEnvironment, filePath: string): GitDiffResult {
  const state = ["modified", "added", "deleted", "renamed", "copied", "untracked", "unknown"].includes(String(raw.state))
    ? raw.state as GitDiffResult["state"]
    : "unknown"
  return {
    mode: "remote",
    source: "openclaw-gateway",
    repoRoot: typeof raw.repoRoot === "string" ? raw.repoRoot : (env.repoRoot || env.workspaceRoot || null),
    path: typeof raw.path === "string" ? raw.path : filePath,
    state,
    oldContent: typeof raw.oldContent === "string" ? raw.oldContent : null,
    newContent: typeof raw.newContent === "string" ? raw.newContent : null,
    patch: typeof raw.patch === "string" ? raw.patch : null,
    additions: Number(raw.additions ?? 0) || 0,
    deletions: Number(raw.deletions ?? 0) || 0,
    checkedAt: nowIso(),
    error: typeof raw.error === "string" ? raw.error : undefined,
  }
}

async function remoteGitStatus(env: ProjectEnvironment): Promise<NormalizedGitStatus> {
  const gw = await connectProjectGateway(env)
  const sessionKey = `jarvis:git-status:${env.projectId}:${crypto.randomUUID()}`
  const cwd = env.repoRoot || env.workspaceRoot || "."
  const prompt = `You are a deterministic git status probe for Jarvis Desktop. Do not modify files. Use the exec/shell tool only if needed. Work in this cwd: ${cwd}\n\nRun git status checks for that cwd and return ONLY one JSON object with this exact shape, no markdown:\n{\"hasGit\":boolean,\"repoRoot\":string|null,\"branch\":string|null,\"upstream\":string|null,\"remoteUrl\":string|null,\"ahead\":number,\"behind\":number,\"clean\":boolean,\"changedFiles\":[{\"path\":string,\"state\":\"modified\"|\"added\"|\"deleted\"|\"renamed\"|\"copied\"|\"untracked\",\"additions\":number,\"deletions\":number}]}\n\nUse commands equivalent to: git rev-parse --show-toplevel, git branch --show-current, git rev-parse --abbrev-ref --symbolic-full-name @{upstream}, git remote get-url <remote>, git rev-list --left-right --count HEAD...@{upstream}, git status --porcelain -u, git diff --numstat, git diff --cached --numstat. If cwd is not a git repo, return hasGit false and an error string.`

  let actualSessionKey = sessionKey
  try {
    const create = await gw.request<{ key?: string }>("sessions.create", {
      key: sessionKey,
      agentId: "main",
      label: `Jarvis Git Status Probe ${env.projectId.slice(-6)} ${sessionKey.slice(-8)}`,
    }, 15_000)
    if (!create.ok) throw new Error(create.error?.message ?? "sessions.create failed")
    actualSessionKey = create.payload?.key ?? sessionKey

    const send = await gw.request<{ runId?: string; status?: string }>("sessions.send", {
      key: actualSessionKey,
      message: prompt,
      timeoutMs: 90_000,
    }, 100_000)
    if (!send.ok) throw new Error(send.error?.message ?? "sessions.send failed")
    if (send.payload?.runId) {
      const waited = await gw.request("agent.wait", { runId: send.payload.runId }, 100_000)
      if (!waited.ok) throw new Error(waited.error?.message ?? "agent.wait failed")
    }

    const history = await gw.request<{ messages?: Array<{ role?: string; content?: unknown; text?: string }> }>("chat.history", {
      sessionKey: actualSessionKey,
      limit: 20,
    }, 15_000)
    if (!history.ok) throw new Error(history.error?.message ?? "chat.history failed")
    const parsed = latestParseableJson(history.payload?.messages ?? [])
    if (!parsed) throw new Error("Remote git probe did not return parseable JSON")
    return normalizeRemoteGitStatus(parsed, env)
  } catch (err) {
    return {
      mode: "remote",
      source: "openclaw-gateway",
      repoRoot: cwd,
      hasGit: false,
      branch: null,
      upstream: null,
      remoteUrl: null,
      ahead: 0,
      behind: 0,
      clean: true,
      changedFiles: [],
      recentCommits: [],
      checkedAt: nowIso(),
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    void gw.request("sessions.delete", { key: actualSessionKey, deleteTranscript: true }, 10_000).catch(() => {})
    if (env.gatewayUrl || getProfileToken(env.profileId)) gw.close()
  }
}

export async function gitStatus(input: { projectId: string }): Promise<NormalizedGitStatus> {
  const env = projectEnvironment(input.projectId)
  if (isRemoteEnvironment(env)) {
    return remoteGitStatus(env)
  }
  return localGitStatusForRoot(env.repoRoot || env.workspaceRoot)
}

async function remoteGitDiff(env: ProjectEnvironment, filePath: string): Promise<GitDiffResult> {
  const relPath = validateGitFilePath(filePath)
  const gw = await connectProjectGateway(env)
  const sessionKey = `jarvis:git-diff:${env.projectId}:${crypto.randomUUID()}`
  const cwd = env.repoRoot || env.workspaceRoot || "."
  const script = `const fs=require('fs'),cp=require('child_process'),p=require('path');const cwd=${JSON.stringify(cwd)},f=${JSON.stringify(relPath)};function g(a){try{return cp.execFileSync('git',a,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:5*1024*1024})}catch{return null}}const repo=(g(['rev-parse','--show-toplevel'])||'').trim();const st=(g(['status','--porcelain','-u','--',f])||'').split('\\n').filter(Boolean)[0]||'';const c=st.slice(0,2);const m={M:'modified',A:'added',D:'deleted',R:'renamed',C:'copied','?':'untracked'};const state=m[(c&&c[0]!==' '&&c[0]!=='?')?c[0]:(c[1]||'?')]||'unknown';const oldContent=state==='untracked'?null:g(['show','HEAD:'+f]);let newContent=null;try{const full=p.resolve(cwd,f);if(state!=='deleted'&&full.startsWith(p.resolve(cwd)+p.sep))newContent=fs.readFileSync(full,'utf8')}catch{}const patch=[g(['diff','--cached','--',f]),g(['diff','--',f])].filter(Boolean).join('\\n')||null;const ns=[g(['diff','--cached','--numstat','--',f]),g(['diff','--numstat','--',f])].filter(Boolean).join('\\n');let additions=0,deletions=0;for(const l of ns.split('\\n')){const x=l.split('\\t');if(x.length>=2){additions+=x[0]==='-'?0:Number(x[0]||0);deletions+=x[1]==='-'?0:Number(x[1]||0)}}console.log(JSON.stringify({repoRoot:repo||null,path:f,state,oldContent,newContent,patch,additions,deletions,error:repo?null:'Not a git repository'}));`
  const encoded = Buffer.from(script, "utf8").toString("base64")
  const command = `node -e "eval(Buffer.from('${encoded}','base64').toString())"`
  const prompt = `Run this exact read-only command in ${cwd} and return ONLY stdout, no markdown:\n${command}`

  let actualSessionKey = sessionKey
  try {
    const create = await gw.request<{ key?: string }>("sessions.create", {
      key: sessionKey,
      agentId: "main",
      label: `Jarvis Git Diff Probe ${env.projectId.slice(-6)} ${sessionKey.slice(-8)}`,
    }, 15_000)
    if (!create.ok) throw new Error(create.error?.message ?? "sessions.create failed")
    actualSessionKey = create.payload?.key ?? sessionKey

    const send = await gw.request<{ runId?: string; status?: string }>("sessions.send", {
      key: actualSessionKey,
      message: prompt,
      timeoutMs: 90_000,
    }, 100_000)
    if (!send.ok) throw new Error(send.error?.message ?? "sessions.send failed")
    if (send.payload?.runId) {
      const waited = await gw.request("agent.wait", { runId: send.payload.runId }, 100_000)
      if (!waited.ok) throw new Error(waited.error?.message ?? "agent.wait failed")
    }

    const history = await gw.request<{ messages?: Array<{ role?: string; content?: unknown; text?: string }> }>("chat.history", {
      sessionKey: actualSessionKey,
      limit: 20,
      maxChars: 500_000,
    }, 15_000)
    if (!history.ok) throw new Error(history.error?.message ?? "chat.history failed")
    const parsed = latestParseableJson(history.payload?.messages ?? [])
    if (!parsed) throw new Error("Remote git diff probe did not return parseable JSON")
    return normalizeRemoteGitDiff(parsed, env, relPath)
  } catch (err) {
    return {
      mode: "remote",
      source: "openclaw-gateway",
      repoRoot: cwd,
      path: relPath,
      state: "unknown",
      oldContent: null,
      newContent: null,
      patch: null,
      additions: 0,
      deletions: 0,
      checkedAt: nowIso(),
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    void gw.request("sessions.delete", { key: actualSessionKey, deleteTranscript: true }, 10_000).catch(() => {})
    if (env.gatewayUrl || getProfileToken(env.profileId)) gw.close()
  }
}

async function remoteGitPatchOnly(env: ProjectEnvironment, filePath: string, reason: string): Promise<GitDiffResult> {
  const relPath = validateGitFilePath(filePath)
  const gw = await connectProjectGateway(env)
  const sessionKey = `jarvis:git-patch:${env.projectId}:${crypto.randomUUID()}`
  const cwd = env.repoRoot || env.workspaceRoot || "."
  const script = `const cp=require('child_process');const cwd=${JSON.stringify(cwd)},f=${JSON.stringify(relPath)};function g(a){try{return cp.execFileSync('git',a,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:5*1024*1024})}catch{return null}}const patch=[g(['diff','--cached','--',f]),g(['diff','--',f])].filter(Boolean).join('\\n')||null;const st=(g(['status','--porcelain','-u','--',f])||'').split('\\n').filter(Boolean)[0]||'';const c=st.slice(0,2);const m={M:'modified',A:'added',D:'deleted',R:'renamed',C:'copied','?':'untracked'};const state=m[(c&&c[0]!==' '&&c[0]!=='?')?c[0]:(c[1]||'?')]||'unknown';console.log(JSON.stringify({path:f,state,patch,error:null}))`
  const encoded = Buffer.from(script, "utf8").toString("base64")
  let actualSessionKey = sessionKey
  try {
    const create = await gw.request<{ key?: string }>("sessions.create", {
      key: sessionKey,
      agentId: "main",
      label: `Jarvis Git Patch Probe ${env.projectId.slice(-6)} ${sessionKey.slice(-8)}`,
    }, 15_000)
    if (!create.ok) throw new Error(create.error?.message ?? "sessions.create failed")
    actualSessionKey = create.payload?.key ?? sessionKey
    const send = await gw.request<{ runId?: string }>("sessions.send", {
      key: actualSessionKey,
      message: `Run this exact read-only command in ${cwd} and return ONLY stdout, no markdown:\nnode -e "eval(Buffer.from('${encoded}','base64').toString())"`,
      timeoutMs: 90_000,
    }, 100_000)
    if (!send.ok) throw new Error(send.error?.message ?? "sessions.send failed")
    if (send.payload?.runId) await gw.request("agent.wait", { runId: send.payload.runId }, 100_000)
    const history = await gw.request<{ messages?: Array<{ role?: string; content?: unknown; text?: string }> }>("chat.history", {
      sessionKey: actualSessionKey,
      limit: 20,
      maxChars: 500_000,
    }, 15_000)
    const parsed = latestParseableJson(history.payload?.messages ?? [])
    return {
      mode: "remote",
      source: "openclaw-gateway",
      repoRoot: cwd,
      path: typeof parsed?.path === "string" ? parsed.path : relPath,
      state: ["modified", "added", "deleted", "renamed", "copied", "untracked", "unknown"].includes(String(parsed?.state)) ? parsed?.state as GitDiffResult["state"] : "unknown",
      oldContent: null,
      newContent: null,
      patch: typeof parsed?.patch === "string" ? parsed.patch : null,
      additions: 0,
      deletions: 0,
      checkedAt: nowIso(),
      error: parsed ? `content unavailable; patch fallback used after: ${reason}` : `patch fallback failed after: ${reason}`,
    }
  } finally {
    void gw.request("sessions.delete", { key: actualSessionKey, deleteTranscript: true }, 10_000).catch(() => {})
    if (env.gatewayUrl || getProfileToken(env.profileId)) gw.close()
  }
}

export async function gitDiff(input: { projectId: string; path: string }): Promise<GitDiffResult> {
  const env = projectEnvironment(input.projectId)
  if (isRemoteEnvironment(env)) {
    const full = await remoteGitDiff(env, input.path)
    if (!full.error) return full
    return remoteGitPatchOnly(env, input.path, full.error)
  }
  return localGitDiffForRoot(env.repoRoot || env.workspaceRoot, input.path)
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
