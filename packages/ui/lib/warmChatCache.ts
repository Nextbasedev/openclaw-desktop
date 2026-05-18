"use client"

import type {
  ChatMessage,
  InlineToolCall,
} from "@/components/ChatView/types"
import {
  persistentCacheDeletePrefix,
  persistentCacheGet,
  persistentCacheSet,
} from "@/lib/persistentCache"

export const WARM_CHAT_FRESH_MS = 2 * 60 * 1000
export const WARM_CHAT_DISPLAYABLE_MS = 24 * 60 * 60 * 1000
export const WARM_CHAT_MAX_CHATS = 30
export const WARM_CHAT_MAX_MESSAGES = 1000
export const WARM_CHAT_MAX_APPROX_BYTES_PER_CHAT = 8 * 1024 * 1024
export const WARM_CHAT_WRITE_DEBOUNCE_MS = 1000

const WARM_CHAT_INDEX_KEY = "warm-chat:index"
const WARM_CHAT_ENTRY_PREFIX = "warm-chat:entry:"
const WARM_CHAT_PREVIEW_PREFIX = "warm-chat:preview:"
const WARM_CHAT_RUN_PREFIX = "warm-chat:run:"
const MAX_TEXT_CHARS_PER_MESSAGE = 120_000
const MAX_TOOL_RESULT_CHARS = 20_000
const MAX_EMBED_CONTENT_CHARS = 20_000

type WarmChatIndexEntry = {
  sessionKey: string
  lastAccessedAt: number
  cachedAt: number
}

type WarmChatIndex = {
  entries: WarmChatIndexEntry[]
  updatedAt: number
}

export type WarmChatActiveRunSummary = {
  runId?: string
  status?: string
  startedAt?: string | number | null
}

export type WarmChatCacheEntry = {
  sessionKey: string
  messages: ChatMessage[]
  cursor?: number
  runStatus?: string | null
  statusLabel?: string | null
  activeRunSummary?: WarmChatActiveRunSummary | null
  pendingToolSummary?: Array<{
    id: string
    name?: string
    status?: string
  }>
  pendingTools?: InlineToolCall[]
  messageCount?: number
  cachedAt: number
  lastAccessedAt: number
}

type WarmChatPreviewEntry = {
  sessionKey: string
  messages: ChatMessage[]
  messageCount?: number
  cursor?: number
  cachedAt: number
  lastAccessedAt: number
}

type WarmChatRunEntry = {
  sessionKey: string
  cursor?: number
  runStatus?: string | null
  statusLabel?: string | null
  activeRunSummary?: WarmChatActiveRunSummary | null
  pendingToolSummary?: WarmChatCacheEntry["pendingToolSummary"]
  pendingTools?: InlineToolCall[]
  cachedAt: number
  lastAccessedAt: number
}

export type WarmChatCacheRead = {
  entry: WarmChatCacheEntry
  fresh: boolean
  stale: boolean
  ageMs: number
}

function now() {
  return Date.now()
}

function legacyEntryKey(sessionKey: string) {
  return `${WARM_CHAT_ENTRY_PREFIX}${sessionKey}`
}

function previewKey(sessionKey: string) {
  return `${WARM_CHAT_PREVIEW_PREFIX}${sessionKey}`
}

function runKey(sessionKey: string) {
  return `${WARM_CHAT_RUN_PREFIX}${sessionKey}`
}

function approximateBytes(value: unknown) {
  try {
    return new Blob([JSON.stringify(value)]).size
  } catch {
    try {
      return JSON.stringify(value).length
    } catch {
      return 0
    }
  }
}

