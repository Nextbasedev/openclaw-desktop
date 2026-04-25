type ScheduleInput = {
  schedule: string
  scheduleType: "at" | "every" | "cron"
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`
}

function every(value: number, unit: string): string {
  return value === 1 ? `Every ${unit}` : `Every ${plural(value, unit)}`
}

function formatClock(hourText: string, minuteText: string): string | null {
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  const suffix = hour >= 12 ? "PM" : "AM"
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`
}

function formatIntervalSchedule(schedule: string): string | null {
  const match = schedule.trim().match(/^(\d+)\s*(ms|s|m|h|d)$/i)
  if (!match) return null
  const value = Number(match[1])
  const unit = match[2].toLowerCase()
  const label = unit === "ms"
    ? "millisecond"
    : unit === "s"
      ? "second"
      : unit === "m"
        ? "minute"
        : unit === "h"
          ? "hour"
          : "day"
  return every(value, label)
}

function formatWeekday(day: string): string | null {
  if (day === "1-5") return "Weekdays"
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const index = day === "7" ? 0 : Number(day)
  if (!Number.isInteger(index) || index < 0 || index > 6) return null
  return `${names[index]}s`
}

function formatMonth(month: string): string | null {
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ]
  const index = Number(month) - 1
  if (!Number.isInteger(index) || index < 0 || index > 11) return null
  return names[index]
}

function formatCronSchedule(schedule: string): string | null {
  const [minute, hour, dayOfMonth, month, dayOfWeek, ...rest] =
    schedule.trim().split(/\s+/)
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek || rest.length) {
    return null
  }

  const minuteEvery = minute.match(/^\*\/(\d+)$/)
  if (
    minuteEvery &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return every(Number(minuteEvery[1]), "minute")
  }

  const hourEvery = hour.match(/^\*\/(\d+)$/)
  if (
    hourEvery &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    const minuteLabel = minute === "0" ? "" : ` at :${minute.padStart(2, "0")}`
    return `${every(Number(hourEvery[1]), "hour")}${minuteLabel}`
  }

  const time = formatClock(hour, minute)
  if (!time) return null

  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Daily at ${time}`
  }

  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const weekday = formatWeekday(dayOfWeek)
    return weekday ? `${weekday} at ${time}` : null
  }

  if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
    return `Monthly on day ${dayOfMonth} at ${time}`
  }

  if (dayOfMonth !== "*" && month !== "*" && dayOfWeek === "*") {
    const monthLabel = formatMonth(month)
    return monthLabel ? `Every ${monthLabel} ${dayOfMonth} at ${time}` : null
  }

  return null
}

export function formatScheduleLabel(job: ScheduleInput): string {
  if (job.scheduleType === "every") {
    return formatIntervalSchedule(job.schedule) ?? job.schedule
  }
  if (job.scheduleType === "at") {
    const date = new Date(job.schedule)
    return Number.isNaN(date.getTime())
      ? job.schedule
      : `Once on ${date.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}`
  }
  return formatCronSchedule(job.schedule) ?? job.schedule
}
