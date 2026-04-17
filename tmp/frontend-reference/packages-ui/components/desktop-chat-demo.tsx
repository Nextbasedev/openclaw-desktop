"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  createChatSession,
  deleteChatSession,
  isTauriRuntime,
  sendChatMessage,
  startChatStream,
  type ChatMessageEvent,
  type ChatStreamEvent,
  type ChatToolEvent,
} from "@/lib/tauri-chat-middleware"

const DEFAULT_PROMPT = "Use the read tool to read /etc/hostname. Then reply with exactly HOSTNAME_CAPTURED and nothing else."

type StreamHandle = Awaited<ReturnType<typeof startChatStream>>

function resultText(event: ChatToolEvent) {
  const value = event.result ?? event.partialResult
  const content = typeof value === "object" && value && "content" in (value as Record<string, unknown>)
    ? (value as { content?: Array<{ text?: string }> }).content
    : null
  return content?.[0]?.text ?? null
}

export function DesktopChatDemo() {
  const [available, setAvailable] = useState(false)
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  const [streamId, setStreamId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [status, setStatus] = useState("Idle")
  const [messages, setMessages] = useState<ChatMessageEvent[]>([])
  const [toolEvents, setToolEvents] = useState<ChatToolEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<StreamHandle | null>(null)

  useEffect(() => {
    setAvailable(isTauriRuntime())
    return () => {
      void streamRef.current?.stop()
    }
  }, [])

  const latestToolResult = useMemo(() => {
    const reversed = [...toolEvents].reverse()
    return reversed.find((event) => event.toolOutputVisibility === "full" && resultText(event)) ?? null
  }, [toolEvents])

  async function createSession() {
    setError(null)
    setStatus("Creating desktop session")
    const created = await createChatSession({
      label: `Jarvis desktop tool output ${new Date().toISOString()}`,
      verboseLevel: "full",
    })
    setSessionKey(created.sessionKey)
    setMessages([])
    setToolEvents([])
    setStatus("Session ready")

    const stream = await startChatStream({
      sessionKey: created.sessionKey,
      onEvent(event) {
        handleEvent(event)
      },
    })
    streamRef.current = stream
    setStreamId(stream.streamId)
  }

  function handleEvent(event: ChatStreamEvent) {
    if (event.type === "chat.status") {
      setStatus(event.label ? `${event.state}: ${event.label}` : event.state)
      return
    }
    if (event.type === "chat.message") {
      setMessages((current) => [...current, event])
      return
    }
    if (event.type === "chat.tool") {
      setToolEvents((current) => [...current, event])
      return
    }
    if (event.type === "chat.error") {
      setError(event.message)
      setStatus("error")
      return
    }
    if (event.type === "chat.ready") {
      setStatus(`connected (${event.toolOutputVisibility})`)
    }
  }

  async function sendPrompt() {
    if (!sessionKey) return
    setError(null)
    setStatus("sending")
    await sendChatMessage({ sessionKey, text: prompt })
  }

  async function cleanup() {
    setError(null)
    if (streamRef.current) {
      await streamRef.current.stop()
      streamRef.current = null
    }
    if (sessionKey) {
      await deleteChatSession(sessionKey)
    }
    setSessionKey(null)
    setStreamId(null)
    setMessages([])
    setToolEvents([])
    setStatus("Idle")
  }

  return (
    <section className="rounded-3xl border bg-background p-6 shadow-sm">
      <div className="flex flex-col gap-3">
        <span className="w-fit rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          Desktop chat middleware
        </span>
        <h2 className="text-2xl font-semibold tracking-tight">Tool output in the desktop app</h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          This is the real Tauri middleware path. It creates a session, subscribes to live events, sends a prompt, and shows tool results only when OpenClaw exposes them.
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4 rounded-2xl border bg-muted/40 p-4">
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Desktop status</p>
            <div className="mt-3 space-y-2 text-sm">
              <p><span className="font-medium">Runtime:</span> {available ? "Tauri desktop" : "Browser preview"}</p>
              <p><span className="font-medium">Session:</span> {sessionKey ?? "Not created yet"}</p>
              <p><span className="font-medium">Stream:</span> {streamId ?? "Not connected"}</p>
              <p><span className="font-medium">State:</span> {status}</p>
            </div>
          </div>

          <div className="rounded-2xl border bg-background p-4">
            <label className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground" htmlFor="desktop-chat-prompt">
              Prompt
            </label>
            <textarea
              id="desktop-chat-prompt"
              className="mt-3 min-h-28 w-full rounded-2xl border bg-muted px-3 py-3 text-sm outline-none"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => void createSession()} disabled={!available || Boolean(sessionKey)}>
                Create session
              </Button>
              <Button variant="outline" onClick={() => void sendPrompt()} disabled={!available || !sessionKey}>
                Send prompt
              </Button>
              <Button variant="outline" onClick={() => void cleanup()} disabled={!sessionKey}>
                Delete session
              </Button>
            </div>
            {!available ? (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                Open this inside the Tauri desktop shell to use the real middleware commands.
              </p>
            ) : null}
            {error ? (
              <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border bg-muted/40 p-4">
          <div className="rounded-2xl border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Latest tool card</p>
            {toolEvents.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No tool events yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {toolEvents.slice(-3).map((event, index) => {
                  const text = resultText(event)
                  return (
                    <div key={`${event.toolCallId ?? index}-${event.phase}`} className="rounded-2xl border p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{event.name ?? "tool"}</p>
                        <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                          {event.phase ?? "phase"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Visibility: {event.toolOutputVisibility}
                      </p>
                      {text && event.toolOutputVisibility === "full" ? (
                        <pre className="mt-3 overflow-x-auto rounded-xl bg-muted p-3 text-xs">{text}</pre>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">
                          {event.toolOutputVisibility === "full"
                            ? "No raw result body on this event."
                            : "Metadata only. Raw tool output stays hidden at this verbosity."}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Assistant messages</p>
            {messages.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No assistant messages yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {messages.slice(-3).map((message) => (
                  <div key={message.messageId ?? `${message.createdAt}-${message.text}`} className="rounded-2xl border p-3 text-sm">
                    <p className="font-medium">{message.role}</p>
                    <p className="mt-2 whitespace-pre-wrap">{message.text || "(empty)"}</p>
                  </div>
                ))}
              </div>
            )}
            {latestToolResult ? (
              <div className="mt-4 rounded-2xl bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-300">
                <p className="font-medium">Tool result surfaced correctly</p>
                <p className="mt-1">{resultText(latestToolResult)}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
