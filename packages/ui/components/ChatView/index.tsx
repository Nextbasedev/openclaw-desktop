"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useChatMessages } from "@/hooks/useChatMessages"
import { useChatCompletionNotify } from "@/hooks/useChatCompletionNotify"
import { MessageBubble, TypingDots } from "./MessageBubble"
import { ToolCallSteps } from "./ToolCallSteps"
import { ThinkingBlock } from "./ThinkingBlock"
import { SubagentCard } from "./SubagentCard"
import { SubagentBar } from "./SubagentBar"
import { SubagentFullChat } from "./SubagentFullChat"
import { PinnedMessagesPopover } from "./PinnedMessagesPopover"
import { MessageFeedbackDialog } from "./MessageFeedbackDialog"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { ChatLoadingSkeleton } from "@/components/Skeleton/ChatLoadingSkeleton"
import { ChatBox } from "@/components/ChatBox"
import { type ChatComposerSubmit } from "@/lib/chatAttachments"
import { isSubagentSessionKey } from "@/lib/subagentSession"
import {
  exportMessagesMarkdown,
  initialMessageActionState,
  messageActionReducer,
  pinnedMessages,
  visibleMessages,
} from "@/lib/messageActions"
import { invoke } from "@/lib/ipc"
import { resolveExecApprovalV2 } from "@/lib/chat-engine-v2/client"
import { emit } from "@/lib/events"
import { frontendLog } from "@/lib/clientLogs"
import { windowChatMessages } from "@/lib/messageWindow"
import { toast } from "react-toastify"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { motion, AnimatePresence } from "framer-motion"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import {
  groupAssistantToolCallsByMessage,
  mergeToolCallsForDisplay,
} from "@/lib/chatToolDisplay"
import type {
  ChatMessage,
  EditPreviewState,
  InlineToolCall,
  ReplyTo,
  SpawnedSubagent,
} from "./types"

type Props = {
  sessionKey: string
  sessionTitle?: string
  onFirstMessageSent?: (text: string) => void
  initialMessages?: import("./types").ChatMessage[]
  onSelectTool?: (toolCallId: string) => void
  initialPrompt?: string
  activeSubagentKey?: string | null
  onSubagentOpen?: (key: string | null) => void
  forkContext?:
    | {
        type: "topic"
        projectId: string
        projectName: string
        topicId: string
        topicName: string
      }
    | { type: "chat" }
  onForkNavigate?: (chat: {
    id?: string | null
    name: string
    sessionKey: string
    projectId?: string | null
    topicId?: string | null
  }) => void
  /** When true the view is mounted in a hidden div (background session). */
  isBackgroundSession?: boolean
}

