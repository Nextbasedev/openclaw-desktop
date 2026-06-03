"use client";

import { useRef, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MessageRow, ToolRow } from "../store/state";
import { Row } from "./rows/Row";

/**
 * Virtualized finalized history. Lives inside the shared scroll viewport; the live
 * tail renders after it. Streaming never touches this list (separate subtree), so
 * measurements stay stable.
 */
export function VirtualHistory({
  rows,
  viewportRef,
  resolveTools,
  onFetchToolResult,
}: {
  rows: MessageRow[];
  viewportRef: RefObject<HTMLDivElement | null>;
  resolveTools: (row: MessageRow) => ToolRow[];
  onFetchToolResult?: (id: string) => Promise<{ text: string }>;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 96,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  return (
    <div ref={listRef} style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        if (!row) return null;
        return (
          <div
            key={row.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
            }}
            className="py-2"
          >
            <Row row={row} tools={row.kind === "assistant" ? resolveTools(row) : []} onFetchToolResult={onFetchToolResult} />
          </div>
        );
      })}
    </div>
  );
}
