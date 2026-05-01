"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { invoke } from "@/lib/ipc"
import { on, emit } from "@/lib/events"
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

export function useChatsData(
  activeChat: ActiveChat | null,
  onChatClear: () => void,
  refreshTrigger = 0,
) {
  const [chats, setChats] = useState<Chat[]>([])
  const [chatOrder, setChatOrder] = useState<string[]>([])
  const [pinnedChats, setPinnedChats] = useState<Set<string>>(
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

  const loadChats = useCallback(async () => {
    try {
      const active =
        localStorage.getItem("jarvis.gatewayActive") === "true"
      if (!active) {
        setChats([])
        setPinnedChats(new Set())
        return
      }
    } catch {}
    try {
      const result = await invoke<{ chats: Chat[] }>(
        "middleware_chats_list",
        { input: {} },
      )
      const active = (result.chats || []).filter(
        (c) => !c.archived,
      )
      setChats(active)
      setPinnedChats(
        new Set(active.filter((c) => c.pinned).map((c) => c.id)),
      )
    } catch (e) {
      console.error("[ChatsSection] load chats failed", e)
    }
  }, [])

  useEffect(() => {
    loadChats()
  }, [loadChats, refreshTrigger])

  useEffect(() => on("sidebar:refresh", loadChats), [loadChats])

  useEffect(() => {
    return on("chat:activity", () => {
      if (!activeChat) return
      setChats((prev) =>
        prev.map((c) =>
          c.id === activeChat.id
            ? { ...c, updatedAt: new Date().toISOString() }
            : c,
        ),
      )
    })
  }, [activeChat])

  useEffect(() => {
    setChatOrder((prev) => {
      const existing = prev.filter((id) =>
        chats.some((c) => c.id === id),
      )
      const newOnes = chats
        .filter((c) => !prev.includes(c.id))
        .map((c) => c.id)
      return [...newOnes, ...existing]
    })
  }, [chats])

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
        await invoke("middleware_chats_archive", {
          input: { chatId },
        })
        if (activeChat?.id === chatId) onChatClear()
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
    setDeleting(true)
    try {
      await invoke("middleware_chats_delete", {
        input: { chatId: deleteTarget.id },
      })
      setDeleteOpen(false)
      if (activeChat?.id === deleteTarget.id) onChatClear()
      await loadChats()
    } catch (e) {
      console.error("delete chat failed", e)
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, loadChats, activeChat, onChatClear])

  const sortedChatIds = useMemo(() => {
    const pinned = chatOrder.filter((id) =>
      pinnedChats.has(id),
    )
    const unpinned = chats
      .filter((c) => !pinnedChats.has(c.id))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() -
          new Date(a.updatedAt).getTime(),
      )
      .map((c) => c.id)
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
    sortedChatIds,
    togglePinChat,
    handleArchiveChat,
    loadChats,
    dialogState,
    dialogActions,
  }
}
