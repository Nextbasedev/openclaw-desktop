import { Button } from "@/components/ui/button"
import { Icons } from "@/components/icons"

type Props = {
  onEnterApp: () => void
}

export function CompleteStep({ onEnterApp }: Props) {
  return (
    <div className="flex flex-col items-center space-y-6 py-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10">
        <Icons.Check size={28} strokeWidth={2} className="text-emerald-500" />
      </div>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">You&apos;re all set</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your assistant is configured and ready to go.
        </p>
      </div>

      <Button size="sm" onClick={onEnterApp}>
        Enter App
      </Button>
    </div>
  )
}
