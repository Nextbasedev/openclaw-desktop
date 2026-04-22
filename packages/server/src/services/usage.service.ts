import { ensureGatewayClient } from "../gateway/client.js"

type UsageSnapshot = {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  totalCostUsd: number
  activeSessions: number
  period: string
}

type UsageHistoryEntry = {
  date: string
  tokens: number
  costUsd: number
}

type UsageLimitsInfo = {
  maxTokensPerDay: number | null
  maxCostPerDay: number | null
  maxSessions: number | null
  currentUsagePercent: number | null
}

function normalizeSnapshot(
  raw: Record<string, unknown>,
): UsageSnapshot {
  return {
    totalTokens: Number(raw.totalTokens ?? 0),
    inputTokens: Number(raw.inputTokens ?? 0),
    outputTokens: Number(raw.outputTokens ?? 0),
    totalCostUsd: Number(raw.totalCostUsd ?? raw.costUsd ?? 0),
    activeSessions: Number(raw.activeSessions ?? 0),
    period: String(raw.period ?? "current"),
  }
}

export async function usageCurrent() {
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>(
    "sessions.usage",
  )
  if (!res.ok) {
    throw new Error(res.error?.message ?? "sessions.usage failed")
  }
  return { usage: normalizeSnapshot(res.payload ?? {}) }
}

export async function usageHistory(input: { period?: string }) {
  const gw = await ensureGatewayClient()
  const res = await gw.request<{
    entries?: Record<string, unknown>[]
    period?: string
  }>("usage.cost", { period: input.period ?? "30d" })
  if (!res.ok) {
    throw new Error(res.error?.message ?? "usage.cost failed")
  }
  const entries: UsageHistoryEntry[] = (
    res.payload?.entries ?? []
  ).map((e) => ({
    date: String(e.date ?? ""),
    tokens: Number(e.tokens ?? 0),
    costUsd: Number(e.costUsd ?? e.cost ?? 0),
  }))
  return { period: res.payload?.period ?? input.period ?? "30d", entries }
}

export async function usageLimits() {
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>(
    "usage.limits",
  )
  if (!res.ok) {
    throw new Error(res.error?.message ?? "usage.limits failed")
  }
  const raw = res.payload ?? {}
  const limits: UsageLimitsInfo = {
    maxTokensPerDay: raw.maxTokensPerDay
      ? Number(raw.maxTokensPerDay)
      : null,
    maxCostPerDay: raw.maxCostPerDay
      ? Number(raw.maxCostPerDay)
      : null,
    maxSessions: raw.maxSessions
      ? Number(raw.maxSessions)
      : null,
    currentUsagePercent: raw.currentUsagePercent
      ? Number(raw.currentUsagePercent)
      : null,
  }
  return { limits }
}

export async function usageSummary(input: {
  startDate?: string
  endDate?: string
}) {
  const empty = {
    totals: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
      totalTokens: 0, totalCost: 0, inputCost: 0, outputCost: 0,
      cacheReadCost: 0, cacheWriteCost: 0,
    },
    daily: [] as { date: string; totalTokens: number; totalCost: number }[],
    days: 0,
  }

  let gw: Awaited<ReturnType<typeof ensureGatewayClient>>
  try {
    gw = await ensureGatewayClient()
  } catch {
    return empty
  }

  const [currentRes, historyRes] = await Promise.allSettled([
    gw.request<Record<string, unknown>>("sessions.usage"),
    gw.request<{
      entries?: Record<string, unknown>[]
    }>("usage.cost", { period: "30d" }),
  ])

  const snap = normalizeSnapshot(
    currentRes.status === "fulfilled" && currentRes.value.ok
      ? (currentRes.value.payload ?? {})
      : {},
  )
  const entries =
    historyRes.status === "fulfilled" && historyRes.value.ok
      ? (historyRes.value.payload?.entries ?? [])
      : []

  const daily = entries.map((e) => ({
    date: String(e.date ?? ""),
    totalTokens: Number(e.tokens ?? 0),
    totalCost: Number(e.costUsd ?? e.cost ?? 0),
  }))

  const totalCost = daily.reduce((s, d) => s + d.totalCost, 0)
  const totalTokens = snap.totalTokens || daily.reduce((s, d) => s + d.totalTokens, 0)

  return {
    totals: {
      input: snap.inputTokens,
      output: snap.outputTokens,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens,
      totalCost,
      inputCost: totalCost * 0.6,
      outputCost: totalCost * 0.4,
      cacheReadCost: 0,
      cacheWriteCost: 0,
    },
    daily,
    days: daily.length,
  }
}

export async function usageEstimate(input: {
  model?: string
  tokens?: number
}) {
  const gw = await ensureGatewayClient()
  const res = await gw.request<Record<string, unknown>>(
    "usage.estimate",
    {
      model: input.model ?? "openai-codex/gpt-5.4",
      tokens: input.tokens ?? 1000,
    },
  )
  if (!res.ok) {
    throw new Error(res.error?.message ?? "usage.estimate failed")
  }
  const raw = res.payload ?? {}
  return {
    model: String(raw.model ?? input.model ?? "openai-codex/gpt-5.4"),
    tokens: Number(raw.tokens ?? input.tokens ?? 1000),
    estimatedCostUsd: Number(raw.estimatedCostUsd ?? raw.cost ?? 0),
    inputCostPer1k: Number(raw.inputCostPer1k ?? 0),
    outputCostPer1k: Number(raw.outputCostPer1k ?? 0),
  }
}
