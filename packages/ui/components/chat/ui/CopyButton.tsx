"use client";

import { useState, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * Tiny copy-to-clipboard button. Stops propagation so copying inside a clickable
 * card header/body never toggles the card. Shows a transient "Copied" state.
 */
export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable (non-secure context) — noop */
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(
        "rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70",
        "transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
      aria-label={label}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
