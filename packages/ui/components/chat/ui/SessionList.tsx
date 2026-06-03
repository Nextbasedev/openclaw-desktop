"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ChatApiClient, type ChatSummary } from "../sync/apiClient";
import { createMiddlewareTransport } from "../runtime/transport";

const api = new ChatApiClient(createMiddlewareTransport());

/** Left sidebar: lists the user's chats and lets them pick/create a session. */
export function SessionList({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (sessionKey: string) => void;
}) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.listChats();
      setChats(res.chats ?? []);
      setError(null);
    } catch {
      setError("Couldn't load chats (is the middleware connected?)");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const newChat = async () => {
    try {
      const chat = await api.createChat("New Chat");
      await refresh();
      onSelect(chat.sessionKey);
    } catch { /* noop */ }
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-card/40">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">Chats</span>
        <button type="button" onClick={newChat} className="rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted">+ New</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="p-3 text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="p-3 text-xs text-amber-500">{error}</p>}
        {!loading && !error && chats.length === 0 && <p className="p-3 text-xs text-muted-foreground">No chats yet.</p>}
        {chats.map((chat) => (
          <button
            key={chat.id || chat.sessionKey}
            type="button"
            onClick={() => onSelect(chat.sessionKey)}
            className={cn(
              "flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left hover:bg-muted/60",
              chat.sessionKey === selected && "bg-muted",
            )}
          >
            <span className="truncate text-sm font-medium">{chat.name || chat.sessionKey}</span>
            {chat.lastMessageText && (
              <span className="truncate text-xs text-muted-foreground">{chat.lastMessageText}</span>
            )}
            <span className="truncate font-mono text-[10px] text-muted-foreground/60">{chat.sessionKey}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
