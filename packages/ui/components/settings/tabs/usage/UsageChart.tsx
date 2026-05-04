"use client"

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts"
import type { DailyEntry } from "./types"

type UsageChartProps = {
  daily: DailyEntry[]
  lastUpdated: Date | null
  loading?: boolean
}

function formatLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ago`
}

export function UsageChart({
  daily,
  lastUpdated,
  loading = false,
}: UsageChartProps) {
  const chartData = daily.map((d) => ({
    date: d.date,
    label: formatLabel(d.date),
    inputTokens: d.input_tokens,
    outputTokens: d.output_tokens,
  }))

  return (
    <div className="flex w-full flex-col gap-3 rounded-md border border-border/40 bg-card/40 dark:bg-[#121212] p-5">
      {loading ? (
        <div className="flex h-[230px] w-full flex-col gap-3 sm:h-[250px]">
          <div className="h-full w-full animate-pulse rounded-[10px] bg-muted" />
        </div>
      ) : (
        <div className="h-[230px] min-w-0 sm:h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 8, right: 4, bottom: 0, left: -18 }}
            >
              <defs>
                <linearGradient
                  id="inputGrad"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor="#10b981"
                    stopOpacity={0.25}
                  />
                  <stop
                    offset="100%"
                    stopColor="#10b981"
                    stopOpacity={0.01}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="var(--color-border)"
              />
              <XAxis
                dataKey="label"
                tick={{
                  fontSize: 11,
                  fill: "var(--color-muted-foreground)",
                }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{
                  fontSize: 11,
                  fill: "var(--color-muted-foreground)",
                }}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatTokens}
              />
              <Tooltip
                cursor={{ stroke: 'var(--color-border)', strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    let formattedDate = label
                    if (payload[0]?.payload?.date) {
                      const d = new Date(payload[0].payload.date + "T00:00:00")
                      formattedDate = d.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    }

                    return (
                      <div className="flex flex-col gap-2 rounded-xl border border-border/15 bg-[var(--glass-bg)] px-4 py-3 shadow-xl shadow-black/40 dark:shadow-black/60 backdrop-blur-[32px] backdrop-saturate-[180%]">
                        <span className="text-[13px] font-bold text-foreground mb-1">
                          {formattedDate}
                        </span>
                        {payload.map((entry, index) => (
                          <div key={index} className="text-[13px] text-foreground/90">
                            {entry.name === "inputTokens" ? "Input" : "Output"} : {formatTokens(Number(entry.value))}
                          </div>
                        ))}
                      </div>
                    )
                  }
                  return null
                }}
              />
              <Area
                type="monotone"
                dataKey="inputTokens"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#inputGrad)"
                name="inputTokens"
                dot={false}
                activeDot={{ r: 4, fill: "#10b981", stroke: "var(--color-card)", strokeWidth: 2 }}
              />
              <Area
                type="monotone"
                dataKey="outputTokens"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="transparent"
                name="outputTokens"
                dot={false}
                activeDot={{ r: 4, fill: "#3b82f6", stroke: "var(--color-card)", strokeWidth: 2 }}
              />
              <Legend
                verticalAlign="bottom"
                height={28}
                formatter={(value: string) =>
                  value === "inputTokens"
                    ? "Input tokens"
                    : "Output tokens"
                }
                iconType="circle"
                iconSize={6}
                wrapperStyle={{
                  fontSize: "11px",
                  color: "var(--color-muted-foreground)",
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {lastUpdated && !loading && (
        <div className="flex justify-end pt-1">
          <span className="text-[11px] text-muted-foreground">
            Updated {timeAgo(lastUpdated)}
          </span>
        </div>
      )}
    </div>
  )
}
