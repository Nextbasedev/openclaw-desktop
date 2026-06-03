import type { SyncSocket } from "../socket";
import type { ChatBootstrapSnapshot, ChatPatch } from "../types.contract";

export class FakeSocket implements SyncSocket {
  openCb?: () => void;
  messageCb?: (data: string) => void;
  closeCb?: () => void;
  errorCb?: () => void;
  closed = false;

  onOpen(cb: () => void) { this.openCb = cb; }
  onMessage(cb: (data: string) => void) { this.messageCb = cb; }
  onClose(cb: () => void) { this.closeCb = cb; }
  onError(cb: () => void) { this.errorCb = cb; }
  close() { this.closed = true; }

  emitOpen() { this.openCb?.(); }
  emitFrame(obj: unknown) { this.messageCb?.(JSON.stringify(obj)); }
  emitClose() { this.closeCb?.(); }
  emitError() { this.errorCb?.(); }
}

export function snapshot(cursor: number): ChatBootstrapSnapshot {
  return {
    ok: true, sessionKey: "s", sessionId: null, runStatus: "idle", statusLabel: null,
    activeRun: null, hasOlder: false, knownTotalMessages: 0, oldestLoadedSeq: null,
    messages: [], messageCount: 0, tools: [], toolCalls: [], cursor,
  };
}

export function patchFrame(cursor: number): { type: "patch"; patch: ChatPatch } {
  return {
    type: "patch",
    patch: {
      cursor, type: "chat.status", sessionKey: "s", createdAtMs: cursor,
      payload: { sessionKey: "s", semanticType: "chat.status" },
    },
  };
}

export function helloFrame(recovery: "bootstrap" | null, replayWindowExceeded = false) {
  return {
    type: "hello" as const, clientId: "c", afterCursor: 0, replayCount: 0,
    replayHasMore: false, replayWindowExceeded, recovery, droppedReplayCount: 0,
  };
}
