"use client"

import { useState, useCallback, useRef, useEffect, memo, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"
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
  LuArrowUp,
  LuMessageSquarePlus,
  LuDownload,
  LuFile,
  LuFileText,
  LuImage,
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
import { MarkdownContent } from "./MarkdownContent"
import type { ChatMessage } from "./types"
import { formatAssistantErrorText, isAssistantErrorMessage } from "./utils"
import { useStreamingText } from "./useStreamingText"
import { getSlashCommandName } from "@/lib/controlSlashCommands"
import { formatAttachmentSize } from "@/lib/chatAttachments"
import {
  chatAttachmentHref,
  chatAttachmentTypeLabel,
  getChatAttachmentKind,
} from "@/lib/chatAttachmentPreview"

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
        "cursor-pointer text-foreground/40 hover:text-foreground dark:text-foreground/30 dark:hover:text-white",
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

type MessageAttachment = NonNullable<ChatMessage["attachments"]>[number]

function attachmentLabel(attachment: MessageAttachment) {
  const parts = [chatAttachmentTypeLabel(attachment)]
  if (typeof attachment.size === "number" && attachment.size >= 0) {
    parts.push(formatAttachmentSize(attachment.size))
  }
  return parts.join(" • ")
}

function AttachmentFileIcon({ kind }: { kind: "pdf" | "file" }) {
  if (kind === "pdf") return <LuFileText className="size-4" />
  return <LuFile className="size-4" />
}

function ImageAttachmentCard({
  attachment,
  href,
  isUser,
}: {
  attachment: MessageAttachment
  href: string
  isUser: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      download={attachment.url ? undefined : attachment.name}
      className="block max-w-full overflow-hidden rounded-xl"
      aria-label={`Open attachment ${attachment.name}`}
    >
      <div className="relative flex min-h-32 max-h-80 w-full max-w-md items-center justify-center overflow-hidden rounded-xl bg-black/10">
        {!loaded && !failed && (
          <div
            className={cn(
              "absolute inset-0 flex items-center justify-center gap-2 text-[12px]",
              isUser ? "text-white/65" : "text-muted-foreground"
            )}
          >
            <LuLoader className="size-4 animate-spin" />
            Loading image…
          </div>
        )}
        {failed ? (
          <div
            className={cn(
              "flex min-h-32 w-full flex-col items-center justify-center gap-2 px-4 py-8 text-center text-[12px]",
              isUser ? "text-white/65" : "text-muted-foreground"
            )}
          >
            <LuImage className="size-6 opacity-70" />
            <span>Image preview unavailable</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- Middleware media URLs are authenticated token links and should render directly.
          <img
            src={href}
            alt={attachment.name}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={cn(
              "max-h-80 w-full max-w-md object-contain transition-opacity duration-150",
              loaded ? "opacity-100" : "opacity-0"
            )}
          />
        )}
      </div>
    </a>
  )
}

function MessageAttachments({
  attachments,
  isUser,
}: {
  attachments?: ChatMessage["attachments"]
  isUser: boolean
}) {
  if (!attachments || attachments.length === 0) return null

  return (
    <div
      className={cn(
        "mt-2 space-y-2",
        isUser ? "text-white" : "text-foreground"
      )}
    >
      {attachments.map((attachment, index) => {
        const href = chatAttachmentHref(attachment)
        const kind = getChatAttachmentKind(attachment)
        const key = `${attachment.name}-${index}`

        if (kind === "image") {
          if (!href) return null
          return (
            <ImageAttachmentCard
              key={key}
              attachment={attachment}
              href={href}
              isUser={isUser}
            />
          )
        }

        const fileKind = kind === "pdf" ? "pdf" : "file"
        const card = (
          <div
            className={cn(
              "flex max-w-full items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
              isUser
                ? "border-white/10 bg-black/15 text-white hover:border-white/20"
                : "border-border/35 bg-foreground/[0.03] text-foreground hover:border-border/60"
            )}
          >
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                kind === "pdf"
                  ? "bg-red-400/12 text-red-200"
                  : isUser
                    ? "bg-white/10 text-white/75"
                    : "bg-muted/45 text-muted-foreground"
              )}
            >
              <AttachmentFileIcon kind={fileKind} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] leading-snug font-medium">
                {attachment.name}
              </p>
              <p
                className={cn(
                  "truncate text-[11px]",
                  isUser ? "text-white/60" : "text-muted-foreground"
                )}
              >
                {attachmentLabel(attachment)}
              </p>
            </div>
            {href && <LuDownload className="size-4 shrink-0 opacity-55" />}
          </div>
        )

        if (!href) return <div key={key}>{card}</div>

        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            download={attachment.url ? undefined : attachment.name}
            className="block max-w-full"
            aria-label={`Open attachment ${attachment.name}`}
          >
            {card}
          </a>
        )
      })}
    </div>
  )
}

