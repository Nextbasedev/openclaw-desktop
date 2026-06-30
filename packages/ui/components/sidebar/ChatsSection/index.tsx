"use client"

import { useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence, Reorder } from "framer-motion"
import { Icons } from "@/components/icons"
import { useChatsData } from "@/hooks/useChatsData"
import { ChatRow } from "./ChatRow"
import { ChatDialogs } from "./ChatDialogs"
import { ArchivedChatsSection } from "./ArchivedChatsSection"
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
  spaces?: Space[]
}

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
  spaces = [],
}: Props) {
  const [isOpen, setIsOpen] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
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
  } = useChatsData(activeChat, onChatClear, refreshTrigger, spaceId, false)
  const chatsById = useMemo(
    () => new Map(chats.map((chat) => [chat.id, chat])),
    [chats],
  )

  useEffect(() => {
    function showArchivedChats() {
      setShowArchived(true)
    }
    function showActiveChats() {
      setShowArchived(false)
    }

    window.addEventListener("openclaw:show-archived-chats", showArchivedChats)
    window.addEventListener("openclaw:show-active-chats", showActiveChats)
    return () => {
      window.removeEventListener("openclaw:show-archived-chats", showArchivedChats)
      window.removeEventListener("openclaw:show-active-chats", showActiveChats)
    }
  }, [])

  useEffect(() => {
    setShowArchived(false)
  }, [spaceId])

  if (showArchived) {
    return (
      <ArchivedChatsSection
        sectionLabel="Archived"
        activeSpaceId={spaceId}
        spaces={spaces}
        onChatSelect={onChatSelect}
        onChatOpenInNewWindow={onChatOpenInNewWindow}
        refreshTrigger={refreshTrigger}
      />
    )
  }

  return (
    <>
      <div>
        <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2 px-2.5">
          {collapsible ? (
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              title={sectionLabel}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground"
            >
              <motion.span
                animate={{ rotate: isOpen ? 0 : -90 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="inline-flex items-center justify-center"
              >
                <Icons.ChevronDown size={12} />
              </motion.span>
              <span className="min-w-0 truncate">{sectionLabel}</span>
            </button>
          ) : (
            <span
              title={sectionLabel}
              className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-widest text-foreground"
            >
              {sectionLabel}
            </span>
          )}
          <button
            type="button"
            onClick={onNewChat}
            title="New chat"
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-foreground"
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
                    type="button"
                    onClick={onNewChat}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/30 px-2.5 py-2 text-left text-[12px] text-muted-foreground/40 transition-colors hover:border-border/50 hover:text-muted-foreground"
                  >
                    <Icons.Plus size={12} strokeWidth={1.5} />
                    <span className="whitespace-nowrap">Start your first chat</span>
                  </button>
                )}

                <Reorder.Group
                  axis="y"
                  values={sortedChatIds}
                  onReorder={setChatOrder}
                  as="div"
                  className="flex flex-col gap-0.5"
                >
                  {sortedChatIds.map((chatId) => {
                    const chat = chatsById.get(chatId)
                    if (!chat) return null

                    return (
                      <ChatRow
                        key={chatId}
                        chatId={chatId}
                        chat={chat}
                        isActive={
                          activeChat?.id === chatId ||
                          Boolean(
                            activeChat?.sessionKey &&
                              chat.sessionKey &&
                              activeChat.sessionKey === chat.sessionKey,
                          )
                        }
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
                        archiveLabel="Archive"
                        onDelete={() =>
                          dialogActions.openDelete(chat)
                        }
                      />
                    )
                  })}
                </Reorder.Group>
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
