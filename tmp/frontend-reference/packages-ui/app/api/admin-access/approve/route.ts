import { NextResponse } from "next/server"

import { connectToGatewayWithAdmin, successMessage, type AdminAccessActionId } from "@/lib/openclaw-admin-access"

export const runtime = "nodejs"

type ActionId = AdminAccessActionId

export async function POST(request: Request) {
  const body = (await request.json()) as { actionId?: ActionId }
  const actionId = body.actionId ?? "sessions.patch"
  const connect = await connectToGatewayWithAdmin()

  if (!connect.ok) {
    return NextResponse.json({
      status: "needs_admin",
      approved: false,
      retry: {
        gatewayMethod: actionId,
        openClawFlow: ["connect", actionId],
      },
      message: connect.error.message,
      error: connect.error,
    })
  }

  return NextResponse.json({
    status: "approved",
    approved: true,
    retry: {
      gatewayMethod: actionId,
      openClawFlow: ["connect", actionId],
    },
    message: successMessage(actionId),
  })
}