function ResponseMetadata({ message }: { message: ChatMessage }) {
  const usage = message.usage
  const total = formatTokenCount(usage?.total)
  const hasDetails = Boolean(message.model || total || message.stopReason)
  if (!hasDetails) return null

  const rows = [
    message.model ? ["Model", message.model] : null,
    ...(usage
      ? ([
          ["Input", usage.input],
          ["Output", usage.output],
          ["Cache read", usage.cacheRead],
          ["Cache write", usage.cacheWrite],
          ["Total", usage.total],
        ] satisfies Array<[string, number | null | undefined]>).map(([label, value]) =>
          typeof value === "number" && value > 0
            ? [label, value.toLocaleString()]
            : null
        )
      : []),
    message.stopReason ? ["Stop", message.stopReason] : null,
  ].filter(Boolean) as Array<[string, string]>

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground/45 transition-colors hover:bg-black/[0.045] hover:text-muted-foreground dark:hover:bg-white/[0.06] cursor-pointer"
          aria-label="Response details"
        >
          {[message.model, total ? `${total} tokens` : null]
            .filter(Boolean)
            .join(" • ")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className={cn(
          "w-64 gap-0 overflow-hidden rounded-2xl border-0 p-1.5 ring-0",
          "bg-[var(--glass-bg)] backdrop-blur-[40px] backdrop-saturate-[180%]",
          "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
        )}
      >
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/55">
          Response details
        </div>
        <div className="space-y-0.5">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 text-[12px] transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.045]"
            >
              <span className="text-muted-foreground/65">{label}</span>
              <span className="min-w-0 truncate text-right font-mono text-[11px] font-medium text-foreground/85">
                {value}
              </span>
            </div>
          ))}
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
        className="flex size-6 cursor-pointer items-center justify-center rounded text-foreground/40 transition-colors hover:text-foreground dark:hover:text-white disabled:cursor-default disabled:opacity-30"
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
        className="flex size-6 cursor-pointer items-center justify-center rounded text-foreground/40 transition-colors hover:text-foreground dark:hover:text-white disabled:cursor-default disabled:opacity-30"
      >
        <LuChevronRight className="size-3.5" />
      </button>
    </div>
  )
}

function isAssistantStatusSnapshot(text: string) {
  const normalized = text.trim()
  if (!normalized.includes("OpenClaw ")) return false

  const markers = ["Model:", "Tokens:", "Context:", "Session:", "Runtime:"]
  return markers.filter((marker) => normalized.includes(marker)).length >= 3
}

interface MessageBubbleProps {
  message: ChatMessage
  onEdit?: (messageId: string, newText: string) => void
  onRetrySend?: (messageId: string) => void
  onSwitchBranch?: (messageId: string, branchIndex: number) => void
  onReply?: (messageId: string) => void
  onPin?: (messageId: string) => void
  onDelete?: (messageId: string) => void
  onReact?: (messageId: string, reaction: "up" | "down") => void
  onExport?: (messageId: string) => void
  onTextAnimationComplete?: (messageId: string) => void
  onFork?: (messageId: string) => void
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => Promise<void> | void
  onAskSelectedText?: (messageId: string, text: string, comment?: string) => void
  referencedTexts?: string[]
  isPinned?: boolean
  reaction?: "up" | "down"
  isGenerating?: boolean
  isActivelyStreaming?: boolean
  animateAssistantText?: boolean
  suppressActions?: boolean
  popoverOpen?: boolean
  onPopoverOpenChange?: (open: boolean) => void
  afterContent?: ReactNode
}

