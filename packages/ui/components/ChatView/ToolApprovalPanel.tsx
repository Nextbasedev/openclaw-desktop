"use client"

import { LuShieldCheck } from "react-icons/lu"
import { cn } from "@/lib/utils"
import type { InlineToolCall } from "./types"

export type ApprovalDecision = "allow-once" | "allow-always" | "deny"

function decisionLabel(decision: ApprovalDecision) {
  if (decision === "allow-once") return "Approve once"
  if (decision === "allow-always") return "Always allow"
  return "Decline"
}

export function ToolApprovalPanel({
  approval,
  resolving,
  resolved,
  onResolve,
}: {
  approval: NonNullable<InlineToolCall["approval"]>
  resolving: ApprovalDecision | null
  resolved: ApprovalDecision | null
  onResolve: (decision: ApprovalDecision) => void
}) {
  return (
    <div className="px-2.5 pt-0.5 pb-2">
      <div className="rounded-lg border border-amber-400/10 bg-background/45 p-2">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-amber-200/90">
          <LuShieldCheck className="size-3.5" />
          Command approval required
        </div>
        {approval.command && (
          <pre className="mb-2 max-h-24 overflow-auto rounded-md bg-black/30 px-2 py-1.5 text-[11px] leading-relaxed text-foreground/75">
            {approval.command}
          </pre>
        )}
        {resolved ? (
          <div className="text-[11px] text-muted-foreground">
            {resolved === "deny" ? "Declined" : "Approved"}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {approval.allowedDecisions.map((decision) => (
              <button
                key={decision}
                type="button"
                disabled={Boolean(resolving)}
                onClick={(e) => {
                  e.stopPropagation()
                  onResolve(decision)
                }}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-wait disabled:opacity-60",
                  decision === "deny"
                    ? "bg-red-400/10 text-red-300 hover:bg-red-400/15"
                    : "bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15"
                )}
              >
                {resolving === decision ? "Working..." : decisionLabel(decision)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
