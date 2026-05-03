import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const SERVER_URL =
  process.env.OPENCLAW_SERVER_URL ||
  process.env.NEXT_PUBLIC_SERVER_URL ||
  "http://127.0.0.1:8787"

export async function GET() {
  try {
    const upstream = await fetch(`${SERVER_URL}/health`, {
      headers: { "Cache-Control": "no-cache" },
    })
    const text = await upstream.text()

    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "OpenClaw middleware is unreachable from the Next server. Start the middleware server on port 8787 or set OPENCLAW_SERVER_URL/NEXT_PUBLIC_SERVER_URL to the middleware origin.",
        backendUrl: SERVER_URL,
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    )
  }
}