export const MessageBubble = memo(function MessageBubble({
  message,
  onEdit,
  onRetrySend,
  onSwitchBranch,
  onReply,
  onPin,
  onDelete,
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
  animateAssistantText,
  suppressActions,
  popoverOpen,
  onPopoverOpenChange,
  afterContent,
}: {
  message: ChatMessage
  onEdit?: (messageId: string, newText: string) => void
  onRetrySend?: (messageId: string) => void
  onSwitchBranch?: (messageId: string, branchIndex: number) => void
  onReply?: (messageId: string) => void
  onPin?: (messageId: string) => void
  onDelete?: (messageId: string) => void
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
  animateAssistantText?: boolean
  suppressActions?: boolean
  popoverOpen?: boolean
  onPopoverOpenChange?: (open: boolean) => void
  afterContent?: ReactNode
}) {
  const isUser = message.role === "user"
  const isAssistantError = isAssistantErrorMessage(message)
  const assistantErrorText = isAssistantError
    ? formatAssistantErrorText(message.text)
    : message.text
  const {
    displayText: displayedAssistantErrorText,
    isRevealing: isRevealingAssistantError,
  } = useStreamingText(
    assistantErrorText,
    isAssistantError && Boolean(animateAssistantText),
    () => onTextAnimationComplete?.(message.messageId)
  )
  // `isOptimistic` can intentionally survive after the send ACK so the live
  // timeline can preserve the user row until the canonical Gateway echo/history
  // catches up. During heavy tool runs the row may remount while patch/history
  // reconciliation is active; only animate the first local sending state, not
  // every later remount of an already-acknowledged optimistic row.
  const shouldAnimateSend = isUser && message.isOptimistic && message.sendStatus === "sending"
  const hideAssistantActions =
    !isUser && (Boolean(isActivelyStreaming) || Boolean(suppressActions))
  const isStatusSnapshot = !isUser && isAssistantStatusSnapshot(message.text)
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
  const selectedTextMenuRef = useRef<HTMLDivElement>(null)
  const [selectedTextMenu, setSelectedTextMenu] = useState<{
    open: boolean
    x: number
    y: number
    text: string
  }>({ open: false, x: 0, y: 0, text: "" })

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
    selectionRangeRef.current = null
    setSelectionRects([])
    setSelectionAction(null)
    setSelectionComment("")
    setSelectionCommentOpen(false)
  }, [])

  const closeSelectedTextMenu = useCallback(() => {
    setSelectedTextMenu((current) => ({ ...current, open: false }))
  }, [])

  const handleSelectedTextContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (isUser || isStatusSnapshot || !messageBodyRef.current) return

    const selection = window.getSelection()
    const selectedText = selection?.toString().trim()
    if (!selection || !selectedText || selection.rangeCount === 0) return

    const body = messageBodyRef.current
    const anchorNode = selection.anchorNode
    const focusNode = selection.focusNode
    if (!anchorNode || !focusNode || !body.contains(anchorNode) || !body.contains(focusNode)) return

    event.preventDefault()
    event.stopPropagation()
    setSelectedTextMenu({
      open: true,
      x: Math.min(event.clientX, window.innerWidth - 188),
      y: Math.min(event.clientY, window.innerHeight - 132),
      text: selectedText,
    })
  }, [isStatusSnapshot, isUser])

  const copySelectedText = useCallback(async () => {
    const text = selectedTextMenu.text
    closeSelectedTextMenu()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {}
  }, [closeSelectedTextMenu, selectedTextMenu.text])

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
    if (isUser || isStatusSnapshot || !onAskSelectedText) return

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
  }, [isUser, isStatusSnapshot, onAskSelectedText, selectionAction, updateSelectionAction])

  useEffect(() => {
    if (!selectedTextMenu.open) return

    const closeOnPointerDown = (event: PointerEvent) => {
      if (selectedTextMenuRef.current?.contains(event.target as Node)) return
      closeSelectedTextMenu()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSelectedTextMenu()
    }

    window.addEventListener("pointerdown", closeOnPointerDown)
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [closeSelectedTextMenu, selectedTextMenu.open])

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
      initial={shouldAnimateSend ? { opacity: 1, y: 12, scale: 0.985 } : false}
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
          "flex min-w-0 flex-col overflow-visible",
          isUser ? "max-w-[min(85%,42rem)] items-end" : "w-full items-start"
        )}
      >
        {message.replyTo && (
          <button
            type="button"
            onClick={() => {
              document
                .querySelector<HTMLElement>(`[data-message-id="${CSS.escape(message.replyTo!.messageId)}"]`)
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
                className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-foreground/40 transition-colors hover:text-foreground dark:hover:text-white"
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
              <MessageAttachments
                attachments={message.attachments}
                isUser={isUser}
              />
            )}
            {(!isUser || message.text.trim() || userSlashCommandName) && (
              <div
                ref={messageBodyRef}
                onMouseDown={isStatusSnapshot ? (event) => event.preventDefault() : undefined}
                onMouseUp={updateSelectionAction}
                onKeyUp={updateSelectionAction}
                onContextMenu={handleSelectedTextContextMenu}
                className={cn(
                  "max-w-full min-w-0 overflow-hidden text-[14px] leading-relaxed",
                  isStatusSnapshot && "select-none [&_*]:select-none",
                  isUser && userSlashCommandName
                    ? "relative rounded-2xl border border-border/45 bg-muted px-3 py-2 text-foreground shadow-sm"
                    : isUser
                      ? "rounded-2xl bg-muted px-4 py-2.5 text-foreground shadow-sm"
                      : isAssistantError
                        ? "w-full px-2 text-red-300"
                      : "w-full px-2 text-foreground"
                )}
              >
              {shouldAnimateSlashCommandBorder && (
                <>
                  <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-2 right-0 bottom-2 w-px bg-foreground/60"
                    initial={{ scaleY: 0, opacity: 0, originY: 0 }}
                    animate={{ scaleY: 1, opacity: [0, 0.95, 0] }}
                    transition={{ duration: 0.48, ease: "easeOut" }}
                  />
                  <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2 bottom-0 h-px bg-foreground/60"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{
                      width: "calc(100% - 1rem)",
                      opacity: [0, 0.95, 0],
                    }}
                    transition={{ duration: 0.4, delay: 0.34, ease: "easeOut" }}
                  />
                </>
              )}
              {isUser && userSlashCommandName ? (
                <div className="flex items-center gap-1.5">
                  <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                    <LuTerminal className="size-3.5" />
                  </span>
                  <code className="min-w-0 font-mono text-[13.5px] leading-6 tracking-[-0.01em] [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-foreground">
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
              ) : isAssistantError ? (
                <div
                  className={cn(
                    "max-w-full min-w-0 overflow-hidden",
                    isRevealingAssistantError && "streaming-text"
                  )}
                >
                  <p className="[overflow-wrap:anywhere] break-words whitespace-pre-wrap">
                    {displayedAssistantErrorText}
                  </p>
                </div>
              ) : (
                <MarkdownContent
                  text={message.text}
                  embeds={message.embeds}
                  streaming={Boolean(animateAssistantText)}
                  revealMode="buffered"
                  highlightTexts={referencedTexts}
                  onRevealComplete={() =>
                    onTextAnimationComplete?.(message.messageId)
                  }
                />
              )}
                {!isUser && (
                  <MessageAttachments
                    attachments={message.attachments}
                    isUser={isUser}
                  />
                )}
              </div>
            )}
            {!isUser && afterContent}
            {isUser && message.sendStatus === "failed" && (
              <div className="mt-1 flex max-w-full items-center gap-2 text-[11px] text-rose-300">
                <span className="min-w-0 truncate">
                  {message.sendError || "Send failed"}
                </span>
                <button
                  type="button"
                  onClick={() => onRetrySend?.(message.messageId)}
                  className="shrink-0 cursor-pointer rounded-full border border-rose-300/30 px-2 py-0.5 text-rose-100 transition-colors hover:bg-rose-300/10"
                >
                  Retry
                </button>
              </div>
            )}
            {selectedTextMenu.open &&
              !isUser &&
              createPortal(
                <div
                  ref={selectedTextMenuRef}
                  style={{
                    position: "fixed",
                    left: Math.max(12, selectedTextMenu.x),
                    top: Math.max(12, selectedTextMenu.y),
                    transformOrigin: "top left",
                  }}
                  className={cn(
                    "z-[9999] w-44 rounded-2xl p-1.5",
                    "border border-black/70 bg-[var(--glass-bg)]",
                    "backdrop-blur-[40px] backdrop-saturate-[180%]",
                    "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
                  )}
                >
                  {onReply && (
                    <MenuAction
                      label="Reply"
                      icon={<LuReply className="size-3.5" />}
                      onClick={() => {
                        closeSelectedTextMenu()
                        onReply(message.messageId)
                      }}
                    />
                  )}
                  <MenuAction
                    label="Copy"
                    icon={<LuCopy className="size-3.5" />}
                    onClick={copySelectedText}
                  />
                  {onPin && (
                    <MenuAction
                      label={isPinned ? "Unpin" : "Pin"}
                      icon={<LuPin className="size-3.5" />}
                      onClick={() => {
                        closeSelectedTextMenu()
                        onPin(message.messageId)
                      }}
                    />
                  )}
                </div>,
                document.body
              )}
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
                      : "rounded-full p-1.5"
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
                        : "cursor-default bg-white/[0.08] text-white/32"
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
                  className="flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground/40 transition-colors hover:text-foreground dark:text-foreground/30 dark:hover:text-white"
                >
                  <LuPenLine className="size-3.5" />
                </button>
              )}
              <CopyButton text={message.text} />
              {onReply && (
                <button
                  type="button"
                  onClick={() => onReply(message.messageId)}
                  className="flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground/40 transition-colors hover:text-foreground dark:text-foreground/30 dark:hover:text-white"
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
                              : "text-foreground/40 hover:text-foreground dark:text-foreground/30 dark:hover:text-white"
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
                  onFork) && (
                  <Popover
                    open={popoverOpen}
                    onOpenChange={onPopoverOpenChange}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex size-6 cursor-pointer items-center justify-center rounded text-foreground/40 transition-all duration-100 hover:text-foreground dark:text-foreground/30 dark:hover:text-white"
                        aria-label="More actions"
                      >
                        <LuEllipsisVertical className="size-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      side="right"
                      sideOffset={8}
                      className={cn(
                        "w-44 gap-0 rounded-2xl p-1.5 ring-0",
                        "border border-black/[0.10] bg-[var(--glass-bg)] dark:border-black/70",
                        "backdrop-blur-[40px] backdrop-saturate-[180%]",
                        "shadow-[0_24px_64px_var(--glass-shadow),0_2px_12px_var(--glass-shadow),inset_0_1px_0_var(--glass-inset)]",
                      )}
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
}, messageBubbleAreEqual)

