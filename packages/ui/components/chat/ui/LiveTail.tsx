"use client";

import type { ActiveRunProjection } from "../sync/types.contract";
import type { MessageRow, SubagentRow, ToolRow } from "../store/state";
import { Row } from "./rows/Row";
import { ThinkingPlaceholder } from "./rows/ThinkingPlaceholder";

/**
 * Non-virtualized tail: the active/unfinalized rows + thinking placeholder. This is
 * the ONLY subtree that re-renders on streaming deltas, keeping history stable.
 */
export function LiveTail({
  rows,
  activeRun,
  showThinking,
  resolveTools,
  resolveSubagents,
  onFetchToolResult,
}: {
  rows: MessageRow[];
  activeRun: ActiveRunProjection | null;
  showThinking: boolean;
  resolveTools: (row: MessageRow) => ToolRow[];
  resolveSubagents?: (row: MessageRow) => SubagentRow[];
  onFetchToolResult?: (id: string) => Promise<{ text: string }>;
}) {
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <div key={row.key} className="py-1">
          <Row row={row} tools={row.kind === "assistant" ? resolveTools(row) : []} subagents={row.kind === "assistant" ? resolveSubagents?.(row) : undefined} onFetchToolResult={onFetchToolResult} />
        </div>
      ))}
      {showThinking && <ThinkingPlaceholder label={activeRun?.statusLabel ?? "Thinking"} />}
    </div>
  );
}
