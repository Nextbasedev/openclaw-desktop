"use client"

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { useChatMessages } from "@/hooks/useChatMessages"
import { useChatCompletionNotify } from "@/hooks/useChatCompletionNotify"
import { MessageBubble, TypingDots } from "./MessageBubble"
import { ToolCallSteps } from "./ToolCallSteps"
import { ChatSearch } from "./ChatSearch"
import { OpenClawVercelChat } from "./vercel-ui/OpenClawVercelChat"
import { buildStableChatRows, type StableChatMessage } from "./chatStableIds"
import { shouldAutoLoadOlderHistory } from "./chatHistoryAutoLoad"
import { isNearChatBottom, scrollChatToBottom, shouldStickToChatBottomAfterScroll } from "./chatAutoScroll"
import { logChatScrollDebug } from "./chatScrollDebug"

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
import { isActiveSubagent } from "@/lib/subagentLifecycle"
import {
  exportMessagesMarkdown,
  initialMessageActionState,
  messageActionReducer,
  pinnedMessages,
  visibleMessages,
} from "@/lib/messageActions"
import { invoke } from "@/lib/ipc"
import { dedupeRequest } from "@/lib/requestDedupe"
import { resolveExecApprovalV2 } from "@/lib/chat-engine-v2/client"
import { emit } from "@/lib/events"
import { frontendLog } from "@/lib/clientLogs"
import { currentChatWindowId, logChatViewInvariant } from "@/lib/chatTimelineDiagnostics"
import { toast } from "react-toastify"
import { MdKeyboardDoubleArrowDown } from "react-icons/md"
import {
  LuBrain,
  LuClock,
  LuFileCode,
  LuFileText,
  LuGlobe,
  LuImage,
  LuMessageSquare,
  LuPencil,
  LuRefreshCw,
  LuSettings2,
  LuSparkles,
  LuWrench,
} from "react-icons/lu"
import type { IconType } from "react-icons"
import { motion, AnimatePresence } from "framer-motion"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import {
  applyTerminalToolState,
  groupAssistantToolCallsByMessage,
  mergeActiveTurnToolCalls,
  terminalToolStateById,
} from "@/lib/chatToolDisplay"
import type {
  ChatMessage,
  EditPreviewState,
  InlineToolCall,
  ReplyTo,
  SpawnedSubagent,
} from "./types"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const JUMP_TO_BOTTOM_THRESHOLD_PX = 160
const OLDER_HISTORY_LOAD_SETTLE_COOLDOWN_MS = 1600

type MessageScrollAnchor = {
  id: string
  uiId: string
  top: number
  previousScrollHeight: number
  previousScrollTop: number
}

function captureMessageScrollAnchor(container: HTMLElement | null): MessageScrollAnchor | null {
  if (!container) return null
  const containerRect = container.getBoundingClientRect()
  const containerTop = containerRect.top
  const anchorY = containerTop + Math.min(180, Math.max(80, containerRect.height * 0.25))
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-chat-message-row='true']"))
  const visibleRow =
    rows.find((row) => {
      const rect = row.getBoundingClientRect()
      return rect.top <= anchorY && rect.bottom >= anchorY
    }) ?? rows.find((row) => row.getBoundingClientRect().bottom > containerTop + 1)
  if (!visibleRow) {
    return {
      id: "",
      uiId: "",
      top: containerTop,
      previousScrollHeight: container.scrollHeight,
      previousScrollTop: container.scrollTop,
    }
  }
  return {
    id: visibleRow.id,
    uiId: visibleRow.dataset.uiId ?? "",
    top: visibleRow.getBoundingClientRect().top,
    previousScrollHeight: container.scrollHeight,
    previousScrollTop: container.scrollTop,
  }
}

function restoreMessageScrollAnchor(container: HTMLElement | null, anchor: MessageScrollAnchor | null) {
  if (!container || !anchor) return
  if (anchor.uiId) {
    const row = Array.from(container.querySelectorAll<HTMLElement>("[data-chat-message-row='true']"))
      .find((item) => item.dataset.uiId === anchor.uiId)
    if (row) {
      const deltaPx = row.getBoundingClientRect().top - anchor.top
      container.scrollTop += deltaPx
      logChatScrollDebug({
        source: "chat",
        event: "restore-anchor-row",
        anchorId: anchor.uiId,
        anchorTop: anchor.top,
        deltaPx,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
      })
      return
    }
  }
  if (anchor.id) {
    const row = document.getElementById(anchor.id)
    if (row) {
      const deltaPx = row.getBoundingClientRect().top - anchor.top
      container.scrollTop += deltaPx
      logChatScrollDebug({ source: "chat", event: "restore-anchor-dom-id", anchorId: anchor.id, anchorTop: anchor.top, deltaPx, scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight })
      return
    }
  }
  const delta = container.scrollHeight - anchor.previousScrollHeight
  container.scrollTop = anchor.previousScrollTop + Math.max(0, delta)
  logChatScrollDebug({ source: "chat", event: "restore-anchor-height-delta", anchorId: anchor.uiId || anchor.id, deltaPx: delta, scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight })
}

