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
export const WARM_CHAT_MAX_MESSAGES = 80
export const WARM_CHAT_MAX_APPROX_BYTES_PER_CHAT = 500 * 1024
export const WARM_CHAT_WRITE_DEBOUNCE_MS = 1000

const WARM_CHAT_INDEX_KEY = "warm-chat:index"
const WARM_CHAT_ENTRY_PREFIX = "warm-chat:entry:"
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

export type WarmChatCacheRead = {
  entry: WarmChatCacheEntry
  fresh: boolean
  stale: boolean
  ageMs: number
}

function now() {
  return Date.now()
}

function entryKey(sessionKey: string) {
  return `${WARM_CHAT_ENTRY_PREFIX}${sessionKey}`
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

async function updateIndex(sessionKey: string, cachedAt: number, lastAccessedAt: number) {
  const index = await getIndex()
  const entries = sortIndex([
    { sessionKey, cachedAt, lastAccessedAt },
    ...index.entries.filter((entry) => entry.sessionKey !== sessionKey),
  ])
  const kept = entries.slice(0, WARM_CHAT_MAX_CHATS)
  const evicted = entries.slice(WARM_CHAT_MAX_CHATS)
  await setIndex({ entries: kept, updatedAt: now() })
  await Promise.all(
    evicted.map((entry) => persistentCacheDeletePrefix(entryKey(entry.sessionKey)))
  )
}

function isEntryDisplayable(entry: WarmChatCacheEntry) {
  return now() - entry.cachedAt <= WARM_CHAT_DISPLAYABLE_MS
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

export async function getWarmChatCache(sessionKey: string): Promise<WarmChatCacheRead | null> {
  const entry = await persistentCacheGet<WarmChatCacheEntry>(entryKey(sessionKey))
  if (!entry || !isEntryDisplayable(entry) || entry.messages.length === 0) return null
  const touched = { ...entry, lastAccessedAt: now() }
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
  const entry: WarmChatCacheEntry = {
    sessionKey,
    messages,
    cursor: input.cursor,
    runStatus: input.runStatus ?? null,
    statusLabel: input.statusLabel ?? null,
    activeRunSummary: input.activeRunSummary ?? null,
    pendingToolSummary: input.pendingToolSummary ?? pendingTools?.map((tool) => ({
      id: tool.id,
      name: tool.tool,
      status: tool.status,
    })),
    pendingTools,
    messageCount: input.messageCount ?? messages.length,
    cachedAt,
    lastAccessedAt,
  }
  await persistentCacheSet(entryKey(sessionKey), entry, {
    ttlMs: WARM_CHAT_DISPLAYABLE_MS,
  })
  await updateIndex(sessionKey, cachedAt, lastAccessedAt)
}

export async function deleteWarmChatCache(sessionKey: string) {
  await persistentCacheDeletePrefix(entryKey(sessionKey))
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
  await Promise.all(deleteKeys.map((sessionKey) => persistentCacheDeletePrefix(entryKey(sessionKey))))
  if (deleteKeys.length > 0 || kept.length !== index.entries.length) {
    await setIndex({ entries: kept, updatedAt: now() })
  }
}
