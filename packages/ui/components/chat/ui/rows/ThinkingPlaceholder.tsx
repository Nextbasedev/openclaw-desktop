"use client";

/** Shimmer "Thinking…" line shown while a run is queued/thinking with no text yet. */
export function ThinkingPlaceholder({ label = "Thinking" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
      <span className="inline-flex gap-1">
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
      </span>
      <span className="animate-pulse">{label}…</span>
    </div>
  );
}
