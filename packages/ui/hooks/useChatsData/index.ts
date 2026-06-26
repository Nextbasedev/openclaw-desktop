"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { invoke } from "@/lib/ipc"
import { on, emit } from "@/lib/events"
import { localSyncSetChats, localSyncSubscribeChats } from "@/lib/localFirstSync"
import { persistentCacheSet } from "@/lib/persistentCache"
import { invalidateMiddlewareStartupBootstrap } from "@/lib/startupBootstrap"
import { fetchChatsForSpace, invalidateChatListCache, loadCachedChatsForSpace, visibleChatsForSpace } from "@/lib/chatListCache"
import { MIDDLEWARE_CONNECTION_CHANGED_EVENT } from "@/lib/middleware-client"
import { deleteWarmChatCache } from "@/lib/warmChatCache"
import { isSubagentSessionKey } from "@/lib/subagentSession"
import { clearCachedChatActivity, getAllCachedChatActivity, subscribeChatActivity } from "@/lib/chatActivityStore"
import * as activeRunRegistry from "@/lib/chat-engine-v2/activeRunRegistry"
import type { Chat, ActiveChat } from "@/types/chat"

export type { Chat, ActiveChat }

export type ChatDialogState = {
  renameOpen: boolean
  renameTarget: Chat | null
  renameName: string
  renameRef: React.RefObject<HTMLInputElement | null>
  deleteOpen: boolean
  deleteTarget: Chat | null
  deleting: boolean
}

export type ChatDialogActions = {
  setRenameOpen: (v: boolean) => void
  setRenameName: (v: string) => void
  openRename: (chat: Chat) => void
  handleRename: () => Promise<void>
  setDeleteOpen: (v: boolean) => void
  openDelete: (chat: Chat) => void
  handleDelete: () => Promise<void>
}

type ForkCreateEvent = {
  status?: "pending" | "resolved" | "failed"
  requestId: string
  name?: string
  chatId?: string
  sessionKey?: string
  spaceId?: string | null
  context?: { type?: string }
}

const SIDEBAR_CHAT_CACHE_TTL_MS = 1000 * 60

type ChatActivityEvent = {
  chatId?: string
  sessionKey?: string
  at?: string
  lastMessageText?: string | null
}

type ChatMessageConfirmedEvent = ChatActivityEvent

