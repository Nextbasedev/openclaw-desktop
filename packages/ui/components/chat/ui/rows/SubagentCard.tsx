"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { SubagentRow } from "../../store/state";

const STATUS: Record<string, { border: string; pill: string; dot: string; label: string; pulse?: boolean }> = {
  spawning: { border: "border-sky-500/30", pill: "bg-sky-500/10 text-sky-600 dark:text-sky-400", dot: "bg-sky-500", label: "spawning", pulse: true },
  running: { border: "border-violet-500/30", pill: "bg-violet-500/10 text-violet-600 dark:text-violet-400", dot: "bg-violet-500", label: "running", pulse: true },
  done: { border: "border-emerald-500/25", pill: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", label: "done" },
  failed: { border: "border-red-500/30", pill: "bg-red-500/10 text-red-600 dark:text-red-400", dot: "bg-red-500", label: "failed" },
};

function shortChild(key?: string | null): string | null {
  if (!key) return null;
  const id = key.split(":").pop() ?? key;
  return id.slice(0, 8);
}

/** First-class sub-agent (sessions_spawn) card: label + task + status + child + activity. */
function SubagentCardImpl({ sub }: { sub: SubagentRow }) {
  const style = STATUS[sub.status] ?? STATUS.spawning;
  const child = shortChild(sub.childSessionKey);
  return (
    <div className={cn("my-1.5 overflow-hidden rounded-lg border bg-card shadow-sm", style.border)}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot, style.pulse && "animate-pulse")} />
        <span className="text-xs font-medium text-foreground/90">🤖 {sub.label || "Sub-agent"}</span>
        <span className={cn("rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide", style.pill)}>{style.label}</span>
        {sub.status === "running" && sub.activityCount > 0 ? (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">{sub.activityCount} steps</span>
        ) : null}
      </div>
      {sub.task ? (
        <div className="border-t bg-background/60 px-3 py-2">
          <div className="mb-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">task</div>
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground/80">{sub.task}</p>
        </div>
      ) : null}
      {(child || sub.status === "failed") ? (
        <div className="flex items-center gap-2 border-t px-3 py-1.5 font-mono text-[10px] text-muted-foreground/70">
          {child ? <span>child: {child}</span> : null}
          {sub.status === "failed" ? <span className="text-red-500">spawn failed</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export const SubagentCard = memo(SubagentCardImpl);
