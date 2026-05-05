export function AppLoadingSkeleton() {
  return (
    <div className="relative flex h-dvh min-h-dvh items-center justify-center overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(56,189,248,0.12),transparent_34%),radial-gradient(circle_at_44%_58%,rgba(168,85,247,0.10),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" />

      <div className="relative flex flex-col items-center gap-5 px-6 text-center">
        <div className="relative flex size-20 items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-cyan-300/20" />
          <div className="absolute inset-1 rounded-full border border-violet-300/10" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-cyan-300/70 border-r-violet-300/50" />
          <div className="absolute inset-4 animate-pulse rounded-full bg-cyan-300/10 shadow-[0_0_32px_rgba(56,189,248,0.28)]" />
          <div className="size-3 rounded-full bg-cyan-200 shadow-[0_0_18px_rgba(103,232,249,0.9)]" />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold tracking-[0.24em] text-foreground/85 uppercase">
            OpenClaw
          </p>
          <p className="text-[13px] text-muted-foreground">
            Connecting middleware and restoring your workspace…
          </p>
        </div>

        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="size-1.5 animate-bounce rounded-full bg-cyan-300/80 [animation-delay:-0.24s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-cyan-300/60 [animation-delay:-0.12s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-cyan-300/40" />
        </div>
      </div>
    </div>
  )
}
