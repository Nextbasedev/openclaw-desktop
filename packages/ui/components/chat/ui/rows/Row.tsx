"use client";

import { memo } from "react";
import type { MessageRow, ToolRow } from "../../store/state";
import { UserRow } from "./UserRow";
import { AssistantTurn } from "./AssistantTurn";

/** Dispatches a MessageRow to the right renderer. Memoized per row identity. */
function RowImpl({
  row,
  tools,
  onFetchToolResult,
}: {
  row: MessageRow;
  tools: ToolRow[];
  onFetchToolResult?: (id: string) => Promise<{ text: string }>;
}) {
  if (row.kind === "user") return <UserRow row={row} />;
  return <AssistantTurn row={row} tools={tools} onFetchToolResult={onFetchToolResult} />;
}

export const Row = memo(RowImpl);
