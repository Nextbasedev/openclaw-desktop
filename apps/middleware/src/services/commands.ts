import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import type { Store } from "./store.js"
import { HttpError } from "../lib/http-error.js"
import { connectGateway, withGatewayReadRetry } from "./gateway.js"
import { terminalSpawnWorkspace } from "./terminal.js"
import { sanitizeHistoryPayloadForUi } from "./history-sanitize.js"
import { readVoiceSettings, voiceSettingsPayload, writeVoiceSettings } from "./voice-settings.js"

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
  s.spaces ??= []
  s.activeSpaceId ??= null
  s.chats ??= []
  ensureDefaultSpace(s)
  return s
}
function save(store: Store, s: any) { (store as any).write(s) }
function ok(extra: Record<string, unknown> = {}) { return { ok: true, ...extra } }
function openclawConfigPath() { return process.env.OPENCLAW_CONFIG_PATH || path.join(os.homedir(), ".openclaw", "openclaw.json") }
function workspaceRoot() { return process.env.WORKSPACE_ROOT || path.join(os.homedir(), ".openclaw", "workspace") }
function readJson(file: string): any { try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return {} } }
function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const next = value && typeof value === "object" && !Array.isArray(value) ? value as any : value
  if (next && typeof next === "object" && file === openclawConfigPath()) {
    const existing = readJson(file)
    if (existing?.env?.vars && typeof existing.env.vars === "object") {
      next.env ??= {}
      next.env.vars = { ...existing.env.vars, ...(next.env?.vars ?? {}) }
    }
    if (existing?.providers && typeof existing.providers === "object") {
      next.providers = { ...existing.providers, ...(next.providers ?? {}) }
    }
  }
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n")
}
function unsupported(command: string): never { throw new HttpError(501, `${command} requires OpenClaw Gateway proxy implementation`, "NOT_IMPLEMENTED") }

function ensureDefaultSpace(s: any) {
  const activeSpaces = (s.spaces ?? []).filter((space: any) => !space.archived && !space.deleted)
  if (activeSpaces.length === 0) {
    const timestamp = now()
    const space = { id: `space_${crypto.randomUUID().replace(/-/g, "")}`, name: "General", repoRoot: null, projectId: null, sortOrder: 0, archived: false, createdAt: timestamp, updatedAt: timestamp }
    s.spaces.push(space)
    s.activeSpaceId = space.id
    for (const chat of s.chats ?? []) chat.spaceId ??= space.id
    return space
  }
  if (!s.activeSpaceId || !activeSpaces.some((space: any) => space.id === s.activeSpaceId)) s.activeSpaceId = activeSpaces[0]?.id ?? null
  for (const chat of s.chats ?? []) chat.spaceId ??= s.activeSpaceId
  return activeSpaces.find((space: any) => space.id === s.activeSpaceId) ?? activeSpaces[0]
}

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
  const normalized = {
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
  return sanitizeHistoryPayloadForUi(normalized)
}

function isPairingRequiredError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  return lower.includes("pairing") || lower.includes("not paired") || lower.includes("not registered") || lower.includes("identity")
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

type ChatSendAttachment = {
  name: string
  mimeType: string
  content?: string
  encoding?: "utf-8" | "base64"
  size?: number
}

type GatewayAttachment = {
  type: "image" | "audio"
  fileName: string
  mimeType: string
  content?: string
}

const TEXT_ATTACHMENT_MIME_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "image/svg+xml",
])
const MAX_EMBEDDED_ATTACHMENT_CHARS = 120_000
const MAX_TOTAL_EMBEDDED_ATTACHMENT_CHARS = 300_000

function isTextAttachment(mimeType: string): boolean {
  return mimeType.startsWith("text/") || TEXT_ATTACHMENT_MIME_TYPES.has(mimeType)
}

function isVoiceWebmAttachment(attachment: ChatSendAttachment): boolean {
  const mimeType = String(attachment.mimeType || "").toLowerCase()
  const name = String(attachment.name || "").toLowerCase()
  return mimeType === "video/webm" && /^voice-.*\.webm$/.test(name)
}

function isAudioAttachment(attachment: ChatSendAttachment): boolean {
  const mimeType = String(attachment.mimeType || "").toLowerCase()
  return mimeType.startsWith("audio/") || isVoiceWebmAttachment(attachment)
}

function audioMimeTypeForAttachment(attachment: ChatSendAttachment): string {
  return isVoiceWebmAttachment(attachment) ? "audio/webm" : attachment.mimeType
}

function decodeAttachmentText(attachment: ChatSendAttachment): string | null {
  if (!attachment.content) return null
  if (attachment.encoding === "base64") {
    try { return Buffer.from(attachment.content, "base64").toString("utf8") } catch { return null }
  }
  return attachment.content
}

function normalizeImageAttachment(attachment: ChatSendAttachment): GatewayAttachment {
  return {
    type: "image",
    fileName: attachment.name,
    mimeType: attachment.mimeType,
    content: attachment.encoding === "base64"
      ? attachment.content
      : Buffer.from(attachment.content ?? "", "utf8").toString("base64"),
  }
}

