"use client"

import { CronOptionSelect, type CronOption } from "./CronOptionSelect"
import { formatScheduleLabel } from "./cron-schedule-format"
import { cn } from "@/lib/utils"

type ScheduleType = "at" | "every" | "cron"

type ScheduleMode = "interval" | "daily" | "weekly" | "monthly" | "once" | "advanced"

type CronScheduleEditorProps = {
  schedule: string
  scheduleType: ScheduleType
  onChange: (next: { schedule: string; scheduleType: ScheduleType }) => void
}

const modeOptions: CronOption[] = [
  { value: "interval", label: "Every few minutes/hours" },
  { value: "daily", label: "Daily at a time" },
  { value: "weekly", label: "Weekly on a day" },
  { value: "monthly", label: "Monthly on a date" },
  { value: "once", label: "One time" },
  { value: "advanced", label: "Advanced cron" },
]

const intervalUnitOptions: CronOption[] = [
  { value: "m", label: "Minutes" },
  { value: "h", label: "Hours" },
  { value: "d", label: "Days" },
]

const weekdayOptions: CronOption[] = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
]

function splitCron(schedule: string): string[] | null {
  const parts = schedule.trim().split(/\s+/)
  return parts.length === 5 ? parts : null
}

function parseCronTime(schedule: string): string {
  const parts = splitCron(schedule)
  if (!parts) return "09:00"
  const [minute, hour] = parts
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return "09:00"
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`
}

function timeToCronParts(time: string): { hour: string; minute: string } {
  const [hour = "9", minute = "0"] = time.split(":")
  return {
    hour: String(Math.max(0, Math.min(23, Number(hour) || 0))),
    minute: String(Math.max(0, Math.min(59, Number(minute) || 0))),
  }
}

function parseInterval(schedule: string, scheduleType: ScheduleType) {
  if (scheduleType === "every") {
    const match = schedule.trim().match(/^(\d+)\s*([mhd])$/i)
    if (match) return { value: match[1], unit: match[2].toLowerCase() }
  }

  const parts = splitCron(schedule)
  const minuteEvery = parts?.[0].match(/^\*\/(\d+)$/)
  if (
    minuteEvery &&
    parts?.[1] === "*" &&
    parts?.[2] === "*" &&
    parts?.[3] === "*" &&
    parts?.[4] === "*"
  ) {
    return { value: minuteEvery[1], unit: "m" }
  }

  return { value: "30", unit: "m" }
}

function inferMode(schedule: string, scheduleType: ScheduleType): ScheduleMode {
  if (scheduleType === "at") return "once"
  if (scheduleType === "every") return "interval"

  const parts = splitCron(schedule)
  if (!parts) return "advanced"
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  if (/^\*\/\d+$/.test(minute) && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "interval"
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "daily"
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    return "weekly"
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
    return "monthly"
  }
  return "advanced"
}

function oneHourFromNowLocal(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16)
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

export function CronScheduleEditor({
  schedule,
  scheduleType,
  onChange,
}: CronScheduleEditorProps) {
  const mode = inferMode(schedule, scheduleType)
  const interval = parseInterval(schedule, scheduleType)
  const parts = splitCron(schedule)
  const time = parseCronTime(schedule)
  const dayOfWeek = parts?.[4] && parts[4] !== "*" ? parts[4] : "1"
  const dayOfMonth = parts?.[2] && parts[2] !== "*" ? parts[2] : "1"
  const label = formatScheduleLabel({ schedule, scheduleType })

  function updateMode(nextMode: string) {
    if (nextMode === mode) return
    if (nextMode === "interval") {
      onChange({ scheduleType: "every", schedule: `${interval.value}${interval.unit}` })
    } else if (nextMode === "daily") {
      onChange({ scheduleType: "cron", schedule: "0 9 * * *" })
    } else if (nextMode === "weekly") {
      onChange({ scheduleType: "cron", schedule: "0 9 * * 1" })
    } else if (nextMode === "monthly") {
      onChange({ scheduleType: "cron", schedule: "0 9 1 * *" })
    } else if (nextMode === "once") {
      onChange({ scheduleType: "at", schedule: oneHourFromNowLocal() })
    } else {
      onChange({ scheduleType: "cron", schedule: schedule || "0 9 * * *" })
    }
  }

  function updateInterval(value: string, unit = interval.unit) {
    const safeValue = String(Math.max(1, Number(value) || 1))
    onChange({ scheduleType: "every", schedule: `${safeValue}${unit}` })
  }

  function updateDailyTime(value: string) {
    const { hour, minute } = timeToCronParts(value)
    onChange({ scheduleType: "cron", schedule: `${minute} ${hour} * * *` })
  }

  function updateWeekly(value: { time?: string; day?: string }) {
    const { hour, minute } = timeToCronParts(value.time ?? time)
    onChange({
      scheduleType: "cron",
      schedule: `${minute} ${hour} * * ${value.day ?? dayOfWeek}`,
    })
  }

  function updateMonthly(value: { time?: string; day?: string }) {
    const { hour, minute } = timeToCronParts(value.time ?? time)
    const safeDay = String(Math.max(1, Math.min(31, Number(value.day ?? dayOfMonth) || 1)))
    onChange({ scheduleType: "cron", schedule: `${minute} ${hour} ${safeDay} * *` })
  }

  return (
    <div className="flex flex-col gap-2">
      <CronOptionSelect
        value={mode}
        options={modeOptions}
        testId="cron-edit-schedule-mode"
        onChange={updateMode}
      />

      {mode === "interval" && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
          <input
            type="number"
            min={1}
            value={interval.value}
            onChange={(event) => updateInterval(event.target.value)}
            className="glass-input"
            aria-label="Every"
            data-testid="cron-edit-interval-value"
          />
          <CronOptionSelect
            value={interval.unit}
            options={intervalUnitOptions}
            testId="cron-edit-interval-unit"
            onChange={(unit) => updateInterval(interval.value, unit)}
          />
        </div>
      )}

      {mode === "daily" && (
        <input
          type="time"
          value={time}
          onChange={(event) => updateDailyTime(event.target.value)}
          className="glass-input"
          aria-label="Daily time"
          data-testid="cron-edit-daily-time"
        />
      )}

      {mode === "weekly" && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
          <CronOptionSelect
            value={dayOfWeek}
            options={weekdayOptions}
            testId="cron-edit-weekday"
            onChange={(day) => updateWeekly({ day })}
          />
          <input
            type="time"
            value={time}
            onChange={(event) => updateWeekly({ time: event.target.value })}
            className="glass-input"
            aria-label="Weekly time"
            data-testid="cron-edit-weekly-time"
          />
        </div>
      )}

      {mode === "monthly" && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
          <input
            type="number"
            min={1}
            max={31}
            value={dayOfMonth}
            onChange={(event) => updateMonthly({ day: event.target.value })}
            className="glass-input"
            aria-label="Day of month"
            data-testid="cron-edit-month-day"
          />
          <input
            type="time"
            value={time}
            onChange={(event) => updateMonthly({ time: event.target.value })}
            className="glass-input"
            aria-label="Monthly time"
            data-testid="cron-edit-month-time"
          />
        </div>
      )}

      {mode === "once" && (
        <input
          type="datetime-local"
          value={toDateTimeLocal(schedule)}
          onChange={(event) => onChange({ scheduleType: "at", schedule: event.target.value })}
          className="glass-input"
          aria-label="One time"
          data-testid="cron-edit-once-time"
        />
      )}

      {mode === "advanced" && (
        <input
          value={schedule}
          onChange={(event) => onChange({ scheduleType: "cron", schedule: event.target.value })}
          placeholder="0 9 * * *"
          className="glass-input font-mono"
          aria-label="Advanced cron expression"
          data-testid="cron-edit-schedule"
        />
      )}

      <p
        className={cn(
          "rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2",
          "text-[11px] text-muted-foreground",
        )}
        title={schedule}
      >
        {label}
      </p>
    </div>
  )
}
