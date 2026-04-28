import { NextRequest, NextResponse } from "next/server"
import { cronFixtureResponse } from "./fixtures"

const SERVER_URL =
  process.env.JARVIS_SERVER_URL ||
  process.env.NEXT_PUBLIC_SERVER_URL ||
  "http://127.0.0.1:4000"

type RouteContext = {
  params: Promise<{ command: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { command } = await context.params
  const body = await request.text()
  const forceFixture =
    process.env.NODE_ENV !== "production" &&
    request.headers.get("x-jarvis-fixture") === "1"

  if (forceFixture) {
    const parsed = body ? JSON.parse(body) as unknown : {}
    const fixture = cronFixtureResponse(command, parsed)
    if (fixture) return NextResponse.json(fixture)
  }

  try {
    const upstream = await fetch(
      `${SERVER_URL}/api/ipc/${encodeURIComponent(command)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body || "{}",
      },
    )
    const text = await upstream.text()
    if (upstream.ok) {
      return new NextResponse(text, {
        status: upstream.status,
        headers: {
          "Content-Type":
            upstream.headers.get("Content-Type") ?? "application/json",
        },
      })
    }
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/json",
      },
    })
  } catch {
    // Dev-only fast smoke path below.
  }

  if (process.env.NODE_ENV !== "production") {
    const parsed = body ? JSON.parse(body) as unknown : {}
    const fixture = cronFixtureResponse(command, parsed)
    if (fixture) return NextResponse.json(fixture)
  }

  return NextResponse.json(
    {
      error: `IPC upstream unavailable: ${command}. Browser clients should call /api/ipc/${command} on the Jarvis UI origin, not http://127.0.0.1:3001 directly. Start the middleware server on port 3001 or set JARVIS_SERVER_URL/NEXT_PUBLIC_SERVER_URL to the backend origin.`,
      backendUrl: SERVER_URL,
    },
    { status: 502 },
  )
}
