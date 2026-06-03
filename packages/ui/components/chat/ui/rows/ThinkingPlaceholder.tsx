"use client";

/** Shimmer "Thinking…" line shown while a run is queued/thinking with no text yet. */
export function ThinkingPlaceholder({ label = "Thinking" }: { label?: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-semibold text-muted-foreground">AI</div>
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <span className="inline-flex gap-1">
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
        </span>
        <span className="animate-pulse">{label}…</span>
      </div>
    </div>
  );
}
