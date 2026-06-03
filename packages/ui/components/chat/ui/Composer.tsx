"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/** Message composer: auto-growing textarea + send/stop. Clears immediately on submit. */
export function Composer({
  generating,
  onSend,
  onStop,
}: {
  generating: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    if (ref.current) ref.current.style.height = "auto";
    onSend(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <div className="border-t bg-background/95 px-3 pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <form
        onSubmit={submit}
        className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border bg-card px-2 py-1.5 shadow-sm focus-within:ring-1 focus-within:ring-ring"
      >
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => { setText(e.target.value); grow(e.target); }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Message…"
          className="max-h-52 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60"
        />
        {generating ? (
          <button type="button" onClick={onStop} className="mb-0.5 flex h-8 items-center gap-1.5 rounded-xl border bg-background px-3 text-sm font-medium hover:bg-muted">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-foreground" /> Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim()}
            className={cn(
              "mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity",
              "disabled:opacity-40",
            )}
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" />
            </svg>
          </button>
        )}
      </form>
      <div className="mx-auto mt-1 w-full max-w-3xl px-2 text-[10px] text-muted-foreground/50">
        Enter to send · Shift+Enter for newline
      </div>
    </div>
  );
}
