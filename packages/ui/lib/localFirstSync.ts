"use client"

import type { Chat } from "../types/chat"
import type { Space } from "../types/space"
import {
  persistentCacheDeletePrefix,
  persistentCacheGet,
  persistentCacheSet,
} from "./persistentCache"

export type LocalBootstrapState = {
  spaces: Space[]
  activeSpaceId: string | null
  sessions?: unknown[]
  updatedAt: number
}

export type LocalChatListState = {
  spaceId: string
  chats: Chat[]
  updatedAt: number
}

type LocalSyncEvent =
  | { type: "bootstrap"; state: LocalBootstrapState }
  | { type: "chats"; state: LocalChatListState }
  | { type: "invalidate"; prefix: string }
  | { type: "clear" }

type Listener<T> = (value: T) => void

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7
const BOOTSTRAP_KEY = "local:first:bootstrap"
const bc =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("openclaw-ui-local-first-sync-v1")
    : null
const bootstrapListeners = new Set<Listener<LocalBootstrapState>>()
const chatListeners = new Map<string, Set<Listener<LocalChatListState>>>()

function now() {
  return Date.now()
}
function chatKey(spaceId: string) {
  return `local:first:space:${spaceId}:chats`
}
function emitSet<T>(set: Set<Listener<T>> | undefined, value: T) {
  if (!set) return
  for (const listener of [...set]) listener(value)
}
function post(event: LocalSyncEvent) {
  try {
    bc?.postMessage(event)
  } catch {}
}

bc?.addEventListener("message", (event: MessageEvent<LocalSyncEvent>) => {
  const data = event.data
  if (!data || typeof data !== "object") return
  if (data.type === "bootstrap") emitSet(bootstrapListeners, data.state)
  if (data.type === "chats")
    emitSet(chatListeners.get(data.state.spaceId), data.state)
  if (data.type === "invalidate" || data.type === "clear") {
    // Other tabs will fetch fresh/cached data through their normal hooks.
  }
})

export async function localSyncGetBootstrap() {
  return persistentCacheGet<LocalBootstrapState>(BOOTSTRAP_KEY)
}

export async function localSyncSetBootstrap(
  input: Omit<LocalBootstrapState, "updatedAt"> & { updatedAt?: number }
) {
  const state = { ...input, updatedAt: input.updatedAt ?? now() }
  await persistentCacheSet(BOOTSTRAP_KEY, state, { ttlMs: CACHE_TTL_MS })
  emitSet(bootstrapListeners, state)
  post({ type: "bootstrap", state })
}

export function localSyncSubscribeBootstrap(
  listener: Listener<LocalBootstrapState>
) {
  bootstrapListeners.add(listener)
  return () => bootstrapListeners.delete(listener)
}

export async function localSyncGetChats(spaceId: string) {
  return persistentCacheGet<LocalChatListState>(chatKey(spaceId))
}

export async function localSyncSetChats(
  spaceId: string,
  chats: Chat[],
  updatedAt = now()
) {
  const state: LocalChatListState = { spaceId, chats, updatedAt }
  await persistentCacheSet(chatKey(spaceId), state, { ttlMs: CACHE_TTL_MS })
  emitSet(chatListeners.get(spaceId), state)
  post({ type: "chats", state })
}

export function localSyncSubscribeChats(
  spaceId: string,
  listener: Listener<LocalChatListState>
) {
  const set =
    chatListeners.get(spaceId) ?? new Set<Listener<LocalChatListState>>()
  set.add(listener)
  chatListeners.set(spaceId, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) chatListeners.delete(spaceId)
  }
}

export async function localSyncInvalidate(prefix: string) {
  await persistentCacheDeletePrefix(prefix)
  post({ type: "invalidate", prefix })
}

export async function localSyncClearAll() {
  await persistentCacheDeletePrefix("")
  post({ type: "clear" })
}