function normalizeAudioAttachment(attachment: ChatSendAttachment): GatewayAttachment {
  return {
    type: "audio",
    fileName: attachment.name,
    mimeType: audioMimeTypeForAttachment(attachment),
    content: attachment.encoding === "base64"
      ? attachment.content
      : Buffer.from(attachment.content ?? "", "utf8").toString("base64"),
  }
}

function apiKeyForProvider(cfg: any, provider: string): string {
  const envVar = PROVIDER_API_KEY_ENV[provider]
  if (!envVar) return ""
  const providerConfig = cfg?.providers?.[provider]
  const providerCredentials = providerConfig?.credentials
  const providerAuth = providerConfig?.auth
  const configured = process.env[envVar]
    || cfg?.env?.vars?.[envVar]
    || cfg?.env?.[envVar]
    || cfg?.envVars?.[envVar]
    || cfg?.env_vars?.[envVar]
    || cfg?.[envVar]
    || providerConfig?.apiKey
    || providerConfig?.api_key
    || providerConfig?.key
    || providerConfig?.token
    || providerAuth?.apiKey
    || providerAuth?.api_key
    || providerAuth?.key
    || providerAuth?.token
    || providerCredentials?.["api-key"]
    || providerCredentials?.apiKey
    || providerCredentials?.api_key
    || providerCredentials?.key
    || providerCredentials?.token
    || providerCredentials?.[envVar]
  return String(configured || "").trim()
}

function voiceSettingsPayloadWithStatus() {
  const cfg = readJson(openclawConfigPath())
  const payload = voiceSettingsPayload()
  const provider = payload.settings.provider
  return {
    ...payload,
    status: {
      apiKeyConfigured: provider !== "auto" && Boolean(apiKeyForProvider(cfg, provider)),
    },
  }
}

async function transcribeAudioAttachment(attachment: ChatSendAttachment, cfg = readJson(openclawConfigPath())): Promise<string | null> {
  if (!attachment.content) return null
  const settings = readVoiceSettings(cfg)
  if (settings.enabled === false) {
    throw new HttpError(400, "Voice transcription is disabled in Settings → Voice.", "VOICE_TRANSCRIPTION_DISABLED")
  }
  const provider = settings.provider === "auto" ? "groq" : settings.provider
  const apiKey = apiKeyForProvider(cfg, provider)
  if (!apiKey) {
    throw new HttpError(400, `No ${provider} API key found in OpenClaw config for voice transcription. Add it in Settings → Voice.`, "VOICE_TRANSCRIPTION_UNAVAILABLE")
  }
  if (provider !== "groq" && provider !== "openai") {
    throw new HttpError(400, `${provider} voice transcription is not implemented yet. Use Groq or OpenAI in Settings → Voice.`, "VOICE_TRANSCRIPTION_PROVIDER_UNSUPPORTED")
  }

  const audio = attachment.encoding === "base64"
    ? Buffer.from(attachment.content, "base64")
    : Buffer.from(attachment.content, "utf8")
  if (audio.length === 0) return null

  const form = new FormData()
  form.set("file", new Blob([audio], { type: audioMimeTypeForAttachment(attachment) || "audio/webm" }), attachment.name || "voice.webm")
  form.set("model", settings.model || (provider === "groq" ? "whisper-large-v3-turbo" : "gpt-4o-transcribe"))
  const language = settings.language.trim().toLowerCase()
  if (language) form.set("language", language)

  const endpoint = provider === "groq"
    ? "https://api.groq.com/openai/v1/audio/transcriptions"
    : "https://api.openai.com/v1/audio/transcriptions"
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null) as { error?: { message?: unknown }; message?: unknown } | null
    const message = typeof errorPayload?.error?.message === "string"
      ? errorPayload.error.message
      : typeof errorPayload?.message === "string"
        ? errorPayload.message
        : `HTTP ${response.status}`
    throw new HttpError(502, `Voice transcription failed: ${message}`, "VOICE_TRANSCRIPTION_FAILED")
  }
  const payload = await response.json().catch(() => null) as { text?: unknown; transcript?: unknown } | null
  const text = typeof payload?.text === "string"
    ? payload.text
    : typeof payload?.transcript === "string"
      ? payload.transcript
      : ""
  if (!text.trim()) {
    throw new HttpError(422, "Voice transcription returned no text. Check mic permission/input level and try again.", "VOICE_TRANSCRIPTION_EMPTY")
  }
  return text.trim()
}

