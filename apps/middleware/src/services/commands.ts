import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import type { Store } from "./store.js"
import { HttpError } from "../lib/http-error.js"
import { connectGateway } from "./gateway.js"
import { terminalSpawnWorkspace } from "./terminal.js"

function now() { return new Date().toISOString() }
function state(store: Store): any {
  const s = (store as any).read()
  s.commandState ??= {}
  s.commandState.pins ??= {}
  s.commandState.feedback ??= []
  s.commandState.cronJobs ??= []
  s.commandState.cronRuns ??= []
  s.commandState.branches ??= []
  s.commandState.activeBranchSessions ??= {}
  s.commandState.skillsEnabled ??= {}
  return s
}
function save(store: Store, s: any) { (store as any).write(s) }
function ok(extra: Record<string, unknown> = {}) { return { ok: true, ...extra } }
function openclawConfigPath() { return path.join(os.homedir(), ".openclaw", "openclaw.json") }
function workspaceRoot() { return process.env.WORKSPACE_ROOT || path.join(os.homedir(), ".openclaw", "workspace") }
function readJson(file: string): any { try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return {} } }
function writeJson(file: string, value: unknown) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n") }
function unsupported(command: string): never { throw new HttpError(501, `${command} requires OpenClaw Gateway proxy implementation`, "NOT_IMPLEMENTED") }

function textFromContent(content: unknown) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((block: any) => typeof block?.text === "string" ? block.text : "").join("")
}

function stripBootstrapWarning(text: string) {
  return text.replace(/\n\n\[Bootstrap truncation warning\][\s\S]*$/, "").trim()
}

function friendlyAssistantError(message: any) {
  const raw = String(message?.errorMessage || "")
  const requestId = raw.match(/"request_id"\s*:\s*"([^"]+)"/)?.[1]
  if (message?.provider === "anthropic" && /OAuth authentication is currently not supported/i.test(raw)) {
    return `Claude Opus can’t run right now because Anthropic auth is invalid. Add a direct Anthropic API key or pick another model.${requestId ? ` Request: ${requestId}` : ""}`
  }
  const usageLimit = raw.match(/You have hit your ChatGPT usage limit \(([^)]+)\)\. Try again in ~([^\.]+)\./i)
  if (message?.provider === "openai-codex" && usageLimit) {
    return `GPT-5.5 hit the ChatGPT ${usageLimit[1]} usage limit. Try again in ~${usageLimit[2]} or switch models.`
  }
  return `Error: ${raw}`
}

function normalizeHistoryPayload(payload: any) {
  if (!payload || !Array.isArray(payload.messages)) return payload
  return {
    ...payload,
    messages: payload.messages.map((message: any) => {
      if (message?.role === "user") {
        const rawText = typeof message.text === "string" ? message.text : textFromContent(message.content)
        if (rawText.includes("[Bootstrap truncation warning]")) {
          const text = stripBootstrapWarning(rawText)
          if (text) return { ...message, text, content: [{ type: "text", text }] }
        }
        return message
      }
      if (message?.role !== "assistant" || message.stopReason !== "error" || !message.errorMessage) return message
      const hasVisibleText =
        typeof message.text === "string" && message.text.trim().length > 0 ||
        typeof message.content === "string" && message.content.trim().length > 0 ||
        Array.isArray(message.content) && message.content.some((block: any) => typeof block?.text === "string" && block.text.trim().length > 0)
      if (hasVisibleText) return message
      const text = friendlyAssistantError(message)
      return {
        ...message,
        text,
        content: [{ type: "text", text }],
      }
    }),
  }
}

function sessionsDirForKey(sessionKey: string) {
  const agentId = agentIdFromSessionKey(sessionKey)
  const safeAgentId = /^[A-Za-z0-9_-]+$/.test(agentId) ? agentId : "main"
  return path.join(os.homedir(), ".openclaw", "agents", safeAgentId, "sessions")
}

function sessionsStorePathForKey(sessionKey: string) {
  return path.join(sessionsDirForKey(sessionKey), "sessions.json")
}

function readSessionStoreEntry(sessionKey: string) {
  const storePath = sessionsStorePathForKey(sessionKey)
  const store = readJson(storePath)
  const entry = store?.[sessionKey]
  return entry && typeof entry === "object" ? { storePath, store, entry: { ...entry } } : null
}

