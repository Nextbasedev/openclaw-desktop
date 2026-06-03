"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const THRESHOLD_PX = 140;

/**
 * Keeps a scroll container pinned to the bottom while content grows, unless the user
 * has scrolled up. Returns refs + state for a viewport and its growing content.
 */
export function useStickToBottom() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);

  const isAtBottom = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Track user intent.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = isAtBottom();
      pinnedRef.current = atBottom;
      setPinned(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [isAtBottom]);

  // Follow content growth while pinned.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom("auto");
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  return { viewportRef, contentRef, pinned, scrollToBottom };
}
