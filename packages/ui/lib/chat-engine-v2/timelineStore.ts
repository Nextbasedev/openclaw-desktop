/**
 * ChatTimelineStore — Single source of truth for chat message timeline.
 *
 * Mediates three data sources:
 *   1. Warm cache (IndexedDB) — fast initial paint
 *   2. Bootstrap (middleware) — authoritative full history
 *   3. Patch stream (WebSocket) — live real-time updates
 *
 * Conflict resolution:
 *   - Higher cursor always wins for status/metadata
 *   - Messages deduped by messageId, latest version kept
 *   - Bootstrap replaces warm cache entirely
 *   - Patches always apply on top (highest priority)
 *   - Single output per animation frame (batched)
 */

import type { ChatMessage } from "@/components/ChatView/types"
import type { InlineToolCall } from "@/components/ChatView/types"
import { dedupeChatMessages, mergeAssistantText, sameUserMessage, sortChatMessagesByTimeline } from "../chatMessageDedupe"
import { stripTransientChatMessagesState } from "../chatTransientState"

export type TimelineSource = "warm-cache" | "bootstrap" | "patch" | "optimistic" | "idle"

export type TimelineSnapshot = {
  messages: ChatMessage[]
  cursor: number
  source: TimelineSource
  messageCount: number
  bootstrapSettled: boolean
}

type TimelineListener = (snapshot: TimelineSnapshot) => void

function mergeTimelineToolCalls(
  existing: ChatMessage["toolCalls"],
  incoming: ChatMessage["toolCalls"],
): ChatMessage["toolCalls"] {
  if (!existing?.length) return incoming
  if (!incoming?.length) return existing

  const merged = new Map(existing.map((tool) => [tool.id, tool]))
  for (const tool of incoming) {
    const current = merged.get(tool.id)
    if (!current) {
      merged.set(tool.id, tool)
      continue
    }

    const currentTerminal = current.status === "success" || current.status === "error"
    const incomingRunning = tool.status === "running"
    const primary = currentTerminal && incomingRunning
      ? current
      : { ...current, ...tool }

    merged.set(tool.id, {
      ...primary,
      duration: primary.duration ?? current.duration ?? tool.duration,
      startedAt: primary.startedAt ?? current.startedAt ?? tool.startedAt,
      completedAt: primary.completedAt ?? current.completedAt ?? tool.completedAt,
      resultText: primary.resultText ?? current.resultText ?? tool.resultText,
      awaitingResult: primary.resultText ? false : (primary.awaitingResult ?? current.awaitingResult ?? tool.awaitingResult),
      approval: primary.approval ?? current.approval ?? tool.approval,
    })
  }
  return Array.from(merged.values())
}

function mergeTimelineAttachments(
  existing: ChatMessage["attachments"],
  incoming: ChatMessage["attachments"],
): ChatMessage["attachments"] {
  if (!existing?.length) return incoming
  if (!incoming?.length) return existing
  const byKey = new Map<string, NonNullable<ChatMessage["attachments"]>[number]>()
  for (const attachment of [...existing, ...incoming]) {
    const key = attachment.url || `${attachment.name}:${attachment.mimeType}:${attachment.size ?? ""}`
    const current = byKey.get(key)
    byKey.set(key, current ? { ...current, ...attachment } : attachment)
  }
  return Array.from(byKey.values())
}

function mergeTimelineText(existingText: string, incomingText: string, role: ChatMessage["role"]) {
  if (role !== "assistant") {
    return incomingText.trim().length >= existingText.trim().length ? incomingText : existingText
  }
  const existing = existingText.trim()
  const incoming = incomingText.trim()
  if (!existing) return incomingText
  if (!incoming) return existingText
  if (incoming.startsWith(existing) || existing.startsWith(incoming)) {
    return mergeAssistantText(existingText, incomingText)
  }
  return incomingText
}

