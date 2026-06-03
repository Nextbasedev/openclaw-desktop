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
  // Older-page scroll anchor: while active, compensate scrollTop for content that
  // grows ABOVE the viewport so prepended history doesn't make the view jump.
  const anchorRef = useRef<{ active: boolean; lastHeight: number; until: number }>({
    active: false,
    lastHeight: 0,
    until: 0,
  });

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

  /**
   * Call right before loading an older page. Records current height; subsequent
   * content growth (measured by the ResizeObserver below) is added to scrollTop so
   * the previously-visible rows stay put. Auto-expires so live growth isn't affected.
   */
  const beginAnchor = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    // Window must outlast react-virtual's estimate→measure settle (which can shrink
    // height a frame or two after the prepend), so we keep compensating both directions.
    anchorRef.current = { active: true, lastHeight: el.scrollHeight, until: Date.now() + 1800 };
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
      const el = viewportRef.current;
      const anchor = anchorRef.current;
      if (el && anchor.active) {
        if (Date.now() > anchor.until) {
          anchor.active = false;
        } else {
          const delta = el.scrollHeight - anchor.lastHeight;
          anchor.lastHeight = el.scrollHeight;
          if (delta !== 0) {
            // Compensate growth AND the subsequent measure-shrink so the rows the user
            // was reading keep their exact screen position.
            el.scrollTop = Math.max(0, el.scrollTop + delta);
            return;
          }
        }
      }
      if (pinnedRef.current) scrollToBottom("auto");
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  return { viewportRef, contentRef, pinned, scrollToBottom, beginAnchor };
}
