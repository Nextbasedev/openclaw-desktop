"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useChatMessages } from "@/hooks/useChatMessages"
import { useChatCompletionNotify } from "@/hooks/useChatCompletionNotify"
import { MessageBubble, TypingDots } from "./MessageBubble"
import { ToolCallSteps } from "./ToolCallSteps"
import { SubagentCard } from "./SubagentCard"
import { SubagentBar } from "./SubagentBar"
import { SubagentFullChat } from "./SubagentFullChat"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { ChatBox } from "@/components/ChatBox"
import type { ChatComposerSubmit } from "@/lib/chatAttachments"
import { isSubagentSessionKey } from "@/lib/subagentSession"
import {
  exportMessagesMarkdown,
  initialMessageActionState,
  messageActionReducer,
  pinnedMessages,
  quotePrefix,
  visibleMessages,
} from "@/lib/messageActions"
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
  /** When true the view is mounted in a hidden div (background session). */
  isBackgroundSession?: boolean
}

function cleanSubagentReply(text: string) {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim()
      if (trimmed === "Done.") return false
      if (/^I spawned a subagent\b/i.test(trimmed)) return false
      return true
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function ChatView({
  sessionKey,
  sessionTitle,
  onFirstMessageSent,
  initialMessages,
  onSelectTool,
  initialPrompt,
  activeSubagentKey: externalSubagentKey,
  onSubagentOpen,
  isBackgroundSession = false,
}: Props) {
  const {
    messages, status, statusLabel, loading, loadError, errorMessage,
    isGenerating, bottomRef, scrollContainerRef, onScroll,
    handleSend, handleAbort, handleEdit, switchBranch, pendingTools,
    spawnedSubagents,
  } = useChatMessages(sessionKey, initialMessages)

  const lastAssistantText = messages
    .filter((m) => m.role === "assistant")
    .at(-1)?.text

  // Keep a stable ref for handleSend so the toast listener doesn't re-attach
  const handleSendRef = useRef(handleSend)
  handleSendRef.current = handleSend

  // Listen for Windows toast reply / open events.
  // Use a ref for unlisten functions so Strict Mode double-mounts
  // don't leave dangling listeners behind.
  const toastUnlistenRef = useRef<{ reply?: () => void; open?: () => void }>({})

  useEffect(() => {
    const setup = async () => {
      const tauri = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
      if (!tauri) return
      try {
        const { listen } = await import("@tauri-apps/api/event")
        const { getCurrentWindow } = await import("@tauri-apps/api/window")

        // Clean up any previous dangling listeners (React Strict Mode)
        toastUnlistenRef.current.reply?.()
        toastUnlistenRef.current.open?.()

        toastUnlistenRef.current.reply = await listen<{ sessionKey: string; text: string }>("toast-reply", (event) => {
          if (event.payload.sessionKey === sessionKey) {
            void handleSendRef.current({ text: event.payload.text })
              .then(async () => {
                try {
                  const win = getCurrentWindow()
                  // Only minimize if the app wasn't already focused
                  // (user replied from a background toast). If they're
                  // already inside the app, keep the window open.
                  const focused = await win.isFocused()
                  if (!focused) await win.minimize()
                } catch {
                  // Ignore window API errors
                }
              })
              .catch(() => {})
          }
        })

        toastUnlistenRef.current.open = await listen<{ sessionKey: string }>("toast-open", (event) => {
          if (event.payload.sessionKey === sessionKey) {
            const win = getCurrentWindow()
            void win.unminimize().then(() => win.setFocus()).catch(() => {})
          }
        })
      } catch {
        // Ignore if Tauri API is not available
      }
    }
    setup()
    return () => {
      toastUnlistenRef.current.reply?.()
      toastUnlistenRef.current.open?.()
    }
  }, [sessionKey])

  const [internalSubagentKey, setInternalSubagentKey] = useState<string | null>(null)
  const [activeSubagent, setActiveSubagent] = useState<SpawnedSubagent | null>(null)
  const [messageActionState, dispatchMessageAction] = useState(
    initialMessageActionState,
  )
  const [composerSeed, setComposerSeed] = useState(initialPrompt ?? "")
  const activeSubKey =
    externalSubagentKey ?? internalSubagentKey ?? activeSubagent?.sessionKey ?? null

  // Only suppress notifications when the main chat for THIS session is visible.
  // If a subagent is open, the user is on another page, or this is a
  // background (hidden) session, notify normally.
  const isMainChatVisible = !isBackgroundSession && !(activeSubKey && activeSubagent)

  useChatCompletionNotify({
    sessionKey,
    sessionTitle,
    status,
    lastAssistantText,
    isVisible: isMainChatVisible,
  })

  useEffect(() => {
    setComposerSeed(initialPrompt ?? "")
  }, [initialPrompt])

  const openSubagent = useCallback((sub: SpawnedSubagent) => {
    if (!sub.sessionKey || sub.sessionKey === sessionKey) return
    setActiveSubagent({ ...sub, sessionKey: sub.sessionKey })
    setInternalSubagentKey(sub.sessionKey)
    onSubagentOpen?.(sub.sessionKey)
  }, [onSubagentOpen, sessionKey])

  const closeSubagent = useCallback(() => {
    setActiveSubagent(null)
    setInternalSubagentKey(null)
    onSubagentOpen?.(null)
  }, [onSubagentOpen])

  const activeSubagentFallbackText = useMemo(() => {
    if (!activeSubagent || !isSubagentSessionKey(activeSubagent.sessionKey)) {
      return ""
    }
    const assistantMessages = messages.filter(
      (message) => message.role === "assistant" && message.text.trim(),
    )
    const resultMessage =
      [...assistantMessages]
      .reverse()
      .find((message) =>
        /\bI spawned a subagent\b/i.test(message.text) ||
        /\bDone\./i.test(message.text),
      ) ?? assistantMessages.at(-1)
    return cleanSubagentReply(resultMessage?.text ?? "")
  }, [activeSubagent, messages])

  const activeSubagentFallbackPrompt =
    activeSubagent?.task?.trim() || "Run the delegated sub-agent task."

  const firstFiredRef = useRef(false)
  const wrappedSend = useCallback(async (payload: ChatComposerSubmit) => {
    const shouldNotifyFirstSend =
      !firstFiredRef.current &&
      messages.length === 0 &&
      Boolean(onFirstMessageSent)
    await handleSend(payload)
    if (shouldNotifyFirstSend && onFirstMessageSent) {
      firstFiredRef.current = true
      onFirstMessageSent(payload.text)
    }
    dispatchMessageAction((prev) =>
      messageActionReducer(prev, { type: "clear_reply" }),
    )
    setComposerSeed("")
  }, [handleSend, messages.length, onFirstMessageSent])

  const renderedMessages = useMemo(
    () => visibleMessages(messages, messageActionState),
    [messages, messageActionState],
  )
  const pinned = useMemo(
    () => pinnedMessages(messages, messageActionState),
    [messages, messageActionState],
  )

  const replyToMessage = useCallback((messageId: string) => {
    const target = messages.find((message) => message.messageId === messageId)
    if (!target) return
    dispatchMessageAction((prev) =>
      messageActionReducer(prev, { type: "reply", messageId }),
    )
    setComposerSeed(`${quotePrefix(target.text)}\n\n`)
  }, [messages])

  const togglePin = useCallback((messageId: string) => {
    dispatchMessageAction((prev) =>
      messageActionReducer(prev, {
        type: prev.pinnedIds.includes(messageId) ? "unpin" : "pin",
        messageId,
      }),
    )
  }, [])

  const deleteMessage = useCallback((messageId: string) => {
    dispatchMessageAction((prev) =>
      messageActionReducer(prev, { type: "delete", messageId }),
    )
  }, [])

  const reactToMessage = useCallback((messageId: string, reaction: "up" | "down") => {
    dispatchMessageAction((prev) =>
      messageActionReducer(prev, { type: "react", messageId, reaction }),
    )
  }, [])

  const regenerateFromMessage = useCallback((messageId: string) => {
    const target = messages.find((message) => message.messageId === messageId)
    if (!target) return
    setComposerSeed(`/regenerate ${quotePrefix(target.text)}\n\n`)
  }, [messages])

  const exportOneMessage = useCallback((messageId: string) => {
    const target = messages.find((message) => message.messageId === messageId)
    if (!target) return
    void navigator.clipboard.writeText(exportMessagesMarkdown([target]))
  }, [messages])

  if (activeSubKey && activeSubagent) {
    return (
      <SubagentFullChat
        sessionKey={activeSubKey}
        label={activeSubagent.label}
        status={activeSubagent.status}
        fallbackPrompt={activeSubagentFallbackPrompt}
        fallbackText={activeSubagentFallbackText}
        onBack={closeSubagent}
      />
    )
  }

  const statusText =
    status === "thinking" ? "Thinking..."
    : status === "tool_running" ? `Running${statusLabel ? ` · ${statusLabel}` : " tool"}...`
    : status === "streaming" ? "Responding..."
    : status === "stopping" ? "Stopping..."
    : status === "restarting" ? "Restarting..."
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
          onSend={wrappedSend}
          disabled={false}
          isGenerating={isGenerating}
          onAbort={handleAbort}
          initialPrompt={composerSeed}
        />
        {status === "error" && (
          <div className="mt-4 max-w-[85%] rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3">
            <p className="text-sm text-red-400">
              {errorMessage || "Something went wrong. Try again."}
            </p>
          </div>
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
            {pinned.length > 0 && (
              <div className="sticky top-2 z-10 mb-3 rounded-xl border border-border/20 bg-background/80 p-2 backdrop-blur">
                <div className="flex gap-2 overflow-x-auto">
                  {pinned.map((message) => (
                    <button
                      key={message.messageId}
                      type="button"
                      onClick={() => {
                        document
                          .getElementById(`message-${message.messageId}`)
                          ?.scrollIntoView({ behavior: "smooth", block: "center" })
                      }}
                      className="max-w-52 shrink-0 truncate rounded-lg bg-card px-3 py-1.5 text-left text-[11px] text-foreground/70 hover:bg-foreground/5"
                    >
                      {message.text}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {renderedMessages.map((msg, i) => {
              const isLast = i === renderedMessages.length - 1
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
                <div key={msg.messageId} id={`message-${msg.messageId}`}>
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
                      onReply={replyToMessage}
                      onPin={togglePin}
                      onDelete={deleteMessage}
                      onRegenerate={msg.role === "assistant" ? regenerateFromMessage : undefined}
                      onReact={msg.role === "assistant" ? reactToMessage : undefined}
                      onExport={exportOneMessage}
                      isPinned={messageActionState.pinnedIds.includes(msg.messageId)}
                      reaction={messageActionState.reactions[msg.messageId]}
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

          {status === "error" && (
            <div className="mt-4 max-w-[85%] rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3">
              <p className="text-sm text-red-400">
                {errorMessage || "Something went wrong. Try again."}
              </p>
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
          onSend={wrappedSend}
          disabled={false}
          isGenerating={isGenerating}
          onAbort={handleAbort}
          initialPrompt={composerSeed}
        />
      </div>
    </div>
  )
}
