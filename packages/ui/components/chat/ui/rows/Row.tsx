"use client";

import { memo } from "react";
import type { MessageRow, SubagentRow, ToolRow } from "../../store/state";
import { UserRow } from "./UserRow";
import { AssistantTurn } from "./AssistantTurn";

/** Dispatches a MessageRow to the right renderer. Memoized per row identity. */
function RowImpl({
  row,
  tools,
  subagents,
  onFetchToolResult,
}: {
  row: MessageRow;
  tools: ToolRow[];
  subagents?: SubagentRow[];
  onFetchToolResult?: (id: string) => Promise<{ text: string }>;
}) {
  if (row.kind === "user") return <UserRow row={row} />;
  return <AssistantTurn row={row} tools={tools} subagents={subagents} onFetchToolResult={onFetchToolResult} />;
}

export const Row = memo(RowImpl);
