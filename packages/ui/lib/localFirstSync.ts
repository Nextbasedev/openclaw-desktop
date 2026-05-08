"use client"

import type { ChatMessage, StreamStatus } from "../components/ChatView/types"
import type { Chat } from "../types/chat"
import type { Space } from "../types/space"
import { persistentCacheDeletePrefix, persistentCacheGet, persistentCacheSet } from "./persistentCache"

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

export type LocalMessageState = {
  sessionKey: string
  messages: ChatMessage[]
  status?: StreamStatus | null
  updatedAt: number
}

type LocalSyncEvent =
  | { type: "bootstrap"; state: LocalBootstrapState }
  | { type: "chats"; state: LocalChatListState }
  | { type: "messages"; state: LocalMessageState }
  | { type: "invalidate"; prefix: string }
  | { type: "clear" }

type Listener<T> = (value: T) => void

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7
const BOOTSTRAP_KEY = "local:first:bootstrap"
const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("openclaw-ui-local-first-sync-v1") : null
const bootstrapListeners = new Set<Listener<LocalBootstrapState>>()
const chatListeners = new Map<string, Set<Listener<LocalChatListState>>>()
const messageListeners = new Map<string, Set<Listener<LocalMessageState>>>()

function now() { return Date.now() }
function chatKey(spaceId: string) { return `local:first:space:${spaceId}:chats` }
function messageKey(sessionKey: string) { return `local:first:session:${sessionKey}:messages` }
function statusKey(sessionKey: string) { return `local:first:session:${sessionKey}:status` }
function emitSet<T>(set: Set<Listener<T>> | undefined, value: T) {
  if (!set) return
  for (const listener of [...set]) listener(value)
}
function post(event: LocalSyncEvent) { try { bc?.postMessage(event) } catch {} }

function messageIdOf(message: ChatMessage) { return message.messageId || `${message.role}:${message.createdAt ?? ""}:${message.text ?? ""}` }
function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>()
  for (const message of existing) byId.set(messageIdOf(message), message)
  for (const message of incoming) {
    const key = messageIdOf(message)
    const prev = byId.get(key)
    byId.set(key, prev ? { ...prev, ...message, text: message.text || prev.text } : message)
  }
  return [...byId.values()].sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : 0
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0
    return at - bt
  })
}

bc?.addEventListener("message", (event: MessageEvent<LocalSyncEvent>) => {
  const data = event.data
  if (!data || typeof data !== "object") return
  if (data.type === "bootstrap") emitSet(bootstrapListeners, data.state)
  if (data.type === "chats") emitSet(chatListeners.get(data.state.spaceId), data.state)
  if (data.type === "messages") emitSet(messageListeners.get(data.state.sessionKey), data.state)
  if (data.type === "invalidate" || data.type === "clear") {
    // Other tabs will fetch fresh/cached data through their normal hooks.
  }
})

export async function localSyncGetBootstrap() {
  return persistentCacheGet<LocalBootstrapState>(BOOTSTRAP_KEY)
}

export async function localSyncSetBootstrap(input: Omit<LocalBootstrapState, "updatedAt"> & { updatedAt?: number }) {
  const state = { ...input, updatedAt: input.updatedAt ?? now() }
  await persistentCacheSet(BOOTSTRAP_KEY, state, { ttlMs: CACHE_TTL_MS })
  emitSet(bootstrapListeners, state)
  post({ type: "bootstrap", state })
}

export function localSyncSubscribeBootstrap(listener: Listener<LocalBootstrapState>) {
  bootstrapListeners.add(listener)
  return () => bootstrapListeners.delete(listener)
}

export async function localSyncGetChats(spaceId: string) {
  return persistentCacheGet<LocalChatListState>(chatKey(spaceId))
}

export async function localSyncSetChats(spaceId: string, chats: Chat[], updatedAt = now()) {
  const state: LocalChatListState = { spaceId, chats, updatedAt }
  await persistentCacheSet(chatKey(spaceId), state, { ttlMs: CACHE_TTL_MS })
  emitSet(chatListeners.get(spaceId), state)
  post({ type: "chats", state })
}

export function localSyncSubscribeChats(spaceId: string, listener: Listener<LocalChatListState>) {
  const set = chatListeners.get(spaceId) ?? new Set<Listener<LocalChatListState>>()
  set.add(listener)
  chatListeners.set(spaceId, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) chatListeners.delete(spaceId)
  }
}

export async function localSyncGetMessages(sessionKey: string) {
  const state = await persistentCacheGet<LocalMessageState>(messageKey(sessionKey))
  if (state) return state
  const messages = await persistentCacheGet<ChatMessage[]>(`session:${sessionKey}:uiMessages`)
  const status = await persistentCacheGet<StreamStatus>(statusKey(sessionKey))
  return messages?.length ? { sessionKey, messages, status, updatedAt: now() } : null
}

export async function localSyncSetMessages(sessionKey: string, messages: ChatMessage[], status?: StreamStatus | null, updatedAt = now()) {
  const existing = await persistentCacheGet<LocalMessageState>(messageKey(sessionKey))
  const merged = mergeMessages(existing?.messages ?? [], messages).slice(-500)
  const state: LocalMessageState = { sessionKey, messages: merged, status: status ?? existing?.status ?? null, updatedAt }
  await persistentCacheSet(messageKey(sessionKey), state, { ttlMs: CACHE_TTL_MS })
  await persistentCacheSet(`session:${sessionKey}:uiMessages`, state.messages.slice(-200), { ttlMs: CACHE_TTL_MS })
  if (state.status) await persistentCacheSet(statusKey(sessionKey), state.status, { ttlMs: CACHE_TTL_MS })
  emitSet(messageListeners.get(sessionKey), state)
  post({ type: "messages", state })
}

export async function localSyncSetStatus(sessionKey: string, status: StreamStatus) {
  const existing = await localSyncGetMessages(sessionKey)
  await localSyncSetMessages(sessionKey, existing?.messages ?? [], status)
}

export function localSyncSubscribeMessages(sessionKey: string, listener: Listener<LocalMessageState>) {
  const set = messageListeners.get(sessionKey) ?? new Set<Listener<LocalMessageState>>()
  set.add(listener)
  messageListeners.set(sessionKey, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) messageListeners.delete(sessionKey)
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
