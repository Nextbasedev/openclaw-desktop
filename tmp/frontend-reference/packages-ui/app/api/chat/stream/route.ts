import { connectToOpenClawGateway, contentBlocksToText, toolOutputVisibility } from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

type SessionMessagePayload = {
  sessionKey?: string
  messageId?: string
  message?: {
    id?: string
    role?: string
    content?: unknown
    createdAt?: string
    timestamp?: string | number
    model?: string
  }
}

type SessionToolPayload = {
  sessionKey?: string
  runId?: string
  verboseLevel?: string
  seq?: number
  data?: {
    phase?: string
    name?: string
    toolCallId?: string
    args?: unknown
    partialResult?: unknown
    result?: unknown
    error?: string
  }
}

function sseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionKey = searchParams.get("sessionKey")?.trim()

  if (!sessionKey) {
    return new Response("sessionKey is required", { status: 400 })
  }

  const encoder = new TextEncoder()
  let gateway: Awaited<ReturnType<typeof connectToOpenClawGateway>> | null = null
  let unsubscribe: (() => void) | null = null
  let keepalive: NodeJS.Timeout | null = null

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: string, data: unknown) => controller.enqueue(encoder.encode(sseEvent(event, data)))

      const seenToolEvents = new Set<string>()
      const seenMessageIds = new Set<string>()

      try {
        gateway = await connectToOpenClawGateway({ scopes: ["operator.read", "operator.write", "operator.approvals"] })

        const history = await gateway.request<{
          thinkingLevel?: string
          verboseLevel?: string
          messages?: Array<{
            id?: string
            role?: string
            content?: unknown
            createdAt?: string
            model?: string
          }>
        }>("chat.history", { sessionKey, limit: 20 })

        if (!history.ok) {
          push("chat.error", { sessionKey, message: history.error?.message ?? "chat.history failed" })
          controller.close()
          gateway.close()
          return
        }

        await gateway.request("sessions.subscribe", {})
        await gateway.request("sessions.messages.subscribe", { key: sessionKey })

        const verboseLevel = history.payload?.verboseLevel ?? null
        push("chat.ready", {
          sessionKey,
          thinkingLevel: history.payload?.thinkingLevel ?? null,
          verboseLevel,
          toolOutputVisibility: toolOutputVisibility(verboseLevel),
          recentMessages: (history.payload?.messages ?? []).slice(-5).map((message) => ({
            id: message.id ?? null,
            role: message.role ?? "assistant",
            text: contentBlocksToText(message.content),
            createdAt: message.createdAt ?? null,
            model: message.model ?? null,
          })),
        })

        push("chat.status", {
          sessionKey,
          state: "connected",
        })

        unsubscribe = gateway.addMessageListener((message) => {
          if (message.type !== "event") return

          if (message.event === "session.message") {
            const payload = message.payload as SessionMessagePayload | undefined
            if (payload?.sessionKey !== sessionKey || !payload.message) return

            const messageId = payload.message.id ?? payload.messageId ?? null
            if (messageId && seenMessageIds.has(messageId)) return
            if (messageId) seenMessageIds.add(messageId)

            const role = payload.message.role ?? "assistant"
            const blocks = Array.isArray(payload.message.content) ? payload.message.content as Array<{ type?: string }> : []
            const blockTypes = blocks.map((block) => block?.type).filter(Boolean)

            if (role === "user") return
            if (role === "tool" || role === "tool_result" || role === "toolResult") return
            if (blockTypes.includes("toolCall") || blockTypes.includes("tool_use")) {
              push("chat.status", {
                sessionKey,
                state: "tool_running",
              })
              return
            }

            const text = contentBlocksToText(payload.message.content)
            push("chat.message", {
              sessionKey,
              messageId,
              role,
              content: payload.message.content ?? "",
              text,
              createdAt: payload.message.createdAt ?? (typeof payload.message.timestamp === "string" ? payload.message.timestamp : null),
              model: payload.message.model ?? null,
            })
            push("chat.status", {
              sessionKey,
              state: text ? "done" : "streaming",
            })
            return
          }

          if (message.event === "session.tool") {
            const payload = message.payload as SessionToolPayload | undefined
            if (payload?.sessionKey !== sessionKey) return

            const toolEventKey = `${payload.runId ?? "run"}:${(payload as { seq?: unknown }).seq ?? payload.data?.toolCallId ?? "tool"}:${payload.data?.phase ?? "phase"}`
            if (seenToolEvents.has(toolEventKey)) return
            seenToolEvents.add(toolEventKey)

            push("chat.tool", {
              sessionKey,
              runId: payload.runId ?? null,
              verboseLevel: payload.verboseLevel ?? null,
              toolOutputVisibility: toolOutputVisibility(payload.verboseLevel),
              phase: payload.data?.phase ?? null,
              name: payload.data?.name ?? null,
              toolCallId: payload.data?.toolCallId ?? null,
              args: payload.data?.args ?? null,
              partialResult: payload.data?.partialResult ?? null,
              result: payload.data?.result ?? null,
              error: payload.data?.error ?? null,
            })
            push("chat.status", {
              sessionKey,
              state: payload.data?.phase === "error"
                ? "error"
                : payload.data?.phase === "result"
                  ? "thinking"
                  : "tool_running",
              label: payload.data?.name ?? null,
            })
            return
          }
        })

        keepalive = setInterval(() => {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`))
        }, 15_000)
      } catch (error) {
        push("chat.error", {
          sessionKey,
          message: error instanceof Error ? error.message : "Unknown stream error",
        })
        controller.close()
        gateway?.close()
      }
    },
    cancel() {
      if (keepalive) clearInterval(keepalive)
      unsubscribe?.()
      gateway?.close()
    },
  })

  request.signal.addEventListener("abort", () => {
    if (keepalive) clearInterval(keepalive)
    unsubscribe?.()
    gateway?.close()
  }, { once: true })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
