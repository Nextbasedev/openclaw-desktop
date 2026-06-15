"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { ChatLoadingSkeleton } from "@/components/Skeleton/ChatLoadingSkeleton"
import { ChatBox } from "@/components/ChatBox"
import { Icons } from "@/components/icons"
import { PinnedMessagesPopover } from "./PinnedMessagesPopover"
import {
  abortChatV2,
  fetchChatMessagesV2,
  fetchSessionContextUsage,
  openPatchStreamV2,
  resolveExecApprovalV2,
  sendChatV2,
} from "@/lib/chat-engine-v2/client"
import { applyChatPatch, patchImpliesActiveRun, statusFromPatch } from "@/lib/chat-engine-v2/applyPatches"
import { chatSendIdempotencyKey } from "@/lib/chat-engine-v2/idempotency"
import type { PatchFrame } from "@/lib/chat-engine-v2/types"
import { parseChatHistory, type RawHistoryMessage } from "@/lib/chatHistoryParser"
import type { ChatComposerSubmit } from "@/lib/chatAttachments"
import { frontendLog } from "@/lib/clientLogs"
import { randomId } from "@/lib/id"
import { exportMessagesMarkdown } from "@/lib/messageActions"
import { normalizeSessionTokenUsage, type SessionTokenUsage } from "@/lib/sessionContextUsage"
import { cn } from "@/lib/utils"
import {
  applyTerminalToolState,
  groupAssistantToolCallsByMessage,
  terminalToolStateById,
} from "@/lib/chatToolDisplay"
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
import { MessageBubble } from "./MessageBubble"
import { ThinkingBlock } from "./ThinkingBlock"
import { ToolCallSteps } from "./ToolCallSteps"
import type { ChatMessage, InlineToolCall, StreamStatus } from "./types"

type Props = {
  sessionKey: string
  sessionTitle?: string
  onFirstMessageSent?: (text: string) => void
  initialMessages?: ChatMessage[]
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
  isBackgroundSession?: boolean
}

type HistoryState = {
  loading: boolean
  error: string | null
  composerError: string | null
  messages: ChatMessage[]
  streamStatus: StreamStatus
  statusLabel: string | null
}

const ACTIVE_STREAM_STATUSES = new Set<StreamStatus>([
  "queued",
  "running",
  "collect",
  "thinking",
  "tool_running",
  "streaming",
  "stopping",
  "restarting",
])

const FOLLOW_SCROLL_THRESHOLD_PX = 96

type StatusIconMeta = {
  icon: IconType
  label: string
}

const STATUS_TOOL_ICON_META: Record<string, StatusIconMeta> = {
  read: { icon: LuFileText, label: "Read file" },
  write: { icon: LuPencil, label: "Write file" },
  edit: { icon: LuPencil, label: "Edit file" },
  apply_patch: { icon: LuFileCode, label: "Apply patch" },
  exec: { icon: LuFileCode, label: "Run command" },
  process: { icon: LuRefreshCw, label: "Process" },
  web_fetch: { icon: LuGlobe, label: "Fetch web page" },
  web_search: { icon: LuGlobe, label: "Search web" },
  cron: { icon: LuClock, label: "Schedule job" },
  sessions_list: { icon: LuMessageSquare, label: "List sessions" },
  sessions_history: { icon: LuMessageSquare, label: "Session history" },
  sessions_send: { icon: LuMessageSquare, label: "Send to session" },
  sessions_spawn: { icon: LuSparkles, label: "Spawn sub-agent" },
  sessions_yield: { icon: LuSparkles, label: "Wait for sub-agent" },
  subagents: { icon: LuSparkles, label: "Sub-agent" },
  session_status: { icon: LuSettings2, label: "Session status" },
  image: { icon: LuImage, label: "Analyze image" },
  image_generate: { icon: LuImage, label: "Generate image" },
  memory_get: { icon: LuBrain, label: "Read memory" },
  memory_search: { icon: LuBrain, label: "Search memory" },
  update_plan: { icon: LuWrench, label: "Update plan" },
}

