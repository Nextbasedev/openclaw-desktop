export type SessionTokenUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  cost?: number | null
  contextLimit?: number | null
}

function parseTokenAmount(value: string | undefined): number | null {
  if (!value) return null
  const match = value.trim().match(/^([\d,.]+)\s*([kKmMbB])?$/)
  if (!match) return null
  const base = Number(match[1]?.replace(/,/g, ""))
  if (!Number.isFinite(base)) return null
  const suffix = match[2]?.toLowerCase()
  const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1
  return Math.round(base * multiplier)
}

function findAmount(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern)
  return parseTokenAmount(match?.[1])
}

export function parseGatewaySessionContextUsage(text: string): SessionTokenUsage | null {
  if (!text.includes("Tokens:") || !text.includes("Context:")) return null

  const input = findAmount(text, /Tokens:\s*([\d,.]+\s*[kKmMbB]?)\s*in\s*\/\s*[\d,.]+\s*[kKmMbB]?\s*out/i)
  const output = findAmount(text, /Tokens:\s*[\d,.]+\s*[kKmMbB]?\s*in\s*\/\s*([\d,.]+\s*[kKmMbB]?)\s*out/i)
  const cacheRead = findAmount(text, /Cache:[^\n·]*·\s*([\d,.]+\s*[kKmMbB]?)\s*cached/i) ?? 0
  const cacheWrite = findAmount(text, /Cache:[^\n·]*·\s*[\d,.]+\s*[kKmMbB]?\s*cached,\s*([\d,.]+\s*[kKmMbB]?)\s*new/i) ?? 0
  const contextUsed = findAmount(text, /Context:\s*([\d,.]+\s*[kKmMbB]?)\s*\//i)
  const contextLimit = findAmount(text, /Context:\s*[\d,.]+\s*[kKmMbB]?\s*\/\s*([\d,.]+\s*[kKmMbB]?)/i)

  if (input == null || output == null || contextUsed == null) return null

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: contextUsed,
    cost: null,
    contextLimit,
  }
}

export function latestGatewaySessionContextUsage<T extends { text?: string; model?: string | null }>(
  messages: T[]
): SessionTokenUsage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.model && message.model !== "gateway-injected") continue
    const usage = parseGatewaySessionContextUsage(message.text ?? "")
    if (usage) return usage
  }
  return null
}
