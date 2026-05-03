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
    <div className="flex min-w-0 flex-col gap-0 rounded-xl border border-border/45 bg-card/75 p-4 shadow-[0_16px_48px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl sm:p-5">
      {loading ? (
        <div className="h-[230px] space-y-4 py-3 sm:h-[250px]">
          <div className="ml-auto h-3 w-24 max-w-full animate-pulse rounded bg-muted/55" />
          <div className="flex h-[174px] min-w-0 items-end gap-2 sm:h-[194px] sm:gap-3">
            {[44, 70, 52, 86, 63, 76, 48, 82, 58, 72, 54, 80].map((height, index) => (
              <div
                key={index}
                className="min-w-0 flex-1 animate-pulse rounded-t bg-muted/55"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          <div className="flex justify-center gap-6">
            <div className="h-3 w-20 animate-pulse rounded bg-muted/55" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted/55" />
          </div>
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
                  stopColor="var(--muted-foreground)"
                  stopOpacity={0.28}
                />
                <stop
                  offset="100%"
                  stopColor="var(--muted-foreground)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="var(--border)"
              opacity={0.7}
            />
            <XAxis
              dataKey="label"
              tick={{
                fontSize: 11,
                fill: "var(--muted-foreground)",
              }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{
                fontSize: 11,
                fill: "var(--muted-foreground)",
              }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatTokens}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                fontSize: "12px",
                backdropFilter: "blur(12px)",
                boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
              }}
              itemStyle={{ color: "var(--foreground)" }}
              labelStyle={{
                color: "var(--foreground)",
                fontWeight: 600,
                marginBottom: 4,
              }}
              labelFormatter={(_, payload) => {
                if (payload?.[0]?.payload?.date) {
                  const d = new Date(
                    payload[0].payload.date + "T00:00:00",
                  )
                  return d.toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })
                }
                return String(_)
              }}
              formatter={(value, name) => [
                formatTokens(Number(value)),
                name === "inputTokens" ? "Input" : "Output",
              ]}
            />
            <Area
              type="monotone"
              dataKey="inputTokens"
              stroke="var(--muted-foreground)"
              strokeWidth={2}
              fill="url(#inputGrad)"
              name="inputTokens"
              dot={false}
              activeDot={{ r: 3 }}
            />
            <Area
              type="monotone"
              dataKey="outputTokens"
              stroke="var(--chart-2)"
              strokeWidth={2}
              fill="transparent"
              name="outputTokens"
              dot={false}
              activeDot={{ r: 3 }}
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
                color: "var(--muted-foreground)",
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      )}
      {lastUpdated && !loading && (
        <div className="flex justify-end pt-1">
          <span className="text-[10px] text-muted-foreground/50">
            Updated {timeAgo(lastUpdated)}
          </span>
        </div>
      )}
    </div>
  )
}
