export type UsagePeriod = "24h" | "7d" | "30d"

export type UsageSummary = {
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
}

export type ProviderWindow = {
  label: string
  usedPercent: number
  resetAt: number
}

export type ProviderStatus = {
  provider: string
  displayName: string
  windows: ProviderWindow[]
  plan?: string
  error?: string
}

export type UsageResponse = {
  range: { days: number }
  summary: UsageSummary
  providers: ProviderStatus[]
  // Older middleware versions return the chart data from middleware_usage_daily.
  daily?: DailyEntry[]
}

export type DailyEntry = {
  date: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  cost_usd: number
}

export type UsageDailyResponse = {
  range: { days: number }
  daily: DailyEntry[]
}
