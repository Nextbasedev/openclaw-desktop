"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { invoke } from "@/lib/ipc"
import { on, emit } from "@/lib/events"
import { localSyncGetChats, localSyncSetChats, localSyncSubscribeChats } from "@/lib/localFirstSync"
import { persistentCacheGet, persistentCacheSet } from "@/lib/persistentCache"
import { invalidateMiddlewareStartupBootstrap, loadMiddlewareStartupBootstrap } from "@/lib/startupBootstrap"
import { MIDDLEWARE_CONNECTION_CHANGED_EVENT } from "@/lib/middleware-client"
import { deleteWarmChatCache } from "@/lib/warmChatCache"
import { clearCachedChatActivity, getAllCachedChatActivity, subscribeChatActivity } from "@/lib/chatActivityStore"
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

function chatActivityTime(chat: Chat) {
  return Math.max(
    new Date(chat.updatedAt || 0).getTime() || 0,
    new Date(chat.lastActiveAt || 0).getTime() || 0,
    new Date(chat.lastMessageAt || 0).getTime() || 0,
    new Date(chat.createdAt || 0).getTime() || 0,
  )
}

function visibleChatsForSpace(chats: Chat[], spaceId?: string | null) {
  return chats.filter((chat) => {
    if (chat.archived) return false
    return !spaceId || chat.spaceId === spaceId
  })
}

