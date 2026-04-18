"use client"

type AccountData = {
  name: string
  email: string
  model?: string
}

const DEFAULT_ACCOUNT: AccountData = {
  name: "Not configured",
  email: "No provider selected",
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

      <div className="flex flex-col gap-4">
        <FormRow label="Bot Name" value={data.name} />
        <FormRow label="Provider" value={data.email} />
        {data.model && <FormRow label="Model" value={data.model} />}
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
