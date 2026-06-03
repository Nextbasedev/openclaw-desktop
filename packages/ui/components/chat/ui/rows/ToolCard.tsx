"use client";

import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import type { ToolRow } from "../../store/state";

const STATUS_STYLE: Record<string, string> = {
  running: "text-amber-500 border-amber-500/30",
  success: "text-emerald-500 border-emerald-500/30",
  error: "text-red-500 border-red-500/30",
};

function pretty(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

/**
 * Collapsible tool card — interaction model ported from openclaw-power-dashboard:
 * collapsed by default once a result exists, expanded while pending; args + result
 * blocks; status color; "view full result" fetch.
 */
function ToolCardImpl({ tool, onFetchFull }: { tool: ToolRow; onFetchFull?: (id: string) => Promise<{ text: string }> }) {
  const pending = tool.status === "running" || tool.awaitingResult;
  const [open, setOpen] = useState(pending);
  const [full, setFull] = useState<string | null>(null);

  const result = full ?? pretty(tool.resultMeta) ?? pretty(tool.output);
  const args = pretty(tool.argsMeta);

  const loadFull = async () => {
    if (!onFetchFull || full != null) return;
    try { const r = await onFetchFull(tool.toolCallId); setFull(r.text || ""); } catch { /* noop */ }
  };

  return (
    <div className={cn("my-2 overflow-hidden rounded-md border bg-card", STATUS_STYLE[tool.status]?.split(" ")[1])}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 bg-muted/40 px-3 py-1.5 text-left"
      >
        <span className="font-mono text-xs font-medium text-muted-foreground">{tool.name}</span>
        <span className="flex items-center gap-2">
          <span className={cn("rounded px-1.5 py-0.5 font-mono text-[9px] uppercase", STATUS_STYLE[tool.status])}>
            {tool.status}
          </span>
          <span className={cn("text-[10px] text-muted-foreground transition-transform", open && "rotate-180")}>▾</span>
        </span>
      </button>
      {open && (
        <div className="text-xs">
          {args && <pre className="overflow-x-auto whitespace-pre-wrap break-words border-b bg-background px-3 py-2 font-mono text-muted-foreground">{args}</pre>}
          {pending ? (
            <div className="px-3 py-2 font-mono italic text-muted-foreground">waiting for result…</div>
          ) : (
            <div className="px-3 py-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-wide text-emerald-500">result</span>
                {onFetchFull && full == null && (
                  <button type="button" onClick={loadFull} className="text-[10px] text-muted-foreground hover:text-foreground">
                    view full
                  </button>
                )}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-muted-foreground">{result || "(empty)"}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const ToolCard = memo(ToolCardImpl);
