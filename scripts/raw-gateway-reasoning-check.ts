import { connectToOpenClawGateway, createChatSession, deleteChatSession } from "../packages/middleware/src/index.ts"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const session = await createChatSession({
    label: `Raw gateway reasoning check ${new Date().toISOString()}`,
    verboseLevel: "full",
  })

  const gateway = await connectToOpenClawGateway({
    scopes: ["operator.read", "operator.write", "operator.approvals", "operator.admin"],
  })

  let sawRawThinking = false
  let sawFinal = false

  try {
    const patch = await gateway.request("sessions.patch", {
      key: session.sessionKey,
      reasoningLevel: "stream",
      thinkingLevel: "high",
      verboseLevel: "full",
    })
    if (!patch.ok) throw new Error(patch.error?.message ?? "sessions.patch failed")

    await gateway.request("sessions.subscribe", {})
    await gateway.request("sessions.messages.subscribe", { key: session.sessionKey })

    const stop = gateway.addMessageListener((message) => {
      if (!message || typeof message !== "object" || !("type" in message) || message.type !== "event") return
      if (message.event === "agent") {
        const payload = message.payload as {
          sessionKey?: string
          stream?: string
          runId?: string
          data?: { text?: string; delta?: string }
        } | undefined
        if (payload?.sessionKey !== session.sessionKey) return
        console.log("RAW_AGENT", JSON.stringify(payload))
        if (payload.stream === "thinking") sawRawThinking = true
      }
      if (message.event === "session.message") {
        const payload = message.payload as { sessionKey?: string; message?: { role?: string; content?: unknown } } | undefined
        if (payload?.sessionKey !== session.sessionKey) return
        console.log("RAW_SESSION_MESSAGE", JSON.stringify(payload))
        const role = payload?.message?.role
        if (role === "assistant") sawFinal = true
      }
    })

    try {
      const send = await gateway.request<{ runId?: string; status?: string }>("chat.send", {
        sessionKey: session.sessionKey,
        message: "Think step by step about whether 29 is prime, then answer with exactly 'YES_PRIME' and nothing else.",
        thinking: "high",
        timeoutMs: 90000,
        idempotencyKey: `raw-reasoning-${Date.now()}`,
      }, 95000)
      if (!send.ok) throw new Error(send.error?.message ?? "chat.send failed")
      console.log("CHAT_SEND", JSON.stringify(send.payload ?? {}))

      const startedAt = Date.now()
      while (Date.now() - startedAt < 90000) {
        if (sawRawThinking && sawFinal) break
        await sleep(1000)
      }
    } finally {
      stop()
    }

    console.log("SUMMARY", JSON.stringify({ sessionKey: session.sessionKey, sawRawThinking, sawFinal }))

    if (!sawRawThinking) {
      throw new Error("Current OpenClaw did not emit raw agent thinking events for this live run")
    }
  } finally {
    gateway.close()
    await deleteChatSession(session.sessionKey).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error("RAW_GATEWAY_REASONING_CHECK_FAILED", error)
  process.exit(1)
})