function latestResetTranscript(sessionFile: string) {
  try {
    const dir = path.dirname(sessionFile)
    const prefix = `${path.basename(sessionFile)}.reset.`
    return fs.readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .map((name) => path.join(dir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null
  } catch {
    return null
  }
}

function readJsonl(file: string) {
  try {
    return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

function isIsolatedInjectedCommandTranscript(file: string) {
  const lines = readJsonl(file)
  if (lines.length !== 2 || lines[0]?.type !== "session") return null
  const message = lines[1]?.message
  if (lines[1]?.type !== "message" || message?.role !== "assistant") return null
  if (message?.provider !== "openclaw" || message?.model !== "gateway-injected") return null
  return lines[1]
}

function appendJsonl(file: string, entries: unknown[]) {
  fs.appendFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n")
}

function writeJsonl(file: string, entries: unknown[]) {
  fs.writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n")
}

function commandUserMessage(message: string, parentId: string | null, timestamp = Date.now()) {
  return {
    type: "message",
    id: crypto.randomUUID().slice(0, 8),
    parentId,
    timestamp: new Date(timestamp).toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text: message.trim() }],
      timestamp,
    },
  }
}

function restoreSlashCommandHistoryIfGatewayReset(params: { sessionKey: string; message: string; before: ReturnType<typeof readSessionStoreEntry> }) {
  if (!params.message.trim().startsWith("/") || !params.before) return null
  const current = readSessionStoreEntry(params.sessionKey)
  const previousEntry = params.before.entry as any
  const currentEntry = current?.entry as any
  const previousFile = String(previousEntry.sessionFile || "")
  const currentFile = String(currentEntry?.sessionFile || "")
  if (!previousFile || !currentFile || currentFile === previousFile) return null

  const injectedOutput = isIsolatedInjectedCommandTranscript(currentFile)
  if (!injectedOutput) return null
  const resetFile = latestResetTranscript(previousFile)
  if (!resetFile) return null

  fs.copyFileSync(resetFile, previousFile)
  const restoredLines = readJsonl(previousFile)
  const lastRestored = restoredLines.at(-1)
  const lastRestoredText = lastRestored?.message?.content?.[0]?.text
  const hasCommandAlready = lastRestored?.message?.role === "user" && lastRestoredText === params.message.trim()
  const userMessage = hasCommandAlready ? lastRestored : commandUserMessage(params.message, lastRestored?.id ?? null)
  const outputMessage = {
    ...injectedOutput,
    id: injectedOutput.id ?? crypto.randomUUID().slice(0, 8),
    parentId: userMessage.id,
  }
  appendJsonl(previousFile, hasCommandAlready ? [outputMessage] : [userMessage, outputMessage])

  const store = readJson(params.before.storePath)
  store[params.sessionKey] = {
    ...previousEntry,
    sessionId: previousEntry.sessionId,
    sessionFile: previousFile,
    updatedAt: (userMessage as any).message.timestamp,
    status: "done",
  }
  writeJson(params.before.storePath, store)
  return { restored: true, sessionId: previousEntry.sessionId, sessionFile: previousFile }
}

function recordSlashCommandInputIfGatewayOnlyAppendedOutput(params: { sessionKey: string; message: string }) {
  if (!params.message.trim().startsWith("/")) return null
  const current = readSessionStoreEntry(params.sessionKey)
  const file = String((current?.entry as any)?.sessionFile || "")
  if (!file) return null
  const lines = readJsonl(file)
  const last = lines.at(-1)
  const previous = lines.at(-2)
  const lastMessage = last?.message
  const lastText = lastMessage?.content?.[0]?.text
  if (lastMessage?.role === "user" && lastText === params.message.trim()) return null

  if (last?.type !== "message" || lastMessage?.role !== "assistant" || lastMessage?.provider !== "openclaw" || lastMessage?.model !== "gateway-injected") {
    const userMessage = commandUserMessage(params.message, last?.id ?? null)
    appendJsonl(file, [userMessage])
    return { recorded: true, pendingOutput: true, sessionId: (current?.entry as any)?.sessionId, sessionFile: file }
  }

  const previousText = previous?.message?.content?.[0]?.text
  if (previous?.message?.role === "user" && previousText === params.message.trim()) return null
  const userMessage = commandUserMessage(params.message, previous?.id ?? null)
  const outputMessage = { ...last, parentId: userMessage.id }
  writeJsonl(file, [...lines.slice(0, -1), userMessage, outputMessage])
  return { recorded: true, sessionId: (current?.entry as any)?.sessionId, sessionFile: file }
}

function scheduleSlashCommandHistoryRepair(params: { sessionKey: string; message: string; before: ReturnType<typeof readSessionStoreEntry> }) {
  if (!params.message.trim().startsWith("/")) return
  const timer = setTimeout(() => {
    try {
      restoreSlashCommandHistoryIfGatewayReset(params)
        ?? recordSlashCommandInputIfGatewayOnlyAppendedOutput({ sessionKey: params.sessionKey, message: params.message })
    } catch {
      // Best-effort repair only; chat.send itself already succeeded.
    }
  }, 2_500)
  ;(timer as any).unref?.()
}

function packageVersion() {
  for (const file of [path.join(process.cwd(), "package.json"), path.join(process.cwd(), "..", "..", "package.json")]) {
    const pkg = readJson(file)
    if (pkg.version) return String(pkg.version)
  }
  return "0.1.0"
}

function commandVersion(binary: string, args = ["--version"]) {
  try { return execFileSync(binary, args, { encoding: "utf8", timeout: 5_000 }).trim().split("\n")[0] || null } catch { return null }
}

async function gatewayStatus() {
  try {
    const gw = await connectGateway(["operator.read"])
    gw.close()
    return { running: true, status: "connected" }
  } catch (error) {
    return { running: false, status: "disconnected", error: error instanceof Error ? error.message : String(error) }
  }
}

function usageNumber(value: any): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function normalizeUsage(raw: any) {
  const input = usageNumber(raw?.input ?? raw?.input_tokens ?? raw?.prompt_tokens)
  const output = usageNumber(raw?.output ?? raw?.output_tokens ?? raw?.completion_tokens)
  const cacheRead = usageNumber(raw?.cacheRead ?? raw?.cache_read_tokens)
  const cacheWrite = usageNumber(raw?.cacheWrite ?? raw?.cache_write_tokens)
  const total = usageNumber(raw?.total ?? raw?.total_tokens) || input + output + cacheRead + cacheWrite
  return { input, output, cacheRead, cacheWrite, total }
}

function collectUsageFromValue(value: any, out: any[] = []) {
  if (!value || typeof value !== "object") return out
  if (value.usage && typeof value.usage === "object") out.push(value.usage)
  if (Array.isArray(value)) for (const item of value) collectUsageFromValue(item, out)
  else for (const item of Object.values(value)) if (item && typeof item === "object") collectUsageFromValue(item, out)
  return out
}

function usageFromSessions(requestedDays = 30) {
  const usage: any[] = []
  const days = new Map<string, any>()
  const cutoff = Date.now() - Math.max(1, requestedDays) * 24 * 60 * 60 * 1000
  const roots = [path.join(os.homedir(), ".openclaw", "agents")]
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const agent of fs.readdirSync(root)) {
      const sessionsDir = path.join(root, agent, "sessions")
      if (!fs.existsSync(sessionsDir)) continue
      for (const file of fs.readdirSync(sessionsDir)) {
        if (!file.endsWith(".jsonl") || file.endsWith(".trajectory.jsonl")) continue
        const full = path.join(sessionsDir, file)
        const lines = fs.readFileSync(full, "utf8").split("\n")
        for (const line of lines) {
          if (!line.includes('"usage"')) continue
          try {
            const entry = JSON.parse(line)
            const raw = entry?.message?.usage ?? entry?.data?.usage ?? entry?.usage
            if (!raw) continue
            const normalized = normalizeUsage(raw)
            const cost = usageNumber(raw?.cost?.total ?? raw?.totalCost)
            const item = { ...normalized, cost, provider: entry?.message?.provider ?? entry?.provider, model: entry?.message?.model ?? entry?.modelId, timestamp: entry?.timestamp ?? entry?.ts, sessionFile: full }
            const ts = typeof item.timestamp === "string" ? Date.parse(item.timestamp) : Number(item.timestamp)
            if (Number.isFinite(ts) && ts < cutoff) continue
            usage.push(item)
            const day = String(item.timestamp || "").slice(0, 10) || "unknown"
            const daily = days.get(day) ?? { day, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0 }
            daily.input += item.input; daily.output += item.output; daily.cacheRead += item.cacheRead; daily.cacheWrite += item.cacheWrite; daily.totalTokens += item.total; daily.totalCost += item.cost
            days.set(day, daily)
          } catch { /* skip malformed transcript lines */ }
        }
      }
    }
  }
  const summary = usage.reduce((acc, item) => {
    acc.input += item.input; acc.output += item.output; acc.cacheRead += item.cacheRead; acc.cacheWrite += item.cacheWrite; acc.totalTokens += item.total; acc.totalCost += item.cost
    return acc
  }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0 })
  return { summary, usage, days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)), source: "openclaw-session-transcripts", unavailable: usage.length === 0 }
}

function frontendUsageSummary(summary: any) {
  return {
    totalCost: usageNumber(summary.totalCost),
    totalInputTokens: usageNumber(summary.input ?? summary.totalInputTokens),
    totalOutputTokens: usageNumber(summary.output ?? summary.totalOutputTokens),
    cacheReadTokens: usageNumber(summary.cacheRead ?? summary.cacheReadTokens),
    cacheWriteTokens: usageNumber(summary.cacheWrite ?? summary.cacheWriteTokens),
    totalTokens: usageNumber(summary.totalTokens),
    input: usageNumber(summary.input),
    output: usageNumber(summary.output),
    cacheRead: usageNumber(summary.cacheRead),
    cacheWrite: usageNumber(summary.cacheWrite),
  }
}

function frontendDaily(days: any[]) {
  return days.map((day) => ({
    date: day.day ?? day.date,
    day: day.day ?? day.date,
    input_tokens: usageNumber(day.input ?? day.input_tokens),
    output_tokens: usageNumber(day.output ?? day.output_tokens),
    cache_read_tokens: usageNumber(day.cacheRead ?? day.cache_read_tokens),
    cache_write_tokens: usageNumber(day.cacheWrite ?? day.cache_write_tokens),
    total_tokens: usageNumber(day.totalTokens ?? day.total_tokens),
    cost_usd: usageNumber(day.totalCost ?? day.cost_usd),
  }))
}

function nativeCommands() {
  return [
    { name: "model", description: "Switch or inspect the active model", source: "native", scope: "both", acceptsArgs: true },
    { name: "status", description: "Show current session and gateway status", source: "native", scope: "both", acceptsArgs: false },
    { name: "help", description: "Show available commands", source: "native", scope: "both", acceptsArgs: false },
    { name: "clear", description: "Clear conversation history", source: "native", scope: "both", acceptsArgs: false },
    { name: "reset", description: "Reset the current session", source: "native", scope: "both", acceptsArgs: false },
    { name: "new", description: "Start a new session", source: "native", scope: "both", acceptsArgs: false },
    { name: "stop", description: "Stop the current generation", source: "native", scope: "both", acceptsArgs: false },
    { name: "plan", description: "Create a step-by-step plan", source: "native", scope: "text", acceptsArgs: true },
    { name: "search", description: "Search the web for information", source: "native", scope: "text", acceptsArgs: true },
    { name: "code", description: "Generate or explain code", source: "native", scope: "text", acceptsArgs: true },
    { name: "summarize", description: "Summarize content or conversation", source: "native", scope: "text", acceptsArgs: true },
    { name: "debug", description: "Debug code or errors", source: "native", scope: "text", acceptsArgs: true },
    { name: "explain", description: "Explain a concept or code", source: "native", scope: "text", acceptsArgs: true },
    { name: "review", description: "Review code for issues", source: "native", scope: "text", acceptsArgs: true },
    { name: "reasoning", description: "Toggle reasoning mode", source: "native", scope: "both", acceptsArgs: true },
    { name: "verbose", description: "Toggle verbose/tool output", source: "native", scope: "both", acceptsArgs: true },
  ]
}

