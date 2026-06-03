import type { ChatBootstrapSnapshot, ChatPatch, ChatStreamFrame } from "./types.contract";
import type { SyncSocket } from "./socket";

export type ConnState = "idle" | "connecting" | "live" | "reconnecting" | "rebootstrapping";

export interface ChatSyncHandlers {
  onBootstrap(snapshot: ChatBootstrapSnapshot): void;
  onPatch(patch: ChatPatch): void;
  onConn(state: ConnState): void;
}

export interface ChatSyncDeps {
  bootstrap(sessionKey: string): Promise<ChatBootstrapSnapshot>;
  /** Open a socket subscribed from afterCursor. */
  openSocket(afterCursor: number): SyncSocket;
  /** Schedule a delayed callback; returns a cancel fn. Defaults to setTimeout. */
  schedule?(fn: () => void, ms: number): () => void;
}

const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5000;

/**
 * Owns one live session sync: bootstrap -> subscribe WS -> apply patches in cursor
 * order, with gap/replay-window recovery (re-bootstrap) and reconnect backoff.
 * Pure state machine: no DOM, no store. Feed handlers into a reducer-backed store.
 */
export class ChatSyncClient {
  private socket: SyncSocket | null = null;
  private lastCursor = 0;
  private stopped = false;
  private attempt = 0;
  private cancelTimer: (() => void) | null = null;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  constructor(
    private readonly sessionKey: string,
    private readonly deps: ChatSyncDeps,
    private readonly handlers: ChatSyncHandlers,
  ) {
    this.schedule = deps.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.doBootstrap("connecting");
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.closeSocket();
    this.emitConn("idle");
  }

  /** Force a clean re-bootstrap (e.g. store detected a gap). */
  resync(): void {
    if (this.stopped) return;
    void this.doBootstrap("rebootstrapping");
  }

  private async doBootstrap(conn: ConnState): Promise<void> {
    if (this.stopped) return;
    this.emitConn(conn);
    this.closeSocket();
    try {
      const snapshot = await this.deps.bootstrap(this.sessionKey);
      if (this.stopped) return;
      this.lastCursor = snapshot.cursor ?? 0;
      this.handlers.onBootstrap(snapshot);
      this.attempt = 0;
      this.openSocket();
    } catch {
      this.scheduleRetry(() => this.doBootstrap("reconnecting"));
    }
  }

  private openSocket(): void {
    if (this.stopped) return;
    const socket = this.deps.openSocket(this.lastCursor);
    this.socket = socket;
    socket.onOpen(() => { this.attempt = 0; this.emitConn("live"); });
    socket.onMessage((data) => this.onMessage(data));
    socket.onClose(() => this.onDrop());
    socket.onError(() => this.onDrop());
  }

  private onMessage(data: string): void {
    if (this.stopped) return;
    let frame: ChatStreamFrame;
    try { frame = JSON.parse(data) as ChatStreamFrame; } catch { return; }

    if (frame.type === "hello") {
      // Cursor too far behind -> partial replay is unsafe; rebootstrap instead.
      if (frame.recovery === "bootstrap" || frame.replayWindowExceeded) void this.doBootstrap("rebootstrapping");
      return;
    }
    if (frame.type === "patch") {
      const { cursor } = frame.patch;
      if (cursor <= this.lastCursor) return;                 // duplicate
      if (this.lastCursor > 0 && cursor > this.lastCursor + 1) {
        void this.doBootstrap("rebootstrapping");            // gap -> recover
        return;
      }
      this.lastCursor = cursor;
      // The /api/stream/ws feed is GLOBAL (no per-session scoping server-side):
      // it carries patches for every session. Advance the cursor for foreign
      // patches (so the gap guard stays correct) but never dispatch them into
      // THIS session's store, or other chats' messages bleed in.
      if (frame.patch.sessionKey && frame.patch.sessionKey !== this.sessionKey) return;
      this.handlers.onPatch(frame.patch);
    }
  }

  private onDrop(): void {
    if (this.stopped) return;
    this.scheduleRetry(() => this.openSocket());
  }

  /** Backoff wrapper shared by socket-reconnect and bootstrap-retry. */
  private scheduleRetry(action: () => void): void {
    if (this.stopped) return;
    this.emitConn("reconnecting");
    this.closeSocket();
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.attempt);
    const jitter = Math.floor(Math.random() * BASE_BACKOFF_MS);
    this.attempt += 1;
    this.clearTimer();
    this.cancelTimer = this.schedule(() => { this.cancelTimer = null; if (!this.stopped) action(); }, delay + jitter);
  }

  private closeSocket(): void {
    if (this.socket) { this.socket.close(); this.socket = null; }
  }

  private clearTimer(): void {
    if (this.cancelTimer) { this.cancelTimer(); this.cancelTimer = null; }
  }

  private emitConn(state: ConnState): void {
    this.handlers.onConn(state);
  }

  /** Test/diagnostic accessor. */
  get cursor(): number { return this.lastCursor; }
}
