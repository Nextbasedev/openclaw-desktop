"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowUp01Icon,
  Mic01Icon,
  PlusSignIcon,
  SparklesIcon,
  Image01Icon,
  File01Icon,
  Globe02Icon,
  Tick01Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

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
    <div className="flex items-center justify-between gap-2 border-t border-border/40 px-3 py-2.5">
      {/* Left side */}
      <div className="flex items-center gap-1.5">
        {/* Plus button with popover */}
        <Popover open={plusOpen} onOpenChange={onPlusOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Add"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={16} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-52 gap-1 p-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <HugeiconsIcon icon={Image01Icon} size={16} />
              Upload media
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <HugeiconsIcon icon={File01Icon} size={16} />
              Upload file
            </button>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-secondary",
                webSearchEnabled
                  ? "font-medium text-foreground"
                  : "text-foreground"
              )}
              onClick={onWebSearchToggle}
            >
              <HugeiconsIcon icon={Globe02Icon} size={16} />
              Web search
              {webSearchEnabled && (
                <HugeiconsIcon
                  icon={Tick01Icon}
                  size={14}
                  className="ml-auto text-primary"
                />
              )}
            </button>
          </PopoverContent>
        </Popover>

        {/* Plan button */}
        <button
          type="button"
          onClick={onPlanToggle}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors",
            planEnabled
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
          )}
        >
          <HugeiconsIcon icon={SparklesIcon} size={14} />
          Plan
        </button>

        {/* Web search pill (shows when enabled) */}
        {webSearchEnabled && (
          <button
            type="button"
            onClick={onWebSearchDisable}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors"
          >
            <HugeiconsIcon icon={Globe02Icon} size={14} />
            Web
          </button>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1.5">
        {/* Model selector */}
        <Popover open={modelOpen} onOpenChange={onModelOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-8 items-center gap-1 rounded-lg bg-secondary px-3 text-sm text-secondary-foreground transition-colors hover:bg-secondary/80"
            >
              {selectedModel.label}
              <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-48 gap-1 p-1.5">
            {MODELS.map((model) => (
              <button
                key={model.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-secondary",
                  selectedModel.id === model.id
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
                onClick={() => onModelSelect(model)}
              >
                {model.label}
                {selectedModel.id === model.id && (
                  <HugeiconsIcon
                    icon={Tick01Icon}
                    size={14}
                    className="ml-auto text-primary"
                  />
                )}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Mic button */}
        <button
          type="button"
          className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Voice input"
        >
          <HugeiconsIcon icon={Mic01Icon} size={16} />
        </button>

        {/* Send button */}
        <button
          type="button"
          disabled={!hasInput}
          className={cn(
            "flex size-8 items-center justify-center rounded-lg transition-colors",
            hasInput
              ? "bg-foreground text-background hover:bg-foreground/85"
              : "cursor-not-allowed bg-secondary text-muted-foreground/50"
          )}
          aria-label="Send message"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={16} />
        </button>
      </div>
    </div>
  )
}