function statusIconMeta(tool?: string | null): StatusIconMeta {
  if (tool && STATUS_TOOL_ICON_META[tool]) return STATUS_TOOL_ICON_META[tool]
  return { icon: LuSparkles, label: "Thinking" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function seqOf(raw: RawHistoryMessage): number | null {
  const seq = raw.__openclaw?.seq
  return typeof seq === "number" && Number.isFinite(seq) ? seq : null
}

function timestampOf(message: ChatMessage): number {
  if (!message.createdAt) return Number.POSITIVE_INFINITY
  const value = Date.parse(message.createdAt)
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

function rawTimestampOf(raw: RawHistoryMessage): number {
  if (typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp)) {
    return raw.timestamp > 100_000_000 && raw.timestamp < 10_000_000_000
      ? Math.round(raw.timestamp * 1000)
      : Math.round(raw.timestamp)
  }
  if (!raw.createdAt) return Number.POSITIVE_INFINITY
  const value = Date.parse(raw.createdAt)
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

function orderedRawMessages(raw: unknown[]): RawHistoryMessage[] {
  return raw
    .filter(isRecord)
    .map((item, index) => ({ item: item as RawHistoryMessage, index }))
    .sort((a, b) => {
      const aSeq = seqOf(a.item)
      const bSeq = seqOf(b.item)
      if (aSeq !== null && bSeq !== null && aSeq !== bSeq) return aSeq - bSeq
      if (aSeq !== null && bSeq === null) return -1
      if (aSeq === null && bSeq !== null) return 1
      const aTime = rawTimestampOf(a.item)
      const bTime = rawTimestampOf(b.item)
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return aTime - bTime
      }
      return a.index - b.index
    })
    .map(({ item }) => item)
}

function orderChatMessages(messages: ChatMessage[]) {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const aSeq = a.message.gatewayIndex
      const bSeq = b.message.gatewayIndex
      if (typeof aSeq === "number" && typeof bSeq === "number" && aSeq !== bSeq) return aSeq - bSeq
      if (typeof aSeq === "number" && typeof bSeq !== "number") return -1
      if (typeof aSeq !== "number" && typeof bSeq === "number") return 1
      const timeDelta = timestampOf(a.message) - timestampOf(b.message)
      if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta
      return a.index - b.index
    })
    .map(({ message }) => message)
}

function normalizeHistory(rawMessages: unknown[]): ChatMessage[] {
  const orderedRaw = orderedRawMessages(rawMessages)
  const parsed = parseChatHistory(orderedRaw)
  return orderChatMessages(parsed.messages)
}

function patchPayload(frame: PatchFrame): Record<string, unknown> | null {
  const payload = frame.patch.payload
  return isRecord(payload) ? payload : null
}

function patchSemanticType(frame: PatchFrame): string {
  const semanticType = patchPayload(frame)?.semanticType
  return typeof semanticType === "string" && semanticType.trim() ? semanticType : frame.patch.type
}

function patchBelongsToSession(frame: PatchFrame, sessionKey: string): boolean {
  if (frame.patch.sessionKey) return frame.patch.sessionKey === sessionKey
  const payloadSessionKey = patchPayload(frame)?.sessionKey
  return payloadSessionKey === sessionKey
}

function isActiveStreamStatus(status: StreamStatus) {
  return ACTIVE_STREAM_STATUSES.has(status)
}

function hasActiveAssistantAfterLastUser(messages: ChatMessage[]) {
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf("user")
  return messages.slice(lastUserIndex + 1).some((message) =>
    message.role === "assistant" &&
    Boolean(message.text.trim() || message.reasoningText?.trim() || message.toolCalls?.length)
  )
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

function liveRunningTool(messages: ChatMessage[]): InlineToolCall | null {
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf("user")
  const activeTurnMessages = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages
  for (const message of activeTurnMessages) {
    for (const tool of message.toolCalls ?? []) {
      if (
        tool.status === "running" &&
        tool.tool !== "sessions_spawn" &&
        tool.tool !== "subagents" &&
        tool.tool !== "sessions_yield"
      ) {
        return tool
      }
    }
  }
  return null
}

function toolPatchId(frame: PatchFrame): string | null {
  const payload = patchPayload(frame)
  const direct = payload?.toolCallId
  if (typeof direct === "string" && direct.trim()) return direct
  const toolCall = payload?.toolCall
  if (!isRecord(toolCall)) return null
  const nested = toolCall.toolCallId ?? toolCall.id
  return typeof nested === "string" && nested.trim() ? nested : null
}

function findVisibleTool(messages: ChatMessage[], toolCallId: string | null): InlineToolCall | null {
  if (!toolCallId) return null
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const match = messages[messageIndex]?.toolCalls?.find((tool) => tool.id === toolCallId)
    if (match) return match
  }
  return null
}

function visibleToolCount(messages: ChatMessage[]) {
  return messages.reduce((total, message) => total + (message.toolCalls?.length ?? 0), 0)
}

function isNearScrollBottom(element: HTMLElement, threshold = FOLLOW_SCROLL_THRESHOLD_PX) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
}

