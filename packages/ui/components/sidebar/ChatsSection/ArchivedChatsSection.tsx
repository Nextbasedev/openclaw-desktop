"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Icons } from "@/components/icons"
import { invoke } from "@/lib/ipc"
import { emit, on } from "@/lib/events"
import { invalidateMiddlewareStartupBootstrap } from "@/lib/startupBootstrap"
import { invalidateChatListCache } from "@/lib/chatListCache"
import { isSubagentSessionKey } from "@/lib/subagentSession"
import { chatDisplayName } from "@/utils/chatDisplayName"
import { ChatRow } from "./ChatRow"
import { ChatDialogs } from "./ChatDialogs"
import type { Chat, ActiveChat } from "@/types/chat"
import type { Space } from "@/types/space"

type Props = {
  sectionLabel?: string
  activeSpaceId?: string | null
  spaces: Space[]
  onChatSelect: (chat: ActiveChat) => void
  onChatOpenInNewWindow?: (chat: ActiveChat) => void
  refreshTrigger?: number
}

type DialogTarget = Chat | null

function chatActivityValue(chat: Chat) {
  const candidates = [chat.updatedAt, chat.lastActiveAt, chat.lastMessageAt, chat.createdAt]
  let max = 0
  for (const value of candidates) {
    if (!value) continue
    const parsed = new Date(value).getTime()
    if (Number.isFinite(parsed) && parsed > max) max = parsed
  }
  return max
}

function isVisibleArchivedChat(chat: Chat) {
  if (!chat.archived) return false
  if (chat.isSubagent || chat.parentSessionKey) return false
  if (isSubagentSessionKey(chat.sessionKey)) return false
  return true
}

const UNASSIGNED_KEY = "__no_space__"

