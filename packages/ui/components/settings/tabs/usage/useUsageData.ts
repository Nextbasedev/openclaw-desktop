"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@/lib/ipc"
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
      const [usageRes, dailyRes] = await Promise.all([
        invoke<UsageResponse>("middleware_usage", {
          input: { days },
        }),
        invoke<UsageDailyResponse>("middleware_usage_daily", {
          input: { days },
        }),
      ])

      loadedPeriodRef.current = requestedPeriod
      setData({
        summary: usageRes.summary,
        providers: usageRes.providers,
        daily: dailyRes.daily,
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
