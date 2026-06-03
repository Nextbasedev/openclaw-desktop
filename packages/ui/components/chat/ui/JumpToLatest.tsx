"use client";

/** Floating button shown when the user has scrolled up; jumps back to the latest. */
export function JumpToLatest({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur transition-colors hover:bg-muted"
    >
      ↓ Jump to latest
    </button>
  );
}
