"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import {
  LuCheck,
  LuChevronLeft,
  LuChevronRight,
  LuCopy,
  LuEllipsisVertical,
  LuPenLine,
  LuPin,
  LuRefreshCw,
  LuReply,
  LuThumbsDown,
  LuThumbsUp,
  LuX,
} from "react-icons/lu"
import { VscSend } from "react-icons/vsc"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { MenuAction } from "@/components/sidebar/ProjectsSection/MenuAction"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { MarkdownContent } from "./MarkdownContent"
import { RichContentPreview } from "./RichContentPreview"
import type { ChatMessage } from "./types"

function CopyButton({ text, className: cls }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "flex size-6 items-center justify-center rounded-md",
        "transition-colors duration-150",
        "cursor-pointer text-foreground/30 hover:text-foreground/60",
        cls,
      )}
    >
      {copied ? <LuCheck className="size-3.5" /> : <LuCopy className="size-3.5" />}
    </button>
  )
}

function formatTime(dateStr?: string): string | null {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return null
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  } catch {
    return null
  }
}

function BranchNav({
  branches,
  activeBranch,
  onSwitch,
}: {
  branches: NonNullable<ChatMessage["branches"]>
  activeBranch: number | undefined
  onSwitch: (index: number) => void
}) {
  const total = branches.length
  const current = activeBranch !== undefined ? activeBranch + 1 : total

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        disabled={current <= 1}
        onClick={() => onSwitch(current - 2)}
        className="flex size-6 cursor-pointer items-center justify-center rounded text-foreground/40 transition-colors hover:text-foreground/70 disabled:cursor-default disabled:opacity-30"
      >
        <LuChevronLeft className="size-3.5" />
      </button>
      <span className="text-[11px] tabular-nums text-muted-foreground/60">
        {current}/{total}
      </span>
      <button
        type="button"
        disabled={current >= total}
        onClick={() => onSwitch(current)}
        className="flex size-6 cursor-pointer items-center justify-center rounded text-foreground/40 transition-colors hover:text-foreground/70 disabled:cursor-default disabled:opacity-30"
      >
        <LuChevronRight className="size-3.5" />
      </button>
    </div>
  )
}

