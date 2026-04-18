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
    <div className="flex items-center justify-between px-3 pb-3 pt-2">
      {/* Left side */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Plus button with popover */}
        <Popover open={plusOpen} onOpenChange={onPlusOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-all hover:bg-foreground/90"
              aria-label="Add"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={16} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" sideOffset={8} className="w-56 gap-0 p-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-popover-foreground transition-colors hover:bg-muted"
            >
              <HugeiconsIcon icon={Image01Icon} size={16} />
              Upload media
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-popover-foreground transition-colors hover:bg-muted"
            >
              <HugeiconsIcon icon={File01Icon} size={16} />
              Upload file
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
              <HugeiconsIcon icon={Globe02Icon} size={16} />
              Web search
              {webSearchEnabled && (
                <HugeiconsIcon
                  icon={Tick01Icon}
                  size={14}
                  className="ml-auto text-foreground"
                />
              )}
            </button>
          </PopoverContent>
        </Popover>

        {/* Web search pill (shows when enabled) */}
        {webSearchEnabled && (
          <button
            type="button"
            onClick={onWebSearchDisable}
            className="hidden items-center gap-2 rounded-full border border-foreground/60 bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-secondary/80 sm:flex"
          >
            <HugeiconsIcon icon={Globe02Icon} size={14} />
            Web
          </button>
        )}

        {/* Plan button */}
        <button
          type="button"
          onClick={onPlanToggle}
          className={cn(
            "flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-all",
            planEnabled
              ? "border-foreground/60 bg-secondary text-foreground"
              : "border-border bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
          )}
        >
          <HugeiconsIcon icon={SparklesIcon} size={14} />
          Plan
        </button>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Model selector */}
        <Popover open={modelOpen} onOpenChange={onModelOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-8 items-center gap-1 rounded-full border border-border bg-secondary px-3 text-xs text-muted-foreground transition-all hover:bg-secondary/80 hover:text-foreground"
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

        {/* Mic button */}
        <button
          type="button"
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-all hover:text-foreground"
          aria-label="Voice input"
        >
          <HugeiconsIcon icon={Mic01Icon} size={16} />
        </button>

        {/* Send button */}
        <button
          type="button"
          disabled={!hasInput}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full transition-all",
            hasInput
              ? "bg-foreground text-background shadow-sm hover:bg-foreground/90"
              : "bg-secondary text-muted-foreground/50"
          )}
          aria-label="Send message"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={16} />
        </button>
      </div>
    </div>
  )
}
