export type SessionTokenUsage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  cost?: number | null
  contextLimit?: number | null
}

export function normalizeSessionTokenUsage(value: unknown): SessionTokenUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const numberValue = (key: string) => {
    const raw = record[key]
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const nullableNumberValue = (key: string) => {
    const raw = record[key]
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const input = numberValue("input")
  const output = numberValue("output")
  const cacheRead = numberValue("cacheRead")
  const cacheWrite = numberValue("cacheWrite")
  const total = numberValue("total") || input + output + cacheRead + cacheWrite
  if (total <= 0) return null

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    cost: nullableNumberValue("cost"),
    contextLimit: nullableNumberValue("contextLimit"),
  }
}
