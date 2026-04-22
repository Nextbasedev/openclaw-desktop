import { useState, useEffect, useCallback } from "react"
import { fetchUsageSummary, type UsageSummaryResponse } from "@/lib/api/usage"

type UseUsageSummaryResult = {
  data: UsageSummaryResponse | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useUsageSummary(
  startDate?: string,
  endDate?: string,
): UseUsageSummaryResult {
  const [data, setData] = useState<UsageSummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchUsageSummary(startDate, endDate)
      setData(result)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, error, refetch: load }
}
