import { useState, useCallback } from "react"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { Header } from "@/common/Header"
import { useOnboardingFlow } from "./useOnboardingFlow"
import { CoreSetupStep } from "./steps/CoreSetupStep"
import { BotNameStep } from "./steps/BotNameStep"
import { ProviderStep } from "./steps/ProviderStep"
import { ModelStep } from "./steps/ModelStep"
import { CompleteStep } from "./steps/CompleteStep"

type Props = {
  onComplete: () => void
}

const STEP_IDS = ["core", "bot", "provider", "model", "complete"] as const

export function OnboardingWizard({ onComplete }: Props) {
  const {
    flowState,
    loading,
    error,
    refresh,
    checkCore,
    getBotName,
    setBotName,
    getProviders,
    getProviderDetails,
    submitProvider,
    getModelContract,
    submitModel,
  } = useOnboardingFlow()

  const [overrideStep, setOverrideStep] = useState<string | null>(null)

  const activeStep = overrideStep || flowState?.flow.nextStep || "core"

  const advanceToNext = useCallback(async () => {
    setOverrideStep(null)
    await refresh()
  }, [refresh])

  const goBack = useCallback(() => {
    const idx = STEP_IDS.indexOf(activeStep as (typeof STEP_IDS)[number])
    if (idx > 0) {
      setOverrideStep(STEP_IDS[idx - 1])
    }
  }, [activeStep])

  if (loading && !flowState) {
    return (
      <div className="flex h-svh flex-col bg-background">
        <Header />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-3">
            <Icons.Refresh size={18} className="animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        </div>
      </div>
    )
  }

  if (error && !flowState) {
    return (
      <div className="flex h-svh flex-col bg-background">
        <Header />
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md space-y-4 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={refresh}
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  const steps = flowState?.flow.steps || []
  const activeIndex = STEP_IDS.indexOf(activeStep as (typeof STEP_IDS)[number])

  return (
    <div className="flex h-svh flex-col bg-background">
      <Header />
      <div className="flex items-center justify-center border-b border-border/30 px-6 py-4">
        <div className="flex items-center gap-6">
          {steps.map((step, i) => {
            const stepIndex = STEP_IDS.indexOf(step.id as (typeof STEP_IDS)[number])
            const isActive = step.id === activeStep
            const isPast = step.complete || stepIndex < activeIndex
            return (
              <div key={step.id} className="flex items-center gap-3">
                {i > 0 && (
                  <div
                    className={cn(
                      "h-px w-8 transition-colors duration-300",
                      isPast ? "bg-foreground/30" : "bg-border/50",
                    )}
                  />
                )}
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-[11px] font-medium transition-all duration-300",
                      isPast && !isActive
                        ? "bg-emerald-500/15 text-emerald-500"
                        : isActive
                          ? "bg-foreground text-background"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {isPast && !isActive ? (
                      <Icons.Check size={12} strokeWidth={2.5} />
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span
                    className={cn(
                      "hidden text-[12px] font-medium transition-colors sm:inline",
                      isActive ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {step.title}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <main className="flex flex-1 items-start justify-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-lg">
          {activeStep === "core" && (
            <CoreSetupStep checkCore={checkCore} onComplete={advanceToNext} />
          )}
          {activeStep === "bot" && (
            <BotNameStep
              initialName={flowState?.state.bot.botName || null}
              getBotName={getBotName}
              setBotName={setBotName}
              onComplete={advanceToNext}
              onBack={goBack}
            />
          )}
          {activeStep === "provider" && (
            <ProviderStep
              getProviders={getProviders}
              getProviderDetails={getProviderDetails}
              submitProvider={submitProvider}
              onComplete={advanceToNext}
              onBack={goBack}
            />
          )}
          {activeStep === "model" && (
            <ModelStep
              getModelContract={getModelContract}
              submitModel={submitModel}
              onComplete={advanceToNext}
              onBack={goBack}
            />
          )}
          {activeStep === "complete" && <CompleteStep onEnterApp={onComplete} />}
        </div>
      </main>
    </div>
  )
}
