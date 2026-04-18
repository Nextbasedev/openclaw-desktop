"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { ActionBar, MODELS } from "./ActionBar"

export function ChatBox() {
  const [input, setInput] = React.useState("")
  const [planEnabled, setPlanEnabled] = React.useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = React.useState(false)
  const [selectedModel, setSelectedModel] = React.useState(MODELS[0])
  const [plusOpen, setPlusOpen] = React.useState(false)
  const [modelOpen, setModelOpen] = React.useState(false)
  const [isFocused, setIsFocused] = React.useState(false)
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
      <div
        className={cn(
          "flex flex-col rounded-2xl border bg-card transition-all",
          isFocused
            ? "border-foreground/20 shadow-[0_0_0_1px_var(--border)] ring-1 ring-ring/10"
            : "border-border"
        )}
      >
        {/* Textarea */}
        <div className="flex w-full flex-col pt-3">
          <textarea
            ref={textareaRef}
            className="min-h-[68px] w-full resize-none bg-transparent px-3 py-1 text-[15.5px] leading-[26px] text-foreground outline-none placeholder:text-muted-foreground/60"
            placeholder="Message... (type / for commands)"
            rows={1}
            value={input}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onChange={(e) => {
              setInput(e.target.value)
              autoResize()
            }}
          />
        </div>

        {/* Action bar */}
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
  )
}
