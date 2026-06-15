"use client"

/**
 * runWatcher — top-level persistent SSE consumer that keeps the
 * activeRunRegistry honest for sessions whose ChatView isn't currently mounted.
 *
 * Why this exists:
 * - openPatchStreamV2 produces a GLOBAL stream of patches; every session's
 *   patches arrive on the same WS, the client just filters by sessionKey.
 * - ChatView opens its own SSE subscription scoped to its mount lifetime,
 *   which closes on session-switch unmount.
 * - When the user is on session B but session A is still streaming, A's
 *   registry entry would otherwise freeze on the last patch ChatView A saw
 *   before unmount. The sidebar loader for A would never turn off when A's
 *   run actually finishes server-side.
 * - This watcher opens one persistent stream at app shell level and:
 *     a) Updates the streamCursor of any tracked registry entry as patches
 *        for that session flow past, so a remount picks up close to live.
 *     b) Flips the entry to a terminal status (idle/error) when the
 *        terminal patch for that session arrives, which clears the sidebar
 *        loader without requiring the user to return to that session.
 *
 * The watcher does NOT apply the patches to any user-visible message list —
 * that remains ChatView's job. We only track lifecycle signals here.
 */

import { openPatchStreamV2 } from "./client"
import {
  applyChatPatch,
  patchImpliesActiveRun,
  statusFromPatch,
} from "./applyPatches"
import * as registry from "./activeRunRegistry"
import type { PatchFrame } from "./types"
import { frontendLog } from "../clientLogs"
import type { ChatMessage, StreamStatus } from "../../components/ChatView/types"

function sortByGatewayIndex(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const aSeq = a.message.gatewayIndex
      const bSeq = b.message.gatewayIndex
      if (typeof aSeq === "number" && typeof bSeq === "number" && aSeq !== bSeq) return aSeq - bSeq
      if (typeof aSeq === "number" && typeof bSeq !== "number") return -1
      if (typeof aSeq !== "number" && typeof bSeq === "number") return 1
      return a.index - b.index
    })
    .map(({ message }) => message)
}

function patchBelongsToSession(frame: PatchFrame, sessionKey: string): boolean {
  if (frame.patch.sessionKey) return frame.patch.sessionKey === sessionKey
  const payload = (frame.patch as { payload?: { sessionKey?: string } }).payload
  return payload?.sessionKey === sessionKey
}

let subscribers = 0
let teardown: (() => void) | null = null
let lastSeenCursor = 0

function patchSessionKey(frame: PatchFrame): string | null {
  if (frame.patch.sessionKey) return frame.patch.sessionKey
  const payload = (frame.patch as { payload?: { sessionKey?: string } }).payload
  return payload?.sessionKey ?? null
}

function handlePatch(frame: PatchFrame) {
  const sessionKey = patchSessionKey(frame)
  if (!sessionKey) return
  if (!patchBelongsToSession(frame, sessionKey)) return
  const tracked = registry.get(sessionKey)
  if (!tracked) {
    // We don't auto-track new sessions: the registry is owned by ChatView
    // mounts. If a session was never opened on this device this session, we
    // simply ignore its patches here.
    return
  }
  const cursor = frame.patch.cursor ?? tracked.streamCursor ?? null
  const derivedStatus = statusFromPatch(frame)
  // statusFromPatch can return null on patches that don't carry an explicit
  // status; in that case, infer "active" from patchImpliesActiveRun. Falling
  // back to the previous status if neither signal is present keeps us from
  // dropping the loader prematurely.
  let nextStatus: StreamStatus = tracked.streamStatus
  let nextLabel: string | null = tracked.statusLabel
  if (derivedStatus) {
    nextStatus = derivedStatus.status
    nextLabel = derivedStatus.label
  } else if (patchImpliesActiveRun(frame)) {
    if (!registry.isActiveRunStatus(nextStatus)) {
      nextStatus = "thinking"
      nextLabel = nextLabel ?? "Thinking"
    }
  }

  // Apply the patch to tracked.messages so the registry snapshot stays in
  // SYNC with what the live run is producing while no ChatView is mounted
  // for this session. Without this, leaving a session mid-stream freezes
  // the registry's messages at whatever was visible when ChatView unmounted;
  // on return the user sees a stale bubble + skipped tokens (because the
  // SSE re-subscribes from the advanced cursor and the missed patches are
  // never replayed into messages).
  //
  // Skip if cursor doesn't move forward (already-applied patch).
  let nextMessages = tracked.messages
  const previousCursor = tracked.streamCursor ?? 0
  const cursorIsForward =
    typeof cursor === "number" && cursor > previousCursor
  if (cursorIsForward) {
    try {
      const applied = applyChatPatch(
        { cursor: previousCursor, messages: tracked.messages },
        frame,
      )
      nextMessages = sortByGatewayIndex(applied.messages)
    } catch (error) {
      frontendLog(
        "chat",
        "chat-rebuild.runs.watcher.apply-error",
        {
          sessionKey,
          patchType: frame.patch.type,
          cursor: frame.patch.cursor,
          error: error instanceof Error ? error.message : String(error),
        },
        "warn",
      )
    }
  }

  // Only update if SOMETHING actually changed; otherwise we'd flood subscribers
  // with no-op renders on every chat patch.
  const cursorChanged =
    typeof cursor === "number" && cursor !== tracked.streamCursor
  const statusChanged = nextStatus !== tracked.streamStatus
  const labelChanged = nextLabel !== tracked.statusLabel
  const messagesChanged = nextMessages !== tracked.messages
  if (!cursorChanged && !statusChanged && !labelChanged && !messagesChanged) return

  if (messagesChanged) {
    frontendLog(
      "chat",
      "chat-rebuild.runs.watcher.apply",
      {
        sessionKey,
        cursor: frame.patch.cursor,
        patchType: frame.patch.type,
        beforeCount: tracked.messages.length,
        afterCount: nextMessages.length,
      },
      "debug",
    )
  }

  registry.publish(sessionKey, {
    messages: nextMessages,
    streamStatus: nextStatus,
    statusLabel: nextLabel,
    streamCursor: typeof cursor === "number" ? cursor : tracked.streamCursor,
  })
}

function openStream() {
  if (teardown) return
  frontendLog(
    "chat",
    "chat-rebuild.runs.watcher.start",
    { afterCursor: lastSeenCursor },
    "debug"
  )
  teardown = openPatchStreamV2(lastSeenCursor, (frame) => {
    if (frame.type !== "patch") return
    if (typeof frame.patch.cursor === "number") {
      lastSeenCursor = Math.max(lastSeenCursor, frame.patch.cursor)
    }
    handlePatch(frame)
  })
}

function closeStream() {
  if (!teardown) return
  frontendLog(
    "chat",
    "chat-rebuild.runs.watcher.stop",
    { lastSeenCursor },
    "debug"
  )
  teardown()
  teardown = null
}

/**
 * Mount the global run watcher. Idempotent across multiple callers (e.g.
 * dev-mode StrictMode double-mount, multiple AppShell instances in tests).
 * Returns a release function that decrements the reference count and tears
 * down the WS when the last caller releases.
 */
export function mountRunWatcher(): () => void {
  subscribers += 1
  if (subscribers === 1) openStream()
  return () => {
    subscribers = Math.max(0, subscribers - 1)
    if (subscribers === 0) closeStream()
  }
}

/** Test helper. */
export function __resetForTests() {
  if (teardown) {
    teardown()
    teardown = null
  }
  subscribers = 0
  lastSeenCursor = 0
}
