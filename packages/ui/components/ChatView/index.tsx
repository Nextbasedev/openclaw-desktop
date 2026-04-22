"use client"

import { useCallback, useRef, useState } from "react"
import { useChatMessages } from "@/hooks/useChatMessages"
import { MessageBubble, TypingDots } from "./MessageBubble"
import { ToolCallSteps } from "./ToolCallSteps"
import { SubagentCard } from "./SubagentCard"
import { SubagentBar } from "./SubagentBar"
import { SubagentFullChat } from "./SubagentFullChat"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { ChatBox } from "@/components/ChatBox"
import type { SpawnedSubagent } from "./types"

type Props = {
  sessionKey: string
  sessionTitle?: string
  onFirstMessageSent?: (text: string) => void
  initialMessages?: import("./types").ChatMessage[]
  onSelectTool?: (toolCallId: string) => void
  initialPrompt?: string
  activeSubagentKey?: string | null
  onSubagentOpen?: (key: string | null) => void
}

export function ChatView({
  sessionKey,
  onFirstMessageSent,
  initialMessages,
  onSelectTool,
  initialPrompt,
  activeSubagentKey: externalSubagentKey,
  onSubagentOpen,
}: Props) {
  const {
    messages, status, statusLabel, loading, loadError,
    isGenerating, bottomRef, scrollContainerRef, onScroll,
    handleSend, handleAbort, handleEdit, switchBranch, pendingTools,
    spawnedSubagents,
  } = useChatMessages(sessionKey, initialMessages)

  const [internalSubagentKey, setInternalSubagentKey] = useState<string | null>(null)
  const activeSubKey = externalSubagentKey ?? internalSubagentKey

  const [activeSubagent, setActiveSubagent] = useState<SpawnedSubagent | null>(null)

  const openSubagent = useCallback((sub: SpawnedSubagent) => {
    setActiveSubagent(sub)
    if (onSubagentOpen) {
      onSubagentOpen(sub.sessionKey)
    } else {
      setInternalSubagentKey(sub.sessionKey)
    }
  }, [onSubagentOpen])

  const closeSubagent = useCallback(() => {
    setActiveSubagent(null)
    if (onSubagentOpen) {
      onSubagentOpen(null)
    } else {
      setInternalSubagentKey(null)
    }
  }, [onSubagentOpen])

  const firstFiredRef = useRef(false)
  const wrappedSend = useCallback((text: string) => {
    if (!firstFiredRef.current && messages.length === 0 && onFirstMessageSent) {
      firstFiredRef.current = true
      onFirstMessageSent(text)
    }
    handleSend(text)
  }, [handleSend, messages.length, onFirstMessageSent])

  if (activeSubKey && activeSubagent) {
    return (
      <SubagentFullChat
        sessionKey={activeSubKey}
        label={activeSubagent.label}
        status={activeSubagent.status}
        onBack={closeSubagent}
      />
    )
  }

  const statusText =
    status === "thinking" ? "Thinking..."
    : status === "tool_running" ? `Running${statusLabel ? ` · ${statusLabel}` : " tool"}...`
    : status === "streaming" ? "Responding..."
    : null

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
          <span className="text-[13px] text-muted-foreground">Loading conversation...</span>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full w-full items-center justify-center px-8">
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-5 py-4 text-center">
          <p className="text-sm font-medium text-red-400">Failed to load session</p>
          <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
        </div>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-8 py-10">
        <AnimatedGreeting />
        <ChatBox
          onSend={(text) => wrappedSend(text)}
          disabled={false}
          isGenerating={isGenerating}
          onAbort={handleAbort}
          initialPrompt={initialPrompt}
        />
        {status === "error" && (
          <p className="mt-2 text-center text-[11px] text-red-400/70">
            Something went wrong. Try again.
          </p>
        )}
      </div>
    )
  }

  const lastTwoAssistantIds = new Set(
    messages
      .filter((m) => m.role === "assistant")
      .slice(-2)
      .map((m) => m.messageId),
  )

  const toolCallsWithoutSpawn = (tools: import("./types").InlineToolCall[]) =>
    tools.filter((t) => t.tool !== "sessions_spawn" && t.tool !== "subagents" && t.tool !== "sessions_yield")

  const spawnsByToolCallId = new Map<string, SpawnedSubagent>()
  for (const sub of spawnedSubagents) {
    spawnsByToolCallId.set(sub.toolCallId, sub)
  }

  function getSubagentsForMessage(
    toolCalls?: import("./types").InlineToolCall[],
  ): SpawnedSubagent[] {
    if (!toolCalls) return []
    const matched: SpawnedSubagent[] = []
    for (const tc of toolCalls) {
      if (tc.tool === "sessions_spawn") {
        const sub = spawnsByToolCallId.get(tc.id)
        if (sub) matched.push(sub)
      }
    }
    return matched
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="flex flex-col gap-5">
            {messages.map((msg, i) => {
              const isLast = i === messages.length - 1
              const showPending =
                isLast &&
                isGenerating &&
                pendingTools.length > 0 &&
                msg.role === "user"
              const isActivelyStreaming =
                isLast && isGenerating && msg.role === "assistant"

              const showPendingAbove =
                isActivelyStreaming && pendingTools.length > 0

              const filteredToolCalls = msg.toolCalls
                ? toolCallsWithoutSpawn(msg.toolCalls)
                : undefined
              const filteredPending = toolCallsWithoutSpawn(pendingTools)

              const msgSubagents = getSubagentsForMessage(msg.toolCalls)
              const liveSubagents = (isLast && isGenerating)
                ? getSubagentsForMessage(pendingTools)
                : []
              const allSubagents = msgSubagents.length > 0
                ? msgSubagents
                : liveSubagents

              return (
                <div key={msg.messageId}>
                  {msg.role === "assistant" &&
                    filteredToolCalls &&
                    filteredToolCalls.length > 0 && (
                      <div className="mb-2 max-w-[85%]">
                        <ToolCallSteps
                          tools={filteredToolCalls}
                          defaultOpen={lastTwoAssistantIds.has(msg.messageId)}
                          onSelectTool={onSelectTool}
                        />
                      </div>
                    )}
                  {showPendingAbove && filteredPending.length > 0 && (
                    <div className="mb-2 max-w-[85%]">
                      <ToolCallSteps
                        tools={filteredPending}
                        defaultOpen
                        onSelectTool={onSelectTool}
                      />
                    </div>
                  )}
                  {msg.role === "assistant" && allSubagents.length > 0 && (
                    <div className="mb-2">
                      <SubagentCard
                        subagents={allSubagents}
                        onOpen={openSubagent}
                      />
                    </div>
                  )}
                  {(msg.role === "user" || msg.text) && (
                    <MessageBubble
                      message={msg}
                      onEdit={handleEdit}
                      onSwitchBranch={switchBranch}
                      isGenerating={isGenerating}
                      isActivelyStreaming={isActivelyStreaming}
                    />
                  )}
                  {msg.role === "user" && allSubagents.length > 0 && (
                    <div className="mt-3">
                      <SubagentCard
                        subagents={allSubagents}
                        onOpen={openSubagent}
                      />
                    </div>
                  )}
                  {showPending && filteredPending.length > 0 && (
                    <div className="mt-4 max-w-[85%]">
                      <ToolCallSteps
                        tools={filteredPending}
                        defaultOpen
                        onSelectTool={onSelectTool}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {statusText && (
            <div className="mt-4 flex items-center gap-2 pl-1">
              <TypingDots />
              <span className="text-[12px] text-muted-foreground">{statusText}</span>
            </div>
          )}

          <div ref={bottomRef} className="h-px" />
        </div>
      </div>

      <div className="shrink-0 bg-background/60 py-3 backdrop-blur-sm">
        {spawnedSubagents.length > 0 && (
          <div className="mb-2">
            <SubagentBar
              subagents={spawnedSubagents}
              onOpen={openSubagent}
            />
          </div>
        )}
        <ChatBox
          onSend={(text) => wrappedSend(text)}
          disabled={false}
          isGenerating={isGenerating}
          onAbort={handleAbort}
        />
        {status === "error" && (
          <p className="mt-2 text-center text-[11px] text-red-400/70">
            Something went wrong. Try again.
          </p>
        )}
      </div>
    </div>
  )
}
