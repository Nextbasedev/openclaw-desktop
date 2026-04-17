"use client"

import { Separator } from "@/components/ui/separator"

type AccountData = {
  name: string
  email: string
  authProvider: string | null
  plan: string
  credits: number
  resources: { ram: string; cpu: string; disk: string }
}

const DEFAULT_ACCOUNT: AccountData = {
  name: "John Doe",
  email: "john@openclaw.ai",
  authProvider: "Google",
  plan: "Starter Plan",
  credits: 395961,
  resources: { ram: "4 GB", cpu: "4 vCPU", disk: "40 GB" },
}

type AccountTabProps = {
  data?: AccountData
}

export function AccountTab({ data = DEFAULT_ACCOUNT }: AccountTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Account</h2>
      </div>

      <div className="flex flex-col gap-4">
        <FormRow label="Name" value={data.name} />
        <FormRow label="Email" value={data.email} />
        {data.authProvider && (
          <p className="text-xs text-muted-foreground -mt-2 pl-[120px]">
            Signed in with {data.authProvider}.
          </p>
        )}
      </div>

      <Separator className="bg-border/50" />

      <div>
        <h3 className="text-base font-semibold text-foreground">
          Plan &amp; Billing
        </h3>
        <div className="mt-3 flex items-center justify-between rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">
              {data.plan}
            </span>
            <span className="rounded-full bg-chart-1/20 px-2.5 py-0.5 text-xs font-medium text-chart-1">
              $20/mo
            </span>
          </div>
          <button
            type="button"
            className="rounded-lg border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-border"
          >
            Manage Plan
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between px-1">
          <span className="text-sm text-muted-foreground">Credits Balance</span>
          <span className="text-sm font-semibold text-chart-1">
            {data.credits.toLocaleString()} credits
          </span>
        </div>

        <div className="mt-3 flex items-center gap-6 px-1">
          <ResourceBadge label="RAM" value={data.resources.ram} />
          <ResourceBadge label="CPU" value={data.resources.cpu} />
          <ResourceBadge label="Disk" value={data.resources.disk} />
        </div>
      </div>
    </div>
  )
}

function FormRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-center gap-4">
      <label className="text-sm text-muted-foreground">{label}</label>
      <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm text-foreground">
        {value}
      </div>
    </div>
  )
}

function ResourceBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}
