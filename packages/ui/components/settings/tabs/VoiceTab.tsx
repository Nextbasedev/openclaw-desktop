"use client"

import * as React from "react"
import { invoke } from "@/lib/ipc"

type VoiceProvider = "auto" | "openai" | "groq" | "deepgram" | "google" | "mistral"

type VoiceSettings = {
  enabled: boolean
  provider: VoiceProvider
  model: string
  language: string
  echoTranscript: boolean
}

type VoiceOption = {
  provider: VoiceProvider
  model: string
  label: string
}

type VoiceSettingsPayload = {
  settings: VoiceSettings
  options: VoiceOption[]
}

const FALLBACK_OPTIONS: VoiceOption[] = [
  { provider: "auto", model: "", label: "Auto - best available" },
  { provider: "openai", model: "gpt-4o-transcribe", label: "OpenAI - gpt-4o-transcribe" },
  { provider: "groq", model: "whisper-large-v3-turbo", label: "Groq - whisper-large-v3-turbo" },
  { provider: "deepgram", model: "nova-3", label: "Deepgram - nova-3" },
  { provider: "google", model: "gemini-3-flash-preview", label: "Google - gemini-3-flash-preview" },
  { provider: "mistral", model: "voxtral-mini-latest", label: "Mistral - voxtral-mini-latest" },
]

function optionValue(option: VoiceOption) {
  return option.provider === "auto" ? "auto" : `${option.provider}/${option.model}`
}

function parseOptionValue(value: string, options: VoiceOption[]): Pick<VoiceSettings, "provider" | "model"> {
  if (value === "auto") return { provider: "auto", model: "" }
  const match = options.find((option) => optionValue(option) === value)
  if (match) return { provider: match.provider, model: match.model }
  const [provider, ...modelParts] = value.split("/")
  return {
    provider: (["openai", "groq", "deepgram", "google", "mistral"].includes(provider) ? provider : "auto") as VoiceProvider,
    model: modelParts.join("/"),
  }
}

export function VoiceTab() {
  const [settings, setSettings] = React.useState<VoiceSettings | null>(null)
  const [options, setOptions] = React.useState<VoiceOption[]>(FALLBACK_OPTIONS)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const payload = await invoke<VoiceSettingsPayload>("middleware_voice_settings_get")
        if (cancelled) return
        setSettings(payload.settings)
        setOptions(payload.options?.length ? payload.options : FALLBACK_OPTIONS)
        setStatus(null)
      } catch (error) {
        if (cancelled) return
        setSettings({ enabled: true, provider: "auto", model: "", language: "", echoTranscript: false })
        setStatus(error instanceof Error ? error.message : "Could not load voice settings")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  async function save(next: VoiceSettings) {
    setSettings(next)
    setSaving(true)
    setStatus("Saving voice model...")
    try {
      const payload = await invoke<VoiceSettingsPayload>("middleware_voice_settings_set", { input: next })
      setSettings(payload.settings)
      setOptions(payload.options?.length ? payload.options : options)
      setStatus("Voice model saved. New voice messages will use this transcription model.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save voice settings")
    } finally {
      setSaving(false)
    }
  }

  const current = settings ?? { enabled: true, provider: "auto", model: "", language: "", echoTranscript: false }
  const selectedValue = current.provider === "auto" ? "auto" : `${current.provider}/${current.model}`

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Voice</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the speech-to-text model used when you send voice messages.
        </p>
      </div>

      <div className="overflow-hidden rounded-md border border-border/50 bg-card">
        <div className="px-5 py-4">
          <h3 className="text-[13px] font-medium text-foreground">Voice model</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Desktop records audio and Gateway transcribes it before the chat model responds.
          </p>

          <label className="mt-4 block text-[12px] font-medium text-muted-foreground">
            Transcription provider
          </label>
          <select
            value={selectedValue}
            disabled={loading || saving}
            onChange={(event) => {
              const selected = parseOptionValue(event.target.value, options)
              void save({ ...current, ...selected })
            }}
            className="mt-2 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-foreground/30 disabled:opacity-60"
          >
            {options.map((option) => (
              <option key={optionValue(option)} value={optionValue(option)}>
                {option.label}
              </option>
            ))}
          </select>

          {current.provider !== "auto" && (
            <div className="mt-4">
              <label className="block text-[12px] font-medium text-muted-foreground">
                Model ID
              </label>
              <input
                value={current.model}
                disabled={loading || saving}
                onChange={(event) => setSettings({ ...current, model: event.target.value })}
                onBlur={() => { void save(current) }}
                className="mt-2 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-foreground/30 disabled:opacity-60"
                placeholder="model-name"
              />
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-[12px] font-medium text-muted-foreground">
              Language hint
              <input
                value={current.language}
                disabled={loading || saving}
                onChange={(event) => setSettings({ ...current, language: event.target.value })}
                onBlur={() => { void save(current) }}
                className="mt-2 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-foreground/30 disabled:opacity-60"
                placeholder="auto, en, hi..."
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-muted/10 px-3 py-3 text-[12px] font-medium text-muted-foreground">
              Echo transcript in chat
              <input
                type="checkbox"
                checked={current.echoTranscript}
                disabled={loading || saving}
                onChange={(event) => { void save({ ...current, echoTranscript: event.target.checked }) }}
                className="size-4 accent-foreground"
              />
            </label>
          </div>

          {status && (
            <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
              {status}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
