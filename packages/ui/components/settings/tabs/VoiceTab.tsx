"use client"

import * as React from "react"
import { LuCheck, LuInfo, LuMic, LuSparkles } from "react-icons/lu"

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

const PROVIDER_META: Record<VoiceProvider, { name: string; description: string; accent: string }> = {
  auto: {
    name: "Auto",
    description: "Use Gateway's normal fallback chain and local STT fallbacks.",
    accent: "from-foreground/15 to-foreground/5",
  },
  openai: {
    name: "OpenAI",
    description: "Best default when your OpenAI key is configured.",
    accent: "from-emerald-500/20 to-emerald-500/5",
  },
  groq: {
    name: "Groq",
    description: "Fast Whisper transcription with Groq credentials.",
    accent: "from-orange-500/20 to-orange-500/5",
  },
  deepgram: {
    name: "Deepgram",
    description: "Dedicated speech-to-text provider, good for voice apps.",
    accent: "from-blue-500/20 to-blue-500/5",
  },
  google: {
    name: "Google",
    description: "Gemini audio transcription through Google provider config.",
    accent: "from-violet-500/20 to-violet-500/5",
  },
  mistral: {
    name: "Mistral",
    description: "Voxtral transcription through Mistral credentials.",
    accent: "from-rose-500/20 to-rose-500/5",
  },
}

function optionValue(option: VoiceOption) {
  return option.provider === "auto" ? "auto" : `${option.provider}/${option.model}`
}

function currentValue(settings: VoiceSettings) {
  return settings.provider === "auto" ? "auto" : `${settings.provider}/${settings.model}`
}

const defaultSettings: VoiceSettings = {
  enabled: true,
  provider: "auto",
  model: "",
  language: "",
  echoTranscript: false,
}

export function VoiceTab() {
  const [settings, setSettings] = React.useState<VoiceSettings | null>(null)
  const [options, setOptions] = React.useState<VoiceOption[]>(FALLBACK_OPTIONS)
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

  return (
    <div className="flex flex-col gap-6 pb-8">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-foreground/5 text-foreground">
          <LuMic size={18} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Voice</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Pick the speech-to-text model used when you record from the chat mic. This only changes transcription; your chat model stays separate.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/50 bg-card/80 shadow-sm">
        <div className="border-b border-border/40 bg-gradient-to-br from-foreground/[0.07] to-transparent px-5 py-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
            <LuSparkles size={15} />
            Transcription provider
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Auto is safest. Select a provider only when that provider key is configured in OpenClaw.
          </p>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {options.map((option) => {
            const value = optionValue(option)
            const selected = selectedValue === value
            const meta = PROVIDER_META[option.provider]

            return (
              <button
                key={value}
                type="button"
                disabled={loading || saving}
                onClick={() => {
                  void save({ ...current, provider: option.provider, model: option.model })
                }}
                className={`group relative overflow-hidden rounded-xl border p-4 text-left transition-all disabled:pointer-events-none disabled:opacity-60 ${
                  selected
                    ? "border-foreground/30 bg-foreground/[0.08] shadow-sm"
                    : "border-border/50 bg-background/40 hover:border-foreground/20 hover:bg-foreground/[0.05]"
                }`}
              >
                <div className={`absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${meta.accent} opacity-80`} />
                <div className="relative flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-medium text-foreground">{meta.name}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{option.model || "Gateway fallback chain"}</p>
                  </div>
                  <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    selected ? "border-foreground/40 bg-foreground text-background" : "border-border/60 bg-background/70 text-transparent"
                  }`}>
                    <LuCheck size={12} />
                  </span>
                </div>
                <p className="relative mt-4 text-[12px] leading-relaxed text-muted-foreground">
                  {meta.description}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-xl border border-border/50 bg-card/80 p-5 shadow-sm">
          <h3 className="text-[13px] font-medium text-foreground">Advanced</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Leave these blank unless you know you need a specific language or custom model ID.
          </p>

          {current.provider !== "auto" && (
            <label className="mt-4 block text-[12px] font-medium text-muted-foreground">
              Model ID
              <input
                value={current.model}
                disabled={loading || saving}
                onChange={(event) => setSettings({ ...current, model: event.target.value })}
                onBlur={(event) => { void save({ ...current, model: event.target.value }) }}
                className="mt-2 w-full rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:bg-background disabled:opacity-60"
                placeholder="model-name"
              />
            </label>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-[12px] font-medium text-muted-foreground">
              Language hint
              <input
                value={current.language}
                disabled={loading || saving}
                onChange={(event) => setSettings({ ...current, language: event.target.value })}
                onBlur={(event) => { void save({ ...current, language: event.target.value }) }}
                className="mt-2 w-full rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:bg-background disabled:opacity-60"
                placeholder="auto, en, hi..."
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-foreground/[0.04] px-3 py-3 text-[12px] font-medium text-muted-foreground">
              <span>
                <span className="block text-foreground">Echo transcript</span>
                <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">Show the transcript beside the reply.</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={current.echoTranscript}
                disabled={loading || saving}
                onClick={() => { void save({ ...current, echoTranscript: !current.echoTranscript }) }}
                className={`relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${current.echoTranscript ? "bg-foreground" : "bg-muted"}`}
              >
                <span className={`block size-[18px] rounded-full bg-background shadow-sm transition-transform ${current.echoTranscript ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </label>
          </div>

          {status && (
            <p className={`mt-4 text-[12px] leading-relaxed ${
              status.tone === "error" ? "text-red-500" : status.tone === "success" ? "text-emerald-500" : "text-muted-foreground"
            }`}>
              {status.message}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border/50 bg-foreground/[0.04] p-5">
          <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
            <LuInfo size={15} />
            How to set it up
          </div>
          <ol className="mt-3 space-y-2 text-[12px] leading-relaxed text-muted-foreground">
            <li><span className="text-foreground">1.</span> Add the provider API key in OpenClaw config/onboarding.</li>
            <li><span className="text-foreground">2.</span> Pick the matching provider here, or keep Auto.</li>
            <li><span className="text-foreground">3.</span> Record a voice message from chat. Desktop sends audio to Gateway, Gateway transcribes it, then the agent responds.</li>
          </ol>
          <div className="mt-4 rounded-lg border border-border/40 bg-background/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Saved to <code className="text-foreground">~/.openclaw/openclaw.json</code> under <code className="text-foreground">tools.media.audio</code>.
          </div>
        </div>
      </div>
    </div>
  )
}
