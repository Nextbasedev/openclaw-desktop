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
import * as activeRunRegistry from "@/lib/chat-engine-v2/activeRunRegistry"
import { chatSendIdempotencyKey } from "@/lib/chat-engine-v2/idempotency"
import type { PatchFrame } from "@/lib/chat-engine-v2/types"
import { parseChatHistory, type RawHistoryMessage } from "@/lib/chatHistoryParser"
import { dedupeChatMessages } from "@/lib/chatMessageDedupe"
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
  LuArrowDown,
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
import {
  INITIAL_WINDOW_STATE,
  MAX_LOADED,
  OLDER_PAGE,
  BOTTOM_TRIGGER,
  REFRACTORY_MS,
  applyInitialPage,
  applyLiveAppend,
  applyNewerPage,
  applyOlderPage,
  canEvictFromStartOnLiveAppend,
  computeEvictedAfterAppend,
  computeEvictedAfterPrepend,
  liveTailQuery,
  shouldDropPatchAsEvicted,
  shouldFetchNewer,
  shouldFetchOlder,
  type WindowState,
} from "./messageWindow"
import { ThinkingBlock } from "./ThinkingBlock"
import { ToolCallSteps } from "./ToolCallSteps"
import { SubagentBar } from "./SubagentBar"
import { SubagentCard } from "./SubagentCard"
import { SubagentFullChat } from "./SubagentFullChat"
import {
  buildSubagentAnchorMaps,
  deriveSpawnedSubagents,
  indexSpawnsByToolCallId,
} from "./subagentDerive"
import type { ChatMessage, InlineToolCall, SpawnedSubagent, StreamStatus } from "./types"
import { orderChatMessages } from "./orderChatMessages"

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