export function useChatsData(
  activeChat: ActiveChat | null,
  onChatClear: (chatId?: string) => void,
  refreshTrigger = 0,
  spaceId?: string | null,
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
  const refreshTimerRef = useRef<number | null>(null)

  useEffect(() => {
    currentSpaceIdRef.current = spaceId
  }, [spaceId])

  const loadChats = useCallback(async () => {
    currentSpaceIdRef.current = spaceId
    const requestSeq = ++loadSeqRef.current
    const requestSpaceId = spaceId
    const isCurrentRequest = () => loadSeqRef.current === requestSeq && currentSpaceIdRef.current === requestSpaceId
    const applyChats = (nextChats: Chat[]) => {
      if (!isCurrentRequest()) return
      setChats(nextChats)
      setPinnedChats(new Set(nextChats.filter((c) => c.pinned).map((c) => c.id)))
    }
    try {
      const chatCacheKey = spaceId ? `project:${spaceId}:chats` : null
      const localChats = spaceId ? await localSyncGetChats(spaceId) : null
      const cachedChats = localChats?.chats ?? (chatCacheKey ? await persistentCacheGet<Chat[]>(chatCacheKey) : null)
      if (cachedChats) {
        const active = visibleChatsForSpace(cachedChats, spaceId)
        applyChats(active)
      }
      const bootstrap = await loadMiddlewareStartupBootstrap()
      if (bootstrap && (!spaceId || bootstrap.activeSpaceId === spaceId)) {
        const active = visibleChatsForSpace(bootstrap.chats || [], spaceId)
        if (active.length > 0) {
          applyChats(active)
        }
      }
      const result = await invoke<{ chats: Chat[] }>(
        "middleware_chats_list",
        { input: { spaceId: spaceId ?? undefined } },
      )
      const active = visibleChatsForSpace(result.chats || [], spaceId)
      if (!isCurrentRequest()) return
      if (spaceId) {
        void persistentCacheSet(`project:${spaceId}:chats`, active, {
          ttlMs: SIDEBAR_CHAT_CACHE_TTL_MS,
        })
        void localSyncSetChats(
          spaceId,
          active,
          undefined,
          SIDEBAR_CHAT_CACHE_TTL_MS,
        )
      }
      applyChats(active)
    } catch (e) {
      console.error("[ChatsSection] load chats failed", e)
    }
  }, [spaceId])

  const cacheChatsForCurrentSpace = useCallback((nextChats: Chat[]) => {
    if (!spaceId) return
    void persistentCacheSet(`project:${spaceId}:chats`, nextChats, {
      ttlMs: SIDEBAR_CHAT_CACHE_TTL_MS,
    })
    void localSyncSetChats(
      spaceId,
      nextChats,
      undefined,
      SIDEBAR_CHAT_CACHE_TTL_MS,
    )
  }, [spaceId])

  const scheduleSidebarRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) return
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      void loadChats()
    }, 250)
  }, [loadChats])

  useEffect(() => {
    setChats([])
    setPinnedChats(new Set())
    loadChats()
    return () => {
      loadSeqRef.current += 1
    }
  }, [loadChats, refreshTrigger])

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
    const refreshRunningSessions = () => {
      const live = getAllCachedChatActivity()
      setRunningSessionKeys(
        new Set(
          chats
            .map((chat) => chat.sessionKey)
            .filter((sessionKey): sessionKey is string => Boolean(sessionKey && live.has(sessionKey))),
        ),
      )
    }
    refreshRunningSessions()
    const unsubscribe = subscribeChatActivity(refreshRunningSessions)
    return () => {
      unsubscribe()
    }
  }, [chats])

  useEffect(() => {
    if (!spaceId) return
    const subscriptionSpaceId = spaceId
    return localSyncSubscribeChats(spaceId, (state) => {
      if (currentSpaceIdRef.current !== subscriptionSpaceId) return
      const active = visibleChatsForSpace(state.chats || [], spaceId)
      setChats(active)
      setPinnedChats(new Set(active.filter((c) => c.pinned).map((c) => c.id)))
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
      if (event.status === "pending") {
        const now = new Date().toISOString()
        const placeholder: Chat = {
          id: event.requestId,
          name: event.name || "Creating fork…",
          agentId: "main",
          archived: false,
          pinned: false,
          spaceId: spaceId ?? undefined,
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
          ? { ...chat, id: event.chatId ?? chat.id, name: event.name ?? chat.name, sessionKey: event.sessionKey, pendingFork: false, spaceId: chat.spaceId ?? spaceId ?? undefined, updatedAt: new Date().toISOString() }
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

  const bumpChatActivityTime = useCallback((event?: ChatActivityEvent | null) => {
    const chatId = event?.chatId ?? activeChat?.id
    const sessionKey = event?.sessionKey ?? activeChat?.sessionKey
    if (!chatId && !sessionKey) return
    const timestamp = event?.at && !Number.isNaN(Date.parse(event.at))
      ? event.at
      : new Date().toISOString()
    const targetId = chatId ?? chats.find((chat) => chat.sessionKey === sessionKey)?.id
    const knownChat = chats.some((chat) => {
      const matchesChat = chatId ? chat.id === chatId : false
      const matchesSession = sessionKey ? chat.sessionKey === sessionKey : false
      return matchesChat || matchesSession
    })
    setChats((prev) =>
      {
        let matched = false
        const next = prev.map((c) => {
        const matchesChat = chatId ? c.id === chatId : false
        const matchesSession = sessionKey ? c.sessionKey === sessionKey : false
        if (matchesChat || matchesSession) matched = true
        return matchesChat || matchesSession
          ? {
              ...c,
              updatedAt: timestamp,
              lastActiveAt: timestamp,
              lastMessageAt: timestamp,
              ...(typeof event?.lastMessageText === "string" && event.lastMessageText.trim()
                ? { lastMessageText: event.lastMessageText }
                : {}),
            }
          : c
        })
        if (matched) cacheChatsForCurrentSpace(next)
        return next
      },
    )
    if (targetId) {
      setChatOrder((prev) => [targetId, ...prev.filter((id) => id !== targetId)])
    }
    if (!knownChat) scheduleSidebarRefresh()
  }, [activeChat, cacheChatsForCurrentSpace, chats, scheduleSidebarRefresh])

  useEffect(() => {
    // Generic activity means thinking/tool/model/approval state and should not
    // reorder the sidebar. Reordering on every activity event caused the active
    // chat to jump while the optimistic user message was still settling.
    // Confirmed message events below are the intentional jump-to-top trigger.
    return on<ChatActivityEvent>("chat:activity", () => undefined)
  }, [])

  useEffect(() => {
    return on<ChatMessageConfirmedEvent>("chat:message-confirmed", bumpChatActivityTime)
  }, [bumpChatActivityTime])

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
        }
        return next
      })
      try {
        invalidateMiddlewareStartupBootstrap()
        await invoke("middleware_chats_update", {
          input: { chatId, pinned: newPinned },
        })
      } catch (e) {
        console.error("pin chat failed", e)
      }
    },
    [chats, pinnedChats],
  )

  const handleArchiveChat = useCallback(
    async (chatId: string) => {
      try {
        invalidateMiddlewareStartupBootstrap()
        await invoke("middleware_chats_archive", {
          input: { chatId },
        })
        if (activeChat?.id === chatId) onChatClear(chatId)
        await loadChats()
        emit("archive:changed")
      } catch (e) {
        console.error("archive chat failed", e)
      }
    },
    [activeChat, onChatClear, loadChats],
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
      await invoke("middleware_chats_rename", {
        input: {
          chatId: renameTarget.id,
          name: renameName.trim(),
        },
      })
      setRenameOpen(false)
      await loadChats()
    } catch (e) {
      console.error("rename chat failed", e)
    }
  }, [renameTarget, renameName, loadChats])

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
      if (activeChat?.id === chatId) onChatClear(chatId)
      await loadChats()
    } catch (e) {
      console.error("delete chat failed", e)
      await loadChats()
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, loadChats, activeChat, onChatClear, spaceId])

  const sortedChatIds = useMemo(() => {
    const activityOrdered = [...chats]
      .sort((a, b) => chatActivityTime(b) - chatActivityTime(a))
      .map((chat) => chat.id)
    const knownIds = new Set(activityOrdered)
    const ordered = [
      ...chatOrder.filter((id) => knownIds.has(id)),
      ...activityOrdered.filter((id) => !chatOrder.includes(id)),
    ]
    const pinned = ordered.filter((id) => pinnedChats.has(id))
    const unpinned = ordered.filter((id) => !pinnedChats.has(id))
    return [...pinned, ...unpinned]
  }, [pinnedChats, chats, chatOrder])

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
