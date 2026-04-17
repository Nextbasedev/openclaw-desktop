import crypto from "node:crypto"

import { NextResponse } from "next/server"

import { connectToOpenClawGateway, contentBlocksToText } from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionKey = searchParams.get("sessionKey")?.trim()

  if (!sessionKey) {
    return NextResponse.json({ error: "sessionKey is required" }, { status: 400 })
  }

  try {
    const gateway = await connectToOpenClawGateway({ scopes: ["operator.read", "operator.write", "operator.approvals"] })
    try {
      const response = await gateway.request<{
        sessionKey: string
        messages?: Array<{
          id?: string
          role?: string
          content?: unknown
          createdAt?: string
          timestamp?: string | number
          model?: string
        }>
        thinkingLevel?: string
        verboseLevel?: string
      }>("chat.history", { sessionKey, limit: 200 })

      if (!response.ok) {
        return NextResponse.json({ error: response.error?.message ?? "chat.history failed" }, { status: 502 })
      }

      const payload = response.payload
      return NextResponse.json({
        sessionKey: payload?.sessionKey ?? sessionKey,
        thinkingLevel: payload?.thinkingLevel ?? null,
        verboseLevel: payload?.verboseLevel ?? null,
        messages: (payload?.messages ?? []).map((message) => ({
          id: message.id ?? crypto.randomUUID(),
          role: message.role ?? "assistant",
          content: message.content ?? "",
          text: contentBlocksToText(message.content),
          createdAt: message.createdAt ?? (typeof message.timestamp === "string" ? message.timestamp : new Date().toISOString()),
          model: message.model ?? null,
        })),
      })
    } finally {
      gateway.close()
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown gateway error" }, { status: 500 })
  }
}