function normalizeHistory(rawMessages: unknown[]): ChatMessage[] {
  const orderedRaw = orderedRawMessages(rawMessages)
  const parsed = parseChatHistory(orderedRaw)
  return orderChatMessages(dedupeChatMessages(parsed.messages))
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

function hasAssistantAnswerAfterLastUser(messages: ChatMessage[]) {
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf("user")
  return messages.slice(lastUserIndex + 1).some((message) =>
    message.role === "assistant" &&
    Boolean(message.text.trim() || message.reasoningText?.trim())
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
      <span className="thinking-shimmer text-[14px] font-medium leading-relaxed tracking-normal">
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

function messageRowKey(message: ChatMessage): string {
  if (message.role === "assistant" && message.runId?.trim()) {
    return `assistant-run:${message.runId.trim()}`
  }
  return `${message.gatewayIndex ?? "no-seq"}:${message.messageId}`
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
  initialMessages,
  onFirstMessageSent,
  onSelectTool,
  onForkNavigate,
  activeSubagentKey,
  onSubagentOpen,
  isBackgroundSession = false,
}: Props) {
  // ---- new-session bootstrap detection --------------------------------------
  // When AppPage creates a brand-new chat and mounts ChatView, it hands us an
  // `initialMessages` array containing exactly one optimistic user bubble
  // (the message the user just typed) AND that bubble's `messageId` is the
  // `clientMessageId` that was sent to the gateway, so the first server-side
  // patch will rewrite this optimistic in place via applyChatPatch's
  // optimisticId path.
  //
  // Pre-fix behavior on that path:
  //   1. mount with loading:true → <ChatLoadingSkeleton/> (full-screen blink)
  //   2. fetchChatMessagesV2 resolves empty → loading:false, messages:[] →
  //      AnimatedGreeting (empty-state blink)
  //   3. SSE patch lands → user bubble appears
  //   4. streamStatus flips to thinking → thinking state appears
  //
  // Post-fix behavior:
  //   1. mount with loading:false, messages=[optimistic user],
  //      streamStatus:"thinking" → user bubble + thinking visible in the SAME
  //      paint. No skeleton, no greeting, no transitional empty frame.
  //   2. SSE patch lands → optimistic upgraded in place to confirmed user.
  const hasOptimisticBootstrap = useMemo(
    () => Boolean(initialMessages?.some((m) => m.isOptimistic && m.role === "user")),
    // We only want to consider the initialMessages we were mounted with —
    // later mutations of that prop (e.g., parent setting to undefined) must
    // not retroactively flip the bootstrap mode. The parent already remounts
    // us via key={chatId:sessionKey}, so this captured-at-mount value is
    // stable for the lifetime of this ChatView instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  // Snapshot the initial messages once so a later parent-side
  // setInitialMessages(undefined) doesn't strip the bubble out from under us.
  const initialMessagesSnapshotRef = useRef<ChatMessage[] | undefined>(
    hasOptimisticBootstrap ? initialMessages : undefined
  )

  // Hydrate from the active-run registry on mount. If we have a snapshot for
  // this session (because the user previously started a run here and then
  // switched away while it was still in flight), we want to render that
  // snapshot IMMEDIATELY instead of flashing the loading skeleton + empty
  // greeting + re-bootstrap sequence. The registry survives session-switch
  // unmounts because ChatView is keyed on chatId:sessionKey in AppPage, so a
  // remount on the same session can pick up exactly where the previous mount
  // left off.
  const hydrateFromRegistry = useMemo(
    () =>
      !hasOptimisticBootstrap && !isBackgroundSession
        ? activeRunRegistry.get(sessionKey)
        : null,
    // Capture-at-mount: the rest of this component's lifecycle handles
    // updates by subscribing below; we only want the initial hydration
    // decision to consider the snapshot present at first paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const [state, setState] = useState<HistoryState>(() => {
    if (hasOptimisticBootstrap) {
      return {
        loading: false,
        error: null,
        composerError: null,
        messages: initialMessages ?? [],
        streamStatus: "thinking",
        statusLabel: "Thinking",
      }
    }
    if (hydrateFromRegistry) {
      frontendLog(
        "chat",
        "chat-rebuild.runs.reattach",
        {
          sessionKey,
          streamStatus: hydrateFromRegistry.streamStatus,
          messageCount: hydrateFromRegistry.messages.length,
          isGenerating: hydrateFromRegistry.isGenerating,
        },
        "debug"
      )
      return {
        loading: false,
        error: null,
        composerError: null,
        messages: hydrateFromRegistry.messages,
        streamStatus: hydrateFromRegistry.streamStatus,
        statusLabel: hydrateFromRegistry.statusLabel,
      }
    }
    return {
      loading: true,
      error: null,
      composerError: null,
      messages: [],
      streamStatus: "idle",
      statusLabel: null,
    }
  })
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
  const [windowState, setWindowState] = useState<WindowState>(INITIAL_WINDOW_STATE)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  // Local sub-agent take-over state. When non-null, the chat surface renders
  // <SubagentFullChat/> instead of the normal message stream. Parent is
  // notified via onSubagentOpen so the inspector / agent breadcrumb stays in
  // sync, but the source of truth for which subagent is visible lives here.
  const [activeSubagent, setActiveSubagent] = useState<SpawnedSubagent | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollContentRef = useRef<HTMLDivElement | null>(null)
  const cursorRef = useRef(0)
  const shouldFollowScrollRef = useRef(true)
  const contextFetchSeqRef = useRef(0)
  const wasGeneratingRef = useRef(false)
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinButtonRef = useRef<HTMLButtonElement>(null)
  const pendingScrollAnchorRef = useRef<{
    anchorMessageId: string
    anchorOffsetFromContainerTop: number
  } | null>(null)
  const olderFetchSeqRef = useRef(0)
  const newerFetchSeqRef = useRef(0)
  // Time-based refractory: wall-clock timestamp (ms since epoch) of the last
  // resolved fetch in this direction. Replaces an earlier scrollTop-based
  // refractory which became stale across major buffer mutations (the scrollTop
  // coordinate isn't comparable across prepend+evict cycles). Same purpose:
  // prevent the older/newer alternation loop. Different mechanism: time alone.
  const lastOlderResolvedAtRef = useRef<number>(0)
  const lastNewerResolvedAtRef = useRef<number>(0)
  // Set to true while we are programmatically adjusting scrollTop (anchor
  // restoration). Without this, the synthetic scroll event from setting
  // container.scrollTop would call handleScroll and trigger evaluators in an
  // infinite loop.
  const isProgrammaticScrollRef = useRef(false)
  const windowStateRef = useRef<WindowState>(windowState)
  // Last wall-clock time we ran resetToLiveTail in response to a
  // bootstrap-recovery event. Used to debounce rapid SSE recovery storms
  // that can otherwise create a skeleton/messages blink loop on old sessions
  // whose cursor is far ahead of the gateway's replay window.
  const lastBootstrapRecoveryAtRef = useRef<number>(0)
  // One-shot per session: has the SSE patch stream delivered its first frame?
  // Used by chat-rebuild.send.first-patch-received diagnostics so we measure
  // click → first-frame latency for the new-session send path.
  const firstPatchLoggedRef = useRef<boolean>(false)

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
    olderFetchSeqRef.current = 0
    newerFetchSeqRef.current = 0
    shouldFollowScrollRef.current = true
    pendingScrollAnchorRef.current = null
    lastOlderResolvedAtRef.current = 0
    lastNewerResolvedAtRef.current = 0
    lastBootstrapRecoveryAtRef.current = 0
    firstPatchLoggedRef.current = false
    setReactions({})
    setPinnedIds([])
    setPinnedPanelOpen(false)
    setFlashId(null)
    setReplyTo(null)
    setActivePopoverId(null)
    setComposerSeed(null)
    setSessionUsage(null)
    setActiveSubagent(null)

    // ---- new-session optimistic bootstrap shortcut --------------------------
    // The parent (AppPage.handleQuickSend) just created this session and
    // injected an optimistic user bubble into initialMessages. Skip the
    // history fetch entirely (the gateway has no history yet) and open the
    // SSE patch stream immediately at cursor 0. The UI is already in its
    // final "thinking" state from the initial setState above, so this
    // useEffect must NOT re-set state to loading:true — doing so would
    // flash the ChatLoadingSkeleton over the optimistic bubble.
    if (hasOptimisticBootstrap) {
      const seededMessages = initialMessagesSnapshotRef.current ?? []
      const lastSeeded = seededMessages[seededMessages.length - 1]
      const seededNewestSeq =
        lastSeeded && typeof lastSeeded.gatewayIndex === "number"
          ? lastSeeded.gatewayIndex
          : null
      // No messages have been confirmed by the gateway yet — use an empty
      // initial page so older/newer evaluators don't try to fetch.
      setWindowState(
        applyInitialPage({
          returnedCount: 0,
          oldestSeq: null,
          newestSeq: seededNewestSeq,
          requestedLimit: liveTailQuery().limit,
        })
      )
      cursorRef.current = 0
      setStreamCursor(0)
      frontendLog(
        "chat",
        "chat-rebuild.send.optimistic-render",
        {
          origin: "chatview-optimistic-bootstrap",
          timestamp: Date.now(),
          sessionKey,
          seededCount: seededMessages.length,
        },
        "info"
      )
      return () => {
        cancelled = true
      }
    }

    // ---- registry-hydration shortcut ----------------------------------------
    // If a previous mount of this same session was streaming when the user
    // switched away, the activeRunRegistry still has its snapshot. Pick up
    // exactly where it left off: messages + cursor + status come straight
    // from the snapshot, so the user sees the still-streaming bubble + the
    // thinking/tool-running state with no skeleton, no greeting, no refetch.
    if (hydrateFromRegistry) {
      const seededMessages = hydrateFromRegistry.messages
      const firstMessage = seededMessages[0]
      const lastMessage = seededMessages[seededMessages.length - 1]
      const oldestSeq =
        firstMessage && typeof firstMessage.gatewayIndex === "number"
          ? firstMessage.gatewayIndex
          : null
      const newestSeq =
        lastMessage && typeof lastMessage.gatewayIndex === "number"
          ? lastMessage.gatewayIndex
          : null
      const initialQuery = liveTailQuery()
      setWindowState(
        applyInitialPage({
          returnedCount: seededMessages.length,
          oldestSeq,
          newestSeq,
          requestedLimit: initialQuery.limit,
        })
      )
      const reattachCursor = hydrateFromRegistry.streamCursor ?? 0
      cursorRef.current = reattachCursor
      setStreamCursor(reattachCursor)

      // Backfill safety net: even though hydrateFromRegistry skipped the
      // history fetch for fast-paint, fire a background fetch to catch any
      // messages the registry might have missed while ChatView was unmounted.
      // This covers cases where runWatcher's applyChatPatch silently dropped
      // a patch (malformed payload caught by try/catch), the global stream
      // briefly disconnected and missed patches, or terminal-state messages
      // arrived in a sequence that confused the cursor-forward guard.
      // The reconcile happens via the same setState pattern history fetch
      // uses elsewhere; if the result is identical to current messages, the
      // setState is a no-op render.
      const reconcileQuery = liveTailQuery()
      fetchChatMessagesV2({
        sessionKey,
        beforeSeq: reconcileQuery.beforeSeq,
        limit: reconcileQuery.limit,
      })
        .then((history) => {
          if (cancelled) return
          if (history.sessionKey && history.sessionKey !== sessionKey) return
          const freshMessages = normalizeHistory(
            history.messages.map((message) => message.data),
          )
          const freshCursor =
            typeof history.cursor === "number" ? history.cursor : 0
          frontendLog(
            "chat",
            "chat-rebuild.runs.reattach.reconcile",
            {
              sessionKey,
              registryCount: seededMessages.length,
              freshCount: freshMessages.length,
              registryCursor: reattachCursor,
              freshCursor,
            },
            "debug",
          )
          // If the fresh history is strictly newer (cursor advanced) OR has
          // more messages, swap to it. Otherwise keep the optimistic
          // registry snapshot to avoid flicker.
          if (
            freshCursor > reattachCursor ||
            freshMessages.length > seededMessages.length
          ) {
            cursorRef.current = Math.max(cursorRef.current, freshCursor)
            setStreamCursor((current) =>
              current !== null && current >= freshCursor ? current : freshCursor,
            )
            // If fresh history ends with an assistant message that has
            // actual content (text or completed tool calls), the run is
            // over — force streamStatus to idle to clear stuck thinking
            // indicator. runWatcher should've done this via terminal
            // statusFromPatch, but if that signal was lost we recover here.
            const lastFreshMessage = freshMessages[freshMessages.length - 1]
            const runLooksComplete =
              lastFreshMessage?.role === "assistant" &&
              Boolean(
                lastFreshMessage.text.trim() ||
                  lastFreshMessage.toolCalls?.some(
                    (t) => t.status === "success" || t.status === "error",
                  ),
              )
            setState((current) => ({
              ...current,
              messages: orderChatMessages(freshMessages),
              streamStatus: runLooksComplete ? "idle" : current.streamStatus,
              statusLabel: runLooksComplete ? null : current.statusLabel,
            }))
            const freshFirst = freshMessages[0]
            const freshLast = freshMessages[freshMessages.length - 1]
            setWindowState(
              applyInitialPage({
                returnedCount: freshMessages.length,
                oldestSeq:
                  freshFirst && typeof freshFirst.gatewayIndex === "number"
                    ? freshFirst.gatewayIndex
                    : null,
                newestSeq:
                  freshLast && typeof freshLast.gatewayIndex === "number"
                    ? freshLast.gatewayIndex
                    : null,
                requestedLimit: reconcileQuery.limit,
              }),
            )
          }
        })
        .catch((error) => {
          frontendLog(
            "chat",
            "chat-rebuild.runs.reattach.reconcile-error",
            {
              sessionKey,
              error: error instanceof Error ? error.message : String(error),
            },
            "warn",
          )
        })

      return () => {
        cancelled = true
      }
    }

    setStreamCursor(null)
    setWindowState(INITIAL_WINDOW_STATE)
    setState({
      loading: true,
      error: null,
      composerError: null,
      messages: [],
      streamStatus: "idle",
      statusLabel: null,
    })

    const initialQuery = liveTailQuery()
    fetchChatMessagesV2({
      sessionKey,
      beforeSeq: initialQuery.beforeSeq,
      limit: initialQuery.limit,
    })
      .then((history) => {
        if (cancelled) return
        if (history.sessionKey && history.sessionKey !== sessionKey) return
        const messages = normalizeHistory(
          history.messages.map((message) => message.data)
        )
        const cursor = typeof history.cursor === "number" ? history.cursor : 0
        cursorRef.current = cursor
        setStreamCursor(cursor)
        const firstMessage = messages[0]
        const lastMessage = messages[messages.length - 1]
        const oldestSeq =
          firstMessage && typeof firstMessage.gatewayIndex === "number"
            ? firstMessage.gatewayIndex
            : null
        const newestSeq =
          lastMessage && typeof lastMessage.gatewayIndex === "number"
            ? lastMessage.gatewayIndex
            : null
        setWindowState(
          applyInitialPage({
            returnedCount: history.messageCount ?? history.messages.length,
            oldestSeq,
            newestSeq,
            requestedLimit: initialQuery.limit,
          })
        )
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
        setWindowState(INITIAL_WINDOW_STATE)
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
    // hasOptimisticBootstrap is captured by closure and is stable for the
    // lifetime of this mount (set once from initialMessages; parent remounts
    // ChatView per session via key={chatId:sessionKey}). Including it in deps
    // would re-run the bootstrap effect if the parent later cleared
    // initialMessages, which would wipe our optimistic bubble.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBackgroundSession, sessionKey])

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    }
  }, [])

  // ---- activeRunRegistry sync ------------------------------------------------
  // Mirror our local state into the registry on every meaningful change. The
  // registry is what the sidebar reads for the per-session loader, and what a
  // future remount of THIS session reads to skip the loading skeleton.
  //
  // We deliberately DO NOT clear the entry on unmount: when the user switches
  // away mid-run, we want the entry to persist so:
  //   1. The sidebar keeps showing the loader for this session.
  //   2. The remount on return rehydrates without re-fetching history.
  //
  // Background-session ChatViews (e.g. the sub-agent overlay mode) don't own
  // the run state for their own sessionKey and so don't publish here.
  useEffect(() => {
    if (isBackgroundSession) return
    if (state.loading) return
    activeRunRegistry.publish(sessionKey, {
      messages: state.messages,
      streamStatus: state.streamStatus,
      statusLabel: state.statusLabel,
      streamCursor,
      sending,
    })
  }, [
    isBackgroundSession,
    sessionKey,
    sending,
    state.loading,
    state.messages,
    state.statusLabel,
    state.streamStatus,
    streamCursor,
  ])

  useEffect(() => {
    windowStateRef.current = windowState
  }, [windowState])

  const stateLoadingRef = useRef<boolean>(true)
  const stateMessagesRef = useRef<ChatMessage[]>([])
  const stateStreamStatusRef = useRef<StreamStatus>("idle")
  useEffect(() => {
    stateLoadingRef.current = state.loading
    stateMessagesRef.current = state.messages
    stateStreamStatusRef.current = state.streamStatus
  }, [state.loading, state.messages, state.streamStatus])

  useEffect(() => {
    if (isBackgroundSession || streamCursor === null) return
    return openPatchStreamV2(streamCursor, (frame) => {
      if (frame.type !== "patch") return
      if (!patchBelongsToSession(frame, sessionKey)) return
      const previousCursor = cursorRef.current
      if (frame.patch.cursor <= previousCursor) return
      cursorRef.current = Math.max(cursorRef.current, frame.patch.cursor)
      if (!firstPatchLoggedRef.current) {
        firstPatchLoggedRef.current = true
        frontendLog(
          "chat",
          "chat-rebuild.send.first-patch-received",
          {
            sessionKey,
            timestamp: Date.now(),
            cursor: frame.patch.cursor,
            patchType: frame.patch.type,
          },
          "debug"
        )
      }
      if (
        shouldDropPatchAsEvicted({
          patchSessionCursor: frame.patch.cursor,
          newestLoadedSeq: windowStateRef.current.newestLoadedSeq,
          hasNewer: windowStateRef.current.hasNewer,
        })
      ) {
        // Cursor advance still happens above; we just don't apply the patch visually.
        frontendLog(
          "chat",
          "chat-rebuild.window.patch-dropped-evicted",
          {
            sessionKey,
            patchCursor: frame.patch.cursor,
            newestLoadedSeq: windowStateRef.current.newestLoadedSeq,
          },
          "debug"
        )
        return
      }
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
        const nextStatusLabel = patchStatus?.label ?? current.statusLabel

        // Detect if a NEW message was appended (length grew at the tail).
        const previousLength = current.messages.length
        const appendedAtTail = orderedMessages.length > previousLength

        if (appendedAtTail && orderedMessages.length > MAX_LOADED) {
          if (canEvictFromStartOnLiveAppend(windowStateRef.current)) {
            const evict = orderedMessages.length - MAX_LOADED
            const finalMessages = orderedMessages.slice(evict)
            const newOldest = finalMessages[0]
            const newNewest = finalMessages[finalMessages.length - 1]
            const appendedNewestSeq =
              newNewest && typeof newNewest.gatewayIndex === "number"
                ? newNewest.gatewayIndex
                : null
            const evictedOldestSeq =
              newOldest && typeof newOldest.gatewayIndex === "number"
                ? newOldest.gatewayIndex
                : null
            setWindowState((s) =>
              applyLiveAppend({
                prevState: s,
                prevLoadedLength: previousLength,
                appendedNewestSeq,
                evictedFromStart: evict,
                evictedOldestSeq,
              })
            )
            frontendLog(
              "chat",
              "chat-rebuild.window.live-append-evicted",
              { sessionKey, evicted: evict, finalLength: finalMessages.length },
              "debug"
            )
            return {
              ...current,
              loading: false,
              error: null,
              messages: finalMessages,
              streamStatus: nextStatus,
              statusLabel: nextStatusLabel,
            }
          }
          // Cannot safely evict: hasOlder is false, so evicting from start would
          // destroy unrecoverable history. Allow the array to temporarily exceed
          // MAX_LOADED. Still update newestLoadedSeq.
          const newNewest = orderedMessages[orderedMessages.length - 1]
          const appendedNewestSeq =
            newNewest && typeof newNewest.gatewayIndex === "number"
              ? newNewest.gatewayIndex
              : null
          setWindowState((s) =>
            applyLiveAppend({
              prevState: s,
              prevLoadedLength: previousLength,
              appendedNewestSeq,
              evictedFromStart: 0,
              evictedOldestSeq: null,
            })
          )
          frontendLog(
            "chat",
            "chat-rebuild.window.live-append-no-evict",
            { sessionKey, length: orderedMessages.length, reason: "hasOlder=false" },
            "warn"
          )
          return {
            ...current,
            loading: false,
            error: null,
            messages: orderedMessages,
            streamStatus: nextStatus,
            statusLabel: nextStatusLabel,
          }
        }

        if (appendedAtTail) {
          // Length still ≤ MAX_LOADED, just update newestLoadedSeq.
          const newNewest = orderedMessages[orderedMessages.length - 1]
          const appendedNewestSeq =
            newNewest && typeof newNewest.gatewayIndex === "number"
              ? newNewest.gatewayIndex
              : null
          setWindowState((s) =>
            applyLiveAppend({
              prevState: s,
              prevLoadedLength: previousLength,
              appendedNewestSeq,
              evictedFromStart: 0,
              evictedOldestSeq: null,
            })
          )
        }

        return {
          ...current,
          loading: false,
          error: null,
          messages: orderedMessages,
          streamStatus: nextStatus,
          statusLabel: nextStatusLabel,
        }
      })
    })
  }, [isBackgroundSession, sessionKey, streamCursor])

  async function handleSend(payload: ChatComposerSubmit) {
    const text = payload.text.trim()
    if (!text && !payload.attachments?.length) return

    const clickAt = Date.now()
    const hasExistingMessages = state.messages.length > 0
    frontendLog("chat", "chat-rebuild.send.click", {
      origin: "chatview-handle-send",
      timestamp: clickAt,
      sessionKey,
      hasExistingMessages,
      textLength: text.length,
      attachmentCount: payload.attachments?.length ?? 0,
    })

    if (windowStateRef.current.hasNewer) {
      await resetToLiveTail()
    }

    const optimisticId = randomId()
    const replyTo = payload.replyTo ?? undefined
    const replySnippet = replyTo
      ? replyTo.text.slice(0, 150) + (replyTo.text.length > 150 ? "…" : "")
      : undefined
    const gatewayText = replySnippet
      ? `> ${replySnippet.split("\n").join("\n> ")}\n\n${text}`
      : text
    shouldFollowScrollRef.current = true
    const optimisticMessage: ChatMessage = {
      messageId: optimisticId,
      role: "user",
      text,
      createdAt: new Date().toISOString(),
      isOptimistic: true,
      sendStatus: "sending",
      replyTo,
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
    frontendLog("chat", "chat-rebuild.send.optimistic-render", {
      origin: "chatview-handle-send",
      timestamp: Date.now(),
      msSinceClick: Date.now() - clickAt,
      sessionKey,
      optimisticId,
    })
    onFirstMessageSent?.(text)
    setReplyTo(null)
    setComposerSeed(null)

    try {
      frontendLog("chat", "chat-rebuild.send.request-fired", {
        origin: "chatview-handle-send",
        timestamp: Date.now(),
        msSinceClick: Date.now() - clickAt,
        sessionKey,
        optimisticId,
      })
      await sendChatV2({
        sessionKey,
        text: gatewayText,
        attachments: payload.attachments,
        idempotencyKey: chatSendIdempotencyKey(sessionKey, optimisticId),
        clientMessageId: optimisticId,
        replyTo: replyTo
          ? {
              messageId: replyTo.messageId,
              snippet: replySnippet!,
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
    () => orderChatMessages(dedupeChatMessages(state.messages)),
    [state.messages]
  )

  // Sub-agents derived from the message stream. Live updates flow naturally
  // as sessions_spawn tool patches mutate tool.status / tool.resultText on the
  // underlying messages via applyChatPatch.
  const spawnedSubagents = useMemo(
    () => deriveSpawnedSubagents(renderedMessages),
    [renderedMessages]
  )

  // Anchor each spawn to the triggering user message (or orphan-anchor it to
  // the assistant message that hosted the sessions_spawn tool call when there's
  // no preceding user). SubagentCards render INLINE at these anchors so a
  // spawn shows up exactly where it happened in the chat — immediately and
  // visibly tied to the user message that triggered it.
  const subagentAnchors = useMemo(
    () =>
      buildSubagentAnchorMaps(
        renderedMessages,
        indexSpawnsByToolCallId(spawnedSubagents),
      ),
    [renderedMessages, spawnedSubagents],
  )

  useEffect(() => {
    frontendLog(
      "chat",
      "chat-rebuild.subagent.derived",
      {
        sessionKey,
        count: spawnedSubagents.length,
        sessionKeys: spawnedSubagents.map((s) => s.sessionKey).filter(Boolean),
      },
      "debug"
    )
  }, [sessionKey, spawnedSubagents])

  const openSubagent = useCallback(
    (sub: SpawnedSubagent) => {
      // Defensive: SubagentBar disables the open button until sessionKey
      // arrives, but guard here too so we never set activeSubagent to a
      // value that the overlay condition would reject (leaving us with a
      // ghost-selected entry that does nothing visible).
      if (!sub.sessionKey) {
        frontendLog(
          "chat",
          "chat-rebuild.subagent.open-skipped",
          { sessionKey, subagentId: sub.id, reason: "no-sessionKey" },
          "warn"
        )
        return
      }
      setActiveSubagent(sub)
      onSubagentOpen?.(sub.sessionKey, sub.id)
      frontendLog(
        "chat",
        "chat-rebuild.subagent.open",
        {
          sessionKey,
          subagentSessionKey: sub.sessionKey,
          subagentId: sub.id,
          toolCallId: sub.toolCallId,
          status: sub.status,
        },
        "info"
      )
    },
    [onSubagentOpen, sessionKey]
  )

  const closeSubagent = useCallback(() => {
    setActiveSubagent(null)
    onSubagentOpen?.(null, null)
    frontendLog(
      "chat",
      "chat-rebuild.subagent.close",
      { sessionKey },
      "info"
    )
  }, [onSubagentOpen, sessionKey])

  // Sync to parent-driven activeSubagentKey (e.g. inspector panel) — find
  // matching spawn and open it.
  useEffect(() => {
    if (!activeSubagentKey) {
      if (activeSubagent !== null) setActiveSubagent(null)
      return
    }
    if (activeSubagent?.sessionKey === activeSubagentKey) return
    const match = spawnedSubagents.find((s) => s.sessionKey === activeSubagentKey)
    if (match) setActiveSubagent(match)
  }, [activeSubagentKey, activeSubagent, spawnedSubagents])

  // Keep activeSubagent freshly synced with derived list so status changes
  // (spawning -> working -> completed) flow through to the overlay header.
  // Match by sessionKey (stable across status changes); fall back to id.
  useEffect(() => {
    if (!activeSubagent) return
    const fresh = spawnedSubagents.find(
      (s) =>
        (activeSubagent.sessionKey && s.sessionKey === activeSubagent.sessionKey) ||
        s.id === activeSubagent.id
    )
    if (fresh && fresh !== activeSubagent) {
      setActiveSubagent(fresh)
    }
  }, [spawnedSubagents, activeSubagent])
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

  // Safety-net: clear stranded animateText flags so action buttons always
  // appear after a response completes.
  //
  // Bug repro: occasionally after a response finishes, the assistant message
  // bubble's action buttons (copy, retry, react, etc.) stay hidden. Root
  // cause: action visibility is gated by `animateAssistantText`, which is
  // true while EITHER (a) this is the last message + isGenerating, OR
  // (b) message.animateText === true. The flag is set by applyChatPatch on
  // delta patches and is only cleared when MessageBubble's MarkdownContent
  // fires `onRevealComplete`. Multiple races prevent that callback firing:
  //   * useStreamingText's reduce-motion early return commits state without
  //     calling completeRef.current.
  //   * Target text replacement (!startsWith branch) with canAnimate=false
  //     runs no animation and never calls back.
  //   * Message replaced by a later patch / dedupe before reveal finishes.
  //   * Hydration from activeRunRegistry of a snapshot carrying animateText.
  //   * Session switch unmount mid-animation.
  // The fix is a state-derived guarantee, not a callback dependency: once
  // a message is no longer the last assistant AND we're not generating,
  // the flag MUST be false. Same applies to the very last message after
  // generation completes (which is the common case Krish reported).
  useEffect(() => {
    if (isGenerating) return
    let needsUpdate = false
    for (const message of state.messages) {
      if (message.animateText === true) {
        needsUpdate = true
        break
      }
    }
    if (!needsUpdate) return
    frontendLog(
      "chat",
      "chat-rebuild.animate-text.safety-clear",
      {
        sessionKey,
        clearedCount: state.messages.filter((m) => m.animateText === true).length,
      },
      "debug",
    )
    setState((current) => {
      let mutated = false
      const nextMessages = current.messages.map((message) => {
        if (message.animateText !== true) return message
        mutated = true
        return { ...message, animateText: false }
      })
      if (!mutated) return current
      return { ...current, messages: nextMessages }
    })
  }, [isGenerating, state.messages, sessionKey])

  const liveTool = isGenerating ? liveRunningTool(renderedMessages) : null
  const statusText = isGenerating
    ? generatingStatusText(state.streamStatus, state.statusLabel, liveTool)
    : null
  const showThinkingState = isGenerating && !hasAssistantAnswerAfterLastUser(renderedMessages)
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

  const measureRowsAboveViewport = useCallback((): number => {
    const container = scrollContainerRef.current
    if (!container) return Number.POSITIVE_INFINITY
    const containerTop = container.getBoundingClientRect().top
    const rows = container.querySelectorAll<HTMLElement>('[data-chat-message-row="true"]')
    let count = 0
    for (let i = 0; i < rows.length; i += 1) {
      const rect = rows[i].getBoundingClientRect()
      // If the row's bottom is above the container's visible top edge, it's "above viewport".
      if (rect.bottom <= containerTop) {
        count += 1
      } else {
        break // rows are in DOM order; first non-above means we're done
      }
    }
    return count
  }, [])

  const measureRowsBelowViewport = useCallback((): number => {
    const container = scrollContainerRef.current
    if (!container) return Number.POSITIVE_INFINITY
    const containerBottom = container.getBoundingClientRect().bottom
    const rows = container.querySelectorAll<HTMLElement>('[data-chat-message-row="true"]')
    let count = 0
    // Walk from the end backward; first row whose top is at/above containerBottom marks the break.
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const rect = rows[i].getBoundingClientRect()
      if (rect.top >= containerBottom) {
        count += 1
      } else {
        break
      }
    }
    return count
  }, [])

  const captureFirstVisibleRowAnchor = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) {
      pendingScrollAnchorRef.current = null
      return
    }
    const containerTop = container.getBoundingClientRect().top
    const rows = container.querySelectorAll<HTMLElement>('[data-chat-message-row="true"]')
    let anchorRow: HTMLElement | null = null
    for (let i = 0; i < rows.length; i += 1) {
      const rect = rows[i].getBoundingClientRect()
      if (rect.bottom > containerTop) {
        anchorRow = rows[i]
        break
      }
    }
    const anchorMessageId = anchorRow?.getAttribute('data-message-id') ?? null
    if (!anchorMessageId) {
      pendingScrollAnchorRef.current = null
      return
    }
    pendingScrollAnchorRef.current = {
      anchorMessageId,
      anchorOffsetFromContainerTop:
        anchorRow!.getBoundingClientRect().top - containerTop,
    }
  }, [])

  const fetchOlderPage = useCallback(async () => {
    const oldestSeq = windowState.oldestLoadedSeq
    if (oldestSeq === null) return
    if (windowState.isLoadingOlder) return
    if (!windowState.hasOlder) return

    // Capture anchor BEFORE we mark loading or fetch.
    captureFirstVisibleRowAnchor()

    const seq = ++olderFetchSeqRef.current
    frontendLog(
      "chat",
      "chat-rebuild.window.older-fetch-start",
      { sessionKey, oldestSeq, limit: OLDER_PAGE, seq },
      "debug"
    )
    setWindowState((s) => ({ ...s, isLoadingOlder: true }))

    try {
      const response = await fetchChatMessagesV2({
        sessionKey,
        beforeSeq: oldestSeq,
        limit: OLDER_PAGE,
      })
      if (seq !== olderFetchSeqRef.current) return // stale
      if (response.sessionKey && response.sessionKey !== sessionKey) return

      const olderMessages = normalizeHistory(
        response.messages.map((m) => m.data)
      )
      if (olderMessages.length === 0) {
        setWindowState((s) =>
          applyOlderPage({
            prevState: s,
            returnedCount: 0,
            newOldestSeq: s.oldestLoadedSeq,
            prevLoadedLength: 0,
            evictedFromEnd: 0,
            evictedNewestSeq: null,
            requestedLimit: OLDER_PAGE,
          })
        )
        pendingScrollAnchorRef.current = null
        // Pin refractory anchor even on empty resolve.
        lastOlderResolvedAtRef.current = Date.now()
        frontendLog(
          "chat",
          "chat-rebuild.window.older-fetch-resolved",
          { sessionKey, oldestSeq, returnedCount: 0, evictedFromEnd: 0 },
          "debug"
        )
        return
      }

      setState((current) => {
        const combined = [...olderMessages, ...current.messages]
        const evictedFromEnd = computeEvictedAfterPrepend(
          current.messages.length,
          olderMessages.length,
          MAX_LOADED
        )
        const finalMessages =
          evictedFromEnd > 0
            ? combined.slice(0, combined.length - evictedFromEnd)
            : combined
        const newOldest = finalMessages[0]
        const newNewest = finalMessages[finalMessages.length - 1]
        const newOldestSeq =
          newOldest && typeof newOldest.gatewayIndex === "number"
            ? newOldest.gatewayIndex
            : null
        const evictedNewestSeq =
          evictedFromEnd > 0 && newNewest && typeof newNewest.gatewayIndex === "number"
            ? newNewest.gatewayIndex
            : null

        setWindowState((s) =>
          applyOlderPage({
            prevState: s,
            returnedCount: response.messageCount ?? response.messages.length,
            newOldestSeq,
            prevLoadedLength: current.messages.length,
            evictedFromEnd,
            evictedNewestSeq,
            requestedLimit: OLDER_PAGE,
          })
        )

        frontendLog(
          "chat",
          "chat-rebuild.window.older-fetch-resolved",
          {
            sessionKey,
            oldestSeq,
            returnedCount: response.messageCount ?? response.messages.length,
            evictedFromEnd,
            prevLoadedLength: current.messages.length,
            finalLength: finalMessages.length,
          },
          "debug"
        )

        return { ...current, messages: finalMessages }
      })
      // Time-based refractory: no further older fetch may fire for
      // REFRACTORY_MS milliseconds. Survives buffer mutations (scrollTop
      // anchors don't).
      lastOlderResolvedAtRef.current = Date.now()
    } catch (err) {
      if (seq !== olderFetchSeqRef.current) return
      setWindowState((s) => ({ ...s, isLoadingOlder: false }))
      pendingScrollAnchorRef.current = null
      frontendLog(
        "chat",
        "chat-rebuild.window.older-fetch-failed",
        {
          sessionKey,
          oldestSeq,
          errorKind: err instanceof Error ? err.name : typeof err,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        "warn"
      )
    }
  }, [sessionKey, windowState.hasOlder, windowState.isLoadingOlder, windowState.oldestLoadedSeq, captureFirstVisibleRowAnchor])

  const evaluateOlderTrigger = useCallback(() => {
    if (state.loading) return
    if (windowState.isLoadingOlder) return
    if (!windowState.hasOlder) return
    // Time-based refractory: REFRACTORY_MS must elapse since the previous
    // older fetch resolved. Prevents alternation loop with newer (whose
    // eviction-from-end can flip rowsAbove below threshold) and prevents
    // rapid re-fire during fast scroll bursts.
    const elapsedSinceOlder = Date.now() - lastOlderResolvedAtRef.current
    if (elapsedSinceOlder < REFRACTORY_MS) {
      frontendLog("chat", "chat-rebuild.window.older-trigger-skip", { sessionKey, reason: "refractory", elapsedMs: elapsedSinceOlder, refractoryMs: REFRACTORY_MS }, "debug")
      return
    }
    const rowsAboveViewport = measureRowsAboveViewport()
    if (
      !shouldFetchOlder({
        rowsAboveViewport,
        hasOlder: windowState.hasOlder,
        isLoadingOlder: windowState.isLoadingOlder,
      })
    ) {
      return
    }
    frontendLog(
      "chat",
      "chat-rebuild.window.older-trigger-fired",
      { sessionKey, rowsAboveViewport },
      "debug"
    )
    void fetchOlderPage()
  }, [
    state.loading,
    windowState.hasOlder,
    windowState.isLoadingOlder,
    measureRowsAboveViewport,
    fetchOlderPage,
    sessionKey,
  ])

  const fetchNewerPage = useCallback(async () => {
    const newestSeq = windowState.newestLoadedSeq
    if (newestSeq === null) return
    if (windowState.isLoadingNewer) return
    if (!windowState.hasNewer) return

    // Capture anchor BEFORE we mark loading or fetch (mirrors older-page path).
    captureFirstVisibleRowAnchor()

    const seq = ++newerFetchSeqRef.current
    frontendLog(
      "chat",
      "chat-rebuild.window.newer-fetch-start",
      { sessionKey, newestSeq, limit: OLDER_PAGE, seq },
      "debug"
    )
    setWindowState((s) => ({ ...s, isLoadingNewer: true }))

    try {
      const response = await fetchChatMessagesV2({
        sessionKey,
        afterSeq: newestSeq,
        limit: OLDER_PAGE,
      })
      if (seq !== newerFetchSeqRef.current) return // stale
      if (response.sessionKey && response.sessionKey !== sessionKey) return

      const newerMessages = normalizeHistory(
        response.messages.map((m) => m.data)
      )
      if (newerMessages.length === 0) {
        setWindowState((s) =>
          applyNewerPage({
            prevState: s,
            returnedCount: 0,
            newNewestSeq: s.newestLoadedSeq,
            evictedFromStart: 0,
            evictedOldestSeq: null,
            requestedLimit: OLDER_PAGE,
          })
        )
        pendingScrollAnchorRef.current = null
        lastNewerResolvedAtRef.current = Date.now()
        frontendLog(
          "chat",
          "chat-rebuild.window.newer-fetch-resolved",
          { sessionKey, newestSeq, returnedCount: 0, evictedFromStart: 0 },
          "debug"
        )
        return
      }

      // Decide if this newer fetch reaches the live tail. If the backend
      // returned fewer than the requested limit, we're at the tail and it's
      // safe to evict from the start (user is or will soon be at the bottom
      // of the document; the trim is invisible). Otherwise DO NOT evict —
      // let the buffer grow temporarily past MAX_LOADED during active
      // scroll-down. Evicting from the start mid-scroll shrinks the document
      // above the user, forcing the scroll anchor to yank scrollTop backward
      // by the evicted height — the user perceives this as 'breaking' or
      // being thrown back. Quiescent eviction happens once we reach the tail.
      const responseCount = response.messageCount ?? response.messages.length
      const reachedLiveTail = responseCount < OLDER_PAGE

      setState((current) => {
        const combined = [...current.messages, ...newerMessages]
        const evictedFromStart = reachedLiveTail
          ? computeEvictedAfterAppend(
              current.messages.length,
              newerMessages.length,
              MAX_LOADED
            )
          : 0
        const finalMessages =
          evictedFromStart > 0 ? combined.slice(evictedFromStart) : combined
        const newOldest = finalMessages[0]
        const newNewest = finalMessages[finalMessages.length - 1]
        const evictedOldestSeq =
          evictedFromStart > 0 && newOldest && typeof newOldest.gatewayIndex === "number"
            ? newOldest.gatewayIndex
            : null
        const newNewestSeq =
          newNewest && typeof newNewest.gatewayIndex === "number"
            ? newNewest.gatewayIndex
            : null

        setWindowState((s) =>
          applyNewerPage({
            prevState: s,
            returnedCount: responseCount,
            newNewestSeq,
            evictedFromStart,
            evictedOldestSeq,
            requestedLimit: OLDER_PAGE,
          })
        )

        frontendLog(
          "chat",
          "chat-rebuild.window.newer-fetch-resolved",
          {
            sessionKey,
            newestSeq,
            returnedCount: response.messageCount ?? response.messages.length,
            evictedFromStart,
            prevLoadedLength: current.messages.length,
            finalLength: finalMessages.length,
          },
          "debug"
        )

        return { ...current, messages: finalMessages }
      })
      // Time-based refractory.
      lastNewerResolvedAtRef.current = Date.now()
    } catch (err) {
      if (seq !== newerFetchSeqRef.current) return
      setWindowState((s) => ({ ...s, isLoadingNewer: false }))
      pendingScrollAnchorRef.current = null
      frontendLog(
        "chat",
        "chat-rebuild.window.newer-fetch-failed",
        {
          sessionKey,
          newestSeq,
          errorKind: err instanceof Error ? err.name : typeof err,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        "warn"
      )
    }
  }, [sessionKey, windowState.hasNewer, windowState.isLoadingNewer, windowState.newestLoadedSeq, captureFirstVisibleRowAnchor])

  const resetToLiveTail = useCallback(async (): Promise<void> => {
    setShowJumpToLatest(false)
    cursorRef.current = 0
    olderFetchSeqRef.current = 0
    newerFetchSeqRef.current = 0
    pendingScrollAnchorRef.current = null
    lastOlderResolvedAtRef.current = 0
    lastNewerResolvedAtRef.current = 0
    shouldFollowScrollRef.current = true
    setStreamCursor(null)
    setReplyTo(null)
    setActivePopoverId(null)
    setComposerSeed(null)
    setWindowState(INITIAL_WINDOW_STATE)
    setState({
      loading: true,
      error: null,
      composerError: null,
      messages: [],
      streamStatus: "idle",
      statusLabel: null,
    })

    const q = liveTailQuery()
    try {
      const history = await fetchChatMessagesV2({
        sessionKey,
        beforeSeq: q.beforeSeq,
        limit: q.limit,
      })
      if (history.sessionKey && history.sessionKey !== sessionKey) return

      const messages = normalizeHistory(history.messages.map((m) => m.data))
      const cursor = typeof history.cursor === "number" ? history.cursor : 0
      cursorRef.current = cursor
      setStreamCursor(cursor)

      const firstMessage = messages[0]
      const lastMessage = messages[messages.length - 1]
      const oldestSeq =
        firstMessage && typeof firstMessage.gatewayIndex === "number"
          ? firstMessage.gatewayIndex
          : null
      const newestSeq =
        lastMessage && typeof lastMessage.gatewayIndex === "number"
          ? lastMessage.gatewayIndex
          : null

      setWindowState(
        applyInitialPage({
          returnedCount: history.messageCount ?? history.messages.length,
          oldestSeq,
          newestSeq,
          requestedLimit: q.limit,
        })
      )
      setState({
        loading: false,
        error: null,
        composerError: null,
        messages,
        streamStatus: "idle",
        statusLabel: null,
      })
      frontendLog(
        "chat",
        "chat-rebuild.window.reset-to-live-tail",
        { sessionKey, messageCount: messages.length },
        "debug"
      )
    } catch (err) {
      setWindowState(INITIAL_WINDOW_STATE)
      setState({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        composerError: null,
        messages: [],
        streamStatus: "error",
        statusLabel: null,
      })
      frontendLog(
        "chat",
        "chat-rebuild.window.reset-to-live-tail-failed",
        {
          sessionKey,
          errorKind: err instanceof Error ? err.name : typeof err,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        "warn"
      )
    }
  }, [sessionKey])

  const evaluateNewerTrigger = useCallback(() => {
    if (state.loading) {
      frontendLog("chat", "chat-rebuild.window.newer-trigger-skip", { sessionKey, reason: "state.loading" }, "debug")
      return
    }
    if (windowState.isLoadingNewer) {
      frontendLog("chat", "chat-rebuild.window.newer-trigger-skip", { sessionKey, reason: "isLoadingNewer" }, "debug")
      return
    }
    if (!windowState.hasNewer) {
      frontendLog("chat", "chat-rebuild.window.newer-trigger-skip", { sessionKey, reason: "hasNewer=false", newestLoadedSeq: windowState.newestLoadedSeq }, "debug")
      return
    }
    // Time-based refractory: REFRACTORY_MS must elapse since the previous
    // newer fetch resolved.
    const elapsedSinceNewer = Date.now() - lastNewerResolvedAtRef.current
    if (elapsedSinceNewer < REFRACTORY_MS) {
      frontendLog(
        "chat",
        "chat-rebuild.window.newer-trigger-skip",
        { sessionKey, reason: "refractory", elapsedMs: elapsedSinceNewer, refractoryMs: REFRACTORY_MS },
        "debug"
      )
      return
    }
    const rowsBelowViewport = measureRowsBelowViewport()
    if (
      !shouldFetchNewer({
        rowsBelowViewport,
        hasNewer: windowState.hasNewer,
        isLoadingNewer: windowState.isLoadingNewer,
      })
    ) {
      frontendLog(
        "chat",
        "chat-rebuild.window.newer-trigger-skip",
        { sessionKey, reason: "rowsBelow-over-threshold", rowsBelowViewport, threshold: BOTTOM_TRIGGER },
        "debug"
      )
      return
    }
    frontendLog(
      "chat",
      "chat-rebuild.window.newer-trigger-fired",
      { sessionKey, rowsBelowViewport },
      "debug"
    )
    void fetchNewerPage()
  }, [
    state.loading,
    windowState.hasNewer,
    windowState.isLoadingNewer,
    measureRowsBelowViewport,
    fetchNewerPage,
    sessionKey,
  ])

  // Post-resolution one-shot trigger re-evaluation.
  //
  // The autoload evaluators only run from handleScroll. If the user is
  // already AT the bottom of the buffer (or top) and the boundary just
  // changed because of a fetch resolution — e.g. an older fetch evicted
  // from the end, flipping hasNewer to true while the user is sitting at
  // what is now the new bottom — no scroll event fires and the opposite
  // trigger never gets a chance to evaluate. The user appears stuck:
  // hasNewer=true, rows below viewport=0, but no fetch.
  //
  // This effect keys ONLY on the windowState boundary fields
  // (newest/oldestLoadedSeq, hasNewer, hasOlder). Those fields are mutated
  // exactly once per fetch resolution (and once per live-append in the
  // at-tail case). They do NOT change on every state.messages mutation
  // (live patches mutate state.messages but not windowState seqs unless a
  // live-append actually extends the loaded range). That's the key
  // distinction from the rAF length-change re-evaluator that was removed
  // in commit d89f7db7 — which fired on every live patch and looped.
  //
  // Direction-locked refractory still blocks back-to-back fires in the
  // same direction, so calling both evaluators here can't reintroduce the
  // alternation loop fixed in b012e46f.
  useEffect(() => {
    if (state.loading) return
    evaluateOlderTrigger()
    evaluateNewerTrigger()
  }, [
    windowState.newestLoadedSeq,
    windowState.oldestLoadedSeq,
    windowState.hasNewer,
    windowState.hasOlder,
    state.loading,
    evaluateOlderTrigger,
    evaluateNewerTrigger,
  ])

  useEffect(() => {
    if (isBackgroundSession) return
    // Minimum gap between two consecutive resetToLiveTail() calls triggered by
    // bootstrap-recovery events. Old sessions whose persisted cursor is far
    // ahead of the gateway's replay window can produce repeated
    // replay-window-exceeded `hello` frames on every SSE (re)connect; without
    // this guard the UI runs resetToLiveTail in a loop, producing a constant
    // skeleton ↔ messages blink while older-page fetches also fire because the
    // newly-bootstrapped window puts the user near the top.
    const RECOVERY_DEBOUNCE_MS = 4000
    function handleBootstrapRecovery(event: Event) {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as { sessionKey?: unknown } | undefined
      if (
        detail &&
        typeof detail.sessionKey === "string" &&
        detail.sessionKey !== sessionKey
      ) {
        return
      }
      // If a new-session send is already rendering the optimistic user bubble
      // + Thinking state, a recovery reset would briefly swap the chat surface
      // back to the full loading skeleton and then to a user-only history page.
      // Fresh sessions can legitimately emit bootstrap-recovery before the
      // first assistant frame; keep the optimistic/run state until normal
      // patches or the post-send history reconciliation arrive.
      if (
        activeRunRegistry.isActiveRunStatus(stateStreamStatusRef.current) &&
        stateMessagesRef.current.some((message) => message.role === "user")
      ) {
        frontendLog(
          "chat",
          "chat-rebuild.window.bootstrap-recovery-skipped-active-run",
          { sessionKey, streamStatus: stateStreamStatusRef.current, messageCount: stateMessagesRef.current.length },
          "debug"
        )
        return
      }
      // If a reset is already in flight (state.loading is still true from a
      // prior reset), skip — we'd just thrash the messages array and steal
      // focus. The in-flight reset will resolve and produce a current view.
      if (stateLoadingRef.current) {
        frontendLog(
          "chat",
          "chat-rebuild.window.bootstrap-recovery-skipped-loading",
          { sessionKey },
          "warn"
        )
        return
      }
      // Debounce: ignore recoveries that arrive shortly after the previous one.
      // This is the primary loop-breaker for old sessions in a recovery storm.
      const now = Date.now()
      const elapsed = now - lastBootstrapRecoveryAtRef.current
      if (elapsed < RECOVERY_DEBOUNCE_MS) {
        frontendLog(
          "chat",
          "chat-rebuild.window.bootstrap-recovery-debounced",
          { sessionKey, elapsedMs: elapsed, debounceMs: RECOVERY_DEBOUNCE_MS },
          "warn"
        )
        return
      }
      lastBootstrapRecoveryAtRef.current = now
      frontendLog(
        "chat",
        "chat-rebuild.window.bootstrap-recovery",
        { sessionKey, hasDetail: Boolean(detail) },
        "warn"
      )
      void resetToLiveTail()
    }
    window.addEventListener("openclaw:chat-bootstrap-recovery", handleBootstrapRecovery)
    return () => {
      window.removeEventListener("openclaw:chat-bootstrap-recovery", handleBootstrapRecovery)
    }
  }, [isBackgroundSession, sessionKey, resetToLiveTail])

  const updateJumpToLatestVisibility = useCallback((element = scrollContainerRef.current) => {
    const shouldShow = Boolean(
      !stateLoadingRef.current &&
      stateMessagesRef.current.length > 0 &&
      (windowStateRef.current.hasNewer || (element && !isNearScrollBottom(element, 160)))
    )
    setShowJumpToLatest((current) => current === shouldShow ? current : shouldShow)
  }, [])

  function handleScroll() {
    const element = scrollContainerRef.current
    if (!element) return
    // Ignore the synthetic scroll event that fires when we programmatically
    // adjust container.scrollTop during anchor restoration. Otherwise our own
    // adjustment would re-enter handleScroll and refire the evaluators.
    if (isProgrammaticScrollRef.current) return
    shouldFollowScrollRef.current = isNearScrollBottom(element)
    updateJumpToLatestVisibility(element)
    // Refractory is now direction-locked + scroll-distance-based inside the
    // evaluators themselves — no per-event re-arming here.
    evaluateOlderTrigger()
    evaluateNewerTrigger()
  }

  const handleJumpToLatest = useCallback(() => {
    shouldFollowScrollRef.current = true
    setShowJumpToLatest(false)
    if (windowStateRef.current.hasNewer) {
      void resetToLiveTail()
      return
    }
    const element = scrollContainerRef.current
    if (element) scrollElementToBottom(element, "smooth")
  }, [resetToLiveTail])

  // Unified scroll-anchor restoration for both older-page (prepend+evict-from-end)
  // and newer-page (append+evict-from-start) fetches. We pin the first row that was
  // intersecting the viewport top BEFORE the fetch resolved, then after the new
  // window renders we adjust scrollTop so that same row stays at the same visual
  // offset. Robust to variable row heights and to either eviction direction.
  useLayoutEffect(() => {
    const anchor = pendingScrollAnchorRef.current
    if (!anchor) return
    pendingScrollAnchorRef.current = null
    const container = scrollContainerRef.current
    if (!container) return
    const newRow = container.querySelector<HTMLElement>(
      `[data-chat-message-row="true"][data-message-id="${CSS.escape(anchor.anchorMessageId)}"]`
    )
    if (!newRow) return // anchor row was evicted — leave scrollTop as-is
    const containerTop = container.getBoundingClientRect().top
    const currentOffset = newRow.getBoundingClientRect().top - containerTop
    const adjust = currentOffset - anchor.anchorOffsetFromContainerTop
    if (adjust !== 0) {
      // Guard against the synthetic scroll event re-firing handleScroll →
      // re-arming triggers → re-fetching in an infinite loop. Cleared on the
      // next macrotask after the browser has dispatched the scroll event.
      isProgrammaticScrollRef.current = true
      container.scrollTop += adjust
      setTimeout(() => {
        isProgrammaticScrollRef.current = false
      }, 0)
    }
    // We are anchored at a specific row; the user is not at the live tail by
    // definition. Prevent the follow-bottom effect from snapping us to bottom on
    // the same render pass (scrollFollowKey changes due to messages change).
    shouldFollowScrollRef.current = false
  }, [state.messages])

  useLayoutEffect(() => {
    updateJumpToLatestVisibility()
    if (state.loading) return
    const element = scrollContainerRef.current
    if (!element) return
    if (!shouldFollowScrollRef.current) return
    scrollElementToBottom(element)
  }, [isGenerating, scrollFollowKey, sessionKey, showThinkingState, state.loading, statusText, updateJumpToLatestVisibility, windowState.hasNewer])

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

  // ---- send-cycle diagnostics ------------------------------------------------
  // Fire-once-per-transition logs so Krish can verify at runtime which blink
  // states are still happening on the new-session send path. Keep these AFTER
  // the fix lands — they're cheap and they let us catch regressions.
  const skeletonVisible = state.loading && renderedMessages.length === 0
  const skeletonLoggedRef = useRef(false)
  useEffect(() => {
    if (skeletonVisible && !skeletonLoggedRef.current) {
      skeletonLoggedRef.current = true
      frontendLog(
        "chat",
        "chat-rebuild.send.skeleton-rendered",
        {
          sessionKey,
          timestamp: Date.now(),
          messageCount: state.messages.length,
          renderedCount: renderedMessages.length,
          loading: state.loading,
        },
        "warn"
      )
    } else if (!skeletonVisible && skeletonLoggedRef.current) {
      skeletonLoggedRef.current = false
    }
  }, [skeletonVisible, sessionKey, state.loading, state.messages.length, renderedMessages.length])

  const thinkingLoggedRef = useRef(false)
  useEffect(() => {
    if (showThinkingState && !thinkingLoggedRef.current) {
      thinkingLoggedRef.current = true
      frontendLog(
        "chat",
        "chat-rebuild.send.thinking-visible",
        {
          sessionKey,
          timestamp: Date.now(),
          source: "showThinkingState",
          streamStatus: state.streamStatus,
          messageCount: state.messages.length,
        },
        "debug"
      )
    } else if (!showThinkingState && thinkingLoggedRef.current) {
      thinkingLoggedRef.current = false
    }
  }, [showThinkingState, sessionKey, state.streamStatus, state.messages.length])

  if (isBackgroundSession) {
    return null
  }

  if (state.loading && renderedMessages.length === 0) {
    return <ChatLoadingSkeleton />
  }

  // Subagent take-over: when a spawned sub-agent is opened, render its full
  // chat overlay in place of the parent message stream. Composer + counter
  // chip stay accessible by virtue of being absolutely positioned; the
  // overlay sits below them in the same container.
  if (activeSubagent && activeSubagent.sessionKey) {
    return (
      <div
        className="relative flex h-full w-full flex-col overflow-hidden bg-background"
        data-chat-rebuild-history="true"
        data-session-key={sessionKey}
        data-subagent-active={activeSubagent.sessionKey}
      >
        <SubagentFullChat
          sessionKey={activeSubagent.sessionKey}
          label={activeSubagent.label}
          status={activeSubagent.status}
          fallbackPrompt={activeSubagent.task ?? ""}
          onBack={closeSubagent}
        />
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-background"
      data-chat-rebuild-history="true"
      data-session-key={sessionKey}
    >
      <div className="pointer-events-none absolute right-4 top-4 z-30">
        <div className="pointer-events-auto flex items-center gap-2">
          <div
            className="flex h-7 items-center gap-1 rounded-sm border border-border/40 bg-background/70 px-2 font-mono text-[10px] leading-none text-muted-foreground/80 shadow-sm backdrop-blur"
            title={`loaded: ${state.messages.length} • rendered: ${renderedMessages.length}`}
            data-chat-message-counter="true"
          >
            <span className="text-foreground/80">{state.messages.length}</span>
            <span className="text-muted-foreground/40">/</span>
            <span>{renderedMessages.length}</span>
          </div>
          <div className="relative">
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
      </div>
      {spawnedSubagents.length > 0 && (
        <div className="shrink-0 border-b border-border/10 bg-background/60 px-4 py-2 backdrop-blur-sm">
          <div className="mx-auto max-w-3xl">
            <SubagentBar subagents={spawnedSubagents} onOpen={openSubagent} />
          </div>
        </div>
      )}
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
                key={messageRowKey(message)}
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
                {message.role === "assistant" && subagentAnchors.orphanByAssistantId.get(message.messageId)?.length ? (
                  <div className="mb-2">
                    <SubagentCard
                      subagents={subagentAnchors.orphanByAssistantId.get(message.messageId) ?? []}
                      onOpen={openSubagent}
                    />
                  </div>
                ) : null}
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
                    suppressActions={message.role === "assistant" && animateAssistantText}
                    popoverOpen={activePopoverId === message.messageId}
                    onPopoverOpenChange={(open) =>
                      setActivePopoverId(open ? message.messageId : null)
                    }
                    onResolveApproval={(approvalId, decision) =>
                      resolveExecApprovalV2({ approvalId, decision }).then(() => undefined)
                    }
                  />
                ) : null}
                {message.role === "user" && subagentAnchors.byTriggerUserId.get(message.messageId)?.length ? (
                  <div className="mt-3">
                    <SubagentCard
                      subagents={subagentAnchors.byTriggerUserId.get(message.messageId) ?? []}
                      onOpen={openSubagent}
                    />
                  </div>
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

      <div className="pointer-events-none relative z-40 h-0 shrink-0">
        {showJumpToLatest && (
          <button
            type="button"
            onClick={handleJumpToLatest}
            className={cn(
              "animate-chat-latest-bob pointer-events-auto absolute -top-3 left-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full",
              "border border-white/18 bg-white/[0.045] text-foreground/90 shadow-[0_18px_46px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.16),inset_0_-1px_0_rgba(255,255,255,0.04)] ring-1 ring-white/[0.05] backdrop-blur-2xl backdrop-saturate-150 dark:bg-white/[0.055]",
              "transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-x-1/2 hover:-translate-y-[calc(50%+2px)] hover:border-white/28 hover:bg-white/[0.075] hover:shadow-[0_22px_56px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.2),inset_0_-1px_0_rgba(255,255,255,0.06)] dark:hover:bg-white/[0.085] active:-translate-x-1/2 active:-translate-y-1/2"
            )}
            aria-label="Jump to latest message"
            title="Jump to latest"
          >
            <LuArrowDown className="size-4" />
          </button>
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
