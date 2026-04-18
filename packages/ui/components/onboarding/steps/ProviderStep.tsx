import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { ProviderSummary, CredentialField, ConfigField } from "../useOnboardingFlow"

type Props = {
  getProviders: () => Promise<{ providers: ProviderSummary[]; count: number }>
  getProviderDetails: (id: string) => Promise<{ provider: ProviderSummary }>
  submitProvider: (
    id: string,
    method: string,
    values: Record<string, string>,
    setDefault?: boolean,
  ) => Promise<{ ok: boolean; nextStep: string }>
  onComplete: () => void
  onBack: () => void
}

const PROVIDER_ICONS: Record<string, string> = {
  openai: "O",
  "openai-codex": "CX",
  anthropic: "A",
  google: "G",
  "google-gemini-cli": "G",
  deepseek: "DS",
  mistral: "M",
  xai: "X",
  openrouter: "OR",
  ollama: "OL",
  lmstudio: "LM",
  qwen: "Q",
  together: "T",
  moonshot: "K",
  "github-copilot": "GH",
  codex: "CX",
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: "bg-emerald-600",
  "openai-codex": "bg-emerald-700",
  anthropic: "bg-orange-600",
  google: "bg-blue-500",
  "google-gemini-cli": "bg-blue-600",
  deepseek: "bg-cyan-600",
  mistral: "bg-amber-600",
  xai: "bg-neutral-800 dark:bg-neutral-200 dark:text-neutral-900",
  openrouter: "bg-purple-600",
  ollama: "bg-stone-700",
  lmstudio: "bg-teal-600",
  qwen: "bg-indigo-600",
  together: "bg-rose-600",
  moonshot: "bg-sky-600",
  "github-copilot": "bg-neutral-700",
  codex: "bg-emerald-800",
}

type Phase = "pick" | "configure"

