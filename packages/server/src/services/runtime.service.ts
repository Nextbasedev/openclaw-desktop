import { getDb } from "../db/connection.js"
import { getAppSetting, setAppSetting } from "../db/helpers.js"

const CONTRACT_VERSION = "2026-04-17"
const BOT_NAME_KEY = "openclaw.bot_name"

export function runtimeInfo() {
  return {
    contractVersion: CONTRACT_VERSION,
    transport: "http+gateway-ws+sqlite+filesystem",
  }
}

export function botNameGet() {
  const db = getDb()
  return { botName: getAppSetting(db, BOT_NAME_KEY) }
}

export function botNameSet(input: { botName: string }) {
  const name = input.botName.trim()
  if (!name) throw new Error("Bot name cannot be empty")
  const db = getDb()
  setAppSetting(db, BOT_NAME_KEY, name)
  return { botName: name }
}

export function botName() {
  return botNameGet()
}

export function requestAdminAccess(input: { actionId: string; actionLabel?: string }) {
  const label = input.actionLabel ?? input.actionId
  return {
    status: "needs_admin",
    title: "Admin access needed",
    message: `To ${label}, this device needs extra permission for a sensitive action. Approve once, then Jarvis can continue automatically.`,
    primaryActionLabel: "Approve admin access",
    secondaryActionLabel: "Not now",
    requestPath: "/api/admin-access/approve",
    showApproverPickerByDefault: false,
    recommendedApprovers: [
      { id: "owner", name: "Workspace owner", role: "Best default for fast approval" },
      { id: "admin", name: "Admin operator", role: "Use only when someone else needs to approve" },
    ],
    retry: {
      gatewayMethod: input.actionId,
      label,
      openClawFlow: null,
    },
  }
}

export function approveAdminAccess(input: { actionId: string }) {
  return {
    status: "approved",
    approved: true,
    retry: {
      gatewayMethod: input.actionId,
      label: null,
      openClawFlow: ["connect", input.actionId],
    },
    message: `Admin access approved for ${input.actionId}`,
  }
}
