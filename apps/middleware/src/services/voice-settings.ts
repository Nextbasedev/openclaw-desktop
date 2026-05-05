import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export type VoiceModelProvider = "auto" | "openai" | "groq" | "deepgram" | "google" | "mistral"

export type VoiceSettings = {
  enabled: boolean
  provider: VoiceModelProvider
  model: string
  language: string
  echoTranscript: boolean
}

const DEFAULT_MODELS: Record<Exclude<VoiceModelProvider, "auto">, string> = {
  openai: "gpt-4o-transcribe",
  groq: "whisper-large-v3-turbo",
  deepgram: "nova-3",
  google: "gemini-3-flash-preview",
  mistral: "voxtral-mini-latest",
}

export const VOICE_MODEL_OPTIONS = [
  { provider: "auto", model: "", label: "Auto - best available" },
  { provider: "openai", model: DEFAULT_MODELS.openai, label: "OpenAI - gpt-4o-transcribe" },
  { provider: "openai", model: "gpt-4o-mini-transcribe", label: "OpenAI - gpt-4o-mini-transcribe" },
  { provider: "openai", model: "whisper-1", label: "OpenAI - whisper-1" },
  { provider: "groq", model: DEFAULT_MODELS.groq, label: "Groq - whisper-large-v3-turbo" },
  { provider: "groq", model: "whisper-large-v3", label: "Groq - whisper-large-v3" },
  { provider: "deepgram", model: DEFAULT_MODELS.deepgram, label: "Deepgram - nova-3" },
  { provider: "deepgram", model: "nova-2", label: "Deepgram - nova-2" },
  { provider: "google", model: DEFAULT_MODELS.google, label: "Google - gemini-3-flash-preview" },
  { provider: "google", model: "gemini-2.5-flash", label: "Google - gemini-2.5-flash" },
  { provider: "mistral", model: DEFAULT_MODELS.mistral, label: "Mistral - voxtral-mini-latest" },
  { provider: "mistral", model: "voxtral-small-latest", label: "Mistral - voxtral-small-latest" },
] as const

export function openclawConfigPath() {
  return process.env.OPENCLAW_CONFIG_PATH || path.join(os.homedir(), ".openclaw", "openclaw.json")
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return {}
  }
}

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

function normalizeProvider(value: unknown): VoiceModelProvider {
  const provider = String(value || "auto").trim().toLowerCase()
  if (["openai", "groq", "deepgram", "google", "mistral"].includes(provider)) {
    return provider as VoiceModelProvider
  }
  return "auto"
}

function defaultModelForProvider(provider: VoiceModelProvider): string {
  return provider === "auto" ? "" : DEFAULT_MODELS[provider]
}

export function readVoiceSettings(config = readJson(openclawConfigPath())): VoiceSettings {
  const audio = config?.tools?.media?.audio && typeof config.tools.media.audio === "object"
    ? config.tools.media.audio
    : {}
  const firstModel = Array.isArray(audio.models) ? audio.models[0] : null
  const provider = normalizeProvider(firstModel?.provider)
  return {
    enabled: audio.enabled !== false,
    provider,
    model: provider === "auto" ? "" : String(firstModel?.model || defaultModelForProvider(provider)),
    language: String(audio.language || "").trim(),
    echoTranscript: Boolean(audio.echoTranscript),
  }
}

export function writeVoiceSettings(input: Partial<VoiceSettings>): VoiceSettings {
  const cfg = readJson(openclawConfigPath())
  cfg.tools ??= {}
  cfg.tools.media ??= {}
  cfg.tools.media.audio ??= {}

  const provider = normalizeProvider(input.provider)
  const model = String(input.model || defaultModelForProvider(provider)).trim()
  const language = String(input.language || "").trim()
  const enabled = input.enabled !== false
  const echoTranscript = Boolean(input.echoTranscript)

  cfg.tools.media.audio.enabled = enabled
  cfg.tools.media.audio.language = language || undefined
  cfg.tools.media.audio.echoTranscript = echoTranscript
  if (provider === "auto") {
    delete cfg.tools.media.audio.models
  } else {
    cfg.tools.media.audio.models = [
      {
        type: "provider",
        provider,
        model: model || defaultModelForProvider(provider),
      },
    ]
  }

  writeJson(openclawConfigPath(), cfg)
  return readVoiceSettings(cfg)
}

export function voiceSettingsPayload() {
  return {
    settings: readVoiceSettings(),
    options: VOICE_MODEL_OPTIONS,
  }
}
