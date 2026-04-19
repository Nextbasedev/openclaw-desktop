import { useState, useCallback, useRef, Fragment } from "react"
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
        <Header minimal />
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
        <Header minimal />
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
      <Header minimal />

      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto overflow-x-hidden px-6">
        {activeStep !== "complete" && (
          <div className="mb-8 flex items-center">
            {steps.map((step, i) => {
              const stepIndex = STEP_IDS.indexOf(step.id as (typeof STEP_IDS)[number])
              const isActive = step.id === activeStep
              const isPast = step.complete || stepIndex < activeIndex

              return (
                <Fragment key={step.id}>
                  {i > 0 && (
                    <div className="relative mx-1.5 h-[2px] w-12 overflow-hidden rounded-full bg-border/30 sm:w-16">
                      <div
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-all duration-700 ease-out",
                          isPast || isActive ? "w-full" : "w-0",
                        )}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-all duration-500",
                        isPast && !isActive
                          ? "bg-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.35)]"
                          : isActive
                            ? "bg-foreground text-background ring-[3px] ring-foreground/15"
                            : "bg-muted/60 text-muted-foreground",
                      )}
                    >
                      {isPast && !isActive ? (
                        <Icons.Check size={13} strokeWidth={2.5} />
                      ) : (
                        i + 1
                      )}
                    </div>
                    <span
                      className={cn(
                        "hidden text-[14px]  transition-colors sm:inline",
                        isActive ? "text-foreground" : "text-muted-foreground/60",
                      )}
                    >
                      {step.title}
                    </span>
                  </div>
                </Fragment>
              )
            })}
          </div>
        )}

        <div
          className={cn(
            "relative w-full rounded-xl",
            "bg-card/40 backdrop-blur-xl",
            activeStep === "provider" ? "max-w-2xl" : "max-w-xl",
          )}
        >
          <div className="pointer-events-none absolute inset-0 rounded-2xl" />

          <div className="relative z-10 p-6" key={activeStep}>
            <div className="animate-in fade-in-0 slide-in-from-bottom-3 duration-400">
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
          </div>
        </div>

        <SkipOnboarding onSkip={onComplete} />

        <div className="h-10 shrink-0" />
      </div>
    </div>
  )
}

function SkipOnboarding({ onSkip }: { onSkip: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const handleFirstClick = useCallback(() => {
    setConfirm(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setConfirm(false), 4000)
  }, [])

  return (
    <div className="mt-4 flex justify-center">
      {!confirm ? (
        <button
          onClick={handleFirstClick}
          className="text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground"
        >
          Skip onboarding
        </button>
      ) : (
        <button
          onClick={onSkip}
          className="text-xs font-medium text-destructive transition-colors hover:text-destructive/80"
        >
          Skip anyway? Some features may not work.
        </button>
      )}
    </div>
  )
}
