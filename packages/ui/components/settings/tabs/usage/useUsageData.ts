"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@/lib/ipc"
import { dedupeRequest } from "@/lib/requestDedupe"
import type {
  UsagePeriod,
  UsageResponse,
  UsageDailyResponse,
  UsageSummary,
  ProviderStatus,
  DailyEntry,
} from "./types"

const PERIOD_DAYS: Record<UsagePeriod, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
}

export type ParsedUsage = {
  summary: UsageSummary
  providers: ProviderStatus[]
  daily: DailyEntry[]
  loading: boolean
  rangeLoading: boolean
  error: string | null
  lastUpdated: Date | null
}

const EMPTY_SUMMARY: UsageSummary = {
  totalCost: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
}

function fillMissingDays(daily: DailyEntry[], days: number): DailyEntry[] {
  if (days <= 0) return daily
  
  const result: DailyEntry[] = []
  const today = new Date()
  
  const dataMap = new Map(daily.map(d => [d.date, d]))
  
  // Create an array of exactly 'days' length ending today
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    // Get YYYY-MM-DD in local timezone
    const dateStr = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0]
    
    if (dataMap.has(dateStr)) {
      result.push(dataMap.get(dateStr)!)
    } else {
      result.push({
        date: dateStr,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
      })
    }
  }
  
  return result
}

export function useUsageData(period: UsagePeriod) {
  const [data, setData] = useState<ParsedUsage>({
    summary: EMPTY_SUMMARY,
    providers: [],
    daily: [],
    loading: true,
    rangeLoading: true,
    error: null,
    lastUpdated: null,
  })
  const loadedPeriodRef = useRef<UsagePeriod | null>(null)

  const periodRef = useRef(period)
  periodRef.current = period

  const fetchAll = useCallback(async () => {
    const requestedPeriod = periodRef.current
    setData((prev) => ({
      ...prev,
      loading: true,
      rangeLoading: loadedPeriodRef.current !== requestedPeriod,
      error: null,
    }))
    try {
      const days = PERIOD_DAYS[requestedPeriod]
      const usageRes = await dedupeRequest(
        `usage:${days}`,
        () => invoke<UsageResponse>("middleware_usage", { input: { days } }),
        { ttlMs: 30_000 },
      )
      const daily = Array.isArray(usageRes.daily)
        ? usageRes.daily
        : (await dedupeRequest(
            `usage-daily:${days}`,
            () => invoke<UsageDailyResponse>("middleware_usage_daily", { input: { days } }),
            { ttlMs: 30_000 },
          )).daily

      loadedPeriodRef.current = requestedPeriod
      
      // Zero-fill the daily array so the chart width properly reflects the requested period (e.g. 7d vs 30d)
      // For a 24h period we'll pad it to at least 2 days so Recharts can draw a line instead of a single dot.
      const displayDays = Math.max(2, days)
      const filledDaily = fillMissingDays(daily, displayDays)

      setData({
        summary: usageRes.summary,
        providers: usageRes.providers,
        daily: filledDaily,
        loading: false,
        rangeLoading: false,
        error: null,
        lastUpdated: new Date(),
      })
    } catch (err) {
      setData((prev) => ({
        ...prev,
        loading: false,
        rangeLoading: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to load usage data",
      }))
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [period, fetchAll])

  useEffect(() => {
    const interval = setInterval(fetchAll, 60_000)
    return () => clearInterval(interval)
  }, [fetchAll])

  return { ...data, refresh: fetchAll }
}
