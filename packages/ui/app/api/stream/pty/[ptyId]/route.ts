import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const SERVER_URL =
  process.env.OPENCLAW_SERVER_URL ||
  process.env.NEXT_PUBLIC_SERVER_URL ||
  "http://127.0.0.1:8787"

type RouteContext = {
  params: Promise<{ ptyId: string }>
}

function fixturePtyStream() {
  let keepAlive: ReturnType<typeof setInterval> | null = null
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": pty fixture stream\n\n"))
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
  const { ptyId } = await context.params

  try {
    const upstream = await fetch(
      `${SERVER_URL}/api/stream/pty/${encodeURIComponent(ptyId)}`,
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
    // Dev fixture stream below keeps the terminal pane non-fatal offline.
  }

  if (process.env.NODE_ENV === "production") {
    return new Response("PTY stream upstream unavailable", { status: 502 })
  }

  return new Response(fixturePtyStream(), {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream",
    },
  })
}
