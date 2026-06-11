"use client"

import { useRef, useEffect, useCallback, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import {
  isActiveSubagent,
  subagentStatusLabel,
  type SubagentLifecycleStatus,
} from "@/lib/subagentLifecycle"
import {
  VscArrowLeft,
  VscCheck,
  VscChevronDown,
  VscChevronRight,
  VscError,
  VscHubot,
} from "react-icons/vsc"
import { LuLoader, LuTerminal } from "react-icons/lu"
import {
  useSubagentMessages,
  type SubagentMessage,
  type SubagentToolCall,
} from "@/hooks/useSubagentMessages"
import { MarkdownContent } from "./MarkdownContent"

function ToolIcon({ status }: { status: SubagentToolCall["status"] }) {
  if (status === "running") {
    return <LuLoader className="size-3.5 shrink-0 animate-spin text-blue-400" />
  }
  if (status === "error") {
    return <VscError className="size-3.5 shrink-0 text-rose-400" />
  }
  return <VscCheck className="size-3.5 shrink-0 text-emerald-400/80" />
}

function SubagentToolsStrip({ tools }: { tools: SubagentToolCall[] }) {
  const [open, setOpen] = useState(false)
  const first = tools[0]
  const runningCount = tools.filter((tool) => tool.status === "running").length
  const errorCount = tools.filter((tool) => tool.status === "error").length

  if (!first) return null

  return (
    <div className="mt-5 max-w-[85%] rounded-xl border border-border/15 bg-card/35">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.03]"
        aria-expanded={open}
      >
        {open ? (
          <VscChevronDown className="size-3.5 shrink-0 text-muted-foreground/50" />
        ) : (
          <VscChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
        )}
        <LuTerminal className="size-3.5 shrink-0 text-muted-foreground/55" />
        <span className="flex-1 truncate text-[12px] font-medium text-foreground/70">
          Tools used
        </span>
        {runningCount > 0 && (
          <span className="rounded-full border border-blue-400/15 bg-blue-400/10 px-2 py-0.5 text-[10px] font-medium text-blue-300">
            {runningCount} running
          </span>
        )}
        {errorCount > 0 && (
          <span className="rounded-full border border-rose-400/15 bg-rose-400/10 px-2 py-0.5 text-[10px] font-medium text-rose-300">
            {errorCount} failed
          </span>
        )}
        <span className="text-[11px] text-muted-foreground/45">
          {tools.length}
        </span>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border/10 px-2 py-1.5">
            {tools.map((tool) => (
              <div
                key={tool.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5"
              >
                <ToolIcon status={tool.status} />
                <span className="flex-1 truncate text-[12px] text-foreground/65">
                  {tool.name}
                </span>
                <span className="text-[10px] capitalize text-muted-foreground/45">
                  {tool.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function MsgBubble({ msg }: { msg: SubagentMessage }) {
  const isUser = msg.role === "user"

  if (isUser) {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[#252529] px-4 py-2.5 text-[14px] leading-relaxed text-white">
          <p className="whitespace-pre-wrap">{msg.text}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {msg.text && (
        <div className="max-w-[85%] text-[14px] leading-relaxed text-foreground">
          <MarkdownContent text={msg.text} />
        </div>
      )}
    </div>
  )
}

export function SubagentFullChat({
  sessionKey,
  label,
  status,
  fallbackPrompt = "",
  fallbackText = "",
  onBack,
}: {
  sessionKey: string
  label: string
  status: SubagentLifecycleStatus
  fallbackPrompt?: string
  fallbackText?: string
  onBack: () => void
}) {
  const isLive = isActiveSubagent(status)
  const { messages, loading } = useSubagentMessages(sessionKey, isLive)
  const toolCalls = useMemo(() => {
    const byId = new Map<string, SubagentToolCall>()
    for (const msg of messages) {
      for (const tool of msg.toolCalls ?? []) {
        byId.set(tool.id, tool)
      }
    }
    return Array.from(byId.values())
  }, [messages])
  const conversationMessages = messages.filter(
    (msg) => msg.text.trim().length > 0 || (msg.toolCalls?.length ?? 0) > 0
  )
  const hasFallback =
    fallbackPrompt.trim().length > 0 || fallbackText.trim().length > 0
  const displayMessages =
    conversationMessages.length > 0 || !hasFallback
      ? conversationMessages
      : [
          ...(fallbackPrompt.trim()
            ? [{
                id: `fallback-${sessionKey}-prompt`,
                role: "user" as const,
                text: fallbackPrompt,
              }]
            : []),
          ...(fallbackText.trim()
            ? [{
            id: `fallback-${sessionKey}`,
            role: "assistant" as const,
            text: fallbackText,
              }]
            : []),
        ]
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [displayMessages, scrollToBottom])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border/20 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex size-8 items-center justify-center rounded-lg cursor-pointer text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <VscArrowLeft className="size-4" />
        </button>
        <VscHubot
          className={cn(
            "size-4",
            isLive ? "text-blue-400" : "text-muted-foreground/50",
          )}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-medium text-foreground">
            {label}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {isLive ? `${subagentStatusLabel(status)}...` : status === "failed" ? "Failed" : "Completed"}
          </p>
        </div>
        {isLive && (
          <span className="flex items-center gap-1.5 rounded-full border border-blue-400/20 bg-blue-400/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-blue-400">
            <span className="relative flex size-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/60" />
              <span className="relative size-1.5 rounded-full bg-blue-400" />
            </span>
            Live
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 scroll-smooth overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-8">
          {loading && displayMessages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className="size-5 animate-spin rounded-full border-2 border-border/30 border-t-foreground/50" />
              <p className="text-[11px] text-muted-foreground">
                Loading sub-agent conversation...
              </p>
            </div>
          ) : displayMessages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              {isLive && (
                <div className="size-5 animate-spin rounded-full border-2 border-border/30 border-t-blue-400/50" />
              )}
              <p className="text-[11px] text-muted-foreground">
                {isLive
                  ? "Waiting for sub-agent activity..."
                  : "No sub-agent activity was saved for this run."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {displayMessages.map((msg) => (
                <div key={msg.id} className="contents">
                  {msg.text.trim().length > 0 && <MsgBubble msg={msg} />}
                  {(msg.toolCalls?.length ?? 0) > 0 && (
                    <SubagentToolsStrip tools={msg.toolCalls ?? []} />
                  )}
                </div>
              ))}
              {toolCalls.length > 0 && displayMessages.length === 0 && (
                <SubagentToolsStrip tools={toolCalls} />
              )}
            </div>
          )}

          {isLive && displayMessages.length > 0 && (
            <div className="mt-4 flex items-center gap-2 pl-1">
              <div className="flex gap-1">
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
              </div>
              <span className="text-[11px] text-muted-foreground/50">
                Working...
              </span>
            </div>
          )}

          <div ref={bottomRef} className="h-px" />
        </div>
      </div>

      <div className="shrink-0 border-t border-border/10 bg-background/60 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-2 rounded-xl border border-border/15 bg-card/50 px-4 py-3 text-[12px] text-muted-foreground/50">
          <VscHubot className="size-3.5" />
          {isLive
            ? "Sub-agent is working..."
            : "Sub-agent conversation — read only"}
        </div>
      </div>
    </div>
  )
}