function messageBody(m: any) {
  if (!m) return ""
  if (typeof m.text === "string") return m.text
  const content = m.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((b:any)=>b?.text || b?.content || "").join("")
  return ""
}

function messageIdOf(m: any) { return m?.id || m?.messageId || m?.__openclaw?.id }
function activeSessionKey(s: any, key: string) { return s.commandState?.activeBranchSessions?.[key] || key }

function agentIdFromSessionKey(sessionKey: string | undefined, fallback = "main") {
  const match = String(sessionKey || "").match(/^agent:([^:]+):/)
  return match?.[1] || fallback
}

function stripTranscriptUiMeta(value: any): any {
  if (Array.isArray(value)) return value.map(stripTranscriptUiMeta)
  if (!value || typeof value !== "object") return value
  const out: any = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === "__openclaw" || key === "messageId" || key === "seq") continue
    out[key] = stripTranscriptUiMeta(item)
  }
  return out
}

function transcriptLineFromHistoryMessage(message: any) {
  const meta = message?.__openclaw && typeof message.__openclaw === "object" ? message.__openclaw : {}
  const id = String(meta.id || message?.id || crypto.randomUUID())
  const timestamp = typeof message?.timestamp === "number"
    ? new Date(message.timestamp).toISOString()
    : (typeof message?.timestamp === "string" ? message.timestamp : now())
  return JSON.stringify({ id, timestamp, message: stripTranscriptUiMeta(message) })
}

function copyHistoryMessagesToTranscript(transcriptPath: string, messages: any[]) {
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true })
  const existing = fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, "utf8") : ""
  const header = existing.split(/\r?\n/).find(line => {
    if (!line.trim()) return false
    try { return JSON.parse(line)?.type === "session" } catch { return false }
  }) || JSON.stringify({ type: "session", version: 1, id: path.basename(transcriptPath, ".jsonl"), timestamp: now(), cwd: process.cwd() })
  const lines = [header, ...messages.filter((m:any) => m && m.role !== "system").map(transcriptLineFromHistoryMessage)]
  fs.writeFileSync(transcriptPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 })
}

function searchMemory(query: string) {
  const q = query.trim().toLowerCase()
  const entries: any[] = []
  for (const name of fs.readdirSync(memoryDir()).filter(name => name.endsWith(".md"))) {
    const full = path.join(memoryDir(), name)
    const content = fs.readFileSync(full, "utf8")
    const lines = content.split("\n")
    lines.forEach((line, index) => {
      const text = line.trim()
      if (!text) return
      const haystack = text.toLowerCase()
      if (!q || haystack.includes(q)) {
        const category = /^#+\s/.test(text)
          ? "decision"
          : /\b(user|prefers?|requested|wants?|asked|timezone|name)\b/i.test(text)
            ? "preference"
            : /\b(root cause|fixed|commit|deployed|verification|lesson|rule)\b/i.test(text)
              ? "decision"
              : "fact"
        const totalScore = q ? Math.min(1, Math.max(0.35, q.length / Math.max(text.length, q.length))) : 0.65
        entries.push({
          path: `memory/${name}`,
          line: index + 1,
          content: text,
          text,
          category,
          totalScore,
          tags: [name.replace(/\.md$/, "")],
        })
      }
    })
  }
  return entries.slice(0, 50)
}

async function runCronJob(store: Store, s: any, input: any) {
  const job = s.commandState.cronJobs.find((j:any)=>j.jobId===(input.jobId || input.id) || j.id===(input.jobId || input.id))
  if (!job) throw new HttpError(404, "Cron job not found", "NOT_FOUND")
  const run = { id: crypto.randomUUID(), runId: crypto.randomUUID(), jobId: job.jobId || job.id, status: "running", startedAt: now(), finishedAt: null as string | null, sessionKey: job.sessionKey || `agent:main:cron:${job.jobId || job.id}:run:${crypto.randomUUID()}`, error: null as string | null }
  s.commandState.cronRuns.push(run); save(store, s)
  const prompt = String(input.prompt || job.prompt || job.message || job.command || "Run this scheduled job.")
  const gw = await connectGateway(["operator.read", "operator.write", "operator.admin"])
  try {
    await gw.request("sessions.create", { key: run.sessionKey, agentId: job.agentId || "main", label: job.name || job.title || "Cron job" }, 30_000).catch(() => null)
    const res = await gw.request("chat.send", { sessionKey: run.sessionKey, message: prompt, timeoutMs: input.timeoutMs || 120_000, idempotencyKey: run.runId }, input.timeoutMs || 130_000)
    run.status = res.ok ? "completed" : "failed"
    run.error = res.ok ? null : (res.error?.message || "chat.send failed")
    run.finishedAt = now()
    save(store, s)
    if (!res.ok) throw new HttpError(502, run.error || "cron run failed", "GATEWAY_ERROR")
    return { run, response: res.payload }
  } catch (error) {
    run.status = "failed"; run.error = error instanceof Error ? error.message : String(error); run.finishedAt = now(); save(store, s); throw error
  } finally { gw.close() }
}

function memoryDir() {
  const dir = path.join(workspaceRoot(), "memory")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
function safeMemoryPath(inputPath: string) {
  const root = workspaceRoot()
  const requested = inputPath?.trim() || "memory/notes.md"
  const full = path.resolve(root, requested)
  if (full !== root && !full.startsWith(root + path.sep)) throw new HttpError(403, "Memory path escapes workspace", "PATH_FORBIDDEN")
  fs.mkdirSync(path.dirname(full), { recursive: true })
  return full
}

function skillRoots() {
  return [
    path.join(os.homedir(), ".openclaw", "skills"),
    path.join(workspaceRoot(), "skills"),
    "/usr/lib/node_modules/openclaw/skills",
  ]
}

function userSkillRoot() {
  const root = path.join(os.homedir(), ".openclaw", "skills")
  fs.mkdirSync(root, { recursive: true })
  return root
}

function scanSkills(enabledOverrides: Record<string, boolean> = {}) {
  const roots = skillRoots()
  const skills: any[] = []
  for (const root of roots) {
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = path.join(root, entry.name)
      const skillMd = path.join(skillPath, "SKILL.md")
      if (!fs.existsSync(skillMd)) continue
      const content = fs.readFileSync(skillMd, "utf8")
      const description = content.match(/description:\s*(.+)/)?.[1]?.trim() || content.split("\n").find(l => l.trim() && !l.startsWith("---")) || ""
      skills.push({ slug: entry.name, id: entry.name, name: entry.name, description, source: root.includes("node_modules") ? "builtin" : "local", version: null, path: skillPath, installed: true, enabled: enabledOverrides[entry.name] ?? true, updatedAt: fs.statSync(skillMd).mtimeMs, createdAt: fs.statSync(skillMd).ctimeMs })
    }
  }
  const bySlug = new Map<string, any>()
  for (const skill of skills) {
    if (!bySlug.has(skill.slug)) bySlug.set(skill.slug, skill)
  }
  return [...bySlug.values()]
}

