function Bone({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-foreground/[0.04] ${className ?? ""}`}
    />
  )
}

export function AppLoadingSkeleton() {
  return (
    <div className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/50 bg-card px-3">
        <Bone className="h-3 w-16" />
        <div className="flex items-center gap-1">
          <Bone className="size-6 rounded-md" />
          <Bone className="size-6 rounded-md" />
          <Bone className="size-6 rounded-md" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-[220px] shrink-0 flex-col border-r border-border/50 px-2 py-3">
          <div className="flex flex-col gap-0.5">
            <Bone className="h-8 w-full rounded-md" />
            <Bone className="h-8 w-full rounded-md" />
            <Bone className="h-8 w-full rounded-md" />
          </div>

          <div className="mt-3 border-t border-border/10 pt-3">
            <Bone className="mb-2 ml-2 h-2 w-8" />
            <div className="flex flex-col gap-0.5">
              <Bone className="h-8 w-full rounded-md" />
              <Bone className="h-8 w-full rounded-md" />
              <Bone className="h-8 w-full rounded-md" />
            </div>
          </div>

          <div className="mt-3 border-t border-border/10 pt-3">
            <Bone className="mb-2 ml-2 h-2 w-12" />
            <div className="flex flex-col gap-0.5">
              <Bone className="h-8 w-full rounded-md" />
              <Bone className="h-8 w-full rounded-md" />
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-8">
          <Bone className="h-8 w-56 rounded-lg" />
          <div className="w-full max-w-3xl px-4">
            <div className="rounded-[24px] border border-white/8 bg-white/[0.02] px-4 pb-4 pt-5 shadow-[0_24px_64px_-36px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl">
              <Bone className="mb-10 h-3.5 w-52" />
              <div className="flex items-center justify-between">
                <Bone className="size-8 rounded-full" />
                <Bone className="size-8 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex h-[26px] shrink-0 items-center justify-between border-t border-border/50 bg-card px-3">
        <Bone className="h-2.5 w-20" />
        <Bone className="h-2.5 w-24" />
      </div>
    </div>
  )
}
