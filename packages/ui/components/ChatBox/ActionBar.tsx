"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  PlusSignIcon,
  Tick01Icon,
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

export type Model = {
  id: string
  label: string
}

export const MODELS: Model[] = [
  { id: "gpt-5.2", label: "GPT-5.2" },
  { id: "claude-opus", label: "Claude Opus" },
  { id: "claude-sonnet", label: "Claude Sonnet" },
  { id: "gemini-2", label: "Gemini 2" },
]

type ActionBarProps = {
  hasInput: boolean
  planEnabled: boolean
  onPlanToggle: () => void
  webSearchEnabled: boolean
  onWebSearchToggle: () => void
  onWebSearchDisable: () => void
  plusOpen: boolean
  onPlusOpenChange: (open: boolean) => void
  modelOpen: boolean
  onModelOpenChange: (open: boolean) => void
  selectedModel: Model
  onModelSelect: (model: Model) => void
}

export function ActionBar({
  hasInput,
  planEnabled,
  onPlanToggle,
  webSearchEnabled,
  onWebSearchToggle,
  onWebSearchDisable,
  plusOpen,
  onPlusOpenChange,
  modelOpen,
  onModelOpenChange,
  selectedModel,
  onModelSelect,
}: ActionBarProps) {
  return (
    <div className="flex items-center justify-between px-3 pb-3 pt-2">
      {/* Left controls */}
      <div className="flex items-center gap-0.5 sm:gap-1">
        {/* + menu */}
        <Popover open={plusOpen} onOpenChange={onPlusOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-foreground/15 bg-foreground/5 text-foreground shadow-sm transition-all hover:bg-foreground/10"
              aria-label="Add"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={19} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" sideOffset={8} className="w-56 gap-0 p-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-popover-foreground transition-colors hover:bg-muted"
            >
              <HugeiconsIcon icon={AttachmentIcon} size={16} />
              Upload
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-muted",
                webSearchEnabled
                  ? "font-medium text-popover-foreground"
                  : "text-popover-foreground"
              )}
              onClick={onWebSearchToggle}
            >
              <WebSearchIcon className="size-[18px]" />
              <span className="flex-1">Web search</span>
              {webSearchEnabled && (
                <HugeiconsIcon
                  icon={Tick01Icon}
                  size={16}
                  className="text-foreground"
                />
              )}
            </button>
          </PopoverContent>
        </Popover>

        {/* Web search pill — desktop only */}
        {webSearchEnabled && (
          <button
            type="button"
            onClick={onWebSearchDisable}
            className="group hidden items-center gap-2 rounded-full border border-foreground/60 bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-secondary/80 sm:flex"
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
            "flex h-8 items-center gap-2 rounded-full border px-3 transition-all",
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
              className="flex h-8 items-center gap-1 rounded-full border border-foreground/15 bg-foreground/5 px-3 text-xs text-foreground shadow-sm transition-all hover:bg-foreground/10"
            >
              {selectedModel.label}
              <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" sideOffset={8} className="w-48 gap-0 p-1.5">
            {MODELS.map((model) => (
              <button
                key={model.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-muted",
                  selectedModel.id === model.id
                    ? "font-medium text-popover-foreground"
                    : "text-muted-foreground"
                )}
                onClick={() => onModelSelect(model)}
              >
                {model.label}
                {selectedModel.id === model.id && (
                  <HugeiconsIcon
                    icon={Tick01Icon}
                    size={14}
                    className="ml-auto text-foreground"
                  />
                )}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Voice button */}
        <button
          type="button"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all hover:text-foreground"
          aria-label="Voice input"
        >
          <VoiceIcon className="size-[26px]" />
        </button>

        {/* Send button */}
        <button
          type="button"
          disabled={!hasInput}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full shadow-sm transition-all",
            hasInput
              ? "bg-foreground text-background"
              : "bg-foreground/50 text-background"
          )}
          aria-label="Send message"
        >
          <SendArrowIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}
