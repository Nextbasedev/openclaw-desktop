"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@/components/ui/badge"

type ConnectionStatus = {
  gatewayConfigured: boolean
  gatewayUrl?: string | null
  gatewayToken?: string | null
  hasIdentity: boolean
  status: string
}

type HugeiconData = Parameters<typeof HugeiconsIcon>[0]["icon"]

export function StatusBadge({
  status,
  loadingStatus,
}: {
  status: ConnectionStatus | null
  loadingStatus: boolean
}) {
  if (loadingStatus || !status) return null
  if (status.gatewayConfigured && status.hasIdentity) {
    return <Badge variant="default">Ready</Badge>
  }
  if (status.gatewayConfigured) {
    return <Badge variant="outline">Configured - No Identity</Badge>
  }
  return <Badge variant="secondary">Not configured</Badge>
}

export function StepState({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 border-r border-border px-2 py-2 last:border-r-0">
      <span
        className={
          active
            ? "size-1.5 rounded-full bg-foreground"
            : "size-1.5 rounded-full bg-muted-foreground/35"
        }
      />
      <span className={active ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  )
}

export function StatusTile({
  icon,
  label,
  value,
  breakValue,
}: {
  icon: HugeiconData
  label: string
  value: string
  breakValue?: boolean
}) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <HugeiconsIcon icon={icon} size={16} />
        <span>{label}</span>
      </div>
      <p className={breakValue ? "mt-2 break-all text-foreground" : "mt-2"}>
        {value}
      </p>
    </div>
  )
}
