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

function usageFromSessions() {
  const usage: any[] = []
  const days = new Map<string, any>()
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

function searchMemory(query: string) {
  const q = query.trim().toLowerCase()
  const entries: any[] = []
  for (const name of fs.readdirSync(memoryDir()).filter(name => name.endsWith(".md"))) {
    const full = path.join(memoryDir(), name)
    const content = fs.readFileSync(full, "utf8")
    const lines = content.split("\n")
    lines.forEach((line, index) => {
      if (!q || line.toLowerCase().includes(q)) entries.push({ path: `memory/${name}`, line: index + 1, text: line })
    })
  }
  return entries.slice(0, 50)
}

async function runCronJob(store: Store, s: any, input: any) {
  const job = s.commandState.cronJobs.find((j:any)=>j.jobId===input.jobId || j.id===input.jobId)
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

function scanSkills() {
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
      skills.push({ slug: entry.name, id: entry.name, name: entry.name, description, source: root.includes("node_modules") ? "builtin" : "local", version: null, path: skillPath, installed: true, enabled: true, updatedAt: fs.statSync(skillMd).mtimeMs, createdAt: fs.statSync(skillMd).ctimeMs })
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
  const show = execFileSync("git", ["show", "--stat", "--format=fuller", sha], { cwd, encoding: "utf8", timeout: 10_000 })
  return { diff: show, commit: { sha, text: show } }
}

function modelRefsFromConfig(cfg: any): string[] {
  const defaults = cfg.agents?.defaults ?? {}
  const modelMapRefs = defaults.models && !Array.isArray(defaults.models) && typeof defaults.models === "object"
    ? Object.values(defaults.models).flatMap((value: any) => {
        if (typeof value === "string") return [value]
        if (Array.isArray(value)) return value
        if (value && typeof value === "object") return [value.primary, value.model, ...(Array.isArray(value.fallbacks) ? value.fallbacks : [])]
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
            return candidates.map((item) => ({ provider, id: String(item).includes("/") ? String(item).split(/\/(.+)/)[1] : String(item), name: String(item) }))
          }
          return []
        })
    : Array.isArray(cfg.agents?.defaults?.model?.models)
      ? cfg.agents.defaults.model.models
      : refs
  const models = (rawModels.length ? rawModels : refs).map(normalizeModelEntry)
  const currentModel = cfg.agents?.defaults?.model?.primary || (typeof cfg.agents?.defaults?.model === "string" ? cfg.agents.defaults.model : null) || refs[0] || null
  if (currentModel && !models.some((model: any) => `${model.provider}/${model.id}` === currentModel || model.id === currentModel)) {
    models.unshift(normalizeModelEntry(currentModel))
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
        case "middleware_connect_bootstrap":
        case "middleware_sync_pull_now": return ok()
        case "middleware_version_info": { const version = packageVersion(); return { version, desktop: "new-arch", middleware: version, node: process.version } }
        case "middleware_profiles_list": return { profiles: [{ id: "external_middleware", name: "External Middleware", mode: "remote", gatewayUrl: "external", workspaceRoot: workspaceRoot(), isDefault: true, status: "connected" }] }
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
          cfg.agents ??= {}; cfg.agents.defaults ??= {}; cfg.agents.defaults.model ??= {}
          if (typeof cfg.agents.defaults.model === "string") cfg.agents.defaults.model = { primary: cfg.agents.defaults.model }
          cfg.agents.defaults.model.primary = modelId
          writeJson(openclawConfigPath(), cfg)
          return ok({ modelId, currentModel: modelId, defaultModel: modelId })
        }
        case "middleware_usage": { const usage = usageFromSessions(); return { summary: usage.summary, usage: usage.usage.slice(-500), source: usage.source, unavailable: usage.unavailable } }
        case "middleware_usage_daily": { const usage = usageFromSessions(); return { days: usage.days, source: usage.source, unavailable: usage.unavailable } }

        case "middleware_commands_list": return { commands: ["/model", "/status", "/help", "/reasoning", "/verbose"] }
        case "middleware_autonaming_quick": return { title: String(input.text || input.prompt || "New Chat").replace(/\s+/g, " ").trim().slice(0, 60) || "New Chat" }
        case "middleware_message_feedback": { s.commandState.feedback.push({ id: crypto.randomUUID(), ...input, createdAt: now() }); save(store, s); return ok() }
        case "middleware_message_feedback_delete": { s.commandState.feedback = s.commandState.feedback.filter((f:any) => f.message_id !== input.message_id && f.messageId !== input.messageId); save(store, s); return ok() }

        case "middleware_chat_history": {
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin"])
          try {
            const res = await gw.request("chat.history", { sessionKey: input.sessionKey }, 30_000)
            if (!res.ok) throw new HttpError(502, res.error?.message || "chat.history failed", "GATEWAY_ERROR")
            return res.payload
          } finally {
            gw.close()
          }
        }
        case "middleware_chat_send": {
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin"])
          try {
            const key = input.sessionKey || `agent:main:desktop:${crypto.randomUUID()}`
            await gw.request("sessions.create", { key, agentId: input.agentId || "main", label: input.label || "New Chat" }, 30_000).catch(() => null)
            const res = await gw.request("chat.send", {
              sessionKey: key,
              message: input.text || input.message || "",
              timeoutMs: input.timeoutMs || 120_000,
              idempotencyKey: crypto.randomUUID(),
            }, input.timeoutMs || 130_000)
            if (!res.ok) throw new HttpError(502, res.error?.message || "chat.send failed", "GATEWAY_ERROR")
            return { ok: true, sessionKey: key, ...((res.payload as object) || {}) }
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
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin", "operator.approvals"])
          try {
            const key = input.sessionKey
            const res = await gw.request("chat.send", {
              sessionKey: key,
              message: input.text || input.message || "",
              timeoutMs: input.timeoutMs || 120_000,
              idempotencyKey: crypto.randomUUID(),
            }, input.timeoutMs || 130_000)
            if (!res.ok) throw new HttpError(502, res.error?.message || "chat.regenerate failed", "GATEWAY_ERROR")
            return { accepted: true, sessionKey: key, regeneratedMessageId: input.messageId, action: "regenerate", ...((res.payload as object) || {}) }
          } finally { gw.close() }
        }
        case "middleware_chat_fork": {
          const sourceKey = input.sessionKey
          if (!sourceKey) throw new HttpError(400, "sessionKey is required", "BAD_REQUEST")
          const key = `agent:main:fork:${crypto.randomUUID()}`
          const chatId = `chat_${crypto.randomUUID().replace(/-/g, "")}`
          const name = input.name || "Forked chat"
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin"])
          try {
            await gw.request("sessions.create", { key, agentId: input.agentId || "main", label: name }, 30_000)
            const history = await gw.request<any>("chat.history", { sessionKey: sourceKey, limit: input.limit || 100 }, 30_000).catch(() => null)
            const messages = history?.ok && Array.isArray((history.payload as any)?.messages) ? (history.payload as any).messages : []
            const branch = { branchId: crypto.randomUUID(), sourceSessionKey: sourceKey, branchSessionKey: key, branchReason: "fork", createdAt: now() }
            s.commandState.branches.push(branch); s.chats.push({ id: chatId, name, sessionKey: key, agentId: input.agentId || "main", archived: false, pinned: false, createdAt: now(), updatedAt: now(), lastActiveAt: now() }); save(store, s)
            return { chatId, sessionKey: key, name, branchSessionKey: key, copiedMessages: messages.length, branchId: branch.branchId }
          } finally { gw.close() }
        }
        case "middleware_chat_edit_last_preview": {
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin", "operator.approvals"])
          try {
            const originalKey = input.sessionKey
            const branchSessionKey = `agent:main:edit:${crypto.randomUUID()}`
            const label = `Edit preview ${new Date().toISOString()}`
            await gw.request("sessions.create", { key: branchSessionKey, agentId: input.agentId || "main", label }, 30_000).catch(() => null)
            const history = await gw.request<any>("chat.history", { sessionKey: originalKey, limit: 100 }, 30_000)
            const messages = history.ok && Array.isArray((history.payload as any)?.messages) ? (history.payload as any).messages : []
            const sourceUser = messages.find((m:any) => m.id === input.userMessageId || m.messageId === input.userMessageId) || null
            const prompt = [
              "Continue the conversation. Prior transcript is context only.",
              ...messages.filter((m:any) => m.role === "user" || m.role === "assistant").slice(0, -1).map((m:any) => `${m.role}: ${Array.isArray(m.content) ? m.content.map((b:any)=>b.text||'').join('') : (m.text || m.content || '')}`),
              `user: ${input.text || input.message || ""}`,
            ].filter(Boolean).join("\n\n")
            const sent = await gw.request("chat.send", { sessionKey: branchSessionKey, message: prompt, timeoutMs: input.timeoutMs || 120_000, idempotencyKey: crypto.randomUUID() }, input.timeoutMs || 130_000)
            if (!sent.ok) throw new HttpError(502, sent.error?.message || "edit preview send failed", "GATEWAY_ERROR")
            const branch = { sourceSessionKey: originalKey, sourceMessageId: input.userMessageId, branchSessionKey, branchReason: "edit_preview", createdAt: now() }
            s.commandState.branches.push(branch); save(store, s)
            return { branchId: crypto.randomUUID(), branchSessionKey, sourceUserMessageId: input.userMessageId, original: { user: sourceUser, assistant: null }, edited: { user: { id: `edited:${input.userMessageId}`, role: "user", text: input.text }, assistant: null }, ...((sent.payload as object) || {}) }
          } finally { gw.close() }
        }
        case "middleware_chat_select_edit_branch": {
          const selected = input.selected || input.choice
          const branchSessionKey = input.branchSessionKey || input.editedSessionKey
          const branch = s.commandState.branches.find((b:any) => b.branchSessionKey === branchSessionKey || b.branchId === input.branchId)
          if (branch) { branch.selected = selected; branch.selectedAt = now(); save(store, s) }
          return ok({ selected, sessionKey: selected === "edited" ? branchSessionKey : input.originalSessionKey, branch })
        }
        case "middleware_branch_list": return { branches: s.commandState.branches.filter((b:any) => !input.sourceSessionKey || b.sourceSessionKey === input.sourceSessionKey) }

        case "middleware_pins_list": return { pins: s.commandState.pins[input.sessionKey] ?? [] }
        case "middleware_pins_add": { const key = input.sessionKey || "global"; s.commandState.pins[key] ??= []; const pin = { id: crypto.randomUUID(), ...input, pinnedAt: now() }; s.commandState.pins[key].push(pin); save(store,s); return { pin } }
        case "middleware_pins_remove": { const key = input.sessionKey || "global"; s.commandState.pins[key] = (s.commandState.pins[key] ?? []).filter((p:any) => p.messageId !== input.messageId && p.id !== input.id); save(store,s); return ok() }

        case "middleware_memory_list": {
          const documents = fs.readdirSync(memoryDir()).map(name => {
            const full = path.join(memoryDir(), name)
            const stat = fs.statSync(full)
            return { name, path: `memory/${name}`, size: stat.size }
          })
          return { documents, files: documents }
        }
        case "middleware_memory_read": return { content: fs.existsSync(safeMemoryPath(input.path)) ? fs.readFileSync(safeMemoryPath(input.path), "utf8") : "" }
        case "middleware_memory_write": fs.writeFileSync(safeMemoryPath(input.path), input.content ?? ""); return ok({ path: input.path })
        case "middleware_memory_store": { const file = path.join(memoryDir(), `${new Date().toISOString().slice(0,10)}.md`); fs.appendFileSync(file, `\n- ${input.content || input.text || ""}\n`); return ok({ path: path.relative(workspaceRoot(), file) }) }
        case "middleware_memory_recall": { const entries = searchMemory(String(input.query || input.text || "")); return { entries, results: entries } }

        case "middleware_cron_list_jobs": return { jobs: s.commandState.cronJobs }
        case "middleware_cron_create_job": { const job = { id: crypto.randomUUID(), jobId: crypto.randomUUID(), ...input, status: "paused", createdAt: now(), updatedAt: now() }; s.commandState.cronJobs.push(job); save(store,s); return { job, jobId: job.jobId } }
        case "middleware_cron_get_job": return { job: s.commandState.cronJobs.find((j:any)=>j.jobId===input.jobId || j.id===input.jobId) ?? null }
        case "middleware_cron_update_job": { const job = s.commandState.cronJobs.find((j:any)=>j.jobId===input.jobId || j.id===input.jobId); if (!job) throw new HttpError(404, "Cron job not found", "NOT_FOUND"); Object.assign(job, input, { updatedAt: now() }); save(store,s); return { job } }
        case "middleware_cron_delete_job": s.commandState.cronJobs = s.commandState.cronJobs.filter((j:any)=>j.jobId!==input.jobId && j.id!==input.jobId); save(store,s); return ok()
        case "middleware_cron_pause_job": { const job = s.commandState.cronJobs.find((j:any)=>j.jobId===input.jobId || j.id===input.jobId); if (job) job.status = "paused"; save(store,s); return { job } }
        case "middleware_cron_run_job": return runCronJob(store, s, input)
        case "middleware_cron_list_runs": return { runs: s.commandState.cronRuns.filter((r:any)=>!input.jobId || r.jobId===input.jobId) }
        case "middleware_cron_recent_activity": { const events = s.commandState.cronRuns.slice(-20).reverse(); return { events, activity: events } }
        case "middleware_cron_job_conversation": {
          const run = s.commandState.cronRuns.find((r:any) => r.jobId === input.jobId || r.runId === input.runId || r.id === input.runId)
          if (!run?.sessionKey) return { messages: [] }
          const gw = await connectGateway(["operator.read"])
          try { const res = await gw.request<any>("chat.history", { sessionKey: run.sessionKey }, 30_000); if (!res.ok) throw new HttpError(502, res.error?.message || "chat.history failed", "GATEWAY_ERROR"); return res.payload } finally { gw.close() }
        }
        case "middleware_cron_reset_fixtures": s.commandState.cronJobs = []; s.commandState.cronRuns = []; save(store,s); return ok()

        case "middleware_skills_installed_local": {
          const skills = scanSkills()
          return { query: input.query ?? null, sort: input.sort ?? "name", results: skills, skills, warnings: [], sources: ["local"], nextCursor: null }
        }
        case "middleware_skills_discover": {
          const skills = scanSkills()
          return { query: input.query ?? null, sort: input.sort ?? "name", results: skills, skills, warnings: [], sources: ["local"], nextCursor: null }
        }
        case "middleware_skills_detail": {
          const slug = input.slug || input.skillId
          const found = scanSkills().find(skill => skill.slug === slug || skill.id === slug || skill.name === slug)
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
          const existing = scanSkills().find(skill => skill.slug === slug || skill.id === slug)
          const dest = path.join(userSkillRoot(), slug)
          if (existing?.path && existing.path !== dest) {
            fs.cpSync(existing.path, dest, { recursive: true, force: true })
          } else {
            fs.mkdirSync(dest, { recursive: true })
            const file = path.join(dest, "SKILL.md")
            if (!fs.existsSync(file)) fs.writeFileSync(file, `---\nname: ${slug}\ndescription: Local installed skill ${slug}\n---\n\n# ${slug}\n`)
          }
          return { ok: true, skill: scanSkills().find(skill => skill.slug === slug || skill.id === slug) }
        }
        case "middleware_skills_uninstall": {
          const slug = String(input.slug || input.skillId || "").trim()
          if (!slug) throw new HttpError(400, "Skill slug is required", "BAD_REQUEST")
          const target = path.join(userSkillRoot(), slug)
          if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
          return ok({ slug })
        }
        case "middleware_skills_toggle": { const skillId = String(input.skillId || input.slug || ""); if (!skillId) throw new HttpError(400, "skillId is required", "BAD_REQUEST"); s.commandState.skillsEnabled[skillId] = input.enabled ?? true; save(store, s); return ok({ skillId, enabled: s.commandState.skillsEnabled[skillId] }) }
        case "middleware_skills_versions": { const slug = String(input.slug || input.skillId || ""); const found = scanSkills().find(skill => skill.slug === slug || skill.id === slug); return { items: found ? [{ version: found.version || "local", createdAt: found.createdAt, updatedAt: found.updatedAt, source: found.source }] : [], nextCursor: null } }

        case "middleware_onboarding_core": {
          const cfg = readJson(openclawConfigPath())
          const gateway = await gatewayStatus()
          const openclawVersion = commandVersion("openclaw", ["--version"])
          return { action: input.action || "check", applied: false, canAutoFix: false, status: { node: { installed: true, version: process.version }, npm: { installed: Boolean(commandVersion("npm")), version: commandVersion("npm") }, openclaw: { installed: Boolean(openclawVersion), version: openclawVersion, installMethod: openclawVersion ? "existing" : null }, gateway: { url: cfg.gateway_url || `ws://127.0.0.1:${cfg.gateway?.port || 18789}`, running: gateway.running, status: gateway.status, error: gateway.error ?? null }, recommendation: gateway.running ? "OpenClaw is ready." : "Start OpenClaw Gateway, then retry." }, actionsRun: [], message: gateway.running ? "OpenClaw is ready." : "OpenClaw Gateway is not connected." }
        }
        case "middleware_onboarding_flow": {
          const cfg = readJson(openclawConfigPath())
          const contract = modelContract(cfg)
          return { flow: { steps: [ { id: "core", title: "Core", complete: true }, { id: "bot", title: "Bot", complete: true }, { id: "provider", title: "Provider", complete: true }, { id: "model", title: "Model", complete: Boolean(contract.selectedModelRef) }, { id: "complete", title: "Complete", complete: true } ], nextStep: contract.selectedModelRef ? "complete" : "model", completed: Boolean(contract.selectedModelRef) }, state: { core: { status: { node: { installed: true, version: process.version }, npm: { installed: true, version: null }, openclaw: { installed: true, version: null, installMethod: "existing" }, gateway: { url: cfg.gateway_url || "ws://127.0.0.1:18789", running: true, status: "connected" }, recommendation: "OpenClaw is managed by Middleware." } }, bot: { botName: cfg.bot?.name ?? "OpenClaw" }, provider: { selection: null }, model: { selectedModelRef: contract.selectedModelRef, contract } } }
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
        case "middleware_git_commit_details": return gitCommitDetails(String(input.repoRoot || input.cwd || workspaceRoot()), String(input.commit || input.sha || input.hash || "HEAD"))
        case "middleware_projects_archive": { const project = store.updateProject(input.projectId, { archived: input.archived ?? true } as any); return { project } }
        default: throw new HttpError(404, `Unknown middleware command: ${command}`, "UNKNOWN_COMMAND")
      }
    }
  }
}
