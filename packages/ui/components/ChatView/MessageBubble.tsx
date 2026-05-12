"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { createPortal } from "react-dom"
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
  LuArrowUp,
  LuMessageSquarePlus,
  LuPaperclip,
  LuReply,
  LuThumbsDown,
  LuX,
  LuGitFork,
  LuLoader,
  LuShieldCheck,
  LuTerminal,
} from "react-icons/lu"
import { VscSend } from "react-icons/vsc"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { MenuAction } from "@/components/sidebar/ProjectsSection/MenuAction"
import { GLASS_POPOVER } from "@/constants/glassPopover"
import { MarkdownContent } from "./MarkdownContent"
import { RichContentPreview } from "./RichContentPreview"
import type { ChatMessage } from "./types"
import { getSlashCommandName } from "@/lib/controlSlashCommands"

type ApprovalDecision = "allow-once" | "allow-always" | "deny"

type ApprovalPrompt = {
  id: string
  command?: string
  decisions: ApprovalDecision[]
}

function parseApprovalPrompt(text: string): ApprovalPrompt | null {
  if (!text.includes("/approve")) return null
  if (!/Approval (needed|required)/i.test(text)) return null

  const approveMatch = text.match(
    /\/approve(?:@[^\s]+)?\s+([^\s]+)\s+([^\n]+)/i
  )
  const id = approveMatch?.[1]?.trim()
  if (!id) return null

  const rawDecisionText = approveMatch?.[2] ?? "allow-once|deny"
  const parsedDecisions = rawDecisionText
    .split(/\||\s+/)
    .map((item) => item.trim().toLowerCase())
    .map((item) => (item === "always" ? "allow-always" : item))
    .filter(
      (item): item is ApprovalDecision =>
        item === "allow-once" || item === "allow-always" || item === "deny"
    )

  const decisions = Array.from(
    new Set<ApprovalDecision>([...parsedDecisions, "deny"])
  )

  const fencedCommand =
    text.match(
      /Pending command:\s*```(?:sh|bash|shell)?\s*\n([\s\S]*?)\n```/i
    )?.[1] ??
    text.match(/Command:\s*```(?:sh|bash|shell)?\s*\n([\s\S]*?)\n```/i)?.[1]
  const plainCommand = text.match(
    /Approval needed to run:\s*\n+(?:Shell|Bash|sh)?\s*\n+([\s\S]*?)\n+Reply with:/i
  )?.[1]

  return {
    id,
    command: (fencedCommand ?? plainCommand)?.trim(),
    decisions,
  }
}

function approvalDecisionLabel(decision: ApprovalDecision) {
  if (decision === "allow-once") return "Approve once"
  if (decision === "allow-always") return "Always allow"
  return "Decline"
}

