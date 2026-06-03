import type {
  ActiveRunProjection,
  OCPlatformMessageData,
  RunOrIdle,
  RunStatus,
  ToolPhase,
  ToolStatus,
} from "../sync/types.contract";

export type RowKind = "user" | "assistant";

/**
 * Stable React key for a row. It is assigned ONCE and preserved across backend
 * id changes (optimistic->canonical, delta->final). This is the core fix for the
 * v4 blink/remount/reorder bugs.
 *   user:      client:<clientMessageId>
 *   assistant: run:<runId>
 *   history:   msg:<messageId>  (fallback seq:<openclawSeq>)
 */
export type RowKey = string;

export const userKey = (clientMessageId: string): RowKey => `client:${clientMessageId}`;
export const runKey = (runId: string): RowKey => `run:${runId}`;
export const msgKey = (messageId: string): RowKey => `msg:${messageId}`;
export const seqKey = (seq: number): RowKey => `seq:${seq}`;

export interface MessageRow {
  key: RowKey;
  kind: RowKind;
  /** openclawSeq — the only ordering authority. May be ephemeral until confirmed. */
  seq: number;
  /** true while seq is a locally-assigned placeholder (optimistic/live). */
  ephemeralSeq: boolean;
  /** canonical message id once known (null while optimistic/live). */
  messageId: string | null;
  /** user optimistic join key. */
  clientMessageId?: string;
  /** assistant turn id. */
  runId?: string;
  text: string;
  reasoning?: string;
  attachments?: unknown[];
  /** ordered tool call ids belonging to this (assistant) row. */
  toolCallIds: string[];
  /** true once the row is finalized history (moves into the virtualizer). */
  finalized: boolean;
  isOptimistic?: boolean;
  model?: string;
  usage?: unknown;
  stopReason?: string;
  /** raw last-seen message body (for renderers needing extra fields). */
  raw?: OCPlatformMessageData;
  updatedAtMs: number;
}

export interface RunRow {
  runId: string;
  status: RunStatus;
  statusLabel?: string | null;
  startedAtMs?: number | null;
  /** the assistant row key that holds this run's output. */
  assistantKey: RowKey;
}

export interface ToolRow {
  toolCallId: string;
  runId: string | null;
  name: string;
  phase: ToolPhase;
  status: ToolStatus;
  argsMeta?: unknown;
  resultMeta?: unknown;
  awaitingResult?: boolean;
  output?: unknown;
  startedAtMs?: number | null;
  finishedAtMs?: number | null;
  updatedAtMs: number;
}

export interface ChatPagination {
  knownTotalMessages: number;
  oldestLoadedSeq: number | null;
  hasOlder: boolean;
  loadingOlder: boolean;
}

export type ConnState = "idle" | "connecting" | "live" | "reconnecting" | "rebootstrapping";

export interface ChatSessionState {
  sessionKey: string;
  /** last applied patch cursor — the dedupe / ordering guard. */
  cursor: number;
  status: RunOrIdle;
  statusLabel: string | null;
  activeRun: ActiveRunProjection | null;

  /** row keys sorted ascending by seq. */
  order: RowKey[];
  rows: Map<RowKey, MessageRow>;
  runs: Map<string, RunRow>;
  tools: Map<string, ToolRow>;

  // identity indexes
  byMessageId: Map<string, RowKey>;
  byClientId: Map<string, RowKey>;
  byRunId: Map<string, RowKey>;

  /** highest seq seen — used to assign ephemeral seqs to optimistic/live rows. */
  maxSeq: number;

  pagination: ChatPagination;
  conn: ConnState;
}

export function emptyChatState(sessionKey: string): ChatSessionState {
  return {
    sessionKey,
    cursor: 0,
    status: "idle",
    statusLabel: null,
    activeRun: null,
    order: [],
    rows: new Map(),
    runs: new Map(),
    tools: new Map(),
    byMessageId: new Map(),
    byClientId: new Map(),
    byRunId: new Map(),
    maxSeq: 0,
    pagination: {
      knownTotalMessages: 0,
      oldestLoadedSeq: null,
      hasOlder: false,
      loadingOlder: false,
    },
    conn: "idle",
  };
}

/** Shallow clone-on-write: fresh top-level object + fresh Maps + fresh order array. */
export function cloneState(state: ChatSessionState): ChatSessionState {
  return {
    ...state,
    order: state.order.slice(),
    rows: new Map(state.rows),
    runs: new Map(state.runs),
    tools: new Map(state.tools),
    byMessageId: new Map(state.byMessageId),
    byClientId: new Map(state.byClientId),
    byRunId: new Map(state.byRunId),
    pagination: { ...state.pagination },
  };
}

/** Recompute order from rows, sorted by seq asc then key for stability. */
export function reorder(state: ChatSessionState): void {
  state.order = [...state.rows.values()]
    .sort((a, b) => (a.seq - b.seq) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((row) => row.key);
}
