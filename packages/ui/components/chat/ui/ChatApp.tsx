"use client";

import { useEffect, useState } from "react";
import { ChatScreen } from "./ChatScreen";
import { SessionList } from "./SessionList";

/**
 * Full chat shell: session sidebar + the active session's timeline.
 * Switching sessions remounts ChatScreen (fresh sync client per session).
 */
export function ChatApp({ initialSessionKey }: { initialSessionKey?: string }) {
  const [selected, setSelected] = useState<string | null>(initialSessionKey ?? null);

  useEffect(() => {
    if (selected) return;
    const params = new URLSearchParams(window.location.search);
    setSelected(params.get("session"));
  }, [selected]);

  return (
    <div className="flex h-full w-full">
      <SessionList selected={selected} onSelect={setSelected} />
      <div className="min-w-0 flex-1">
        {selected ? (
          <ChatScreen key={selected} sessionKey={selected} />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
            Select a chat on the left, or create a new one.
          </div>
        )}
      </div>
    </div>
  );
}
