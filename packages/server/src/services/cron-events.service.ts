import { EventEmitter } from "node:events"
import { ensureGatewayClient } from "../gateway/client.js"
import { gatewayEvents } from "../gateway/client.js"

export const cronEvents = new EventEmitter()
cronEvents.setMaxListeners(50)

let unsubscribe: (() => void) | null = null

export type CronRunEvent = {
  type: "cron.run.started" | "cron.run.completed" | "cron.run.failed"
  jobId: string
  runId?: string
  name?: string
  status: string
  timestamp: string
  result?: unknown
  error?: string | null
}

const finishedJobs = new Set<string>()

function mapCronAction(payload: Record<string, unknown>): CronRunEvent | null {
  const action = String(payload.action ?? "")
  const jobId = String(payload.jobId ?? "")
  if (!jobId) return null

  if (action === "started") {
    return {
      type: "cron.run.started",
      jobId,
      runId: payload.runId ? String(payload.runId) : payload.sessionId ? String(payload.sessionId) : undefined,
      name: payload.name ? String(payload.name) : undefined,
      status: "running",
      timestamp: new Date().toISOString(),
    }
  }

  if (action === "finished") {
    finishedJobs.add(jobId)
    setTimeout(() => finishedJobs.delete(jobId), 30_000)
    const status = String(payload.status ?? "completed")
    const failed = status === "error" || !!payload.error
    return {
      type: failed ? "cron.run.failed" : "cron.run.completed",
      jobId,
      name: payload.name ? String(payload.name) : undefined,
      runId: payload.runId ? String(payload.runId) : payload.sessionId ? String(payload.sessionId) : undefined,
      status: failed ? "failed" : "completed",
      timestamp: new Date().toISOString(),
      result: payload.result ?? null,
      error: payload.error ? String(payload.error) : null,
    }
  }

  return null
}

async function subscribe(): Promise<void> {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }

  let gw: Awaited<ReturnType<typeof ensureGatewayClient>>
  try {
    gw = await ensureGatewayClient()
  } catch {
    return
  }

  unsubscribe = gw.addMessageListener((message) => {
    if (message.type !== "event") return

    const payload = message.payload as Record<string, unknown> | undefined
    if (!payload) return

    if (message.event === "cron") {
      const cronEvent = mapCronAction(payload)
      if (cronEvent) cronEvents.emit("cron:event", cronEvent)
    }

    if (message.event === "chat") {
      const sessionKey = String(payload.sessionKey ?? "")
      const state = String(payload.state ?? "")
      if (sessionKey.includes(":cron:") && state === "final") {
        const parts = sessionKey.split(":cron:")[1]?.split(":run:") ?? []
        const jobId = parts[0] ?? ""
        if (!jobId || finishedJobs.has(jobId)) return
        finishedJobs.add(jobId)
        setTimeout(() => finishedJobs.delete(jobId), 30_000)
        const cronEvent: CronRunEvent = {
          type: "cron.run.completed",
          jobId,
          runId: parts[1] ?? (payload.runId ? String(payload.runId) : undefined),
          status: "completed",
          timestamp: new Date().toISOString(),
          result: (payload.message as Record<string, unknown> | undefined)?.content ?? null,
        }
        cronEvents.emit("cron:event", cronEvent)
      }
    }
  })
}

export async function startCronEventListener(): Promise<void> {
  await subscribe()
  gatewayEvents.on("connected", () => {
    subscribe().catch(() => {})
  })
}

export function stopCronEventListener(): void {
  gatewayEvents.removeAllListeners("connected")
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
}
