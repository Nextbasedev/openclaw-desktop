"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { ActionBar, MODELS } from "./ActionBar"

type ChatBoxProps = {
  initialPrompt?: string
}

export function ChatBox({ initialPrompt }: ChatBoxProps) {
  const [input, setInput] = React.useState(initialPrompt ?? "")
  const [planEnabled, setPlanEnabled] = React.useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = React.useState(false)
  const [selectedModel, setSelectedModel] = React.useState(MODELS[0])
  const [plusOpen, setPlusOpen] = React.useState(false)
  const [modelOpen, setModelOpen] = React.useState(false)
  const [isFocused, setIsFocused] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    if (initialPrompt && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(initialPrompt.length, initialPrompt.length)
      autoResize()
    }
  }, [])

  const hasInput = input.trim().length > 0

  function handleWebSearchToggle() {
    setWebSearchEnabled((prev) => !prev)
    setPlusOpen(false)
  }

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const maxH = 8 * 24
    el.style.height = Math.max(56, Math.min(el.scrollHeight, maxH)) + "px"
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-2 sm:px-4">
      <div
        className={cn(
          "relative flex flex-col rounded-2xl border bg-card transition-all",
          isFocused
            ? "border-foreground/25 shadow-[0_0_0_1px_hsl(var(--border))] ring-1 ring-ring/10"
            : "border-border/50"
        )}
      >
        <div className="flex w-full flex-col pt-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              autoResize()
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Message... (type / for commands)"
            rows={1}
            className="w-full resize-none bg-transparent px-3 py-1 text-[15.5px] leading-[26px] text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
            style={{ minHeight: "68px", maxHeight: "250px" }}
            autoFocus
          />

          <ActionBar
            hasInput={hasInput}
            planEnabled={planEnabled}
            onPlanToggle={() => setPlanEnabled((prev) => !prev)}
            webSearchEnabled={webSearchEnabled}
            onWebSearchToggle={handleWebSearchToggle}
            onWebSearchDisable={() => setWebSearchEnabled(false)}
            plusOpen={plusOpen}
            onPlusOpenChange={setPlusOpen}
            modelOpen={modelOpen}
            onModelOpenChange={setModelOpen}
            selectedModel={selectedModel}
            onModelSelect={(model) => {
              setSelectedModel(model)
              setModelOpen(false)
            }}
          />
        </div>
      </div>
    </div>
  )
}
