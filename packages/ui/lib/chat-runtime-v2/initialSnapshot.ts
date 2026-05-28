import type { ChatMessage, StreamStatus } from "@/components/ChatView/types"
import { dedupeChatMessages } from "@/lib/chatMessageDedupe"
import { warmBootstrapMessages } from "@/lib/chat-engine-v2/bootstrapPreview"
import type { RunStatusV2 } from "@/lib/chat-engine-v2/client"
import type { SessionState } from "@/lib/chat-engine-v2/store"

type BootstrapLike = {
  source?: string
  projectionVersion?: number
  messages?: unknown[]
  messageCount?: number
  cursor?: number
  v2Cursor?: number
  runStatus?: RunStatusV2 | string | null
  statusLabel?: string | null
  historyCoverage?: "none" | "metadata" | "full" | "windowed"
  fullMessagesIncluded?: boolean
  history?: { messages?: unknown[]; sessionStatus?: string | null }
}

type WarmCacheLike = {
  entry?: {
    messages?: ChatMessage[]
    runStatus?: RunStatusV2 | string | null
  } | null
} | null

export type ChatInitialSnapshot = {
  messages: ChatMessage[] | undefined
  knownEmpty: boolean
  status: StreamStatus
  statusLabel: string | null
  dataSource: "warm-cache" | "loading"
  historyLoadVersion: number
  loading: boolean
}

export function isActiveRunStatus(status: StreamStatus | null | undefined) {
  return Boolean(
    status && !["idle", "connected", "done", "error"].includes(status)
  )
}

export function normalizeStatusLabelForStatus(
  status: StreamStatus | null | undefined,
  label: string | null | undefined,
) {
  if (status === "error") return label ?? null
  return isActiveRunStatus(status) ? (label ?? null) : null
}

export function streamStatusFromCanonicalRun(
  status: RunStatusV2 | string | null | undefined,
): StreamStatus {
  if (status === "aborted") return "error"
  if (
    status === "idle" ||
    status === "queued" ||
    status === "thinking" ||
    status === "tool_running" ||
    status === "streaming" ||
    status === "done" ||
    status === "error"
  ) return status
  return "idle"
}

export function isKnownEmptyBootstrap(data: BootstrapLike | null | undefined) {
  if (!data) return false
  const hasMessages = Boolean(data.messages?.length || data.history?.messages?.length)
  if (hasMessages) return false
  if (data.historyCoverage && data.historyCoverage !== "full") return false
  return data.messageCount === 0 && (
    data.fullMessagesIncluded === true ||
    data.historyCoverage === "full" ||
    Boolean(data.source) ||
    Boolean(data.projectionVersion)
  )
}

export function isAuthoritativeKnownEmptyGlobal(state: SessionState | null | undefined) {
  return Boolean(
    state &&
    state.historyCoverage === "full" &&
    state.messages.length === 0 &&
    state.messageCount === 0 &&
    typeof state.cursor === "number"
  )
}

export function selectInitialChatSnapshot({
  initialMessages,
  globalSession,
  cachedBootstrap,
  syncWarmCache,
}: {
  initialMessages?: ChatMessage[]
  globalSession?: SessionState | null
  cachedBootstrap?: BootstrapLike | null
  syncWarmCache?: WarmCacheLike
}): ChatInitialSnapshot {
  const hasInitial = Boolean(initialMessages?.length)
  const initialGlobalMessages = !hasInitial && globalSession?.messages?.length
    ? globalSession.messages
    : undefined
  const initialWarmMessages = hasInitial
    ? initialMessages
    : initialGlobalMessages
      ?? warmBootstrapMessages(undefined, cachedBootstrap as Parameters<typeof warmBootstrapMessages>[1])
      ?? (syncWarmCache?.entry?.messages?.length
        ? dedupeChatMessages(syncWarmCache.entry.messages)
        : undefined)
  const knownEmpty = !hasInitial && !initialWarmMessages && (
    isAuthoritativeKnownEmptyGlobal(globalSession ?? null) ||
    isKnownEmptyBootstrap(cachedBootstrap ?? null)
  )
  const status = hasInitial
    ? "thinking"
    : globalSession?.status ?? (
        cachedBootstrap?.runStatus
          ? streamStatusFromCanonicalRun(cachedBootstrap.runStatus)
          : syncWarmCache?.entry?.runStatus
            ? streamStatusFromCanonicalRun(syncWarmCache.entry.runStatus)
            : "idle"
      )
  const statusLabel = normalizeStatusLabelForStatus(
    status,
    globalSession?.statusLabel ?? cachedBootstrap?.statusLabel ?? null,
  )
  return {
    messages: initialWarmMessages ? dedupeChatMessages(initialWarmMessages) : undefined,
    knownEmpty,
    status,
    statusLabel,
    dataSource: initialWarmMessages ? "warm-cache" : "loading",
    historyLoadVersion: initialWarmMessages?.length || knownEmpty ? 1 : 0,
    loading: !hasInitial && !initialWarmMessages && !knownEmpty && !initialGlobalMessages,
  }
}
