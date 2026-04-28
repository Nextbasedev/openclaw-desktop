export function ChatLoadingSkeleton() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="flex flex-col gap-5">
            {/* User bubble */}
            <div className="flex w-full justify-end">
              <div className="flex items-center rounded-2xl rounded-tr-sm bg-foreground/[0.06] px-4 py-2.5">
                <div className="h-4 w-40 animate-pulse rounded bg-foreground/10" />
              </div>
            </div>

            {/* Assistant lines */}
            <div className="flex w-full justify-start">
              <div className="flex w-full max-w-[85%] flex-col gap-2.5 py-1">
                <div className="h-3.5 w-[85%] animate-pulse rounded-sm bg-foreground/10" />
                <div className="h-3.5 w-full animate-pulse rounded-sm bg-foreground/[0.08]" />
                <div className="h-3.5 w-[60%] animate-pulse rounded-sm bg-foreground/[0.06]" />
              </div>
            </div>

            {/* User bubble */}
            <div className="flex w-full justify-end">
              <div className="flex items-center rounded-2xl rounded-tr-sm bg-foreground/[0.06] px-4 py-2.5">
                <div className="h-4 w-28 animate-pulse rounded bg-foreground/10" />
              </div>
            </div>

            {/* Assistant lines */}
            <div className="flex w-full justify-start">
              <div className="flex w-full max-w-[85%] flex-col gap-2.5 py-1">
                <div className="h-3.5 w-full animate-pulse rounded-sm bg-foreground/10" />
                <div className="h-3.5 w-[70%] animate-pulse rounded-sm bg-foreground/[0.08]" />
                <div className="h-3.5 w-[45%] animate-pulse rounded-sm bg-foreground/[0.06]" />
                <div className="h-3.5 w-[80%] animate-pulse rounded-sm bg-foreground/[0.06]" />
              </div>
            </div>

            {/* User bubble */}
            <div className="flex w-full justify-end">
              <div className="flex items-center rounded-2xl rounded-tr-sm bg-foreground/[0.06] px-4 py-2.5">
                <div className="h-4 w-36 animate-pulse rounded bg-foreground/10" />
              </div>
            </div>

            {/* Assistant lines */}
            <div className="flex w-full justify-start">
              <div className="flex w-full max-w-[85%] flex-col gap-2.5 py-1">
                <div className="h-3.5 w-[75%] animate-pulse rounded-sm bg-foreground/10" />
                <div className="h-3.5 w-full animate-pulse rounded-sm bg-foreground/[0.08]" />
              </div>
            </div>

            {/* User bubble */}
            <div className="flex w-full justify-end">
              <div className="flex items-center rounded-2xl rounded-tr-sm bg-foreground/[0.06] px-4 py-2.5">
                <div className="h-4 w-32 animate-pulse rounded bg-foreground/10" />
              </div>
            </div>

            {/* Assistant response loading */}
            <div className="flex w-full justify-start">
              <div className="flex w-full max-w-[85%] flex-col gap-2.5 py-1">
                <div className="h-3.5 w-[90%] animate-pulse rounded-sm bg-foreground/10" />
                <div className="h-3.5 w-[65%] animate-pulse rounded-sm bg-foreground/[0.08]" />
                <div className="h-3.5 w-[80%] animate-pulse rounded-sm bg-foreground/[0.06]" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ChatBox skeleton — matches real ChatBox: textarea min-h-[68px] + pt-3, ActionBar px-3 pb-3 pt-2 with size-8 buttons */}
      <div className="shrink-0 bg-background/60 py-3 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-3xl px-2 sm:px-4">
          <div className="rounded-2xl border border-border/50 bg-card">
            {/* Textarea area: pt-3 wrapper + 68px min-height textarea with px-3 py-1 */}
            <div className="flex min-h-[68px] items-start px-3 pt-4">
              <div className="h-4 w-[45%] animate-pulse rounded-sm bg-foreground/[0.05]" />
            </div>
            {/* ActionBar: px-3 pb-3 pt-2 */}
            <div className="flex items-center justify-between px-3 pb-3 pt-2">
              <div className="flex items-center gap-1">
                <div className="size-8 animate-pulse rounded-full bg-foreground/[0.04]" />
                <div className="size-8 animate-pulse rounded-full bg-foreground/[0.04]" />
                <div className="size-8 animate-pulse rounded-full bg-foreground/[0.04]" />
              </div>
              <div className="size-8 animate-pulse rounded-full bg-foreground/[0.06]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
