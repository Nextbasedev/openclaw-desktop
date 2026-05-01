import { ensureGatewayClient } from "../gateway/client.js"

type CostTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  totalCost: number
}

type CostDay = CostTotals & { date: string }

type CostPayload = {
  totals: CostTotals
  daily: CostDay[]
}

type ProviderWindow = {
  label: string
  usedPercent: number
  resetAt: number
}

type ProviderStatus = {
  provider: string
  displayName: string
  windows: ProviderWindow[]
  plan?: string
  error?: string
}

type StatusPayload = {
  providers: ProviderStatus[]
}

export async function usage(input: { days?: number }) {
  const gw = await ensureGatewayClient()
  const days = input.days ?? 30

  const [costRes, statusRes] = await Promise.allSettled([
    gw.request<CostPayload>("usage.cost", {
      period: `${days}d`,
    }),
    gw.request<StatusPayload>("usage.status"),
  ])

  const cost =
    costRes.status === "fulfilled" && costRes.value.ok
      ? costRes.value.payload
      : null
  const status =
    statusRes.status === "fulfilled" && statusRes.value.ok
      ? statusRes.value.payload
      : null

  const totals = cost?.totals
  return {
    range: { days },
    summary: {
      totalCost: totals?.totalCost ?? 0,
      totalInputTokens: totals?.input ?? 0,
      totalOutputTokens: totals?.output ?? 0,
      cacheReadTokens: totals?.cacheRead ?? 0,
      cacheWriteTokens: totals?.cacheWrite ?? 0,
      totalTokens: totals?.totalTokens ?? 0,
    },
    providers: status?.providers ?? [],
  }
}

export async function usageDaily(input: { days?: number }) {
  const gw = await ensureGatewayClient()
  const days = input.days ?? 7

  const res = await gw.request<CostPayload>("usage.cost", {
    period: `${days}d`,
  })
  if (!res.ok) {
    throw new Error(
      res.error?.message ?? "usage.cost failed",
    )
  }

  const allDays = (res.payload?.daily ?? []).map((d) => ({
    date: d.date,
    input_tokens: d.input,
    output_tokens: d.output,
    cache_read_tokens: d.cacheRead,
    cache_write_tokens: d.cacheWrite,
    total_tokens: d.totalTokens,
    cost_usd: d.totalCost,
  }))

  const daily = allDays.slice(-days)

  return {
    range: { days },
    daily,
  }
}
