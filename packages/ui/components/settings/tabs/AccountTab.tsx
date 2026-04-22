"use client"

import { Icons } from "@/components/icons"

export type AccountData = {
  botName: string
  provider: string
  model: string
}

const DEFAULT_ACCOUNT: AccountData = {
  botName: "Not configured",
  provider: "No provider selected",
  model: "No model selected",
}

type AccountTabProps = {
  data?: AccountData
}

export function AccountTab({ data = DEFAULT_ACCOUNT }: AccountTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your current assistant configuration.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
        <FieldRow icon={Icons.User} label="Bot Name" value={data.botName} />
        <FieldRow icon={Icons.Globe} label="Provider" value={data.provider} border />
        <FieldRow icon={Icons.Settings} label="Model" value={data.model} border />
      </div>
    </div>
  )
}

function FieldRow({
  icon: Icon,
  label,
  value,
  border,
}: {
  icon: React.ElementType
  label: string
  value: string
  border?: boolean
}) {
  return (
    <div className={`flex items-center gap-4 px-5 py-3.5 ${border ? "border-t border-border/30" : ""}`}>
      <span className="flex size-8 shrink-0 items-center justify-center  text-muted-foreground">
        <Icon size={16} strokeWidth={1.5} />
      </span>
      <span className="w-[90px] shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <span className="flex-1 text-[13px] font-medium text-foreground">{value}</span>
    </div>
  )
}
