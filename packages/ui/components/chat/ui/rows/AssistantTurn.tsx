"use client";

import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import type { MessageRow, ToolRow } from "../../store/state";
import { Markdown } from "../Markdown";
import { ToolCard } from "./ToolCard";

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-md border border-l-2 border-l-violet-400/50 bg-muted/30 text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted-foreground">
        <span className={cn("text-[10px] transition-transform", open && "rotate-180")}>▾</span>
        <span className="italic">Reasoning</span>
      </button>
      {open && <div className="whitespace-pre-wrap px-3 pb-2 italic text-muted-foreground">{text}</div>}
    </div>
  );
}

/** Left-aligned assistant turn: reasoning + tools + streamed text + meta. */
function AssistantTurnImpl({
  row,
  tools,
  onFetchToolResult,
}: {
  row: MessageRow;
  tools: ToolRow[];
  onFetchToolResult?: (id: string) => Promise<{ text: string }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      {row.reasoning ? <Reasoning text={row.reasoning} /> : null}
      {tools.map((tool) => (
        <ToolCard key={tool.toolCallId} tool={tool} onFetchFull={onFetchToolResult} />
      ))}
      {row.text ? <Markdown text={row.text} /> : null}
      {(row.model || row.stopReason) && row.finalized ? (
        <div className="mt-0.5 flex gap-2 font-mono text-[10px] text-muted-foreground/70">
          {row.model && <span>{row.model}</span>}
        </div>
      ) : null}
    </div>
  );
}

export const AssistantTurn = memo(AssistantTurnImpl);
