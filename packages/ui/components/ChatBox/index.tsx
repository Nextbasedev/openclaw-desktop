"use client"

import * as React from "react"

import { PlusMenu } from "./PlusMenu"
import { PlanButton } from "./PlanButton"
import { WebSearchPill } from "./WebSearchPill"
import { ModelSelector, MODELS } from "./ModelSelector"
import { MicButton } from "./MicButton"
import { SendButton } from "./SendButton"

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
            <PlusMenu
              open={plusOpen}
              onOpenChange={setPlusOpen}
              webSearchEnabled={webSearchEnabled}
              onWebSearchToggle={handleWebSearchToggle}
            />
            <PlanButton
              enabled={planEnabled}
              onToggle={() => setPlanEnabled((prev) => !prev)}
            />
            {webSearchEnabled && (
              <WebSearchPill
                onDisable={() => setWebSearchEnabled(false)}
              />
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-1.5">
            <ModelSelector
              open={modelOpen}
              onOpenChange={setModelOpen}
              selected={selectedModel}
              onSelect={(model) => {
                setSelectedModel(model)
                setModelOpen(false)
              }}
            />
            <MicButton />
            <SendButton disabled={!hasInput} />
          </div>
        </div>
      </div>
    </div>
  )
}