export function MessageBubble({
  message,
  onEdit,
  onSwitchBranch,
  onReply,
  onPin,
  onDelete,
  onRegenerate,
  onReact,
  onExport,
  isPinned,
  reaction,
  isGenerating,
  isActivelyStreaming,
  popoverOpen,
  onPopoverOpenChange,
}: {
  message: ChatMessage
  onEdit?: (messageId: string, newText: string) => void
  onSwitchBranch?: (messageId: string, branchIndex: number) => void
  onReply?: (messageId: string) => void
  onPin?: (messageId: string) => void
  onDelete?: (messageId: string) => void
  onRegenerate?: (messageId: string) => void
  onReact?: (messageId: string, reaction: "up" | "down") => void
  onExport?: (messageId: string) => void
  isPinned?: boolean
  reaction?: "up" | "down"
  isGenerating?: boolean
  isActivelyStreaming?: boolean
  popoverOpen?: boolean
  onPopoverOpenChange?: (open: boolean) => void
}) {
  const isUser = message.role === "user"
  const shouldAnimateSend = isUser && message.isOptimistic
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasBranches = message.branches && message.branches.length > 0

  const startEdit = useCallback(() => {
    setEditText(message.text)
    setEditing(true)
  }, [message.text])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setEditText("")
  }, [])

  const submitEdit = useCallback(() => {
    const trimmed = editText.trim()
    if (!trimmed || trimmed === message.text) {
      cancelEdit()
      return
    }
    onEdit?.(message.messageId, trimmed)
    setEditing(false)
    setEditText("")
  }, [editText, message.text, message.messageId, onEdit, cancelEdit])

  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
      ta.style.height = "auto"
      ta.style.height = `${ta.scrollHeight}px`
    }
  }, [editing])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        submitEdit()
      }
      if (e.key === "Escape") {
        cancelEdit()
      }
    },
    [submitEdit, cancelEdit],
  )

  return (
    <motion.div
      initial={shouldAnimateSend ? { opacity: 0, y: 12, scale: 0.985 } : false}
      animate={shouldAnimateSend ? { opacity: 1, y: 0, scale: 1 } : undefined}
      transition={shouldAnimateSend ? {
        duration: 0.16,
        ease: [0.22, 1, 0.36, 1],
      } : { duration: 0 }}
      className={cn(
        "group/msg flex w-full min-w-0 transform-gpu",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div className={cn("flex min-w-0 max-w-[85%] flex-col", isUser ? "items-end" : "w-[85%] items-start")}>
        {message.replyTo && (
          <button
            type="button"
            onClick={() => {
              document
                .getElementById(`message-${message.replyTo!.messageId}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
            }}
            className={cn(
              "mb-1 flex w-fit max-w-full cursor-pointer items-start gap-2 rounded-lg border border-border/20 bg-foreground/[0.03] px-2.5 py-1.5 text-left transition-colors hover:bg-foreground/[0.06]",
            )}
          >
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-medium text-muted-foreground/60">
                {message.replyTo.role === "user" ? "You" : "Assistant"}
              </span>
              <p className="line-clamp-2 text-[12px] leading-snug text-foreground/50">
                {message.replyTo.text.slice(0, 150)}
                {message.replyTo.text.length > 150 ? "…" : ""}
              </p>
            </div>
          </button>
        )}
        {isUser && editing ? (
          <div className="flex w-full min-w-[280px] flex-col gap-2 rounded-2xl border border-border/30 bg-foreground/5 p-3">
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => {
                setEditText(e.target.value)
                e.target.style.height = "auto"
                e.target.style.height = `${e.target.scrollHeight}px`
              }}
              onKeyDown={handleKeyDown}
              className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-foreground outline-none"
              rows={1}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-foreground/40 transition-colors hover:text-foreground/70"
              >
                <LuX className="size-4" />
              </button>
              <button
                type="button"
                onClick={submitEdit}
                className="flex size-7 cursor-pointer items-center justify-center rounded-lg bg-foreground text-background transition-colors hover:bg-foreground/80"
              >
                <VscSend className="size-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "min-w-0 max-w-full text-[14px] leading-relaxed",
              isUser
                ? "rounded-2xl rounded-tr-sm bg-[#252529] px-4 py-2.5 text-white"
                : "w-full text-foreground",
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.text}</p>
            ) : (
              <MarkdownContent text={message.text} embeds={message.embeds} />
            )}
            <RichContentPreview message={message} />
          </div>
        )}
        {isUser ? (
          <div className="mt-1 flex items-center gap-1 flex-row-reverse">
            {formatTime(message.createdAt) && (
              <span className="text-[10px] text-muted-foreground/40">
                {formatTime(message.createdAt)}
              </span>
            )}
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100">
              {!isGenerating && onEdit && !editing && (
                <button
                  type="button"
                  onClick={startEdit}
                  className="flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground/30 transition-colors hover:text-foreground/60"
                >
                  <LuPenLine className="size-3.5" />
                </button>
              )}
              <CopyButton text={message.text} />
              {onReply && (
                <button
                  type="button"
                  onClick={() => onReply(message.messageId)}
                  className="flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground/30 transition-colors hover:text-foreground/60"
                  aria-label="Reply"
                >
                  <LuReply className="size-3.5" />
                </button>
              )}
            </div>
            {hasBranches && !editing && onSwitchBranch && (
              <BranchNav
                branches={message.branches!}
                activeBranch={message.activeBranch}
                onSwitch={(idx) => onSwitchBranch(message.messageId, idx)}
              />
            )}
          </div>
        ) : (
          !isActivelyStreaming && (
            <div className="mt-1 flex items-center gap-2">
              {formatTime(message.createdAt) && (
                <span className="text-[10px] text-muted-foreground/40">
                  {formatTime(message.createdAt)}
                </span>
              )}
              <div className="flex items-center gap-0.5">
                {onReact && (
                  <div className="flex items-center gap-0.5">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {(reaction === "up" || !reaction) && (
                        <motion.button
                          key="up"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          type="button"
                          onClick={() => onReact(message.messageId, "up")}
                          className={cn(
                            "flex size-6 cursor-pointer items-center justify-center rounded-md transition-all",
                            reaction === "up"
                              ? "text-white"
                              : "text-foreground/30 hover:text-foreground/60"
                          )}
                          aria-label="Helpful"
                        >
                          {reaction === "up" ? (
                            <LuThumbsUp className="size-3.5 fill-white" />
                          ) : (
                            <LuThumbsUp className="size-3.5" />
                          )}
                        </motion.button>
                      )}

                      {(reaction === "down" || !reaction) && (
                        <motion.button
                          key="down"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          type="button"
                          onClick={() => onReact(message.messageId, "down")}
                          className={cn(
                            "flex size-6 cursor-pointer items-center justify-center rounded-md transition-all",
                            reaction === "down"
                              ? "text-white"
                              : "text-foreground/30 hover:text-foreground/60"
                          )}
                          aria-label="Not helpful"
                        >
                          {reaction === "down" ? (
                            <LuThumbsDown className="size-3.5 fill-white" />
                          ) : (
                            <LuThumbsDown className="size-3.5" />
                          )}
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </div>
                )}
                <CopyButton text={message.text} />
                {(onPin || onReply || (onRegenerate && !isGenerating)) && (
                  <Popover
                    open={popoverOpen}
                    onOpenChange={onPopoverOpenChange}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex size-6 cursor-pointer items-center justify-center rounded transition-all duration-100 text-foreground/30 hover:text-foreground/60"
                        aria-label="More actions"
                      >
                        <LuEllipsisVertical className="size-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      side="right"
                      sideOffset={4}
                      className={cn("w-36 gap-0 p-1", GLASS_POPOVER)}
                    >
                      {onPin && (
                        <MenuAction
                          label={isPinned ? "Unpin" : "Pin"}
                          icon={<LuPin className="size-3.5" />}
                          onClick={() => {
                            onPin(message.messageId)
                            onPopoverOpenChange?.(false)
                          }}
                        />
                      )}
                      {onReply && (
                        <MenuAction
                          label="Reply"
                          icon={<LuReply className="size-3.5" />}
                          onClick={() => {
                            onReply(message.messageId)
                            onPopoverOpenChange?.(false)
                          }}
                        />
                      )}
                      {onRegenerate && !isGenerating && (
                        <MenuAction
                          label="Regenerate"
                          icon={<LuRefreshCw className="size-3.5" />}
                          onClick={() => {
                            onRegenerate(message.messageId)
                            onPopoverOpenChange?.(false)
                          }}
                        />
                      )}
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
          )
        )}
      </div>
    </motion.div>
  )
}

export function TypingDots() {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/35"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
        />
      ))}
    </span>
  )
}