function messageRenderSignature(message: ChatMessage) {
  return JSON.stringify({
    messageId: message.messageId,
    role: message.role,
    text: message.text,
    reasoningText: message.reasoningText,
    toolCalls: message.toolCalls?.map((tool) => ({
      id: tool.id,
      tool: tool.tool,
      status: tool.status,
      duration: tool.duration,
      input: tool.input,
      resultText: tool.resultText,
      awaitingResult: tool.awaitingResult,
      approval: tool.approval,
    })),
    embeds: message.embeds,
    attachments: message.attachments,
    voice: message.voice,
    branches: message.branches,
    activeBranch: message.activeBranch,
    replyTo: message.replyTo,
    sendStatus: message.sendStatus,
    sendError: message.sendError,
    isOptimistic: message.isOptimistic,
    createdAt: message.createdAt,
    model: message.model,
    usage: message.usage,
    stopReason: message.stopReason,
    animateText: message.animateText,
  })
}

function messageBubbleAreEqual(
  prev: MessageBubbleProps,
  next: MessageBubbleProps
): boolean {
  return (
    messageRenderSignature(prev.message) === messageRenderSignature(next.message) &&
    prev.isGenerating === next.isGenerating &&
    prev.isActivelyStreaming === next.isActivelyStreaming &&
    prev.animateAssistantText === next.animateAssistantText &&
    prev.popoverOpen === next.popoverOpen &&
    prev.isPinned === next.isPinned &&
    prev.reaction === next.reaction &&
    prev.suppressActions === next.suppressActions &&
    prev.afterContent === next.afterContent &&
    (prev.referencedTexts ?? []).join("\u0000") === (next.referencedTexts ?? []).join("\u0000")
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
