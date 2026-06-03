"use client";

import { memo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ToolRow } from "../../store/state";
import { CopyButton } from "../CopyButton";

/** Status → border / pill / dot color tokens (power-dashboard model). */
const STATUS: Record<string, { border: string; pill: string; dot: string; label: string }> = {
  running: { border: "border-amber-500/30", pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400", dot: "bg-amber-500", label: "running" },
  success: { border: "border-emerald-500/25", pill: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", label: "done" },
  error: { border: "border-red-500/30", pill: "bg-red-500/10 text-red-600 dark:text-red-400", dot: "bg-red-500", label: "error" },
};

function pretty(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function Block({ label, body, accent, action }: { label: string; body: string; accent?: string; action?: ReactNode }) {
  return (
    <div className="border-t bg-background/60 px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={cn("font-mono text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70", accent)}>{label}</span>
        <span className="flex items-center gap-1">
          {action}
          <CopyButton text={body} />
        </span>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/80">{body || "(empty)"}</pre>
    </div>
  );
}

/**
 * Collapsible tool card. Collapsed by default once a result exists; expanded while
 * pending or for an orphan result. Status color on border + pill; labeled args/result
 * blocks with copy; "view full" fetches the untruncated result.
 */
function ToolCardImpl({ tool, onFetchFull }: { tool: ToolRow; onFetchFull?: (id: string) => Promise<{ text: string }> }) {
  const pending = tool.status === "running" || tool.awaitingResult;
  const [open, setOpen] = useState(pending);
  const [full, setFull] = useState<string | null>(null);
  const style = STATUS[tool.status] ?? STATUS.running;

  const args = pretty(tool.argsMeta);
  const result = full ?? pretty(tool.resultMeta ?? tool.output);

  const loadFull = async () => {
    if (!onFetchFull || full != null) return;
    try { const r = await onFetchFull(tool.toolCallId); setFull(r.text || ""); } catch { /* noop */ }
  };

  return (
    <div className={cn("my-1.5 overflow-hidden rounded-lg border bg-card shadow-sm", style.border)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot, pending && "animate-pulse")} />
        <span className="font-mono text-xs font-medium text-foreground/90">{tool.name}</span>
        <span className={cn("rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide", style.pill)}>{style.label}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/60">{open ? "Hide" : "Details"}</span>
        <span className={cn("text-[10px] text-muted-foreground transition-transform", open && "rotate-180")}>▾</span>
      </button>
      {open && (
        <div>
          {args ? <Block label="arguments" body={args} /> : null}
          {pending ? (
            <div className="border-t px-3 py-2.5 font-mono text-[11px] italic text-muted-foreground">
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 align-middle" />
              waiting for result…
            </div>
          ) : (
            <Block
              label={tool.status === "error" ? "error" : "result"}
              body={result}
              accent={tool.status === "error" ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}
              action={onFetchFull && full == null ? (
                <button type="button" onClick={loadFull} className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70 hover:bg-muted hover:text-foreground">view full</button>
              ) : null}
            />
          )}
        </div>
      )}
    </div>
  );
}

export const ToolCard = memo(ToolCardImpl);