function timeValue(value?: string | null) {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function chatActivityTime(chat: Chat) {
  return Math.max(
    timeValue(chat.updatedAt),
    timeValue(chat.lastActiveAt),
    timeValue(chat.lastMessageAt),
    timeValue(chat.createdAt),
  )
}

function compareChatsByActivity(a: Chat, b: Chat) {
  const activityDiff = chatActivityTime(b) - chatActivityTime(a)
  if (activityDiff !== 0) return activityDiff
  const createdDiff = timeValue(b.createdAt) - timeValue(a.createdAt)
  if (createdDiff !== 0) return createdDiff
  return String(a.id || a.sessionKey || "").localeCompare(String(b.id || b.sessionKey || ""))
}

export function useChatsData(
  activeChat: ActiveChat | null,
  onChatClear: (chatId?: string) => void,
  refreshTrigger = 0,
  spaceId?: string | null,
  showArchived = false,
) {
  const [chats, setChats] = useState<Chat[]>([])
  const [chatOrder, setChatOrder] = useState<string[]>([])
  const [pinnedChats, setPinnedChats] = useState<Set<string>>(
    new Set(),
  )
  const [runningSessionKeys, setRunningSessionKeys] = useState<Set<string>>(
    new Set(),
  )

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Chat | null>(
    null,
  )
  const [renameName, setRenameName] = useState("")
  const renameRef = useRef<HTMLInputElement>(null)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Chat | null>(
    null,
  )
  const [deleting, setDeleting] = useState(false)
  const loadSeqRef = useRef(0)
  const currentSpaceIdRef = useRef<string | null | undefined>(spaceId)
  const previousSpaceIdRef = useRef<string | null | undefined>(spaceId)
  const latestChatsRef = useRef<Chat[]>([])
  const chatsBySpaceRef = useRef(new Map<string, Chat[]>())
  const refreshTimerRef = useRef<number | null>(null)

  useEffect(() => {
    currentSpaceIdRef.current = spaceId
  }, [showArchived, spaceId])

  const loadChats = useCallback(async () => {
    currentSpaceIdRef.current = spaceId
    const requestSeq = ++loadSeqRef.current
    const requestSpaceId = spaceId
    const isCurrentRequest = () => loadSeqRef.current === requestSeq && currentSpaceIdRef.current === requestSpaceId
    const applyChats = (nextChats: Chat[]) => {
      if (!isCurrentRequest()) return
      // Defense-in-depth: even though visibleChatsForSpace and the middleware
      // already filter sub-agent rows from the sidebar list, double-check
      // here so no upstream path can sneak a sub-agent session into the
      // main chat list. Krish reported sub-agents leaking into sidebar;
      // this guarantees they NEVER do regardless of which fetch path
      // populated nextChats.
      const filtered = nextChats.filter((chat) => {
        if (chat.isSubagent) return false
        if (chat.parentSessionKey) return false
        if (isSubagentSessionKey(chat.sessionKey)) return false
        return true
      })
      latestChatsRef.current = filtered
      if (requestSpaceId && !showArchived) chatsBySpaceRef.current.set(requestSpaceId, filtered)
      setChats(filtered)
      setPinnedChats(new Set(filtered.filter((c) => c.pinned).map((c) => c.id)))
    }
    try {
      if (!showArchived) {
        const cachedChats = await loadCachedChatsForSpace(requestSpaceId)
        if (cachedChats?.length && isCurrentRequest()) applyChats(cachedChats)
      }
      if (showArchived) {
        const result = await invoke<{ chats: Chat[] }>("middleware_chats_list", {
          input: { archived: true, spaceId: requestSpaceId ?? undefined },
        })
        if (!isCurrentRequest()) return
        applyChats((result.chats || []).filter((chat) => {
          if (!chat.archived) return false
          if (chat.isSubagent || chat.parentSessionKey || isSubagentSessionKey(chat.sessionKey)) return false
          return !requestSpaceId || chat.spaceId === requestSpaceId
        }))
        return
      }

      if (!requestSpaceId) return

      const active = await fetchChatsForSpace(requestSpaceId)
      if (!isCurrentRequest()) return
      applyChats(active)
    } catch (e) {
      if (!isCurrentRequest()) return
      const fallbackChats = await loadCachedChatsForSpace(requestSpaceId)
      if (fallbackChats?.length) applyChats(fallbackChats)
      console.error("[ChatsSection] load chats failed", e)
    }
  }, [showArchived, spaceId])

  const cacheChatsForCurrentSpace = useCallback((nextChats: Chat[]) => {
    if (showArchived) return
    const writeSpaceId = currentSpaceIdRef.current
    if (!writeSpaceId) return
    const scopedChats = visibleChatsForSpace(nextChats, writeSpaceId)
    void persistentCacheSet(`project:${writeSpaceId}:chats`, scopedChats, {
      ttlMs: SIDEBAR_CHAT_CACHE_TTL_MS,
    })
    void localSyncSetChats(
      writeSpaceId,
      scopedChats,
      undefined,
      SIDEBAR_CHAT_CACHE_TTL_MS,
    )
  }, [])

  const scheduleSidebarRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) return
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      void loadChats()
    }, 250)
  }, [loadChats])

  useEffect(() => {
    const spaceChanged = previousSpaceIdRef.current !== spaceId
    const previousSpaceId = previousSpaceIdRef.current
    if (spaceChanged && previousSpaceId && latestChatsRef.current.length) {
      chatsBySpaceRef.current.set(previousSpaceId, latestChatsRef.current)
    }
    previousSpaceIdRef.current = spaceId
    if (spaceChanged) {
      const remembered = spaceId ? chatsBySpaceRef.current.get(spaceId) : undefined
      latestChatsRef.current = remembered ?? []
      setChats(remembered ?? [])
      setPinnedChats(new Set((remembered ?? []).filter((c) => c.pinned).map((c) => c.id)))
    }
    loadChats()
    return () => {
      loadSeqRef.current += 1
    }
  }, [loadChats, refreshTrigger, spaceId])

  useEffect(() => {
    const unsubscribe = on("sidebar:refresh", loadChats)
    return () => {
      unsubscribe()
    }
  }, [loadChats])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (showArchived) return
    // Sidebar loader has two upstream sources that need to be UNIONed:
    //   1. chatActivityStore  — fed by the chat-engine-v2 store (legacy hook removed)
    //      used by some surfaces / sub-agent flows).
    //   2. activeRunRegistry  — fed by the v2 ChatView so its runs are visible
    //      to the sidebar even when ChatView is unmounted (the fix for
    //      cross-session response persistence).
    // Either source signaling "this session is generating" lights up the
    // ChatRow loader, so neither path can dark out the indicator.
    const refreshRunningSessions = () => {
      const legacyLive = getAllCachedChatActivity()
      const registryLive = activeRunRegistry.generatingSessionKeys()
      setRunningSessionKeys(
        new Set(
          chats
            .map((chat) => chat.sessionKey)
            .filter((sessionKey): sessionKey is string =>
              Boolean(
                sessionKey &&
                  (legacyLive.has(sessionKey) || registryLive.has(sessionKey)),
              ),
            ),
        ),
      )
    }
    refreshRunningSessions()
    const unsubscribeLegacy = subscribeChatActivity(refreshRunningSessions)
    const unsubscribeRegistry = activeRunRegistry.subscribeAll(
      refreshRunningSessions,
    )
    return () => {
      unsubscribeLegacy()
      unsubscribeRegistry()
    }
  }, [chats, showArchived])

  useEffect(() => {
    if (showArchived || !spaceId) return
    const subscriptionSpaceId = spaceId
    return localSyncSubscribeChats(subscriptionSpaceId, (state) => {
      if (currentSpaceIdRef.current !== subscriptionSpaceId) return
      const active = visibleChatsForSpace(state.chats || [], subscriptionSpaceId)
      if (active.length === 0) return
      setChats((prev) => {
        // Middleware/API ordering is the sidebar source of truth. Local sync is
        // only a fallback hydration path, so never let stale local cache reorder
        // an already-loaded API list.
        if (prev.length > 0) return prev
        setPinnedChats(new Set(active.filter((c) => c.pinned).map((c) => c.id)))
        return active
      })
    })
  }, [spaceId])

  useEffect(() => {
    function clearMiddlewareScopedChats() {
      setChats([])
      setChatOrder([])
      setPinnedChats(new Set())
      setRenameOpen(false)
      setRenameTarget(null)
      setDeleteOpen(false)
      setDeleteTarget(null)
      void loadChats()
    }
    window.addEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, clearMiddlewareScopedChats)
    return () => window.removeEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, clearMiddlewareScopedChats)
  }, [loadChats])

  useEffect(() => {
    return on<ForkCreateEvent>("fork:create", (event) => {
      if (!event || event.context?.type === "topic") return
      if (event.spaceId && currentSpaceIdRef.current && event.spaceId !== currentSpaceIdRef.current) return
      if (event.status === "pending") {
        const now = new Date().toISOString()
        const placeholder: Chat = {
          id: event.requestId,
          name: event.name || "Creating fork…",
          agentId: "main",
          archived: false,
          pinned: false,
          spaceId: event.spaceId ?? spaceId ?? undefined,
          createdAt: now,
          updatedAt: now,
          pendingFork: true,
        }
        setChats((prev) => visibleChatsForSpace([placeholder, ...prev.filter((chat) => chat.id !== event.requestId)], spaceId))
        setChatOrder((prev) => [event.requestId, ...prev.filter((id) => id !== event.requestId)])
        return
      }
      if (event.status === "resolved") {
        setChats((prev) => visibleChatsForSpace(prev.map((chat) => chat.id === event.requestId
          ? { ...chat, id: event.chatId ?? chat.id, name: event.name ?? chat.name, sessionKey: event.sessionKey, pendingFork: false, spaceId: event.spaceId ?? chat.spaceId ?? spaceId ?? undefined, updatedAt: new Date().toISOString() }
          : chat,
        ), spaceId))
        setChatOrder((prev) => prev.map((id) => id === event.requestId ? event.chatId ?? id : id))
        return
      }
      if (event.status === "failed") {
        setChats((prev) => prev.filter((chat) => chat.id !== event.requestId))
        setChatOrder((prev) => prev.filter((id) => id !== event.requestId))
      }
    })
  }, [spaceId])

  const updateChatPreviewWithoutReorder = useCallback((event?: ChatActivityEvent | null) => {
    const chatId = event?.chatId ?? activeChat?.id
    const sessionKey = event?.sessionKey ?? activeChat?.sessionKey
    if (!chatId && !sessionKey) return
    const knownChat = chats.some((chat) => {
      const matchesChat = chatId ? chat.id === chatId : false
      const matchesSession = sessionKey ? chat.sessionKey === sessionKey : false
      return matchesChat || matchesSession
    })

    if (typeof event?.lastMessageText === "string" && event.lastMessageText.trim()) {
      setChats((prev) => {
        let matched = false
        const next = prev.map((c) => {
          const matchesChat = chatId ? c.id === chatId : false
          const matchesSession = sessionKey ? c.sessionKey === sessionKey : false
          if (matchesChat || matchesSession) matched = true
          return matchesChat || matchesSession
            ? { ...c, lastMessageText: event.lastMessageText }
            : c
        })
        if (matched) cacheChatsForCurrentSpace(next)
        return next
      })
    }

    if (!knownChat) scheduleSidebarRefresh()
  }, [activeChat, cacheChatsForCurrentSpace, chats, scheduleSidebarRefresh])

  useEffect(() => {
    // Generic activity means thinking/tool/model/approval state and should not
    // reorder the sidebar.
    return on<ChatActivityEvent>("chat:activity", () => undefined)
  }, [])

  useEffect(() => {
    // Keep live preview text fresh, but do not mutate activity timestamps here.
    // The sidebar order should stay stable while the user is chatting; a full
    // reload/API refresh can still sort by persisted last activity time.
    return on<ChatMessageConfirmedEvent>("chat:message-confirmed", updateChatPreviewWithoutReorder)
  }, [updateChatPreviewWithoutReorder])

  useEffect(() => {
    if (renameOpen)
      setTimeout(() => renameRef.current?.focus(), 50)
  }, [renameOpen])

  const togglePinChat = useCallback(
    async (chatId: string) => {
      const chat = chats.find((c) => c.id === chatId)
      if (!chat) return
      const newPinned = !pinnedChats.has(chatId)
      setPinnedChats((prev) => {
        const next = new Set(prev)
        if (newPinned) {
          next.add(chatId)
          setChatOrder((o) => [
            chatId,
            ...o.filter((id) => id !== chatId),
          ])
        } else {
          next.delete(chatId)
          setChatOrder((order) => order.filter((id) => id !== chatId))
        }
        return next
      })
      try {
        invalidateMiddlewareStartupBootstrap()
        invalidateChatListCache(spaceId)
        await invoke("middleware_chats_update", {
          input: { chatId, pinned: newPinned },
        })
        invalidateChatListCache(spaceId)
      } catch (e) {
        console.error("pin chat failed", e)
      }
    },
    [chats, pinnedChats, spaceId],
  )

  const handleArchiveChat = useCallback(
    async (chatId: string) => {
      try {
        invalidateMiddlewareStartupBootstrap()
        invalidateChatListCache(spaceId)
        await invoke("middleware_chats_archive", {
          input: { chatId, archived: !showArchived },
        })
        invalidateChatListCache(spaceId)
        onChatClear(chatId)
        await loadChats()
        emit("archive:changed")
      } catch (e) {
        console.error("archive chat failed", e)
      }
    },
    [onChatClear, loadChats, spaceId],
  )

  const openRename = useCallback((chat: Chat) => {
    setRenameTarget(chat)
    setRenameName(chat.name)
    setRenameOpen(true)
  }, [])

  const handleRename = useCallback(async () => {
    if (!renameTarget || !renameName.trim()) return
    try {
      invalidateMiddlewareStartupBootstrap()
      invalidateChatListCache(spaceId)
      await invoke("middleware_chats_rename", {
        input: {
          chatId: renameTarget.id,
          name: renameName.trim(),
        },
      })
      invalidateChatListCache(spaceId)
      setRenameOpen(false)
      await loadChats()
    } catch (e) {
      console.error("rename chat failed", e)
    }
  }, [renameTarget, renameName, loadChats, spaceId])

  const openDelete = useCallback((chat: Chat) => {
    setDeleteTarget(chat)
    setDeleteOpen(true)
  }, [])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    const chatId = deleteTarget.id
    const sessionKey = deleteTarget.sessionKey
    setDeleting(true)
    try {
      invalidateMiddlewareStartupBootstrap()
      invalidateChatListCache(spaceId)
      setChats((prev) => {
        const next = prev.filter((chat) => chat.id !== chatId)
        if (spaceId) {
          void persistentCacheSet(`project:${spaceId}:chats`, next, {
            ttlMs: SIDEBAR_CHAT_CACHE_TTL_MS,
          })
          void localSyncSetChats(
            spaceId,
            next,
            undefined,
            SIDEBAR_CHAT_CACHE_TTL_MS,
          )
        }
        return next
      })
      setChatOrder((prev) => prev.filter((id) => id !== chatId))
      setPinnedChats((prev) => {
        const next = new Set(prev)
        next.delete(chatId)
        return next
      })
      await invoke("middleware_chats_delete", {
        input: { chatId },
      })
      invalidateChatListCache(spaceId)
      if (sessionKey) {
        clearCachedChatActivity(sessionKey)
        void deleteWarmChatCache(sessionKey)
      }
      setChats((prev) => {
        const next = prev.filter((chat) => chat.id !== chatId)
        if (spaceId) {
          void persistentCacheSet(`project:${spaceId}:chats`, next, {
            ttlMs: SIDEBAR_CHAT_CACHE_TTL_MS,
          })
          void localSyncSetChats(
            spaceId,
            next,
            undefined,
            SIDEBAR_CHAT_CACHE_TTL_MS,
          )
        }
        return next
      })
      setChatOrder((prev) => prev.filter((id) => id !== chatId))
      setPinnedChats((prev) => {
        const next = new Set(prev)
        next.delete(chatId)
        return next
      })
      setDeleteOpen(false)
      onChatClear(chatId)
      await loadChats()
    } catch (e) {
      console.error("delete chat failed", e)
      await loadChats()
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, loadChats, onChatClear, spaceId])

  const sortedChatIds = useMemo(() => {
    const activityOrdered = [...chats]
      .sort(compareChatsByActivity)
      .map((chat) => chat.id)
    const knownIds = new Set(activityOrdered)
    const ordered = [
      ...chatOrder.filter((id) => knownIds.has(id)),
      ...activityOrdered.filter((id) => !chatOrder.includes(id)),
    ]
    const pinned = ordered.filter((id) => pinnedChats.has(id))
    const unpinned = ordered.filter((id) => !pinnedChats.has(id))
    return [...pinned, ...unpinned]
  }, [chatOrder, pinnedChats, chats])

  const dialogState: ChatDialogState = {
    renameOpen,
    renameTarget,
    renameName,
    renameRef,
    deleteOpen,
    deleteTarget,
    deleting,
  }

  const dialogActions: ChatDialogActions = {
    setRenameOpen,
    setRenameName,
    openRename,
    handleRename,
    setDeleteOpen,
    openDelete,
    handleDelete,
  }

  return {
    chats,
    chatOrder,
    setChatOrder,
    pinnedChats,
    runningSessionKeys,
    sortedChatIds,
    togglePinChat,
    handleArchiveChat,
    loadChats,
    dialogState,
    dialogActions,
  }
}
