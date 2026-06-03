"use client";

import { useEffect, useRef } from "react";

/** Triggers onReach when scrolled near the top (for loading older messages). */
export function LoadOlderSentinel({ enabled, onReach }: { enabled: boolean; onReach: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onReachRef = useRef(onReach);
  onReachRef.current = onReach;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) onReachRef.current(); },
      { rootMargin: "200px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);

  return <div ref={ref} className="h-1 w-full" aria-hidden />;
}