async function prepareMessageAndAttachments(message: string, raw: unknown, cfg = readJson(openclawConfigPath())): Promise<{ message: string; attachments?: GatewayAttachment[] }> {
  if (!Array.isArray(raw) || raw.length === 0) return { message }

  const gatewayAttachments: GatewayAttachment[] = []
  const embedded: string[] = []
  let embeddedChars = 0

  const imageNames: string[] = []
  const audioNames: string[] = []
  for (const item of raw) {
    const attachment = item as ChatSendAttachment
    if (attachment.mimeType?.startsWith("image/") && attachment.content) {
      gatewayAttachments.push(normalizeImageAttachment(attachment))
      imageNames.push(attachment.name ?? "image")
      continue
    }

    if (attachment.mimeType && isAudioAttachment(attachment) && attachment.content) {
      audioNames.push(attachment.name ?? "audio")
      const transcript = await transcribeAudioAttachment(attachment, cfg).catch(() => null)
      if (transcript) {
        embedded.push(
          `<attached-audio-transcript name="${attachment.name ?? "audio"}" mime="${audioMimeTypeForAttachment(attachment)}">\n${transcript}\n</attached-audio-transcript>`,
        )
      } else {
        // Do not forward raw audio to chat.send: current gateway attachment
        // parsing is image-oriented and drops video/webm recorder blobs before
        // the agent can use them. If transcription is unavailable, keep this as
        // prompt text only so the agent does not search for a nonexistent file.
        embedded.push(
          `[Audio transcription unavailable for ${attachment.name ?? "audio"}. Configure a Voice provider/API key in Settings → Voice, then retry the recording.]`,
        )
      }
      continue
    }

    if (attachment.mimeType && isTextAttachment(attachment.mimeType)) {
      const decoded = decodeAttachmentText(attachment)
      if (decoded !== null) {
        const remaining = MAX_TOTAL_EMBEDDED_ATTACHMENT_CHARS - embeddedChars
        const clipped = decoded.slice(0, Math.max(0, Math.min(MAX_EMBEDDED_ATTACHMENT_CHARS, remaining)))
        embeddedChars += clipped.length
        embedded.push(
          `<attached-file name="${attachment.name}" mime="${attachment.mimeType}">\n${clipped}${decoded.length > clipped.length ? "\n[Attachment truncated]" : ""}\n</attached-file>`,
        )
        continue
      }
    }

    embedded.push(
      `[Attached file: ${attachment.name ?? "unnamed"} (${attachment.mimeType || "unknown mime"}, ${attachment.size ?? "unknown"} bytes). This file type is not directly readable by the current gateway.]`,
    )
  }

  if (imageNames.length > 0) {
    embedded.unshift(imageNames.length === 1
      ? `[Attached image: ${imageNames[0]}]`
      : `[Attached images: ${imageNames.join(", ")}]`)
  }

  if (audioNames.length > 0) {
    embedded.unshift(audioNames.length === 1
      ? `[Attached audio: ${audioNames[0]}]`
      : `[Attached audio files: ${audioNames.join(", ")}]`)
  }

  return {
    message: embedded.length > 0 ? `${message}\n\n${embedded.join("\n\n")}` : message,
    attachments: gatewayAttachments.length > 0 ? gatewayAttachments : undefined,
  }
}

export const prepareMessageAndAttachmentsForTest = prepareMessageAndAttachments

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
    return { running: true, paired: true, status: "connected", error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      running: false,
      paired: !isPairingRequiredError(error),
      status: isPairingRequiredError(error) ? "pairing_required" : "disconnected",
      error: message,
    }
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

function migrationState(s: any) {
  s.commandState.telegramMigration ??= { imports: {}, groups: {} }
  s.commandState.telegramMigration.imports ??= {}
  s.commandState.telegramMigration.groups ??= {}
  return s.commandState.telegramMigration
}

function gatewaySessionsIndexPath(agentId = "main") {
  return path.join(os.homedir(), ".openclaw", "agents", agentId, "sessions", "sessions.json")
}

function readGatewaySessionsIndex(agentId = "main") {
  return readJson(gatewaySessionsIndexPath(agentId))
}

function parseTelegramSessionKey(key: string) {
  const direct = key.match(/^agent:([^:]+):telegram:direct:([^:]+)$/)
  if (direct) return { kind: "direct" as const, agentId: direct[1] || "main", userId: direct[2] || "" }
  const group = key.match(/^agent:([^:]+):telegram:group:([^:]+)(?::topic:(\d+))?$/)
  if (group) return { kind: "group" as const, agentId: group[1] || "main", groupId: group[2] || "", topicId: group[3] || null }
  return null
}

function parseJarvisLabel(label: unknown): any | null {
  if (typeof label !== "string") return null
  const marker = "\0JRV1\0"
  const index = label.indexOf(marker)
  if (index === -1) return null
  try { return JSON.parse(label.slice(index + marker.length)) } catch { return null }
}

function cleanImportedName(text: string) {
  return text
    .replace(/```json\s*\{[\s\S]*?\}\s*```/g, " ")
    .replace(/^System \(untrusted\):.*$/gmi, " ")
    .replace(/^Conversation info \(untrusted metadata\):[\s\S]*?\n\s*$/gmi, " ")
    .replace(/^Sender \(untrusted metadata\):[\s\S]*?\n\s*$/gmi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function firstTextContent(content: unknown) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((block: any) => typeof block?.text === "string" ? block.text : "").join(" ")
}

function parseConversationInfo(text: string) {
  const match = text.match(/Conversation info \(untrusted metadata\):\s*```json\s*([\s\S]*?)\s*```/i)
  if (!match) return null
  try { return JSON.parse(match[1]) } catch { return null }
}

function telegramMetaFromMessages(messages: any[]) {
  for (const message of messages) {
    const meta = parseConversationInfo(firstTextContent(message?.content))
    if (!meta) continue
    return {
      groupSubject: String(meta.group_subject || "").trim(),
      topicName: String(meta.topic_name || "").trim(),
      topicId: String(meta.topic_id || "").trim(),
      conversationLabel: String(meta.conversation_label || "").trim(),
      sender: String(meta.sender || "").trim(),
    }
  }
  return null
}

function transcriptMessagesFromJsonl(sessionFile: string) {
  return readJsonl(sessionFile)
    .filter((line: any) => line?.type === "message" || line?.message?.role)
    .map((line: any) => {
      const message = line.message ?? line
      return {
        ...message,
        timestamp: message.timestamp ?? line.timestamp,
        __openclaw: { id: line.id, seq: line.seq },
      }
    })
    .filter((message: any) => message?.role)
}

function lastUserMessagePreview(messages: any[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role !== "user") continue
    const cleaned = cleanImportedName(messageBody(message) || firstTextContent(message.content))
    if (cleaned) return cleaned
  }
  return null
}

