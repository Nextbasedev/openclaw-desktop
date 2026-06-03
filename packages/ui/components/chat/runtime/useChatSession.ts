"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useChatRuntime } from "./ChatSyncProvider";
import { historyRows, isGenerating, liveRows, thinkingPlaceholderVisible } from "../store/selectors";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** React binding: subscribes to the store and exposes derived views + actions. */
export function useChatSession() {
  const { store, api } = useChatRuntime();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  const send = useCallback(
    (text: string, attachments?: unknown[]) => {
      const idempotencyKey = newId();
      return api.send({
        sessionKey: state.sessionKey,
        text,
        attachments,
        idempotencyKey,
        clientMessageId: `client:${idempotencyKey}`,
      });
    },
    [api, state.sessionKey],
  );

  const abort = useCallback(() => api.abort(state.sessionKey), [api, state.sessionKey]);

  const toolResult = useCallback(
    (toolCallId: string) => api.toolResult(state.sessionKey, toolCallId),
    [api, state.sessionKey],
  );

  const loadOlder = useCallback(async () => {
    const s = store.getState();
    const { hasOlder, loadingOlder, oldestLoadedSeq } = s.pagination;
    if (!hasOlder || loadingOlder || oldestLoadedSeq == null) return;
    store.setLoadingOlder(true);
    try {
      const page = await api.fetchMessages(s.sessionKey, { beforeSeq: oldestLoadedSeq, limit: 100 });
      store.mergeOlder(page.messages);
    } catch {
      store.setLoadingOlder(false);
    }
  }, [api, store]);

  return useMemo(
    () => ({
      state,
      history: historyRows(state),
      live: liveRows(state),
      activeRun: state.activeRun,
      conn: state.conn,
      generating: isGenerating(state),
      thinking: thinkingPlaceholderVisible(state),
      pagination: state.pagination,
      tools: state.tools,
      subagents: state.subagents,
      send,
      abort,
      loadOlder,
      toolResult,
    }),
    [state, send, abort, loadOlder, toolResult],
  );
}
