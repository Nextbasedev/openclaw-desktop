export type GatewayThinkingMessage = {
  role: "user" | "assistant"
  text: string
}

function thinkingLevelFromGatewayText(text: string): string | null {
  const explicit = text.match(/current\s+thinking\s+level:\s*([a-z][a-z-]*)\b/i)
  if (explicit) return explicit[1].toLowerCase()

  const status = text.match(/(?:^|[\n·])\s*think:\s*([a-z][a-z-]*)\b/i)
  return status?.[1]?.toLowerCase() ?? null
}

/**
 * Gateway injects the authoritative result for /think and /status into the
 * session transcript. Read the latest such message so the composer displays
 * the level actually active in this chat rather than a model-global default.
 */
export function latestGatewayThinkingLevel(messages: GatewayThinkingMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "assistant") continue
    const level = thinkingLevelFromGatewayText(message.text)
    if (level) return level
  }
  return null
}
