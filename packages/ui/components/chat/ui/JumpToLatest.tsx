"use client";

/** Floating button shown when the user has scrolled up; jumps back to the latest. */
export function JumpToLatest({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border bg-card px-3 py-1.5 text-xs text-foreground shadow-md hover:bg-muted"
    >
      ↓ Latest
    </button>
  );
}
