import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const SERVER_URL =
  process.env.JARVIS_SERVER_URL ||
  process.env.NEXT_PUBLIC_SERVER_URL ||
  "http://127.0.0.1:4000"

type RouteContext = {
  params: Promise<{ sessionKey: string }>
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function fixtureChatStream(sessionKey: string) {
  let keepAlive: ReturnType<typeof setInterval> | null = null
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": chat fixture stream\n\n"))
      controller.enqueue(
        encoder.encode(
          sse("chat.ready", {
            type: "chat.ready",
            sessionKey,
          }),
        ),
      )
      controller.enqueue(
        encoder.encode(
          sse("chat.status", {
            type: "chat.status",
            state: "done",
            label: "fixture",
          }),
        ),
      )
      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"))
      }, 15000)
    },
    cancel() {
      if (keepAlive) clearInterval(keepAlive)
    },
  })

  return stream
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { sessionKey } = await context.params

  try {
    const upstream = await fetch(
      `${SERVER_URL}/api/stream/chat/${encodeURIComponent(sessionKey)}`,
      { headers: { "Cache-Control": "no-cache" } },
    )
    if (upstream.ok && upstream.body) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "Content-Type": "text/event-stream",
        },
      })
    }
  } catch {
    // Dev fixture stream below keeps transcript pages calm without backend.
  }

  if (process.env.NODE_ENV === "production") {
    return new Response("Chat stream upstream unavailable", { status: 502 })
  }

  return new Response(fixtureChatStream(sessionKey), {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream",
    },
  })
}
