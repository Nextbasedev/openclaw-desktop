"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { ActionBar, MODELS } from "./ActionBar"

type ChatBoxProps = {
  value?: string
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
  disabled?: boolean
}

export function ChatBox({
  value,
  onChange,
  onSubmit,
  disabled = false,
}: ChatBoxProps) {
  const [internalInput, setInternalInput] = React.useState("")
  const [planEnabled, setPlanEnabled] = React.useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = React.useState(false)
  const [selectedModel, setSelectedModel] = React.useState(MODELS[0])
  const [plusOpen, setPlusOpen] = React.useState(false)
  const [modelOpen, setModelOpen] = React.useState(false)
  const [isFocused, setIsFocused] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const input = value ?? internalInput
  const hasInput = input.trim().length > 0

  function setInput(next: string) {
    if (onChange) onChange(next)
    else setInternalInput(next)
  }

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

  function handleSubmit() {
    if (!hasInput || disabled) return
    onSubmit?.(input)
    if (!onChange) {
      setInternalInput("")
      requestAnimationFrame(() => {
        if (textareaRef.current) textareaRef.current.style.height = "68px"
      })
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4">
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder={disabled ? "Select a topic to start chatting" : "Message... (type / for commands)"}
            rows={1}
            disabled={disabled}
            className="w-full resize-none bg-transparent px-3 py-1 text-[15.5px] leading-[26px] text-foreground outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ minHeight: "68px", maxHeight: "250px" }}
            autoFocus
          />

          <ActionBar
            hasInput={hasInput && !disabled}
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