function titleFromLastUser(messages: any[], fallback: string) {
  const preview = lastUserMessagePreview(messages)
  return (preview ? preview.slice(0, 15).trim() : fallback).trim() || fallback
}

function uniqueName(base: string, used: Set<string>) {
  const root = (base || "Telegram import").trim() || "Telegram import"
  let name = root
  let n = 2
  while (used.has(name.toLowerCase())) {
    name = `${root} (${n})`
    n += 1
  }
  used.add(name.toLowerCase())
  return name
}

function telegramGroupName(entry: any, groupId: string) {
  const jarvis = parseJarvisLabel(entry?.label)
  const candidates = [
    entry?.subject,
    entry?.origin?.label?.split(" id:")?.[0],
    jarvis?.names?.projectName,
    entry?.displayName?.replace(/^telegram:g-/, "").replace(/-/g, " "),
  ].map((value) => String(value || "").trim()).filter(Boolean)
  return candidates[0] || `Telegram group ${groupId}`
}

function telegramTopicFallback(entry: any, topicId: string | null) {
  const jarvis = parseJarvisLabel(entry?.label)
  const jarvisName = String(jarvis?.names?.chatName || jarvis?.names?.topicName || "").trim()
  if (jarvisName && !/^Telegram\s+[-\d]+$/i.test(jarvisName)) return jarvisName
  if (topicId) return `Topic ${topicId}`
  return "General"
}

function scanTelegramSessions(s: any, input: any = {}) {
  const agentId = String(input.agentId || "main")
  const index = readGatewaySessionsIndex(agentId)
  const migration = migrationState(s)
  const limit = Math.max(0, Number(input.limit || 0))
  const usedNames = new Set<string>()
  const sessions = Object.entries(index)
    .map(([sourceSessionKey, entry]: [string, any]) => {
      const parsed = parseTelegramSessionKey(sourceSessionKey)
      if (!parsed) return null
      const sourceSessionFile = String(entry?.sessionFile || "")
      const messages = sourceSessionFile ? transcriptMessagesFromJsonl(sourceSessionFile) : []
      const telegramMeta = telegramMetaFromMessages(messages)
      const lastPreview = lastUserMessagePreview(messages)
      const fallback = parsed.kind === "direct"
        ? (telegramMeta?.sender || "Telegram direct")
        : (telegramMeta?.topicName || telegramTopicFallback(entry, parsed.topicId))
      const proposedName = uniqueName(parsed.kind === "group" ? fallback : titleFromLastUser(messages, fallback), usedNames)
      return {
        sourceSessionKey,
        sourceSessionId: String(entry?.sessionId || ""),
        sourceSessionFile,
        proposedName,
        messageCount: messages.filter((message: any) => message?.role && message.role !== "system").length,
        lastUserMessagePreview: lastPreview,
        updatedAt: typeof entry?.updatedAt === "number" ? entry.updatedAt : null,
        chatType: parsed.kind,
        groupId: parsed.kind === "group" ? parsed.groupId : undefined,
        groupName: parsed.kind === "group" ? (telegramMeta?.groupSubject || telegramGroupName(entry, parsed.groupId)) : undefined,
        topicId: parsed.kind === "group" ? parsed.topicId : undefined,
        topicName: parsed.kind === "group" ? proposedName : undefined,
        alreadyImported: Boolean(migration.imports[sourceSessionKey]),
      }
    })
    .filter(Boolean) as any[]
  const selected = limit > 0 ? sessions.slice(0, limit) : sessions
  const groups = new Map<string, any>()
  for (const session of selected) {
    if (session.chatType !== "group") continue
    const current = groups.get(session.groupId) ?? { groupId: session.groupId, name: session.groupName, topics: 0 }
    current.topics += 1
    groups.set(session.groupId, current)
  }
  return {
    sessions: selected,
    summary: {
      total: selected.length,
      direct: selected.filter((session) => session.chatType === "direct").length,
      groups: groups.size,
      topics: selected.filter((session) => session.chatType === "group").length,
      alreadyImported: selected.filter((session) => session.alreadyImported).length,
    },
    groups: [...groups.values()],
  }
}