function scrollElementToBottom(element: HTMLElement, behavior: ScrollBehavior = "auto") {
  element.scrollTo({
    top: element.scrollHeight,
    behavior,
  })
}

function generatingStatusText(status: StreamStatus, statusLabel: string | null, liveTool: InlineToolCall | null) {
  if (liveTool) {
    const input = summarizeToolInput(liveTool)
    return `Running ${liveTool.tool}${input ? `: ${input}` : ""}...`
  }
  if (status === "thinking") return "Thinking - waiting for the next event..."
  if (status === "queued") return statusLabel ? `Queued - ${statusLabel}...` : "Queued..."
  if (status === "running") return statusLabel ? `Running - ${statusLabel}...` : "Running..."
  if (status === "collect") return statusLabel ? `Collecting - ${statusLabel}...` : "Collecting..."
  if (status === "tool_running") return `Running${statusLabel ? ` - ${statusLabel}` : " tool"}...`
  if (status === "streaming") return "Responding..."
  if (status === "stopping") return "Stopping..."
  if (status === "restarting") return "Restarting..."
  return statusLabel ? `${statusLabel}...` : "Thinking - waiting for the next event..."
}

function shouldAnimateAssistantMessage(params: {
  message: ChatMessage
  index: number
  messages: ChatMessage[]
  isGenerating: boolean
}) {
  const { message, index, messages, isGenerating } = params
  if (message.role !== "assistant" || !message.text.trim()) return false
  const isLast = index === messages.length - 1
  return (isLast && isGenerating) || message.animateText === true
}

function isActivelyStreamingAssistant(params: {
  message: ChatMessage
  index: number
  messages: ChatMessage[]
  isGenerating: boolean
}) {
  const { message, index, messages, isGenerating } = params
  return isGenerating && message.role === "assistant" && index === messages.length - 1
}

function GeneratingStatus({ label, tool }: { label: string; tool?: string | null }) {
  const meta = statusIconMeta(tool)
  const Icon = meta.icon
  const text = label.replace(/\.{3}$/, "")
  return (
    <div className="flex min-h-[22px] items-center">
      <span
        className="mr-2 flex size-4 shrink-0 items-center justify-center"
        aria-label={meta.label}
        title={meta.label}
      >
        <Icon className="size-3.5 text-amber-400" />
      </span>
      <span className="thinking-shimmer text-[14px] font-normal leading-relaxed tracking-normal">
        {text}
        <span className="thinking-ellipsis" aria-hidden="true" />
      </span>
    </div>
  )
}

function stableToolKey(tool: InlineToolCall): string {
  if (tool.id) return `id:${tool.id}`
  return [
    "fallback",
    tool.tool,
    tool.startedAt ?? "",
    tool.completedAt ?? "",
    summarizeToolInput(tool),
  ].join(":")
}

function toolKeySet(tools: InlineToolCall[]) {
  return new Set(tools.map(stableToolKey))
}

function hasAllToolKeys(source: Set<string>, target: Set<string>) {
  for (const key of source) {
    if (!target.has(key)) return false
  }
  return true
}

function toolCallsForMessage(
  groupedToolCalls: Map<string, InlineToolCall[]>,
  message: ChatMessage
) {
  return groupedToolCalls.get(message.messageId) ?? message.toolCalls ?? []
}

function toolOnlyRowsOwnedByLaterText(
  messages: ChatMessage[],
  groupedToolCalls: Map<string, InlineToolCall[]>
) {
  const suppressed = new Set<string>()

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message?.role !== "assistant") continue
    if (message.text.trim() || message.reasoningText) continue

    const tools = toolCallsForMessage(groupedToolCalls, message)
    if (tools.length === 0) continue

    const sourceKeys = toolKeySet(tools)
    const laterTextKeys = new Set<string>()
    for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
      const next = messages[nextIndex]
      if (!next || next.role === "user") break
      if (next.role !== "assistant" || !next.text.trim()) continue

      const nextTools = toolCallsForMessage(groupedToolCalls, next)
      if (nextTools.length === 0) continue
      for (const key of toolKeySet(nextTools)) laterTextKeys.add(key)
      if (hasAllToolKeys(sourceKeys, laterTextKeys)) {
        suppressed.add(message.messageId)
        break
      }
    }
  }

  return suppressed
}

function composerAttachmentsToMessageAttachments(
  attachments: ChatComposerSubmit["attachments"]
): ChatMessage["attachments"] {
  if (!attachments?.length) return undefined
  return attachments.map((attachment) => ({
    name: attachment.name,
    mimeType: attachment.mimeType,
    content: attachment.content,
    size: attachment.size,
  }))
}

