import { toast } from "react-toastify"
import { invoke } from "@/lib/ipc"
import { frontendLog } from "@/lib/clientLogs"
import { getMiddlewareConnection } from "@/lib/middleware-client"

export function showGatewayError(message?: string) {
  toast.error(message ?? "Gateway not connected. Check connection settings.", {
    toastId: "gateway-disconnected",
    autoClose: 5000,
  })
}

export function isGatewayError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  return (
    lower.includes("gateway") ||
    lower.includes("not configured") ||
    lower.includes("token is missing") ||
    lower.includes("not paired") ||
    lower.includes("econnrefused") ||
    lower.includes("onboarding")
  )
}

export async function checkGatewayOrRedirect(): Promise<boolean> {
  const savedConnection = getMiddlewareConnection()

  // Send/new-chat is the hottest path in the app. Do not block it on a
  // synchronous health/connect probe: under heavy tab switching that probe can
  // time out even though the saved remote middleware is valid, which used to
  // route the user away to /connect before /api/chat/send ever fired.
  if (savedConnection) {
    frontendLog("connection", "gateway-check.skip-for-send", {
      url: savedConnection.url,
      hasToken: Boolean(savedConnection.token),
    }, "debug")
    return true
  }

  try {
    const s = await invoke<{
      gatewayConfigured: boolean
      hasConnection: boolean
    }>("middleware_connect_status", { input: {} })
    if (!s.gatewayConfigured || !s.hasConnection) {
      showGatewayError("Connect to OpenClaw gateway first.")
      window.history.pushState(null, "", "/connect")
      window.dispatchEvent(new PopStateEvent("popstate"))
      return false
    }
    return true
  } catch {
    showGatewayError()
    window.history.pushState(null, "", "/connect")
    window.dispatchEvent(new PopStateEvent("popstate"))
    return false
  }
}
