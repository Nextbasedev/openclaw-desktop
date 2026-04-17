import { NextResponse } from "next/server"

import { actionLabel, connectToGatewayWithAdmin, type AdminAccessActionId } from "@/lib/openclaw-admin-access"

export const runtime = "nodejs"

type ActionId = AdminAccessActionId

export async function POST(request: Request) {
  const body = (await request.json()) as { actionId?: ActionId }
  const actionId = body.actionId ?? "sessions.patch"
  const label = actionLabel(actionId)
  const probe = await connectToGatewayWithAdmin()

  return NextResponse.json({
    status: "needs_admin",
    title: probe.ok ? "Admin access ready" : "Admin access needed",
    message: probe.ok
      ? `Jarvis can request admin access for ${label}. Continue when you are ready.`
      : `To ${label}, this device needs extra permission for a sensitive action. Approve once, then Jarvis can continue automatically.`,
    primaryActionLabel: probe.ok ? "Continue" : "Approve admin access",
    secondaryActionLabel: "Not now",
    requestPath: "/api/admin-access/approve",
    showApproverPickerByDefault: false,
    recommendedApprovers: [
      { id: "owner", name: "Workspace owner", role: "Best default for fast approval" },
      { id: "admin", name: "Admin operator", role: "Use only when someone else needs to approve" },
    ],
    retry: {
      gatewayMethod: actionId,
      label,
    },
  })
}
