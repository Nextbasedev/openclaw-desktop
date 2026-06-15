"use client"

import { useState } from "react"
import { VscChevronDown, VscChevronRight } from "react-icons/vsc"
import { LuBrain } from "react-icons/lu"
import { cn } from "@/lib/utils"
import { MarkdownContent } from "./MarkdownContent"

import { memo } from "react"

export const ThinkingBlock = memo(function ThinkingBlock({ text, defaultOpen = false }: { text?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const trimmed = text?.trim()
  if (!trimmed) return null

  return (
    <div className="mb-2 max-w-[85%]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "mb-0.5 flex cursor-pointer items-center gap-1.5 py-1",
          "text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        )}
      >
        {open ? <VscChevronDown className="size-3" /> : <VscChevronRight className="size-3" />}
        <LuBrain className="size-3.5" />
        <span className="text-[12px] font-semibold">Thinking</span>
        <span className="text-[11px] text-muted-foreground/40">
          reasoning preview
        </span>
      </button>
      <div className="ml-1 border-l border-border/20 pl-2">
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div
              className={cn(
                "rounded-lg bg-muted/25 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground",
                "transition-all duration-300 ease-out",
                open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
              )}
            >
              <MarkdownContent text={trimmed} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