function settleMessageScrollAnchor(container: HTMLElement | null, anchor: MessageScrollAnchor | null, done: () => void) {
  let finished = false
  let frame: number | null = null

  const restore = () => {
    if (finished) return
    restoreMessageScrollAnchor(container, anchor)
  }
  const finish = () => {
    if (finished) return
    finished = true
    if (frame !== null) cancelAnimationFrame(frame)
    done()
  }

  restore()
  frame = requestAnimationFrame(() => {
    frame = null
    restore()
    finish()
  })
}

function stableMessageRowSignature(message: StableChatMessage) {
  return JSON.stringify({
    uiId: message.uiId,
    messageId: message.messageId,
    role: message.role,
    text: message.text,
    reasoningText: message.reasoningText,
    toolCalls: message.toolCalls?.map((tool) => [tool.id, tool.tool, tool.status, tool.awaitingResult, tool.resultText]),
    attachments: message.attachments?.map((attachment) => [attachment.name, attachment.mimeType, attachment.size, attachment.url]),
    embeds: message.embeds?.map((embed) => [embed.title, embed.content]),
    isOptimistic: message.isOptimistic,
    sendStatus: message.sendStatus,
    gatewayIndex: message.gatewayIndex,
    createdAt: message.createdAt,
  })
}

type RenderedMessageRowProps = {
  msg: StableChatMessage
  index: number
  total: number
  rowSignature: string
  uiStateKey: string
  renderMessageRow: (index: number, msg: StableChatMessage) => ReactNode
}

const RenderedMessageRow = memo(function RenderedMessageRow({
  msg,
  index,
  total,
  renderMessageRow,
}: RenderedMessageRowProps) {
  if (typeof window !== "undefined") {
    try {
      if (window.localStorage.getItem("openclaw.chat.render.debug") === "1") {
        console.debug("[chat-row-render]", { uiId: msg.uiId, messageId: msg.messageId, index, total })
      }
    } catch {}
  }
  return <>{renderMessageRow(index, msg)}</>
}, (prev, next) => {
  const trace = () => {
    try { return typeof window !== "undefined" && window.localStorage.getItem("openclaw.chat.render.debug") === "1" }
    catch { return false }
  }
  const logDecision = (decision: "skip" | "render", reason: string) => {
    if (!trace()) return
    console.debug("[chat-row-memo]", {
      decision,
      reason,
      uiId: next.msg.uiId,
      messageId: next.msg.messageId,
      prevIndex: prev.index,
      nextIndex: next.index,
      prevTotal: prev.total,
      nextTotal: next.total,
    })
  }
  if (prev.msg.uiId !== next.msg.uiId) {
    logDecision("render", "ui-id-changed")
    return false
  }
  if (prev.rowSignature !== next.rowSignature) {
    logDecision("render", "row-content-changed")
    return false
  }
  if (prev.uiStateKey !== next.uiStateKey) {
    logDecision("render", "ui-state-changed")
    return false
  }

  const prependedCount = next.total - prev.total
  if (prependedCount > 0 && next.index - prev.index === prependedCount) {
    logDecision("skip", "history-prepend-index-shift")
    return true
  }

  if (prev.index === next.index && prev.total === next.total) {
    logDecision("skip", "same-position")
    return true
  }
  if (prev.index === next.index && prev.index < prev.total - 3) {
    logDecision("skip", "stable-non-tail-row")
    return true
  }
  logDecision("render", "position-or-tail-changed")
  return false
})
const ASSISTANT_UI_CHATVIEW_FLAG_STORAGE_KEY = "openclaw.chatview.assistant-ui"

function useAssistantUiChatViewEnabled() {
  const envEnabled = process.env.NEXT_PUBLIC_OPENCLAW_ASSISTANT_UI_CHATVIEW === "1"
  return useSyncExternalStore(
    () => () => {},
    () => {
      if (envEnabled) return true
      try {
        return window.localStorage.getItem(ASSISTANT_UI_CHATVIEW_FLAG_STORAGE_KEY) === "1"
      } catch {
        return false
      }
    },
    () => envEnabled
  )
}

type StatusIconMeta = {
  icon: IconType
  className: string
  label: string
}

const STATUS_ICON_CLASS = "text-amber-400"