function ApprovalPromptCard({
  approval,
  onResolve,
}: {
  approval: ApprovalPrompt
  onResolve?: (
    approvalId: string,
    decision: ApprovalDecision
  ) => Promise<void> | void
}) {
  const [resolving, setResolving] = useState<ApprovalDecision | null>(null)
  const [resolved, setResolved] = useState<ApprovalDecision | null>(null)

  async function resolve(decision: ApprovalDecision) {
    if (!onResolve || resolving || resolved) return
    setResolving(decision)
    try {
      await onResolve(approval.id, decision)
      setResolved(decision)
    } finally {
      setResolving(null)
    }
  }

  return (
    <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.035] p-3">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-amber-200/90">
        <LuShieldCheck className="size-4" />
        Command approval required
      </div>
      {approval.command && (
        <div className="mb-3 overflow-hidden rounded-md border border-border/20 bg-black/30">
          <div className="flex items-center gap-1.5 border-b border-border/15 px-2.5 py-1.5 text-[11px] text-muted-foreground/60">
            <LuTerminal className="size-3.5" />
            Shell
          </div>
          <pre className="max-h-40 overflow-auto px-3 py-2 text-[12px] leading-relaxed text-foreground/80">
            {approval.command}
          </pre>
        </div>
      )}
      {resolved ? (
        <div className="text-[12px] text-muted-foreground">
          {resolved === "deny" ? "Declined" : "Approved"}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {approval.decisions.map((decision) => (
            <button
              key={decision}
              type="button"
              disabled={!onResolve || Boolean(resolving)}
              onClick={() => void resolve(decision)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                decision === "deny"
                  ? "bg-red-400/10 text-red-300 hover:bg-red-400/15"
                  : "bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15"
              )}
            >
              {resolving === decision && (
                <LuLoader className="size-3 animate-spin" />
              )}
              {approvalDecisionLabel(decision)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CopyButton({
  text,
  className: cls,
}: {
  text: string
  className?: string
}) {
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
        "cursor-pointer text-foreground/30 hover:text-white",
        cls
      )}
    >
      {copied ? (
        <LuCheck className="size-3.5" />
      ) : (
        <LuCopy className="size-3.5" />
      )}
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

function formatTokenCount(value?: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return null
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000)
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

function ResponseMetadata({ message }: { message: ChatMessage }) {
  const usage = message.usage
  const total = formatTokenCount(usage?.total)
  const hasDetails = Boolean(message.model || total || message.stopReason)
  if (!hasDetails) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground/45 transition-colors hover:bg-foreground/5 hover:text-muted-foreground"
          aria-label="Response metadata"
        >
          {[message.model, total ? `${total} tokens` : null]
            .filter(Boolean)
            .join(" • ")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={4}
        className={cn("w-64 p-3 text-[11px]", GLASS_POPOVER)}
      >
        <div className="space-y-2">
          {message.model && (
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground/60">Model</span>
              <span className="truncate font-mono text-foreground/80">
                {message.model}
              </span>
            </div>
          )}
          {usage && (
            <div className="space-y-1 border-t border-border/20 pt-2">
              {(
                [
                  ["Input", usage.input],
                  ["Output", usage.output],
                  ["Cache read", usage.cacheRead],
                  ["Cache write", usage.cacheWrite],
                  ["Total", usage.total],
                ] satisfies Array<[string, number | null | undefined]>
              ).map(([label, value]) =>
                typeof value === "number" && value > 0 ? (
                  <div key={label} className="flex justify-between gap-3">
                    <span className="text-muted-foreground/60">{label}</span>
                    <span className="font-mono text-foreground/80">
                      {value.toLocaleString()}
                    </span>
                  </div>
                ) : null
              )}
            </div>
          )}
          {message.stopReason && (
            <div className="flex justify-between gap-3 border-t border-border/20 pt-2">
              <span className="text-muted-foreground/60">Stop</span>
              <span className="font-mono text-foreground/80">
                {message.stopReason}
              </span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
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
        className="flex size-6 cursor-pointer items-center justify-center rounded text-foreground/40 transition-colors hover:text-white disabled:cursor-default disabled:opacity-30"
      >
        <LuChevronLeft className="size-3.5" />
      </button>
      <span className="text-[11px] text-muted-foreground/60 tabular-nums">
        {current}/{total}
      </span>
      <button
        type="button"
        disabled={current >= total}
        onClick={() => onSwitch(current)}
        className="flex size-6 cursor-pointer items-center justify-center rounded text-foreground/40 transition-colors hover:text-white disabled:cursor-default disabled:opacity-30"
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
  onTextAnimationComplete,
  onFork,
  onResolveApproval,
  onAskSelectedText,
  referencedTexts,
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
  onTextAnimationComplete?: (messageId: string) => void
  onFork?: (messageId: string) => void
  onResolveApproval?: (
    approvalId: string,
    decision: ApprovalDecision
  ) => Promise<void> | void
  onAskSelectedText?: (
    messageId: string,
    text: string,
    comment?: string
  ) => void
  referencedTexts?: string[]
  isPinned?: boolean
  reaction?: "up" | "down"
  isGenerating?: boolean
  isActivelyStreaming?: boolean
  popoverOpen?: boolean
  onPopoverOpenChange?: (open: boolean) => void
}) {
  const isUser = message.role === "user"
  const shouldAnimateSend = isUser && message.isOptimistic
  const hideAssistantActions =
    !isUser && (Boolean(isActivelyStreaming) || Boolean(message.animateText))
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState("")
  const [selectionAction, setSelectionAction] = useState<{
    text: string
    left: number
    top: number
  } | null>(null)
  const [selectionRects, setSelectionRects] = useState<
    Array<{
      left: number
      top: number
      width: number
      height: number
    }>
  >([])
  const [selectionComment, setSelectionComment] = useState("")
  const [selectionCommentOpen, setSelectionCommentOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messageBodyRef = useRef<HTMLDivElement>(null)
  const selectionComposerRef = useRef<HTMLDivElement>(null)
  const selectionRangeRef = useRef<Range | null>(null)

  const hasBranches = message.branches && message.branches.length > 0
  const approvalPrompt = !isUser ? parseApprovalPrompt(message.text) : null
  const userSlashCommandName = isUser ? getSlashCommandName(message.text) : null
  const shouldAnimateSlashCommandBorder =
    shouldAnimateSend && Boolean(userSlashCommandName)

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

  useEffect(() => {
    if (hideAssistantActions && popoverOpen) {
      onPopoverOpenChange?.(false)
    }
  }, [hideAssistantActions, popoverOpen, onPopoverOpenChange])

  const updateSelectionAction = useCallback(() => {
    if (isUser || !onAskSelectedText || !messageBodyRef.current) return

    const selection = window.getSelection()
    const selectedText = selection?.toString().trim()
    if (!selection || !selectedText || selection.rangeCount === 0) {
      setSelectionAction(null)
      return
    }

    const body = messageBodyRef.current
    const anchorNode = selection.anchorNode
    const focusNode = selection.focusNode
    if (
      !anchorNode ||
      !focusNode ||
      !body.contains(anchorNode) ||
      !body.contains(focusNode)
    ) {
      setSelectionAction(null)
      return
    }

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) {
      setSelectionAction(null)
      return
    }

    selectionRangeRef.current = range.cloneRange()
    setSelectionRects(
      Array.from(range.getClientRects()).map((lineRect) => ({
        left: lineRect.left,
        top: lineRect.top,
        width: lineRect.width,
        height: lineRect.height,
      }))
    )
    setSelectionAction({
      text: selectedText,
      left: rect.left + rect.width / 2,
      top: Math.max(12, rect.top - 14),
    })
    setSelectionComment("")
  }, [isUser, onAskSelectedText])

  const refreshPersistentSelection = useCallback(() => {
    const range = selectionRangeRef.current
    if (!range) return
    const rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) return
    setSelectionRects(
      Array.from(range.getClientRects()).map((lineRect) => ({
        left: lineRect.left,
        top: lineRect.top,
        width: lineRect.width,
        height: lineRect.height,
      }))
    )
    setSelectionAction((current) =>
      current
        ? {
            ...current,
            left: rect.left + rect.width / 2,
            top: Math.max(12, rect.top - 14),
          }
        : current
    )
  }, [])

  const closeSelectionComposer = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    selectionRangeRef.current = null
    setSelectionRects([])
    setSelectionAction(null)
    setSelectionComment("")
    setSelectionCommentOpen(false)
  }, [])

  const askAboutSelection = useCallback(() => {
    if (!selectionAction?.text) return
    onAskSelectedText?.(
      message.messageId,
      selectionAction.text,
      selectionComment.trim()
    )
    closeSelectionComposer()
  }, [
    closeSelectionComposer,
    message.messageId,
    onAskSelectedText,
    selectionAction,
    selectionComment,
  ])

  useEffect(() => {
    if (!selectionAction) return
    window.addEventListener("resize", refreshPersistentSelection)
    window.addEventListener("scroll", refreshPersistentSelection, true)
    return () => {
      window.removeEventListener("resize", refreshPersistentSelection)
      window.removeEventListener("scroll", refreshPersistentSelection, true)
    }
  }, [refreshPersistentSelection, selectionAction])

  useEffect(() => {
    if (isUser || !onAskSelectedText) return

    const handlePointerUp = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (target && selectionComposerRef.current?.contains(target)) return
      window.setTimeout(updateSelectionAction, 0)
    }
    const handleSelectionChange = () => {
      if (selectionComposerRef.current || selectionAction) return
      const selection = window.getSelection()
      if (!selection?.toString().trim()) setSelectionAction(null)
    }

    document.addEventListener("mouseup", handlePointerUp)
    document.addEventListener("touchend", handlePointerUp)
    document.addEventListener("selectionchange", handleSelectionChange)
    return () => {
      document.removeEventListener("mouseup", handlePointerUp)
      document.removeEventListener("touchend", handlePointerUp)
      document.removeEventListener("selectionchange", handleSelectionChange)
    }
  }, [isUser, onAskSelectedText, updateSelectionAction])

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
    [submitEdit, cancelEdit]
  )

  return (
    <motion.div
      initial={shouldAnimateSend ? { opacity: 0, y: 12, scale: 0.985 } : false}
      animate={shouldAnimateSend ? { opacity: 1, y: 0, scale: 1 } : undefined}
      transition={
        shouldAnimateSend
          ? {
              duration: 0.16,
              ease: [0.22, 1, 0.36, 1],
            }
          : { duration: 0 }
      }
      className={cn(
        "group/msg flex w-full min-w-0 transform-gpu",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "flex max-w-[85%] min-w-0 flex-col overflow-hidden",
          isUser ? "items-end" : "w-[85%] items-start"
        )}
      >
        {message.replyTo && (
          <button
            type="button"
            onClick={() => {
              document
                .getElementById(`message-${message.replyTo!.messageId}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
            }}
            className={cn(
              "mb-1 flex w-fit max-w-full cursor-pointer items-start gap-2 rounded-lg border border-b-0 border-border/20 bg-foreground/[0.03] px-2.5 pb-1.5 text-left transition-colors hover:bg-foreground/[0.06]"
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
          <div className="flex w-full min-w-[280px] flex-col gap-2 rounded-md border border-border/30 bg-foreground/5 p-3">
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
                className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-foreground/40 transition-colors hover:text-white"
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
          <>
            {isUser && (
              <div className="mb-1.5">
                <RichContentPreview message={message} />
              </div>
            )}
            <div
              ref={messageBodyRef}
              onMouseUp={updateSelectionAction}
              onKeyUp={updateSelectionAction}
              className={cn(
                "max-w-full min-w-0 overflow-hidden text-[14px] leading-relaxed",
                isUser && userSlashCommandName
                  ? "relative rounded-2xl rounded-tr-sm border border-white/10 bg-[#1f1f24] px-2.5 py-2 text-white shadow-[0_10px_28px_-20px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.06)]"
                  : isUser
                    ? "rounded-2xl rounded-tr-sm bg-[#252529] px-4 py-2.5 text-white"
                    : "w-full text-foreground"
              )}
            >
              {shouldAnimateSlashCommandBorder && (
                <>
                  <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-2 right-0 top-2 w-px bg-white/80"
                    initial={{ scaleY: 0, opacity: 0, originY: 0 }}
                    animate={{ scaleY: 1, opacity: [0, 0.95, 0] }}
                    transition={{ duration: 0.48, ease: "easeOut" }}
                  />
                  <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-0 right-2 h-px bg-white/80"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: "calc(100% - 1rem)", opacity: [0, 0.95, 0] }}
                    transition={{ duration: 0.4, delay: 0.34, ease: "easeOut" }}
                  />
                </>
              )}
              {isUser && userSlashCommandName ? (
                <div className="flex items-center gap-1.5">
                  <span className="flex size-6 shrink-0 items-center justify-center text-white/65">
                    <LuTerminal className="size-3.5" />
                  </span>
                  <code className="min-w-0 font-mono text-[13.5px] leading-6 tracking-[-0.01em] [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-white">
                    {message.text}
                  </code>
                </div>
              ) : isUser ? (
                <p className="[overflow-wrap:anywhere] break-words whitespace-pre-wrap">
                  {message.text}
                </p>
              ) : approvalPrompt ? (
                <ApprovalPromptCard
                  approval={approvalPrompt}
                  onResolve={onResolveApproval}
                />
              ) : (
                <MarkdownContent
                  text={message.text}
                  embeds={message.embeds}
                  streaming={isActivelyStreaming || message.animateText}
                  highlightTexts={referencedTexts}
                  onRevealComplete={() =>
                    onTextAnimationComplete?.(message.messageId)
                  }
                />
              )}
              {!isUser && <RichContentPreview message={message} />}
            </div>
            {selectionAction &&
              selectionRects.length > 0 &&
              createPortal(
                <div className="pointer-events-none fixed inset-0 z-[9998]">
                  {selectionRects.map((rect, index) => (
                    <span
                      key={`${rect.left}-${rect.top}-${index}`}
                      className="fixed rounded-[3px] bg-sky-400/35 ring-1 ring-sky-300/20"
                      style={{
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                      }}
                    />
                  ))}
                </div>,
                document.body
              )}
            {selectionAction &&
              !isUser &&
              onAskSelectedText &&
              createPortal(
                <div
                  ref={selectionComposerRef}
                  className={cn(
                    "fixed z-[9999] flex -translate-x-1/2 -translate-y-full items-center gap-1.5 border border-white/10 bg-[#202020]/98 shadow-[0_18px_50px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-2xl",
                    selectionCommentOpen
                      ? "w-[min(380px,calc(100vw-32px))] rounded-[18px] px-3 py-2"
                      : "rounded-full p-1.5",
                  )}
                  style={{
                    left: selectionAction.left,
                    top: selectionAction.top,
                  }}
                >
                  {selectionCommentOpen && (
                    <input
                      autoFocus
                      value={selectionComment}
                      onChange={(event) =>
                        setSelectionComment(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault()
                          askAboutSelection()
                        }
                        if (event.key === "Escape") {
                          closeSelectionComposer()
                        }
                      }}
                      placeholder="Add a comment..."
                      className="min-w-0 flex-1 bg-transparent px-1 text-[14px] text-foreground outline-none placeholder:text-muted-foreground/65"
                      aria-label="Add a comment about selected text"
                    />
                  )}
                  <button
                    type="button"
                    onClick={askAboutSelection}
                    className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
                    aria-label="Add selected text as a reference"
                  >
                    <LuPaperclip className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectionCommentOpen) {
                        setSelectionCommentOpen(true)
                        return
                      }
                      if (selectionCommentOpen && !selectionComment.trim()) {
                        return
                      }
                      askAboutSelection()
                    }}
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
                      !selectionCommentOpen || selectionComment.trim()
                        ? "cursor-pointer bg-white/22 text-white hover:bg-white/30"
                        : "cursor-default bg-white/[0.08] text-white/32",
                    )}
                    aria-label={
                      selectionCommentOpen && selectionComment.trim()
                        ? "Send comment"
                        : selectionCommentOpen
                          ? "Write a comment to send"
                          : "Ask with selected text"
                    }
                  >
                    {selectionCommentOpen && selectionComment.trim() ? (
                      <LuArrowUp className="size-4" />
                    ) : (
                      <LuMessageSquarePlus className="size-4" />
                    )}
                  </button>
                </div>,
                document.body
              )}
          </>
        )}
        {isUser ? (
          <div className="mt-1 flex flex-row-reverse items-center gap-1">
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
                  className="flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground/30 transition-colors hover:text-white"
                >
                  <LuPenLine className="size-3.5" />
                </button>
              )}
              <CopyButton text={message.text} />
              {onReply && (
                <button
                  type="button"
                  onClick={() => onReply(message.messageId)}
                  className="flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground/30 transition-colors hover:text-white"
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
          !hideAssistantActions && (
            <div className="mt-1 flex items-center gap-0">
              {formatTime(message.createdAt) && (
                <span className="text-[10px] text-muted-foreground/40">
                  {formatTime(message.createdAt)}
                </span>
              )}
              <ResponseMetadata message={message} />
              <div className="flex items-center gap-0.5">
                {onReact && (
                  <div className="flex items-center gap-0.5">
                    <AnimatePresence mode="popLayout" initial={false}>
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
                              : "text-foreground/30 hover:text-white"
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
                {(onPin ||
                  onReply ||
                  onFork ||
                  (onRegenerate && !isGenerating)) && (
                  <Popover
                    open={popoverOpen}
                    onOpenChange={onPopoverOpenChange}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex size-6 cursor-pointer items-center justify-center rounded text-foreground/30 transition-all duration-100 hover:text-white"
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
                      {onFork && (
                        <MenuAction
                          label="Fork"
                          icon={<LuGitFork className="size-3.5" />}
                          onClick={() => {
                            onFork(message.messageId)
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
