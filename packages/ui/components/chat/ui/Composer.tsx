"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

/** Message composer: textarea + send/stop. Clears immediately on submit. */
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

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    onSend(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t bg-background p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder="Message…"
        className="max-h-40 flex-1 resize-none rounded-xl border bg-card px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
      {generating ? (
        <button type="button" onClick={onStop} className="rounded-xl border bg-card px-3 py-2 text-sm hover:bg-muted">
          Stop
        </button>
      ) : (
        <button type="submit" disabled={!text.trim()} className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
          Send
        </button>
      )}
    </form>
  );
}