const STATUS_TOOL_ICON_META: Record<string, StatusIconMeta> = {
  read: { icon: LuFileText, className: STATUS_ICON_CLASS, label: "Read file" },
  write: { icon: LuPencil, className: STATUS_ICON_CLASS, label: "Write file" },
  edit: { icon: LuPencil, className: STATUS_ICON_CLASS, label: "Edit file" },
  apply_patch: { icon: LuFileCode, className: STATUS_ICON_CLASS, label: "Apply patch" },
  exec: { icon: LuFileCode, className: STATUS_ICON_CLASS, label: "Run command" },
  process: { icon: LuRefreshCw, className: STATUS_ICON_CLASS, label: "Process" },
  web_fetch: { icon: LuGlobe, className: STATUS_ICON_CLASS, label: "Fetch web page" },
  web_search: { icon: LuGlobe, className: STATUS_ICON_CLASS, label: "Search web" },
  cron: { icon: LuClock, className: STATUS_ICON_CLASS, label: "Schedule job" },
  sessions_list: { icon: LuMessageSquare, className: STATUS_ICON_CLASS, label: "List sessions" },
  sessions_history: { icon: LuMessageSquare, className: STATUS_ICON_CLASS, label: "Session history" },
  sessions_send: { icon: LuMessageSquare, className: STATUS_ICON_CLASS, label: "Send to session" },
  sessions_spawn: { icon: LuSparkles, className: STATUS_ICON_CLASS, label: "Spawn sub-agent" },
  sessions_yield: { icon: LuSparkles, className: STATUS_ICON_CLASS, label: "Wait for sub-agent" },
  subagents: { icon: LuSparkles, className: STATUS_ICON_CLASS, label: "Sub-agent" },
  session_status: { icon: LuSettings2, className: STATUS_ICON_CLASS, label: "Session status" },
  image: { icon: LuImage, className: STATUS_ICON_CLASS, label: "Analyze image" },
  image_generate: { icon: LuImage, className: STATUS_ICON_CLASS, label: "Generate image" },
  memory_get: { icon: LuBrain, className: STATUS_ICON_CLASS, label: "Read memory" },
  memory_search: { icon: LuBrain, className: STATUS_ICON_CLASS, label: "Search memory" },
  update_plan: { icon: LuWrench, className: STATUS_ICON_CLASS, label: "Update plan" },
}

function statusIconMeta(tool?: string | null): StatusIconMeta {
  if (tool && STATUS_TOOL_ICON_META[tool]) return STATUS_TOOL_ICON_META[tool]
  return { icon: LuSparkles, className: STATUS_ICON_CLASS, label: "Thinking" }
}

function ProcessStatusIcon({ tool }: { tool?: string | null }) {
  const meta = statusIconMeta(tool)
  const Icon = meta.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="mr-2 flex size-4 shrink-0 items-center justify-center"
          aria-label={meta.label}
        >
          <Icon className={cn("size-3.5", meta.className)} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={8} className="text-[11px]">
        {meta.label}
      </TooltipContent>
    </Tooltip>
  )
}

