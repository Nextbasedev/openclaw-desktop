"use client";

import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import type { MessageRow, ToolRow } from "../../store/state";
import { Markdown } from "../Markdown";
import { CopyButton } from "../CopyButton";
import { ToolCard } from "./ToolCard";

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-l-2 border-l-violet-400/60 bg-violet-500/[0.04] text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-violet-700/80 transition-colors hover:bg-violet-500/[0.06] dark:text-violet-300/80">
        <span className={cn("text-[10px] transition-transform", open && "rotate-180")}>▾</span>
        <span className="font-medium italic">Reasoning</span>
        {!open ? <span className="ml-auto text-[10px] text-muted-foreground/60">show</span> : null}
      </button>
      {open ? <div className="whitespace-pre-wrap px-3 pb-2.5 pt-0.5 italic leading-relaxed text-muted-foreground">{text}</div> : null}
    </div>
  );
}

function usageSummary(usage: unknown): string | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const inp = u.inputTokens ?? u.input_tokens ?? u.promptTokens;
  const out = u.outputTokens ?? u.output_tokens ?? u.completionTokens;
  const parts: string[] = [];
  if (typeof inp === "number") parts.push(`${inp} in`);
  if (typeof out === "number") parts.push(`${out} out`);
  return parts.length ? parts.join(" · ") : null;
}

/** Left-aligned assistant turn: avatar + reasoning + tools + streamed text + meta. */
function AssistantTurnImpl({
  row,
  tools,
  onFetchToolResult,
}: {
  row: MessageRow;
  tools: ToolRow[];
  onFetchToolResult?: (id: string) => Promise<{ text: string }>;
}) {
  const usage = usageSummary(row.usage);
  return (
    <div className="group flex gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-semibold text-muted-foreground">AI</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {row.reasoning ? <Reasoning text={row.reasoning} /> : null}
        {tools.map((tool) => (
          <ToolCard key={tool.toolCallId} tool={tool} onFetchFull={onFetchToolResult} />
        ))}
        {row.text ? (
          <div className="text-sm leading-relaxed">
            <Markdown text={row.text} />
          </div>
        ) : null}
        {row.finalized ? (
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100">
            {row.model ? <span>{row.model}</span> : null}
            {usage ? <span>· {usage}</span> : null}
            {row.text ? <CopyButton text={row.text} className="ml-auto" /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const AssistantTurn = memo(AssistantTurnImpl);
