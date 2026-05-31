"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion, AnimatePresence, Reorder } from "framer-motion"
import { Icons } from "@/components/icons"
import { useChatsData } from "@/hooks/useChatsData"
import { ChatRow } from "./ChatRow"
import { ChatDialogs } from "./ChatDialogs"
import { chatDisplayName } from "@/utils/chatDisplayName"
import type { ActiveChat } from "@/types/chat"

export type { ActiveChat }

type Props = {
  collapsed: boolean
  collapsible?: boolean
  sectionLabel?: string
  activeChat: ActiveChat | null
  onChatSelect: (chat: ActiveChat) => void
  onChatClear: (chatId?: string) => void
  onNewChat: () => void
  refreshTrigger?: number
  spaceId?: string | null
}

const CHAT_INITIAL_LIMIT = 5
const CHAT_LOAD_STEP = 10
const MORE_CHATS_ANIMATION_MS = 200

export function ChatsSection({
  collapsible = true,
  sectionLabel = "Chats",
  activeChat,
  onChatSelect,
  onChatClear,
  onNewChat,
  refreshTrigger = 0,
  spaceId,
}: Props) {
  const [isOpen, setIsOpen] = useState(true)
  const [visibleChatLimit, setVisibleChatLimit] = useState(CHAT_INITIAL_LIMIT)
  const [extraChatsOpen, setExtraChatsOpen] = useState(false)
  const [expandedChatIds, setExpandedChatIds] = useState<string[]>([])
  const closeTimerRef = useRef<number | null>(null)
  const showList = !collapsible || isOpen
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
  } = useChatsData(activeChat, onChatClear, refreshTrigger, spaceId)
  const chatsById = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat])),
    [chats],
  )
  const topChatIdSet = useMemo(
    () => new Set(sortedChatIds.slice(0, CHAT_INITIAL_LIMIT)),
    [sortedChatIds],
  )
  const visibleExtraChatIds = expandedChatIds.filter(
    (id) => sortedChatIds.includes(id) && !topChatIdSet.has(id),
  )
  const hiddenExtraChatIds = sortedChatIds
    .slice(CHAT_INITIAL_LIMIT)
    .filter((id) => !expandedChatIds.includes(id))
  const hasMoreChats = hiddenExtraChatIds.length > 0
  const hasExpandedChats = visibleExtraChatIds.length > 0

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setExpandedChatIds((prev) =>
        prev
          .filter((id) => sortedChatIds.includes(id) && !topChatIdSet.has(id))
          .slice(0, Math.max(0, visibleChatLimit - CHAT_INITIAL_LIMIT)),
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [sortedChatIds, topChatIdSet, visibleChatLimit])

  const handleShowMoreChats = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }

    setExtraChatsOpen(true)
    setExpandedChatIds((current) => {
      const currentSet = new Set(current)
      const next = [...current]
      for (const id of hiddenExtraChatIds) {
        if (next.length >= current.length + CHAT_LOAD_STEP) break
        if (!currentSet.has(id)) next.push(id)
      }
      setVisibleChatLimit(CHAT_INITIAL_LIMIT + next.length)
      return next
    })
  }

  const handleShowLessChats = () => {
    setExtraChatsOpen(false)
    closeTimerRef.current = window.setTimeout(() => {
      setExpandedChatIds([])
      setVisibleChatLimit(CHAT_INITIAL_LIMIT)
      closeTimerRef.current = null
    }, MORE_CHATS_ANIMATION_MS)
  }

  return (
    <>
      <div>
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2 px-1">
          {collapsible ? (
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              title={sectionLabel}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/70 transition-colors hover:text-foreground dark:text-muted-foreground/82"
            >
              <motion.span
                animate={{ rotate: isOpen ? 0 : -90 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="inline-flex items-center justify-center"
              >
                <Icons.ChevronDown size={12} />
              </motion.span>
              <span className="min-w-0 truncate">{sectionLabel}</span>
              <span className="rounded-full border border-black/[0.06] bg-black/[0.045] px-1.5 py-0.5 text-[9px] tabular-nums tracking-normal text-foreground/72 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-muted-foreground/76">
                {sortedChatIds.length}
              </span>
            </button>
          ) : (
            <span
              title={sectionLabel}
              className="min-w-0 flex-1 truncate px-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/70 dark:text-muted-foreground/82"
            >
              {sectionLabel}
            </span>
          )}
          <button
            type="button"
            onClick={onNewChat}
            title="New chat"
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-black/[0.06] bg-black/[0.035] text-foreground/62 transition-[background,color,transform] hover:-translate-y-px hover:bg-black/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/25 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-muted-foreground/70 dark:hover:bg-white/[0.07] dark:focus-visible:ring-cyan-300/25"
          >
            <Icons.Plus size={13} strokeWidth={2} />
          </button>
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
              <div className="flex flex-col gap-1">
                {chats.length === 0 && (
                  <button
                    type="button"
                    onClick={onNewChat}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-border/30 bg-white/[0.025] px-3 py-3 text-left text-[12px] text-muted-foreground/55 transition-colors hover:border-border/50 hover:text-muted-foreground"
                  >
                    <Icons.Plus size={12} strokeWidth={1.5} />
                    <span className="whitespace-nowrap">Start your first chat</span>
                  </button>
                )}

                <Reorder.Group
                  axis="y"
                  values={sortedChatIds.slice(0, CHAT_INITIAL_LIMIT)}
                  onReorder={(newVisible) => {
                    const hiddenTail = sortedChatIds.filter((id) => !newVisible.includes(id))
                    setChatOrder([...newVisible, ...hiddenTail])
                  }}
                  as="div"
                  className="flex flex-col gap-0.5"
                >
                  {sortedChatIds.slice(0, CHAT_INITIAL_LIMIT).map((chatId) => {
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
                        onClick={() =>
                          onChatSelect({
                            id: chat.id,
                            name: chatDisplayName(chat),
                            sessionKey: chat.sessionKey,
                          })
                        }
                        onPin={() => togglePinChat(chatId)}
                        onRename={() =>
                          dialogActions.openRename(chat)
                        }
                        onArchive={() =>
                          handleArchiveChat(chatId)
                        }
                        onDelete={() =>
                          dialogActions.openDelete(chat)
                        }
                      />
                    )
                  })}
                </Reorder.Group>
                {(hasExpandedChats || sortedChatIds.length > CHAT_INITIAL_LIMIT) && (
                  <div
                    aria-hidden={!extraChatsOpen}
                    className="grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-in-out"
                    style={{
                      gridTemplateRows: extraChatsOpen ? "1fr" : "0fr",
                      opacity: extraChatsOpen ? 1 : 0,
                    }}
                  >
                    <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                      {visibleExtraChatIds.map((chatId) => {
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
                            onClick={() =>
                              onChatSelect({
                                id: chat.id,
                                name: chatDisplayName(chat),
                                sessionKey: chat.sessionKey,
                              })
                            }
                            onPin={() => togglePinChat(chatId)}
                            onRename={() =>
                              dialogActions.openRename(chat)
                            }
                            onArchive={() =>
                              handleArchiveChat(chatId)
                            }
                            onDelete={() =>
                              dialogActions.openDelete(chat)
                            }
                          />
                        )
                      })}
                    </div>
                  </div>
                )}
                {sortedChatIds.length > CHAT_INITIAL_LIMIT && (
                  <div className="mt-0.5 flex items-center gap-1">
                    {hasMoreChats && (
                      <button
                        type="button"
                        onClick={handleShowMoreChats}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium text-foreground/58 transition-colors hover:bg-black/[0.035] hover:text-foreground dark:text-muted-foreground/62 dark:hover:bg-white/[0.035] dark:hover:text-muted-foreground"
                      >
                        <motion.span
                          animate={{ rotate: 0 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                          className="inline-flex items-center justify-center"
                        >
                          <Icons.ChevronDown size={11} />
                        </motion.span>
                        See more
                      </button>
                    )}
                    {hasExpandedChats && (
                      <button
                        type="button"
                        onClick={handleShowLessChats}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium text-foreground/58 transition-colors hover:bg-black/[0.035] hover:text-foreground dark:text-muted-foreground/62 dark:hover:bg-white/[0.035] dark:hover:text-muted-foreground"
                      >
                        <motion.span
                          animate={{ rotate: 180 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                          className="inline-flex items-center justify-center"
                        >
                          <Icons.ChevronDown size={11} />
                        </motion.span>
                        See less
                      </button>
                    )}
                    {!hasMoreChats && !hasExpandedChats && (
                      <button
                        type="button"
                        onClick={handleShowMoreChats}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium text-foreground/58 transition-colors hover:bg-black/[0.035] hover:text-foreground dark:text-muted-foreground/62 dark:hover:bg-white/[0.035] dark:hover:text-muted-foreground"
                      >
                        <motion.span
                          animate={{ rotate: 0 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                          className="inline-flex items-center justify-center"
                        >
                          <Icons.ChevronDown size={11} />
                        </motion.span>
                        See more
                      </button>
                    )}
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
