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
    <div className="flex items-center justify-between gap-2 px-3 pb-3">
      {/* Left side */}
      <div className="flex items-center gap-1.5">
        {/* Plus button with popover */}
        <Popover open={plusOpen} onOpenChange={onPlusOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Add"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={18} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-52 gap-1 p-2">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              <HugeiconsIcon icon={Image01Icon} size={18} />
              Upload media
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            >
              <HugeiconsIcon icon={File01Icon} size={18} />
              Upload file
            </button>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted",
                webSearchEnabled
                  ? "font-medium text-foreground"
                  : "text-foreground"
              )}
              onClick={onWebSearchToggle}
            >
              <HugeiconsIcon icon={Globe02Icon} size={18} />
              Web search
              {webSearchEnabled && (
                <HugeiconsIcon
                  icon={Tick01Icon}
                  size={16}
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
            "flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
            planEnabled
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <HugeiconsIcon icon={SparklesIcon} size={16} />
          Plan
        </button>

        {/* Web search pill (shows when enabled) */}
        {webSearchEnabled && (
          <button
            type="button"
            onClick={onWebSearchDisable}
            className="flex h-9 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3.5 text-sm font-medium text-primary transition-colors"
          >
            <HugeiconsIcon icon={Globe02Icon} size={16} />
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
              className="flex h-9 items-center gap-1 rounded-full border border-border/60 px-3.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {selectedModel.label}
              <span className="text-xs">⌄</span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-48 gap-1 p-2">
            {MODELS.map((model) => (
              <button
                key={model.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted",
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
                    size={16}
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
          className="flex size-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Voice input"
        >
          <HugeiconsIcon icon={Mic01Icon} size={18} />
        </button>

        {/* Send button */}
        <button
          type="button"
          disabled={!hasInput}
          className={cn(
            "flex size-9 items-center justify-center rounded-full transition-colors",
            hasInput
              ? "bg-foreground text-background hover:bg-foreground/85"
              : "cursor-not-allowed bg-muted text-muted-foreground/50"
          )}
          aria-label="Send message"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={18} />
        </button>
      </div>
    </div>
  )
}
