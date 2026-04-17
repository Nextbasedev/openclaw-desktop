"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { Tick01Icon } from "@hugeicons/core-free-icons"

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

type ModelSelectorProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: Model
  onSelect: (model: Model) => void
}

export function ModelSelector({
  open,
  onOpenChange,
  selected,
  onSelect,
}: ModelSelectorProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-1 rounded-full border border-border/60 px-3.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {selected.label}
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
              selected.id === model.id
                ? "text-foreground font-medium"
                : "text-muted-foreground"
            )}
            onClick={() => onSelect(model)}
          >
            {model.label}
            {selected.id === model.id && (
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
  )
}