export function ArchivedChatsSection({
  sectionLabel = "Archived",
  activeSpaceId,
  spaces,
  onChatSelect,
  onChatOpenInNewWindow,
  refreshTrigger = 0,
}: Props) {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<DialogTarget>(null)
  const [renameName, setRenameName] = useState("")
  const [renameOpen, setRenameOpen] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)
  const [deleteTarget, setDeleteTarget] = useState<DialogTarget>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [archiveGroupOpen, setArchiveGroupOpen] = useState<Record<string, boolean>>({})
  const [archiveSpaces, setArchiveSpaces] = useState<Space[]>([])
  const loadSeqRef = useRef(0)

  const loadArchived = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setError(null)
    try {
      const result = await invoke<{ chats: Chat[] }>("middleware_chats_list", {
        input: { archived: true, all: true },
      })
      if (loadSeqRef.current !== seq) return
      const visible = (result.chats || []).filter(isVisibleArchivedChat)
      setChats(visible)
      setLoading(false)
    } catch (err) {
      if (loadSeqRef.current !== seq) return
      console.error("[ArchivedChats] load failed", err)
      setError("Couldn't load archived chats.")
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void loadArchived()
    return () => {
      loadSeqRef.current += 1
    }
  }, [loadArchived, refreshTrigger])

  useEffect(() => on("sidebar:refresh", loadArchived), [loadArchived])
  useEffect(() => on("archive:changed", loadArchived), [loadArchived])

  useEffect(() => {
    let cancelled = false
    invoke<{ spaces: Space[] }>("middleware_spaces_list", { input: { archived: true } })
      .then((result) => {
        if (cancelled) return
        setArchiveSpaces(result.spaces || [])
      })
      .catch((err) => {
        if (!cancelled) console.error("[ArchivedChats] load archived spaces failed", err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const spaceNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const space of spaces) map.set(space.id, space.name || "Project")
    for (const space of archiveSpaces) map.set(space.id, space.name || "Project")
    return map
  }, [spaces, archiveSpaces])

  const grouped = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; spaceId: string | null; chats: Chat[] }>()
    for (const chat of chats) {
      const key = chat.spaceId ?? UNASSIGNED_KEY
      const label = chat.spaceId ? (spaceNameById.get(chat.spaceId) ?? "Project") : "Other"
      let bucket = byKey.get(key)
      if (!bucket) {
        bucket = { key, label, spaceId: chat.spaceId ?? null, chats: [] }
        byKey.set(key, bucket)
      }
      bucket.chats.push(chat)
    }
    for (const bucket of byKey.values()) {
      bucket.chats.sort((a, b) => chatActivityValue(b) - chatActivityValue(a))
    }
    const sortedKeys = Array.from(byKey.keys()).sort((a, b) => {
      if (a === activeSpaceId) return -1
      if (b === activeSpaceId) return 1
      if (a === UNASSIGNED_KEY) return 1
      if (b === UNASSIGNED_KEY) return -1
      return (byKey.get(a)?.label || "").localeCompare(byKey.get(b)?.label || "")
    })
    return sortedKeys.map((key) => byKey.get(key)!).filter(Boolean)
  }, [chats, spaceNameById, activeSpaceId])

  useEffect(() => {
    setArchiveGroupOpen((prev) => {
      if (grouped.length === 0) return {}
      const next: Record<string, boolean> = {}
      let changed = Object.keys(prev).length !== grouped.length
      for (const group of grouped) {
        const hasExisting = Object.prototype.hasOwnProperty.call(prev, group.key)
        next[group.key] = hasExisting ? prev[group.key] : false
        if (prev[group.key] !== next[group.key]) changed = true
      }
      return changed ? next : prev
    })
  }, [grouped])

  const handleRestoreChat = useCallback(async (chat: Chat) => {
    const chatId = chat.id
    setChats((prev) => prev.filter((entry) => entry.id !== chatId))
    try {
      invalidateMiddlewareStartupBootstrap()
      invalidateChatListCache(chat.spaceId ?? null)
      await invoke("middleware_chats_archive", { input: { chatId, archived: false } })
      invalidateChatListCache(chat.spaceId ?? null)
      emit("archive:changed")
    } catch (err) {
      console.error("[ArchivedChats] restore failed", err)
      await loadArchived()
    }
  }, [loadArchived])

  const openRename = useCallback((chat: Chat) => {
    setRenameTarget(chat)
    setRenameName(chat.name)
    setRenameOpen(true)
  }, [])

  const handleRename = useCallback(async () => {
    if (!renameTarget || !renameName.trim()) return
    try {
      invalidateMiddlewareStartupBootstrap()
      invalidateChatListCache(renameTarget.spaceId ?? null)
      await invoke("middleware_chats_rename", {
        input: { chatId: renameTarget.id, name: renameName.trim() },
      })
      setRenameOpen(false)
      setRenameTarget(null)
      await loadArchived()
    } catch (err) {
      console.error("[ArchivedChats] rename failed", err)
    }
  }, [renameTarget, renameName, loadArchived])

  const openDelete = useCallback((chat: Chat) => {
    setDeleteTarget(chat)
    setDeleteOpen(true)
  }, [])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    const chatId = deleteTarget.id
    const spaceId = deleteTarget.spaceId ?? null
    setDeleting(true)
    try {
      invalidateMiddlewareStartupBootstrap()
      invalidateChatListCache(spaceId)
      setChats((prev) => prev.filter((entry) => entry.id !== chatId))
      await invoke("middleware_chats_delete", { input: { chatId } })
      invalidateChatListCache(spaceId)
      emit("archive:changed")
      setDeleteOpen(false)
      setDeleteTarget(null)
    } catch (err) {
      console.error("[ArchivedChats] delete failed", err)
      await loadArchived()
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, loadArchived])

  const dialogState = {
    renameOpen,
    renameTarget,
    renameName,
    renameRef,
    deleteOpen,
    deleteTarget,
    deleting,
  }

  const dialogActions = {
    setRenameOpen,
    setRenameName,
    openRename,
    handleRename,
    setDeleteOpen,
    openDelete,
    handleDelete,
  }

  const totalCount = chats.length

  return (
    <>
      <div>
        <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2 px-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground">
            <Icons.Archive size={11} strokeWidth={1.75} className="shrink-0 text-muted-foreground/70" />
            <span className="min-w-0 truncate">{sectionLabel}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 px-1">
          {loading && (
            <div className="flex flex-col gap-1 px-1.5 py-1">
              {[0, 1, 2].map((idx) => (
                <div
                  key={idx}
                  className="h-7 w-full animate-pulse rounded-md bg-foreground/[0.04]"
                />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-dashed border-border/40 px-2.5 py-2 text-[12px] text-muted-foreground">
              {error}
              <button
                type="button"
                onClick={() => {
                  setLoading(true)
                  void loadArchived()
                }}
                className="ml-2 cursor-pointer text-foreground underline-offset-2 hover:underline"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && totalCount === 0 && (
            <div className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border/30 px-2.5 py-2 text-[12px] text-muted-foreground/60">
              <Icons.Archive size={12} strokeWidth={1.5} />
              <span>No archived chats</span>
            </div>
          )}

          {!loading && !error && grouped.map((group) => {
            const groupOpen = archiveGroupOpen[group.key] ?? false

            return (
              <div key={group.key} className="flex flex-col">
                <button
                  type="button"
                  onClick={() =>
                    setArchiveGroupOpen((prev) => ({
                      ...prev,
                      [group.key]: !(prev[group.key] ?? false),
                    }))
                  }
                  className="mb-0.5 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 pt-1 text-left transition-colors hover:text-foreground/85"
                  aria-expanded={groupOpen}
                >
                  <span className="inline-flex shrink-0 items-center justify-center">
                    <Icons.ChevronDown
                      size={10}
                      strokeWidth={2}
                      className={groupOpen ? "" : "-rotate-90"}
                    />
                  </span>
                  <span
                    title={group.label}
                    className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70"
                  >
                    {group.label}
                  </span>
                </button>
                {groupOpen && (
                  <div className="flex flex-col gap-0.5">
                    {group.chats.map((chat) => (
                      <ChatRow
                        key={chat.id}
                        chatId={chat.id}
                        chat={chat}
                        isActive={false}
                        isPinned={false}
                        isRunning={false}
                        disableReorder
                        onClick={() => {
                          onChatSelect({
                            id: chat.id,
                            name: chatDisplayName(chat),
                            sessionKey: chat.sessionKey,
                            spaceId: chat.spaceId,
                          })
                        }}
                        onPin={() => {}}
                        onOpenInNewWindow={chat.sessionKey ? () =>
                          onChatOpenInNewWindow?.({
                            id: chat.id,
                            name: chatDisplayName(chat),
                            sessionKey: chat.sessionKey,
                            spaceId: chat.spaceId,
                          }) : undefined}
                        onRename={() => openRename(chat)}
                        onArchive={() => handleRestoreChat(chat)}
                        archiveLabel="Restore"
                        onDelete={() => openDelete(chat)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <ChatDialogs dialog={dialogState} actions={dialogActions} />
    </>
  )
}
