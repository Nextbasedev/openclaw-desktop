import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { ModelContract, ModelOption } from "../useOnboardingFlow"

type Props = {
  getModelContract: (providerId?: string) => Promise<{ contract: ModelContract }>
  submitModel: (
    modelRef: string,
    providerId?: string,
    setDefault?: boolean,
  ) => Promise<{ ok: boolean; nextStep: string }>
  onComplete: () => void
  onBack: () => void
}

export function ModelStep({ getModelContract, submitModel, onComplete, onBack }: Props) {
  const [contract, setContract] = useState<ModelContract | null>(null)
  const [selectedModel, setSelectedModel] = useState("")
  const [customMode, setCustomMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadContract()
  }, [])

  async function loadContract() {
    setLoading(true)
    setError(null)
    try {
      const result = await getModelContract()
      setContract(result.contract)
      setSelectedModel(
        result.contract.selectedModelRef ||
          result.contract.recommendedModelRef ||
          result.contract.types.payloadShape.modelRef.options[0]?.value ||
          "",
      )
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit() {
    const trimmed = selectedModel.trim()
    if (!trimmed) {
      setError("Please select a model")
      return
    }
    if (!trimmed.includes("/")) {
      setError("Model must use provider/model format (e.g. openai/gpt-4)")
      return
    }
    if (contract?.providerId && !trimmed.startsWith(`${contract.providerId}/`)) {
      setError(
        `Model must start with "${contract.providerId}/" to match your selected provider`,
      )
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await submitModel(trimmed, contract?.providerId)
      onComplete()
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const options = contract?.types.payloadShape.modelRef.options || []
  const recommended = contract?.recommendedModelRef

  if (loading) {
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
              <Icons.Settings size={20} className="text-foreground/70" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Choose a Model</h2>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 py-8">
          <Icons.Refresh size={18} className="animate-spin text-muted-foreground" />
          <span className="text-[13px] text-muted-foreground">Loading model options...</span>
        </div>
      </div>
    )
  }

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
            <Icons.Settings size={20} className="text-foreground/70" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Choose a Model</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Select the default model for your assistant
            </p>
          </div>
        </div>
      </div>

      {!customMode && options.length > 0 && (
        <div className="space-y-1.5">
          {options.map((option: ModelOption) => (
            <button
              key={option.id}
              onClick={() => {
                setSelectedModel(option.value)
                setError(null)
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-all",
                selectedModel === option.value
                  ? "bg-foreground/[0.08] ring-1 ring-foreground/10"
                  : "bg-foreground/[0.03] hover:bg-foreground/[0.06]",
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex size-4 items-center justify-center rounded-full border-2 transition-colors",
                    selectedModel === option.value
                      ? "border-emerald-500 bg-emerald-500"
                      : "border-muted-foreground/30",
                  )}
                >
                  {selectedModel === option.value && (
                    <div className="size-1.5 rounded-full bg-white" />
                  )}
                </div>
                <div>
                  <p className="text-[13px] font-medium">{option.label}</p>
                  <p className="font-mono text-[11px] text-muted-foreground/50">{option.value}</p>
                </div>
              </div>
              {option.value === recommended && (
                <Badge variant="secondary" className="text-[10px]">
                  Recommended
                </Badge>
              )}
            </button>
          ))}

          <button
            onClick={() => setCustomMode(true)}
            className="mt-2 flex items-center gap-1.5 px-1 text-[12px] text-muted-foreground/50 transition-colors hover:text-foreground"
          >
            <Icons.Edit size={11} strokeWidth={1.5} />
            Use a custom model
          </button>
        </div>
      )}

      {(customMode || options.length === 0) && (
        <div className="space-y-3">
          <Label className="text-[13px] text-foreground/80">Model Reference</Label>
          <Input
            value={selectedModel}
            onChange={(e) => {
              setSelectedModel(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && selectedModel.trim()) handleSubmit()
            }}
            placeholder={`e.g. ${contract?.providerId || "provider"}/model-name`}
            className="h-11 rounded-xl border-foreground/[0.06] bg-foreground/[0.03] font-mono text-[13px] focus-visible:ring-foreground/10"
            autoFocus
            spellCheck={false}
            aria-invalid={!!error}
          />
          <p className="text-[11px] text-muted-foreground/50">
            Format: <code className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px]">provider/model</code>
          </p>
          {options.length > 0 && (
            <button
              onClick={() => {
                setCustomMode(false)
                setSelectedModel(recommended || options[0]?.value || "")
                setError(null)
              }}
              className="flex items-center gap-1 text-[12px] text-muted-foreground/50 transition-colors hover:text-foreground"
            >
              <Icons.Back size={11} strokeWidth={1.5} />
              Back to suggested models
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-destructive/[0.06] px-4 py-3">
          <p className="text-[13px] text-destructive">{error}</p>
        </div>
      )}

      <div className="flex justify-center pt-1">
        <button
          onClick={handleSubmit}
          disabled={submitting || !selectedModel.trim()}
          className={cn(
            "rounded-xl bg-foreground px-8 py-2.5 text-[13px] font-medium text-background transition-all",
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

function friendlyError(msg: string): string {
  if (msg.includes("does not belong to selected provider")) {
    const match = msg.match(/selected provider (\w+)/)
    const provider = match?.[1] || "your provider"
    return `The model must start with "${provider}/" to match your selected provider.`
  }
  if (msg.includes("must use provider/model format")) {
    return "Model reference must be in provider/model format (e.g. openai/gpt-4)."
  }
  if (msg.includes("No onboarding provider selected")) {
    return "No provider has been selected yet. Please go back and choose a provider first."
  }
  if (msg.includes("modelRef is required")) {
    return "Please select or enter a model."
  }
  return msg
}
