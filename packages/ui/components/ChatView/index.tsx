"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useChatMessages } from "@/hooks/useChatMessages"
import { useChatCompletionNotify } from "@/hooks/useChatCompletionNotify"
import { MessageBubble, TypingDots } from "./MessageBubble"
import { ToolCallSteps } from "./ToolCallSteps"
import { SubagentCard } from "./SubagentCard"
import { SubagentBar } from "./SubagentBar"
import { SubagentFullChat } from "./SubagentFullChat"
import { PinnedMessagesPopover } from "./PinnedMessagesPopover"
import { MessageFeedbackDialog } from "./MessageFeedbackDialog"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { ChatLoadingSkeleton } from "@/components/Skeleton/ChatLoadingSkeleton"
import { ChatBox } from "@/components/ChatBox"
import {
  type ChatComposerSubmit,
} from "@/lib/chatAttachments"
import { isSubagentSessionKey } from "@/lib/subagentSession"
import {
  exportMessagesMarkdown,
  initialMessageActionState,
  messageActionReducer,
  pinnedMessages,
  visibleMessages,
} from "@/lib/messageActions"
import { invoke } from "@/lib/ipc"
import { emit } from "@/lib/events"
import { toast } from "react-toastify"
import { motion, AnimatePresence } from "framer-motion"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { ChatMessage, EditPreviewState, ReplyTo, SpawnedSubagent } from "./types"

type Props = {
  sessionKey: string
  sessionTitle?: string
  onFirstMessageSent?: (text: string) => void
  initialMessages?: import("./types").ChatMessage[]
  onSelectTool?: (toolCallId: string) => void
  initialPrompt?: string
  activeSubagentKey?: string | null
  onSubagentOpen?: (key: string | null) => void
  forkContext?: { type: "topic"; projectId: string; projectName: string; topicId: string; topicName: string } | { type: "chat" }
  onForkNavigate?: (chat: { id?: string | null; name: string; sessionKey: string; projectId?: string | null; topicId?: string | null }) => void
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

function PreviewResponseCard({
  title,
  user,
  assistant,
  loading,
  onSelect,
  disabled,
}: {
  title: string
  user: ChatMessage
  assistant?: ChatMessage | null
  loading?: boolean
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex min-h-[260px] flex-1 flex-col rounded-2xl border border-border/30 bg-foreground/[0.025] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <button
          type="button"
          disabled={disabled || loading || !assistant?.text}
          onClick={onSelect}
          className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          Use this
        </button>
      </div>
      <div className="mb-3 rounded-xl bg-[#252529] px-3 py-2 text-sm text-white">
        <p className="whitespace-pre-wrap line-clamp-5">{user.text}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/20 bg-background/40 p-3 text-sm leading-relaxed text-foreground/90">
        {assistant?.text ? (
          <p className="whitespace-pre-wrap">{assistant.text}</p>
        ) : loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <TypingDots />
            <span>Generating edited response…</span>
          </div>
        ) : (
          <span className="text-muted-foreground">No response yet</span>
        )}
      </div>
    </div>
  )
}

