import {
  connectToOpenClawGateway,
  createChatSession,
  deleteChatSession,
  openChatEventStream,
} from "../packages/middleware/src/index.ts"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const session = await createChatSession({
    label: `Live reasoning check ${new Date().toISOString()}`,
    verboseLevel: "full",
  })

  const gateway = await connectToOpenClawGateway({
    scopes: ["operator.read", "operator.write", "operator.approvals", "operator.admin"],
  })

  let stream: { close(): void } | null = null
  const events: Array<Record<string, unknown>> = []
  let sawReasoning = false
  let sawFinal = false
  let runId: string | null = null

  try {
    const patch = await gateway.request("sessions.patch", {
      key: session.sessionKey,
      reasoningLevel: "stream",
      thinkingLevel: "medium",
      verboseLevel: "full",
    })
    if (!patch.ok) throw new Error(patch.error?.message ?? "sessions.patch failed")

    stream = await openChatEventStream({
      sessionKey: session.sessionKey,
      onEvent(event) {
        events.push(event as Record<string, unknown>)
        if (event.type === "chat.reasoning") {
          sawReasoning = true
          console.log("REASONING_EVENT", JSON.stringify(event))
        }
        if (event.type === "chat.message" && event.role === "assistant" && event.text) {
          sawFinal = true
          console.log("FINAL_MESSAGE", JSON.stringify({ text: event.text, messageId: event.messageId }))
        }
        if (event.type === "chat.status") {
          console.log("STATUS", JSON.stringify(event))
        }
      },
    })

    const send = await gateway.request<{ runId?: string; status?: string }>("chat.send", {
      sessionKey: session.sessionKey,
      message:
        "Think step by step about whether 19 is prime, then answer with exactly 'YES_PRIME' and nothing else.",
      thinking: "high",
      timeoutMs: 90000,
      idempotencyKey: `live-reasoning-${Date.now()}`,
    }, 95000)
    if (!send.ok) throw new Error(send.error?.message ?? "chat.send failed")
    runId = send.payload?.runId ?? null
    console.log("CHAT_SEND", JSON.stringify(send.payload ?? {}))

    const startedAt = Date.now()
    while (Date.now() - startedAt < 90000) {
      if (sawReasoning && sawFinal) break
      await sleep(1000)
    }

    console.log(
      "SUMMARY",
      JSON.stringify({
        sessionKey: session.sessionKey,
        runId,
        sawReasoning,
        sawFinal,
        eventTypes: Array.from(new Set(events.map((event) => event.type))),
      }),
    )

    if (!sawReasoning) {
      throw new Error("Did not observe chat.reasoning event from live OpenClaw run")
    }
    if (!sawFinal) {
      throw new Error("Did not observe final assistant message from live OpenClaw run")
    }
  } finally {
    stream?.close()
    gateway.close()
    await deleteChatSession(session.sessionKey).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error("LIVE_REASONING_CHECK_FAILED", error)
  process.exit(1)
})
