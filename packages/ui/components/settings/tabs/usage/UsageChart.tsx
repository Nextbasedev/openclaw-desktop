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
    <div className="flex min-w-0 flex-col gap-0 rounded-xl border border-border/45 bg-card/75 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl sm:p-5">
      {loading ? (
        <div className="h-[230px] min-w-0 animate-pulse sm:h-[250px]">
          <div className="relative h-full min-w-0 px-1 pb-8 pl-9 pt-3">
            <div className="absolute inset-x-9 bottom-9 top-4">
              {[0, 1, 2, 3, 4].map((line) => (
                <div
                  key={line}
                  className="absolute left-0 right-0 border-t border-dashed border-border/60"
                  style={{ top: `${line * 25}%` }}
                />
              ))}
              <svg
                aria-hidden="true"
                className="absolute inset-0 size-full overflow-visible"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                <path
                  d="M0 98 C12 86 24 78 34 64 C48 44 60 24 75 12 C84 5 91 14 100 98"
                  fill="none"
                  stroke="var(--muted-foreground)"
                  strokeLinecap="round"
                  strokeWidth="1.4"
                  opacity="0.45"
                />
                <path
                  d="M0 98 C16 96 26 94 40 95 C54 97 67 93 79 92 C88 92 94 94 100 98"
                  fill="none"
                  stroke="var(--chart-2)"
                  strokeLinecap="round"
                  strokeWidth="1.4"
                  opacity="0.65"
                />
              </svg>
            </div>

            <div className="absolute bottom-8 left-0 top-2 flex flex-col justify-between text-[11px] text-muted-foreground/55">
              <span>20.0M</span>
              <span>15.0M</span>
              <span>10.0M</span>
              <span>5.0M</span>
              <span>0</span>
            </div>

            <div className="absolute bottom-4 left-9 right-3 flex justify-between text-[11px] text-muted-foreground/55">
              <span>Apr 30</span>
              <span>May 1</span>
              <span>May 2</span>
              <span>May 3</span>
              <span>May 4</span>
            </div>

            <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-4 text-[11px] text-muted-foreground/60">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-muted-foreground/70" />
                Input tokens
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-chart-2" />
                Output tokens
              </span>
            </div>

            <div className="absolute bottom-0 right-1 h-3 w-20 rounded bg-muted/55" />
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
