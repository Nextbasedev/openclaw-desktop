"use client"

import { useState, useEffect, useCallback } from "react"
import { invoke } from "@/lib/ipc"
import { checkGatewayOrRedirect, isGatewayError, showGatewayError } from "@/lib/toast"
import { Icons } from "@/components/icons"
import { AnimatedGreeting } from "@/components/AnimatedGreeting"
import { ChatBox } from "@/components/ChatBox"
import type { ChatComposerSubmit } from "@/lib/chatAttachments"
import { cn } from "@/lib/utils"

type SessionMapping = {
  key: string
  label: string
  status: string
  createdAt: string
  updatedAt: string
  pinned: boolean
  hidden: boolean
}

type Props = {
  topicId: string
  projectId: string
  topicName: string
  projectName: string
  onSessionSelect: (sessionKey: string, title: string) => void
}

const STATUS_CONFIG: Record<string, { dot: string; badge: string; label: string }> = {
  running:   { dot: "bg-emerald-400", badge: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20", label: "Running" },
  idle:      { dot: "bg-muted-foreground/30", badge: "text-muted-foreground bg-muted/40 border-border/30", label: "Idle" },
  completed: { dot: "bg-sky-400", badge: "text-sky-400 bg-sky-400/10 border-sky-400/20", label: "Completed" },
  error:     { dot: "bg-red-400", badge: "text-red-400 bg-red-400/10 border-red-400/20", label: "Error" },
  aborted:   { dot: "bg-orange-400", badge: "text-orange-400 bg-orange-400/10 border-orange-400/20", label: "Aborted" },
  queued:    { dot: "bg-yellow-400", badge: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20", label: "Queued" },
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function TopicView({ topicId, projectId, topicName, projectName, onSessionSelect }: Props) {
  const [sessions, setSessions] = useState<SessionMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setSessions([])
    invoke<{ sessions: SessionMapping[] }>("middleware_sessions_list", {
      input: { projectId, topicId },
    })
      .then((r) => {
        setSessions((r.sessions || []).filter((s) => !s.hidden))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [topicId, projectId])

  const handleFirstMessage = useCallback(async (payload: ChatComposerSubmit) => {
    const text = payload.text.trim()
    if (sending || !text) return
    setSending(true)
    setSendError(null)
    try {
      if (!(await checkGatewayOrRedirect())) return

      const label = text.slice(0, 50) || "New Chat"
      const result = await invoke<{ session: { key: string } }>(
        "middleware_sessions_create",
        { input: { projectId, topicId, agentId: "main", label } },
      )
      const sessionKey = result.session.key
      await invoke("middleware_chat_send", {
        input: {
          sessionKey,
          text,
          attachments: payload.attachments,
        },
      })
      onSessionSelect(sessionKey, label)
    } catch (err) {
      if (isGatewayError(err)) {
        showGatewayError(err instanceof Error ? err.message : undefined)
        window.history.pushState(null, "", "/connect")
        window.dispatchEvent(new PopStateEvent("popstate"))
      } else {
        setSendError(String(err))
      }
    } finally {
      setSending(false)
    }
  }, [sending, projectId, topicId, onSessionSelect])

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground/50" />
          <span className="text-[13px] text-muted-foreground">Loading conversations…</span>
        </div>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-8 py-10">
        <AnimatedGreeting />
        <ChatBox onSend={handleFirstMessage} disabled={sending} glowOnMount />
        {sendError && (
          <div className="mx-auto w-full max-w-3xl px-4">
            <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-center">
              <p className="text-sm text-red-400">{sendError}</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">

        {/* ── Hero heading ── */}
        <div className="mb-8 flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Icons.Files size={12} strokeWidth={1.5} />
            <span>{projectName}</span>
            <span className="opacity-40">›</span>
            <span className="text-foreground/70 font-medium">{topicName}</span>
          </div>
          <h1 className="text-[22px] font-semibold leading-tight text-foreground">
            {topicName}
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {sessions.length} conversation{sessions.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* ── Session cards ── */}
        <div className="flex flex-col gap-3">
          {sessions.map((session) => (
            <SessionCard
              key={session.key}
              session={session}
              onClick={() => onSessionSelect(session.key, session.label || "Untitled")}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function SessionCard({
  session,
  onClick,
}: {
  session: SessionMapping
  onClick: () => void
}) {
  const cfg = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.idle
  const isRunning = session.status === "running"

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col gap-3 rounded-2xl border px-5 py-4 text-left",
        "border-border/40 bg-card/60 shadow-sm",
        "transition-all duration-200 hover:border-border/70 hover:bg-card hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Status dot */}
          <span
            className={cn(
              "mt-px h-2 w-2 shrink-0 rounded-full transition-all",
              cfg.dot,
              isRunning && "animate-pulse",
            )}
          />
          <span className="truncate text-[13.5px] font-medium text-foreground leading-tight">
            {session.label || "Untitled"}
          </span>
          {session.pinned && (
            <span className="shrink-0 text-[10px] text-amber-500/80">Pinned</span>
          )}
        </div>

        {/* Status badge */}
        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-medium capitalize",
            cfg.badge,
          )}
        >
          {cfg.label}
        </span>
      </div>

      {/* Bottom row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Icons.Chat size={11} strokeWidth={1.5} />
          <span>Last activity {formatRelativeTime(session.updatedAt)}</span>
        </div>
        <span
          className={cn(
            "flex items-center gap-1 text-[11px] font-medium text-muted-foreground/50",
            "transition-all duration-150 group-hover:text-foreground/60 group-hover:gap-1.5",
          )}
        >
          Open
          <Icons.Forward size={11} strokeWidth={2} />
        </span>
      </div>
    </button>
  )
}

