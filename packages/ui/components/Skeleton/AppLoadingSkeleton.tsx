export function AppLoadingSkeleton() {
  return (
    <div className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-background">
      {/* Header skeleton */}
      <div className="flex h-12 items-center border-b border-border/40 px-4">
        <div className="h-4 w-20 animate-pulse rounded bg-muted/25" />
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <div className="size-5 animate-pulse rounded bg-muted/20" />
          <div className="size-5 animate-pulse rounded bg-muted/20" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar skeleton */}
        <div className="flex w-[220px] shrink-0 flex-col border-r border-border/40 px-3 py-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
              <div className="size-4 animate-pulse rounded bg-muted/30" />
              <div className="h-3.5 w-12 animate-pulse rounded bg-muted/30" />
            </div>
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
              <div className="size-4 animate-pulse rounded bg-muted/20" />
              <div className="h-3.5 w-10 animate-pulse rounded bg-muted/20" />
            </div>
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
              <div className="size-4 animate-pulse rounded bg-muted/20" />
              <div className="h-3.5 w-16 animate-pulse rounded bg-muted/20" />
            </div>
          </div>
          <div className="mt-8 px-2">
            <div className="mb-3 h-3 w-16 animate-pulse rounded bg-muted/20" />
            <div className="flex items-center gap-2.5 py-2">
              <div className="size-4 animate-pulse rounded bg-muted/20" />
              <div className="h-3.5 w-14 animate-pulse rounded bg-muted/20" />
            </div>
          </div>
        </div>

        {/* Main content skeleton */}
        <div className="flex flex-1 flex-col items-center justify-center gap-8">
          <div className="h-9 w-80 animate-pulse rounded-lg bg-muted/20" />
          <div className="w-full max-w-2xl px-8">
            <div className="h-28 w-full animate-pulse rounded-2xl border border-border/30 bg-muted/10" />
          </div>
        </div>
      </div>
    </div>
  )
}