"use client"

// This comment line is from openclaw and we are shows here it is works proper
import { useRef, useCallback, useEffect } from "react"
import { Icons } from "@/components/icons"
import { StopSquareIcon } from "@/components/ChatBox/Icons"
import { cn } from "@/lib/utils"

type Props = {
  input: string
  onChange: (value: string) => void
  onSend: () => void
  onAbort: () => void
  isSending: boolean
  isGenerating: boolean
  isFocused: boolean
  onFocus: () => void
  onBlur: () => void
}

export function ChatInput({ input, onChange, onSend, onAbort, isSending, isGenerating, isFocused, onFocus, onBlur }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hasInput = input.trim().length > 0

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }, [])

  useEffect(() => {
    if (!input && textareaRef.current) textareaRef.current.style.height = "auto"
  }, [input])

  return (
    <div
      className={cn(
        "flex items-end gap-3 rounded-2xl border bg-card px-4 py-3 transition-all duration-150",
        isFocused
          ? "border-foreground/20 shadow-[0_0_0_1px_hsl(var(--border))] ring-1 ring-ring/10"
          : "border-border/40",
      )}
    >
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => { onChange(e.target.value); autoResize() }}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend() }
        }}
        placeholder="Message… (Shift+Enter for new line)"
        rows={1}
        disabled={isSending}
        className="flex-1 resize-none bg-transparent text-[14px] leading-[22px] text-foreground outline-none placeholder:text-muted-foreground/40 disabled:opacity-50"
        style={{ minHeight: "22px", maxHeight: "200px" }}
      />

      {isGenerating && !hasInput ? (
        <button
          onClick={onAbort}
          title="Stop generating"
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90"
        >
          <StopSquareIcon className="size-6" />
        </button>
      ) : (
        <button
          onClick={onSend}
          disabled={!hasInput || isSending}
          title="Send (Enter)"
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all",
            hasInput && !isSending
              ? "cursor-pointer bg-foreground text-background"
              : "cursor-not-allowed bg-foreground/15 text-background/40",
          )}
        >
          <Icons.Forward size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