function mergeTimelineMessages(existing: ChatMessage | undefined, incoming: ChatMessage): ChatMessage {
  if (!existing) return incoming
  if (existing.messageId !== incoming.messageId) return incoming

  const text = mergeTimelineText(existing.text, incoming.text, incoming.role)
  const reasoningText = incoming.reasoningText?.trim()
    ? mergeTimelineText(existing.reasoningText ?? "", incoming.reasoningText, "assistant")
    : existing.reasoningText

  return {
    ...existing,
    ...incoming,
    text,
    reasoningText,
    createdAt: existing.createdAt || incoming.createdAt,
    embeds: incoming.embeds?.length ? incoming.embeds : existing.embeds,
    attachments: mergeTimelineAttachments(existing.attachments, incoming.attachments),
    toolCalls: mergeTimelineToolCalls(existing.toolCalls, incoming.toolCalls),
    usage: incoming.usage ?? existing.usage,
    stopReason: incoming.stopReason ?? existing.stopReason,
    model: incoming.model ?? existing.model,
    optimisticMessageId: incoming.optimisticMessageId ?? existing.optimisticMessageId,
  }
}

export class ChatTimelineStore {
  private messageMap = new Map<string, ChatMessage>()
  private cursor = 0
  private source: TimelineSource = "idle"
  private bootstrapSettled = false
  private messageCount = 0
  private listeners = new Set<TimelineListener>()
  private pendingNotify = false
  private notifyRafId: number | null = null

  constructor(public readonly sessionKey: string) {}

  // ── Data source methods ──

  /**
   * Apply warm cache data. Only accepted if bootstrap hasn't settled yet.
   * Lower priority than bootstrap and patches.
   */
  applyWarmCache(messages: ChatMessage[], cursor: number, messageCount?: number) {
    if (this.bootstrapSettled) return // bootstrap already has authoritative data
    if (cursor <= this.cursor && this.messageMap.size > 0) return // already have newer data

    const durableMessages = stripTransientChatMessagesState(messages)
    this.mergeMessages(durableMessages)
    this.cursor = Math.max(this.cursor, cursor)
    this.messageCount = messageCount ?? durableMessages.length
    if (this.source === "idle") this.source = "warm-cache"
    this.scheduleNotify()
  }

  /**
   * Apply bootstrap data. Bootstrap is authoritative only up to its cursor.
   * If live patches have already advanced this store past the bootstrap cursor,
   * bootstrap may merge missing historical rows but must not delete newer live
   * rows. Deletions require an explicit remove/prune patch.
   */
  applyBootstrap(messages: ChatMessage[], cursor: number, messageCount?: number) {
    const bootstrapCursor = Math.max(0, cursor)
    const hasNewerLiveState = this.cursor > bootstrapCursor && this.messageMap.size > 0
    const optimistic = Array.from(this.messageMap.values()).filter((m) => m.isOptimistic)

    if (!hasNewerLiveState) {
      this.messageMap.clear()
    }
    const durableMessages = stripTransientChatMessagesState(messages)
    this.mergeMessages(durableMessages)

    for (const opt of optimistic) {
      const confirmedByBootstrap = Array.from(this.messageMap.values()).some((canonical) =>
        sameUserMessage(opt, canonical)
      )
      if (!this.messageMap.has(opt.messageId) && !confirmedByBootstrap) {
        this.messageMap.set(opt.messageId, opt)
      }
    }
    this.cursor = Math.max(this.cursor, bootstrapCursor)
    this.messageCount = hasNewerLiveState
      ? Math.max(this.messageCount, messageCount ?? durableMessages.length, this.messageMap.size)
      : (messageCount ?? durableMessages.length)
    this.source = "bootstrap"
    this.bootstrapSettled = true
    this.scheduleNotify()
  }

  /**
   * Apply a single patch update (message upsert, remove, status change).
   * Highest priority — always applies on top of existing data.
   */
  applyPatchMessage(message: ChatMessage, cursor: number) {
    if (message.role === "user" && !message.isOptimistic) {
      for (const existing of this.messageMap.values()) {
        if (
          existing.messageId !== message.messageId &&
          existing.role === "user" &&
          existing.isOptimistic &&
          sameUserMessage(existing, message)
        ) {
          this.messageMap.delete(existing.messageId)
        }
      }
    }
    this.messageMap.set(message.messageId, mergeTimelineMessages(this.messageMap.get(message.messageId), message))
    this.cursor = Math.max(this.cursor, cursor)
    this.messageCount = Math.max(this.messageCount, this.messageMap.size)
    this.source = this.bootstrapSettled ? "bootstrap" : this.source
    this.scheduleNotify()
  }

  /**
   * Remove a message by ID (from patch stream).
   */
  removeMessage(messageId: string, cursor: number) {
    this.messageMap.delete(messageId)
    this.cursor = Math.max(this.cursor, cursor)
    this.scheduleNotify()
  }