function ensureImportedGroupProject(store: Store, s: any, sourceGroupId: string, name: string) {
  const migration = migrationState(s)
  const existingProjectId = migration.groups[sourceGroupId]?.projectId
  const existing = existingProjectId ? s.projects.find((project: any) => project.id === existingProjectId) : null
  if (existing) return existing
  const createdAt = now()
  const project = { id: `proj_${crypto.randomUUID().replace(/-/g, "")}`, name, workspaceRoot: workspaceRoot(), repoRoot: null, pinned: false, archived: false, createdAt, updatedAt: createdAt }
  s.projects.push(project)
  migration.groups[sourceGroupId] = { projectId: project.id, name, importedAt: now() }
  return project
}

async function createMigratedGatewaySession(
  gw: NonNullable<Awaited<ReturnType<typeof connectGateway>>>,
  params: { key: string; agentId: string; label: string; parentSessionKey: string },
) {
  let lastError = "sessions.create failed"
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const label = attempt === 0 ? params.label : `${params.label} (${attempt + 1})`
    const key = attempt === 0 ? params.key : `agent:${params.agentId}:desktop:migrated-telegram-${crypto.randomUUID()}`
    const created = await gw.request<any>("sessions.create", {
      key,
      agentId: params.agentId,
      label,
      parentSessionKey: params.parentSessionKey,
    }, 30_000)
    if (created.ok) {
      return {
        created,
        desktopSessionKey: key,
        label,
      }
    }
    lastError = created.error?.message || lastError
    if (!/label already in use/i.test(lastError)) break
  }
  throw new Error(lastError)
}

async function importTelegramSessions(store: Store, s: any, input: any = {}) {
  const scan = scanTelegramSessions(s, input)
  const selectedKeys = Array.isArray(input.sourceSessionKeys) && input.sourceSessionKeys.length > 0
    ? new Set(input.sourceSessionKeys.map(String))
    : null
  const dryRun = Boolean(input.dryRun)
  const skipAlreadyImported = input.skipAlreadyImported !== false
  const migration = migrationState(s)
  const imported: any[] = []
  const skipped: any[] = []
  const failed: any[] = []
  const gw = dryRun ? null : await connectGateway(["operator.read", "operator.write", "operator.admin"])
  try {
    for (const session of scan.sessions) {
      if (selectedKeys && !selectedKeys.has(session.sourceSessionKey)) continue
      const parsed = parseTelegramSessionKey(session.sourceSessionKey)
      if (!parsed) continue
      if (skipAlreadyImported && migration.imports[session.sourceSessionKey]) {
        skipped.push({ sourceSessionKey: session.sourceSessionKey, reason: "already_imported" })
        continue
      }
      const sourceMessages = transcriptMessagesFromJsonl(session.sourceSessionFile)
      if (dryRun) {
        imported.push({ sourceSessionKey: session.sourceSessionKey, name: session.proposedName, copiedMessages: sourceMessages.filter((m:any) => m.role !== "system").length, dryRun: true })
        continue
      }
      try {
        const initialSessionKey = `agent:${parsed.agentId}:desktop:migrated-telegram-${crypto.randomUUID()}`
        const { created, desktopSessionKey, label } = await createMigratedGatewaySession(gw!, {
          key: initialSessionKey,
          agentId: parsed.agentId,
          label: session.proposedName,
          parentSessionKey: session.sourceSessionKey,
        })
        const transcriptPath = (created.payload as any)?.entry?.sessionFile
        if (!transcriptPath || typeof transcriptPath !== "string") throw new Error("sessions.create did not return entry.sessionFile")
        copyHistoryMessagesToTranscript(transcriptPath, sourceMessages)

        const createdAt = now()
        let chatId: string | null = null
        let projectId: string | null = null
        let topicId: string | null = null
        if (parsed.kind === "group") {
          const project = ensureImportedGroupProject(store, s, parsed.groupId, session.groupName || `Telegram group ${parsed.groupId}`)
          projectId = project.id
          topicId = `topic_${crypto.randomUUID().replace(/-/g, "")}`
          s.topics.push({ id: topicId, projectId, name: label || telegramTopicFallback({}, parsed.topicId), archived: false, pinned: false, unreadCount: 0, sortOrder: Date.now(), createdAt, updatedAt: createdAt, importedFrom: { kind: "telegram", sourceSessionKey: session.sourceSessionKey, groupId: parsed.groupId, topicId: parsed.topicId } })
          s.sessions.push({ key: desktopSessionKey, sessionKey: desktopSessionKey, label, agentId: parsed.agentId, status: "idle", hidden: false, projectId, topicId, createdAt, updatedAt: createdAt, importedFrom: { kind: "telegram", sourceSessionKey: session.sourceSessionKey } })
        } else {
          chatId = `chat_${crypto.randomUUID().replace(/-/g, "")}`
          s.chats.push({ id: chatId, name: label, sessionKey: desktopSessionKey, agentId: parsed.agentId, archived: false, pinned: false, createdAt, updatedAt: createdAt, lastActiveAt: createdAt, importedFrom: { kind: "telegram", sourceSessionKey: session.sourceSessionKey } })
        }
        migration.imports[session.sourceSessionKey] = { desktopSessionKey, chatId, projectId, topicId, name: label, importedAt: createdAt }
        imported.push({ sourceSessionKey: session.sourceSessionKey, desktopSessionKey, chatId, projectId, topicId, name: label, copiedMessages: sourceMessages.filter((m:any) => m.role !== "system").length, transcriptPath })
      } catch (error) {
        failed.push({ sourceSessionKey: session.sourceSessionKey, error: error instanceof Error ? error.message : String(error) })
      }
    }
    if (!dryRun) save(store, s)
    return { imported, skipped, failed, summary: { imported: imported.length, skipped: skipped.length, failed: failed.length } }
  } finally {
    gw?.close()
  }
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
  const models = (rawModels.length ? rawModels : refs).map(normalizeModelEntry)
  const currentModel = cfg.agents?.defaults?.model?.primary || (typeof cfg.agents?.defaults?.model === "string" ? cfg.agents.defaults.model : null) || refs[0] || null
  if (currentModel && !models.some((model: any) => `${model.provider}/${model.id}` === currentModel || model.id === currentModel)) {
    const current = normalizeModelEntry(currentModel)
    models.unshift(current)
  }
  return { models, currentModel, defaultModel: currentModel }
}

