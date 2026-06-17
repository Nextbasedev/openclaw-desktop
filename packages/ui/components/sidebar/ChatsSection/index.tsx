"use client"

import { useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence, Reorder } from "framer-motion"
import { Icons } from "@/components/icons"
import { useChatsData } from "@/hooks/useChatsData"
import { ChatRow } from "./ChatRow"
import { ChatDialogs } from "./ChatDialogs"
import { invoke } from "@/lib/ipc"
import { chatDisplayName } from "@/utils/chatDisplayName"
import type { ActiveChat } from "@/types/chat"
import type { Space } from "@/types/space"

export type { ActiveChat }

type Props = {
  collapsed: boolean
  collapsible?: boolean
  sectionLabel?: string
  activeChat: ActiveChat | null
  onChatSelect: (chat: ActiveChat) => void
  onChatOpenInNewWindow?: (chat: ActiveChat) => void
  onChatClear: (chatId?: string) => void
  onNewChat: () => void
  refreshTrigger?: number
  spaceId?: string | null
}

const CHATS_PER_PAGE = 25

export function ChatsSection({
  collapsible = true,
  sectionLabel = "Chats",
  activeChat,
  onChatSelect,
  onChatOpenInNewWindow,
  onChatClear,
  onNewChat,
  refreshTrigger = 0,
  spaceId,
}: Props) {
  const [isOpen, setIsOpen] = useState(true)
  const [currentPage, setCurrentPage] = useState(0)
  const [showArchived, setShowArchived] = useState(false)
  const [archiveGroupOpen, setArchiveGroupOpen] = useState<Record<string, boolean>>({})
  const [spacesById, setSpacesById] = useState<Map<string, Space>>(new Map())
  const showList = !collapsible || isOpen
  const activeSectionLabel = showArchived ? "Archive" : sectionLabel
  const {
    chats,
    setChatOrder,
    pinnedChats,
    runningSessionKeys,
    sortedChatIds,
    togglePinChat,
    handleArchiveChat,
    dialogState,
    dialogActions,
  } = useChatsData(activeChat, onChatClear, refreshTrigger, spaceId, showArchived)
  const chatsById = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat])),
    [chats],
  )
  const totalPages = showArchived
    ? 1
    : Math.max(1, Math.ceil(sortedChatIds.length / CHATS_PER_PAGE))
  const safeCurrentPage = showArchived ? 0 : Math.min(currentPage, totalPages - 1)
  const pageStart = safeCurrentPage * CHATS_PER_PAGE
  const pageEnd = showArchived
    ? sortedChatIds.length
    : Math.min(pageStart + CHATS_PER_PAGE, sortedChatIds.length)
  const visibleChatIds = showArchived
    ? sortedChatIds
    : sortedChatIds.slice(pageStart, pageEnd)
  const groupedVisibleChatIds = useMemo(() => {
    if (!showArchived) return []
    const groups = new Map<string, { id: string; label: string; chatIds: string[] }>()
    for (const chatId of sortedChatIds) {
      const chat = chatsById.get(chatId)
      if (!chat) continue
      const groupId = chat.spaceId || "__unknown__"
      const space = chat.spaceId ? spacesById.get(chat.spaceId) : undefined
      const label = space?.name || "Unknown folder"
      const group = groups.get(groupId) ?? { id: groupId, label, chatIds: [] }
      group.chatIds.push(chatId)
      groups.set(groupId, group)
    }
    return Array.from(groups.values())
  }, [chatsById, showArchived, sortedChatIds, spacesById])
  const showPagination = !showArchived && sortedChatIds.length > CHATS_PER_PAGE

  useEffect(() => {
    function showArchivedChats() {
      setShowArchived(true)
      setCurrentPage(0)
      setArchiveGroupOpen({})
    }
    function showActiveChats() {
      setShowArchived(false)
      setCurrentPage(0)
      setArchiveGroupOpen({})
    }

    window.addEventListener("openclaw:show-archived-chats", showArchivedChats)
    window.addEventListener("openclaw:show-active-chats", showActiveChats)
    return () => {
      window.removeEventListener("openclaw:show-archived-chats", showArchivedChats)
      window.removeEventListener("openclaw:show-active-chats", showActiveChats)
    }
  }, [])

  useEffect(() => {
    if (currentPage > totalPages - 1) {
      setCurrentPage(Math.max(0, totalPages - 1))
    }
  }, [currentPage, totalPages])

  useEffect(() => {
    if (!showArchived) return
    setArchiveGroupOpen((prev) => {
      if (groupedVisibleChatIds.length === 0) return {}
      const next: Record<string, boolean> = {}
      let changed = false
      for (const [index, group] of groupedVisibleChatIds.entries()) {
        const hasExisting = Object.prototype.hasOwnProperty.call(prev, group.id)
        next[group.id] = hasExisting ? prev[group.id] : index === 0
        if (prev[group.id] !== next[group.id]) changed = true
      }
      if (Object.keys(prev).length !== groupedVisibleChatIds.length) changed = true
      return changed ? next : prev
    })
  }, [groupedVisibleChatIds, showArchived])

  useEffect(() => {
    if (!showArchived) return
    let cancelled = false
    invoke<{ spaces: Space[] }>("middleware_spaces_list", { input: {} })
      .then((result) => {
        if (cancelled) return
        setSpacesById(new Map((result.spaces || []).map((space) => [space.id, space])))
      })
      .catch((error) => {
        if (!cancelled) console.error("[ChatsSection] load archive spaces failed", error)
      })
    return () => {
      cancelled = true
    }
  }, [showArchived])

  return (
    <>
      <div>
        <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2 px-2.5">
          {collapsible ? (
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              title={activeSectionLabel}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground"
            >
              <motion.span
                animate={{ rotate: isOpen ? 0 : -90 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="inline-flex items-center justify-center"
              >
                <Icons.ChevronDown size={12} />
              </motion.span>
              <span className="min-w-0 truncate">{activeSectionLabel}</span>
            </button>
          ) : (
            <span
              title={activeSectionLabel}
              className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-widest text-foreground"
            >
              {activeSectionLabel}
            </span>
          )}
          {!showArchived && (
            <button
              type="button"
              onClick={onNewChat}
              title="New chat"
              className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground"
            >
              <Icons.Plus size={13} strokeWidth={2} />
            </button>
          )}
        </div>

        <AnimatePresence initial={false}>
          {showList && (
            <motion.div
              initial={collapsible ? { height: 0, opacity: 0 } : false}
              animate={{ height: "auto", opacity: 1 }}
              exit={collapsible ? { height: 0, opacity: 0 } : undefined}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-0.5 px-1">
                {chats.length === 0 && (
                  <button
                    type="button"
                    onClick={showArchived ? undefined : onNewChat}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/30 px-2.5 py-2 text-left text-[12px] text-muted-foreground/40 transition-colors hover:border-border/50 hover:text-muted-foreground"
                  >
                    {showArchived ? <Icons.Archive size={12} strokeWidth={1.5} /> : <Icons.Plus size={12} strokeWidth={1.5} />}
                    <span className="whitespace-nowrap">{showArchived ? "No archived chats" : "Start your first chat"}</span>
                  </button>
                )}

                {showArchived ? (
                  <div className="flex flex-col gap-2">
                    {groupedVisibleChatIds.map((group, index) => {
                      const defaultOpen = index === 0
                      const groupOpen = archiveGroupOpen[group.id] ?? defaultOpen

                      return (
                        <div key={group.id} className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              setArchiveGroupOpen((prev) => ({
                                ...prev,
                                [group.id]: !(prev[group.id] ?? defaultOpen),
                              }))
                            }
                            className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 pt-1 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground/55 transition-colors hover:text-muted-foreground"
                            aria-expanded={groupOpen}
                          >
                            <motion.span
                              animate={{ rotate: groupOpen ? 0 : -90 }}
                              transition={{ duration: 0.16, ease: "easeInOut" }}
                              className="inline-flex shrink-0 items-center justify-center"
                            >
                              <Icons.ChevronDown size={10} strokeWidth={2} />
                            </motion.span>
                            <span className="min-w-0 truncate">{group.label}</span>
                          </button>
                          <AnimatePresence initial={false}>
                            {groupOpen && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18, ease: "easeInOut" }}
                                className="overflow-hidden"
                              >
                                <div className="flex flex-col gap-0.5">
                                  {group.chatIds.map((chatId) => {
                                    const chat = chatsById.get(chatId)
                                    if (!chat) return null

                                    return (
                                      <ChatRow
                                        key={chatId}
                                        chatId={chatId}
                                        chat={chat}
                                        isActive={activeChat?.id === chatId}
                                        isPinned={pinnedChats.has(chatId)}
                                        isRunning={Boolean(chat.sessionKey && runningSessionKeys.has(chat.sessionKey))}
                                        disableReorder
                                        onClick={() => {
                                          onChatSelect({
                                            id: chat.id,
                                            name: chatDisplayName(chat),
                                            sessionKey: chat.sessionKey,
                                            spaceId: chat.spaceId,
                                          })
                                        }}
                                        onPin={() => togglePinChat(chatId)}
                                        onOpenInNewWindow={chat.sessionKey ? () =>
                                          onChatOpenInNewWindow?.({
                                            id: chat.id,
                                            name: chatDisplayName(chat),
                                            sessionKey: chat.sessionKey,
                                            spaceId: chat.spaceId,
                                          }) : undefined}
                                        onRename={() =>
                                          dialogActions.openRename(chat)
                                        }
                                        onArchive={() =>
                                          handleArchiveChat(chatId)
                                        }
                                        archiveLabel="Restore"
                                        onDelete={() =>
                                          dialogActions.openDelete(chat)
                                        }
                                      />
                                    )
                                  })}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <Reorder.Group
                    axis="y"
                    values={visibleChatIds}
                    onReorder={(newVisible) => {
                      const beforePage = sortedChatIds.slice(0, pageStart)
                      const afterPage = sortedChatIds.slice(pageEnd)
                      setChatOrder([...beforePage, ...newVisible, ...afterPage])
                    }}
                    as="div"
                    className="flex flex-col gap-0.5"
                  >
                    {visibleChatIds.map((chatId) => {
                    const chat = chatsById.get(chatId)
                    if (!chat) return null

                    return (
                      <ChatRow
                        key={chatId}
                        chatId={chatId}
                        chat={chat}
                        isActive={activeChat?.id === chatId}
                        isPinned={pinnedChats.has(chatId)}
                        isRunning={Boolean(chat.sessionKey && runningSessionKeys.has(chat.sessionKey))}
                        onClick={() => {
                          onChatSelect({
                            id: chat.id,
                            name: chatDisplayName(chat),
                            sessionKey: chat.sessionKey,
                            spaceId: chat.spaceId,
                          })
                        }}
                        onPin={() => togglePinChat(chatId)}
                        onOpenInNewWindow={chat.sessionKey ? () =>
                          onChatOpenInNewWindow?.({
                            id: chat.id,
                            name: chatDisplayName(chat),
                            sessionKey: chat.sessionKey,
                            spaceId: chat.spaceId,
                          }) : undefined}
                        onRename={() =>
                          dialogActions.openRename(chat)
                        }
                        onArchive={() =>
                          handleArchiveChat(chatId)
                        }
                        archiveLabel={chat.archived ? "Restore" : "Archive"}
                        onDelete={() =>
                          dialogActions.openDelete(chat)
                        }
                      />
                    )
                    })}
                  </Reorder.Group>
                )}
                {showPagination && (
                  <div className="mt-1 flex items-center justify-between gap-1 px-1 text-[11px] text-muted-foreground/60">
                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.max(0, page - 1))}
                      disabled={safeCurrentPage === 0}
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-secondary/60 hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/60"
                      aria-label="Previous chats page"
                    >
                      <Icons.ChevronDown size={12} className="rotate-90" />
                    </button>
                    <span className="min-w-0 flex-1 truncate text-center tabular-nums">
                      {pageStart + 1}-{pageEnd} of {sortedChatIds.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.min(totalPages - 1, page + 1))}
                      disabled={safeCurrentPage >= totalPages - 1}
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-secondary/60 hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/60"
                      aria-label="Next chats page"
                    >
                      <Icons.ChevronDown size={12} className="-rotate-90" />
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ChatDialogs
        dialog={dialogState}
        actions={dialogActions}
      />
    </>
  )
}
