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

    if (
      message.event === "cron.run" ||
      message.event === "cron.run.started" ||
      message.event === "cron.run.completed" ||
      message.event === "cron.run.failed"
    ) {
      const cronEvent: CronRunEvent = {
        type: message.event.startsWith("cron.run.")
          ? (message.event as CronRunEvent["type"])
          : "cron.run.started",
        jobId: String(payload.jobId ?? ""),
        runId: payload.runId ? String(payload.runId) : undefined,
        name: payload.name ? String(payload.name) : undefined,
        status: String(payload.status ?? "running"),
        timestamp: new Date().toISOString(),
        result: payload.result ?? null,
        error: payload.error ? String(payload.error) : null,
      }
      cronEvents.emit("cron:event", cronEvent)
    }

    if (message.event === "session.message") {
      const sessionKey = String(payload.sessionKey ?? "")
      if (sessionKey.startsWith("cron:")) {
        const cronEvent: CronRunEvent = {
          type: "cron.run.completed",
          jobId: sessionKey.replace("cron:", ""),
          status: "completed",
          timestamp: new Date().toISOString(),
          result: payload.message ?? null,
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
