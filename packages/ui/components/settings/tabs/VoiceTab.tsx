"use client"

import * as React from "react"
import { LuCheck, LuChevronDown, LuInfo, LuMic, LuSettings2, LuSparkles } from "react-icons/lu"
import { SiDeepgram, SiGooglegemini, SiMistralai, SiOpenai } from "react-icons/si"

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
  { provider: "openai", model: "gpt-4o-mini-transcribe", label: "OpenAI - gpt-4o-mini-transcribe" },
  { provider: "openai", model: "whisper-1", label: "OpenAI - whisper-1" },
  { provider: "groq", model: "whisper-large-v3-turbo", label: "Groq - whisper-large-v3-turbo" },
  { provider: "groq", model: "whisper-large-v3", label: "Groq - whisper-large-v3" },
  { provider: "deepgram", model: "nova-3", label: "Deepgram - nova-3" },
  { provider: "deepgram", model: "nova-2", label: "Deepgram - nova-2" },
  { provider: "google", model: "gemini-3-flash-preview", label: "Google - gemini-3-flash-preview" },
  { provider: "google", model: "gemini-2.5-flash", label: "Google - gemini-2.5-flash" },
  { provider: "mistral", model: "voxtral-mini-latest", label: "Mistral - voxtral-mini-latest" },
  { provider: "mistral", model: "voxtral-small-latest", label: "Mistral - voxtral-small-latest" },
]

const PROVIDER_ORDER: VoiceProvider[] = ["auto", "openai", "groq", "deepgram", "google", "mistral"]

const PROVIDER_COPY: Record<VoiceProvider, { name: string; note: string; defaultModel: string }> = {
  auto: {
    name: "Auto",
    note: "Gateway fallback chain",
    defaultModel: "",
  },
  openai: {
    name: "OpenAI",
    note: "Uses your OpenAI key",
    defaultModel: "gpt-4o-transcribe",
  },
  groq: {
    name: "Groq",
    note: "Fast Whisper STT",
    defaultModel: "whisper-large-v3-turbo",
  },
  deepgram: {
    name: "Deepgram",
    note: "Dedicated STT",
    defaultModel: "nova-3",
  },
  google: {
    name: "Google",
    note: "Gemini audio",
    defaultModel: "gemini-3-flash-preview",
  },
  mistral: {
    name: "Mistral",
    note: "Voxtral audio",
    defaultModel: "voxtral-mini-latest",
  },
}

const defaultSettings: VoiceSettings = {
  enabled: true,
  provider: "auto",
  model: "",
  language: "",
  echoTranscript: false,
}

function ProviderLogo({ provider, selected }: { provider: VoiceProvider; selected?: boolean }) {
  const className = cn("size-4", selected ? "text-background" : "text-foreground/80")
  if (provider === "openai") return <SiOpenai className={className} />
  if (provider === "deepgram") return <SiDeepgram className={className} />
  if (provider === "google") return <SiGooglegemini className={className} />
  if (provider === "mistral") return <SiMistralai className={className} />
  if (provider === "auto") return <LuSparkles className={className} />
  return <span className={cn("text-[11px] font-semibold", selected ? "text-background" : "text-foreground/80")}>G</span>
}

function uniqueProviders(options: VoiceOption[]): VoiceProvider[] {
  const available = new Set(options.map((option) => option.provider))
  return PROVIDER_ORDER.filter((provider) => provider === "auto" || available.has(provider))
}

function modelsForProvider(options: VoiceOption[], provider: VoiceProvider, currentModel: string): VoiceOption[] {
  if (provider === "auto") return []
  const providerOptions = options.filter((option) => option.provider === provider && option.model)
  if (currentModel && !providerOptions.some((option) => option.model === currentModel)) {
    return [...providerOptions, { provider, model: currentModel, label: `${PROVIDER_COPY[provider].name} - ${currentModel}` }]
  }
  return providerOptions
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
  const [customModelOpen, setCustomModelOpen] = React.useState(false)
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
        setCustomModelOpen(false)
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
  const providers = uniqueProviders(options)
  const modelOptions = modelsForProvider(options, current.provider, current.model)
  const selectedMeta = PROVIDER_COPY[current.provider]
  const selectedModel = current.provider === "auto" ? "Automatic fallback" : current.model

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

        <div className="space-y-4 p-4">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
              Audio provider
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {providers.map((provider) => {
                const selected = current.provider === provider
                const copy = PROVIDER_COPY[provider]
                return (
                  <button
                    key={provider}
                    type="button"
                    disabled={loading || saving}
                    onClick={() => {
                      const model = provider === "auto" ? "" : copy.defaultModel
                      setCustomModelOpen(false)
                      void save({ ...current, provider, model })
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-60",
                      selected
                        ? "border-foreground/25 bg-foreground text-background"
                        : "border-border/50 bg-background/45 text-foreground hover:bg-foreground/[0.04]",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-md border",
                        selected ? "border-background/20 bg-background/10" : "border-border/45 bg-foreground/[0.035]",
                      )}
                    >
                      <ProviderLogo provider={provider} selected={selected} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{copy.name}</span>
                      <span className={cn("block truncate text-[10px]", selected ? "text-background/70" : "text-muted-foreground")}>{copy.note}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className={cn(current.provider === "auto" && "opacity-60")}>
            <label className="block text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
              Audio model
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <div className="relative">
                <select
                  value={current.provider === "auto" ? "auto" : current.model}
                  disabled={loading || saving || current.provider === "auto"}
                  onChange={(event) => {
                    if (event.target.value === "__custom") {
                      setCustomModelOpen(true)
                      return
                    }
                    setCustomModelOpen(false)
                    void save({ ...current, model: event.target.value })
                  }}
                  className="h-9 w-full appearance-none rounded-md border border-border/60 bg-background/70 px-3 pr-9 text-[13px] text-foreground outline-none transition-colors focus:border-foreground/30 disabled:opacity-60"
                >
                  {current.provider === "auto" ? (
                    <option value="auto">Automatic fallback chain</option>
                  ) : (
                    <>
                      {modelOptions.map((option) => (
                        <option key={`${option.provider}/${option.model}`} value={option.model}>{option.model}</option>
                      ))}
                      <option value="__custom">Custom model ID…</option>
                    </>
                  )}
                </select>
                <LuChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
              {current.provider !== "auto" && (
                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={() => setCustomModelOpen((open) => !open)}
                  className="rounded-md border border-border/50 px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-60"
                >
                  Custom
                </button>
              )}
            </div>
            {customModelOpen && current.provider !== "auto" && (
              <input
                value={current.model}
                disabled={loading || saving}
                onChange={(event) => setSettings({ ...current, model: event.target.value })}
                onBlur={(event) => { void save({ ...current, model: event.target.value }) }}
                className="mt-2 w-full rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/30 disabled:opacity-60"
                placeholder="custom-audio-model-id"
              />
            )}
          </div>
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
              Add the provider API key in OpenClaw onboarding/config, then choose the audio provider and model here. Auto needs no extra choice and uses Gateway fallback.
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
