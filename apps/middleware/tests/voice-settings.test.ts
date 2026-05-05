import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readVoiceSettings, writeVoiceSettings } from "../src/services/voice-settings.js"

let tempDir: string
let configPath: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-voice-settings-"))
  configPath = path.join(tempDir, "openclaw.json")
  process.env.OPENCLAW_CONFIG_PATH = configPath
})

afterEach(() => {
  delete process.env.OPENCLAW_CONFIG_PATH
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe("voice settings", () => {
  it("writes a provider model into tools.media.audio.models", () => {
    const settings = writeVoiceSettings({
      provider: "groq",
      model: "whisper-large-v3-turbo",
      language: "en",
      echoTranscript: true,
    })

    expect(settings).toEqual({
      enabled: true,
      provider: "groq",
      model: "whisper-large-v3-turbo",
      language: "en",
      echoTranscript: true,
    })
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"))
    expect(cfg.tools.media.audio.models).toEqual([
      { type: "provider", provider: "groq", model: "whisper-large-v3-turbo" },
    ])
    expect(cfg.tools.media.audio.language).toBe("en")
    expect(cfg.tools.media.audio.echoTranscript).toBe(true)
  })

  it("removes explicit models when provider is auto", () => {
    writeVoiceSettings({ provider: "openai", model: "gpt-4o-transcribe" })
    const settings = writeVoiceSettings({ provider: "auto", model: "ignored", language: "" })

    expect(settings.provider).toBe("auto")
    expect(settings.model).toBe("")
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"))
    expect(cfg.tools.media.audio.models).toBeUndefined()
  })

  it("reads existing audio model config", () => {
    fs.writeFileSync(configPath, JSON.stringify({
      tools: {
        media: {
          audio: {
            enabled: true,
            language: "hi",
            echoTranscript: false,
            models: [{ type: "provider", provider: "deepgram", model: "nova-3" }],
          },
        },
      },
    }))

    expect(readVoiceSettings()).toEqual({
      enabled: true,
      provider: "deepgram",
      model: "nova-3",
      language: "hi",
      echoTranscript: false,
    })
  })

  it("preserves existing provider env vars when saving voice settings", () => {
    fs.writeFileSync(configPath, JSON.stringify({
      env: { vars: { GROQ_API_KEY: "gsk_existing_key" } },
      providers: { groq: { authMethod: "api-key" } },
    }))

    writeVoiceSettings({ provider: "groq", model: "whisper-large-v3-turbo" })

    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"))
    expect(cfg.env.vars.GROQ_API_KEY).toBe("gsk_existing_key")
    expect(cfg.providers.groq.authMethod).toBe("api-key")
    expect(cfg.tools.media.audio.models).toEqual([
      { type: "provider", provider: "groq", model: "whisper-large-v3-turbo" },
    ])
  })
})
