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

type CredentialField = {
  key: string
  label?: string | null
  help?: string | null
  authMethod?: string | null
  inputKind?: string | null
  required?: boolean
  sensitive?: boolean
  envVar?: string | null
}

type ProviderDetails = {
  id: string
  displayName?: string
  authMethods?: string[]
  submit?: {
    payloadShape?: {
      values?: {
        fields?: {
          credentials?: CredentialField[]
        }
      }
    }
  }
}

type ProviderDetailsPayload = {
  provider: ProviderDetails
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

const PROVIDER_ENV_VARS: Record<Exclude<VoiceProvider, "auto">, string> = {
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  google: "GEMINI_API_KEY",
  mistral: "MISTRAL_API_KEY",
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

function isUnknownVoiceCommand(error: unknown) {
  return error instanceof Error && error.message.includes("Unknown middleware command: middleware_voice_settings")
}

function fallbackCredentialField(provider: Exclude<VoiceProvider, "auto">): CredentialField {
  return {
    key: "api-key",
    label: `${PROVIDER_COPY[provider].name} API key`,
    help: `Saved as ${PROVIDER_ENV_VARS[provider]}`,
    authMethod: "api-key",
    inputKind: "secret",
    required: true,
    sensitive: true,
    envVar: PROVIDER_ENV_VARS[provider],
  }
}

export function VoiceTab() {
  const [settings, setSettings] = React.useState<VoiceSettings | null>(null)
  const [options, setOptions] = React.useState<VoiceOption[]>(FALLBACK_OPTIONS)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [customModelOpen, setCustomModelOpen] = React.useState(false)
  const [voiceSettingsAvailable, setVoiceSettingsAvailable] = React.useState(true)
  const [accessOpen, setAccessOpen] = React.useState(false)
  const [providerDetails, setProviderDetails] = React.useState<ProviderDetails | null>(null)
  const [authMethod, setAuthMethod] = React.useState("api-key")
  const [credentialValues, setCredentialValues] = React.useState<Record<string, string>>({})
  const [loadingAccess, setLoadingAccess] = React.useState(false)
  const [savingAccess, setSavingAccess] = React.useState(false)
  const [accessStatus, setAccessStatus] = React.useState<{ tone: "muted" | "success" | "error"; message: string } | null>(null)
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
        setVoiceSettingsAvailable(true)
        setSettings(payload.settings)
        setOptions(payload.options?.length ? payload.options : FALLBACK_OPTIONS)
        setCustomModelOpen(false)
        setStatus(null)
      } catch (error) {
        if (cancelled) return
        if (isUnknownVoiceCommand(error)) {
          setVoiceSettingsAvailable(false)
          setSettings(null)
          setStatus({ tone: "error", message: "Voice is not set in this Desktop build. Update/rebuild Desktop so voice settings commands are available." })
        } else {
          setSettings(defaultSettings)
          setStatus({ tone: "error", message: error instanceof Error ? error.message : "Could not load voice settings" })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  async function save(next: VoiceSettings) {
    if (!voiceSettingsAvailable) {
      setStatus({ tone: "error", message: "Voice is not set in this Desktop build. Update/rebuild Desktop before choosing a voice provider." })
      return
    }
    setSettings(next)
    setSaving(true)
    setStatus({ tone: "muted", message: "Saving voice settings..." })
    try {
      const payload = await invoke<VoiceSettingsPayload>("middleware_voice_settings_set", { input: next })
      setVoiceSettingsAvailable(true)
      setSettings(payload.settings)
      setOptions(payload.options?.length ? payload.options : options)
      window.dispatchEvent(new CustomEvent("openclaw:voice-settings-changed"))
      setStatus({ tone: "success", message: "Saved. New voice messages will use this transcription setup." })
    } catch (error) {
      if (isUnknownVoiceCommand(error)) {
        setVoiceSettingsAvailable(false)
        setSettings(null)
        setStatus({ tone: "error", message: "Voice is not set in this Desktop build. Update/rebuild Desktop so voice settings commands are available." })
      } else {
        setStatus({ tone: "error", message: error instanceof Error ? error.message : "Could not save voice settings" })
      }
    } finally {
      setSaving(false)
    }
  }

  async function openProviderAccess(provider: VoiceProvider) {
    if (provider === "auto") return
    setAccessOpen(true)
    setAccessStatus(null)
    setLoadingAccess(true)
    try {
      const payload = await invoke<ProviderDetailsPayload>("middleware_onboarding_provider_details", {
        input: { providerId: provider },
      })
      const details = payload.provider
      const methods = details.authMethods?.length ? details.authMethods : ["api-key"]
      setProviderDetails(details)
      setAuthMethod(methods.includes("api-key") ? "api-key" : methods[0])
      setCredentialValues({})
    } catch (error) {
      setProviderDetails({ id: provider, displayName: PROVIDER_COPY[provider].name, authMethods: ["api-key"] })
      setAuthMethod("api-key")
      setCredentialValues({})
      setAccessStatus({ tone: "muted", message: "Using basic API key setup for this provider." })
    } finally {
      setLoadingAccess(false)
    }
  }

  function credentialFieldsFor(provider: VoiceProvider): CredentialField[] {
    if (provider === "auto") return []
    const fields = providerDetails?.submit?.payloadShape?.values?.fields?.credentials ?? []
    const visible = fields.filter((field) => !field.authMethod || field.authMethod === authMethod)
    return visible.length ? visible : [fallbackCredentialField(provider)]
  }

  async function saveProviderAccess() {
    if (current.provider === "auto") return
    const fields = credentialFieldsFor(current.provider)
    const missing = fields.find((field) => field.required && !credentialValues[field.key]?.trim())
    if (missing) {
      setAccessStatus({ tone: "error", message: `${missing.label || missing.key} is required.` })
      return
    }
    setSavingAccess(true)
    setAccessStatus({ tone: "muted", message: "Saving provider access..." })
    try {
      await invoke("middleware_onboarding_provider_submit", {
        input: {
          providerId: current.provider,
          authMethod,
          values: credentialValues,
          setDefault: false,
        },
      })
      if (voiceSettingsAvailable) {
        await save(current)
        window.dispatchEvent(new CustomEvent("openclaw:voice-settings-changed"))
        setAccessStatus({ tone: "success", message: "Provider access and voice settings saved." })
      } else {
        setAccessStatus({ tone: "success", message: "Provider access saved. Pull the latest Desktop build to enable voice model selection." })
      }
    } catch (error) {
      setAccessStatus({ tone: "error", message: error instanceof Error ? error.message : "Could not save provider access" })
    } finally {
      setSavingAccess(false)
    }
  }

  const current = settings ?? defaultSettings
  const providers = uniqueProviders(options)
  const modelOptions = modelsForProvider(options, current.provider, current.model)
  const selectedMeta = voiceSettingsAvailable ? PROVIDER_COPY[current.provider] : null
  const selectedModel = voiceSettingsAvailable
    ? current.provider === "auto" ? "Automatic fallback" : current.model
    : "Update/rebuild required"

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
              <span className="text-foreground">{selectedMeta?.name ?? "Voice is not set"}</span>
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
                      const next = { ...current, provider, model }
                      setCustomModelOpen(false)
                      setProviderDetails(null)
                      setCredentialValues({})
                      setSettings(next)
                      if (provider !== "auto") void openProviderAccess(provider)
                      if (voiceSettingsAvailable) {
                        void save(next)
                      } else {
                        setStatus({ tone: "muted", message: "Provider selected. Add provider access below; voice model saving needs the latest Desktop build." })
                      }
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

          {!voiceSettingsAvailable && (
            <div className="rounded-md border border-border/50 bg-background/45 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
              Voice is not set for this Desktop build yet. Pull the latest changes and rebuild/reinstall Desktop to enable voice provider and model selection.
            </div>
          )}

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
                    const next = { ...current, model: event.target.value }
                    setSettings(next)
                    if (voiceSettingsAvailable) {
                      void save(next)
                    } else {
                      setStatus({ tone: "muted", message: "Audio model selected. Add provider access below; saving voice model requires the latest Desktop backend." })
                    }
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
                onBlur={(event) => {
                  const next = { ...current, model: event.target.value }
                  if (voiceSettingsAvailable) {
                    void save(next)
                  } else {
                    setSettings(next)
                    setStatus({ tone: "muted", message: "Custom audio model selected. Add provider access below; saving voice model requires the latest Desktop backend." })
                  }
                }}
                className="mt-2 w-full rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/30 disabled:opacity-60"
                placeholder="custom-audio-model-id"
              />
            )}
          </div>

          {current.provider !== "auto" && (
            <div className="rounded-md border border-border/50 bg-background/45">
              <button
                type="button"
                onClick={() => accessOpen ? setAccessOpen(false) : void openProviderAccess(current.provider)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.035]"
              >
                <span>
                  <span className="block text-[12px] font-medium text-foreground">Provider access</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">Add API key or sign-in details for {PROVIDER_COPY[current.provider].name}.</span>
                </span>
                <LuChevronDown size={14} className={cn("text-muted-foreground transition-transform", accessOpen && "rotate-180")} />
              </button>

              {accessOpen && (
                <div className="space-y-3 border-t border-border/35 px-3 py-3">
                  {loadingAccess ? (
                    <p className="text-[12px] text-muted-foreground">Loading provider setup…</p>
                  ) : (
                    <>
                      {(providerDetails?.authMethods?.length ?? 0) > 1 && (
                        <div className="flex flex-wrap gap-1.5">
                          {providerDetails?.authMethods?.map((method) => (
                            <button
                              key={method}
                              type="button"
                              onClick={() => { setAuthMethod(method); setCredentialValues({}) }}
                              className={cn(
                                "rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                                method === authMethod ? "bg-foreground text-background" : "bg-foreground/[0.05] text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {method === "api-key" ? "API key" : method}
                            </button>
                          ))}
                        </div>
                      )}

                      {credentialFieldsFor(current.provider).map((field) => (
                        <label key={field.key} className="block text-[12px] font-medium text-muted-foreground">
                          {field.label || field.key}
                          {field.required && <span className="ml-1 text-red-400">*</span>}
                          <input
                            value={credentialValues[field.key] || ""}
                            type={field.sensitive !== false ? "password" : "text"}
                            disabled={savingAccess}
                            onChange={(event) => setCredentialValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                            className="mt-2 w-full rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/30 disabled:opacity-60"
                            placeholder={field.help || field.envVar || "Paste key"}
                            autoComplete="off"
                            spellCheck={false}
                          />
                          {field.envVar && (
                            <span className="mt-1 block text-[10px] font-normal text-muted-foreground/60">Saved as {field.envVar}</span>
                          )}
                        </label>
                      ))}

                      <button
                        type="button"
                        disabled={savingAccess}
                        onClick={() => { void saveProviderAccess() }}
                        className="rounded-md bg-foreground px-3 py-2 text-[12px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
                      >
                        {savingAccess ? "Saving…" : "Save provider access"}
                      </button>
                    </>
                  )}

                  {accessStatus && (
                    <div className={cn("rounded-md border px-3 py-2 text-[12px]", statusClass(accessStatus.tone))}>
                      {accessStatus.message}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
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
                  disabled={!voiceSettingsAvailable || loading || saving}
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
                  disabled={!voiceSettingsAvailable || loading || saving}
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
              Choose an audio provider, add its API key/sign-in details in Provider access, then choose the audio model. Auto uses Gateway fallback when no provider is forced.
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
