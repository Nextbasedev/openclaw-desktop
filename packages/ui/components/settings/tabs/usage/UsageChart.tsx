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
    <div className="flex flex-col gap-0 rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 backdrop-blur-xl">
      {loading ? (
        <div className="h-[240px] space-y-4 py-3">
          <div className="ml-auto h-3 w-24 rounded bg-white/[0.06] animate-pulse" />
          <div className="flex h-[184px] items-end gap-3">
            {[44, 70, 52, 86, 63, 76, 48, 82, 58, 72, 54, 80].map((height, index) => (
              <div
                key={index}
                className="flex-1 rounded-t-lg bg-white/[0.06] animate-pulse"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          <div className="flex justify-center gap-6">
            <div className="h-3 w-20 rounded bg-white/[0.06] animate-pulse" />
            <div className="h-3 w-24 rounded bg-white/[0.06] animate-pulse" />
          </div>
        </div>
      ) : (
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
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
                  stopColor="#a1a1aa"
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor="#a1a1aa"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="rgba(255,255,255,0.04)"
            />
            <XAxis
              dataKey="label"
              tick={{
                fontSize: 11,
                fill: "rgba(255,255,255,0.35)",
              }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{
                fontSize: 11,
                fill: "rgba(255,255,255,0.35)",
              }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatTokens}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(24,24,27,0.95)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                fontSize: "12px",
                backdropFilter: "blur(12px)",
              }}
              itemStyle={{ color: "#fafafa" }}
              labelStyle={{
                color: "#fafafa",
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
              stroke="#a1a1aa"
              strokeWidth={2}
              fill="url(#inputGrad)"
              name="inputTokens"
            />
            <Area
              type="monotone"
              dataKey="outputTokens"
              stroke="#4ade80"
              strokeWidth={2}
              fill="transparent"
              name="outputTokens"
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
                color: "rgba(255,255,255,0.5)",
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
