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
import { dedupeChatMessages, sameUserMessage, sortChatMessagesByTimeline } from "../chatMessageDedupe"
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
    this.messageMap.set(message.messageId, message)
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
    this.messageMap.delete(optimisticId)
    this.messageMap.set(confirmedMessage.messageId, confirmedMessage)
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
          this.messageMap.set(msg.messageId, msg)
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
