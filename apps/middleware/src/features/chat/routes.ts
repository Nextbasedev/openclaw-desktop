import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

/** Yield control back to the event loop so long imports never block request handling. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../app.js";
import { HttpError } from "../../lib/errors.js";
import { createLogger, errorMeta } from "../../lib/logger.js";
import { cleanMessageDisplayText, messageTextMatchesSent, normalizeHistoryMessages, textFromMessage } from "./message-normalizer.js";
import { classifyGatewayMessageSemanticType, isErrorToolResult, projectGatewayMessage, readToolCallId, readToolName } from "./gateway-event-projector.js";
import { prepareMessageAndAttachments } from "./attachments.js";
import type { RunStatus } from "./repo.runs.js";
import { buildChatBootstrapSnapshot, canonicalPatchPayload } from "./projection.js";
import type { ProjectedRun } from "./repo.runs.js";
import type { OpenClawMessage, ProjectedMessage } from "./types.js";

const bootstrapQuery = z.object({
  sessionKey: z.string().min(1),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  maxChars: z.coerce.number().int().positive().optional(),
});


const STALE_BOOTSTRAP_RUN_MS = 2 * 60 * 1000;
const STALE_BOOTSTRAP_TOOL_MS = 30 * 60 * 1000;
const LOCAL_FIRST_FRESH_MS = 30_000;
const LOCAL_FIRST_SQLITE_MAX_AGE_MS = 5 * 60 * 1000;
const LOCAL_FIRST_BACKGROUND_SYNC_MIN_AGE_MS = 2 * 60 * 1000;
const DEFAULT_CHAT_SEND_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS = DEFAULT_CHAT_SEND_TIMEOUT_MS + 10_000;
const localFirstBootstrapTimestamps = new Map<string, number>();
const localFirstSqliteBlocked = new Set<string>();

/** Clear local-first cache — for test isolation only. */
export function clearLocalFirstBootstrapCache() {
  localFirstBootstrapTimestamps.clear();
  coldBootstrapJobs.clear();
  // Block SQLite-first for all known sessions until next Gateway bootstrap
  // stamps them fresh. This ensures test sequential bootstraps go to Gateway.
  localFirstSqliteBlocked.clear();
  // Mark all as blocked — next Gateway bootstrap will unblock
  localFirstSqliteBlocked.add('*');
}
const MIN_REAL_TIMESTAMP_MS = 1_700_000_000_000;
const ACTIVE_RUN_STATUSES = new Set<RunStatus>(["queued", "thinking", "streaming", "tool_running"]);
const archiveProjectionJobs = new Map<string, Promise<void>>();
// Per-session in-flight dedupe for the cold (non-local-first) bootstrap build.
// Mirrors archiveProjectionJobs so K concurrent first-bootstraps for the same
// huge session collapse into ONE synchronous build instead of K parallel ones.
type ChatBootstrapSnapshot = ReturnType<typeof buildChatBootstrapSnapshot>;
const coldBootstrapJobs = new Map<string, Promise<ChatBootstrapSnapshot>>();


// Hard cap on bytes read for a bounded (maxLines) probe so a multi-MB archive
// file can never be fully slurped just to inspect its first few lines.
const BOUNDED_READ_MAX_BYTES = 512 * 1024;
const BOUNDED_READ_CHUNK = 64 * 1024;

/** Read up to `maxLines` lines without slurping the whole file (streamed, sync). */
function readJsonlLinesBounded(file: string, maxLines: number): string[] {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.allocUnsafe(BOUNDED_READ_CHUNK);
    const decoder = new StringDecoder("utf8");
    const lines: string[] = [];
    let leftover = "";
    let readTotal = 0;
    while (lines.length < maxLines && readTotal < BOUNDED_READ_MAX_BYTES) {
      const bytes = fs.readSync(fd, buffer, 0, BOUNDED_READ_CHUNK, null);
      if (bytes <= 0) break;
      readTotal += bytes;
      const parts = (leftover + decoder.write(buffer.subarray(0, bytes))).split(/\r?\n/);
      leftover = parts.pop() ?? "";
      for (const part of parts) {
        if (part) lines.push(part);
        if (lines.length >= maxLines) break;
      }
    }
    if (lines.length < maxLines) { const tail = (leftover + decoder.end()).trim(); if (tail) lines.push(tail); }
    return lines.slice(0, maxLines);
  } catch { return []; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* noop */ } } }
}

function readJsonlRecords(file: string, maxLines?: number): Record<string, unknown>[] {
  try {
    const lines = typeof maxLines === "number" && maxLines >= 0
      ? readJsonlLinesBounded(file, maxLines)
      : fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean);
    return lines.flatMap((line) => {
      try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; }
    });
  } catch { return []; }
}

function transcriptMessagesFromJsonl(file: string, maxLines?: number): OpenClawMessage[] {
  return readJsonlRecords(file, maxLines)
    .filter((line) => line?.type === "message" || (line.message && typeof line.message === "object"))
    .map((line): OpenClawMessage => {
      const message = (line.message && typeof line.message === "object") ? line.message as OpenClawMessage : line as OpenClawMessage;
      return { ...message, timestamp: message.timestamp ?? line.timestamp, __openclaw: { id: typeof line.id === "string" ? line.id : undefined, seq: typeof line.seq === "number" ? line.seq : undefined } };
    })
    .filter((message) => typeof message.role === "string");
}

