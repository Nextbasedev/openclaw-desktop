"use client"

import * as React from "react"
import { LuCheck, LuChevronDown, LuInfo, LuMic, LuSettings2 } from "react-icons/lu"

import { cn } from "@/lib/utils"
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

const PROVIDER_COPY: Record<VoiceProvider, { name: string; note: string; initial: string }> = {
  auto: {
    name: "Auto",
    note: "Recommended. Gateway tries configured providers, then local STT fallbacks.",
    initial: "A",
  },
  openai: {
    name: "OpenAI",
    note: "Use when an OpenAI API key is configured.",
    initial: "O",
  },
  groq: {
    name: "Groq",
    note: "Fast Whisper transcription with a Groq key.",
    initial: "G",
  },
  deepgram: {
    name: "Deepgram",
    note: "Dedicated speech-to-text provider for voice-heavy use.",
    initial: "D",
  },
  google: {
    name: "Google",
    note: "Gemini audio transcription through Google credentials.",
    initial: "G",
  },
  mistral: {
    name: "Mistral",
    note: "Voxtral transcription through a Mistral key.",
    initial: "M",
  },
}

const defaultSettings: VoiceSettings = {
  enabled: true,
  provider: "auto",
  model: "",
  language: "",
  echoTranscript: false,
}

function optionValue(option: VoiceOption) {
  return option.provider === "auto" ? "auto" : `${option.provider}/${option.model}`
}

function currentValue(settings: VoiceSettings) {
  return settings.provider === "auto" ? "auto" : `${settings.provider}/${settings.model}`
}

function statusClass(tone: "muted" | "success" | "error") {
  if (tone === "error") return "border-red-500/20 bg-red-500/10 text-red-400"
  if (tone === "success") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
  return "border-border/40 bg-foreground/[0.04] text-muted-foreground"
}

export function VoiceTab() {
  const [settings, setSettings] = React.useState<VoiceSettings | null>(null)
  const [options, setOptions] = React.useState<VoiceOption[]>(FALLBACK_OPTIONS)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<{ tone: "muted" | "success" | "error"; message: string } | null>(null)

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
        setSettings(defaultSettings)
        setStatus({ tone: "error", message: error instanceof Error ? error.message : "Could not load voice settings" })
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
    setStatus({ tone: "muted", message: "Saving voice settings..." })
    try {
      const payload = await invoke<VoiceSettingsPayload>("middleware_voice_settings_set", { input: next })
      setSettings(payload.settings)
      setOptions(payload.options?.length ? payload.options : options)
      setStatus({ tone: "success", message: "Saved. New voice messages will use this transcription setup." })
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Could not save voice settings" })
    } finally {
      setSaving(false)
    }
  }

  const current = settings ?? defaultSettings
  const selectedValue = currentValue(current)
  const selectedMeta = PROVIDER_COPY[current.provider]
  const selectedModel = current.provider === "auto" ? "Gateway fallback chain" : current.model

  return (
    <div className="flex flex-col gap-5 pb-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Voice</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Speech-to-text settings for chat mic messages.
        </p>
      </div>

      <section className="overflow-hidden rounded-lg border border-border/50 bg-card/70">
        <div className="flex items-start gap-3 border-b border-border/35 bg-foreground/[0.035] px-4 py-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background/70 text-muted-foreground">
            <LuMic size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-[14px] font-medium text-foreground">Current transcription</h3>
              {saving && <span className="text-[11px] text-muted-foreground">Saving…</span>}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              <span className="text-foreground">{selectedMeta.name}</span>
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              <span className="font-mono text-[11px]">{selectedModel}</span>
            </p>
          </div>
        </div>

        <div className="divide-y divide-border/30">
          {options.map((option) => {
            const value = optionValue(option)
            const selected = selectedValue === value
            const copy = PROVIDER_COPY[option.provider]

            return (
              <button
                key={value}
                type="button"
                disabled={loading || saving}
                onClick={() => { void save({ ...current, provider: option.provider, model: option.model }) }}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-60",
                  selected ? "bg-foreground/[0.055]" : "hover:bg-foreground/[0.035]",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md border text-[12px] font-semibold",
                    selected
                      ? "border-foreground/25 bg-foreground text-background"
                      : "border-border/50 bg-background/50 text-muted-foreground",
                  )}
                >
                  {selected ? <LuCheck size={14} /> : copy.initial}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-medium text-foreground">{copy.name}</span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground/70">
                      {option.model || "automatic"}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
                    {copy.note}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="rounded-lg border border-border/50 bg-card/70">
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/[0.035]"
        >
          <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
            <LuSettings2 size={15} />
            Advanced options
          </span>
          <LuChevronDown
            size={15}
            className={cn("text-muted-foreground transition-transform", advancedOpen && "rotate-180")}
          />
        </button>

        {advancedOpen && (
          <div className="space-y-4 border-t border-border/35 px-4 py-4">
            {current.provider !== "auto" && (
              <label className="block text-[12px] font-medium text-muted-foreground">
                Model ID
                <input
                  value={current.model}
                  disabled={loading || saving}
                  onChange={(event) => setSettings({ ...current, model: event.target.value })}
                  onBlur={(event) => { void save({ ...current, model: event.target.value }) }}
                  className="mt-2 w-full rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/30 disabled:opacity-60"
                  placeholder="model-name"
                />
              </label>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[12px] font-medium text-muted-foreground">
                Language hint
                <input
                  value={current.language}
                  disabled={loading || saving}
                  onChange={(event) => setSettings({ ...current, language: event.target.value })}
                  onBlur={(event) => { void save({ ...current, language: event.target.value }) }}
                  className="mt-2 w-full rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/30 disabled:opacity-60"
                  placeholder="auto, en, hi..."
                />
              </label>

              <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-foreground/[0.035] px-3 py-2.5">
                <div>
                  <p className="text-[12px] font-medium text-foreground">Echo transcript</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Show transcript in chat.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={current.echoTranscript}
                  disabled={loading || saving}
                  onClick={() => { void save({ ...current, echoTranscript: !current.echoTranscript }) }}
                  className={cn(
                    "relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                    current.echoTranscript ? "bg-foreground" : "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "block size-[18px] rounded-full bg-background shadow-sm transition-transform",
                      current.echoTranscript ? "translate-x-5" : "translate-x-0.5",
                    )}
                  />
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/50 bg-foreground/[0.035] px-4 py-3">
        <div className="flex gap-3">
          <LuInfo size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 text-[12px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">How user sets it</p>
            <p className="mt-1">
              Add the provider API key in OpenClaw onboarding/config, then select that provider here. Auto needs no extra choice and uses Gateway fallback.
            </p>
            <p className="mt-2 truncate">
              Saved in <code className="text-foreground">~/.openclaw/openclaw.json</code> → <code className="text-foreground">tools.media.audio</code>
            </p>
          </div>
        </div>
      </section>

      {status && (
        <div className={cn("rounded-md border px-3 py-2 text-[12px]", statusClass(status.tone))}>
          {status.message}
        </div>
      )}
    </div>
  )
}
