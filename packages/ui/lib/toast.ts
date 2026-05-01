import { toast } from "react-toastify"
import { invoke } from "@/lib/ipc"

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
