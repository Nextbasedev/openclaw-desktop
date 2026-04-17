import crypto from "node:crypto"

import { NextResponse } from "next/server"

import { connectToOpenClawGateway } from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionKey?: string
    text?: string
    timeoutMs?: number
  }

  const sessionKey = body.sessionKey?.trim()
  const text = body.text?.trim()

  if (!sessionKey || !text) {
    return NextResponse.json({ error: "sessionKey and text are required" }, { status: 400 })
  }

  try {
    const gateway = await connectToOpenClawGateway({ scopes: ["operator.read", "operator.write", "operator.approvals"] })
    try {
      const response = await gateway.request<{ runId?: string; status?: string }>("chat.send", {
        sessionKey,
        message: text,
        timeoutMs: body.timeoutMs ?? 60_000,
        idempotencyKey: crypto.randomUUID(),
      }, 65_000)

      if (!response.ok) {
        return NextResponse.json({ error: response.error?.message ?? "chat.send failed" }, { status: 502 })
      }

      return NextResponse.json({
        accepted: true,
        sessionKey,
        runId: response.payload?.runId ?? null,
        status: response.payload?.status ?? "started",
      })
    } finally {
      gateway.close()
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown gateway error" }, { status: 500 })
  }
}
