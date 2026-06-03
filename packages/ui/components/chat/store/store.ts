import type { ChatBootstrapSnapshot, ChatPatch } from "../sync/types.contract";
import { applyPatches } from "./applyPatch";
import { applyBootstrap } from "./applyBootstrap";
import { applyOlderMessages, type OlderMessage } from "./applyOlder";
import { emptyChatState, type ChatSessionState, type ConnState } from "./state";

export interface ChatStore {
  getState(): ChatSessionState;
  subscribe(listener: () => void): () => void;
  bootstrap(snapshot: ChatBootstrapSnapshot): void;
  /** Queue a patch; applied in a coalesced flush (one commit per frame). */
  enqueuePatch(patch: ChatPatch): void;
  mergeOlder(messages: OlderMessage[]): void;
  setLoadingOlder(value: boolean): void;
  setConn(conn: ConnState): void;
  /** Force-apply queued patches now (also runs automatically per frame). */
  flush(): void;
  destroy(): void;
}

export interface ChatStoreOptions {
  /** Schedule a flush; returns a cancel fn. Defaults to rAF (fallback setTimeout). */
  schedule?: (fn: () => void) => () => void;
  /** Called when the reducer detects a cursor gap needing re-bootstrap. */
  onNeedBootstrap?: () => void;
}

function defaultSchedule(fn: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(() => fn());
    return () => cancelAnimationFrame(id);
  }
  const t = setTimeout(fn, 0);
  return () => clearTimeout(t);
}

/** Framework-agnostic store. React binds via useSyncExternalStore (see runtime/). */
export function createChatStore(sessionKey: string, opts: ChatStoreOptions = {}): ChatStore {
  const schedule = opts.schedule ?? defaultSchedule;
  let state = emptyChatState(sessionKey);
  const listeners = new Set<() => void>();
  let queue: ChatPatch[] = [];
  let cancelFlush: (() => void) | null = null;

  const emit = () => { for (const l of [...listeners]) l(); };
  const commit = (next: ChatSessionState) => { state = next; emit(); };

  const flush = () => {
    if (cancelFlush) { cancelFlush(); cancelFlush = null; }
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    const result = applyPatches(state, batch);
    if (result.needsBootstrap) { opts.onNeedBootstrap?.(); return; }
    commit(result.state);
  };

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    bootstrap(snapshot) {
      queue = []; // stale queued patches are superseded by the snapshot
      if (cancelFlush) { cancelFlush(); cancelFlush = null; }
      commit(applyBootstrap(snapshot));
    },
    enqueuePatch(patch) {
      queue.push(patch);
      if (!cancelFlush) cancelFlush = schedule(flush);
    },
    mergeOlder(messages) { commit(applyOlderMessages(state, messages)); },
    setLoadingOlder(value) {
      commit({ ...state, pagination: { ...state.pagination, loadingOlder: value } });
    },
    setConn(conn) { commit({ ...state, conn }); },
    flush,
    destroy() {
      if (cancelFlush) { cancelFlush(); cancelFlush = null; }
      queue = [];
      listeners.clear();
    },
  };
}
