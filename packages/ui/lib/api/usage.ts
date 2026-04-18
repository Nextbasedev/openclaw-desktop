import { tauriInvoke } from "@/lib/tauri"

export type CostUsageTotals = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  totalCost: number
  inputCost: number
  outputCost: number
  cacheReadCost: number
  cacheWriteCost: number
}

export type DailyUsageEntry = {
  date: string
  totalTokens: number
  totalCost: number
}

export type UsageSummaryResponse = {
  totals: CostUsageTotals
  daily: DailyUsageEntry[]
  days: number
}

export type MessageCounts = {
  total: number
  user: number
  assistant: number
  toolCalls: number
  toolResults: number
  errors: number
}

export type SessionUsageEntry = {
  key: string
  label?: string
  model?: string
  totals: CostUsageTotals
  messageCounts?: MessageCounts
  firstActivity?: number
  lastActivity?: number
}

export type ProjectUsage = {
  projectId: string
  projectName: string
  totals: CostUsageTotals
  sessionCount: number
  sessions: SessionUsageEntry[]
}

export type UsageByProjectResponse = {
  projects: ProjectUsage[]
  truncated: boolean
}

export async function fetchUsageSummary(
  startDate?: string,
  endDate?: string,
): Promise<UsageSummaryResponse> {
  return tauriInvoke<UsageSummaryResponse>("middleware_usage_summary", {
    input: { startDate, endDate },
  })
}

export async function fetchUsageByProject(
  profileId: string,
  projectId?: string,
  startDate?: string,
  endDate?: string,
): Promise<UsageByProjectResponse> {
  return tauriInvoke<UsageByProjectResponse>("middleware_usage_by_project", {
    input: { profileId, projectId, startDate, endDate },
  })
}

export async function fetchUsageSession(
  sessionKey: string,
): Promise<{ session: SessionUsageEntry }> {
  return tauriInvoke<{ session: SessionUsageEntry }>("middleware_usage_session", {
    input: { sessionKey },
  })
}