const PROVIDER_API_KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  google: "GEMINI_API_KEY",
  mistral: "MISTRAL_API_KEY",
}

function providerSummary(id: string) {
  const envVar = PROVIDER_API_KEY_ENV[id]
  const displayName = id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  const credentials = envVar
    ? [{
        key: "api-key",
        label: `${displayName} API key`,
        help: `Saved as ${envVar}`,
        group: "credentials",
        authMethod: "api-key",
        inputKind: "secret",
        required: true,
        sensitive: true,
        envVar,
      }]
    : []
  return {
    id,
    pluginId: id,
    displayName,
    category: id.includes("ollama") || id.includes("local") ? "local" : "core",
    authEnvVars: envVar ? [envVar] : [],
    authMethods: ["api-key"],
    authChoices: [],
    submit: { payloadShape: { values: { fields: { credentials, config: [] } } } },
  }
}

function saveProviderAccess(input: any) {
  const providerId = String(input.providerId || "").trim()
  if (!providerId) throw new HttpError(400, "providerId is required", "BAD_REQUEST")
  const authMethod = String(input.authMethod || "api-key")
  const values = input.values && typeof input.values === "object" ? input.values : {}
  const envVar = PROVIDER_API_KEY_ENV[providerId]
  const cfg = readJson(openclawConfigPath())
  cfg.env ??= {}
  cfg.env.vars ??= {}
  const savedEnvVars: string[] = []
  if (envVar) {
    const raw = values["api-key"] ?? values.apiKey ?? values.token ?? values.key ?? values[envVar]
    const apiKey = typeof raw === "string" ? raw.trim() : ""
    if (!apiKey) throw new HttpError(400, `${envVar} is required`, "BAD_REQUEST")
    cfg.env.vars[envVar] = apiKey
    savedEnvVars.push(envVar)
  }
  cfg.providers ??= {}
  cfg.providers[providerId] ??= {}
  cfg.providers[providerId].authMethod = authMethod
  writeJson(openclawConfigPath(), cfg)
  return ok({
    providerId,
    authMethod,
    nextStep: "model",
    saved: { envVars: savedEnvVars, configPaths: [], setDefault: input.setDefault ?? false },
    provider: providerSummary(providerId),
  })
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
            gatewayConfigured: Boolean(cfg.gateway_url || cfg.gateway?.port || gateway.running || gateway.paired === false),
            gatewayUrl: cfg.gateway_url || `ws://127.0.0.1:${cfg.gateway?.port || 18789}`,
            gatewayToken: cfg.gateway?.auth?.token ? "configured" : null,
            hasConnection: gateway.running && gateway.paired !== false,
            hasIdentity: fs.existsSync(path.join(os.homedir(), ".openclaw", "state", "identity", "device.json")),
            status: gateway.status,
            error: gateway.error ?? null,
          }
        }
        case "middleware_connect_bootstrap": {
          const cfg = readJson(openclawConfigPath())
          const gateway = await gatewayStatus()
          return {
            ok: gateway.running && gateway.paired !== false,
            gatewayUrl: cfg.gateway_url || `ws://127.0.0.1:${cfg.gateway?.port || 18789}`,
            status: gateway.status,
            error: gateway.error ?? null,
          }
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
          cfg.agents ??= {}; cfg.agents.defaults ??= {}; cfg.agents.defaults.model ??= {}
          if (typeof cfg.agents.defaults.model === "string") cfg.agents.defaults.model = { primary: cfg.agents.defaults.model }
          cfg.agents.defaults.model.primary = modelId
          writeJson(openclawConfigPath(), cfg)
          return ok({ modelId, currentModel: modelId, defaultModel: modelId })
        }
        case "middleware_voice_settings_get": {
          return voiceSettingsPayloadWithStatus()
        }
        case "middleware_voice_settings_set": {
          writeVoiceSettings(input)
          return voiceSettingsPayloadWithStatus()
        }
        case "middleware_voice_transcribe": {
          const attachment = input.attachment as ChatSendAttachment | undefined
          if (!attachment?.content || !attachment.mimeType || !isAudioAttachment(attachment)) {
            throw new HttpError(400, "audio attachment is required", "BAD_REQUEST")
          }
          const transcript = await transcribeAudioAttachment(attachment)
          if (!transcript) {
            throw new HttpError(400, "Voice transcription is not configured. Add a Voice provider/API key in Settings → Voice.", "VOICE_TRANSCRIPTION_UNAVAILABLE")
          }
          return { transcript }
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
        case "middleware_migration_telegram_scan": return scanTelegramSessions(s, input)
        case "middleware_migration_telegram_import": return importTelegramSessions(store, s, input)

        case "middleware_chat_history": {
          if (!input.sessionKey) throw new HttpError(400, "sessionKey is required", "BAD_REQUEST")
          const key = activeSessionKey(s, input.sessionKey)
          const localEntry = readSessionStoreEntry(key)
          const sessionFile = String(localEntry?.entry?.sessionFile || "")
          if (sessionFile && fs.existsSync(sessionFile)) {
            return normalizeHistoryPayload({ messages: transcriptMessagesFromJsonl(sessionFile) })
          }

          const timeoutMs = Math.max(1_000, Math.min(Number(input.timeoutMs) || 30_000, 30_000))
          const limit = Math.max(1, Math.min(Number(input.limit) || 1000, 1000))
          return await withGatewayReadRetry(async () => {
            let gw: Awaited<ReturnType<typeof connectGateway>> | null = null
            try {
              gw = await connectGateway(["operator.read", "operator.write"])
              const res = await gw.request("chat.history", { sessionKey: key, limit }, timeoutMs)
              if (!res.ok) throw new HttpError(502, res.error?.message || "chat.history failed", "GATEWAY_ERROR")
              return normalizeHistoryPayload(res.payload)
            } catch (error) {
              if (isPairingRequiredError(error)) return normalizeHistoryPayload({ messages: [] })
              throw error
            } finally {
              gw?.close()
            }
          })
        }
        case "middleware_exec_approval_resolve": {
          const approvalId = String(input.approvalId || input.id || "").trim()
          const decision = String(input.decision || "").trim()
          if (!approvalId) throw new HttpError(400, "approvalId is required", "BAD_REQUEST")
          if (!["allow-once", "allow-always", "deny"].includes(decision)) throw new HttpError(400, "valid decision is required", "BAD_REQUEST")
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin", "operator.approvals"])
          try {
            const res = await gw.request("exec.approval.resolve", { id: approvalId, decision }, 30_000)
            if (!res.ok) throw new HttpError(502, res.error?.message || "exec.approval.resolve failed", "GATEWAY_ERROR")
            return { ok: true, approvalId, decision, ...((res.payload as object) || {}) }
          } finally {
            gw.close()
          }
        }

        case "middleware_chat_exec_policy": {
          if (!input.sessionKey) throw new HttpError(400, "sessionKey is required", "BAD_REQUEST")
          const key = activeSessionKey(s, input.sessionKey)
          const rawPolicy = input.execPolicy && typeof input.execPolicy === "object" ? input.execPolicy as any : null
          const execSecurity = rawPolicy?.security === "allowlist" || rawPolicy?.security === "full" ? rawPolicy.security : null
          const execAsk = rawPolicy?.ask === "off" || rawPolicy?.ask === "on-miss" || rawPolicy?.ask === "always" ? rawPolicy.ask : null
          if (!execSecurity || !execAsk) throw new HttpError(400, "valid execPolicy is required", "BAD_REQUEST")
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin"])
          try {
            await gw.request("sessions.create", { key, agentId: input.agentId || "main", label: input.label || "New Chat" }, 30_000).catch(() => null)
            const patched = await gw.request("sessions.patch", { key, execSecurity, execAsk }, 30_000)
            if (!patched.ok) throw new HttpError(502, patched.error?.message || "sessions.patch failed", "GATEWAY_ERROR")
            return { ok: true, sessionKey: key, autonomyMode: input.autonomyMode, execPolicy: { security: execSecurity, ask: execAsk }, ...((patched.payload as object) || {}) }
          } finally {
            gw.close()
          }
        }

        case "middleware_chat_model_set": {
          if (!input.sessionKey) throw new HttpError(400, "sessionKey is required", "BAD_REQUEST")
          const modelId = String(input.modelId || input.modelRef || input.model || "").trim()
          if (!modelId) throw new HttpError(400, "modelId is required", "BAD_REQUEST")
          const key = activeSessionKey(s, input.sessionKey)
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin"])
          try {
            await gw.request("sessions.create", { key, agentId: input.agentId || "main", label: input.label || "New Chat" }, 30_000).catch(() => null)
            const patched = await gw.request("sessions.patch", { key, model: modelId }, 30_000)
            if (!patched.ok) throw new HttpError(502, patched.error?.message || "sessions.patch failed", "GATEWAY_ERROR")
            return { ok: true, sessionKey: key, modelId, currentModel: modelId, ...((patched.payload as object) || {}) }
          } finally {
            gw.close()
          }
        }

        case "middleware_chat_send": {
          const message = String(input.text || input.message || "")
          if (!message.trim()) throw new HttpError(400, "message is required", "BAD_REQUEST")
          const key = input.sessionKey ? activeSessionKey(s, input.sessionKey) : `agent:main:desktop:${crypto.randomUUID()}`
          const beforeCommandSession = readSessionStoreEntry(key)
          const rawPolicy = input.execPolicy && typeof input.execPolicy === "object" ? input.execPolicy as any : null
          const execSecurity = rawPolicy?.security === "allowlist" || rawPolicy?.security === "full" ? rawPolicy.security : null
          const execAsk = rawPolicy?.ask === "off" || rawPolicy?.ask === "on-miss" || rawPolicy?.ask === "always" ? rawPolicy.ask : null
          const shouldPatchExecPolicy = input.execPolicy === null || execSecurity || execAsk
          const gw = await connectGateway(["operator.read", "operator.write", "operator.admin"])
          try {
            await gw.request("sessions.create", { key, agentId: input.agentId || "main", label: input.label || "New Chat" }, 30_000).catch(() => null)
            const verbosePatch = await gw.request("sessions.patch", { key, verboseLevel: "full" }, 30_000)
            if (!verbosePatch.ok) throw new HttpError(502, verbosePatch.error?.message || "sessions.patch failed", "GATEWAY_ERROR")
            if (shouldPatchExecPolicy) {
              const patch = input.execPolicy === null
                ? { key, execSecurity: null, execAsk: null }
                : { key, execSecurity, execAsk }
              const patched = await gw.request("sessions.patch", patch, 30_000)
              if (!patched.ok) throw new HttpError(502, patched.error?.message || "sessions.patch failed", "GATEWAY_ERROR")
            }
            const prepared = await prepareMessageAndAttachments(message, input.attachments)
            const res = await gw.request("chat.send", {
              sessionKey: key,
              message: prepared.message,
              timeoutMs: input.timeoutMs || 120_000,
              idempotencyKey: crypto.randomUUID(),
              ...(prepared.attachments ? { attachments: prepared.attachments } : {}),
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

        case "middleware_spaces_list": {
          const active = ensureDefaultSpace(s); save(store, s)
          return { spaces: s.spaces.filter((space:any)=>!space.archived && !space.deleted).sort((a:any,b:any)=>(a.sortOrder ?? 0) - (b.sortOrder ?? 0)), activeSpaceId: s.activeSpaceId || active?.id }
        }
        case "middleware_spaces_create": {
          ensureDefaultSpace(s)
          const timestamp = now()
          const maxSort = Math.max(0, ...s.spaces.map((space:any)=>Number(space.sortOrder || 0)))
          const space = { id: `space_${crypto.randomUUID().replace(/-/g, "")}`, name: String(input.name || "New Space").trim() || "New Space", repoRoot: input.repoRoot || null, projectId: input.projectId || null, sortOrder: maxSort + 1, archived: false, createdAt: timestamp, updatedAt: timestamp }
          s.spaces.push(space); s.activeSpaceId = space.id; save(store, s); return { space, activeSpaceId: space.id }
        }
        case "middleware_spaces_update": {
          const space = s.spaces.find((x:any)=>x.id===input.spaceId && !x.archived && !x.deleted)
          if (!space) throw new HttpError(404, "Space not found", "NOT_FOUND")
          if (input.name !== undefined) { const name = String(input.name || "").trim(); if (!name) throw new HttpError(400, "Space name cannot be empty", "BAD_REQUEST"); space.name = name }
          if (input.repoRoot !== undefined) space.repoRoot = input.repoRoot ? String(input.repoRoot).trim() : null
          if (input.projectId !== undefined) space.projectId = input.projectId ? String(input.projectId).trim() : null
          space.updatedAt = now(); save(store, s); return { space }
        }
        case "middleware_spaces_switch": {
          const space = s.spaces.find((x:any)=>x.id===input.spaceId && !x.archived && !x.deleted)
          if (!space) throw new HttpError(404, "Space not found", "NOT_FOUND")
          s.activeSpaceId = input.spaceId; save(store, s); return { activeSpaceId: input.spaceId }
        }
        case "middleware_spaces_delete": {
          const activeSpaces = s.spaces.filter((x:any)=>!x.archived && !x.deleted)
          if (activeSpaces.length <= 1) throw new HttpError(400, "Cannot delete the last space", "BAD_REQUEST")
          const space = activeSpaces.find((x:any)=>x.id===input.spaceId)
          if (!space) throw new HttpError(404, "Space not found", "NOT_FOUND")
          const fallback = s.activeSpaceId && s.activeSpaceId !== input.spaceId ? s.activeSpaceId : activeSpaces.find((x:any)=>x.id!==input.spaceId)?.id
          space.archived = true; space.updatedAt = now()
          for (const chat of (s.chats ?? []).filter((chat:any)=>chat.spaceId===input.spaceId)) { chat.archived = true; chat.updatedAt = now() }
          s.activeSpaceId = fallback || null; save(store, s); return { ok: true, activeSpaceId: s.activeSpaceId }
        }

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
        case "middleware_onboarding_provider_submit": return saveProviderAccess(input)
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