function gitCommitDetails(repoRoot: string, commit: string) {
  const cwd = repoRoot || workspaceRoot()
  const sha = commit || "HEAD"
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd, encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 })
  } catch {
    const upstream = (() => {
      try { return execFileSync("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd, encoding: "utf8", timeout: 10_000 }).trim() } catch { return "" }
    })()
    const remoteName = upstream?.split("/")[0] || "origin"
    try { execFileSync("git", ["fetch", "--prune", remoteName], { cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }) } catch {}
  }
  let show = ""
  try {
    show = execFileSync("git", ["show", "--format=fuller", "--find-renames", "--find-copies", "--stat", "--patch", sha], { cwd, encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 * 1024 })
  } catch (error: any) {
    if (error?.code !== "ENOBUFS") throw error
    const header = execFileSync("git", ["show", "--format=fuller", "--stat", "--no-patch", sha], { cwd, encoding: "utf8", timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })
    const numstat = execFileSync("git", ["show", "--numstat", "--format=", sha], { cwd, encoding: "utf8", timeout: 10_000, maxBuffer: 16 * 1024 * 1024 })
    const syntheticDiffs = numstat.split("\n").filter(Boolean).map((line) => {
      const parts = line.split("\t")
      const filePath = parts.slice(2).join("\t")
      if (!filePath) return ""
      return [`diff --git a/${filePath} b/${filePath}`, `--- a/${filePath}`, `+++ b/${filePath}`, "@@ -0,0 +0,0 @@", " Diff preview omitted because this commit is too large to display safely."].join("\n")
    }).filter(Boolean).join("\n")
    show = `${header}\n\n${syntheticDiffs}\n`
  }
  return { diff: show, commit: { sha, text: show } }
}

function modelRefsFromConfig(cfg: any): string[] {
  const defaults = cfg.agents?.defaults ?? {}
  const modelMapRefs = defaults.models && !Array.isArray(defaults.models) && typeof defaults.models === "object"
    ? Object.entries(defaults.models).flatMap(([key, value]: [string, any]) => {
        if (typeof value === "string") return [value]
        if (Array.isArray(value)) return value
        if (value && typeof value === "object") {
          const refs = [value.primary, value.model, ...(Array.isArray(value.fallbacks) ? value.fallbacks : [])].filter(Boolean)
          return refs.length > 0 ? refs : [key]
        }
        return []
      })
    : []
  const refs = [
    ...modelMapRefs,
    ...(Array.isArray(defaults.models) ? defaults.models : []),
    ...(Array.isArray(defaults.model?.models) ? defaults.model.models : []),
    defaults.model?.primary,
    ...(Array.isArray(defaults.model?.fallbacks) ? defaults.model.fallbacks : []),
    typeof defaults.model === "string" ? defaults.model : null,
  ]
  return [...new Set(refs.filter((value): value is string => typeof value === "string" && value.trim().length > 0))]
}

function normalizeModelEntry(value: any) {
  const ref = typeof value === "string" ? value : String(value?.id || value?.model || value?.value || "")
  const [providerFromRef, idFromRef] = ref.includes("/") ? ref.split(/\/(.+)/) : [String(value?.provider || "custom"), ref]
  const provider = String(value?.provider || providerFromRef || "custom")
  const id = String(value?.id || idFromRef || ref)
  return {
    id,
    name: String(value?.name || id || ref),
    provider,
    reasoning: Boolean(value?.reasoning),
  }
}

function configContains(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle)
  if (Array.isArray(value)) return value.some((item) => configContains(item, needle))
  if (value && typeof value === "object") return Object.values(value).some((item) => configContains(item, needle))
  return false
}

function hasDirectProviderKey(provider: string, cfg: any): boolean {
  if (provider === "anthropic") {
    return String(process.env.ANTHROPIC_API_KEY || "").startsWith("sk-ant-api-") || configContains(cfg, "sk-ant-api-")
  }
  return true
}

function modelHealth(model: any, cfg: any) {
  if (model.provider === "anthropic" && !hasDirectProviderKey("anthropic", cfg)) {
    return {
      status: "unavailable",
      reason: "Anthropic OAuth is not supported here. Add a direct sk-ant-api-* key or pick another model.",
      code: "anthropic_oauth_unsupported",
    }
  }
  return { status: "available" }
}

function modelsResponse(cfg: any) {
  const refs = modelRefsFromConfig(cfg)
  const defaultsModels = cfg.agents?.defaults?.models
  const rawModels = Array.isArray(defaultsModels)
    ? defaultsModels
    : defaultsModels && typeof defaultsModels === "object"
      ? Object.entries(defaultsModels).flatMap(([provider, value]: [string, any]) => {
          if (typeof value === "string") return [{ provider, id: value.includes("/") ? value.split(/\/(.+)/)[1] : value, name: value }]
          if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? { provider, id: item.includes("/") ? item.split(/\/(.+)/)[1] : item, name: item } : { provider, ...item })
          if (value && typeof value === "object") {
            const candidates = [value.primary, value.model, ...(Array.isArray(value.fallbacks) ? value.fallbacks : [])].filter(Boolean)
            if (candidates.length === 0) return [provider]
            return candidates.map((item) => ({ provider, id: String(item).includes("/") ? String(item).split(/\/(.+)/)[1] : String(item), name: String(item) }))
          }
          return []
        })
    : Array.isArray(cfg.agents?.defaults?.model?.models)
      ? cfg.agents.defaults.model.models
      : refs
  const models = (rawModels.length ? rawModels : refs).map(normalizeModelEntry).map((model: any) => ({ ...model, health: modelHealth(model, cfg) }))
  const currentModel = cfg.agents?.defaults?.model?.primary || (typeof cfg.agents?.defaults?.model === "string" ? cfg.agents.defaults.model : null) || refs[0] || null
  if (currentModel && !models.some((model: any) => `${model.provider}/${model.id}` === currentModel || model.id === currentModel)) {
    const current = normalizeModelEntry(currentModel)
    models.unshift({ ...current, health: modelHealth(current, cfg) })
  }
  return { models, currentModel, defaultModel: currentModel }
}

function providerSummary(id: string) {
  return {
    id,
    pluginId: id,
    displayName: id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    category: id.includes("ollama") || id.includes("local") ? "local" : "core",
    authEnvVars: [],
    authMethods: ["api-key"],
    authChoices: [],
    submit: { payloadShape: { values: { fields: { credentials: [], config: [] } } } },
  }
}

function modelContract(cfg: any, providerId?: string | null) {
  const response = modelsResponse(cfg)
  const models = providerId ? response.models.filter((model: any) => model.provider === providerId) : response.models
  const options = models.map((model: any) => ({ id: model.id, value: `${model.provider}/${model.id}`, label: model.name }))
  const recommended = response.currentModel || options[0]?.value || null
  return {
    providerId: providerId || (recommended?.split("/")[0] ?? null),
    authMethod: null,
    selectedModelRef: response.currentModel,
    recommendedModelRef: recommended,
    types: { payloadShape: { modelRef: { inputKind: "select", allowCustom: true, recommended, options } } },
  }
}

