import { sendChatMessage, openChatEventStream, type ChatStreamEvent } from "middleware"

const NAMING_PROMPT = `Based on the user's message, generate a short descriptive title (3-6 words) for this conversation. Respond with ONLY the title text, nothing else. No quotes, no punctuation at the end.`

function autoNameFromMessage(text: string): string {
  const clean = text.replace(/\n/g, " ").trim()
  if (clean.length <= 50) return clean
  return clean.slice(0, 47) + "..."
}

export async function generateConversationName(input: {
  sessionKey: string
  firstMessage: string
}): Promise<{ name: string; source: "gateway" | "truncated" }> {
  const fallback = autoNameFromMessage(input.firstMessage)

  try {
    const collected: string[] = []

    await sendChatMessage({
      sessionKey: input.sessionKey,
      text: `${NAMING_PROMPT}\n\nUser message: "${input.firstMessage}"`,
    })

    const handle = await openChatEventStream({
      sessionKey: input.sessionKey,
      onEvent: (event: ChatStreamEvent) => {
        if (event.type === "chat.message" && "text" in event && typeof event.text === "string") {
          collected.push(event.text)
        }
        if (event.type === "chat.status" && event.state === "done") {
          handle.close()
        }
        if (event.type === "chat.error") {
          handle.close()
        }
      },
    })

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        handle.close()
        resolve()
      }, 10000)

      const check = setInterval(() => {
        if (collected.length > 0) {
          clearInterval(check)
          clearTimeout(timeout)
          resolve()
        }
      }, 200)
    })

    const raw = collected.join("").trim()
    if (raw.length > 0 && raw.length <= 100) {
      return { name: raw, source: "gateway" }
    }
    return { name: fallback, source: "truncated" }
  } catch {
    return { name: fallback, source: "truncated" }
  }
}

export function quickName(input: { text: string }): { name: string } {
  return { name: autoNameFromMessage(input.text) }
}
