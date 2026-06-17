import type { ChatMessage, InlineToolCall } from "./types"

/**
 * Stable per-row React key for chat messages.
 *
 * Invariant: **one row → one key**. The key is derived from `messageId` only.
 *
 * Why messageId-only:
 * - During a single run, multiple distinct assistant rows can coexist in
 *   `renderedMessages` while sharing the same `runId`:
 *     - `live:${runId}:tools` (tool-only assistant card from applyToolPatch)
 *     - `live:${runId}:assistant` (live streaming text)
 *     - `assistant-final` / canonical id (terminal message from gateway final)
 *   A previous version of the key derivation returned
 *   `assistant-run:${runId}` for any assistant message with a runId. That
 *   collapsed every assistant row for a run into a single React key →
 *   React reused the wrong DOM subtree → duplicated tool stacks, looping
 *   message content, and ghost rows during long conversations.
 *
 * - `messageId` is already kept unique per logical row by `applyChatPatch`
 *   (live placeholder rows have distinct synthetic IDs; canonical rows have
 *   gateway-issued IDs). The optimistic→confirmed transition for user
 *   messages swaps the optimistic ID for the canonical ID in a single
 *   reducer step (the optimistic row is removed via `idsToReplace`, the
 *   canonical row is inserted). React unmount/remount in that single
 *   transition is correct and does not produce duplication.
 *
 * - Fallback: if a row is missing a messageId (should not happen, but is
 *   theoretically possible for malformed projections), use a role+index
 *   tag in the caller — see `messageListKeys` below for the safe wrapper
 *   that returns unique keys for an entire ordered list even if multiple
 *   rows somehow carry the same id.
 *
 * Tool-stack stability is handled by `toolCallKey` — tools keyed by their
 * tool id, never by array index, scoped under the assistant row that owns
 * them (which already has a stable row key).
 */
export function messageRowKey(message: ChatMessage): string {
  const id = message.messageId?.trim()
  if (id) return id
  // Defensive: a row with no id is a bug upstream. Don't crash, but produce
  // something distinct from any other row.
  return `no-id:${message.role}:${message.gatewayIndex ?? "no-seq"}:${message.createdAt ?? ""}`
}

/**
 * Tool call key for use inside the tool stack of an assistant row.
 *
 * Invariant: keyed off the tool's stable `id` (the gateway-issued toolCallId).
 * Never by index — index-based keys swap DOM subtrees when tools merge
 * in/out during streaming, producing duplicated detail panels.
 */
export function toolCallKey(tool: InlineToolCall): string {
  if (tool.id?.trim()) return tool.id.trim()
  // Same defensive fallback as messageRowKey: keep it stable per tool
  // identity (name + startedAt) rather than by index.
  return `no-id:${tool.tool}:${tool.startedAt ?? ""}`
}

/**
 * Walk an ordered message list and return the key for each row.
 *
 * This wrapper guarantees no two adjacent rows in the rendered output share
 * the same key, even if upstream (applyChatPatch + dedupe) ever produces
 * two rows with the same messageId. That should never happen in normal
 * operation, but during the long-conversation render-instability bug
 * Krish reported, it was easy to slip into duplicate-key states; this is
 * the last line of defense and is cheap (single pass, no extra renders).
 */
export function messageListKeys(messages: ChatMessage[]): string[] {
  const seen = new Map<string, number>()
  const keys: string[] = []
  for (const message of messages) {
    const base = messageRowKey(message)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    keys.push(count === 0 ? base : `${base}#${count}`)
  }
  return keys
}