export function ChatView({
  sessionKey,
  initialPrompt,
  onFirstMessageSent,
  onSelectTool,
  onForkNavigate,
  isBackgroundSession = false,
}: Props) {
  const [state, setState] = useState<HistoryState>(() => ({
    loading: true,
    error: null,
    composerError: null,
    messages: [],
    streamStatus: "idle",
    statusLabel: null,
  }))
  const [sending, setSending] = useState(false)
  const [streamCursor, setStreamCursor] = useState<number | null>(null)
  const [reactions, setReactions] = useState<Record<string, "up" | "down">>({})
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [activePopoverId, setActivePopoverId] = useState<string | null>(null)
  const [composerSeed, setComposerSeed] = useState<string | null>(null)
  const [sessionUsage, setSessionUsage] = useState<SessionTokenUsage | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollContentRef = useRef<HTMLDivElement | null>(null)
  const cursorRef = useRef(0)
  const shouldFollowScrollRef = useRef(true)
  const contextFetchSeqRef = useRef(0)
  const wasGeneratingRef = useRef(false)
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinButtonRef = useRef<HTMLButtonElement>(null)

  const refreshSessionUsage = useCallback(async () => {
    const seq = ++contextFetchSeqRef.current
    try {
      const response = await fetchSessionContextUsage(sessionKey)
      if (seq !== contextFetchSeqRef.current) return
      setSessionUsage(normalizeSessionTokenUsage(response.usage))
    } catch {
      if (seq === contextFetchSeqRef.current) setSessionUsage(null)
    }
  }, [sessionKey])

  useEffect(() => {
    if (isBackgroundSession) return
    let cancelled = false
    cursorRef.current = 0
    shouldFollowScrollRef.current = true
    setStreamCursor(null)
    setReactions({})
    setPinnedIds([])
    setPinnedPanelOpen(false)
    setFlashId(null)
    setReplyTo(null)
    setActivePopoverId(null)
    setComposerSeed(null)
    setSessionUsage(null)
    setState({
      loading: true,
      error: null,
      composerError: null,
      messages: [],
      streamStatus: "idle",
      statusLabel: null,
    })

    fetchChatMessagesV2({ sessionKey })
      .then((history) => {
        if (cancelled) return
        if (history.sessionKey && history.sessionKey !== sessionKey) return
        const messages = normalizeHistory(
          history.messages.map((message) => message.data)
        )
        const cursor = typeof history.cursor === "number" ? history.cursor : 0
        cursorRef.current = cursor
        setStreamCursor(cursor)
        setState({
          loading: false,
          error: null,
          composerError: null,
          messages,
          streamStatus: "idle",
          statusLabel: null,
        })
      })
      .catch((error) => {
        if (cancelled) return
        setState({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          composerError: null,
          messages: [],
          streamStatus: "error",
          statusLabel: null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [isBackgroundSession, sessionKey])

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (isBackgroundSession || streamCursor === null) return
    return openPatchStreamV2(streamCursor, (frame) => {
      if (frame.type !== "patch") return
      if (!patchBelongsToSession(frame, sessionKey)) return
      const previousCursor = cursorRef.current
      if (frame.patch.cursor <= previousCursor) return
      cursorRef.current = Math.max(cursorRef.current, frame.patch.cursor)
      const patchStatus = statusFromPatch(frame)
      const semanticType = patchSemanticType(frame)
      if (semanticType === "chat.assistant.delta") {
        const message = patchPayload(frame)?.message
        const text = isRecord(message) && typeof message.text === "string" ? message.text : null
        frontendLog(
          "chat",
          "chat-rebuild.assistant-delta.apply",
          {
            sessionKey,
            cursor: frame.patch.cursor,
            textLength: text?.length ?? 0,
          },
          "debug"
        )
      }
      setState((current) => {
        const toolId = semanticType.startsWith("chat.tool.") ? toolPatchId(frame) : null
        const beforeTool = findVisibleTool(current.messages, toolId)
        const patched = applyChatPatch(
          {
            cursor: previousCursor,
            messages: current.messages,
          },
          frame
        )
        const orderedMessages = orderChatMessages(patched.messages)
        const afterTool = findVisibleTool(orderedMessages, toolId)
        if (semanticType.startsWith("chat.tool.")) {
          frontendLog(
            "chat",
            "chat-rebuild.tool-patch.apply",
            {
              sessionKey,
              cursor: frame.patch.cursor,
              patchType: frame.patch.type,
              semanticType,
              toolCallId: toolId,
              beforeStatus: beforeTool?.status ?? null,
              afterStatus: afterTool?.status ?? null,
              visible: Boolean(afterTool),
              beforeToolCount: visibleToolCount(current.messages),
              afterToolCount: visibleToolCount(orderedMessages),
              beforeMessageCount: current.messages.length,
              afterMessageCount: orderedMessages.length,
            },
            "debug"
          )
        } else if (semanticType === "chat.assistant.delta") {
          const liveRunId = typeof patchPayload(frame)?.runId === "string" ? patchPayload(frame)?.runId : null
          const assistant = [...orderedMessages]
            .reverse()
            .find((message) => message.role === "assistant" && (!liveRunId || message.runId === liveRunId))
          frontendLog(
            "chat",
            "chat-rebuild.assistant-delta.render-state",
            {
              sessionKey,
              cursor: frame.patch.cursor,
              runId: liveRunId,
              visible: Boolean(assistant?.text.trim()),
              textLength: assistant?.text.length ?? 0,
              messageCount: orderedMessages.length,
            },
            "debug"
          )
        }
        const nextStatus = patchStatus?.status ??
          (patchImpliesActiveRun(frame) ? "thinking" : current.streamStatus)
        return {
          ...current,
          loading: false,
          error: null,
          messages: orderedMessages,
          streamStatus: nextStatus,
          statusLabel: patchStatus?.label ?? current.statusLabel,
        }
      })
    })
  }, [isBackgroundSession, sessionKey, streamCursor])

  async function handleSend(payload: ChatComposerSubmit) {
    const text = payload.text.trim()
    if (!text && !payload.attachments?.length) return

    const optimisticId = randomId()
    shouldFollowScrollRef.current = true
    const optimisticMessage: ChatMessage = {
      messageId: optimisticId,
      role: "user",
      text,
      createdAt: new Date().toISOString(),
      isOptimistic: true,
      sendStatus: "sending",
      attachments: composerAttachmentsToMessageAttachments(payload.attachments),
    }

    setSending(true)
    setState((current) => ({
      ...current,
      composerError: null,
      streamStatus: "thinking",
      statusLabel: "Thinking",
      messages: orderChatMessages([...current.messages, optimisticMessage]),
    }))
    onFirstMessageSent?.(text)
    setReplyTo(null)
    setComposerSeed(null)

    try {
      await sendChatV2({
        sessionKey,
        text,
        attachments: payload.attachments,
        idempotencyKey: chatSendIdempotencyKey(sessionKey, optimisticId),
        clientMessageId: optimisticId,
        replyTo: payload.replyTo
          ? {
              messageId: payload.replyTo.messageId,
              snippet: payload.replyTo.text.slice(0, 500),
            }
          : undefined,
        autonomyMode: payload.autonomyMode ?? null,
        execPolicy: payload.execPolicy ?? undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message failed to send."
      setState((current) => ({
        ...current,
        composerError: message,
        streamStatus: "error",
        statusLabel: null,
        messages: current.messages.map((item) =>
          item.messageId === optimisticId
            ? {
                ...item,
                sendStatus: "failed",
                sendError: message,
              }
            : item
        ),
      }))
      throw error
    } finally {
      setSending(false)
    }
  }

  async function handleAbort() {
    setState((current) => ({
      ...current,
      streamStatus: "stopping",
      statusLabel: "Stopping",
    }))
    await abortChatV2({ sessionKey })
  }

  function handleTextAnimationComplete(messageId: string) {
    setState((current) => ({
      ...current,
      messages: current.messages.map((message) =>
        message.messageId === messageId
          ? { ...message, animateText: false }
          : message
      ),
    }))
  }

  function findMessageById(messageId: string) {
    return state.messages.find((message) => message.messageId === messageId)
  }

  function handleEdit(messageId: string, newText: string) {
    setState((current) => ({
      ...current,
      messages: current.messages.map((message) =>
        message.messageId === messageId
          ? { ...message, text: newText, sendStatus: undefined, sendError: null }
          : message
      ),
    }))
    void handleSend({ text: newText })
  }

  function handleRetrySend(messageId: string) {
    const message = findMessageById(messageId)
    if (!message || message.role !== "user") return
    setState((current) => ({
      ...current,
      composerError: null,
      messages: current.messages.map((item) =>
        item.messageId === messageId
          ? { ...item, sendStatus: undefined, sendError: null }
          : item
      ),
    }))
    const attachments = message.retryPayload?.attachments ?? message.attachments
      ?.filter((attachment) => typeof attachment.content === "string")
      .map((attachment) => ({
        name: attachment.name,
        mimeType: attachment.mimeType,
        content: attachment.content ?? "",
        encoding: "utf-8" as const,
        size: attachment.size ?? attachment.content?.length ?? 0,
      }))
    void handleSend(message.retryPayload ?? { text: message.text, attachments })
  }

  function handleDelete(messageId: string) {
    setState((current) => ({
      ...current,
      messages: current.messages.filter((message) => message.messageId !== messageId),
    }))
    setPinnedIds((current) => current.filter((id) => id !== messageId))
    setReactions((current) => {
      const next = { ...current }
      delete next[messageId]
      return next
    })
    setReplyTo((current) => current?.messageId === messageId ? null : current)
    setActivePopoverId((current) => current === messageId ? null : current)
  }

  function handleReact(messageId: string, reaction: "up" | "down") {
    setReactions((current) => {
      const next = { ...current }
      if (next[messageId] === reaction) delete next[messageId]
      else next[messageId] = reaction
      return next
    })
  }

  function handleFork(messageId: string) {
    onForkNavigate?.({
      name: "Forked chat",
      sessionKey: `${sessionKey}:fork:${messageId}`,
    })
  }

  const handlePin = useCallback((messageId: string) => {
    setPinnedIds((current) =>
      current.includes(messageId)
        ? current.filter((id) => id !== messageId)
        : [...current, messageId]
    )
  }, [])

  const handlePinnedMessageSelect = useCallback((messageId: string) => {
    const container = scrollContainerRef.current
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(messageId)
      : messageId.replace(/"/g, "\\\"")
    const row = container?.querySelector<HTMLElement>(`[data-message-id="${escapedId}"]`)
    row?.scrollIntoView({ behavior: "smooth", block: "center" })
    setPinnedPanelOpen(false)
    setFlashId(messageId)
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    flashTimeoutRef.current = setTimeout(() => {
      setFlashId((current) => current === messageId ? null : current)
      flashTimeoutRef.current = null
    }, 1500)
  }, [])

  function handleReply(messageId: string) {
    const message = findMessageById(messageId)
    if (!message) return
    setReplyTo(message)
  }

  function handleExport(messageId: string) {
    const message = findMessageById(messageId)
    if (!message || typeof navigator === "undefined") return
    void navigator.clipboard.writeText(exportMessagesMarkdown([message]))
  }

  function handleAskSelectedText(messageId: string, text: string, comment?: string) {
    const selected = text.trim()
    if (!selected) return
    setReplyTo({
      messageId: `${messageId}:selection`,
      role: "assistant",
      text: selected,
    })
    setComposerSeed(comment?.trim() ?? "")
  }

  function handleCancelReply() {
    setReplyTo(null)
  }

  const renderedMessages = useMemo(
    () => orderChatMessages(state.messages),
    [state.messages]
  )
  const pinnedMessages = useMemo(() => {
    const messagesById = new Map(renderedMessages.map((message) => [message.messageId, message]))
    return pinnedIds
      .map((messageId) => messagesById.get(messageId))
      .filter((message): message is ChatMessage => Boolean(message))
  }, [pinnedIds, renderedMessages])
  const scrollFollowKey = useMemo(
    () => renderedMessages.map((message) => [
      message.messageId,
      message.text.length,
      message.reasoningText?.length ?? 0,
      message.toolCalls?.map((tool) => [
        tool.id,
        tool.status,
        tool.resultText?.length ?? 0,
        tool.duration ?? "",
        tool.awaitingResult ? "awaiting" : "",
      ].join("/")).join("|") ?? "",
    ].join(":")).join(";"),
    [renderedMessages]
  )
  const promptPreview = initialPrompt?.trim()
  const isGenerating = isActiveStreamStatus(state.streamStatus)

  // Reset + initial fetch on session change
  useEffect(() => {
    setSessionUsage(null)
    void refreshSessionUsage()
  }, [refreshSessionUsage])

  // Refresh when a generation just finished (isGenerating true -> false)
  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current
    wasGeneratingRef.current = isGenerating
    if (!wasGenerating || isGenerating) return
    void refreshSessionUsage()
  }, [isGenerating, refreshSessionUsage])

  const liveTool = isGenerating ? liveRunningTool(renderedMessages) : null
  const statusText = isGenerating
    ? generatingStatusText(state.streamStatus, state.statusLabel, liveTool)
    : null
  const showThinkingState = isGenerating && !hasActiveAssistantAfterLastUser(renderedMessages)
  const latestRenderedUserIndex = useMemo(() => {
    for (let index = renderedMessages.length - 1; index >= 0; index -= 1) {
      if (renderedMessages[index]?.role === "user") return index
    }
    return -1
  }, [renderedMessages])
  const { grouped: groupedToolCalls, suppressed: suppressedToolCallMessages } = useMemo(
    () => groupAssistantToolCallsByMessage(renderedMessages),
    [renderedMessages]
  )
  const duplicateToolOnlyRows = useMemo(
    () => toolOnlyRowsOwnedByLaterText(renderedMessages, groupedToolCalls),
    [groupedToolCalls, renderedMessages]
  )
  const terminalToolState = useMemo(
    () => terminalToolStateById(renderedMessages),
    [renderedMessages]
  )

  function handleScroll() {
    const element = scrollContainerRef.current
    if (!element) return
    shouldFollowScrollRef.current = isNearScrollBottom(element)
  }

  useLayoutEffect(() => {
    if (state.loading) return
    const element = scrollContainerRef.current
    if (!element) return
    if (!shouldFollowScrollRef.current) return
    scrollElementToBottom(element)
  }, [isGenerating, scrollFollowKey, sessionKey, showThinkingState, state.loading, statusText])

  useEffect(() => {
    const container = scrollContainerRef.current
    const content = scrollContentRef.current
    if (!container || !content || typeof ResizeObserver === "undefined") return

    let frame = 0
    const observer = new ResizeObserver(() => {
      if (!shouldFollowScrollRef.current) return
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        if (shouldFollowScrollRef.current) {
          scrollElementToBottom(container)
        }
      })
    })
    observer.observe(content)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [sessionKey])

  useEffect(() => {
    if (duplicateToolOnlyRows.size === 0) return
    frontendLog(
      "chat",
      "chat-rebuild.tool-stack-collapse",
      {
        sessionKey,
        suppressedToolRows: duplicateToolOnlyRows.size,
        messageCount: renderedMessages.length,
      },
      "debug"
    )
  }, [duplicateToolOnlyRows.size, renderedMessages.length, sessionKey])

  if (isBackgroundSession) {
    return null
  }

  if (state.loading && renderedMessages.length === 0) {
    return <ChatLoadingSkeleton />
  }

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-background"
      data-chat-rebuild-history="true"
      data-session-key={sessionKey}
    >
      <div className="pointer-events-none absolute right-4 top-4 z-30">
        <div className="pointer-events-auto relative">
          <button
            ref={pinButtonRef}
            onClick={() => setPinnedPanelOpen((open) => !open)}
            aria-label="Pinned messages"
            className={cn(
              "group relative flex size-8 cursor-pointer items-center justify-center rounded-sm transition-all",
              pinnedPanelOpen
                ? "text-foreground shadow-inner"
                : pinnedMessages.length > 0
                  ? "animate-pulse text-foreground"
                  : "text-muted-foreground/60 hover:text-foreground"
            )}
          >
            <Icons.Pin
              size={16}
              className={cn(
                "transition-transform",
                pinnedPanelOpen && "scale-110"
              )}
            />
          </button>

          <PinnedMessagesPopover
            open={pinnedPanelOpen}
            onClose={() => setPinnedPanelOpen(false)}
            pinned={pinnedMessages}
            onTogglePin={handlePin}
            triggerRef={pinButtonRef}
            onNavigateToMessage={(id) => handlePinnedMessageSelect(id)}
          />
        </div>
      </div>
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {state.error ? (
          <div className="flex min-h-full items-center justify-center px-8">
            <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-5 py-4 text-center">
              <p className="text-sm font-medium text-red-400">Failed to load history</p>
              <p className="mt-1 text-xs text-muted-foreground">{state.error}</p>
            </div>
          </div>
        ) : renderedMessages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-6 px-6 py-10">
            <AnimatedGreeting />
            {promptPreview && (
              <div className="max-w-[44rem] rounded-2xl border border-border/40 bg-foreground/[0.025] px-4 py-3 text-sm text-foreground">
                {promptPreview}
              </div>
            )}
          </div>
        ) : (
          <div ref={scrollContentRef} className="min-h-full py-6">
            {renderedMessages.map((message, index) => {
              const isDuplicateToolOnlyRow = duplicateToolOnlyRows.has(message.messageId)
              const rawMessageToolCalls = message.role === "assistant" && !suppressedToolCallMessages.has(message.messageId) && !isDuplicateToolOnlyRow
                ? groupedToolCalls.get(message.messageId) ?? message.toolCalls ?? []
                : []
              const shouldFinalizeDisplayedTools =
                message.role === "assistant" &&
                (index < latestRenderedUserIndex || !isGenerating || rawMessageToolCalls.some((tool) => tool.status === "success" || tool.status === "error"))
              const messageToolCalls = applyTerminalToolState(rawMessageToolCalls, terminalToolState, {
                finalizeStaleRunning: shouldFinalizeDisplayedTools,
              })
              const suppressLiveToolOnlyAssistantRow =
                message.role === "assistant" &&
                index > latestRenderedUserIndex &&
                !message.text.trim() &&
                !message.reasoningText &&
                suppressedToolCallMessages.has(message.messageId)
              if (suppressLiveToolOnlyAssistantRow || (isDuplicateToolOnlyRow && !message.text.trim() && !message.reasoningText && !message.attachments?.length)) {
                return null
              }
              const isStreamingAssistant = isActivelyStreamingAssistant({
                message,
                index,
                messages: renderedMessages,
                isGenerating,
              })
              const animateAssistantText = shouldAnimateAssistantMessage({
                message,
                index,
                messages: renderedMessages,
                isGenerating,
              })
              return (
              <div
                key={`${message.gatewayIndex ?? "no-seq"}:${message.messageId}`}
                id={`message-${message.messageId}`}
                data-chat-message-row="true"
                data-message-id={message.messageId}
                data-message-seq={message.gatewayIndex ?? ""}
                data-pin-flash={flashId === message.messageId ? "true" : undefined}
                className={cn(
                  "mx-auto max-w-[44rem] rounded-xl px-4 py-3 transition-[box-shadow] duration-300",
                  flashId === message.messageId && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background"
                )}
              >
                {message.role === "assistant" && message.reasoningText && (
                  <ThinkingBlock text={message.reasoningText} />
                )}
                {message.role === "assistant" && messageToolCalls.length ? (
                  <div className="mb-4 max-w-[85%]">
                    <ToolCallSteps
                      tools={messageToolCalls}
                      defaultOpen={!message.text.trim()}
                      onSelectTool={onSelectTool}
                      onResolveApproval={(approvalId, decision) =>
                        resolveExecApprovalV2({ approvalId, decision }).then(() => undefined)
                      }
                      sessionKey={sessionKey}
                    />
                  </div>
                ) : null}
                {(message.text.trim() || message.attachments?.length) ? (
                  <MessageBubble
                    message={message}
                    onEdit={
                      message.role === "user" && message.messageId === renderedMessages[latestRenderedUserIndex]?.messageId
                        ? handleEdit
                        : undefined
                    }
                    onRetrySend={message.role === "user" ? handleRetrySend : undefined}
                    onReply={handleReply}
                    onPin={handlePin}
                    onDelete={handleDelete}
                    onReact={message.role === "assistant" ? handleReact : undefined}
                    onExport={handleExport}
                    onFork={message.role === "assistant" ? handleFork : undefined}
                    onAskSelectedText={message.role === "assistant" ? handleAskSelectedText : undefined}
                    isPinned={pinnedIds.includes(message.messageId)}
                    reaction={reactions[message.messageId]}
                    isGenerating={isGenerating}
                    isActivelyStreaming={isStreamingAssistant}
                    animateAssistantText={animateAssistantText}
                    onTextAnimationComplete={handleTextAnimationComplete}
                    suppressActions={false}
                    popoverOpen={activePopoverId === message.messageId}
                    onPopoverOpenChange={(open) =>
                      setActivePopoverId(open ? message.messageId : null)
                    }
                    onResolveApproval={(approvalId, decision) =>
                      resolveExecApprovalV2({ approvalId, decision }).then(() => undefined)
                    }
                  />
                ) : null}
              </div>
              )
            })}
            {showThinkingState ? (
              <div className="mx-auto max-w-[44rem] px-4 pb-2 pt-0">
                <GeneratingStatus label={statusText ?? "Thinking..."} tool={liveTool?.tool} />
              </div>
            ) : null}
            <div className="h-6" />
          </div>
        )}
      </div>

      <div className="shrink-0 bg-background/60 py-3 backdrop-blur-sm">
        <ChatBox
          key={sessionKey}
          initialPrompt={composerSeed ?? initialPrompt}
          errorMessage={state.composerError}
          onSend={handleSend}
          disabled={state.loading || sending}
          isGenerating={isGenerating}
          onAbort={handleAbort}
          replyTo={replyTo}
          sessionUsage={sessionUsage}
          onCancelReply={handleCancelReply}
          draftKey={`chat:${sessionKey}`}
        />
      </div>
    </div>
  )
}