function truncateText(value: string | undefined, maxChars: number) {
  if (!value || value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n\n[Cached preview truncated]`
}

function sanitizeTool(tool: InlineToolCall): InlineToolCall {
  return {
    ...tool,
    resultText: truncateText(tool.resultText, MAX_TOOL_RESULT_CHARS),
  }
}

function sanitizeMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    text: truncateText(message.text, MAX_TEXT_CHARS_PER_MESSAGE) ?? "",
    attachments: message.attachments?.map((attachment) => ({
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: attachment.url,
    })),
    embeds: message.embeds?.map((embed) => ({
      ...embed,
      content: truncateText(embed.content, MAX_EMBED_CONTENT_CHARS) ?? "",
    })),
    toolCalls: message.toolCalls?.map(sanitizeTool),
    retryPayload: undefined,
  }
}

function trimMessagesForCache(messages: ChatMessage[]) {
  let next = messages.slice(-WARM_CHAT_MAX_MESSAGES).map(sanitizeMessage)
  while (next.length > 1 && approximateBytes(next) > WARM_CHAT_MAX_APPROX_BYTES_PER_CHAT) {
    next = next.slice(Math.max(1, Math.floor(next.length * 0.25)))
  }
  return next
}

async function getIndex(): Promise<WarmChatIndex> {
  return (await persistentCacheGet<WarmChatIndex>(WARM_CHAT_INDEX_KEY)) ?? {
    entries: [],
    updatedAt: now(),
  }
}

async function setIndex(index: WarmChatIndex) {
  await persistentCacheSet(WARM_CHAT_INDEX_KEY, index, {
    ttlMs: WARM_CHAT_DISPLAYABLE_MS,
  })
}

function sortIndex(entries: WarmChatIndexEntry[]) {
  return [...entries].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
}

async function deleteSessionCache(sessionKey: string) {
  await Promise.all([
    persistentCacheDeletePrefix(legacyEntryKey(sessionKey)),
    persistentCacheDeletePrefix(previewKey(sessionKey)),
    persistentCacheDeletePrefix(runKey(sessionKey)),
  ])
}

async function updateIndex(sessionKey: string, cachedAt: number, lastAccessedAt: number) {
  const index = await getIndex()
  const entries = sortIndex([
    { sessionKey, cachedAt, lastAccessedAt },
    ...index.entries.filter((entry) => entry.sessionKey !== sessionKey),
  ])
  const kept = entries.slice(0, WARM_CHAT_MAX_CHATS)
  const evicted = entries.slice(WARM_CHAT_MAX_CHATS)
  await setIndex({ entries: kept, updatedAt: now() })
  await Promise.all(evicted.map((entry) => deleteSessionCache(entry.sessionKey)))
}

function isDisplayable(cachedAt: number) {
  return now() - cachedAt <= WARM_CHAT_DISPLAYABLE_MS
}

function isEntryDisplayable(entry: WarmChatCacheEntry) {
  return isDisplayable(entry.cachedAt)
}

export function classifyWarmChatCache(entry: WarmChatCacheEntry): WarmChatCacheRead {
  const ageMs = Math.max(0, now() - entry.cachedAt)
  return {
    entry,
    ageMs,
    fresh: ageMs <= WARM_CHAT_FRESH_MS,
    stale: ageMs > WARM_CHAT_FRESH_MS,
  }
}

function combineWarmEntries(preview: WarmChatPreviewEntry, run: WarmChatRunEntry | null): WarmChatCacheEntry {
  return {
    sessionKey: preview.sessionKey,
    messages: preview.messages,
    cursor: run?.cursor ?? preview.cursor,
    runStatus: run?.runStatus ?? null,
    statusLabel: run?.statusLabel ?? null,
    activeRunSummary: run?.activeRunSummary ?? null,
    pendingToolSummary: run?.pendingToolSummary,
    pendingTools: run?.pendingTools,
    messageCount: preview.messageCount ?? preview.messages.length,
    cachedAt: Math.max(preview.cachedAt, run?.cachedAt ?? 0),
    lastAccessedAt: Math.max(preview.lastAccessedAt, run?.lastAccessedAt ?? 0),
  }
}

export async function getWarmChatCache(sessionKey: string): Promise<WarmChatCacheRead | null> {
  const [preview, run] = await Promise.all([
    persistentCacheGet<WarmChatPreviewEntry>(previewKey(sessionKey)),
    persistentCacheGet<WarmChatRunEntry>(runKey(sessionKey)),
  ])

  if (preview && isDisplayable(preview.cachedAt) && preview.messages.length > 0) {
    const touchedPreview = { ...preview, lastAccessedAt: now() }
    const touchedRun = run ? { ...run, lastAccessedAt: touchedPreview.lastAccessedAt } : null
    void persistentCacheSet(previewKey(sessionKey), touchedPreview, {
      ttlMs: WARM_CHAT_DISPLAYABLE_MS,
      persistLocal: false,
    })
    if (touchedRun) {
      void persistentCacheSet(runKey(sessionKey), touchedRun, {
        ttlMs: WARM_CHAT_DISPLAYABLE_MS,
        persistLocal: false,
      })
    }
    void updateIndex(sessionKey, touchedPreview.cachedAt, touchedPreview.lastAccessedAt)
    return classifyWarmChatCache(combineWarmEntries(touchedPreview, touchedRun))
  }

  const legacy = await persistentCacheGet<WarmChatCacheEntry>(legacyEntryKey(sessionKey))
  if (!legacy || !isEntryDisplayable(legacy) || legacy.messages.length === 0) return null
  void setWarmChatCache(sessionKey, legacy)
  const touched = { ...legacy, lastAccessedAt: now() }
  void updateIndex(sessionKey, touched.cachedAt, touched.lastAccessedAt)
  return classifyWarmChatCache(touched)
}

export async function setWarmChatCache(
  sessionKey: string,
  input: Omit<WarmChatCacheEntry, "sessionKey" | "messages" | "cachedAt" | "lastAccessedAt"> & {
    messages: ChatMessage[]
    cachedAt?: number
    lastAccessedAt?: number
  }
) {
  const cachedAt = input.cachedAt ?? now()
  const lastAccessedAt = input.lastAccessedAt ?? cachedAt
  const messages = trimMessagesForCache(input.messages)
  if (messages.length === 0) return
  const pendingTools = input.pendingTools?.slice(0, 20).map(sanitizeTool)
  const pendingToolSummary = input.pendingToolSummary ?? pendingTools?.map((tool) => ({
    id: tool.id,
    name: tool.tool,
    status: tool.status,
  }))

  const preview: WarmChatPreviewEntry = {
    sessionKey,
    messages,
    cursor: input.cursor,
    messageCount: input.messageCount ?? messages.length,
    cachedAt,
    lastAccessedAt,
  }
  const run: WarmChatRunEntry = {
    sessionKey,
    cursor: input.cursor,
    runStatus: input.runStatus ?? null,
    statusLabel: input.statusLabel ?? null,
    activeRunSummary: input.activeRunSummary ?? null,
    pendingToolSummary,
    pendingTools,
    cachedAt,
    lastAccessedAt,
  }

  await Promise.all([
    persistentCacheSet(previewKey(sessionKey), preview, {
      ttlMs: WARM_CHAT_DISPLAYABLE_MS,
      persistLocal: false,
    }),
    persistentCacheSet(runKey(sessionKey), run, {
      ttlMs: WARM_CHAT_DISPLAYABLE_MS,
      persistLocal: false,
    }),
    persistentCacheDeletePrefix(legacyEntryKey(sessionKey)),
  ])
  await updateIndex(sessionKey, cachedAt, lastAccessedAt)
}

export async function deleteWarmChatCache(sessionKey: string) {
  await deleteSessionCache(sessionKey)
  const index = await getIndex()
  await setIndex({
    entries: index.entries.filter((entry) => entry.sessionKey !== sessionKey),
    updatedAt: now(),
  })
}

export async function pruneWarmChatCache() {
  const index = await getIndex()
  const sorted = sortIndex(index.entries)
  const kept: WarmChatIndexEntry[] = []
  const deleteKeys: string[] = []
  for (const entry of sorted) {
    const tooOld = now() - entry.cachedAt > WARM_CHAT_DISPLAYABLE_MS
    if (tooOld || kept.length >= WARM_CHAT_MAX_CHATS) {
      deleteKeys.push(entry.sessionKey)
    } else {
      kept.push(entry)
    }
  }
  await Promise.all(deleteKeys.map((sessionKey) => deleteSessionCache(sessionKey)))
  if (deleteKeys.length > 0 || kept.length !== index.entries.length) {
    await setIndex({ entries: kept, updatedAt: now() })
  }
}
