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
  return latestGatewayThinkingOptions(messages)?.current ?? null
}

/** Read the authoritative `/think` response when it is present in the session. */
export function latestGatewayThinkingOptions(messages: GatewayThinkingMessage[]): { current: string | null; options: string[] } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "assistant") continue
    const current = thinkingLevelFromGatewayText(message.text)
    const optionsLine = message.text.match(/options:\s*([^\n.]+)/i)?.[1]
    const options = optionsLine
      ? optionsLine.split(",").map((option) => option.trim().toLowerCase()).filter(Boolean)
      : []
    if (current || options.length > 0) return { current, options }
  }
  return null
}
