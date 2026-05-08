import { connectGateway, withGatewayReadRetry } from "./gateway.js"

type RecoveryEmitter = (event: string, data: unknown) => void

const TWO_MINUTES = 120_000
const FIVE_MINUTES = 300_000

let eventDownSince: number | null = null
let rpcDownSince: number | null = null
let emitter: RecoveryEmitter | null = null
let openSessionProvider: (() => string[]) | null = null

export function configureGatewayRecovery(params: {
  emit?: RecoveryEmitter
  getOpenSessionKeys?: () => string[]
} = {}) {
  if (params.emit) emitter = params.emit
  if (params.getOpenSessionKeys) openSessionProvider = params.getOpenSessionKeys
}

export function markGatewayDisconnected(kind: "event" | "rpc", nowMs = Date.now()) {
  if (kind === "event") eventDownSince ??= nowMs
  else rpcDownSince ??= nowMs
}

export async function markGatewayReconnected(kind: "event" | "rpc", nowMs = Date.now()) {
  if (kind === "event") {
    eventDownSince = null
    await refreshAfterEventReconnect()
  } else {
    rpcDownSince = null
  }
}

export function maybeEmitRecoveryStatus(nowMs = Date.now()) {
  if (eventDownSince !== null) {
    const downFor = nowMs - eventDownSince
    if (downFor >= FIVE_MINUTES) emitter?.("chat.status", { type: "chat.status", state: "reconnect_action", label: "Live updates are still reconnecting." })
    else if (downFor >= TWO_MINUTES) emitter?.("chat.status", { type: "chat.status", state: "reconnecting", label: "Live updates delayed. Trying to reconnect…" })
  }
  if (rpcDownSince !== null) {
    const downFor = nowMs - rpcDownSince
    if (downFor >= FIVE_MINUTES) emitter?.("chat.status", { type: "chat.status", state: "connection_action", label: "Connection interrupted. Retry may be needed." })
    else if (downFor >= TWO_MINUTES) emitter?.("chat.status", { type: "chat.status", state: "reconnecting", label: "Connection interrupted. Retrying…" })
  }
}

export async function refreshAfterEventReconnect() {
  const sessionKeys = openSessionProvider?.() ?? []
  await withGatewayReadRetry(async () => {
    const gw = await connectGateway(["operator.read"], { purpose: "rpc" })
    try {
      await gw.request("sessions.list", {}, 30_000).catch(() => null)
      for (const sessionKey of sessionKeys) {
        await gw.request("chat.history", { sessionKey, limit: 1000 }, 30_000).catch(() => null)
      }
    } finally {
      gw.close()
    }
  })
}

export function resetGatewayRecoveryForTests() {
  eventDownSince = null
  rpcDownSince = null
  emitter = null
  openSessionProvider = null
}
