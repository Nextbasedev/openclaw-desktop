"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"

type SensitiveAction = {
  id: "sessions.patch" | "sessions.reset" | "sessions.delete"
  title: string
  description: string
  needsAdmin: boolean
}

type RequestState = "idle" | "requesting" | "ready" | "approving" | "approved"

type RequestPayload = {
  status: "needs_admin"
  title: string
  message: string
  primaryActionLabel: string
  secondaryActionLabel: string
  requestPath: string
  showApproverPickerByDefault: boolean
  recommendedApprovers: Array<{ id: string; name: string; role: string }>
  retry: {
    gatewayMethod: SensitiveAction["id"]
    label: string
  }
}

type ApprovePayload =
  | {
      status: "approved"
      approved: true
      message: string
    }
  | {
      status: "needs_admin"
      approved: false
      message: string
    }

const actions: SensitiveAction[] = [
  {
    id: "sessions.patch",
    title: "Edit session details",
    description: "Rename or update an existing session.",
    needsAdmin: true,
  },
  {
    id: "sessions.reset",
    title: "Reset a session",
    description: "Clear the session and start fresh.",
    needsAdmin: true,
  },
  {
    id: "sessions.delete",
    title: "Delete a session",
    description: "Remove the session when it is no longer needed.",
    needsAdmin: true,
  },
]

export function AdminAccessDemo() {
  const [selectedAction, setSelectedAction] = useState<SensitiveAction | null>(null)
  const [requestState, setRequestState] = useState<RequestState>("idle")
  const [requestPayload, setRequestPayload] = useState<RequestPayload | null>(null)
  const [showApprovers, setShowApprovers] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [resultKind, setResultKind] = useState<"success" | "warning">("success")

  const activityText = useMemo(() => {
    if (requestState === "requesting") return "Preparing a simple approval request"
    if (requestState === "approving") return "Calling the approval API and retrying the action"
    if (requestState === "approved") return "Admin access approved, original action can continue"
    if (requestState === "ready") return "Waiting for the user to approve admin access"
    return "Choose a sensitive action to preview the flow"
  }, [requestState])

  async function requestAdminAccess(action: SensitiveAction) {
    setSelectedAction(action)
    setRequestState("requesting")
    setResultMessage(null)
    setResultKind("success")

    const response = await fetch("/api/admin-access/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: action.id, actionLabel: action.title }),
    })

    const payload = (await response.json()) as RequestPayload
    setRequestPayload(payload)
    setShowApprovers(payload.showApproverPickerByDefault)
    setRequestState("ready")
  }

  async function approveAccess() {
    if (!selectedAction) return

    setRequestState("approving")
    const response = await fetch("/api/admin-access/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: selectedAction.id }),
    })

    const payload = (await response.json()) as ApprovePayload

    if (payload.status === "approved") {
      setRequestState("approved")
      setResultKind("success")
      setResultMessage(payload.message)
      return
    }

    setRequestState("ready")
    setResultKind("warning")
    setResultMessage(payload.message)
  }

  return (
    <section className="rounded-3xl border bg-background p-8 shadow-sm">
      <div className="flex flex-col gap-6">
        <section className="rounded-3xl border bg-background p-8 shadow-sm">
          <div className="flex flex-col gap-3">
            <span className="w-fit rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              Jarvis admin access flow
            </span>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-tight">
              Ask for admin access only when the action actually needs it.
            </h1>
            <p className="max-w-3xl text-base leading-7 text-muted-foreground">
              Yes, you are right. We should not show every user or every approver up front. Most of the time the user just wants to continue, so the default flow stays small and simple.
            </p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border bg-background p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Sensitive actions</h2>
                <p className="text-muted-foreground">
                  Clicking any of these actions asks for admin access first.
                </p>
              </div>
              <div className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                Less technical, fewer choices
              </div>
            </div>

            <div className="space-y-3">
              {actions.map((action) => (
                <div
                  key={action.id}
                  className="flex flex-col gap-4 rounded-2xl border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{action.title}</h3>
                      {action.needsAdmin ? (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                          Admin required
                        </span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground">{action.description}</p>
                  </div>
                  <Button
                    data-testid={`request-${action.id}`}
                    onClick={() => void requestAdminAccess(action)}
                  >
                    Admin access
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border bg-background p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Flow preview</h2>
            <p className="mt-1 text-muted-foreground">{activityText}</p>

            <div className="mt-5 space-y-4 rounded-2xl border bg-muted/40 p-4">
              <div className="rounded-2xl border bg-background p-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  What the user sees
                </p>
                <h3 className="mt-3 text-base font-semibold">
                  {requestPayload?.title ?? "Admin access needed"}
                </h3>
                <p className="mt-2 leading-6 text-muted-foreground">
                  {requestPayload?.message ??
                    "To continue, this device needs extra permission for sensitive actions."}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    data-testid="approve-admin-access"
                    onClick={() => void approveAccess()}
                    disabled={requestState !== "ready"}
                  >
                    {requestPayload?.primaryActionLabel ?? "Approve admin access"}
                  </Button>
                  <Button variant="outline" disabled={requestState === "approving"}>
                    {requestPayload?.secondaryActionLabel ?? "Not now"}
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border bg-background p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">Need someone else to approve?</p>
                    <p className="mt-1 text-muted-foreground">
                      Keep the approver list hidden until the user actually asks for it.
                    </p>
                  </div>
                  <Button
                    data-testid="toggle-approvers"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowApprovers((current) => !current)}
                  >
                    {showApprovers ? "Hide people" : "Show people"}
                  </Button>
                </div>

                {showApprovers ? (
                  <div className="mt-4 space-y-3">
                    {requestPayload?.recommendedApprovers.map((person) => (
                      <div
                        key={person.id}
                        className="flex items-center justify-between rounded-xl border px-3 py-2"
                      >
                        <div>
                          <p className="font-medium">{person.name}</p>
                          <p className="text-xs text-muted-foreground">{person.role}</p>
                        </div>
                        <span className="text-xs text-muted-foreground">Can approve</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border bg-background p-4">
                <p className="font-medium">What happens on click</p>
                <ol className="mt-3 space-y-2 text-muted-foreground">
                  <li>1. Call the Jarvis API to request admin access.</li>
                  <li>2. Show a simple approval prompt, not a technical error.</li>
                  <li>3. After approval, retry the original OpenClaw action.</li>
                </ol>
                <div className="mt-4 rounded-xl bg-muted p-3 font-mono text-xs leading-6 text-muted-foreground">
                  POST /api/admin-access/request
                  <br />
                  POST /api/admin-access/approve
                  <br />
                  Retry {selectedAction?.id ?? "sessions.patch"}
                </div>
                {resultMessage ? (
                  <div
                    className={resultKind === "success"
                      ? "mt-4 rounded-xl bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-300"
                      : "mt-4 rounded-xl bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300"}
                  >
                    {resultMessage}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