function EditPreviewPanel({
  preview,
  onSelect,
}: {
  preview: EditPreviewState
  onSelect: (selected: "original" | "edited") => void
}) {
  const loadingEdited = preview.status === "streaming" && !preview.edited.assistant?.text
  const isRegenerate = preview.original.user.text.trim() === preview.edited.user.text.trim()
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="mt-6 rounded-3xl border border-primary/20 bg-primary/[0.03] p-4 shadow-lg shadow-black/10"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Choose the response to keep</h2>
          <p className="text-xs text-muted-foreground">{isRegenerate ? "Compare the current answer with the regenerated one." : "Future context continues only from the version you select."}</p>
        </div>
        {preview.status === "error" && (
          <span className="rounded-full bg-red-500/10 px-2 py-1 text-xs text-red-400">
            {preview.error ?? "Preview failed"}
          </span>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <PreviewResponseCard
          title="Original"
          user={preview.original.user}
          assistant={preview.original.assistant}
          onSelect={() => onSelect("original")}
        />
        <PreviewResponseCard
          title={isRegenerate ? "Regenerated" : "Edited"}
          user={preview.edited.user}
          assistant={preview.edited.assistant}
          loading={loadingEdited}
          disabled={preview.status === "error"}
          onSelect={() => onSelect("edited")}
        />
      </div>
    </motion.div>
  )
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
  forkContext,
  onForkNavigate,
  isBackgroundSession = false,
}: Props) {
  const {
    messages, status, statusLabel, loading, loadError, errorMessage,
    isSending, isGenerating, bottomRef, scrollContainerRef, onScroll,
    handleSend, handleAbort, handleEdit, editPreview, selectEditBranch, switchBranch,
    markTextAnimationComplete, pendingTools, spawnedSubagents,
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
              .catch(() => { })
          }
        })

        toastUnlistenRef.current.open = await listen<{ sessionKey: string }>("toast-open", (event) => {
          if (event.payload.sessionKey === sessionKey) {
            const win = getCurrentWindow()
            void win.unminimize().then(() => win.setFocus()).catch(() => { })
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
  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null)
  const [pinnedPopoverOpen, setPinnedPopoverOpen] = useState(false)
  const pinButtonRef = useRef<HTMLButtonElement>(null)
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false)
  const [feedbackTargetId, setFeedbackTargetId] = useState<string | null>(null)
  const [activePopoverId, setActivePopoverId] = useState<string | null>(null)
  const [modelSwitching, setModelSwitching] = useState(false)
  const lastFeedbackTimesRef = useRef<Record<string, number>>({})
  const messageContentRef = useRef<HTMLDivElement>(null)
  const previousMessageCountRef = useRef(messages.length)
  const suppressResizeFollowUntilRef = useRef(0)

  const [dbPins, setDbPins] = useState<{
    pins: Array<{ messageId: string; messageText: string }>
    loaded: boolean
  }>({ pins: [], loaded: false })

  useEffect(() => {
    // Reset everything when the session changes
    dispatchMessageAction(initialMessageActionState)
    setDbPins({ pins: [], loaded: false })

    invoke<{ pins: Array<{ messageId: string; messageText: string }> }>("middleware_pins_list", {
      sessionKey,
    })
      .then(({ pins }) => {
        setDbPins({ pins, loaded: true })
        // Apply fetched pins immediately. If IDs match exactly, they'll show up.
        // If IDs mismatch, the reconciliation effect will fix them.
        dispatchMessageAction((prev) => ({
          ...prev,
          pinnedIds: pins.map((p) => p.messageId),
        }))
      })
      .catch(() => {
        setDbPins({ pins: [], loaded: true })
      })
  }, [sessionKey])

  // Reconcile DB pins against the loaded messages.
  // This handles the case where messageIds stored in the DB differ from the
  // ones the Gateway returns (e.g. after a sync or regeneration), by falling
  // back to a text snippet match.
  useEffect(() => {
    if (!dbPins.loaded || messages.length === 0) return

    const currentIds = new Set(messages.map((m) => m.messageId))
    const seen = new Set<string>()
    const resolved: string[] = []

    for (const pin of dbPins.pins) {
      let id: string | undefined
      if (currentIds.has(pin.messageId)) {
        id = pin.messageId
      } else if (pin.messageText) {
        const snippet = pin.messageText.slice(0, 80)
        const match = messages.find((m) => m.text.includes(snippet))
        if (match) id = match.messageId
      }

      if (id && !seen.has(id)) {
        seen.add(id)
        resolved.push(id)
      }
    }

    // Only update if the resolved set differs from current pinnedIds.
    // We compare arrays to avoid infinite update loops.
    const currentPinnedSet = new Set(messageActionState.pinnedIds)
    const setsMatch = resolved.length === currentPinnedSet.size &&
      resolved.every(id => currentPinnedSet.has(id))

    if (!setsMatch) {
      dispatchMessageAction((prev) => ({
        ...prev,
        pinnedIds: resolved,
      }))
    }
  }, [messages, dbPins.pins, dbPins.loaded, messageActionState.pinnedIds])
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

  const resolveExecApproval = useCallback(async (
    approvalId: string,
    decision: "allow-once" | "allow-always" | "deny",
  ) => {
    await invoke("middleware_exec_approval_resolve", {
      input: { approvalId, decision },
    })
    emit("chat:activity")
  }, [])

  const handleSessionModelSelect = useCallback(async (modelId: string) => {
    const toastId = toast.loading(`Switching model to ${modelId}…`)
    setModelSwitching(true)
    try {
      await invoke("middleware_chat_model_set", {
        input: { sessionKey, modelId },
      })
      emit("chat:activity")
      toast.update(toastId, {
        render: `Switched model to ${modelId}`,
        type: "success",
        isLoading: false,
        autoClose: 1800,
      })
    } catch (error) {
      toast.update(toastId, {
        render: error instanceof Error ? error.message : "Failed to switch model",
        type: "error",
        isLoading: false,
        autoClose: 3500,
      })
      throw error
    } finally {
      setModelSwitching(false)
    }
  }, [sessionKey])

  const wrappedSend = useCallback(async (payload: ChatComposerSubmit) => {
    if (modelSwitching) {
      toast.info("Switching model… please wait before sending.")
      return
    }
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
    setReplyTo(null)
    setComposerSeed("")
  }, [handleSend, messages.length, modelSwitching, onFirstMessageSent])

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
    setReplyTo({
      messageId: target.messageId,
      role: target.role,
      text: target.text,
    })
  }, [messages])

  const askAboutSelectedText = useCallback((messageId: string, text: string) => {
    const selected = text.trim()
    if (!selected) return
    setReplyTo({
      messageId: `${messageId}:selection`,
      role: "assistant",
      text: selected,
    })
    setComposerSeed("")
  }, [])

  const cancelReply = useCallback(() => {
    setReplyTo(null)
    dispatchMessageAction((prev) =>
      messageActionReducer(prev, { type: "clear_reply" }),
    )
  }, [])

  const togglePin = useCallback((messageId: string) => {
    const isPinned = messageActionState.pinnedIds.includes(messageId)
    dispatchMessageAction((prev) =>
      messageActionReducer(prev, {
        type: isPinned ? "unpin" : "pin",
        messageId,
      }),
    )
    if (isPinned) {
      const msg = messages.find((m) => m.messageId === messageId)
      const snippet = msg?.text?.slice(0, 80) ?? ""

      setDbPins((prev) => ({
        ...prev,
        pins: prev.pins.filter((p) => {
          // Match by exact ID or by text snippet (in case ID changed)
          if (p.messageId === messageId) return false
          if (snippet && p.messageText?.includes(snippet)) return false
          return true
        }),
      }))

      invoke("middleware_pins_remove", {
        sessionKey,
        messageId,
        messageText: msg?.text?.slice(0, 200) ?? "",
      }).catch(() => { })
    } else {
      const msg = messages.find((m) => m.messageId === messageId)
      const text = msg?.text?.slice(0, 200) ?? ""

      setDbPins((prev) => ({
        ...prev,
        pins: [...prev.pins, { messageId, messageText: text }],
      }))

      invoke("middleware_pins_add", {
        sessionKey,
        messageId,
        messageText: text,
      }).catch(() => { })
    }
  }, [sessionKey, messages, messageActionState.pinnedIds])

  const deleteMessage = useCallback((messageId: string) => {
    dispatchMessageAction((prev) =>
      messageActionReducer(prev, { type: "delete", messageId }),
    )
  }, [])

  const reactToMessage = useCallback(
    (messageId: string, reaction: "up" | "down") => {
      const current = messageActionState.reactions[messageId]
      const isRemoving = current === reaction

      dispatchMessageAction((prev) =>
        messageActionReducer(prev, { type: "react", messageId, reaction }),
      )

      // Guard against double-clicks or rapid firing on the same message
      const now = Date.now()
      const lastTime = lastFeedbackTimesRef.current[messageId] || 0
      if (now - lastTime < 500) return
      lastFeedbackTimesRef.current[messageId] = now

      if (isRemoving) {
        invoke("middleware_message_feedback_delete", {
          conversation_id: sessionKey,
          message_id: messageId,
        }).catch(() => { })
        return
      }

      // Handle Feedback API (New or Changed)
      const rating = reaction === "up" ? "thumbsUp" : "thumbsDown"

      const payload: {
        conversation_id: string
        message_id: string
        rating: string
        tag_choices?: string[]
        tags?: string[]
        free_text?: string
      } = {
        conversation_id: sessionKey,
        message_id: messageId,
        rating,
      }

      if (reaction === "down") {
        payload.tag_choices = [
          "Incorrect or incomplete",
          "Not what I asked for",
          "Slow or buggy",
          "Style or tone",
          "Safety or legal concern",
          "Other",
        ]
        payload.tags = ["Other"]
      }

      invoke("middleware_message_feedback", payload)
        .then((res) => console.log("[Feedback Response]", res))
        .catch(() => { })

      if (reaction === "down") {
        setFeedbackTargetId(messageId)
        setFeedbackDialogOpen(true)
      }
    },
    [sessionKey, messageActionState.reactions],
  )

  const handleScroll = useCallback(() => {
    onScroll()
    if (activePopoverId) setActivePopoverId(null)
  }, [onScroll, activePopoverId])

  useEffect(() => {
    const previousCount = previousMessageCountRef.current
    previousMessageCountRef.current = messages.length
    const latestMessage = messages.at(-1)

    if (messages.length > previousCount && latestMessage?.role === "user") {
      suppressResizeFollowUntilRef.current = Date.now() + 450
    }
  }, [messages])

  useEffect(() => {
    const content = messageContentRef.current
    if (!content || typeof ResizeObserver === "undefined") return

    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = scrollContainerRef.current
        if (!el) return
        const distanceFromBottom =
          el.scrollHeight - el.scrollTop - el.clientHeight
        const shouldLetSmoothSendScrollFinish =
          Date.now() < suppressResizeFollowUntilRef.current

        if (isSending || shouldLetSmoothSendScrollFinish) {
          el.scrollTo({
            top: el.scrollHeight,
            behavior: "smooth",
          })
          return
        }

        if (isGenerating || distanceFromBottom < 260) {
          el.scrollTo({
            top: el.scrollHeight,
            behavior: "auto",
          })
        }
      })
    })

    observer.observe(content)

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [isSending, isGenerating, scrollContainerRef])

  const handleFeedbackSubmit = useCallback(
    (feedback: { tags: string[]; details: string }) => {
      if (!feedbackTargetId) return

      const payload = {
        conversation_id: sessionKey,
        message_id: feedbackTargetId,
        rating: "thumbsDown",
        tag_choices: [
          "Incorrect or incomplete",
          "Not what I asked for",
          "Slow or buggy",
          "Style or tone",
          "Safety or legal concern",
          "Other",
        ],
        tags: feedback.tags,
        details: feedback.details,
      }

      invoke("middleware_message_feedback", payload)
        .then((res) => console.log("[Feedback Response]", res))
        .catch(() => { })
    },
    [sessionKey, feedbackTargetId],
  )

  const forkFromMessage = useCallback(async (messageId: string) => {
    const msg = messages.find((m) => m.messageId === messageId)
    if (!msg || msg.gatewayIndex === undefined) return
    const requestId = `fork-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const optimisticName = forkContext?.type === "topic"
      ? `Fork: ${forkContext.topicName}`
      : "Forked chat"
    emit("fork:create", {
      status: "pending",
      requestId,
      name: optimisticName,
      context: forkContext ?? { type: "chat" },
    })
    const toastId = toast.loading(forkContext?.type === "topic" ? "Creating fork topic…" : "Creating fork chat…")
    try {
      const result = await invoke<{
        chatId?: string | null
        sessionKey: string
        name: string
        projectId?: string | null
        topicId?: string | null
      }>("middleware_chat_fork", {
        input: {
          sessionKey,
          messageId,
          gatewayIndex: msg.gatewayIndex,
        },
      })
      emit("fork:create", {
        status: "resolved",
        requestId,
        name: result.name,
        chatId: result.chatId,
        sessionKey: result.sessionKey,
        projectId: result.projectId,
        topicId: result.topicId,
        context: forkContext ?? { type: "chat" },
      })
      toast.update(toastId, {
        render: forkContext?.type === "topic" ? "Fork topic created" : "Fork chat created",
        type: "success",
        isLoading: false,
        autoClose: 2500,
      })
      onForkNavigate?.({
        id: result.chatId,
        name: result.name,
        sessionKey: result.sessionKey,
        projectId: result.projectId,
        topicId: result.topicId,
      })
    } catch (err) {
      emit("fork:create", { status: "failed", requestId, context: forkContext ?? { type: "chat" } })
      toast.update(toastId, {
        render: "Fork failed",
        type: "error",
        isLoading: false,
        autoClose: 4000,
      })
      console.error("Fork failed", err)
    }
  }, [sessionKey, messages, forkContext, onForkNavigate])

  const exportOneMessage = useCallback((messageId: string) => {
    const target = messages.find((message) => message.messageId === messageId)
    if (!target) return
    void navigator.clipboard.writeText(exportMessagesMarkdown([target]))
  }, [messages])

  const lastEditableUserId = useMemo(() => {
    for (let i = renderedMessages.length - 1; i >= 0; i--) {
      if (renderedMessages[i].role === "user") return renderedMessages[i].messageId
      if (renderedMessages[i].role === "assistant") continue
    }
    return null
  }, [renderedMessages])

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
      : status === "queued" ? statusLabel ? `Queued - ${statusLabel}...` : "Queued..."
        : status === "running" ? statusLabel ? `Running - ${statusLabel}...` : "Running..."
          : status === "collect" ? statusLabel ? `Collecting - ${statusLabel}...` : "Collecting..."
            : status === "tool_running" ? `Running${statusLabel ? ` - ${statusLabel}` : " tool"}...`
              : status === "streaming" ? "Responding..."
                : status === "stopping" ? "Stopping..."
                  : status === "restarting" ? "Restarting..."
                    : isGenerating
                      ? statusLabel
                        ? `${statusLabel}...`
                        : "Thinking..."
                      : null

  if (loading) {
    return <ChatLoadingSkeleton />
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
          replyTo={replyTo}
          onCancelReply={cancelReply}
          onModelSelect={handleSessionModelSelect}
          modelSwitching={modelSwitching}
          glowOnMount
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

  const assistantMessages = messages.filter((m) => m.role === "assistant")
  const lastTwoAssistantIds = new Set(
    assistantMessages.slice(-2).map((m) => m.messageId),
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

  const subagentsByTriggerUserId = new Map<string, SpawnedSubagent[]>()
  const orphanSubagentsByAssistantId = new Map<string, SpawnedSubagent[]>()
  let nearestUserId: string | null = null

  for (const msg of renderedMessages) {
    if (msg.role === "user") {
      nearestUserId = msg.messageId
      continue
    }

    const msgSubagents = getSubagentsForMessage(msg.toolCalls)
    if (msgSubagents.length === 0) continue

    if (nearestUserId) {
      const existing = subagentsByTriggerUserId.get(nearestUserId) ?? []
      subagentsByTriggerUserId.set(nearestUserId, [...existing, ...msgSubagents])
    } else {
      orphanSubagentsByAssistantId.set(msg.messageId, msgSubagents)
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {/* Sub-header for chat actions & pins */}
      <div className="z-40 flex h-9 shrink-0 items-center justify-between bg-background/70 px-4 backdrop-blur-[2px]">
        <div className="flex items-center gap-4">
          {/* <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground/50">
            <Icons.BubbleChat size={12} className="opacity-50" />
            <span className="uppercase tracking-widest">Conversation</span>
          </div> */}
        </div>

        <div className="relative">
          <button
            ref={pinButtonRef}
            onClick={() => setPinnedPopoverOpen(!pinnedPopoverOpen)}
            className={cn(
              "group relative flex size-8 items-center justify-center rounded-sm transition-all cursor-pointer",
              pinnedPopoverOpen
                ? "text-foreground shadow-inner"
                : pinned.length > 0
                  ? "animate-pulse text-foreground"
                  : "text-muted-foreground/60 hover:text-foreground"
            )}
          >
            <Icons.Pin
              size={16}
              className={cn("transition-transform", pinnedPopoverOpen && "scale-110")}
            />
          </button>

          <PinnedMessagesPopover
            open={pinnedPopoverOpen}
            onClose={() => setPinnedPopoverOpen(false)}
            pinned={pinned}
            onTogglePin={togglePin}
            triggerRef={pinButtonRef}
            onNavigateToMessage={(id) => {
              document
                .getElementById(`message-${id}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
            }}
          />
        </div>
      </div>

      <MessageFeedbackDialog
        open={feedbackDialogOpen}
        onClose={() => setFeedbackDialogOpen(false)}
        onSubmit={handleFeedbackSubmit}
      />

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        <div ref={messageContentRef} className="mx-auto max-w-3xl px-4 py-8">
          <div className="flex flex-col gap-5">

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

              const anchoredUserSubagents = msg.role === "user"
                ? subagentsByTriggerUserId.get(msg.messageId) ?? []
                : []
              const orphanAssistantSubagents = msg.role === "assistant"
                ? orphanSubagentsByAssistantId.get(msg.messageId) ?? []
                : []
              const liveSubagents = (msg.role === "user" && isLast && isGenerating)
                ? getSubagentsForMessage(pendingTools)
                : []
              const userSubagents = anchoredUserSubagents.length > 0
                ? anchoredUserSubagents
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
                          onResolveApproval={resolveExecApproval}
                        />
                      </div>
                    )}
                  {showPendingAbove && filteredPending.length > 0 && (
                    <div className="mb-2 max-w-[85%]">
                      <ToolCallSteps
                        tools={filteredPending}
                        defaultOpen
                        onSelectTool={onSelectTool}
                        onResolveApproval={resolveExecApproval}
                      />
                    </div>
                  )}
                  {msg.role === "assistant" && orphanAssistantSubagents.length > 0 && (
                    <div className="mb-2">
                      <SubagentCard
                        subagents={orphanAssistantSubagents}
                        onOpen={openSubagent}
                      />
                    </div>
                  )}
                  {(msg.role === "user" || msg.text) && (
                    <MessageBubble
                      message={msg}
                      onEdit={msg.role === "user" && msg.messageId === lastEditableUserId ? handleEdit : undefined}
                      onSwitchBranch={switchBranch}
                      onReply={replyToMessage}
                      onPin={togglePin}
                      onDelete={deleteMessage}
                      onReact={msg.role === "assistant" ? reactToMessage : undefined}
                      onExport={exportOneMessage}
                      onTextAnimationComplete={markTextAnimationComplete}
                      onFork={msg.role === "assistant" ? forkFromMessage : undefined}
                      onResolveApproval={resolveExecApproval}
                      onAskSelectedText={msg.role === "assistant" ? askAboutSelectedText : undefined}
                      isPinned={messageActionState.pinnedIds.includes(msg.messageId)}
                      reaction={messageActionState.reactions[msg.messageId]}
                      isGenerating={isGenerating}
                      isActivelyStreaming={isActivelyStreaming}
                      popoverOpen={activePopoverId === msg.messageId}
                      onPopoverOpenChange={(open) => setActivePopoverId(open ? msg.messageId : null)}
                    />
                  )}
                  {msg.role === "user" && userSubagents.length > 0 && (
                    <div className="mt-3">
                      <SubagentCard
                        subagents={userSubagents}
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
                        onResolveApproval={resolveExecApproval}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <AnimatePresence initial={false}>
            {editPreview && (
              <EditPreviewPanel
                key={editPreview.branchSessionKey}
                preview={editPreview}
                onSelect={selectEditBranch}
              />
            )}
          </AnimatePresence>

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

          <div ref={bottomRef} className="h-8" />
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
          replyTo={replyTo}
          onCancelReply={cancelReply}
          onModelSelect={handleSessionModelSelect}
          modelSwitching={modelSwitching}
        />
      </div>
    </div>
  )
}
