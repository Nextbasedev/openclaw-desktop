"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  PlusSignIcon,
  ArrowDown01Icon,
  AttachmentIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { PlanModeIcon, WebSearchIcon, VoiceIcon, SendArrowIcon } from "./Icons"
import { VoiceWaveIcon } from "./VoiceWaveIcon"
import type { ModelEntry } from "@/hooks/useModels"

type ActionBarProps = {
  hasInput: boolean
  onSend?: () => void
  isGenerating?: boolean
  onAbort?: () => void
  planEnabled: boolean
  onPlanToggle: () => void
  webSearchEnabled: boolean
  onWebSearchToggle: () => void
  onWebSearchDisable: () => void
  plusOpen: boolean
  onPlusOpenChange: (open: boolean) => void
  modelOpen: boolean
  onModelOpenChange: (open: boolean) => void
  models: ModelEntry[]
  currentModelId: string | null
  onModelSelect: (model: ModelEntry) => void
  isRecording?: boolean
  onVoiceToggle?: () => void
  voiceSupported?: boolean

}

export function ActionBar({
  hasInput,
  onSend,
  isGenerating,
  onAbort,
  planEnabled,
  onPlanToggle,
  webSearchEnabled,
  onWebSearchToggle,
  onWebSearchDisable,
  plusOpen,
  onPlusOpenChange,
  modelOpen,
  onModelOpenChange,
  models,
  currentModelId,
  onModelSelect,
  isRecording,
  onVoiceToggle,
  voiceSupported = true,
}: ActionBarProps) {
  const activeModel = models.find((m) => {
    if (!currentModelId) return false
    const bare = currentModelId.includes("/")
      ? currentModelId.split("/")[1]
      : currentModelId
    return m.id === currentModelId || m.id === bare
  })
  const modelLabel = activeModel?.name ?? currentModelId ?? "Select model"
  return (
    <div className="flex items-center justify-between px-3 pb-3 pt-2">
      {/* Left controls */}
      <div className="flex items-center gap-0.5 sm:gap-1">
        {/* + menu */}
        <Popover open={plusOpen} onOpenChange={onPlusOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-foreground/15 bg-foreground/5 text-foreground shadow-sm transition-all hover:bg-foreground/10"
              aria-label="Add"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={19} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" sideOffset={8} className="w-56 gap-0 p-1.5">
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-popover-foreground transition-colors hover:bg-muted"
            >
              <HugeiconsIcon icon={AttachmentIcon} size={16} />
              Upload
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-popover-foreground transition-colors hover:bg-muted"
              onClick={onWebSearchToggle}
            >
              <WebSearchIcon className="size-[18px]" />
              Web search
            </button>
          </PopoverContent>
        </Popover>

        {/* Web search pill — desktop only */}
        {webSearchEnabled && (
          <button
            type="button"
            onClick={onWebSearchDisable}
            className="group hidden cursor-pointer items-center gap-2 rounded-full border border-foreground/60 bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-secondary/80 sm:flex"
          >
            <span className="relative size-4">
              <WebSearchIcon className="absolute inset-0 size-4 opacity-100 transition-opacity group-hover:opacity-0" />
              <HugeiconsIcon icon={Cancel01Icon} size={16} className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" />
            </span>
            Web
          </button>
        )}

        {/* Plan Mode pill */}
        <button
          type="button"
          onClick={onPlanToggle}
          className={cn(
            "flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 transition-all",
            planEnabled
              ? "border-foreground/60 bg-secondary text-foreground"
              : "border-foreground/15 bg-foreground/5 text-foreground shadow-sm hover:bg-foreground/10"
          )}
          title={planEnabled ? "Plan Mode: on" : "Plan Mode: off"}
        >
          <PlanModeIcon className="size-4" />
          <span className="text-xs font-medium">Plan</span>
        </button>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-0.5 sm:gap-1">
        {/* Model selector */}
        <Popover open={modelOpen} onOpenChange={onModelOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-8 cursor-pointer items-center gap-1 rounded-full px-2 text-xs text-muted-foreground transition-all hover:text-foreground"
            >
              {modelLabel}
              <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" sideOffset={8} className="w-56 gap-0 p-1.5">
            {models.map((model) => {
              const isActive = activeModel?.id === model.id
              return (
                <button
                  key={`${model.provider}/${model.id}`}
                  type="button"
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-muted",
                    isActive
                      ? "font-medium text-popover-foreground"
                      : "text-muted-foreground"
                  )}
                  onClick={() => onModelSelect(model)}
                >
                  {model.name}
                </button>
              )
            })}
            {models.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No models available</p>
            )}
          </PopoverContent>
        </Popover>

        {/* Voice button */}
        <button
          type="button"
          onClick={onVoiceToggle}
          disabled={!voiceSupported}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full transition-all",
            isRecording
              ? "cursor-pointer border border-foreground/60 bg-secondary text-foreground"
              : voiceSupported
                ? "cursor-pointer text-muted-foreground hover:text-foreground"
                : "cursor-not-allowed text-muted-foreground/30"
          )}
          aria-label={isRecording ? "Stop recording" : "Voice input"}
          title={
            !voiceSupported
              ? "Voice input not supported in this browser"
              : isRecording
                ? "Stop recording"
                : "Voice input"
          }
        >
          {isRecording ? (
            <VoiceWaveIcon className="size-[20px]" />
          ) : (
            <VoiceIcon className="size-[26px]" />
          )}
        </button>

        {/* Send / Stop button */}
        {isGenerating ? (
          <button
            type="button"
            onClick={onAbort}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground/10 text-foreground shadow-sm transition-all hover:bg-foreground/20"
            aria-label="Stop generating"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!hasInput}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full shadow-sm transition-all",
              hasInput
                ? "cursor-pointer bg-foreground text-background"
                : "bg-foreground/50 text-background"
            )}
            aria-label="Send message"
          >
            <SendArrowIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
