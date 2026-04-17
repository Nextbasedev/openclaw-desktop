"use client"

import * as React from "react"
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

const MODELS = [
  { id: "gpt-5.2", label: "GPT-5.2" },
  { id: "claude-opus", label: "Claude Opus" },
  { id: "claude-sonnet", label: "Claude Sonnet" },
  { id: "gemini-2", label: "Gemini 2" },
]

export function ChatBox() {
  const [input, setInput] = React.useState("")
  const [planEnabled, setPlanEnabled] = React.useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = React.useState(false)
  const [selectedModel, setSelectedModel] = React.useState(MODELS[0])
  const [plusOpen, setPlusOpen] = React.useState(false)
  const [modelOpen, setModelOpen] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const hasInput = input.trim().length > 0

  function handleWebSearchToggle() {
    setWebSearchEnabled((prev) => !prev)
    setPlusOpen(false)
  }

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4">
      <div className="rounded-2xl border border-border/70 bg-card/95 shadow-lg backdrop-blur-xl">
        {/* Textarea */}
        <div className="px-4 pt-4 pb-2">
          <textarea
            ref={textareaRef}
            className="w-full resize-none bg-transparent text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground/80"
            placeholder="Message..."
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              autoResize()
            }}
          />
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          {/* Left side */}
          <div className="flex items-center gap-1.5">
            {/* Plus button with popover */}
            <Popover open={plusOpen} onOpenChange={setPlusOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full border transition-colors",
                    "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  aria-label="Add"
                >
                  <HugeiconsIcon icon={PlusSignIcon} size={18} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                className="w-52 gap-1 p-2"
              >
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
                      ? "text-foreground font-medium"
                      : "text-foreground"
                  )}
                  onClick={handleWebSearchToggle}
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
              onClick={() => setPlanEnabled((prev) => !prev)}
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
                onClick={() => setWebSearchEnabled(false)}
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
            <Popover open={modelOpen} onOpenChange={setModelOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 items-center gap-1 rounded-full border border-border/60 px-3.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {selectedModel.label}
                  <span className="text-xs">⌄</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                className="w-48 gap-1 p-2"
              >
                {MODELS.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted",
                      selectedModel.id === model.id
                        ? "text-foreground font-medium"
                        : "text-muted-foreground"
                    )}
                    onClick={() => {
                      setSelectedModel(model)
                      setModelOpen(false)
                    }}
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
                  : "bg-muted text-muted-foreground/50 cursor-not-allowed"
              )}
              aria-label="Send message"
            >
              <HugeiconsIcon icon={ArrowUp01Icon} size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