type Props = {
  sessionKey: string
  sessionTitle?: string
  onFirstMessageSent?: (text: string) => void
  initialMessages?: import("./types").ChatMessage[]
  onSelectTool?: (toolCallId: string) => void
  initialPrompt?: string
  activeSubagentKey?: string | null
  onSubagentOpen?: (key: string | null, agentId?: string | null) => void
  forkContext?:
    | {
        type: "topic"
        projectId: string
        projectName: string
        topicId: string
        topicName: string
      }
    | { type: "chat" }
  activeSpaceId?: string | null
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
  activeSpaceId,
  onForkNavigate,
  isBackgroundSession = false,
}: Props) {
  const {
    messages,
    status,
    statusLabel,
    loading,
    hasOlderMessages,
    loadingOlderMessages,
    loadOlderMessages,
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
    dataSource,
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
  const viewGenerationRef = useRef(0)
  const windowIdRef = useRef<string | null>(null)
  if (windowIdRef.current === null) windowIdRef.current = currentChatWindowId()

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
  const [searchOpen, setSearchOpen] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleHighlightMessage = useCallback((messageId: string | null) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    setHighlightedMessageId(messageId)
    if (messageId) {
      highlightTimerRef.current = setTimeout(() => setHighlightedMessageId(null), 2000)
    }
  }, [])

  // Ctrl+F / Cmd+F opens in-chat search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])


  const pinButtonRef = useRef<HTMLButtonElement>(null)
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false)
  const [feedbackTargetId, setFeedbackTargetId] = useState<string | null>(null)
  const [activePopoverId, setActivePopoverId] = useState<string | null>(null)
  const [modelSwitching, setModelSwitching] = useState(false)
  const lastFeedbackTimesRef = useRef<Record<string, number>>({})
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)

  const [dbPins, setDbPins] = useState<{
    pins: Array<{ messageId: string; messageText: string }>
    loaded: boolean
  }>({ pins: [], loaded: false })

  useEffect(() => {
    let cancelled = false
    // Reset everything when the session changes
    dispatchMessageAction(initialMessageActionState)
    setDbPins({ pins: [], loaded: false })

    const connectionKey = (() => {
      if (typeof window === "undefined") return "server"
      const url = window.localStorage.getItem("openclaw.middleware.url")?.trim() ?? ""
      const token = window.localStorage.getItem("openclaw.middleware.token")?.trim() ?? ""
      return url ? `${url}|${token ? "token" : "no-token"}` : "default"
    })()

    dedupeRequest(
      `chat-pins:${connectionKey}:${sessionKey}`,
      () => invoke<{ pins: Array<{ messageId: string; messageText: string }> }>(
        "middleware_pins_list",
        { sessionKey },
      ),
      { ttlMs: 30_000 },
    )
      .then((res) => {
        if (cancelled) return
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
        if (!cancelled) setDbPins({ pins: [], loaded: true })
      })

    return () => {
      cancelled = true
    }
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
  const activeLiveSubagent = activeSubagent
    ? spawnedSubagents.find(
        (sub) =>
          sub.toolCallId === activeSubagent.toolCallId ||
          (sub.sessionKey && sub.sessionKey === activeSubagent.sessionKey)
      ) ?? activeSubagent
    : null

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
    const viewGeneration = viewGenerationRef.current + 1
    viewGenerationRef.current = viewGeneration
    frontendLog("chat", "chat-view.mount", {
      sessionKey,
      sessionTitle,
      isBackgroundSession,
      windowId: windowIdRef.current,
      viewGeneration,
    })
    return () =>
      frontendLog("chat", "chat-view.unmount", {
        sessionKey,
        isBackgroundSession,
        windowId: windowIdRef.current,
        viewGeneration,
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
        windowId: windowIdRef.current,
        viewGeneration: viewGenerationRef.current,
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
    logChatViewInvariant({
      windowId: windowIdRef.current,
      viewGeneration: viewGenerationRef.current,
      activeSessionKey: sessionKey,
      renderedSessionKey: sessionKey,
      messageListSessionKey: sessionKey,
      messageCount: messages.length,
      reason: "chat-view-render",
    })
  }, [messages.length, sessionKey])

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
      onSubagentOpen?.(sub.sessionKey, sub.id || `spawn:${sub.toolCallId}`)
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
    onSubagentOpen?.(null, null)
  }, [activeSubKey, onSubagentOpen, sessionKey])

  const activeSubagentFallbackText = useMemo(() => {
    if (!activeLiveSubagent || !isSubagentSessionKey(activeLiveSubagent.sessionKey)) {
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
  }, [activeLiveSubagent, messages])

  const activeSubagentFallbackPrompt =
    activeLiveSubagent?.task?.trim() || "Run the delegated sub-agent task."

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
  const renderedMessages = useMemo(
    () => buildStableChatRows(visibleAllMessages),
    [visibleAllMessages]
  )
  useEffect(() => {
    frontendLog("chat", "chat.rendered-messages.changed", {
      sessionKey,
      sourceMessageCount: messages.length,
      visibleMessageCount: visibleAllMessages.length,
      renderedRowCount: renderedMessages.length,
      firstRow: renderedMessages[0]
        ? { uiId: renderedMessages[0].uiId, messageId: renderedMessages[0].messageId, role: renderedMessages[0].role, gatewayIndex: renderedMessages[0].gatewayIndex }
        : null,
      lastRow: renderedMessages.at(-1)
        ? { uiId: renderedMessages.at(-1)?.uiId, messageId: renderedMessages.at(-1)?.messageId, role: renderedMessages.at(-1)?.role, gatewayIndex: renderedMessages.at(-1)?.gatewayIndex }
        : null,
      renderer: "classic-chatview",
      virtualized: false,
      windowId: windowIdRef.current,
      viewGeneration: viewGenerationRef.current,
    }, "debug")
  }, [messages.length, renderedMessages, sessionKey, visibleAllMessages.length])
  const mountedAtRef = useRef(Date.now())
  const userScrollIntentRef = useRef(false)
  const needsInitialScrollRef = useRef(true)
  const loadOlderClickInFlightRef = useRef(false)
  const olderLoadAwaitingRenderRef = useRef(false)
  const lastOlderLoadAtRef = useRef(0)
  const lastOlderLoadScrollTopRef = useRef<number | null>(null)
  const previousScrollTopRef = useRef(0)
  const userScrollIntentGenerationRef = useRef(0)
  const lastOlderLoadIntentGenerationRef = useRef(0)
  const stickToBottomRef = useRef(true)
  const wasGeneratingRef = useRef(false)
  const pendingOlderAnchorRef = useRef<MessageScrollAnchor | null>(null)
  const [loadOlderUiBusy, setLoadOlderUiBusy] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = "manual"
    return () => {
      window.history.scrollRestoration = previous
    }
  }, [])

  // Reset mount timestamp on session change
  useEffect(() => {
    mountedAtRef.current = Date.now()
    userScrollIntentRef.current = false
    needsInitialScrollRef.current = true
    loadOlderClickInFlightRef.current = false
    lastOlderLoadAtRef.current = 0
    lastOlderLoadScrollTopRef.current = null
    previousScrollTopRef.current = 0
    userScrollIntentGenerationRef.current = 0
    lastOlderLoadIntentGenerationRef.current = 0
    stickToBottomRef.current = true
    wasGeneratingRef.current = false
    setLoadOlderUiBusy(false)
  }, [sessionKey])

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

  const loadOlderWithoutJump = useCallback(async () => {
    const now = Date.now()
    if (!hasOlderMessages || loadingOlderMessages || loadOlderUiBusy || loadOlderClickInFlightRef.current) return
    const elapsedSinceSettledLoad = now - lastOlderLoadAtRef.current
    if (elapsedSinceSettledLoad < OLDER_HISTORY_LOAD_SETTLE_COOLDOWN_MS) {
      logChatScrollDebug({
        source: "chat",
        event: "load-older-cooldown-skip",
        sessionKey,
        deltaPx: elapsedSinceSettledLoad,
        scrollTop: scrollContainerRef.current?.scrollTop,
        scrollHeight: scrollContainerRef.current?.scrollHeight,
        clientHeight: scrollContainerRef.current?.clientHeight,
      })
      return
    }
    loadOlderClickInFlightRef.current = true
    olderLoadAwaitingRenderRef.current = true
    setLoadOlderUiBusy(true)
    pendingOlderAnchorRef.current = captureMessageScrollAnchor(scrollContainerRef.current)
    logChatScrollDebug({
      source: "chat",
      event: "load-older-start",
      sessionKey,
      anchorId: pendingOlderAnchorRef.current?.uiId || pendingOlderAnchorRef.current?.id,
      anchorTop: pendingOlderAnchorRef.current?.top,
      scrollTop: scrollContainerRef.current?.scrollTop,
      scrollHeight: scrollContainerRef.current?.scrollHeight,
      clientHeight: scrollContainerRef.current?.clientHeight,
    })
    try {
      const addedMessages = await loadOlderMessages()
      if (!addedMessages) {
        pendingOlderAnchorRef.current = null
        olderLoadAwaitingRenderRef.current = false
        lastOlderLoadAtRef.current = Date.now()
        loadOlderClickInFlightRef.current = false
        setLoadOlderUiBusy(false)
      }
    } catch {
      pendingOlderAnchorRef.current = null
      olderLoadAwaitingRenderRef.current = false
      lastOlderLoadAtRef.current = Date.now()
      loadOlderClickInFlightRef.current = false
      setLoadOlderUiBusy(false)
    }
  }, [hasOlderMessages, loadOlderMessages, loadingOlderMessages, loadOlderUiBusy, scrollContainerRef, sessionKey])

  useLayoutEffect(() => {
    const anchor = pendingOlderAnchorRef.current
    if (!anchor) return
    pendingOlderAnchorRef.current = null
    olderLoadAwaitingRenderRef.current = false
    settleMessageScrollAnchor(scrollContainerRef.current, anchor, () => {
      const el = scrollContainerRef.current
      if (el) {
        previousScrollTopRef.current = el.scrollTop
        lastOlderLoadScrollTopRef.current = el.scrollTop
      }
      lastOlderLoadIntentGenerationRef.current = userScrollIntentGenerationRef.current
      userScrollIntentRef.current = false
      lastOlderLoadAtRef.current = Date.now()
      loadOlderClickInFlightRef.current = false
      setLoadOlderUiBusy(false)
    })
  }, [renderedMessages.length, scrollContainerRef])

  const handleScroll = useCallback(() => {
    onScroll()
    const el = scrollContainerRef.current
    if (el) {
      if (loadOlderUiBusy && olderLoadAwaitingRenderRef.current && userScrollIntentRef.current) {
        pendingOlderAnchorRef.current = captureMessageScrollAnchor(el)
      }
      const atBottom = isNearChatBottom({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        thresholdPx: JUMP_TO_BOTTOM_THRESHOLD_PX,
      })
      stickToBottomRef.current = shouldStickToChatBottomAfterScroll({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        thresholdPx: JUMP_TO_BOTTOM_THRESHOLD_PX,
      })
      setShowJumpToBottom(!atBottom)
      const hasFreshUserScrollIntent = userScrollIntentRef.current && userScrollIntentGenerationRef.current > lastOlderLoadIntentGenerationRef.current
      if (hasOlderMessages && shouldAutoLoadOlderHistory({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        previousScrollTop: previousScrollTopRef.current,
        hasUserIntent: hasFreshUserScrollIntent,
        lastLoadScrollTop: lastOlderLoadScrollTopRef.current,
      })) {
        logChatScrollDebug({ source: "chat", event: "load-older-trigger", sessionKey, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight })
        void loadOlderWithoutJump()
      }
      previousScrollTopRef.current = el.scrollTop
    }
    if (activePopoverId) setActivePopoverId(null)
  }, [activePopoverId, hasOlderMessages, loadOlderUiBusy, loadOlderWithoutJump, onScroll, scrollContainerRef])

  const jumpToLatestMessage = useCallback(() => {
    setShowJumpToBottom(false)
    stickToBottomRef.current = true
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" })
  }, [bottomRef])

  const syncJumpToBottomVisibility = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const atBottom = isNearChatBottom({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      thresholdPx: JUMP_TO_BOTTOM_THRESHOLD_PX,
    })
    stickToBottomRef.current = atBottom
    setShowJumpToBottom(!atBottom)
  }, [scrollContainerRef])

  useEffect(() => {
    syncJumpToBottomVisibility()
  }, [renderedMessages.length, scrollContainerRef, syncJumpToBottomVisibility])

  useLayoutEffect(() => {
    const startedGenerating = isGenerating && !wasGeneratingRef.current
    wasGeneratingRef.current = isGenerating
    if (startedGenerating) stickToBottomRef.current = true
    if (isGenerating && stickToBottomRef.current) {
      const scrollToLatest = () => {
        const el = scrollContainerRef.current
        if (!el) return
        scrollChatToBottom(el)
        setShowJumpToBottom(false)
      }
      scrollToLatest()
      requestAnimationFrame(scrollToLatest)
    }
  }, [isGenerating, pendingTools.length, renderedMessages, scrollContainerRef])

  useLayoutEffect(() => {
    if (
      needsInitialScrollRef.current &&
      renderedMessages.length > 0 &&
      !loading &&
      !userScrollIntentRef.current
    ) {
      needsInitialScrollRef.current = false
      const scrollToLatest = () => {
        const el = scrollContainerRef.current
        if (!el) return
        scrollChatToBottom(el)
        stickToBottomRef.current = true
        setShowJumpToBottom(false)
      }
      requestAnimationFrame(() => {
        scrollToLatest()
        requestAnimationFrame(scrollToLatest)
        window.setTimeout(scrollToLatest, 120)
      })
    }
  }, [renderedMessages.length, loading, scrollContainerRef])



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
        spaceId: activeSpaceId ?? undefined,
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
            context: forkContext ?? { type: "chat" },
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
          spaceId: activeSpaceId ?? undefined,
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
          spaceId: activeSpaceId ?? undefined,
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
    [sessionKey, messages, forkContext, activeSpaceId, onForkNavigate]
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

  const terminalToolState = useMemo(
    () => terminalToolStateById(renderedMessages, pendingTools),
    [renderedMessages, pendingTools]
  )

  const activeTurnToolCalls = useMemo(() => {
    if (!isGenerating || latestRenderedUserIndex < 0) return []
    const activeTurnMessages = []
    for (const message of renderedMessages.slice(latestRenderedUserIndex + 1)) {
      if (message.role === "user") break
      activeTurnMessages.push(message)
    }
    return mergeActiveTurnToolCalls(activeTurnMessages, pendingTools)
  }, [isGenerating, latestRenderedUserIndex, pendingTools, renderedMessages])

  const spawnsByToolCallId = useMemo(() => {
    const map = new Map<string, SpawnedSubagent>()
    for (const sub of spawnedSubagents) {
      map.set(sub.toolCallId, sub)
    }
    return map
  }, [spawnedSubagents])

  const getSubagentsForMessage = useCallback(
    (toolCalls?: import("./types").InlineToolCall[]): SpawnedSubagent[] => {
      if (!toolCalls) return []
      const matched: SpawnedSubagent[] = []
      for (const tc of toolCalls) {
        if (tc.tool === "sessions_spawn") {
          const sub = spawnsByToolCallId.get(tc.id)
          if (sub) matched.push(sub)
        }
      }
      return matched
    },
    [spawnsByToolCallId]
  )

  const {
    subagentsByTriggerUserId,
    orphanSubagentsByAssistantId,
    subagentRenderScope,
    currentTurnSubagents,
  } = useMemo(() => {
    const byTriggerUserId = new Map<string, SpawnedSubagent[]>()
    const orphanByAssistantId = new Map<string, SpawnedSubagent[]>()
    let nearestUserId: string | null = null
    let latestUserMessageId: string | null = null

    for (const msg of renderedMessages) {
      if (msg.role === "user") {
        nearestUserId = msg.messageId
        latestUserMessageId = msg.messageId
        continue
      }

      const msgSubagents = getSubagentsForMessage(msg.toolCalls)
      if (msgSubagents.length === 0) continue

      if (nearestUserId) {
        const existing = byTriggerUserId.get(nearestUserId) ?? []
        byTriggerUserId.set(nearestUserId, [
          ...existing,
          ...msgSubagents,
        ])
      } else {
        orphanByAssistantId.set(msg.messageId, msgSubagents)
      }
    }

    const latestUserSubagents = latestUserMessageId
      ? (byTriggerUserId.get(latestUserMessageId) ?? [])
      : []
    return {
      subagentsByTriggerUserId: byTriggerUserId,
      orphanSubagentsByAssistantId: orphanByAssistantId,
      currentTurnSubagents: latestUserSubagents,
      subagentRenderScope: {
        latestUserMessageId,
        currentTurnCount: latestUserSubagents.length,
        anchoredCount: Array.from(byTriggerUserId.values()).reduce((sum, items) => sum + items.length, 0),
        orphanCount: Array.from(orphanByAssistantId.values()).reduce((sum, items) => sum + items.length, 0),
      },
    }
  }, [getSubagentsForMessage, renderedMessages])

  useEffect(() => {
    if (spawnedSubagents.length === 0) return
    frontendLog("chat", "subagents.render.scope", {
      sessionKey,
      globalCount: spawnedSubagents.length,
      activeCount: spawnedSubagents.filter((sub) => isActiveSubagent(sub.status)).length,
      latestUserMessageId: subagentRenderScope.latestUserMessageId,
      currentTurnCount: subagentRenderScope.currentTurnCount,
      anchoredCount: subagentRenderScope.anchoredCount,
      orphanCount: subagentRenderScope.orphanCount,
      messageCount: renderedMessages.length,
    }, "debug")
  }, [renderedMessages.length, sessionKey, spawnedSubagents, subagentRenderScope])

  const scrollToRenderedMessage = useCallback((messageId: string, _seq?: number) => {
    void _seq
    const target = document.getElementById(`message-${messageId}`)
    if (!target) return false
    target.scrollIntoView({ behavior: "auto", block: "center" })
    return true
  }, [])

  // Listen for scroll-to-message events from Ctrl+K global search
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.sessionKey === sessionKey && detail?.messageId) {
        scrollToRenderedMessage(detail.messageId)
        handleHighlightMessage(detail.messageId)
      }
    }
    window.addEventListener("openclaw:scroll-to-message", handler)
    return () => window.removeEventListener("openclaw:scroll-to-message", handler)
  }, [sessionKey, scrollToRenderedMessage, handleHighlightMessage])

  const renderMessageRow = useCallback(
    (index: number, msg: StableChatMessage) => {
      const isLast = index === renderedMessages.length - 1
      const showPending =
        index === latestRenderedUserIndex &&
        isGenerating &&
        activeTurnToolCalls.length > 0 &&
        msg.role === "user"
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
      const filteredPending = toolCallsWithoutSpawn(activeTurnToolCalls).filter((t) => {
        // During a live turn, keep the active tool stack stable under the user
        // message: completed tools stay in the same stack while the next tool
        // starts, instead of jumping into separate assistant tool blocks.
        if (isGenerating) return true
        const isInMessageHistory = renderedMessages.some(
          (m) => m.role === "assistant" && m.toolCalls?.some((tc) => tc.id === t.id)
        )
        return !isInMessageHistory
      })
      const messageToolCalls =
        msg.role === "assistant" && suppressedToolCallMessages.has(msg.messageId)
          ? []
          : groupedToolCalls.get(msg.messageId) ?? msg.toolCalls ?? []
      const suppressLiveToolOnlyAssistantRow =
        isGenerating &&
        msg.role === "assistant" &&
        index > latestRenderedUserIndex &&
        !msg.text.trim() &&
        !msg.reasoningText &&
        messageToolCalls.length > 0
      if (suppressLiveToolOnlyAssistantRow) return null
      const activeTurnAssistantToolCalls =
        isGenerating && msg.role === "assistant" && index > latestRenderedUserIndex
          ? []
          : messageToolCalls
      const shouldFinalizeDisplayedTools =
        msg.role === "assistant" &&
        (index < latestRenderedUserIndex || !isGenerating || pendingTools.length === 0)
      const filteredToolCalls = applyTerminalToolState(
        toolCallsWithoutSpawn(activeTurnAssistantToolCalls),
        terminalToolState,
        { finalizeStaleRunning: shouldFinalizeDisplayedTools }
      )
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
          data-chat-message-row="true"
          data-ui-id={msg.uiId}
          className={cn(
            "mx-auto max-w-[44rem] px-4 py-3 [contain:layout_paint_style]",
            highlightedMessageId && highlightedMessageId !== msg.messageId && "opacity-40",
            highlightedMessageId === msg.messageId && "rounded-lg ring-1 ring-yellow-500/40"
          )}
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
                  <div className="mb-4 max-w-[85%]">
                    <ToolCallSteps
                      tools={filteredToolCalls}
                      defaultOpen={lastTwoAssistantIds.has(msg.messageId) && !assistantHasText}
                      onSelectTool={onSelectTool}
                      onResolveApproval={resolveExecApproval}
                      sessionKey={sessionKey}
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
            return <>{toolSteps}{bubble}</>
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
                sessionKey={sessionKey}
              />
            </div>
          )}
        </div>
      )
    },
    [
      activePopoverId,
      activeTurnToolCalls,
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
      terminalToolState,
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

  const experimentalAssistantUiChatViewEnabled = useAssistantUiChatViewEnabled()
  // Keep the experimental Vercel/assistant-ui chat view disabled until it
  // reaches parity with the mature renderer for live pending tools, approvals,
  // subagents, and send-time scroll ownership.
  const assistantUiChatViewEnabled = false && experimentalAssistantUiChatViewEnabled

  if (activeSubKey && activeLiveSubagent) {
    return (
      <SubagentFullChat
        sessionKey={activeSubKey}
        label={activeLiveSubagent.label}
        status={activeLiveSubagent.status}
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
          initialPrompt={composerSeed || undefined}
          replyTo={replyTo}
          onCancelReply={cancelReply}
          onModelSelect={handleSessionModelSelect}
          modelSwitching={modelSwitching}
          glowOnMount
          draftKey={sessionKey}
        />
        {statusText && (
          <div className="flex items-center pl-1">
            <ProcessStatusIcon tool={liveTool?.tool} />
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
    <div
      className="relative flex h-full w-full flex-col overflow-hidden"
      onWheelCapture={() => {
        userScrollIntentRef.current = true
        userScrollIntentGenerationRef.current += 1
      }}
      onTouchMoveCapture={() => {
        userScrollIntentRef.current = true
        userScrollIntentGenerationRef.current += 1
      }}
      onPointerDownCapture={() => {
        userScrollIntentRef.current = true
        userScrollIntentGenerationRef.current += 1
      }}
      onPointerMoveCapture={(event) => {
        if (event.buttons === 0) return
        userScrollIntentRef.current = true
        userScrollIntentGenerationRef.current += 1
      }}
    >
      {/* Sub-header for chat actions & pins */}
      <div className="z-40 flex h-9 shrink-0 items-center justify-between bg-background/70 px-4 backdrop-blur-[2px]">
        <div className="flex items-center gap-4">
          {/* <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground/50">
            <Icons.BubbleChat size={12} className="opacity-50" />
            <span className="uppercase tracking-widest">Conversation</span>
          </div> */}
        </div>

        {dataSource === "syncing" && (
          <div className="flex items-center gap-1.5 rounded-full bg-muted/30 px-2.5 py-1 text-[10px] text-muted-foreground/60">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-500/60" />
            <span>Syncing…</span>
          </div>
        )}

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

      <ChatSearch
        messages={renderedMessages}
        sessionKey={sessionKey}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onScrollToMessage={(id: string, seq?: number) => scrollToRenderedMessage(id, seq)}
        onHighlightMessage={handleHighlightMessage}
      />

      {assistantUiChatViewEnabled ? (
        <>
          <OpenClawVercelChat
            sessionKey={sessionKey}
            messages={renderedMessages}
            isGenerating={isGenerating}
            statusText={statusText}
            hasOlderMessages={hasOlderMessages}
            loadingOlderMessages={loadingOlderMessages}
            onLoadOlderMessages={loadOlderMessages}
            onSelectTool={onSelectTool}
            onResolveApproval={resolveExecApproval}
          />

          <div className="relative shrink-0 bg-background/60 py-3 backdrop-blur-sm">
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
              initialPrompt={composerSeed || undefined}
              replyTo={replyTo}
              onCancelReply={cancelReply}
              onModelSelect={handleSessionModelSelect}
              modelSwitching={modelSwitching}
              historyMessages={userMessageHistory}
              draftKey={sessionKey}
            />
          </div>
        </>
      ) : (
        <>

      <div
        ref={(ref) => {
          scrollContainerRef.current = ref
        }}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
      >
        <div className="min-h-full">
          <div className="mx-auto max-w-3xl px-4 pt-8" />
          {renderedMessages.map((msg, index) => (
            <RenderedMessageRow
              key={msg.uiId}
              msg={msg}
              index={index}
              total={renderedMessages.length}
              rowSignature={stableMessageRowSignature(msg)}
              uiStateKey={`${highlightedMessageId ?? ""}:${activePopoverId ?? ""}:${isGenerating ? "1" : "0"}:${lastEditableUserId ?? ""}`}
              renderMessageRow={renderMessageRow}
            />
          ))}
          <div className="mx-auto max-w-[44rem] px-4 pt-1 pb-8">
            <AnimatePresence initial={false}>
              {editPreview && (
                <EditPreviewPanel
                  key={editPreview.branchSessionKey}
                  preview={editPreview}
                  onSelect={selectEditBranch}
                />
              )}
            </AnimatePresence>
            <div className="mt-1 flex h-[21px] items-center">
              {statusText && (
                <>
                  <ProcessStatusIcon tool={liveTool?.tool} />
                  <span className="thinking-shimmer text-[14px] font-medium tracking-[-0.01em]">
                    {statusText.replace(/\.{3}$/, "")}
                    <span className="thinking-ellipsis" aria-hidden="true" />
                  </span>
                </>
              )}
            </div>
            <div ref={bottomRef} className="h-8" />
          </div>
        </div>
      </div>

      <div className="relative shrink-0 bg-background/60 py-3 backdrop-blur-sm">
        <div className="pointer-events-none absolute -top-12 left-1/2 z-20 -translate-x-1/2">
          <AnimatePresence>
            {showJumpToBottom && (
              <motion.button
                type="button"
                aria-label="Scroll to latest message"
                title="Scroll to latest message"
                onClick={jumpToLatestMessage}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: [0, 4, 0], scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{
                  opacity: { duration: 0.16, ease: "easeOut" },
                  scale: { duration: 0.16, ease: "easeOut" },
                  y: { duration: 1.8, ease: "easeInOut", repeat: Infinity },
                }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.94 }}
                className={cn(
                  "group flex size-9 cursor-pointer items-center justify-center rounded-full pointer-events-auto",
                  "border border-border/50 bg-background/95 text-foreground/80 shadow-sm backdrop-blur",
                  "transition-colors hover:bg-muted hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex origin-center bg-transparent"
                >
                  <MdKeyboardDoubleArrowDown size={22} />
                </span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        {currentTurnSubagents.length > 0 && (
          <div className="mb-2">
            <SubagentBar subagents={currentTurnSubagents} onOpen={openSubagent} />
          </div>
        )}
        <ChatBox
          onSend={wrappedSend}
          disabled={false}
          isGenerating={isGenerating}
          onAbort={handleAbort}
          initialPrompt={composerSeed || undefined}
          replyTo={replyTo}
          onCancelReply={cancelReply}
          onModelSelect={handleSessionModelSelect}
          modelSwitching={modelSwitching}
          historyMessages={userMessageHistory}
          draftKey={sessionKey}
        />
      </div>
        </>
      )}
    </div>
  )
}