  /**
   * Apply an optimistic message (user send before Gateway confirms).
   */
  applyOptimistic(message: ChatMessage) {
    this.messageMap.set(message.messageId, { ...message, isOptimistic: true })
    this.messageCount = Math.max(this.messageCount, this.messageMap.size)
    this.scheduleNotify()
  }

  /**
   * Confirm an optimistic message with the Gateway echo.
   * Replaces the optimistic version with the confirmed one.
   */
  confirmOptimistic(optimisticId: string, confirmedMessage: ChatMessage) {
    const optimistic = this.messageMap.get(optimisticId)
    this.messageMap.delete(optimisticId)
    this.messageMap.set(confirmedMessage.messageId, mergeTimelineMessages(optimistic, confirmedMessage))
    this.scheduleNotify()
  }

  // ── Read methods ──

  getSnapshot(): TimelineSnapshot {
    return {
      messages: this.getSortedMessages(),
      cursor: this.cursor,
      source: this.source,
      messageCount: this.messageCount,
      bootstrapSettled: this.bootstrapSettled,
    }
  }

  getMessage(messageId: string): ChatMessage | undefined {
    return this.messageMap.get(messageId)
  }

  get size(): number {
    return this.messageMap.size
  }

  getAllMessageIds(): string[] {
    return Array.from(this.messageMap.keys())
  }

  get currentCursor(): number {
    return this.cursor
  }

  get isBootstrapSettled(): boolean {
    return this.bootstrapSettled
  }

  // ── Subscribe ──

  subscribe(listener: TimelineListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  // ── Internal ──

  private mergeMessages(messages: ChatMessage[]) {
    for (const msg of messages) {
      const existing = this.messageMap.get(msg.messageId)
      if (!existing) {
        this.messageMap.set(msg.messageId, msg)
      } else {
        // Keep the newer version (by gatewayIndex/seq, or just replace)
        const existingSeq = existing.gatewayIndex ?? 0
        const newSeq = msg.gatewayIndex ?? 0
        if (newSeq >= existingSeq) {
          this.messageMap.set(msg.messageId, mergeTimelineMessages(existing, msg))
        }
      }
    }
  }

  private getSortedMessages(): ChatMessage[] {
    // Single source of truth for ordering: dedupeChatMessages already runs
    // sortChatMessagesByTimeline as its final step. Do NOT add a second,
    // divergent sort here — historically the store used a createdAt-only
    // tiebreak while dedupe used a role tiebreak, so the same messages rendered
    // in different orders depending on the path. Delegate to the one shared
    // sorter so every render path agrees.
    return sortChatMessagesByTimeline(dedupeChatMessages(Array.from(this.messageMap.values())))
  }

  private scheduleNotify() {
    if (this.pendingNotify) return
    this.pendingNotify = true
    if (typeof requestAnimationFrame !== "undefined") {
      this.notifyRafId = requestAnimationFrame(() => this.flush())
    } else {
      // SSR/test fallback
      this.flush()
    }
  }

  private flush() {
    this.pendingNotify = false
    this.notifyRafId = null
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  // ── Cleanup ──

  destroy() {
    if (this.notifyRafId !== null) cancelAnimationFrame(this.notifyRafId)
    this.listeners.clear()
    this.messageMap.clear()
    this.pendingNotify = false
  }

  /** Flush pending notifications synchronously (for tests). */
  flushSync() {
    if (this.notifyRafId !== null) {
      cancelAnimationFrame(this.notifyRafId)
      this.notifyRafId = null
    }
    if (this.pendingNotify) this.flush()
  }
}

// ── Store registry (one store per session) ──

const stores = new Map<string, ChatTimelineStore>()

export function getTimelineStore(sessionKey: string): ChatTimelineStore {
  let store = stores.get(sessionKey)
  if (!store) {
    store = new ChatTimelineStore(sessionKey)
    stores.set(sessionKey, store)
  }
  return store
}

export function deleteTimelineStore(sessionKey: string) {
  const store = stores.get(sessionKey)
  if (store) {
    store.destroy()
    stores.delete(sessionKey)
  }
}

export function clearAllTimelineStores() {
  for (const store of stores.values()) store.destroy()
  stores.clear()
}
