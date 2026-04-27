import { toast } from "react-toastify"
import { invoke } from "@/lib/ipc"

export function showGatewayError(message?: string) {
  toast.error(message ?? "Gateway not connected. Please connect first.", {
    toastId: "gateway-disconnected",
  })
}

export function isGatewayError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  return (
    lower.includes("gateway not connected") ||
    lower.includes("not configured") ||
    lower.includes("token is missing") ||
    lower.includes("econnrefused")
  )
}

export async function checkGatewayOrRedirect(): Promise<boolean> {
  try {
    const s = await invoke<{
      gatewayConfigured: boolean
      hasIdentity: boolean
    }>("middleware_connect_status", { input: {} })
    if (!s.gatewayConfigured || !s.hasIdentity) {
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