function summarizeToolInput(tool: InlineToolCall) {
  const input = tool.input
  if (!input || typeof input !== "object") {
    return typeof input === "string" ? input.slice(0, 90) : ""
  }
  const data = input as Record<string, unknown>
  const candidate =
    data.command ??
    data.cmd ??
    data.path ??
    data.file ??
    data.query ??
    data.pattern ??
    data.prompt ??
    data.text
  return typeof candidate === "string" ? candidate.slice(0, 90) : ""
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
        <p className="line-clamp-5 whitespace-pre-wrap">{user.text}</p>
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
  const loadingEdited =
    preview.status === "streaming" && !preview.edited.assistant?.text
  const isRegenerate =
    preview.original.user.text.trim() === preview.edited.user.text.trim()
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="mt-6 rounded-3xl border border-primary/20 bg-primary/[0.03] p-4 shadow-lg shadow-black/10"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Choose the response to keep
          </h2>
          <p className="text-xs text-muted-foreground">
            {isRegenerate
              ? "Compare the current answer with the regenerated one."
              : "Future context continues only from the version you select."}
          </p>
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
    messages,
    status,
    statusLabel,
    loading,
    historyLoadVersion,
    loadError,
    errorMessage,
    isSending,
    isGenerating,
    bottomRef,
    scrollContainerRef,
    onScroll,
    handleSend,
    handleAbort,
    handleEdit,
    editPreview,
    selectEditBranch,
    switchBranch,
    markTextAnimationComplete,
    pendingTools,
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
  const lastRunErrorToastRef = useRef<string | null>(null)

  useEffect(() => {
    const setup = async () => {
      const tauri = (window as unknown as Record<string, unknown>)
        .__TAURI_INTERNALS__
      if (!tauri) return
      try {
        const { listen } = await import("@tauri-apps/api/event")
        const { getCurrentWindow } = await import("@tauri-apps/api/window")

        // Clean up any previous dangling listeners (React Strict Mode)
        toastUnlistenRef.current.reply?.()
        toastUnlistenRef.current.open?.()

        toastUnlistenRef.current.reply = await listen<{
          sessionKey: string
          text: string
        }>("toast-reply", (event) => {
          if (event.payload.sessionKey === sessionKey) {
            void handleSendRef
              .current({ text: event.payload.text })
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

        toastUnlistenRef.current.open = await listen<{ sessionKey: string }>(
          "toast-open",
          (event) => {
            if (event.payload.sessionKey === sessionKey) {
              const win = getCurrentWindow()
              void win
                .unminimize()
                .then(() => win.setFocus())
                .catch(() => {})
            }
          }
        )
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

  useEffect(() => {
    if (status !== "error") {
      lastRunErrorToastRef.current = null
      return
    }

    const message = errorMessage || "Something went wrong. Try again."
    const toastKey = `${sessionKey}:${message}`
    if (lastRunErrorToastRef.current === toastKey) return
    lastRunErrorToastRef.current = toastKey
    toast.error(message)
  }, [errorMessage, sessionKey, status])

  const [internalSubagentKey, setInternalSubagentKey] = useState<string | null>(
    null
  )
  const [activeSubagent, setActiveSubagent] = useState<SpawnedSubagent | null>(
    null
  )
  const [messageActionState, dispatchMessageAction] = useState(
    initialMessageActionState
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
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [messageWindowSize, setMessageWindowSize] = useState(240)

  const [dbPins, setDbPins] = useState<{
    pins: Array<{ messageId: string; messageText: string }>
    loaded: boolean
  }>({ pins: [], loaded: false })

  useEffect(() => {
    // Reset everything when the session changes
    dispatchMessageAction(initialMessageActionState)
    setDbPins({ pins: [], loaded: false })
    setMessageWindowSize(240)

    invoke<{ pins: Array<{ messageId: string; messageText: string }> }>(
      "middleware_pins_list",
      {
        sessionKey,
      }
    )
      .then((res) => {
        const pins = Array.isArray(res?.pins) ? res.pins : []
        setDbPins({ pins, loaded: true })
        // Apply fetched pins immediately. If IDs match exactly, they'll show up.
        // If IDs mismatch, the reconciliation effect will fix them.
        dispatchMessageAction((prev) => ({
          ...prev,
          pinnedIds: pins.map((p: { messageId: string }) => p.messageId),
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
    const setsMatch =
      resolved.length === currentPinnedSet.size &&
      resolved.every((id) => currentPinnedSet.has(id))

    if (!setsMatch) {
      dispatchMessageAction((prev) => ({
        ...prev,
        pinnedIds: resolved,
      }))
    }
  }, [messages, dbPins.pins, dbPins.loaded, messageActionState.pinnedIds])
  const activeSubKey =
    externalSubagentKey ??
    internalSubagentKey ??
    activeSubagent?.sessionKey ??
    null

  // Only suppress notifications when the main chat for THIS session is visible.
  // If a subagent is open, the user is on another page, or this is a
  // background (hidden) session, notify normally.
  const isMainChatVisible =
    !isBackgroundSession && !(activeSubKey && activeSubagent)

  useChatCompletionNotify({
    sessionKey,
    sessionTitle,
    status,
    lastAssistantText,
    isVisible: isMainChatVisible,
  })

  useEffect(() => {
    frontendLog("chat", "chat-view.mount", {
      sessionKey,
      sessionTitle,
      isBackgroundSession,
    })
    return () =>
      frontendLog("chat", "chat-view.unmount", {
        sessionKey,
        isBackgroundSession,
      })
  }, [isBackgroundSession, sessionKey, sessionTitle])

  useEffect(() => {
    frontendLog(
      "status",
      "chat-view.render-state",
      {
        sessionKey,
        status,
        statusLabel,
        loading,
        loadError: Boolean(loadError),
        isSending,
        isGenerating,
        messageCount: messages.length,
        pendingToolCount: pendingTools.length,
        spawnedSubagentCount: spawnedSubagents.length,
      },
      "debug"
    )
  }, [
    isGenerating,
    isSending,
    loadError,
    loading,
    messages.length,
    pendingTools.length,
    sessionKey,
    spawnedSubagents.length,
    status,
    statusLabel,
  ])

  useEffect(() => {
    setComposerSeed(initialPrompt ?? "")
  }, [initialPrompt])

  const openSubagent = useCallback(
    (sub: SpawnedSubagent) => {
      if (!sub.sessionKey || sub.sessionKey === sessionKey) return
      frontendLog("session", "subagent.open", {
        parentSessionKey: sessionKey,
        childSessionKey: sub.sessionKey,
        status: sub.status,
        toolCallId: sub.toolCallId,
      })
      setActiveSubagent({ ...sub, sessionKey: sub.sessionKey })
      setInternalSubagentKey(sub.sessionKey)
      onSubagentOpen?.(sub.sessionKey)
    },
    [onSubagentOpen, sessionKey]
  )

  const closeSubagent = useCallback(() => {
    frontendLog("session", "subagent.close", {
      parentSessionKey: sessionKey,
      childSessionKey: activeSubKey,
    })
    setActiveSubagent(null)
    setInternalSubagentKey(null)
    onSubagentOpen?.(null)
  }, [activeSubKey, onSubagentOpen, sessionKey])

  const activeSubagentFallbackText = useMemo(() => {
    if (!activeSubagent || !isSubagentSessionKey(activeSubagent.sessionKey)) {
      return ""
    }
    const assistantMessages = messages.filter(
      (message) => message.role === "assistant" && message.text.trim()
    )
    const resultMessage =
      [...assistantMessages]
        .reverse()
        .find(
          (message) =>
            /\bI spawned a subagent\b/i.test(message.text) ||
            /\bDone\./i.test(message.text)
        ) ?? assistantMessages.at(-1)
    return cleanSubagentReply(resultMessage?.text ?? "")
  }, [activeSubagent, messages])

  const activeSubagentFallbackPrompt =
    activeSubagent?.task?.trim() || "Run the delegated sub-agent task."

  const firstFiredRef = useRef(false)

  const resolveExecApproval = useCallback(
    async (
      approvalId: string,
      decision: "allow-once" | "allow-always" | "deny"
    ) => {
      try {
        await resolveExecApprovalV2({ approvalId, decision })
      } catch {
        await invoke("middleware_exec_approval_resolve", {
          input: { approvalId, decision },
        })
      }
      emit("chat:activity", { sessionKey })
    },
    [sessionKey]
  )

  const handleSessionModelSelect = useCallback(
    async (modelId: string) => {
      const toastId = toast.loading(`Switching model to ${modelId}…`)
      setModelSwitching(true)
      try {
        await invoke("middleware_chat_model_set", {
          input: { sessionKey, modelId },
        })
        emit("chat:activity", { sessionKey })
        toast.update(toastId, {
          render: `Switched model to ${modelId}`,
          type: "success",
          isLoading: false,
          autoClose: 1800,
        })
      } catch (error) {
        toast.update(toastId, {
          render:
            error instanceof Error ? error.message : "Failed to switch model",
          type: "error",
          isLoading: false,
          autoClose: 3500,
        })
        throw error
      } finally {
        setModelSwitching(false)
      }
    },
    [sessionKey]
  )

  const wrappedSend = useCallback(
    async (payload: ChatComposerSubmit) => {
      frontendLog("composer", "chat-view.send.request", {
        sessionKey,
        hasText: Boolean(payload.text.trim()),
        textLength: payload.text.trim().length,
        attachmentCount: payload.attachments?.length ?? 0,
        isModelSwitching: modelSwitching,
      })
      if (modelSwitching) {
        toast.info("Switching model… please wait before sending.")
        return
      }
      const shouldNotifyFirstSend =
        !firstFiredRef.current &&
        messages.length === 0 &&
        Boolean(onFirstMessageSent)
      emit("chat:activity", { sessionKey })
      const sent = await handleSend(payload)
      if (sent === false) return
      if (shouldNotifyFirstSend && onFirstMessageSent) {
        firstFiredRef.current = true
        onFirstMessageSent(payload.text)
      }
      dispatchMessageAction((prev) =>
        messageActionReducer(prev, { type: "clear_reply" })
      )
      setReplyTo(null)
      setComposerSeed("")
    },
    [handleSend, messages.length, modelSwitching, onFirstMessageSent, sessionKey]
  )

  const retrySend = useCallback(
    (messageId: string) => {
      const message = messages.find((m) => m.messageId === messageId)
      if (!message?.retryPayload) return
      void handleSend(message.retryPayload, messageId)
    },
    [handleSend, messages]
  )

  const visibleAllMessages = useMemo(
    () => visibleMessages(messages, messageActionState),
    [messages, messageActionState]
  )
  const messageWindow = useMemo(
    () =>
      windowChatMessages(
        visibleAllMessages,
        messageActionState.pinnedIds,
        messageWindowSize
      ),
    [visibleAllMessages, messageActionState.pinnedIds, messageWindowSize]
  )
  const renderedMessages = messageWindow.messages
  const lastHistoryScrollVersionRef = useRef(0)

  useEffect(() => {
    if (isBackgroundSession) return
    if (historyLoadVersion <= lastHistoryScrollVersionRef.current) return
    if (renderedMessages.length === 0) return

    lastHistoryScrollVersionRef.current = historyLoadVersion
    const lastIndex = renderedMessages.length - 1
    const scrollToLatest = () => {
      virtuosoRef.current?.scrollToIndex({
        index: lastIndex,
        align: "end",
        behavior: "auto",
      })
      const el = scrollContainerRef.current
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
      }
    }

    let secondFrame: number | null = null
    const frame = requestAnimationFrame(() => {
      scrollToLatest()
      secondFrame = requestAnimationFrame(scrollToLatest)
    })
    const settleTimer = window.setTimeout(scrollToLatest, 150)
    return () => {
      cancelAnimationFrame(frame)
      if (secondFrame !== null) cancelAnimationFrame(secondFrame)
      window.clearTimeout(settleTimer)
    }
  }, [
    historyLoadVersion,
    isBackgroundSession,
    renderedMessages.length,
    scrollContainerRef,
  ])

  const latestRenderedUserIndex = useMemo(() => {
    for (let i = renderedMessages.length - 1; i >= 0; i--) {
      if (renderedMessages[i].role === "user") return i
    }
    return -1
  }, [renderedMessages])
  const userMessageHistory = useMemo(
    () =>
      messages
        .filter((message) => message.role === "user")
        .map((message) => message.text.trim())
        .filter((text) => text.length > 0),
    [messages]
  )
  const pinned = useMemo(
    () => pinnedMessages(messages, messageActionState),
    [messages, messageActionState]
  )

  const replyToMessage = useCallback(
    (messageId: string) => {
      const target = messages.find((message) => message.messageId === messageId)
      if (!target) return
      dispatchMessageAction((prev) =>
        messageActionReducer(prev, { type: "reply", messageId })
      )
      setReplyTo({
        messageId: target.messageId,
        role: target.role,
        text: target.text,
      })
    },
    [messages]
  )

  const askAboutSelectedText = useCallback(
    (messageId: string, text: string, comment?: string) => {
      const selected = text.trim()
      if (!selected) return
      setReplyTo({
        messageId: `${messageId}:selection`,
        role: "assistant",
        text: selected,
      })
      setComposerSeed(comment?.trim() ?? "")
    },
    []
  )

  const cancelReply = useCallback(() => {
    setReplyTo(null)
    dispatchMessageAction((prev) =>
      messageActionReducer(prev, { type: "clear_reply" })
    )
  }, [])

  const togglePin = useCallback(
    (messageId: string) => {
      const isPinned = messageActionState.pinnedIds.includes(messageId)
      dispatchMessageAction((prev) =>
        messageActionReducer(prev, {
          type: isPinned ? "unpin" : "pin",
          messageId,
        })
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
        }).catch(() => {})
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
        }).catch(() => {})
      }
    },
    [sessionKey, messages, messageActionState.pinnedIds]
  )

  const deleteMessage = useCallback((messageId: string) => {
    dispatchMessageAction((prev) =>
      messageActionReducer(prev, { type: "delete", messageId })
    )
  }, [])

  const reactToMessage = useCallback(
    (messageId: string, reaction: "up" | "down") => {
      const current = messageActionState.reactions[messageId]
      const isRemoving = current === reaction

      dispatchMessageAction((prev) =>
        messageActionReducer(prev, { type: "react", messageId, reaction })
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
        }).catch(() => {})
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
        .catch(() => {})

      if (reaction === "down") {
        setFeedbackTargetId(messageId)
        setFeedbackDialogOpen(true)
      }
    },
    [sessionKey, messageActionState.reactions]
  )

  const loadOlderMessages = useCallback(() => {
    setMessageWindowSize((current) =>
      Math.min(current + 240, visibleAllMessages.length)
    )
  }, [visibleAllMessages.length])

  const handleScroll = useCallback(() => {
    onScroll()
    if (activePopoverId) setActivePopoverId(null)
  }, [onScroll, activePopoverId])

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
        .catch(() => {})
    },
    [sessionKey, feedbackTargetId]
  )

  const forkFromMessage = useCallback(
    async (messageId: string) => {
      const msg = messages.find((m) => m.messageId === messageId)
      if (!msg || msg.gatewayIndex === undefined) return
      const requestId = `fork-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const optimisticName =
        forkContext?.type === "topic"
          ? `Fork: ${forkContext.topicName}`
          : "Forked chat"
      emit("fork:create", {
        status: "pending",
        requestId,
        name: optimisticName,
        context: forkContext ?? { type: "chat" },
      })
      const toastId = toast.loading(
        forkContext?.type === "topic"
          ? "Creating fork topic…"
          : "Creating fork chat…"
      )
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
          render:
            forkContext?.type === "topic"
              ? "Fork topic created"
              : "Fork chat created",
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
        emit("fork:create", {
          status: "failed",
          requestId,
          context: forkContext ?? { type: "chat" },
        })
        toast.update(toastId, {
          render: "Fork failed",
          type: "error",
          isLoading: false,
          autoClose: 4000,
        })
        console.error("Fork failed", err)
      }
    },
    [sessionKey, messages, forkContext, onForkNavigate]
  )

  const exportOneMessage = useCallback(
    (messageId: string) => {
      const target = messages.find((message) => message.messageId === messageId)
      if (!target) return
      void navigator.clipboard.writeText(exportMessagesMarkdown([target]))
    },
    [messages]
  )

  const lastEditableUserId = useMemo(() => {
    for (let i = renderedMessages.length - 1; i >= 0; i--) {
      if (renderedMessages[i].role === "user")
        return renderedMessages[i].messageId
      if (renderedMessages[i].role === "assistant") continue
    }
    return null
  }, [renderedMessages])

  const assistantMessages = messages.filter((m) => m.role === "assistant")
  const lastTwoAssistantIds = new Set(
    assistantMessages.slice(-2).map((m) => m.messageId)
  )
  const toolCallsWithoutSpawn = (tools: import("./types").InlineToolCall[]) =>
    tools.filter(
      (t) =>
        t.tool !== "sessions_spawn" &&
        t.tool !== "subagents" &&
        t.tool !== "sessions_yield"
    )

  const { grouped: groupedToolCalls, suppressed: suppressedToolCallMessages } =
    useMemo(
      () => groupAssistantToolCallsByMessage(renderedMessages),
      [renderedMessages]
    )

  const spawnsByToolCallId = new Map<string, SpawnedSubagent>()
  for (const sub of spawnedSubagents) {
    spawnsByToolCallId.set(sub.toolCallId, sub)
  }

  function getSubagentsForMessage(
    toolCalls?: import("./types").InlineToolCall[]
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
      subagentsByTriggerUserId.set(nearestUserId, [
        ...existing,
        ...msgSubagents,
      ])
    } else {
      orphanSubagentsByAssistantId.set(msg.messageId, msgSubagents)
    }
  }

  const scrollToRenderedMessage = useCallback(
    (messageId: string) => {
      const index = renderedMessages.findIndex(
        (msg) => msg.messageId === messageId
      )
      if (index < 0) return false
      virtuosoRef.current?.scrollToIndex({
        index,
        align: "center",
        behavior: "smooth",
      })
      return true
    },
    [renderedMessages]
  )

  const renderMessageRow = useCallback(
    (index: number, msg: ChatMessage) => {
      const isLast = index === renderedMessages.length - 1
      const showPending =
        isLast && isGenerating && pendingTools.length > 0 && msg.role === "user"
      const isActivelyStreaming =
        isLast && isGenerating && msg.role === "assistant"
      let hasLaterAssistantInSameTurn = false
      if (msg.role === "assistant") {
        for (const next of renderedMessages.slice(index + 1)) {
          if (next.role === "user") break
          if (next.role === "assistant" && next.text.trim()) {
            hasLaterAssistantInSameTurn = true
            break
          }
        }
      }
      const isActiveTurnAssistant =
        msg.role === "assistant" && index > latestRenderedUserIndex
      const suppressAssistantActions =
        msg.role === "assistant" &&
        (hasLaterAssistantInSameTurn || (isGenerating && isActiveTurnAssistant))
      const filteredPending = toolCallsWithoutSpawn(pendingTools)
      const messageToolCalls =
        msg.role === "assistant" && suppressedToolCallMessages.has(msg.messageId)
          ? []
          : groupedToolCalls.get(msg.messageId) ?? msg.toolCalls ?? []
      const filteredToolCalls =
        msg.role === "assistant"
          ? mergeToolCallsForDisplay(
              toolCallsWithoutSpawn(messageToolCalls),
              isActivelyStreaming ? filteredPending : []
            )
          : toolCallsWithoutSpawn(messageToolCalls)
      const anchoredUserSubagents =
        msg.role === "user"
          ? (subagentsByTriggerUserId.get(msg.messageId) ?? [])
          : []
      const orphanAssistantSubagents =
        msg.role === "assistant"
          ? (orphanSubagentsByAssistantId.get(msg.messageId) ?? [])
          : []
      const liveSubagents =
        msg.role === "user" && isLast && isGenerating
          ? getSubagentsForMessage(pendingTools)
          : []
      const userSubagents =
        anchoredUserSubagents.length > 0 ? anchoredUserSubagents : liveSubagents

      return (
        <div
          id={`message-${msg.messageId}`}
          className="mx-auto max-w-3xl px-4 py-2.5"
        >
          {msg.role === "assistant" && orphanAssistantSubagents.length > 0 && (
            <div className="mb-2">
              <SubagentCard
                subagents={orphanAssistantSubagents}
                onOpen={openSubagent}
              />
            </div>
          )}
          {msg.role === "assistant" && msg.reasoningText && (
            <ThinkingBlock
              text={msg.reasoningText}
              defaultOpen={lastTwoAssistantIds.has(msg.messageId)}
            />
          )}
          {(() => {
            const assistantHasText = msg.role === "assistant" && msg.text.trim().length > 0
            const toolSteps = msg.role === "assistant" && filteredToolCalls && filteredToolCalls.length > 0
              ? (
                  <div className={assistantHasText ? "mt-2 max-w-[85%]" : "mb-2 max-w-[85%]"}>
                    <ToolCallSteps
                      tools={filteredToolCalls}
                      defaultOpen={lastTwoAssistantIds.has(msg.messageId) && !assistantHasText}
                      onSelectTool={onSelectTool}
                      onResolveApproval={resolveExecApproval}
                    />
                  </div>
                )
              : null
            const bubble = (msg.role === "user" || msg.text) ? (
              <MessageBubble
                message={msg}
                onEdit={
                  msg.role === "user" && msg.messageId === lastEditableUserId
                    ? handleEdit
                    : undefined
                }
                onRetrySend={retrySend}
                onSwitchBranch={switchBranch}
                onReply={replyToMessage}
                onPin={togglePin}
                onDelete={deleteMessage}
                onReact={msg.role === "assistant" ? reactToMessage : undefined}
                onExport={exportOneMessage}
                onTextAnimationComplete={markTextAnimationComplete}
                onFork={msg.role === "assistant" ? forkFromMessage : undefined}
                onResolveApproval={resolveExecApproval}
                onAskSelectedText={
                  msg.role === "assistant" ? askAboutSelectedText : undefined
                }
                isPinned={messageActionState.pinnedIds.includes(msg.messageId)}
                reaction={messageActionState.reactions[msg.messageId]}
                isGenerating={isGenerating}
                isActivelyStreaming={isActivelyStreaming}
                suppressActions={suppressAssistantActions}
                popoverOpen={activePopoverId === msg.messageId}
                onPopoverOpenChange={(open) =>
                  setActivePopoverId(open ? msg.messageId : null)
                }
              />
            ) : null
            return assistantHasText ? <>{bubble}{toolSteps}</> : <>{toolSteps}{bubble}</>
          })()}
          {msg.role === "user" && userSubagents.length > 0 && (
            <div className="mt-3">
              <SubagentCard subagents={userSubagents} onOpen={openSubagent} />
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
    },
    [
      activePopoverId,
      askAboutSelectedText,
      deleteMessage,
      exportOneMessage,
      forkFromMessage,
      getSubagentsForMessage,
      handleEdit,
      isGenerating,
      lastEditableUserId,
      lastTwoAssistantIds,
      latestRenderedUserIndex,
      markTextAnimationComplete,
      messageActionState.pinnedIds,
      messageActionState.reactions,
      onSelectTool,
      openSubagent,
      orphanSubagentsByAssistantId,
      pendingTools,
      reactToMessage,
      groupedToolCalls,
      suppressedToolCallMessages,
      renderedMessages.length,
      replyToMessage,
      resolveExecApproval,
      retrySend,
      setActivePopoverId,
      subagentsByTriggerUserId,
      switchBranch,
      togglePin,
    ]
  )

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

  const liveTool = isGenerating
    ? pendingTools.find(
        (tool) =>
          tool.status === "running" &&
          tool.tool !== "sessions_spawn" &&
          tool.tool !== "subagents" &&
          tool.tool !== "sessions_yield"
      )
    : undefined
  const liveToolInput = liveTool ? summarizeToolInput(liveTool) : ""
  const liveToolText = liveTool
    ? `Running ${liveTool.tool}${liveToolInput ? `: ${liveToolInput}` : ""}...`
    : null

  const statusText =
    liveToolText ??
    (status === "thinking"
      ? "Thinking - waiting for the next event..."
      : status === "queued"
        ? statusLabel
          ? `Queued - ${statusLabel}...`
          : "Queued..."
        : status === "running"
          ? statusLabel
            ? `Running - ${statusLabel}...`
            : "Running..."
          : status === "collect"
            ? statusLabel
              ? `Collecting - ${statusLabel}...`
              : "Collecting..."
            : status === "tool_running"
              ? `Running${statusLabel ? ` - ${statusLabel}` : " tool"}...`
              : status === "streaming"
                ? "Responding..."
                : status === "stopping"
                  ? "Stopping..."
                  : status === "restarting"
                    ? "Restarting..."
                    : isGenerating
                      ? statusLabel
                        ? `${statusLabel}...`
                        : "Thinking - waiting for the next event..."
                      : null)

  if (loading && messages.length === 0) {
    return <ChatLoadingSkeleton />
  }

  if (loadError) {
    return (
      <div className="flex h-full w-full items-center justify-center px-8">
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-5 py-4 text-center">
          <p className="text-sm font-medium text-red-400">
            Failed to load session
          </p>
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
          historyMessages={userMessageHistory}
          onAbort={handleAbort}
          initialPrompt={composerSeed}
          replyTo={replyTo}
          onCancelReply={cancelReply}
          onModelSelect={handleSessionModelSelect}
          modelSwitching={modelSwitching}
          glowOnMount
        />
        {statusText && (
          <div className="flex items-center pl-1">
            <span className="thinking-shimmer text-[14px] font-medium tracking-[-0.01em]">
              {statusText.replace(/\.{3}$/, "")}
              <span className="thinking-ellipsis" aria-hidden="true" />
            </span>
          </div>
        )}
      </div>
    )
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
              "group relative flex size-8 cursor-pointer items-center justify-center rounded-sm transition-all",
              pinnedPopoverOpen
                ? "text-foreground shadow-inner"
                : pinned.length > 0
                  ? "animate-pulse text-foreground"
                  : "text-muted-foreground/60 hover:text-foreground"
            )}
          >
            <Icons.Pin
              size={16}
              className={cn(
                "transition-transform",
                pinnedPopoverOpen && "scale-110"
              )}
            />
          </button>

          <PinnedMessagesPopover
            open={pinnedPopoverOpen}
            onClose={() => setPinnedPopoverOpen(false)}
            pinned={pinned}
            onTogglePin={togglePin}
            triggerRef={pinButtonRef}
            onNavigateToMessage={(id) => {
              void scrollToRenderedMessage(id)
            }}
          />
        </div>
      </div>

      <MessageFeedbackDialog
        open={feedbackDialogOpen}
        onClose={() => setFeedbackDialogOpen(false)}
        onSubmit={handleFeedbackSubmit}
      />

      <Virtuoso
        ref={virtuosoRef}
        data={renderedMessages}
        className="flex-1"
        scrollerRef={(ref) => {
          scrollContainerRef.current =
            ref instanceof HTMLDivElement ? ref : null
        }}
        onScroll={handleScroll}
        initialTopMostItemIndex={{ index: "LAST", align: "end" }}
        alignToBottom
        followOutput={(isAtBottom) => {
          if (isSending) return "smooth"
          if (isGenerating) return isAtBottom ? "auto" : false
          return isAtBottom ? "smooth" : false
        }}
        computeItemKey={(_, msg) => msg.messageId}
        increaseViewportBy={{ top: 900, bottom: 1200 }}
        components={{
          Header: () => (
            <div className="mx-auto max-w-3xl px-4 pt-8">
              {messageWindow.hiddenBefore > 0 && (
                <div className="mx-auto mb-2 flex w-fit items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                  <span>
                    Showing latest {renderedMessages.length} of{" "}
                    {messageWindow.total} messages
                  </span>
                  <button
                    type="button"
                    onClick={loadOlderMessages}
                    className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Load older messages
                  </button>
                </div>
              )}
            </div>
          ),
          Footer: () => (
            <div className="mx-auto max-w-3xl px-4 pb-8">
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
                <div className="mt-4 flex items-center pl-1">
                  <span className="thinking-shimmer text-[14px] font-medium tracking-[-0.01em]">
                    {statusText.replace(/\.{3}$/, "")}
                    <span className="thinking-ellipsis" aria-hidden="true" />
                  </span>
                </div>
              )}

              <div ref={bottomRef} className="h-8" />
            </div>
          ),
        }}
        itemContent={renderMessageRow}
      />

      <div className="shrink-0 bg-background/60 py-3 backdrop-blur-sm">
        {spawnedSubagents.length > 0 && (
          <div className="mb-2">
            <SubagentBar subagents={spawnedSubagents} onOpen={openSubagent} />
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
          historyMessages={userMessageHistory}
        />
      </div>
    </div>
  )
}
