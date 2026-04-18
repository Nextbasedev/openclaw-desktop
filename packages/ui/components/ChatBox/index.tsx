"use client"

import * as React from "react"

import { ActionBar, MODELS } from "./ActionBar"

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
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {/* Textarea */}
        <div className="px-4 pt-4 pb-3">
          <textarea
            ref={textareaRef}
            className="min-h-[80px] w-full resize-none bg-transparent text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground/60"
            placeholder="Message..."
            rows={3}
            value={input}
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
