"use client"

import { useState } from "react"
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
}

const CHAT_INITIAL_LIMIT = 5

export function ChatsSection({
  collapsed,
  collapsible = true,
  activeChat,
  onChatSelect,
  onChatClear,
  onNewChat,
  refreshTrigger = 0,
}: Props) {
  const [isOpen, setIsOpen] = useState(true)
  const [showAllChats, setShowAllChats] = useState(false)
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
  } = useChatsData(activeChat, onChatClear, refreshTrigger)

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
                    const chat = chats.find(
                      (c) => c.id === chatId,
                    )
                    if (!chat) return null

                    return (
                      <ChatRow
                        key={chatId}
                        chatId={chatId}
                        chats={chats}
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
                <AnimatePresence initial={false}>
                  {showAllChats && sortedChatIds.length > CHAT_INITIAL_LIMIT && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-col gap-0.5">
                        {sortedChatIds.slice(CHAT_INITIAL_LIMIT).map((chatId) => {
                          const chat = chats.find(
                            (c) => c.id === chatId,
                          )
                          if (!chat) return null

                          return (
                            <ChatRow
                              key={chatId}
                              chatId={chatId}
                              chats={chats}
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
                    </motion.div>
                  )}
                </AnimatePresence>
                {sortedChatIds.length > CHAT_INITIAL_LIMIT && (
                  <button
                    onClick={() => setShowAllChats((prev) => !prev)}
                    className="mt-0.5 flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                  >
                    <motion.span
                      animate={{ rotate: showAllChats ? 180 : 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="inline-flex items-center justify-center"
                    >
                      <Icons.ChevronDown size={11} />
                    </motion.span>
                    {showAllChats
                      ? "Show less"
                      : `${sortedChatIds.length - CHAT_INITIAL_LIMIT} more`}
                  </button>
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