export function commandRoutes(store: Store) {
  return {
    async handle(command: string, input: any = {}) {
      const s = state(store)
      switch (command) {
        case "middleware_connect_status": {
          const cfg = readJson(openclawConfigPath())
          const gateway = await gatewayStatus()
          return {
            gatewayConfigured: Boolean(cfg.gateway_url || cfg.gateway?.port),
            gatewayUrl: cfg.gateway_url || `ws://127.0.0.1:${cfg.gateway?.port || 18789}`,
            gatewayToken: cfg.gateway?.auth?.token ? "configured" : null,
            hasConnection: gateway.running,
            hasIdentity: fs.existsSync(path.join(os.homedir(), ".openclaw", "state", "identity", "device.json")),
            status: gateway.status,
            error: gateway.error ?? null,
          }
        }
        case "middleware_connect_bootstrap": {
          const cfg = readJson(openclawConfigPath())
          const gateway = await gatewayStatus()
          return { ok: gateway.running, gatewayUrl: cfg.gateway_url || `ws://127.0.0.1:${cfg.gateway?.port || 18789}`, status: gateway.status, error: gateway.error ?? null }
        }
        case "middleware_sync_pull_now": unsupported(command)
        case "middleware_version_info": { const version = packageVersion(); return { version, desktop: "new-arch", middleware: version, node: process.version } }
        case "middleware_profiles_list": { const gateway = await gatewayStatus(); return { profiles: [{ id: "external_middleware", name: "External Middleware", mode: "remote", gatewayUrl: readJson(openclawConfigPath()).gateway_url || "configured", workspaceRoot: workspaceRoot(), isDefault: true, status: gateway.status, error: gateway.error ?? null }] } }
        case "middleware_pty_spawn_workspace": return terminalSpawnWorkspace(input)

        case "middleware_fs_read_dir": {
          const dirPath = String(input.path || workspaceRoot())
          const entries = fs.readdirSync(dirPath, { withFileTypes: true }).map(e => ({ name: e.name, isDir: e.isDirectory(), type: e.isDirectory() ? "directory" : "file" }))
          return { entries }
        }

        case "middleware_models_list": {
          const cfg = readJson(openclawConfigPath())
          return modelsResponse(cfg)
        }
        case "middleware_models_set_default": {
          const cfg = readJson(openclawConfigPath())
          const modelId = String(input.modelId || input.modelRef || "").trim()
          if (!modelId) throw new HttpError(400, "modelId is required", "BAD_REQUEST")
          const model = modelsResponse(cfg).models.find((item: any) => item.id === modelId || `${item.provider}/${item.id}` === modelId)
          if (model?.health?.status === "unavailable") {
            throw new HttpError(409, model.health.reason || "Model is unavailable", "MODEL_UNAVAILABLE")
          }
          cfg.agents ??= {}; cfg.agents.defaults ??= {}; cfg.agents.defaults.model ??= {}
          if (typeof cfg.agents.defaults.model === "string") cfg.agents.defaults.model = { primary: cfg.agents.defaults.model }
          cfg.agents.defaults.model.primary = modelId
          writeJson(openclawConfigPath(), cfg)
          return ok({ modelId, currentModel: modelId, defaultModel: modelId })
        }
        case "middleware_usage": {
          const requestedDays = usageNumber(input.days) || 30
          const usage = usageFromSessions(requestedDays)
          let providers: any[] = []
          try {
            const gw = await connectGateway(["operator.read"])
            try {
              const status = await gw.request<any>("usage.status", {}, 30_000)
              if (status.ok && Array.isArray((status.payload as any)?.providers)) providers = (status.payload as any).providers
            } finally { gw.close() }
          } catch { /* provider status unavailable; transcript usage still useful */ }
          return { range: { days: requestedDays }, summary: frontendUsageSummary(usage.summary), providers, usage: usage.usage.slice(-500), source: usage.source, unavailable: usage.unavailable }
        }
        case "middleware_usage_daily": { const requestedDays = usageNumber(input.days) || 30; const usage = usageFromSessions(requestedDays); const daily = frontendDaily(usage.days); return { range: { days: requestedDays }, daily, days: usage.days, source: usage.source, unavailable: usage.unavailable } }

        case "middleware_commands_list": return { commands: nativeCommands() }
        case "middleware_autonaming_quick": { const name = String(input.text || input.prompt || "New Chat").replace(/\s+/g, " ").trim().slice(0, 60) || "New Chat"; return { name, title: name } }
        case "middleware_message_feedback": { s.commandState.feedback.push({ id: crypto.randomUUID(), ...input, createdAt: now() }); save(store, s); return ok() }
        case "middleware_message_feedback_delete": { s.commandState.feedback = s.commandState.feedback.filter((f:any) => f.message_id !== input.message_id && f.messageId !== input.messageId); save(store, s); return ok() }

        case "middleware_chat_history": {
          if (!input.sessionKey) throw new HttpError(400, "sessionKey is required", "BAD_REQUEST")
          const timeoutMs = Math.max(1_000, Math.min(Number(input.timeoutMs) || 30_000, 30_000))
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin"])
          try {
            const res = await gw.request("chat.history", { sessionKey: activeSessionKey(s, input.sessionKey) }, timeoutMs)
            if (!res.ok) throw new HttpError(502, res.error?.message || "chat.history failed", "GATEWAY_ERROR")
            return normalizeHistoryPayload(res.payload)
          } finally {
            gw.close()
          }
        }
        case "middleware_chat_send": {
          const message = String(input.text || input.message || "")
          if (!message.trim()) throw new HttpError(400, "message is required", "BAD_REQUEST")
          const key = input.sessionKey ? activeSessionKey(s, input.sessionKey) : `agent:main:desktop:${crypto.randomUUID()}`
          const beforeCommandSession = readSessionStoreEntry(key)
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin"])
          try {
            await gw.request("sessions.create", { key, agentId: input.agentId || "main", label: input.label || "New Chat" }, 30_000).catch(() => null)
            const res = await gw.request("chat.send", {
              sessionKey: key,
              message,
              timeoutMs: input.timeoutMs || 120_000,
              idempotencyKey: crypto.randomUUID(),
            }, input.timeoutMs || 130_000)
            if (!res.ok) throw new HttpError(502, res.error?.message || "chat.send failed", "GATEWAY_ERROR")
            const commandHistoryRestore = restoreSlashCommandHistoryIfGatewayReset({ sessionKey: key, message, before: beforeCommandSession })
              ?? recordSlashCommandInputIfGatewayOnlyAppendedOutput({ sessionKey: key, message })
            scheduleSlashCommandHistoryRepair({ sessionKey: key, message, before: beforeCommandSession })
            return { ok: true, sessionKey: key, commandHistoryRestore, ...((res.payload as object) || {}) }
          } finally {
            gw.close()
          }
        }
        case "middleware_chat_stop": {
          if (!input.sessionKey) throw new HttpError(400, "sessionKey is required", "BAD_REQUEST")
          const gw = await connectGateway(["operator.write", "operator.admin"])
          try {
            const res = await gw.request("chat.abort", { sessionKey: input.sessionKey, runId: input.runId }, 30_000)
            if (!res.ok) throw new HttpError(502, res.error?.message || "chat.abort failed", "GATEWAY_ERROR")
            return { ok: true, ...((res.payload as object) || {}) }
          } finally { gw.close() }
        }
        case "middleware_chat_regenerate": {
          if (!input.sessionKey) throw new HttpError(400, "sessionKey is required", "BAD_REQUEST")
          if (!input.messageId) throw new HttpError(400, "messageId is required", "BAD_REQUEST")
          const message = String(input.text || input.message || "")
          if (!message.trim()) throw new HttpError(400, "message is required", "BAD_REQUEST")
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin", "operator.approvals"])
          try {
            const sourceKey = input.sessionKey
            const agentId = input.agentId || agentIdFromSessionKey(sourceKey)
            const history = await gw.request<any>("chat.history", { sessionKey: sourceKey, limit: input.limit || 1000 }, 30_000)
            if (!history.ok) throw new HttpError(502, history.error?.message || "chat.history failed", "GATEWAY_ERROR")
            const messages = Array.isArray((history.payload as any)?.messages) ? (history.payload as any).messages : []
            const gatewayIndex = Number.isInteger(input.gatewayIndex) ? Number(input.gatewayIndex) : -1
            let assistantIndex = messages.findIndex((m:any) => messageIdOf(m) === input.messageId)
            if (
              (assistantIndex === -1 || messages[assistantIndex]?.role !== "assistant") &&
              gatewayIndex >= 0 &&
              gatewayIndex < messages.length &&
              messages[gatewayIndex]?.role === "assistant"
            ) {
              assistantIndex = gatewayIndex
            }
            if (assistantIndex === -1 || messages[assistantIndex]?.role !== "assistant") throw new HttpError(404, "Assistant message not found", "NOT_FOUND")
            let userIndex = -1
            for (let i = assistantIndex - 1; i >= 0; i -= 1) {
              if (messages[i]?.role === "user") {
                userIndex = i
                break
              }
            }
            if (userIndex === -1) throw new HttpError(404, "Preceding user message not found", "NOT_FOUND")
            const sourceUser = messages[userIndex]
            const sourceAssistant = messages[assistantIndex]
            const branchSessionKey = `agent:${agentId}:regen:${crypto.randomUUID()}`
            const label = `Regenerate preview ${new Date().toISOString()}`
            const created = await gw.request<any>("sessions.create", { key: branchSessionKey, agentId, label, parentSessionKey: sourceKey }, 30_000)
            if (!created.ok) throw new HttpError(502, created.error?.message || "sessions.create failed", "GATEWAY_ERROR")
            const transcriptPath = (created.payload as any)?.entry?.sessionFile
            if (!transcriptPath || typeof transcriptPath !== "string") throw new HttpError(502, "sessions.create did not return entry.sessionFile", "GATEWAY_ERROR")
            copyHistoryMessagesToTranscript(transcriptPath, messages.slice(0, userIndex))
            const prompt = messageBody(sourceUser).trim() || message
            const res = await gw.request("chat.send", {
              sessionKey: branchSessionKey,
              message: prompt,
              timeoutMs: input.timeoutMs || 120_000,
              idempotencyKey: crypto.randomUUID(),
            }, input.timeoutMs || 130_000)
            if (!res.ok) throw new HttpError(502, res.error?.message || "chat.regenerate failed", "GATEWAY_ERROR")
            const branchId = crypto.randomUUID()
            const branch = { branchId, sourceSessionKey: sourceKey, sourceMessageId: messageIdOf(sourceUser), sourceAssistantMessageId: input.messageId, branchSessionKey, branchReason: "regenerate", createdAt: now() }
            s.commandState.branches.push(branch); save(store, s)
            return { accepted: true, branchId, branchSessionKey, sessionKey: sourceKey, regeneratedMessageId: input.messageId, sourceUserMessageId: messageIdOf(sourceUser), sourceAssistantMessageId: input.messageId, action: "regenerate", original: { user: sourceUser, assistant: sourceAssistant }, edited: { user: sourceUser, assistant: null }, ...((res.payload as object) || {}) }
          } finally { gw.close() }
        }
        case "middleware_chat_fork": {
          const sourceKey = input.sessionKey
          if (!sourceKey) throw new HttpError(400, "sessionKey is required", "BAD_REQUEST")
          const sourceSession = s.sessions.find((session: any) => session.key === sourceKey || session.sessionKey === sourceKey) ?? null
          const agentId = input.agentId || sourceSession?.agentId || agentIdFromSessionKey(sourceKey)
          const key = `agent:${agentId}:fork:${crypto.randomUUID()}`
          const sourceProjectId = sourceSession?.projectId ?? input.projectId ?? null
          const sourceTopicId = sourceSession?.topicId ?? input.topicId ?? null
          const isTopicFork = Boolean(sourceProjectId && sourceTopicId)
          const sourceTopic = isTopicFork ? s.topics.find((topic: any) => topic.id === sourceTopicId && topic.projectId === sourceProjectId) : null
          const forkTopicId = isTopicFork ? `topic_${crypto.randomUUID().replace(/-/g, "")}` : null
          const chatId = isTopicFork ? null : `chat_${crypto.randomUUID().replace(/-/g, "")}`
          const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ")
          let name = String(input.name || (isTopicFork ? `Fork: ${sourceTopic?.name || sourceSession?.label || "Topic"} ${timestamp}` : `Forked chat ${timestamp}`)).trim()
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin"])
          try {
            let created: any = null
            for (let attempt = 0; attempt < 3; attempt += 1) {
              const label = attempt === 0 ? name : `${name} (${attempt + 1})`
              created = await gw.request<any>("sessions.create", { key, agentId, label, parentSessionKey: sourceKey }, 30_000)
              if (created.ok) {
                name = label
                break
              }
              const message = created.error?.message || "sessions.create failed"
              if (!/label already in use/i.test(message) || attempt === 2) {
                throw new HttpError(502, message, "GATEWAY_ERROR")
              }
            }
            const history = await gw.request<any>("chat.history", { sessionKey: sourceKey, limit: input.limit || 100 }, 30_000)
            if (!history.ok) throw new HttpError(502, history.error?.message || "chat.history failed", "GATEWAY_ERROR")
            const messages = history?.ok && Array.isArray((history.payload as any)?.messages) ? (history.payload as any).messages : []
            let msgIdx = input.messageId ? messages.findIndex((m:any) => messageIdOf(m) === input.messageId) : -1
            const gatewayIndex = Number.isInteger(input.gatewayIndex) ? Number(input.gatewayIndex) : -1
            if (msgIdx === -1 && gatewayIndex >= 0 && gatewayIndex < messages.length) {
              msgIdx = gatewayIndex
            }
            const copyMessages = msgIdx >= 0 ? messages.slice(0, msgIdx + 1) : messages
            const transcriptPath = (created.payload as any)?.entry?.sessionFile
            if (!transcriptPath || typeof transcriptPath !== "string") throw new HttpError(502, "sessions.create did not return entry.sessionFile", "GATEWAY_ERROR")
            copyHistoryMessagesToTranscript(transcriptPath, copyMessages)
            const createdAt = now()
            const branch = { branchId: crypto.randomUUID(), sourceSessionKey: sourceKey, branchSessionKey: key, branchReason: "fork", createdAt }
            s.commandState.branches.push(branch)
            if (isTopicFork && forkTopicId) {
              s.topics.push({ id: forkTopicId, projectId: sourceProjectId, name, archived: false, pinned: false, unreadCount: 0, sortOrder: Date.now(), createdAt, updatedAt: createdAt, forkedFromTopicId: sourceTopicId })
            }
            s.sessions.push({ key, sessionKey: key, label: name, agentId, status: "idle", hidden: false, projectId: sourceProjectId ?? undefined, topicId: forkTopicId ?? undefined, createdAt, updatedAt: createdAt })
            if (chatId) s.chats.push({ id: chatId, name, sessionKey: key, agentId, archived: false, pinned: false, createdAt, updatedAt: createdAt, lastActiveAt: createdAt })
            save(store, s)
            return { chatId, projectId: sourceProjectId, topicId: forkTopicId, sourceTopicId, sessionKey: key, name, branchSessionKey: key, copiedMessages: copyMessages.filter((m:any) => m && m.role !== "system").length, transcriptPath, branchId: branch.branchId }
          } finally { gw.close() }
        }
        case "middleware_chat_edit_last_preview": {
          if (!input.sessionKey) throw new HttpError(400, "sessionKey is required", "BAD_REQUEST")
          if (!input.userMessageId) throw new HttpError(400, "userMessageId is required", "BAD_REQUEST")
          const editedText = String(input.text || input.message || "")
          if (!editedText.trim()) throw new HttpError(400, "message is required", "BAD_REQUEST")
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin", "operator.approvals"])
          try {
            const originalKey = input.sessionKey
            const branchSessionKey = `agent:main:edit:${crypto.randomUUID()}`
            const label = `Edit preview ${new Date().toISOString()}`
            await gw.request("sessions.create", { key: branchSessionKey, agentId: input.agentId || "main", label }, 30_000).catch(() => null)
            const history = await gw.request<any>("chat.history", { sessionKey: originalKey, limit: 100 }, 30_000)
            const messages = history.ok && Array.isArray((history.payload as any)?.messages) ? (history.payload as any).messages : []
            const sourceIndex = messages.findIndex((m:any) => messageIdOf(m) === input.userMessageId)
            if (sourceIndex === -1 || messages[sourceIndex]?.role !== "user") throw new HttpError(404, "User message not found", "NOT_FOUND")
            const sourceUser = messages[sourceIndex]
            const sourceAssistant = messages.slice(sourceIndex + 1).find((m:any) => m.role === "assistant") || null
            const prior = messages.slice(0, sourceIndex).filter((m:any) => m.role === "user" || m.role === "assistant")
            const prompt = [
              "Continue the conversation from this edited branch. Prior transcript is context only.",
              ...prior.map((m:any) => `${m.role}: ${messageBody(m)}`),
              `user: ${editedText}`,
            ].filter(Boolean).join("\n\n")
            const sent = await gw.request("chat.send", { sessionKey: branchSessionKey, message: prompt, timeoutMs: input.timeoutMs || 120_000, idempotencyKey: crypto.randomUUID() }, input.timeoutMs || 130_000)
            if (!sent.ok) throw new HttpError(502, sent.error?.message || "edit preview send failed", "GATEWAY_ERROR")
            const branchId = crypto.randomUUID()
            const branch = { branchId, sourceSessionKey: originalKey, sourceMessageId: input.userMessageId, branchSessionKey, branchReason: "edit", createdAt: now() }
            s.commandState.branches.push(branch); save(store, s)
            return { branchId, branchSessionKey, sourceUserMessageId: input.userMessageId, sourceAssistantMessageId: messageIdOf(sourceAssistant), original: { user: sourceUser, assistant: sourceAssistant }, edited: { user: { id: `edited:${input.userMessageId}`, role: "user", text: editedText }, assistant: null }, ...((sent.payload as object) || {}) }
          } finally { gw.close() }
        }
        case "middleware_chat_select_edit_branch": {
          const selected = input.selected || input.choice
          if (selected !== "original" && selected !== "edited") throw new HttpError(400, "selected must be original or edited", "BAD_REQUEST")
          const branchSessionKey = input.branchSessionKey || input.editedSessionKey
          const branch = s.commandState.branches.find((b:any) => b.branchSessionKey === branchSessionKey || b.branchId === input.branchId)
          if (!branch) throw new HttpError(404, "Branch not found", "NOT_FOUND")
          branch.selected = selected; branch.selectedAt = now();
          if (selected === "edited") s.commandState.activeBranchSessions[branch.sourceSessionKey] = branch.branchSessionKey
          else delete s.commandState.activeBranchSessions[branch.sourceSessionKey]
          save(store, s)
          return ok({ selected, sessionKey: selected === "edited" ? branch.branchSessionKey : branch.sourceSessionKey, branch })
        }
        case "middleware_branch_list": return { branches: s.commandState.branches.filter((b:any) => !input.sourceSessionKey || b.sourceSessionKey === input.sourceSessionKey) }

        case "middleware_pins_list": return { pins: s.commandState.pins[input.sessionKey] ?? [] }
        case "middleware_pins_add": { const key = input.sessionKey || "global"; s.commandState.pins[key] ??= []; const pin = { id: crypto.randomUUID(), ...input, pinnedAt: now() }; s.commandState.pins[key].push(pin); save(store,s); return { pin } }
        case "middleware_pins_remove": { const key = input.sessionKey || "global"; s.commandState.pins[key] = (s.commandState.pins[key] ?? []).filter((p:any) => p.messageId !== input.messageId && p.id !== input.id); save(store,s); return ok() }

        case "middleware_memory_list": {
          const documents = fs.readdirSync(memoryDir()).flatMap(name => {
            const full = path.join(memoryDir(), name)
            const stat = fs.statSync(full)
            if (!stat.isFile() || !name.endsWith(".md")) return []
            return { name, path: `memory/${name}`, size: stat.size }
          })
          return { documents, files: documents }
        }
        case "middleware_memory_read": {
          const filePath = safeMemoryPath(input.path)
          if (!fs.existsSync(filePath)) return { content: "" }
          if (!fs.statSync(filePath).isFile()) throw new HttpError(400, "Memory path is a directory", "BAD_REQUEST")
          return { content: fs.readFileSync(filePath, "utf8") }
        }
        case "middleware_memory_write": fs.writeFileSync(safeMemoryPath(input.path), input.content ?? ""); return ok({ path: input.path })
        case "middleware_memory_store": { const file = path.join(memoryDir(), `${new Date().toISOString().slice(0,10)}.md`); fs.appendFileSync(file, `\n- ${input.content || input.text || ""}\n`); return ok({ path: path.relative(workspaceRoot(), file) }) }
        case "middleware_memory_recall": { const entries = searchMemory(String(input.query || input.text || "")); return { entries, results: entries } }

        case "middleware_cron_list_jobs": return { jobs: s.commandState.cronJobs }
        case "middleware_cron_create_job": { const paused = input.paused ?? !(input.enabled ?? false); const job = { id: crypto.randomUUID(), jobId: crypto.randomUUID(), ...input, enabled: input.enabled ?? !paused, paused, status: paused ? "paused" : "active", createdAt: now(), updatedAt: now() }; s.commandState.cronJobs.push(job); save(store,s); return { job, jobId: job.jobId } }
        case "middleware_cron_get_job": return { job: s.commandState.cronJobs.find((j:any)=>j.jobId===(input.jobId || input.id) || j.id===(input.jobId || input.id)) ?? null }
        case "middleware_cron_update_job": { const job = s.commandState.cronJobs.find((j:any)=>j.jobId===(input.jobId || input.id) || j.id===(input.jobId || input.id)); if (!job) throw new HttpError(404, "Cron job not found", "NOT_FOUND"); Object.assign(job, input, { updatedAt: now() }); if ("enabled" in input || "paused" in input) { const paused = "paused" in input ? Boolean(input.paused) : !Boolean(input.enabled); job.paused = paused; job.enabled = "enabled" in input ? Boolean(input.enabled) : !paused; job.status = job.paused ? "paused" : "active" } save(store,s); return { job } }
        case "middleware_cron_delete_job": { const before = s.commandState.cronJobs.length; s.commandState.cronJobs = s.commandState.cronJobs.filter((j:any)=>j.jobId!==(input.jobId || input.id) && j.id!==(input.jobId || input.id)); if (before === s.commandState.cronJobs.length) throw new HttpError(404, "Cron job not found", "NOT_FOUND"); save(store,s); return ok() }
        case "middleware_cron_pause_job": { const job = s.commandState.cronJobs.find((j:any)=>j.jobId===(input.jobId || input.id) || j.id===(input.jobId || input.id)); if (!job) throw new HttpError(404, "Cron job not found", "NOT_FOUND"); const paused = input.paused ?? true; job.paused = paused; job.enabled = input.enabled ?? !paused; job.status = paused ? "paused" : "active"; job.updatedAt = now(); save(store,s); return { job } }
        case "middleware_cron_run_job": return runCronJob(store, s, input)
        case "middleware_cron_list_runs": return { runs: s.commandState.cronRuns.filter((r:any)=>!(input.jobId || input.id) || r.jobId===(input.jobId || input.id)) }
        case "middleware_cron_recent_activity": { const events = s.commandState.cronRuns.slice(-20).reverse(); return { events, activity: events } }
        case "middleware_cron_job_conversation": {
          const run = s.commandState.cronRuns.find((r:any) => r.jobId === input.jobId || r.runId === input.runId || r.id === input.runId)
          if (!run?.sessionKey) return { messages: [] }
          const gw = await connectGateway(["operator.read"])
          try { const res = await gw.request<any>("chat.history", { sessionKey: run.sessionKey }, 30_000); if (!res.ok) throw new HttpError(502, res.error?.message || "chat.history failed", "GATEWAY_ERROR"); return { ...((res.payload as object) || {}), messages: (res.payload as any)?.messages ?? [], lastRun: run } } finally { gw.close() }
        }
        case "middleware_cron_reset_fixtures": s.commandState.cronJobs = []; s.commandState.cronRuns = []; save(store,s); return ok()

        case "middleware_skills_installed_local": {
          const skills = scanSkills(s.commandState.skillsEnabled)
          return { query: input.query ?? null, sort: input.sort ?? "name", results: skills, skills, warnings: [], sources: ["local"], nextCursor: null }
        }
        case "middleware_skills_discover": {
          const skills = scanSkills(s.commandState.skillsEnabled)
          return { query: input.query ?? null, sort: input.sort ?? "name", results: skills, skills, warnings: [], sources: ["local"], nextCursor: null }
        }
        case "middleware_skills_detail": {
          const slug = input.slug || input.skillId
          const found = scanSkills(s.commandState.skillsEnabled).find(skill => skill.slug === slug || skill.id === slug || skill.name === slug)
          if (!found) return { skill: null, installed: false, enabled: false }
          const skillMd = path.join(found.path, "SKILL.md")
          const content = fs.existsSync(skillMd) ? fs.readFileSync(skillMd, "utf8") : ""
          return {
            skill: { slug: found.slug, displayName: found.name, summary: found.description, createdAt: found.createdAt || Date.now(), updatedAt: found.updatedAt || Date.now() },
            latestVersion: { version: found.version || "local", createdAt: found.updatedAt || Date.now() },
            installed: true,
            enabled: found.enabled,
            localContent: content,
            localVersion: found.version || "local",
            package: { channel: found.source, isOfficial: found.source === "builtin" },
          }
        }
        case "middleware_skills_install": {
          const slug = String(input.slug || input.skillId || "").trim()
          if (!slug) throw new HttpError(400, "Skill slug is required", "BAD_REQUEST")
          const existing = scanSkills(s.commandState.skillsEnabled).find(skill => skill.slug === slug || skill.id === slug)
          const dest = path.join(userSkillRoot(), slug)
          if (existing?.path && existing.path !== dest) {
            fs.cpSync(existing.path, dest, { recursive: true, force: true })
          } else {
            fs.mkdirSync(dest, { recursive: true })
            const file = path.join(dest, "SKILL.md")
            if (!fs.existsSync(file)) fs.writeFileSync(file, `---\nname: ${slug}\ndescription: Local installed skill ${slug}\n---\n\n# ${slug}\n`)
          }
          return { ok: true, skill: scanSkills(s.commandState.skillsEnabled).find(skill => skill.slug === slug || skill.id === slug) }
        }
        case "middleware_skills_uninstall": {
          const slug = String(input.slug || input.skillId || "").trim()
          if (!slug) throw new HttpError(400, "Skill slug is required", "BAD_REQUEST")
          const target = path.join(userSkillRoot(), slug)
          if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
          return ok({ slug })
        }
        case "middleware_skills_toggle": { const skillId = String(input.skillId || input.slug || ""); if (!skillId) throw new HttpError(400, "skillId is required", "BAD_REQUEST"); s.commandState.skillsEnabled[skillId] = input.enabled ?? true; save(store, s); return ok({ skillId, enabled: s.commandState.skillsEnabled[skillId] }) }
        case "middleware_skills_versions": { const slug = String(input.slug || input.skillId || ""); const found = scanSkills(s.commandState.skillsEnabled).find(skill => skill.slug === slug || skill.id === slug); return { items: found ? [{ version: found.version || "local", createdAt: found.createdAt, updatedAt: found.updatedAt, source: found.source }] : [], nextCursor: null } }

        case "middleware_onboarding_core": {
          const cfg = readJson(openclawConfigPath())
          const gateway = await gatewayStatus()
          const openclawVersion = commandVersion("openclaw", ["--version"])
          return { action: input.action || "check", applied: false, canAutoFix: false, status: { node: { installed: true, version: process.version }, npm: { installed: Boolean(commandVersion("npm")), version: commandVersion("npm") }, openclaw: { installed: Boolean(openclawVersion), version: openclawVersion, installMethod: openclawVersion ? "existing" : null }, gateway: { url: cfg.gateway_url || `ws://127.0.0.1:${cfg.gateway?.port || 18789}`, running: gateway.running, status: gateway.status, error: gateway.error ?? null }, recommendation: gateway.running ? "OpenClaw is ready." : "Start OpenClaw Gateway, then retry." }, actionsRun: [], message: gateway.running ? "OpenClaw is ready." : "OpenClaw Gateway is not connected." }
        }
        case "middleware_onboarding_flow": {
          const cfg = readJson(openclawConfigPath())
          const contract = modelContract(cfg)
          const gateway = await gatewayStatus()
          const openclawVersion = commandVersion("openclaw", ["--version"])
          const coreComplete = gateway.running && Boolean(openclawVersion)
          return { flow: { steps: [ { id: "core", title: "Core", complete: coreComplete }, { id: "bot", title: "Bot", complete: true }, { id: "provider", title: "Provider", complete: true }, { id: "model", title: "Model", complete: Boolean(contract.selectedModelRef) }, { id: "complete", title: "Complete", complete: coreComplete && Boolean(contract.selectedModelRef) } ], nextStep: !coreComplete ? "core" : (contract.selectedModelRef ? "complete" : "model"), completed: coreComplete && Boolean(contract.selectedModelRef) }, state: { core: { status: { node: { installed: true, version: process.version }, npm: { installed: Boolean(commandVersion("npm")), version: commandVersion("npm") }, openclaw: { installed: Boolean(openclawVersion), version: openclawVersion, installMethod: openclawVersion ? "existing" : null }, gateway: { url: cfg.gateway_url || `ws://127.0.0.1:${cfg.gateway?.port || 18789}`, running: gateway.running, status: gateway.status, error: gateway.error ?? null }, recommendation: coreComplete ? "OpenClaw is ready." : "Start OpenClaw Gateway, then retry." } }, bot: { botName: cfg.bot?.name ?? "OpenClaw" }, provider: { selection: null }, model: { selectedModelRef: contract.selectedModelRef, contract } } }
        }
        case "middleware_onboarding_providers": {
          const cfg = readJson(openclawConfigPath())
          const providerIds = Object.keys(cfg.providers ?? {})
          const fallbackProviders = [...new Set<string>(modelsResponse(cfg).models.map((model: any) => String(model.provider)))]
          const providers = (providerIds.length ? providerIds : fallbackProviders).map((id) => providerSummary(String(id)))
          return { providers, count: providers.length }
        }
        case "middleware_onboarding_provider_details": return { provider: providerSummary(String(input.providerId || "custom")) }
        case "middleware_onboarding_provider_submit": return ok({ nextStep: "model" })
        case "middleware_onboarding_model_submit": {
          const cfg = readJson(openclawConfigPath())
          const modelRef = String(input.modelRef || input.modelId || "").trim()
          if (!modelRef) throw new HttpError(400, "modelRef is required", "BAD_REQUEST")
          cfg.agents ??= {}; cfg.agents.defaults ??= {}; cfg.agents.defaults.model ??= {}
          if (typeof cfg.agents.defaults.model === "string") cfg.agents.defaults.model = { primary: cfg.agents.defaults.model }
          cfg.agents.defaults.model.primary = modelRef
          writeJson(openclawConfigPath(), cfg)
          return ok({ nextStep: "complete", modelRef, currentModel: modelRef })
        }
        case "middleware_onboarding_sign_out": { s.sessions = []; s.chats = []; s.topics = []; save(store, s); return ok({ cleared: ["sessions", "chats", "topics"] }) }
        case "middleware_onboarding_delete_account": unsupported(command)
        case "middleware_onboarding_model_contract": return { contract: modelContract(readJson(openclawConfigPath()), input.providerId) }
        case "middleware_openclaw_bot_name_get": { const botName = readJson(openclawConfigPath()).bot?.name ?? "OpenClaw"; return { botName, name: botName } }
        case "middleware_openclaw_bot_name_set": { const cfg = readJson(openclawConfigPath()); const botName = String(input.botName || input.name || "OpenClaw"); cfg.bot ??= {}; cfg.bot.name = botName; writeJson(openclawConfigPath(), cfg); return ok({ botName, name: botName }) }
        case "middleware_open_url": return ok({ url: input.url })
        case "middleware_git_commit_details": {
          const projectId = String(input.projectId || "")
          const project = projectId ? store.getProject(projectId) : null
          const repoRoot = String(input.repoRoot || input.cwd || project?.repoRoot || project?.workspaceRoot || workspaceRoot())
          return gitCommitDetails(repoRoot, String(input.commit || input.sha || input.hash || "HEAD"))
        }
        case "middleware_projects_archive": { const project = store.updateProject(input.projectId, { archived: input.archived ?? true } as any); return { project } }
        default: throw new HttpError(404, `Unknown middleware command: ${command}`, "UNKNOWN_COMMAND")
      }
    }
  }
}