function parseJsonBlock(text: string, label: string): Record<string, unknown> | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}:\\s*` + "```json\\s*([\\s\\S]*?)\\s*```", "i"));
  if (!match) return null;
  try { return JSON.parse(match[1] || "") as Record<string, unknown>; } catch { return null; }
}

function identityFromSessionKey(sessionKey: string) {
  const parts = sessionKey.split(":");
  const channel = parts[2];
  if (channel === "telegram") {
    const kind = parts[3];
    const chatId = parts[4];
    const topicId = parts[5] === "topic" && parts[6] ? parts[6] : null;
    if ((kind === "group" || kind === "channel" || kind === "direct" || kind === "private") && chatId) {
      return { kind: "conversation" as const, channel: "telegram", chatId, topicId };
    }
  }
  return sessionKey.includes(":desktop:") ? { kind: "desktop" as const, senderId: "openclaw-control-ui", desktopOnly: true } : null;
}

function firstHistoryIdentity(messages: unknown[], sessionKey: string) {
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const text = textFromMessage(message as OpenClawMessage);
    const conversation = parseJsonBlock(text, "Conversation info (untrusted metadata)");
    if (conversation) {
      const chatId = String(conversation.chat_id || "").replace(/^telegram:/, "").trim();
      const topicId = conversation.topic_id === undefined || conversation.topic_id === null ? null : String(conversation.topic_id);
      if (chatId) return { kind: "conversation", channel: String(conversation.chat_id || "").startsWith("telegram:") ? "telegram" : "unknown", chatId, topicId };
    }
    const sender = parseJsonBlock(text, "Sender (untrusted metadata)");
    if (sender) {
      const senderId = String(sender.id || sender.username || sender.name || "").trim();
      if (senderId) return { kind: "sender", senderId, desktopOnly: sessionKey.includes(":desktop:") };
    }
  }
  return identityFromSessionKey(sessionKey);
}

function identitiesMatch(a: ReturnType<typeof firstHistoryIdentity>, b: ReturnType<typeof firstHistoryIdentity>) {
  if (!a || !b) return false;
  if (a.kind === "conversation" || b.kind === "conversation") {
    return a.kind === "conversation" && b.kind === "conversation" && a.channel === b.channel && a.chatId === b.chatId && (a.topicId ?? null) === (b.topicId ?? null);
  }
  if ((a.kind === "sender" || a.kind === "desktop") && (b.kind === "sender" || b.kind === "desktop")) {
    // Desktop sessions with a human senderId (numeric) should NOT match other
    // sessions by sender alone — multiple desktop chats share the same human sender.
    // Only match when the senderId is a service/bot identity (non-numeric).
    if (a.desktopOnly && b.desktopOnly && /^\d+$/.test(a.senderId)) return false;
    return a.senderId === b.senderId && Boolean(a.desktopOnly) === Boolean(b.desktopOnly);
  }
  return false;
}

function archiveSessionIdFromFile(file: string) {
  const match = path.basename(file).match(/^(.*?)\.jsonl\.(?:reset|deleted)\.\d{4}-\d{2}-\d{2}T/);
  return match?.[1] || null;
}

function agentIdFromSessionKey(sessionKey: string) {
  const match = sessionKey.match(/^agent:([^:]+):/);
  return match?.[1] || "main";
}

async function archivedHistoryTranscriptFiles(params: { sessionKey: string; sessionId?: string | null; sessionFile?: string | null; messages: unknown[] }): Promise<string[]> {
  if (!params.sessionFile && params.messages.length === 0) return [];
  const current = params.sessionFile ? path.resolve(params.sessionFile) : "";
  const agentId = agentIdFromSessionKey(params.sessionKey);
  const sessionsDir = current ? path.dirname(current) : path.join(os.homedir(), ".openclaw", "agents", agentId, "sessions");
  const candidateDirs = Array.from(new Set([sessionsDir, path.join(sessionsDir, "archive"), path.join(sessionsDir, "archives")].map((dir) => path.resolve(dir))));
  const currentIdentity = firstHistoryIdentity(params.messages, params.sessionKey);
  const archiveSuffixRe = /\.jsonl\.(?:reset|deleted)\.\d{4}-\d{2}-\d{2}T/;
  const candidates = candidateDirs.flatMap((dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(dir, entry.name));
    } catch { return [] as string[]; }
  }).filter((file) => archiveSuffixRe.test(path.basename(file)) && path.resolve(file) !== current);

  // Identity-match per file, yielding to the event loop so scanning a large
  // archive corpus (hundreds of files) never blocks request handling.
  const matched: string[] = [];
  let scanned = 0;
  for (const file of candidates) {
    const archivedSessionId = archiveSessionIdFromFile(file);
    let keep: boolean;
    if (params.sessionId && archivedSessionId === params.sessionId && !current) keep = true;
    else if (!currentIdentity) keep = params.sessionId ? archivedSessionId === params.sessionId : false;
    else keep = identitiesMatch(currentIdentity, firstHistoryIdentity(transcriptMessagesFromJsonl(file, 80), params.sessionKey));
    if (keep) matched.push(file);
    if (++scanned % 25 === 0) await yieldToEventLoop();
  }

  return matched.sort((a, b) => {
    const aMs = fs.statSync(a, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    const bMs = fs.statSync(b, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    return aMs - bMs || a.localeCompare(b);
  });
}

function cleanSerializedMessageData(data: Record<string, unknown>, role: string) {
  if (role !== "user") return data;
  const next = { ...data };
  if (typeof next.text === "string") next.text = cleanMessageDisplayText(next.text);
  if (typeof next.content === "string") next.content = cleanMessageDisplayText(next.content);
  if (Array.isArray(next.content)) {
    next.content = next.content.map((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block) || typeof (block as Record<string, unknown>).text !== "string") return block;
      return { ...block, text: cleanMessageDisplayText((block as Record<string, unknown>).text as string) };
    });
  }
  return next;
}

function serializeProjectedMessage(message: ProjectedMessage) {
  const data = message.data && typeof message.data === "object" && !Array.isArray(message.data)
    ? message.data
    : {};
  const role = typeof data.role === "string" ? data.role : message.role ?? "assistant";
  const cleanedData = cleanSerializedMessageData(data, role);
  const existingOpenClaw: Record<string, unknown> = cleanedData.__openclaw && typeof cleanedData.__openclaw === "object" && !Array.isArray(cleanedData.__openclaw)
    ? cleanedData.__openclaw as Record<string, unknown>
    : {};
  return {
    ...cleanedData,
    role,
    messageId: typeof cleanedData.messageId === "string" ? cleanedData.messageId : message.messageId ?? undefined,
    __openclaw: {
      ...existingOpenClaw,
      id: typeof existingOpenClaw.id === "string" ? existingOpenClaw.id : message.messageId ?? undefined,
      seq: message.openclawSeq,
      gatewaySeq: message.gatewaySeq ?? (typeof existingOpenClaw.seq === "number" ? existingOpenClaw.seq : null),
      segmentId: message.segmentId ?? null,
    },
  } as OpenClawMessage;
}

async function persistArchivedHistorySegments(context: AppContext, sessionKey: string, history: ChatHistoryResponse) {
  const archivedFiles = await archivedHistoryTranscriptFiles({
    sessionKey,
    sessionId: history.sessionId ?? null,
    sessionFile: typeof history.sessionFile === "string" ? history.sessionFile : null,
    messages: history.messages ?? [],
  });
  let upserted = 0;
  let importedFiles = 0;
  let skippedFiles = 0;
  let changedFiles = 0;
  let processed = 0;
  for (const file of archivedFiles) {
    const archivedSessionId = archiveSessionIdFromFile(file);
    if (archivedSessionId && archivedSessionId === history.sessionId && history.sessionFile) continue;
    const archiveStat = fs.statSync(file, { throwIfNoEntry: false });
    if (!archiveStat) continue;
    const filePath = path.resolve(file);
    const fileMtimeMs = Math.round(archiveStat.mtimeMs);
    const fileSize = archiveStat.size;
    const existingSegment = context.messages.getSegmentForTranscript({ sessionKey, sessionId: archivedSessionId, sessionFile: filePath, active: false });
    const existingImport = context.messages.archiveImportForFile({ sessionKey, filePath });
    if (existingImport && existingImport.fileMtimeMs === fileMtimeMs && existingImport.fileSize === fileSize && existingSegment && context.messages.messageCountForSegment(existingSegment.segmentId) >= existingImport.messageCount) {
      skippedFiles += 1;
      continue;
    }
    const existingMessageCount = existingSegment ? context.messages.messageCountForSegment(existingSegment.segmentId) : 0;
    if (!existingImport && existingSegment && existingMessageCount > 0) {
      context.messages.recordArchiveImport({ sessionKey, filePath, fileMtimeMs, fileSize, segmentId: existingSegment.segmentId, messageCount: existingMessageCount });
      skippedFiles += 1;
      continue;
    }
    const archivedMessages = transcriptMessagesFromJsonl(file);
    if (archivedMessages.length === 0) continue;
    const segment = context.messages.ensureArchivedSegment({ sessionKey, sessionId: archivedSessionId, sessionFile: filePath, resetReason: "archived_transcript", startedAtMs: fileMtimeMs });
    const staleImport = existingImport;
    if (staleImport) context.messages.deleteMessagesForSegment(segment.segmentId);
    const normalized = normalizeHistoryMessages(sessionKey, archivedMessages);
    const importBaseSeq = staleImport ? context.messages.nextMessageSeq(sessionKey) - 1 : segment.baseSeq;
    upserted += context.messages.upsertMessages(normalized, { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: importBaseSeq }).upserted;
    context.messages.recordArchiveImport({ sessionKey, filePath, fileMtimeMs, fileSize, segmentId: segment.segmentId, messageCount: normalized.length });
    importedFiles += 1;
    if (staleImport) changedFiles += 1;
    // Yield between (potentially large) file imports so a big corpus can't
    // monopolise the event loop on a cold cache.
    if (++processed % 3 === 0) await yieldToEventLoop();
  }
  return { fileCount: archivedFiles.length, importedFiles, skippedFiles, changedFiles, upserted, changed: importedFiles > 0 || changedFiles > 0 };
}

function lastMessageIsAssistantText(messages: unknown[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const data = message as Record<string, unknown>;
    const role = typeof data.role === "string" ? data.role : null;
    const text = textFromMessage(data).trim();
    if (!role && !text) continue;
    return projectGatewayMessage(data).assistantHasFinalText;
  }
  return false;
}

/** Returns true if there's any assistant message with text after the last user message. */
function hasAssistantResponseAfterLastUser(messages: unknown[]) {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
    const data = msg as Record<string, unknown>;
    if (data.role === "user") { lastUserIndex = i; break; }
  }
  if (lastUserIndex < 0) return false;
  for (let i = lastUserIndex + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
    const data = msg as Record<string, unknown>;
    if (data.role === "assistant" && textFromMessage(data).trim().length > 0) return true;
  }
  return false;
}

function safeResultMeta(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if ((parsed && typeof parsed === "object") || Array.isArray(parsed)) return safeResultMeta(parsed, depth + 1);
      } catch {
        // Fall through to preserving the raw string output.
      }
    }
    return value.length > 20_000 ? `${value.slice(0, 20_000)}\n…[truncated ${value.length - 20_000} chars]` : value;
  }
  if (Array.isArray(value)) {
    if (depth >= 4) return { type: "array", length: value.length };
    return value.slice(0, 50).map((item) => safeResultMeta(item, depth + 1));
  }
  if (value && typeof value === "object") {
    if (depth >= 4) return { type: "object", keys: Object.keys(value as Record<string, unknown>).slice(0, 20) };
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      result[key] = safeResultMeta(child, depth + 1);
    }
    return result;
  }
  return value;
}

function historyTimestampMs(message: Record<string, unknown>): number | null {
  const raw = message.timestamp;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Gateway history has used both epoch seconds and epoch milliseconds.
    // Store only real epoch-ms values in the projection DB; otherwise the UI
    // computes Date.now() - startedAt and renders huge fake durations.
    return raw > 100_000_000 && raw < 10_000_000_000 ? Math.round(raw * 1000) : Math.round(raw);
  }
  const createdAt = message.createdAt;
  if (typeof createdAt === "string" && createdAt.trim()) {
    const parsed = Date.parse(createdAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function oldestRunningToolAgeMs(context: AppContext, sessionKey: string, runId: string) {
  const startedAtMs = context.runs
    .listRunningToolCalls(sessionKey, runId)
    .map((tool) => tool.startedAtMs)
    .filter((value) => Number.isFinite(value) && value >= MIN_REAL_TIMESTAMP_MS);
  if (startedAtMs.length === 0) return null;
  return Math.max(0, Date.now() - Math.min(...startedAtMs));
}

type InferredToolResult = {
  status: "success" | "error";
  finishedAtMs: number | null;
  resultMeta: unknown;
};

type ToolResultIndex = {
  /** First forward index of a tool-role result message carrying this toolCallId. */
  idResultIndex: Map<string, number>;
  /** Per-index parsed tool-role result info (null when not a tool-role message). */
  resultInfo: Array<InferredToolResult | null>;
  /** Suffix array: nearest index >= i that is an id-less tool result OR assistant-final. */
  nextStopAtOrAfter: Int32Array;
  /** historyTimestampMs per message index. */
  finishedAtMs: Array<number | null>;
};

/**
 * Single forward pass that replaces the old O(n) per-tool `inferToolResultFromHistory`
 * scan with O(1) lookups. For 600+ tools over thousands of messages this turns the
 * old O(n²) into O(n). Yields every ~25 messages so a huge history can't freeze the loop.
 */
async function buildToolResultIndex(messages: unknown[]): Promise<ToolResultIndex> {
  const n = messages.length;
  const idResultIndex = new Map<string, number>();
  const resultInfo: Array<InferredToolResult | null> = new Array(n).fill(null);
  const finishedAtMs: Array<number | null> = new Array(n).fill(null);
  const isStop: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i += 1) {
    const message = messages[i];
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const data = message as Record<string, unknown>;
    finishedAtMs[i] = historyTimestampMs(data);
    if (data.role === "tool" || data.role === "tool_result" || data.role === "toolResult") {
      const resultToolCallId = readToolCallId(data);
      const resultMeta = safeResultMeta(data.result ?? data.output ?? data.text ?? data.content ?? data.message ?? data.value);
      resultInfo[i] = {
        status: isErrorToolResult(resultMeta) ? "error" : "success",
        finishedAtMs: finishedAtMs[i],
        resultMeta,
      };
      if (resultToolCallId) {
        if (!idResultIndex.has(resultToolCallId)) idResultIndex.set(resultToolCallId, i);
      } else {
        // Id-less tool result — matches the next tool call forward (original behavior).
        isStop[i] = true;
      }
    } else if (projectGatewayMessage(data).assistantHasFinalText) {
      isStop[i] = true;
    }
    if (i % 25 === 24) await yieldToEventLoop();
  }
  const nextStopAtOrAfter = new Int32Array(n + 1).fill(-1);
  for (let i = n - 1; i >= 0; i -= 1) {
    nextStopAtOrAfter[i] = isStop[i] ? i : nextStopAtOrAfter[i + 1];
  }
  return { idResultIndex, resultInfo, nextStopAtOrAfter, finishedAtMs };
}

/** O(1) replacement for the forward scan: nearest of {matching-id result, id-less result, assistant-final}. */
function resolveInferredToolResult(index: ToolResultIndex, messageIndex: number, toolCallId: string): InferredToolResult | null {
  const idIdxRaw = index.idResultIndex.get(toolCallId);
  const idIdx = idIdxRaw !== undefined && idIdxRaw > messageIndex ? idIdxRaw : -1;
  const stopIdxRaw = messageIndex + 1 < index.nextStopAtOrAfter.length ? index.nextStopAtOrAfter[messageIndex + 1] : -1;
  const stopIdx = stopIdxRaw;
  if (idIdx >= 0 && (stopIdx < 0 || idIdx <= stopIdx)) {
    return index.resultInfo[idIdx];
  }
  if (stopIdx >= 0) {
    const info = index.resultInfo[stopIdx];
    if (info) return info; // id-less tool result
    // assistant-final fallback
    return { status: "success", finishedAtMs: index.finishedAtMs[stopIdx], resultMeta: undefined };
  }
  return null;
}

async function inferBootstrapToolCalls(context: AppContext, sessionKey: string, messages: unknown[], run: ProjectedRun | null, completed: boolean) {
  let inferred = 0;
  const index = await buildToolResultIndex(messages);
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const data = message as Record<string, unknown>;
    if (data.role !== "assistant") continue;
    const openclaw = objectData(data.__openclaw);
    const messageId = typeof openclaw.id === "string" ? openclaw.id : typeof data.id === "string" ? data.id : typeof data.messageId === "string" ? data.messageId : null;
    for (const toolEvent of projectGatewayMessage(data).toolEvents) {
      if (toolEvent.phase !== "calling" && toolEvent.phase !== "start") continue;
      const toolCallId = toolEvent.toolCallId;
      const name = toolEvent.name;
      if (!toolCallId || !name) continue;
      const existingTool = context.runs.getToolCall(sessionKey, toolCallId);
      if (existingTool?.runId && existingTool.runId !== run?.runId) continue;
      // Do not adopt old detached tool rows into a newly active run during
      // bootstrap. Old middleware versions persisted some inferred tools without
      // a run_id; if those rows are replayed after a fresh user send, assigning
      // them to the current run resurrects ancient tool cards as live activity.
      if (existingTool && !existingTool.runId && run && existingTool.startedAtMs < run.startedAtMs - 1000) continue;
      const result = resolveInferredToolResult(index, messageIndex, toolCallId) ?? (completed
        ? { status: "success" as const, finishedAtMs: historyTimestampMs(data), resultMeta: undefined }
        : null);
      context.runs.upsertToolCall({
        sessionKey,
        toolCallId,
        runId: run?.runId ?? null,
        messageId,
        name,
        phase: result ? "result" : "calling",
        status: result?.status,
        argsMeta: toolEvent.args,
        resultMeta: result?.resultMeta,
        startedAtMs: historyTimestampMs(data) ?? undefined,
        finishedAtMs: result?.finishedAtMs ?? undefined,
      });
      inferred += 1;
    }
    if (messageIndex % 25 === 24) await yieldToEventLoop();
  }
  return inferred;
}

type ChatHistoryResponse = {
  sessionKey?: string;
  sessionId?: string;
  sessionFile?: string;
  messages?: unknown[];
  status?: string;
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
};

function objectData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function attachmentMetadata(raw: unknown) {
  if (!Array.isArray(raw)) return { count: 0 };
  return {
    count: raw.length,
    items: raw.slice(0, 20).map((item) => {
      const attachment = objectData(item);
      return {
        name: typeof attachment.name === "string" ? attachment.name.slice(0, 200) : undefined,
        mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType : undefined,
        size: typeof attachment.size === "number" ? attachment.size : undefined,
        hasContent: typeof attachment.content === "string" && attachment.content.length > 0,
      };
    }),
  };
}

function isTerminalSendStatus(status: unknown) {
  return typeof status === "string" && ["done", "complete", "completed", "success", "succeeded", "finished"].includes(status.trim().toLowerCase());
}

function assistantHasVisibleAnswer(message: ProjectedMessage) {
  if (message.role !== "assistant") return false;
  return cleanMessageDisplayText(textFromMessage(message.data)).trim().length > 0;
}

function gatewaySendCompleted(_result: Record<string, unknown>, currentHistory: { currentUserRepresented: boolean; assistantAfterCurrentUser: boolean } | null) {
  // Gateway chat.send can return a terminal status before the final assistant
  // message has reached chat.history/session.message. Do not broadcast done until
  // the current user echo and a visible assistant answer after it are both projected.
  // Otherwise the UI briefly hides Thinking, jumps the list, then receives the
  // answer a few seconds later.
  return Boolean(currentHistory?.currentUserRepresented && currentHistory.assistantAfterCurrentUser);
}

function localRunId(idempotencyKey: string) {
  return `run:${idempotencyKey}`;
}

function runStatusFromGateway(status: unknown): RunStatus | null {
  if (typeof status !== "string") return null;
  const normalized = status.trim().toLowerCase();
  if (["done", "complete", "completed", "success", "succeeded", "finished"].includes(normalized)) return "done";
  if (["error", "failed", "failure"].includes(normalized)) return "error";
  if (["aborted", "abort", "cancelled", "canceled"].includes(normalized)) return "aborted";
  if (["streaming"].includes(normalized)) return "streaming";
  if (["queued", "pending"].includes(normalized)) return "queued";
  if (["started", "running", "thinking", "accepted"].includes(normalized)) return "thinking";
  return null;
}

function nowMs() {
  return Date.now();
}

function elapsedMs(startedAtMs: number) {
  return Math.max(0, Date.now() - startedAtMs);
}

function messageFactorSummary(messages: unknown[]) {
  let assistantCount = 0;
  let userCount = 0;
  let toolResultCount = 0;
  let toolCallCount = 0;
  let lastRole: string | null = null;
  for (const raw of messages) {
    const message = objectData(raw);
    const role = typeof message.role === "string" ? message.role : "unknown";
    lastRole = role;
    if (role === "assistant") assistantCount += 1;
    else if (role === "user") userCount += 1;
    else if (role === "tool" || role === "tool_result" || role === "toolResult") toolResultCount += 1;
    toolCallCount += projectGatewayMessage(message).toolEvents.filter((event) => event.phase === "calling" || event.phase === "start").length;
  }
  return {
    total: messages.length,
    userCount,
    assistantCount,
    toolCallCount,
    toolResultCount,
    lastRole,
  };
}

const execPolicyBody = z.union([
  z.null(),
  z.object({
    security: z.enum(["allowlist", "full"]).optional(),
    ask: z.enum(["off", "on-miss", "always"]).optional(),
  }).strict(),
]);

const sendBody = z.object({
  sessionKey: z.string().min(1),
  text: z.string().optional(),
  message: z.string().optional(),
  attachments: z.unknown().optional(),
  modelId: z.string().min(1).optional().nullable(),
  idempotencyKey: z.string().min(1),
  clientMessageId: z.string().min(1).optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
  agentId: z.string().optional(),
  label: z.string().optional(),
  execPolicy: execPolicyBody.optional(),
  replyTo: z.unknown().optional(),
  autonomyMode: z.unknown().optional(),
}).passthrough();

const approvalResolveBody = z.object({
  approvalId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  decision: z.enum(["allow-once", "allow-always", "deny"]),
});

function isMissingApprovalError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /approval/i.test(message) && /(not found|missing|unknown|no pending|no such)/i.test(message);
}

/**
 * Pre-warm archived history for a session so the first bootstrap doesn't
 * block on importing archive files. Call after telegram/discord import.
 */
export async function prewarmArchivedHistory(context: AppContext, sessionKey: string) {
  try {
    const history = await context.gateway.request<ChatHistoryResponse>("chat.history", { sessionKey, limit: 200 }, 10_000);
    if (!history) return { ok: false, reason: "no-history" };
    const result = await persistArchivedHistorySegments(context, sessionKey, history);
    return { ok: true, ...result };
  } catch {
    return { ok: false, reason: "error" };
  }
}

function scheduleArchivedHistoryProjection(params: {
  context: AppContext;
  log: ReturnType<typeof createLogger>;
  sessionKey: string;
  history: ChatHistoryResponse;
}) {
  const existing = archiveProjectionJobs.get(params.sessionKey);
  if (existing) {
    params.log.info("bootstrap.archived-history.schedule.skip", { sessionKey: params.sessionKey, reason: "already-running" });
    return existing;
  }
  const job = new Promise<void>((resolve, reject) => {
    setImmediate(async () => {
      try {
        if (!params.context.db.open) {
          resolve();
          return;
        }
        const startedAtMs = nowMs();
        params.log.info("bootstrap.archived-history.background.start", { sessionKey: params.sessionKey });
        const archivedProjection = await persistArchivedHistorySegments(params.context, params.sessionKey, params.history);
        if (archivedProjection.fileCount > 0) {
          params.log.info("bootstrap.archived-history.persist", {
            sessionKey: params.sessionKey,
            archivedFiles: archivedProjection.fileCount,
            importedFiles: archivedProjection.importedFiles,
            skippedFiles: archivedProjection.skippedFiles,
            changedFiles: archivedProjection.changedFiles,
            upserted: archivedProjection.upserted,
            background: true,
          });
        }
        const resequence = archivedProjection.changed
          ? params.context.messages.resequenceSessionMessages(params.sessionKey)
          : { changedMessages: 0, changedSegments: 0 };
        if (resequence.changedMessages > 0 || resequence.changedSegments > 0) {
          params.log.info("bootstrap.messages.resequence", {
            sessionKey: params.sessionKey,
            changedMessages: resequence.changedMessages,
            changedSegments: resequence.changedSegments,
            background: true,
          });
        }
        // Broadcast a bootstrap-refresh event so the UI knows archived
        // messages are now available and can refetch/update the chat.
        if (archivedProjection.changed && params.context.db.open) {
          const projectedMessages = params.context.messages.listMessages(params.sessionKey, { limit: 1000, latest: true });
          const refreshEvent = params.context.messages.appendProjectionEvent({
            sessionKey: params.sessionKey,
            eventType: "chat.bootstrap",
            payload: { sessionKey: params.sessionKey, messageCount: projectedMessages.length, backgroundArchiveImport: true },
          });
          params.context.patchBus.broadcast({
            cursor: refreshEvent.cursor,
            type: refreshEvent.eventType,
            sessionKey: refreshEvent.sessionKey,
            payload: refreshEvent.payload,
            createdAtMs: refreshEvent.createdAtMs,
          });
          params.log.info("bootstrap.archived-history.background.broadcast", {
            sessionKey: params.sessionKey,
            cursor: refreshEvent.cursor,
            messageCount: projectedMessages.length,
          });
        }
        params.log.info("bootstrap.archived-history.background.end", {
          sessionKey: params.sessionKey,
          durationMs: elapsedMs(startedAtMs),
          changed: archivedProjection.changed,
          importedFiles: archivedProjection.importedFiles,
          changedFiles: archivedProjection.changedFiles,
          upserted: archivedProjection.upserted,
          resequencedMessages: resequence.changedMessages,
          resequencedSegments: resequence.changedSegments,
        });
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }).catch((error) => {
    params.log.warn("bootstrap.archived-history.background.fail", {
      sessionKey: params.sessionKey,
      error: errorMeta(error),
    });
  }).finally(() => {
    if (archiveProjectionJobs.get(params.sessionKey) === job) archiveProjectionJobs.delete(params.sessionKey);
  });
  archiveProjectionJobs.set(params.sessionKey, job);
  return job;
}

export async function registerChatRoutes(app: FastifyInstance, context: AppContext) {
  const log = createLogger("chat-route");

  app.post("/api/exec/approval/resolve", async (request) => {
    const parsed = approvalResolveBody.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid approval resolve body", "INVALID_BODY", parsed.error.flatten());
    }
    const approvalId = parsed.data.approvalId ?? parsed.data.id;
    if (!approvalId) throw new HttpError(400, "approvalId is required", "BAD_REQUEST");
    log.info("approval.resolve.start", { approvalId, decision: parsed.data.decision });
    try {
      const result = await context.gateway.request<Record<string, unknown>>("exec.approval.resolve", {
        id: approvalId,
        decision: parsed.data.decision,
      }, 30_000);
      log.info("approval.resolve.end", { approvalId, decision: parsed.data.decision });
      return { ok: true, approvalId, decision: parsed.data.decision, ...result };
    } catch (error) {
      if (isMissingApprovalError(error)) {
        throw new HttpError(404, "Approval request not found", "APPROVAL_NOT_FOUND", { approvalId });
      }
      throw error;
    }
  });

  // Backward-compatible aliases for old clients
  app.post("/api/chat/message", async (request, reply) => {
    const response = await (app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: request.body as string | Buffer | object | undefined,
      headers: request.headers,
    }) as unknown as Promise<{ statusCode: number; json(): unknown }>);
    reply.code(response.statusCode).send(response.json());
  });

  app.post("/api/v1/chat/message", async (request, reply) => {
    const response = await (app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: request.body as string | Buffer | object | undefined,
      headers: request.headers,
    }) as unknown as Promise<{ statusCode: number; json(): unknown }>);
    reply.code(response.statusCode).send(response.json());
  });

  app.post("/api/chat/send", async (request) => {
    const parsed = sendBody.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid chat send body", "INVALID_BODY", parsed.error.flatten());
    }
    const input = parsed.data;
    const sendStartedAtMs = nowMs();
    const rawMessage = input.text ?? input.message ?? "";
    if (!rawMessage.trim()) throw new HttpError(400, "message is required", "BAD_REQUEST");
    log.info("send.start", {
      requestId: request.id,
      sessionKey: input.sessionKey,
      idempotencyKey: input.idempotencyKey,
      clientMessageId: input.clientMessageId,
      hasText: rawMessage.trim().length > 0,
      attachments: attachmentMetadata(input.attachments),
      hasExecPolicy: input.execPolicy !== undefined,
      agentId: input.agentId || "main",
    });

    const existingLocalSession = context.messages.getSession(input.sessionKey);
    if (existingLocalSession?.sessionId) {
      log.info("session.create.skip-existing", { sessionKey: input.sessionKey, sessionId: existingLocalSession.sessionId });
    } else {
      const sessionCreateStartedAtMs = nowMs();
      log.info("session.create.start", { sessionKey: input.sessionKey, agentId: input.agentId || "main", hasLabel: Boolean(input.label) });
      const gatewayLabel = (() => {
        const base = String(input.label || "New Chat").replace(/\s+/g, " ").trim().slice(0, 60) || "New Chat";
        const suffix = (input.sessionKey.split(":").pop() || input.sessionKey).replace(/[^a-zA-Z0-9_-]/g, "").slice(-8) || Date.now().toString(36);
        return `${base} \u00b7 ${suffix}`;
      })();
      await context.gateway.request("sessions.create", {
        key: input.sessionKey,
        agentId: input.agentId || "main",
        label: gatewayLabel,
      }).then(() => {
        log.info("session.create.end", { sessionKey: input.sessionKey, durationMs: elapsedMs(sessionCreateStartedAtMs) });
      }).catch((error) => {
        log.warn("session.create.fail_ignored", { sessionKey: input.sessionKey, ...errorMeta(error) });
        return null;
      });
    }

    if (input.execPolicy !== undefined) {
      const patch = input.execPolicy === null
        ? { key: input.sessionKey, execSecurity: null, execAsk: null }
        : {
            key: input.sessionKey,
            ...(input.execPolicy.security !== undefined ? { execSecurity: input.execPolicy.security } : {}),
            ...(input.execPolicy.ask !== undefined ? { execAsk: input.execPolicy.ask } : {}),
          };
      log.info("session.patch.start", {
        sessionKey: input.sessionKey,
        hasExecSecurity: Object.prototype.hasOwnProperty.call(patch, "execSecurity"),
        hasExecAsk: Object.prototype.hasOwnProperty.call(patch, "execAsk"),
        clearingPolicy: input.execPolicy === null,
      });
      await context.gateway.request("sessions.patch", patch);
      log.info("session.patch.end", { sessionKey: input.sessionKey });
    }

    log.info("send.accept.start", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, elapsedSinceRequestMs: elapsedMs(sendStartedAtMs) });
    const subscribeStartedAtMs = nowMs();
    await context.chatLive.ensureSessionSubscribed(input.sessionKey);
    log.info("send.factor.subscribe.ready", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, durationMs: elapsedMs(subscribeStartedAtMs), elapsedSinceRequestMs: elapsedMs(sendStartedAtMs) });

    const prepared = prepareMessageAndAttachments(rawMessage, input.attachments);
    log.info("send.prepared", {
      sessionKey: input.sessionKey,
      idempotencyKey: input.idempotencyKey,
      hasMessage: prepared.message.trim().length > 0,
      gatewayAttachmentCount: prepared.attachments?.length ?? 0,
      sourceAttachments: attachmentMetadata(input.attachments),
    });
    const nowIso = new Date().toISOString();
    const runId = localRunId(input.idempotencyKey);
    const clientMessageId = input.clientMessageId || `client:${input.idempotencyKey}`;
    context.runs.upsertRun({
      runId,
      sessionKey: input.sessionKey,
      clientMessageId,
      idempotencyKey: input.idempotencyKey,
      status: "thinking",
      statusLabel: "Thinking",
      startedAtMs: sendStartedAtMs,
      updatedAtMs: Date.now(),
    });
    const optimisticRun = context.runs.getRun(runId);
    const clientMessage = {
      role: "user",
      text: prepared.message,
      createdAt: nowIso,
      isOptimistic: true,
      __clientOptimistic: true,
      __openclaw: {
        id: clientMessageId,
        clientMessageId,
        idempotencyKey: input.idempotencyKey,
        runId,
      },
    };
    context.chatLive.addOptimisticUser(input.sessionKey, {
      id: clientMessage.__openclaw.id,
      text: prepared.message,
      runId,
      idempotencyKey: input.idempotencyKey,
    });
    const optimisticCreatedAtMs = Date.now();
    const optimisticSeq = context.messages.nextMessageSeq(input.sessionKey);
    context.messages.insertOptimisticMessage({
      sessionKey: input.sessionKey,
      openclawSeq: optimisticSeq,
      messageId: clientMessage.__openclaw.id,
      role: "user",
      data: clientMessage,
      updatedAtMs: optimisticCreatedAtMs,
    });
    context.compat?.touchChatActivity({
      sessionKey: input.sessionKey,
      at: nowIso,
      lastMessageText: prepared.message,
    });
    log.info("message.persist.optimistic", { sessionKey: input.sessionKey, messageId: clientMessage.__openclaw.id, messageSeq: optimisticSeq, role: "user" });
    const event = context.messages.appendProjectionEvent({
      sessionKey: input.sessionKey,
      eventType: "chat.message.upsert",
      payload: canonicalPatchPayload({
        sessionKey: input.sessionKey,
        semanticType: "chat.user.created",
        run: optimisticRun,
        messageId: clientMessage.__openclaw.id,
        payload: {
          sessionKey: input.sessionKey,
          message: clientMessage,
          optimistic: true,
          idempotencyKey: input.idempotencyKey,
          runId,
        },
      }),
    });
    context.patchBus.broadcast({
      cursor: event.cursor,
      type: event.eventType,
      sessionKey: event.sessionKey,
      payload: event.payload,
      createdAtMs: event.createdAtMs,
    });
    log.info("patch.broadcast", { sessionKey: input.sessionKey, type: event.eventType, cursor: event.cursor, optimistic: true });
    const existingSession = context.messages.getSession(input.sessionKey);
    context.messages.upsertSession({
      sessionKey: input.sessionKey,
      sessionId: existingSession?.sessionId ?? null,
      data: {
        ...objectData(existingSession?.data),
        sessionKey: input.sessionKey,
        sessionId: existingSession?.sessionId ?? null,
        status: "running",
        statusLabel: "Thinking",
        lastActiveAt: nowIso,
        lastMessageAt: nowIso,
        lastMessageText: prepared.message,
      },
      updatedAtMs: optimisticCreatedAtMs,
    });
    log.info("session.status.persist", { sessionKey: input.sessionKey, sessionId: existingSession?.sessionId ?? null, status: "running", statusLabel: "Thinking" });
    const statusEvent = context.messages.appendProjectionEvent({
      sessionKey: input.sessionKey,
      eventType: "chat.status",
      payload: canonicalPatchPayload({
        sessionKey: input.sessionKey,
        semanticType: "chat.run.status",
        run: optimisticRun,
        legacyStatus: "thinking",
        legacyStatusLabel: "Thinking",
        payload: {
          sessionKey: input.sessionKey,
          status: "thinking",
          statusLabel: "Thinking",
          optimistic: true,
          idempotencyKey: input.idempotencyKey,
          runId,
        },
      }),
    });
    context.patchBus.broadcast({
      cursor: statusEvent.cursor,
      type: statusEvent.eventType,
      sessionKey: statusEvent.sessionKey,
      payload: statusEvent.payload,
      createdAtMs: statusEvent.createdAtMs,
    });
    log.info("status.broadcast", { sessionKey: input.sessionKey, type: statusEvent.eventType, cursor: statusEvent.cursor, status: "thinking", idempotencyKey: input.idempotencyKey });


    void context.sendQueue.run(input.sessionKey, async () => {
      log.info("send.queue.enter", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, elapsedSinceRequestMs: elapsedMs(sendStartedAtMs), accepted: true });
          try {
            const gatewaySendStartedAtMs = nowMs();
            log.info("gateway.chat.send.start", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, gatewayAttachmentCount: prepared.attachments?.length ?? 0, elapsedSinceRequestMs: elapsedMs(sendStartedAtMs) });
            const result = await context.gateway.request<Record<string, unknown>>("chat.send", {
              sessionKey: input.sessionKey,
              message: prepared.message,
              timeoutMs: input.timeoutMs || DEFAULT_CHAT_SEND_TIMEOUT_MS,
              idempotencyKey: input.idempotencyKey,
              ...(prepared.attachments ? { attachments: prepared.attachments } : {}),
            }, input.timeoutMs || DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS);
            log.info("gateway.chat.send.end", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, durationMs: elapsedMs(gatewaySendStartedAtMs), elapsedSinceRequestMs: elapsedMs(sendStartedAtMs), status: typeof result.status === "string" ? result.status : undefined, runId: typeof result.runId === "string" ? result.runId : undefined });
            const gatewayRunId = typeof result.runId === "string" && result.runId.trim() ? result.runId.trim() : null;
            const gatewayRunStatus = runStatusFromGateway(result.status) ?? "thinking";
            const projectedRunStatus = gatewayRunStatus === "done" ? "thinking" : gatewayRunStatus;
            context.runs.upsertRun({
              runId,
              sessionKey: input.sessionKey,
              clientMessageId,
              idempotencyKey: input.idempotencyKey,
              gatewayRunId,
              status: projectedRunStatus,
              statusLabel: projectedRunStatus === "thinking" ? "Thinking" : null,
              startedAtMs: sendStartedAtMs,
              finishedAtMs: ["error", "aborted"].includes(projectedRunStatus) ? Date.now() : null,
              updatedAtMs: Date.now(),
            });

            const historyLoadStartedAtMs = nowMs();
            log.info("gateway.history.load.start", { sessionKey: input.sessionKey, limit: 200, elapsedSinceRequestMs: elapsedMs(sendStartedAtMs) });
            const history = await context.gateway.request<ChatHistoryResponse>("chat.history", {
              sessionKey: input.sessionKey,
              limit: 200,
            }).then((loaded) => {
              log.info("gateway.history.load.end", { sessionKey: input.sessionKey, durationMs: elapsedMs(historyLoadStartedAtMs), elapsedSinceRequestMs: elapsedMs(sendStartedAtMs), messageFactors: messageFactorSummary(loaded.messages ?? []), status: loaded.status ?? null, sessionId: loaded.sessionId ?? null });
              return loaded;
            }).catch((error) => {
              log.warn("gateway.history.load.fail_ignored", { sessionKey: input.sessionKey, ...errorMeta(error) });
              return null;
            });
            let currentHistory: { currentUserRepresented: boolean; assistantAfterCurrentUser: boolean } | null = null;
            if (history?.messages?.length) {
              const segment = context.messages.ensureActiveSegment({
                sessionKey: input.sessionKey,
                sessionId: history.sessionId ?? context.messages.getSession(input.sessionKey)?.sessionId ?? null,
                sessionFile: typeof history.sessionFile === "string" ? history.sessionFile : null,
              });
              const normalized = normalizeHistoryMessages(input.sessionKey, history.messages);
              const projectSeq = (message: ProjectedMessage) => segment.baseSeq + (message.gatewaySeq ?? message.openclawSeq);
              const historyMaxSeq = normalized.reduce((max, message) => Math.max(max, projectSeq(message)), 0);
              const gatewayUserEcho = [...normalized].reverse().find((message) => message.role === "user" && projectSeq(message) >= optimisticSeq && messageTextMatchesSent(textFromMessage(message.data), prepared.message));
              const gatewayUserEchoMatch = gatewayUserEcho ? "text" : null;
              const confirmedUser = gatewayUserEcho
                ? context.messages.confirmOptimisticUser(input.sessionKey, clientMessageId, gatewayUserEcho)
                : null;
              const liveConfirmedUser = !confirmedUser ? context.messages.findMessageById(input.sessionKey, clientMessageId) : null;
              const liveConfirmedCurrentUserSeq = liveConfirmedUser?.role === "user" && liveConfirmedUser.data.__clientOptimistic === false
                ? liveConfirmedUser.openclawSeq
                : null;
              const currentUserSeq = confirmedUser?.openclawSeq ?? (gatewayUserEcho ? projectSeq(gatewayUserEcho) : liveConfirmedCurrentUserSeq);
              const currentGatewayUserSeq = gatewayUserEcho?.openclawSeq ?? null;
              currentHistory = {
                currentUserRepresented: Boolean(gatewayUserEcho) || liveConfirmedCurrentUserSeq !== null,
                assistantAfterCurrentUser: currentGatewayUserSeq !== null
                  ? normalized.some((message) => message.openclawSeq > currentGatewayUserSeq && assistantHasVisibleAnswer(message))
                  : liveConfirmedCurrentUserSeq !== null
                    ? normalized.some((message) => projectSeq(message) > liveConfirmedCurrentUserSeq && assistantHasVisibleAnswer(message))
                    : false,
              };
              if (confirmedUser) {
                log.info("optimistic.user.confirmed", {
                  sessionKey: input.sessionKey,
                  optimisticId: clientMessageId,
                  gatewayMessageId: gatewayUserEcho?.messageId ?? null,
                  runId,
                });
              }
              const isStalePreSendHistory = !currentHistory.currentUserRepresented && historyMaxSeq < optimisticSeq;
              // Gateway re-sends every prior user turn on each send with a
              // stripped messageId (no runId/idempotencyKey). Drop those replays
              // using the same confirmed-user guard the live/backfill paths use,
              // or each send re-persists the previous user turn as a duplicate
              // row one seq down.
              const dedupedNormalized = normalized.filter((message) => {
                if (message === gatewayUserEcho) return true;
                if (message.role !== "user") return true;
                const isSameCurrentSendText = Boolean(gatewayUserEcho) && messageTextMatchesSent(textFromMessage(message.data), prepared.message);
                if (isSameCurrentSendText) {
                  log.info("history.persist.duplicate-current-user.skip", { sessionKey: input.sessionKey, messageId: message.messageId, messageSeq: projectSeq(message), runId });
                  return false;
                }
                const isDuplicate = context.chatLive.isConfirmedUserDuplicate(input.sessionKey, {
                  role: message.role,
                  data: message.data,
                  openclawSeq: projectSeq(message),
                });
                if (isDuplicate) {
                  log.info("history.persist.duplicate-confirmed-user.skip", { sessionKey: input.sessionKey, messageId: message.messageId, messageSeq: projectSeq(message) });
                }
                return !isDuplicate;
              });
              const normalizedToUpsert = isStalePreSendHistory
                ? []
                : confirmedUser && gatewayUserEcho
                  ? dedupedNormalized.filter((message) => message !== gatewayUserEcho)
                  : dedupedNormalized;
              const projection = normalizedToUpsert.length > 0
                ? context.messages.upsertMessages(normalizedToUpsert, { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq })
                : { upserted: 0, lastSeq: context.messages.nextMessageSeq(input.sessionKey) - 1, changedMessages: [] };
              log.info("history.persist", { sessionKey: input.sessionKey, normalized: normalized.length, upserted: projection.upserted, lastSeq: projection.lastSeq, historyMaxSeq, optimisticSeq, confirmedOptimistic: Boolean(confirmedUser), currentUserRepresented: currentHistory.currentUserRepresented, assistantAfterCurrentUser: currentHistory.assistantAfterCurrentUser, gatewayUserEchoMatch, skippedStalePreSendHistory: isStalePreSendHistory });
              if (confirmedUser) {
                const confirmedEvent = context.messages.appendProjectionEvent({
                  sessionKey: input.sessionKey,
                  eventType: "chat.message.confirmed",
                  payload: canonicalPatchPayload({
                    sessionKey: input.sessionKey,
                    semanticType: "chat.user.confirmed",
                    run: context.runs.getRun(runId),
                    messageId: confirmedUser.messageId,
                    payload: {
                      sessionKey: input.sessionKey,
                      message: confirmedUser.data,
                      messageSeq: confirmedUser.openclawSeq,
                      optimisticId: clientMessageId,
                      gatewayMessageId: gatewayUserEcho?.messageId ?? null,
                      runId,
                    },
                  }),
                });
                context.patchBus.broadcast({
                  cursor: confirmedEvent.cursor,
                  type: confirmedEvent.eventType,
                  sessionKey: confirmedEvent.sessionKey,
                  payload: confirmedEvent.payload,
                  createdAtMs: confirmedEvent.createdAtMs,
                });
                log.info("patch.broadcast", { sessionKey: input.sessionKey, type: confirmedEvent.eventType, cursor: confirmedEvent.cursor, messageSeq: confirmedUser.openclawSeq, role: confirmedUser.role, runId });
              }
              for (const projected of projection.changedMessages) {
                if (!currentHistory.currentUserRepresented || currentUserSeq === null || projected.openclawSeq <= currentUserSeq) {
                  log.info("history.patch.skip_stale_for_current_run", { sessionKey: input.sessionKey, messageSeq: projected.openclawSeq, role: projected.role, runId, optimisticSeq, currentUserRepresented: currentHistory.currentUserRepresented });
                  continue;
                }
                const gatewayProjection = projectGatewayMessage(projected.data as Record<string, unknown>);
                context.chatLive.projectToolsFromMessage(input.sessionKey, projected.data as OpenClawMessage, context.runs.getRun(runId), gatewayProjection);
                if (!gatewayProjection.emitMessagePatch) {
                  log.info("history.patch.skip_tool_result", { sessionKey: input.sessionKey, messageSeq: projected.openclawSeq, role: projected.role, runId });
                  continue;
                }
                const semanticType = classifyGatewayMessageSemanticType(projected.role, projected.data as Record<string, unknown>);
                const historyEvent = context.messages.appendProjectionEvent({
                  sessionKey: input.sessionKey,
                  eventType: "chat.message.upsert",
                  payload: canonicalPatchPayload({
                    sessionKey: input.sessionKey,
                    semanticType,
                    run: context.runs.getRun(runId),
                    messageId: projected.messageId,
                    payload: {
                      sessionKey: input.sessionKey,
                      message: projected.data,
                      messageSeq: projected.openclawSeq,
                      runId,
                    },
                  }),
                });
                context.patchBus.broadcast({
                  cursor: historyEvent.cursor,
                  type: historyEvent.eventType,
                  sessionKey: historyEvent.sessionKey,
                  payload: historyEvent.payload,
                  createdAtMs: historyEvent.createdAtMs,
                });
                log.info("patch.broadcast", { sessionKey: input.sessionKey, type: historyEvent.eventType, cursor: historyEvent.cursor, messageSeq: projected.openclawSeq, role: projected.role, runId });
              }
            }

            if (gatewaySendCompleted(result, currentHistory)) {
              context.runs.updateRunStatus(runId, "done", { statusLabel: null });
              const doneRun = context.runs.getRun(runId);
              const doneEvent = context.messages.appendProjectionEvent({
                sessionKey: input.sessionKey,
                eventType: "chat.status",
                payload: canonicalPatchPayload({
                  sessionKey: input.sessionKey,
                  semanticType: "chat.run.done",
                  run: doneRun,
                  legacyStatus: "done",
                  payload: {
                    sessionKey: input.sessionKey,
                    status: "done",
                    statusLabel: null,
                    idempotencyKey: input.idempotencyKey,
                    runId,
                  },
                }),
              });
              context.messages.upsertSession({
                sessionKey: input.sessionKey,
                sessionId: existingSession?.sessionId ?? null,
                data: {
                  ...objectData(context.messages.getSession(input.sessionKey)?.data),
                  sessionKey: input.sessionKey,
                  sessionId: existingSession?.sessionId ?? null,
                  status: "done",
                  statusLabel: null,
                },
              });
              log.info("session.status.persist", { sessionKey: input.sessionKey, sessionId: existingSession?.sessionId ?? null, status: "done", statusLabel: null });
              context.patchBus.broadcast({
                cursor: doneEvent.cursor,
                type: doneEvent.eventType,
                sessionKey: doneEvent.sessionKey,
                payload: doneEvent.payload,
                createdAtMs: doneEvent.createdAtMs,
              });
              log.info("status.broadcast", { sessionKey: input.sessionKey, type: doneEvent.eventType, cursor: doneEvent.cursor, status: "done", idempotencyKey: input.idempotencyKey });
            }

            log.info("send.end", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, totalDurationMs: elapsedMs(sendStartedAtMs), completed: gatewaySendCompleted(result, currentHistory), status: typeof result.status === "string" ? result.status : undefined });
            return { ok: true, sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, ...result };
          } catch (error) {
            context.runs.updateRunStatus(runId, "error", { statusLabel: error instanceof Error ? error.message : "Message failed", error: errorMeta(error) });
            log.error("send.fail", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, ...errorMeta(error) });
            const errorEvent = context.messages.appendProjectionEvent({
              sessionKey: input.sessionKey,
              eventType: "chat.status",
              payload: canonicalPatchPayload({
                sessionKey: input.sessionKey,
                semanticType: "chat.run.error",
                run: context.runs.getRun(runId),
                legacyStatus: "error",
                legacyStatusLabel: error instanceof Error ? error.message : "Message failed",
                payload: {
                  sessionKey: input.sessionKey,
                  status: "error",
                  statusLabel: error instanceof Error ? error.message : "Message failed",
                  idempotencyKey: input.idempotencyKey,
                  runId,
                },
              }),
            });
            const statusLabel = error instanceof Error ? error.message : "Message failed";
            context.messages.upsertSession({
              sessionKey: input.sessionKey,
              sessionId: existingSession?.sessionId ?? null,
              data: {
                ...objectData(context.messages.getSession(input.sessionKey)?.data),
                sessionKey: input.sessionKey,
                sessionId: existingSession?.sessionId ?? null,
                status: "error",
                statusLabel,
              },
            });
            log.info("session.status.persist", { sessionKey: input.sessionKey, sessionId: existingSession?.sessionId ?? null, status: "error", errorMessage: errorMeta(error).errorMessage });
            context.patchBus.broadcast({
              cursor: errorEvent.cursor,
              type: errorEvent.eventType,
              sessionKey: errorEvent.sessionKey,
              payload: errorEvent.payload,
              createdAtMs: errorEvent.createdAtMs,
            });
            log.info("status.broadcast", { sessionKey: input.sessionKey, type: errorEvent.eventType, cursor: errorEvent.cursor, status: "error", idempotencyKey: input.idempotencyKey });
            throw error;
          }
    }).catch((error) => {
      log.error("send.queue.fail", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, ...errorMeta(error) });
    });

    return { ok: true, accepted: true, sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, clientMessageId, runId };
  });

  app.post("/api/chat/abort", async (request) => {
    const parsed = z.object({ sessionKey: z.string().min(1), runId: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, "Invalid chat abort body", "INVALID_BODY", parsed.error.flatten());
    log.info("abort.start", { sessionKey: parsed.data.sessionKey, runId: parsed.data.runId });
    void context.gateway.request<Record<string, unknown>>("chat.abort", parsed.data, 30_000).catch((error) => {
      log.warn("abort.gateway.fail", { sessionKey: parsed.data.sessionKey, runId: parsed.data.runId, ...errorMeta(error) });
    });
    void context.gateway.request<Record<string, unknown>>("sessions.abort", { key: parsed.data.sessionKey }, 30_000).catch((error) => {
      log.warn("abort.gateway-session.fail", { sessionKey: parsed.data.sessionKey, runId: parsed.data.runId, ...errorMeta(error) });
    });
    const projectedRun = parsed.data.runId
      ? context.runs.getRun(parsed.data.runId) ?? context.runs.findRunByGatewayRunId(parsed.data.runId)
      : context.runs.findLatestPendingRun(parsed.data.sessionKey);
    let completedTools = 0;
    if (projectedRun) {
      context.runs.updateRunStatus(projectedRun.runId, "aborted", { statusLabel: null });
      completedTools = context.runs.completeRunningTools(parsed.data.sessionKey, projectedRun.runId, { status: "error", resultMeta: { reason: "aborted" }, updatedAtMs: nowMs() });
      context.messages.upsertSession({
        sessionKey: parsed.data.sessionKey,
        sessionId: context.messages.getSession(parsed.data.sessionKey)?.sessionId ?? null,
        data: { ...objectData(context.messages.getSession(parsed.data.sessionKey)?.data), sessionKey: parsed.data.sessionKey, status: "aborted", statusLabel: null },
      });
    } else {
      const existingSession = context.messages.getSession(parsed.data.sessionKey);
      context.messages.upsertSession({
        sessionKey: parsed.data.sessionKey,
        sessionId: existingSession?.sessionId ?? null,
        data: { ...objectData(existingSession?.data), sessionKey: parsed.data.sessionKey, status: "aborted", statusLabel: null },
      });
    }
    const abortEvent = context.messages.appendProjectionEvent({
      sessionKey: parsed.data.sessionKey,
      eventType: "chat.status",
      payload: canonicalPatchPayload({
        sessionKey: parsed.data.sessionKey,
        semanticType: "chat.run.aborted",
        run: projectedRun ? context.runs.getRun(projectedRun.runId) : null,
        payload: { completedTools },
      }),
    });
    context.patchBus.broadcast({
      cursor: abortEvent.cursor,
      type: abortEvent.eventType,
      sessionKey: abortEvent.sessionKey,
      payload: abortEvent.payload,
      createdAtMs: abortEvent.createdAtMs,
    });
    log.info("abort.end", { sessionKey: parsed.data.sessionKey, runId: parsed.data.runId, projectedRunId: projectedRun?.runId, completedTools });
    return { ok: true };
  });

  app.get("/api/chat/bootstrap", async (request) => {
    const parsed = bootstrapQuery.safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid chat bootstrap query", "INVALID_QUERY", parsed.error.flatten());
    }
    const bootstrapStartedAtMs = nowMs();
    const staleCleanup = context.runs.finalizeStaleActivity();
    if (staleCleanup.runsFinalized || staleCleanup.toolsFinalized || staleCleanup.detachedToolsFinalized) {
      log.warn("bootstrap.stale-activity-finalized", { sessionKey: parsed.data.sessionKey, ...staleCleanup });
    }
    log.info("bootstrap.start", { sessionKey: parsed.data.sessionKey, limit: parsed.data.limit, hasMaxChars: parsed.data.maxChars !== undefined });

    // ── Local-first fast path ──
    // Serve from local SQLite projection immediately when:
    //   1. Session exists in SQLite with messages, AND
    //   2. Either: recently bootstrapped in-memory (within 30s)
    //      OR: SQLite data is recent (<5min) AND Gateway is connected
    //          (live patch stream keeps SQLite up-to-date)
    const localSession = context.messages.getSession(parsed.data.sessionKey);
    const lastBootstrapAt = localFirstBootstrapTimestamps.get(parsed.data.sessionKey) ?? 0;
    const inMemoryFresh = lastBootstrapAt > 0 && (nowMs() - lastBootstrapAt) < LOCAL_FIRST_FRESH_MS;
    const gatewayConnected = context.gateway.status().connected;
    // When Gateway is connected, live events keep SQLite current — any existing
    // data is valid regardless of age. Only check age when disconnected.
    const canServeFromSqlite = Boolean(
      !localFirstSqliteBlocked.has('*') &&
      localSession &&
      (gatewayConnected || (nowMs() - localSession.updatedAtMs) < LOCAL_FIRST_SQLITE_MAX_AGE_MS)
    );
    const shouldServeLocal = inMemoryFresh || canServeFromSqlite;
    const localMessages = localSession && shouldServeLocal ? context.messages.listMessages(parsed.data.sessionKey, { limit: parsed.data.limit ?? 1000, latest: true }) : [];
    const canServeLocal = Boolean(localSession && localMessages.length > 0 && shouldServeLocal);

    if (canServeLocal) {
      const serialized = localMessages.map(serializeProjectedMessage);
      const sessionData = objectData(localSession!.data);
      const latestEvent = context.messages.latestProjectionEvent(parsed.data.sessionKey);
      const cursor = latestEvent?.cursor ?? 0;
      log.info("bootstrap.local-first", {
        sessionKey: parsed.data.sessionKey,
        messageCount: serialized.length,
        reason: inMemoryFresh ? "in-memory-fresh" : "sqlite-fresh-gateway-connected",
        sqliteAgeMs: localSession ? nowMs() - localSession.updatedAtMs : null,
        gatewayConnected,
        cursor,
        durationMs: elapsedMs(bootstrapStartedAtMs),
      });
      // Background Gateway sync is intentionally throttled. When Gateway is
      // connected, live patches keep SQLite current; firing chat.history for
      // every local-first bootstrap caused desktop startup / space switches to
      // queue dozens of Gateway calls and made the app feel frozen.
      const localAgeMs = localSession ? nowMs() - localSession.updatedAtMs : Number.POSITIVE_INFINITY;
      const shouldBackgroundSync =
        !inMemoryFresh &&
        gatewayConnected &&
        localAgeMs > LOCAL_FIRST_BACKGROUND_SYNC_MIN_AGE_MS;
      if (shouldBackgroundSync) {
        void (async () => {
          try {
            const history = await context.gateway.request<ChatHistoryResponse>("chat.history", {
              sessionKey: parsed.data.sessionKey,
              ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
            });
            const sk = history.sessionKey ?? parsed.data.sessionKey;
            const msgs = history.messages ?? [];
            const normalized = normalizeHistoryMessages(sk, msgs);
            const segment = context.messages.ensureActiveSegment({ sessionKey: sk, sessionId: history.sessionId ?? localSession!.sessionId, sessionFile: typeof history.sessionFile === "string" ? history.sessionFile : null });
            context.messages.upsertSession({ sessionKey: sk, sessionId: history.sessionId ?? localSession!.sessionId, data: { ...sessionData, ...(history.status ? { status: history.status } : {}) } });
            const proj = context.messages.upsertMessages(normalized, { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
            const activeRun = context.runs.findLatestPendingRun(sk);
            const pruned = activeRun ? 0 : context.messages.pruneSegmentToCanonicalMessages({ sessionKey: sk, segmentId: segment.segmentId, baseSeq: segment.baseSeq, canonicalMessages: normalized });
            if (proj.upserted > 0 || pruned > 0) {
              const total = context.messages.countMessages(sk);
              const newEvent = context.messages.appendProjectionEvent({ sessionKey: sk, eventType: "chat.bootstrap", payload: { sessionKey: sk, messageCount: total, lastSeq: context.messages.nextMessageSeq(sk) - 1, backgroundRefresh: true, pruned } });
              context.patchBus.broadcast({ cursor: newEvent.cursor, type: newEvent.eventType, sessionKey: sk, payload: newEvent.payload, createdAtMs: newEvent.createdAtMs });
              log.info("bootstrap.background-sync.changed", { sessionKey: sk, upserted: proj.upserted, pruned, cursor: newEvent.cursor });
            } else {
              log.info("bootstrap.background-sync.unchanged", { sessionKey: sk, pruned });
            }
            localFirstBootstrapTimestamps.set(sk, Date.now());
          } catch (error) {
            log.warn("bootstrap.background-sync.fail", { sessionKey: parsed.data.sessionKey, error: errorMeta(error) });
          }
        })();
      } else {
        log.info("bootstrap.background-sync.skip", {
          sessionKey: parsed.data.sessionKey,
          reason: inMemoryFresh ? "in-memory-fresh" : gatewayConnected ? "sqlite-recent" : "gateway-disconnected",
          sqliteAgeMs: Number.isFinite(localAgeMs) ? localAgeMs : null,
        });
      }
      void context.chatLive.ensureSessionSubscribed(parsed.data.sessionKey).catch(() => {});
      const totalMessages = context.messages.countMessages(parsed.data.sessionKey);
      const oldestSeq = serialized.length > 0 ? (localMessages[0]?.openclawSeq ?? null) : null;
      return buildChatBootstrapSnapshot(context, {
        sessionKey: parsed.data.sessionKey,
        sessionId: localSession!.sessionId,
        sessionData,
        messages: serialized,
        messageCount: serialized.length,
        knownTotalMessages: totalMessages,
        oldestLoadedSeq: typeof oldestSeq === "number" ? oldestSeq : undefined,
        cursor,
        projection: { upserted: 0, lastSeq: context.messages.nextMessageSeq(parsed.data.sessionKey) - 1, liveSubscribed: false },
      });
    }
    // ── End local-first fast path ──

    // Per-session in-flight dedupe (mirrors archiveProjectionJobs): collapse K
    // concurrent cold first-bootstraps for the same session into ONE build so a
    // huge session can't run the full synchronous chain K times in parallel.
    const coldKey = parsed.data.sessionKey;
    const existingColdJob = coldBootstrapJobs.get(coldKey);
    if (existingColdJob) {
      log.info("bootstrap.cold.dedupe", { sessionKey: coldKey, durationMs: elapsedMs(bootstrapStartedAtMs) });
      return existingColdJob;
    }
    const coldJob = (async (): Promise<ChatBootstrapSnapshot> => {
    const gatewayHistoryStartedAtMs = nowMs();
    const history = await context.gateway.request<ChatHistoryResponse>("chat.history", {
      sessionKey: parsed.data.sessionKey,
      ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.maxChars ? { maxChars: parsed.data.maxChars } : {}),
    });
    log.info("bootstrap.gateway.history", { sessionKey: history.sessionKey ?? parsed.data.sessionKey, sessionId: history.sessionId ?? null, durationMs: elapsedMs(gatewayHistoryStartedAtMs), messageFactors: messageFactorSummary(history.messages ?? []), status: history.status ?? null });

    const sessionKey = history.sessionKey ?? parsed.data.sessionKey;
    const messages = history.messages ?? [];
    const normalized = normalizeHistoryMessages(sessionKey, messages);
    const existingSession = context.messages.getSession(sessionKey);
    const segment = context.messages.ensureActiveSegment({
      sessionKey,
      sessionId: history.sessionId ?? existingSession?.sessionId ?? null,
      sessionFile: typeof history.sessionFile === "string" ? history.sessionFile : null,
    });
    const sessionData: Record<string, unknown> = {
      ...objectData(existingSession?.data),
      sessionKey,
      sessionId: history.sessionId ?? existingSession?.sessionId ?? null,
      ...(history.status ? { status: history.status } : {}),
      thinkingLevel: history.thinkingLevel,
      fastMode: history.fastMode,
      verboseLevel: history.verboseLevel,
    };
    context.messages.upsertSession({
      sessionKey,
      sessionId: history.sessionId ?? existingSession?.sessionId ?? null,
      data: sessionData,
    });
    log.info("bootstrap.session.persist", { sessionKey, sessionId: history.sessionId ?? existingSession?.sessionId ?? null, status: typeof sessionData.status === "string" ? sessionData.status : null });
    const projection = context.messages.upsertMessages(normalized, { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
    const bootstrapPruned = context.runs.findLatestPendingRun(sessionKey) ? 0 : context.messages.pruneSegmentToCanonicalMessages({ sessionKey, segmentId: segment.segmentId, baseSeq: segment.baseSeq, canonicalMessages: normalized });
    const bootstrapLastSeq = context.messages.nextMessageSeq(sessionKey) - 1;
    log.info("bootstrap.messages.persist", { sessionKey, normalized: normalized.length, upserted: projection.upserted, pruned: bootstrapPruned, lastSeq: bootstrapLastSeq });
    void scheduleArchivedHistoryProjection({ context, log, sessionKey, history });

    const latestRun = context.runs.latestRun(sessionKey);
    const activeRun = context.runs.findLatestPendingRun(sessionKey);
    const bootstrapCompleted = isTerminalSendStatus(sessionData.status) || lastMessageIsAssistantText(messages);
    const inferenceRun = activeRun ?? latestRun;
    const inferredToolCount = await inferBootstrapToolCalls(context, sessionKey, messages, inferenceRun ?? null, bootstrapCompleted);
    if (inferredToolCount > 0) log.info("bootstrap.tools.inferred", { sessionKey, inferredToolCount, runId: inferenceRun?.runId ?? null, completed: bootstrapCompleted });
    if (activeRun && context.runs.hasRunningTools(sessionKey, activeRun.runId)) {
      context.runs.updateRunStatus(activeRun.runId, "tool_running", { statusLabel: context.runs.listRunningToolCalls(sessionKey, activeRun.runId)[0]?.name ?? activeRun.statusLabel ?? null });
    }

    if (activeRun) {
      const finalizedPreRunTools = context.runs.completeRunningToolsStartedBefore(sessionKey, activeRun.runId, activeRun.startedAtMs - 1000, {
        status: "success",
      });
      if (finalizedPreRunTools > 0) {
        log.warn("bootstrap.stale-prerun-tools-finalized", { sessionKey, runId: activeRun.runId, finalizedTools: finalizedPreRunTools, runStartedAtMs: activeRun.startedAtMs });
        if (activeRun.status === "tool_running" && !context.runs.hasRunningTools(sessionKey, activeRun.runId)) {
          context.runs.updateRunStatus(activeRun.runId, "streaming", { statusLabel: "Streaming" });
        }
      }
    }

    if (activeRun) {
      const staleRunMs = Date.now() - activeRun.updatedAtMs;
      const staleToolMs = oldestRunningToolAgeMs(context, sessionKey, activeRun.runId);
      const shouldFinalizeStaleRun =
        (staleRunMs > STALE_BOOTSTRAP_RUN_MS && (lastMessageIsAssistantText(messages) || hasAssistantResponseAfterLastUser(messages))) ||
        (staleToolMs !== null && staleToolMs > STALE_BOOTSTRAP_TOOL_MS);
      if (shouldFinalizeStaleRun) {
        const reason = staleToolMs !== null && staleToolMs > STALE_BOOTSTRAP_TOOL_MS
          ? "stale_bootstrap_tool_replay"
          : "stale_bootstrap_after_assistant_final";
        const finalizedTools = context.runs.completeRunningTools(sessionKey, activeRun.runId, {
          status: "success",
        });
        context.runs.updateRunStatus(activeRun.runId, "done", { statusLabel: null });
        sessionData.status = "done";
        sessionData.statusLabel = null;
        context.messages.upsertSession({
          sessionKey,
          sessionId: history.sessionId ?? existingSession?.sessionId ?? null,
          data: sessionData,
        });
        log.warn("bootstrap.stale-run-finalized", { sessionKey, runId: activeRun.runId, previousStatus: activeRun.status, finalizedTools, staleMs: staleRunMs, staleToolMs, reason });
      }
    }

    const projectedMessages = context.messages.listMessages(sessionKey, { limit: parsed.data.limit ?? 1000, latest: true }).map(serializeProjectedMessage);
    log.info("bootstrap.messages.read", { sessionKey, messageCount: projectedMessages.length, limit: parsed.data.limit ?? 1000 });
    void context.chatLive.ensureSessionSubscribed(sessionKey).catch((error) => {
      log.warn("bootstrap.live-subscribe.background.fail", { sessionKey, error: errorMeta(error) });
    });
    const event = context.messages.appendProjectionEvent({
      sessionKey,
      eventType: "chat.bootstrap",
      payload: { sessionKey, messageCount: projectedMessages.length, lastSeq: bootstrapLastSeq, historyCoverage: "metadata", fullMessagesIncluded: false, pruned: bootstrapPruned },
    });
    localFirstBootstrapTimestamps.set(sessionKey, nowMs());
    localFirstSqliteBlocked.delete('*');
    log.info("bootstrap.end", { sessionKey, sessionId: history.sessionId ?? null, totalDurationMs: elapsedMs(bootstrapStartedAtMs), messageCount: projectedMessages.length, status: typeof sessionData.status === "string" ? sessionData.status : null, cursor: event.cursor, factors: { gatewayHistoryMs: elapsedMs(gatewayHistoryStartedAtMs), normalized: normalized.length, upserted: projection.upserted, liveSubscribed: "background" } });

    const totalMessages = context.messages.countMessages(sessionKey);
    const oldestSeq = projectedMessages.length > 0 ? ((projectedMessages[0] as { __openclaw?: { seq?: number } }).__openclaw?.seq ?? null) : null;
    return buildChatBootstrapSnapshot(context, {
      sessionKey,
      sessionId: history.sessionId ?? existingSession?.sessionId ?? null,
      sessionData,
      messages: projectedMessages,
      messageCount: projectedMessages.length,
      knownTotalMessages: totalMessages,
      oldestLoadedSeq: typeof oldestSeq === "number" ? oldestSeq : undefined,
      cursor: event.cursor,
      projection: { upserted: projection.upserted, lastSeq: bootstrapLastSeq, liveSubscribed: false },
      historyMeta: { thinkingLevel: history.thinkingLevel, fastMode: history.fastMode, verboseLevel: history.verboseLevel },
    });
    })().finally(() => {
      // On success OR failure clear the entry so a bad build can't wedge future
      // callers; awaiters still receive the same resolved snapshot or rejection.
      if (coldBootstrapJobs.get(coldKey) === coldJob) coldBootstrapJobs.delete(coldKey);
    });
    coldBootstrapJobs.set(coldKey, coldJob);
    return coldJob;
  });

  app.get("/api/chat/messages", async (request) => {
    const parsed = z.object({
      sessionKey: z.string().min(1),
      afterSeq: z.coerce.number().int().min(0).optional(),
      beforeSeq: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(1000).optional(),
    }).safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid chat messages query", "INVALID_QUERY", parsed.error.flatten());
    }
    log.info("messages.read.start", { sessionKey: parsed.data.sessionKey, afterSeq: parsed.data.afterSeq ?? 0, beforeSeq: parsed.data.beforeSeq ?? null, limit: parsed.data.limit });
    const messages = context.messages.listMessages(parsed.data.sessionKey, {
      afterSeq: parsed.data.afterSeq,
      beforeSeq: parsed.data.beforeSeq,
      limit: parsed.data.limit,
    });
    log.info("messages.read.end", { sessionKey: parsed.data.sessionKey, messageCount: messages.length });
    return {
      ok: true,
      source: "middleware-projection",
      sessionKey: parsed.data.sessionKey,
      messages: messages.map((message) => ({
        sessionKey: message.sessionKey,
        openclawSeq: message.openclawSeq,
        messageId: message.messageId,
        role: message.role,
        gatewaySeq: message.gatewaySeq,
        segmentId: message.segmentId,
        data: serializeProjectedMessage(message),
        updatedAtMs: message.updatedAtMs,
      })),
      messageCount: messages.length,
    };
  });

  app.get("/api/chat/tool-result", async (request) => {
    const parsed = z.object({
      sessionKey: z.string().min(1),
      toolCallId: z.string().min(1),
    }).safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid tool result query", "INVALID_QUERY", parsed.error.flatten());
    }
    const { sessionKey, toolCallId } = parsed.data;
    log.info("tool-result.fetch.start", { sessionKey, toolCallId });

    // First try local SQLite projection (fast)
    const localMessages = context.messages.listMessages(sessionKey, { limit: 1000 });
    for (const msg of localMessages) {
      const data = msg.data as Record<string, unknown>;
      if ((data.role === "tool" || data.role === "tool_result" || data.role === "toolResult") &&
          (data.tool_call_id === toolCallId || data.toolCallId === toolCallId)) {
        const content = data.content ?? data.text ?? data.output;
        const text = typeof content === "string" ? content
          : Array.isArray(content) ? content.map((c: unknown) => typeof c === "string" ? c : (c as Record<string, unknown>)?.text ?? "").join("\n")
          : typeof content === "object" ? JSON.stringify(content, null, 2)
          : String(content ?? "");
        log.info("tool-result.fetch.local", { sessionKey, toolCallId, length: text.length });
        return { ok: true, source: "local", sessionKey, toolCallId, text };
      }
    }

    // Fall back to Gateway history (full, untruncated)
    try {
      const history = await context.gateway.request<ChatHistoryResponse>("chat.history", { sessionKey, limit: 500 });
      const messages = history.messages ?? [];
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i] as Record<string, unknown>;
        if ((msg.role === "tool" || msg.role === "tool_result" || msg.role === "toolResult") &&
            (msg.tool_call_id === toolCallId || msg.toolCallId === toolCallId)) {
          const content = msg.content ?? msg.text ?? msg.output;
          const text = typeof content === "string" ? content
            : Array.isArray(content) ? content.map((c: unknown) => typeof c === "string" ? c : (c as Record<string, unknown>)?.text ?? "").join("\n")
            : typeof content === "object" ? JSON.stringify(content, null, 2)
            : String(content ?? "");
          log.info("tool-result.fetch.gateway", { sessionKey, toolCallId, length: text.length });
          return { ok: true, source: "gateway", sessionKey, toolCallId, text };
        }
      }
    } catch (error) {
      log.warn("tool-result.fetch.gateway-fail", { sessionKey, toolCallId, ...errorMeta(error) });
    }

    return { ok: false, error: { message: "Tool result not found" }, sessionKey, toolCallId, text: "" };
  });

  app.get("/api/chat/search", async (request) => {
    const parsed = z.object({
      sessionKey: z.string().min(1),
      query: z.string().min(1).max(200),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid search query", "INVALID_QUERY", parsed.error.flatten());
    }
    const { sessionKey, query, limit } = parsed.data;
    const startMs = Date.now();
    const results = context.messages.searchMessages(sessionKey, query, limit ?? 50);
    log.info("chat.search", { sessionKey, query: query.slice(0, 50), resultCount: results.length, durationMs: Date.now() - startMs });
    return { ok: true, sessionKey, query, results, resultCount: results.length };
  });
}