export function ProviderStep({
  getProviders,
  getProviderDetails,
  submitProvider,
  onComplete,
  onBack,
}: Props) {
  const [phase, setPhase] = useState<Phase>("pick")
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [selectedProvider, setSelectedProvider] = useState<ProviderSummary | null>(null)
  const [selectedAuthMethod, setSelectedAuthMethod] = useState<string>("")
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadProviders()
  }, [])

  async function loadProviders() {
    setLoading(true)
    setError(null)
    try {
      const result = await getProviders()
      setProviders(result.providers)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handlePickProvider(provider: ProviderSummary) {
    setError(null)
    setLoadingProvider(provider.id)
    try {
      const details = await getProviderDetails(provider.id)
      const p = details.provider
      setSelectedProvider(p)
      setSelectedAuthMethod(p.authMethods[0] || "api-key")
      setFieldValues({})
      setFieldErrors({})
      setPhase("configure")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingProvider(null)
    }
  }

  function getCredentialFields(): CredentialField[] {
    if (!selectedProvider) return []
    return (
      selectedProvider.submit?.payloadShape?.values?.fields?.credentials?.filter(
        (f) => !f.authMethod || f.authMethod === selectedAuthMethod,
      ) || []
    )
  }

  function getConfigFields(): ConfigField[] {
    if (!selectedProvider) return []
    return selectedProvider.submit?.payloadShape?.values?.fields?.config || []
  }

  function validateRequired(): boolean {
    const errors: Record<string, string> = {}
    for (const field of getCredentialFields()) {
      if (field.required && !fieldValues[field.key]?.trim()) {
        errors[field.key] = "Required"
      }
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  function updateField(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }))
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  async function handleSubmit() {
    if (!selectedProvider) return
    if (!validateRequired()) return
    setSubmitting(true)
    setError(null)
    try {
      await submitProvider(selectedProvider.id, selectedAuthMethod, fieldValues, true)
      onComplete()
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === "pick") {
    const coreProviders = providers.filter((p) => p.category === "core")
    const localProviders = providers.filter((p) => p.category === "local")
    const advancedProviders = providers.filter((p) => p.category === "advanced")

    return (
      <div className="space-y-6">
        <div>
          <button
            onClick={onBack}
            className="mb-5 flex items-center gap-1.5 text-[13px] text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            <Icons.Back size={13} strokeWidth={1.5} />
            Back
          </button>
          <div className="flex items-start gap-3.5">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-foreground/5">
              <Icons.Grid size={20} className="text-foreground/70" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Choose a Provider</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Select the AI provider you want to use. You can change this later.
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Icons.Refresh size={18} className="animate-spin text-muted-foreground" />
            <span className="text-[13px] text-muted-foreground">Loading providers...</span>
          </div>
        ) : (
          <div className="space-y-5">
            {coreProviders.length > 0 && (
              <ProviderSection
                title="Cloud Providers"
                providers={coreProviders}
                onPick={handlePickProvider}
                loadingId={loadingProvider}
              />
            )}
            {localProviders.length > 0 && (
              <ProviderSection
                title="Local / Self-Hosted"
                providers={localProviders}
                onPick={handlePickProvider}
                loadingId={loadingProvider}
              />
            )}
            {advancedProviders.length > 0 && (
              <ProviderSection
                title="Advanced"
                providers={advancedProviders}
                onPick={handlePickProvider}
                loadingId={loadingProvider}
              />
            )}
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-destructive/[0.06] px-4 py-3">
            <p className="text-[13px] text-destructive">{error}</p>
          </div>
        )}
      </div>
    )
  }

  const credentialFields = getCredentialFields()
  const configFields = getConfigFields()
  const hasMultipleAuthMethods = (selectedProvider?.authMethods.length || 0) > 1

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => {
            setPhase("pick")
            setFieldErrors({})
            setError(null)
          }}
          className="mb-5 flex items-center gap-1.5 text-[13px] text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <Icons.Back size={13} strokeWidth={1.5} />
          All providers
        </button>

        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-lg",
              PROVIDER_COLORS[selectedProvider?.id || ""] || "bg-neutral-600",
            )}
          >
            {PROVIDER_ICONS[selectedProvider?.id || ""] || "?"}
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {selectedProvider?.displayName}
            </h2>
            <p className="text-[12px] text-muted-foreground">Configure credentials to continue</p>
          </div>
        </div>
      </div>

      {hasMultipleAuthMethods && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
            Auth Method
          </p>
          <div className="flex gap-1.5">
            {selectedProvider?.authMethods.map((method) => (
              <button
                key={method}
                onClick={() => {
                  setSelectedAuthMethod(method)
                  setFieldValues({})
                  setFieldErrors({})
                }}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all",
                  method === selectedAuthMethod
                    ? "bg-foreground text-background"
                    : "bg-foreground/[0.05] text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                )}
              >
                {method === "api-key"
                  ? "API Key"
                  : method === "cli"
                    ? "CLI Auth"
                    : method === "oauth"
                      ? "OAuth"
                      : method === "local"
                        ? "Local"
                        : method}
              </button>
            ))}
          </div>
        </div>
      )}

      {credentialFields.length > 0 && (
        <div className="space-y-4">
          {credentialFields.map((field, idx) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={`field-${field.key}`} className="text-[13px] text-foreground/80">
                {field.label}
                {field.required && <span className="ml-1 text-destructive/60">*</span>}
              </Label>
              <Input
                id={`field-${field.key}`}
                type={field.sensitive ? "password" : "text"}
                value={fieldValues[field.key] || ""}
                onChange={(e) => updateField(field.key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const isLast = idx === credentialFields.length - 1 && configFields.length === 0
                    if (isLast) handleSubmit()
                  }
                }}
                placeholder={field.help || ""}
                className="h-11 rounded-xl border-foreground/[0.06] bg-foreground/[0.03] font-mono text-[13px] focus-visible:ring-foreground/10"
                autoComplete="off"
                spellCheck={false}
                autoFocus={idx === 0}
                aria-invalid={!!fieldErrors[field.key]}
              />
              {fieldErrors[field.key] && (
                <p className="text-[11px] text-destructive">{fieldErrors[field.key]}</p>
              )}
              {field.envVar && !fieldErrors[field.key] && (
                <p className="text-[11px] text-muted-foreground/50">
                  Env: <code className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px]">{field.envVar}</code>
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {configFields.length > 0 && (
        <div className="space-y-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
            Configuration
          </p>
          {configFields.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={`config-${field.key}`} className="text-[13px] text-foreground/80">
                {typeof field.label === "string" ? field.label : field.key}
              </Label>
              {field.inputKind === "select" && Array.isArray(field.enum) ? (
                <select
                  id={`config-${field.key}`}
                  value={
                    fieldValues[field.key] ||
                    (typeof field.default === "string" ? field.default : "")
                  }
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className="h-11 w-full rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] px-3 text-[13px] outline-none transition-all focus-visible:ring-2 focus-visible:ring-foreground/10"
                >
                  {field.enum.map((opt) => (
                    <option key={String(opt)} value={String(opt)}>
                      {String(opt)}
                    </option>
                  ))}
                </select>
              ) : field.inputKind === "toggle" ? (
                <button
                  onClick={() =>
                    updateField(
                      field.key,
                      fieldValues[field.key] === "true" ? "false" : "true",
                    )
                  }
                  className={cn(
                    "h-6 w-10 rounded-full transition-colors",
                    fieldValues[field.key] === "true" ? "bg-foreground" : "bg-foreground/20",
                  )}
                >
                  <div
                    className={cn(
                      "size-4 rounded-full bg-background transition-transform",
                      fieldValues[field.key] === "true" ? "translate-x-5" : "translate-x-1",
                    )}
                  />
                </button>
              ) : (
                <Input
                  id={`config-${field.key}`}
                  type={
                    field.inputKind === "secret"
                      ? "password"
                      : field.inputKind === "number"
                        ? "number"
                        : "text"
                  }
                  value={
                    fieldValues[field.key] ||
                    (typeof field.default === "string" ? field.default : "")
                  }
                  onChange={(e) => updateField(field.key, e.target.value)}
                  placeholder={typeof field.help === "string" ? field.help : ""}
                  className="h-11 rounded-xl border-foreground/[0.06] bg-foreground/[0.03] text-[13px] focus-visible:ring-foreground/10"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-destructive/[0.06] px-4 py-3">
          <p className="text-[13px] text-destructive">{error}</p>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={cn(
            "rounded-xl bg-foreground px-6 py-2.5 text-[13px] font-medium text-background transition-all",
            "hover:bg-foreground/90 active:scale-[0.98]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          {submitting ? "Saving..." : "Continue"}
        </button>
      </div>
    </div>
  )
}

function ProviderSection({
  title,
  providers,
  onPick,
  loadingId,
}: {
  title: string
  providers: ProviderSummary[]
  onPick: (p: ProviderSummary) => void
  loadingId: string | null
}) {
  return (
    <div>
      <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
        {title}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {providers.map((provider) => (
          <button
            key={provider.id}
            onClick={() => onPick(provider)}
            disabled={loadingId !== null}
            className={cn(
              "group flex flex-col items-center gap-2.5 rounded-xl px-3 py-4",
              "bg-foreground/[0.03] transition-all",
              "hover:bg-foreground/[0.07] hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)]",
              "active:scale-[0.97]",
              "cursor-pointer disabled:cursor-wait disabled:opacity-60",
            )}
          >
            {loadingId === provider.id ? (
              <div className="flex size-10 items-center justify-center">
                <Icons.Refresh size={16} className="animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div
                className={cn(
                  "flex size-10 items-center justify-center rounded-xl text-sm font-bold text-white shadow-md transition-transform group-hover:scale-105",
                  PROVIDER_COLORS[provider.id] || "bg-neutral-600",
                )}
              >
                {PROVIDER_ICONS[provider.id] || "?"}
              </div>
            )}
            <div className="text-center">
              <p className="text-[13px] font-medium leading-tight">{provider.displayName}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/50">
                {provider.authMethods.join(" · ")}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function friendlyError(msg: string): string {
  if (msg.includes("Missing required credential field")) {
    const field = msg.split(": ").pop()
    return `Please fill in the required field: ${field}`
  }
  if (msg.includes("requires authMethod")) {
    return "Please select an authentication method for this provider."
  }
  if (msg.includes("Unsupported OpenClaw provider")) {
    return "This provider is not recognized. Please choose a different one."
  }
  return msg
}
