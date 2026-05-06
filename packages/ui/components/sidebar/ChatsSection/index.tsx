"use client"

import { useMemo, useRef, useState } from "react"
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
  activeChat: ActiveChat | null
  onChatSelect: (chat: ActiveChat) => void
  onChatClear: () => void
  onNewChat: () => void
  refreshTrigger?: number
  spaceId?: string | null
}

const CHAT_INITIAL_LIMIT = 5
const CHAT_LOAD_STEP = 10
const MORE_CHATS_ANIMATION_MS = 200

export function ChatsSection({
  collapsible = true,
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
  const closeTimerRef = useRef<number | null>(null)
  const showList = !collapsible || isOpen
  const {
    chats,
    setChatOrder,
    pinnedChats,
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
  const effectiveVisibleChatLimit = Math.min(
    visibleChatLimit,
    sortedChatIds.length,
  )
  const hasMoreChats = sortedChatIds.length > effectiveVisibleChatLimit
  const hasExpandedChats = effectiveVisibleChatLimit > CHAT_INITIAL_LIMIT
  const visibleExtraChatIds = sortedChatIds.slice(
    CHAT_INITIAL_LIMIT,
    effectiveVisibleChatLimit,
  )

  const handleShowMoreChats = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }

    setExtraChatsOpen(true)
    setVisibleChatLimit((currentLimit) =>
      Math.min(currentLimit + CHAT_LOAD_STEP, sortedChatIds.length),
    )
  }

  const handleShowLessChats = () => {
    setExtraChatsOpen(false)
    closeTimerRef.current = window.setTimeout(() => {
      setVisibleChatLimit(CHAT_INITIAL_LIMIT)
      closeTimerRef.current = null
    }, MORE_CHATS_ANIMATION_MS)
  }

  return (
    <>
      <div>
        <div className="mb-1.5 flex items-center justify-between px-2.5">
          {collapsible ? (
            <button
              onClick={() => setIsOpen((prev) => !prev)}
              className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground"
            >
              <motion.span
                animate={{ rotate: isOpen ? 0 : -90 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="inline-flex items-center justify-center"
              >
                <Icons.ChevronDown size={12} />
              </motion.span>
              Chats
            </button>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground">
              Chats
            </span>
          )}
          <button
            onClick={onNewChat}
            title="New chat"
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground"
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
              <div className="flex flex-col gap-0.5 px-1">
                {chats.length === 0 && (
                  <button
                    onClick={onNewChat}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/30 px-2.5 py-2 text-left text-[12px] text-muted-foreground/40 transition-colors hover:border-border/50 hover:text-muted-foreground"
                  >
                    <Icons.Plus size={12} strokeWidth={1.5} />
                    <span>Start your first chat</span>
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
                        onClick={handleShowMoreChats}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
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
                        onClick={handleShowLessChats}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
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
                        onClick={handleShowMoreChats}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
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
