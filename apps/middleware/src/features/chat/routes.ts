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
import { cleanMessageDisplayText, containsAttachedFileBlock, messageTextMatchesSent, normalizeHistoryMessages, textFromMessage } from "./message-normalizer.js";
import { classifyGatewayMessageSemanticType, extractToolEventsFromMessage, isErrorToolResult, projectGatewayMessage, readToolCallId, readToolName } from "./gateway-event-projector.js";
import { prepareMessageAndAttachments } from "./attachments.js";
import type { RunStatus } from "./repo.runs.js";
import { buildChatBootstrapSnapshot, canonicalPatchPayload } from "./projection.js";
import type { OpenClawMessage, ProjectedMessage } from "./types.js";

const bootstrapQuery = z.object({
  sessionKey: z.string().min(1),
});

const sessionContextQuery = z.object({
  sessionKey: z.string().min(1),
});

const localMediaQuery = z.object({
  path: z.string().min(1),
});

const DEFAULT_CHAT_SEND_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS = DEFAULT_CHAT_SEND_TIMEOUT_MS + 10_000;

type SessionContextUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalCacheRead: number | null;
  total: number;
  cost: number | null;
  contextLimit: number | null;
};

function positiveNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function usageNumber(value: unknown): number {
  const n = positiveNumber(value);
  return n === null ? 0 : n;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sessionContextFromGatewaySession(session: Record<string, unknown> | null): SessionContextUsage | null {
  if (!session) return null;
  const responseUsage = objectRecord(session.responseUsage);
  const usage = objectRecord(responseUsage?.usage) ?? responseUsage;
  const cost = objectRecord(usage?.cost);

  const input = usageNumber(session.inputTokens ?? usage?.input ?? usage?.input_tokens ?? usage?.prompt_tokens);
  const output = usageNumber(session.outputTokens ?? usage?.output ?? usage?.output_tokens ?? usage?.completion_tokens);
  const cacheRead = usageNumber(session.cacheRead ?? usage?.cacheRead ?? usage?.cache_read_tokens);
  const cacheWrite = usageNumber(session.cacheWrite ?? usage?.cacheWrite ?? usage?.cache_write_tokens);
  const total = usageNumber(session.totalTokens ?? usage?.total ?? usage?.total_tokens) || input + output + cacheRead + cacheWrite;
  const contextLimit = positiveNumber(session.contextTokens ?? session.contextLimit ?? usage?.contextTokens ?? usage?.contextLimit);
  const costValue = positiveNumber(session.estimatedCostUsd ?? session.totalCost ?? usage?.totalCost ?? usage?.cost_usd ?? cost?.total);

  if (total <= 0 && input <= 0 && output <= 0 && cacheRead <= 0 && cacheWrite <= 0) return null;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalCacheRead: null,
    total,
    cost: costValue,
    contextLimit,
  };
}

function usageFromMessageData(data: unknown): Record<string, unknown> | null {
  const record = objectRecord(data);
  if (!record) return null;
  const responseUsage = objectRecord(record.responseUsage);
  return objectRecord(responseUsage?.usage) ?? responseUsage ?? objectRecord(record.usage);
}

function totalCacheReadFromStoredMessages(context: AppContext, sessionKey: string): number {
  const rows = context.db.prepare(`
    SELECT data_json
    FROM v2_messages
    WHERE session_key = @sessionKey
      AND role = 'assistant'
      AND data_json LIKE '%cache%'
  `).all({ sessionKey }) as Array<{ data_json: string }>;

  return rows.reduce((total, row) => {
    try {
      const usage = usageFromMessageData(JSON.parse(row.data_json));
      return total + usageNumber(usage?.cacheRead ?? usage?.cache_read_tokens);
    } catch {
      return total;
    }
  }, 0);
}

function withStoredTotalCacheRead(usage: SessionContextUsage | null, totalCacheRead: number): SessionContextUsage | null {
  if (!usage) return null;
  return {
    ...usage,
    totalCacheRead: totalCacheRead > 0 ? totalCacheRead : null,
  };
}

/** Kept for older tests; chat bootstrap no longer uses a local-first cache. */
export function clearLocalFirstBootstrapCache() {
}
const ACTIVE_RUN_STATUSES = new Set<RunStatus>(["queued", "thinking", "streaming", "tool_running"]);


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


function isAttachmentLikeContentBlock(block: unknown) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return false;
  const record = block as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  const mimeType = typeof record.mimeType === "string"
    ? record.mimeType
    : typeof record.mime_type === "string"
      ? record.mime_type
      : typeof record.media_type === "string"
        ? record.media_type
        : "";
  if (["attachment", "file", "document", "input_file", "input_document"].includes(type)) return true;
  if (mimeType && !mimeType.startsWith("text/plain-inline")) return true;
  return Boolean(
    (typeof record.name === "string" || typeof record.fileName === "string" || typeof record.filename === "string") &&
    (typeof record.content === "string" || typeof record.data === "string" || typeof record.text === "string")
  );
}

function cleanSerializedMessageData(data: Record<string, unknown>, role: string) {
  if (role !== "user") return data;
  const next = { ...data };
  if (typeof next.text === "string") next.text = cleanMessageDisplayText(next.text);
  if (typeof next.content === "string") next.content = cleanMessageDisplayText(next.content);
  if (Array.isArray(next.content)) {
    next.content = next.content
      .filter((block) => !isAttachmentLikeContentBlock(block))
      .map((block) => {
        if (!block || typeof block !== "object" || Array.isArray(block) || typeof (block as Record<string, unknown>).text !== "string") return block;
        return { ...block, text: cleanMessageDisplayText((block as Record<string, unknown>).text as string) };
      });
  }
  return next;
}


function isNonUserAttachedFileEcho(message: ProjectedMessage) {
  if (message.role === "user") return false;
  return containsAttachedFileBlock(textFromMessage(message.data));
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

/**
 * Project tool calls from a batch of (already-normalized) archived messages into
 * v2_tool_calls. The archived-import path persisted message rows but NEVER tool
 * rows, so huge/historical sessions reconstructed from archives showed empty
 * tools/toolCalls even with 600+ toolCall blocks in content. Pairs toolCall and
 * toolResult blocks by toolCallId in a single pass; idempotent via the
 * ON CONFLICT(session_key, tool_call_id) upsert + terminal-state guard.
 */
type ArchivedToolResult = { status: "success" | "error"; resultMeta: unknown; finishedAtMs: number | null };

/** Collect tool results keyed by toolCallId (first occurrence wins) from a batch. */
function collectArchivedToolResults(messages: ProjectedMessage[], resultById: Map<string, ArchivedToolResult>) {
  for (const message of messages) {
    const ts = historyTimestampMs(message.data as Record<string, unknown>);
    for (const event of extractToolEventsFromMessage(message.data)) {
      if (event.phase !== "result" && event.phase !== "error") continue;
      if (resultById.has(event.toolCallId)) continue;
      const resultMeta = safeResultMeta(event.result);
      resultById.set(event.toolCallId, {
        status: event.phase === "error" || isErrorToolResult(resultMeta) ? "error" : "success",
        resultMeta,
        finishedAtMs: ts,
      });
    }
  }
}

/** Upsert one tool row per toolCall block in a batch, attaching its paired result. */
async function upsertArchivedToolCalls(context: AppContext, sessionKey: string, messages: ProjectedMessage[], resultById: Map<string, ArchivedToolResult>): Promise<number> {
  let projected = 0;
  let processed = 0;
  for (const message of messages) {
    const data = message.data as Record<string, unknown>;
    const openclaw = objectData(data.__openclaw);
    const messageId = message.messageId ?? (typeof openclaw.id === "string" ? openclaw.id : null);
    const runId = typeof openclaw.runId === "string" ? openclaw.runId : null;
    const ts = historyTimestampMs(data);
    for (const event of extractToolEventsFromMessage(message.data)) {
      if (event.phase !== "calling" && event.phase !== "start") continue;
      if (!event.toolCallId || !event.name) continue;
      const result = resultById.get(event.toolCallId);
      context.runs.upsertToolCall({
        sessionKey,
        toolCallId: event.toolCallId,
        runId,
        messageId,
        name: event.name,
        phase: result ? "result" : "calling",
        status: result?.status,
        argsMeta: event.args,
        resultMeta: result?.resultMeta,
        startedAtMs: ts ?? undefined,
        finishedAtMs: result?.finishedAtMs ?? undefined,
      });
      projected += 1;
    }
    // Same non-blocking discipline as 0007: yield on tool-dense batches.
    if (++processed % 25 === 0) await yieldToEventLoop();
  }
  return projected;
}

export async function projectArchivedSegmentToolCalls(context: AppContext, sessionKey: string, messages: ProjectedMessage[]): Promise<number> {
  const resultById = new Map<string, ArchivedToolResult>();
  collectArchivedToolResults(messages, resultById);
  return upsertArchivedToolCalls(context, sessionKey, messages, resultById);
}

/**
 * One-shot, idempotent backfill of v2_tool_calls for an ALREADY-imported session
 * (messages projected to SQLite before 0014 — message rows but zero tool rows).
 * Reads projected messages in bounded chunks (two paged passes so toolCall/result
 * pairing is session-wide and correct across chunk boundaries), yielding between
 * pages. Idempotent via upsertToolCall's ON CONFLICT + terminal-state guard.
 */
export async function backfillArchivedToolCalls(context: AppContext, sessionKey: string): Promise<number> {
  const CHUNK = 300;
  // Pass 1: collect all tool results across the session.
  const resultById = new Map<string, ArchivedToolResult>();
  let afterSeq = 0;
  for (;;) {
    const page = context.messages.listMessages(sessionKey, { afterSeq, limit: CHUNK });
    if (page.length === 0) break;
    collectArchivedToolResults(page, resultById);
    afterSeq = page[page.length - 1]!.openclawSeq;
    if (page.length < CHUNK) break;
    await yieldToEventLoop();
  }
  // Pass 2: upsert one row per toolCall block, attaching its (session-wide) result.
  let total = 0;
  afterSeq = 0;
  for (;;) {
    const page = context.messages.listMessages(sessionKey, { afterSeq, limit: CHUNK });
    if (page.length === 0) break;
    total += await upsertArchivedToolCalls(context, sessionKey, page, resultById);
    afterSeq = page[page.length - 1]!.openclawSeq;
    if (page.length < CHUNK) break;
    await yieldToEventLoop();
  }
  return total;
}

async function persistArchivedHistorySegments(context: AppContext, sessionKey: string, history: ChatHistoryResponse) {
  const archivedFiles = await archivedHistoryTranscriptFiles({
    sessionKey,
    sessionId: history.sessionId ?? null,
    sessionFile: typeof history.sessionFile === "string" ? history.sessionFile : null,
    messages: history.messages ?? [],
  });
  let upserted = 0;
  let projectedTools = 0;
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
    // Project tool calls for this file's messages — the missing step that left
    // archived/historical sessions with empty tools/toolCalls.
    projectedTools += await projectArchivedSegmentToolCalls(context, sessionKey, normalized);
    context.messages.recordArchiveImport({ sessionKey, filePath, fileMtimeMs, fileSize, segmentId: segment.segmentId, messageCount: normalized.length });
    importedFiles += 1;
    if (staleImport) changedFiles += 1;
    // Yield between (potentially large) file imports so a big corpus can't
    // monopolise the event loop on a cold cache.
    if (++processed % 3 === 0) await yieldToEventLoop();
  }
  return { fileCount: archivedFiles.length, importedFiles, skippedFiles, changedFiles, upserted, projectedTools, changed: importedFiles > 0 || changedFiles > 0 };
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


function displayAttachments(raw: unknown) {
  if (!Array.isArray(raw)) return undefined;
  const attachments = raw.map((item) => {
    const attachment = objectData(item);
    const name = typeof attachment.name === "string" && attachment.name.trim() ? attachment.name : "attachment";
    const mimeType = typeof attachment.mimeType === "string" && attachment.mimeType.trim() ? attachment.mimeType : "application/octet-stream";
    return {
      name: name.slice(0, 200),
      mimeType,
      ...(typeof attachment.content === "string" ? { content: attachment.content } : {}),
      ...(attachment.encoding === "utf-8" || attachment.encoding === "base64" ? { encoding: attachment.encoding } : {}),
      ...(typeof attachment.size === "number" && Number.isFinite(attachment.size) ? { size: attachment.size } : {}),
    };
  });
  return attachments.length > 0 ? attachments : undefined;
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

function isStopCommandText(text: string) {
  return /^\/stop(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text.trim());
}

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

const OPENCLAW_MEDIA_ROOT = path.resolve(os.homedir(), ".openclaw", "media");

const MEDIA_MIME_TYPES: Record<string, string> = {
  ".avi": "video/x-msvideo",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4a": "audio/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

function mediaMimeType(filePath: string) {
  return MEDIA_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function resolveOpenClawMediaPath(rawPath: string) {
  const trimmed = rawPath.trim();
  const candidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(OPENCLAW_MEDIA_ROOT, trimmed.replace(/^\.\//, ""));
  const rootWithSeparator = `${OPENCLAW_MEDIA_ROOT}${path.sep}`;
  if (candidate !== OPENCLAW_MEDIA_ROOT && !candidate.startsWith(rootWithSeparator)) {
    throw new HttpError(403, "Media path is outside the OpenClaw media directory", "MEDIA_PATH_FORBIDDEN");
  }
  return candidate;
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

  app.get("/api/chat/media/local", async (request, reply) => {
    const parsed = localMediaQuery.safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid local media query", "INVALID_QUERY", parsed.error.flatten());
    }

    const requestedPath = resolveOpenClawMediaPath(parsed.data.path);
    let realRoot = OPENCLAW_MEDIA_ROOT;
    let realFile = requestedPath;
    try {
      realRoot = await fs.promises.realpath(OPENCLAW_MEDIA_ROOT);
      realFile = await fs.promises.realpath(requestedPath);
    } catch {
      throw new HttpError(404, "Media file not found", "MEDIA_NOT_FOUND");
    }
    const rootWithSeparator = `${realRoot}${path.sep}`;
    if (realFile !== realRoot && !realFile.startsWith(rootWithSeparator)) {
      throw new HttpError(403, "Media path is outside the OpenClaw media directory", "MEDIA_PATH_FORBIDDEN");
    }
    const stat = await fs.promises.stat(realFile);
    if (!stat.isFile()) {
      throw new HttpError(404, "Media file not found", "MEDIA_NOT_FOUND");
    }

    return reply
      .type(mediaMimeType(realFile))
      .header("Content-Length", String(stat.size))
      .header("Content-Disposition", `inline; filename="${path.basename(realFile).replace(/"/g, "")}"`)
      .send(fs.createReadStream(realFile));
  });

  app.get("/api/chat/session-context", async (request) => {
    const parsed = sessionContextQuery.safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid session context query", "INVALID_QUERY", parsed.error.flatten());
    }
    const { sessionKey } = parsed.data;
    const response = await context.gateway.request<Record<string, unknown>>("sessions.list", {
      limit: 500,
      includeGlobal: true,
      includeUnknown: true,
    }, 30_000);
    const sessions = Array.isArray(response.sessions) ? response.sessions : [];
    const session = sessions.find((entry) => objectRecord(entry)?.key === sessionKey);
    const usage = withStoredTotalCacheRead(
      sessionContextFromGatewaySession(objectRecord(session)),
      totalCacheReadFromStoredMessages(context, sessionKey)
    );
    return {
      ok: true,
      sessionKey,
      usage,
      updatedAtMs: Date.now(),
    };
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
    const userVisibleAttachments = displayAttachments(input.attachments);
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
      text: rawMessage,
      ...(userVisibleAttachments ? { attachments: userVisibleAttachments } : {}),
      createdAt: nowIso,
      isOptimistic: true,
      __clientOptimistic: true,
      __openclaw: {
        id: clientMessageId,
        clientMessageId,
        idempotencyKey: input.idempotencyKey,
        runId,
        ...(userVisibleAttachments ? { preserveDisplayText: true } : {}),
      },
    };
    context.chatLive.addOptimisticUser(input.sessionKey, {
      id: clientMessage.__openclaw.id,
      text: rawMessage,
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
      lastMessageText: rawMessage,
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
        lastMessageText: rawMessage,
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

    if (isStopCommandText(rawMessage)) {
      log.info("send.stop-command.start", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, runId });
      void context.gateway.request<Record<string, unknown>>("chat.abort", { sessionKey: input.sessionKey, runId }, 30_000).catch((error) => {
        log.warn("send.stop-command.gateway-chat-abort.fail", { sessionKey: input.sessionKey, runId, ...errorMeta(error) });
      });
      void context.gateway.request<Record<string, unknown>>("sessions.abort", { key: input.sessionKey }, 30_000).catch((error) => {
        log.warn("send.stop-command.gateway-session-abort.fail", { sessionKey: input.sessionKey, runId, ...errorMeta(error) });
      });

      context.runs.updateRunStatus(runId, "aborted", { statusLabel: null });
      const completedTools = context.runs.completeRunningTools(input.sessionKey, runId, { status: "error", resultMeta: { reason: "aborted" }, updatedAtMs: nowMs() });
      const abortedRun = context.runs.getRun(runId);
      const abortMessageId = `${clientMessageId}:abort-confirmation`;
      const abortMessageSeq = context.messages.nextMessageSeq(input.sessionKey);
      const abortCreatedAtMs = Date.now();
      const abortMessage = {
        role: "assistant",
        text: "⚙️ Agent was aborted.",
        createdAt: new Date(abortCreatedAtMs).toISOString(),
        __openclaw: {
          id: abortMessageId,
          seq: abortMessageSeq,
          runId,
          preserveDisplayText: true,
        },
      };
      context.messages.insertOptimisticMessage({
        sessionKey: input.sessionKey,
        openclawSeq: abortMessageSeq,
        messageId: abortMessageId,
        role: "assistant",
        data: abortMessage,
        updatedAtMs: abortCreatedAtMs,
      });
      const abortMessageEvent = context.messages.appendProjectionEvent({
        sessionKey: input.sessionKey,
        eventType: "chat.message.upsert",
        payload: canonicalPatchPayload({
          sessionKey: input.sessionKey,
          semanticType: "chat.assistant.final",
          run: abortedRun,
          messageId: abortMessageId,
          payload: {
            sessionKey: input.sessionKey,
            message: abortMessage,
            messageSeq: abortMessageSeq,
            runId,
          },
        }),
      });
      context.patchBus.broadcast({
        cursor: abortMessageEvent.cursor,
        type: abortMessageEvent.eventType,
        sessionKey: abortMessageEvent.sessionKey,
        payload: abortMessageEvent.payload,
        createdAtMs: abortMessageEvent.createdAtMs,
      });
      const stopSession = context.messages.getSession(input.sessionKey);
      context.messages.upsertSession({
        sessionKey: input.sessionKey,
        sessionId: stopSession?.sessionId ?? null,
        data: {
          ...objectData(stopSession?.data),
          sessionKey: input.sessionKey,
          sessionId: stopSession?.sessionId ?? null,
          status: "aborted",
          statusLabel: null,
          lastActiveAt: nowIso,
          lastMessageAt: nowIso,
          lastMessageText: abortMessage.text,
        },
        updatedAtMs: abortCreatedAtMs,
      });
      const abortStatusEvent = context.messages.appendProjectionEvent({
        sessionKey: input.sessionKey,
        eventType: "chat.status",
        payload: canonicalPatchPayload({
          sessionKey: input.sessionKey,
          semanticType: "chat.run.aborted",
          run: abortedRun,
          payload: { completedTools, runId },
        }),
      });
      context.patchBus.broadcast({
        cursor: abortStatusEvent.cursor,
        type: abortStatusEvent.eventType,
        sessionKey: abortStatusEvent.sessionKey,
        payload: abortStatusEvent.payload,
        createdAtMs: abortStatusEvent.createdAtMs,
      });
      log.info("send.stop-command.end", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, runId, completedTools, abortMessageId });
      return { ok: true, accepted: true, stopped: true, sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, clientMessageId, runId };
    }

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
    log.info("bootstrap.start", { sessionKey: parsed.data.sessionKey });
    const gatewayHistoryStartedAtMs = nowMs();
    const history = await context.gateway.request<ChatHistoryResponse>("chat.history", {
      sessionKey: parsed.data.sessionKey,
    });
    const historyMessageCount = history.messages?.length ?? 0;
    log.info("bootstrap.gateway.history", { sessionKey: history.sessionKey ?? parsed.data.sessionKey, sessionId: history.sessionId ?? null, durationMs: elapsedMs(gatewayHistoryStartedAtMs), messageCount: historyMessageCount, status: history.status ?? null });

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

    const rawProjected = context.messages.listAllMessages(sessionKey);
    const projectedMessages = rawProjected
      .filter((message) => !isNonUserAttachedFileEcho(message))
      .map(serializeProjectedMessage);
    log.info("bootstrap.messages.read", { sessionKey, messageCount: projectedMessages.length });
    void context.chatLive.ensureSessionSubscribed(sessionKey).catch((error) => {
      log.warn("bootstrap.live-subscribe.background.fail", { sessionKey, error: errorMeta(error) });
    });
    context.messages.appendProjectionEvent({
      sessionKey,
      eventType: "chat.bootstrap",
      payload: { sessionKey, messageCount: projectedMessages.length, lastSeq: bootstrapLastSeq, historyCoverage: "full", fullMessagesIncluded: true, pruned: bootstrapPruned },
    });
    const sessionCursor = context.messages.latestSessionCursor(sessionKey);
    log.info("bootstrap.end", { sessionKey, sessionId: history.sessionId ?? null, totalDurationMs: elapsedMs(bootstrapStartedAtMs), messageCount: projectedMessages.length, status: typeof sessionData.status === "string" ? sessionData.status : null, cursor: sessionCursor, factors: { gatewayHistoryMs: elapsedMs(gatewayHistoryStartedAtMs), normalized: normalized.length, upserted: projection.upserted, liveSubscribed: "background" } });

    return buildChatBootstrapSnapshot(context, {
      sessionKey,
      sessionId: history.sessionId ?? existingSession?.sessionId ?? null,
      sessionData,
      messages: projectedMessages,
      messageCount: projectedMessages.length,
      cursor: sessionCursor,
      projection: { upserted: projection.upserted, lastSeq: bootstrapLastSeq, liveSubscribed: false },
      historyMeta: { thinkingLevel: history.thinkingLevel, fastMode: history.fastMode, verboseLevel: history.verboseLevel },
    });
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
    log.info("messages.read.start", { sessionKey: parsed.data.sessionKey, afterSeq: parsed.data.afterSeq ?? null, beforeSeq: parsed.data.beforeSeq ?? null, limit: parsed.data.limit });
    const hasWindowQuery =
      parsed.data.afterSeq !== undefined ||
      parsed.data.beforeSeq !== undefined ||
      parsed.data.limit !== undefined;
    const messages = hasWindowQuery
      ? context.messages.listMessages(parsed.data.sessionKey, {
          afterSeq: parsed.data.afterSeq,
          beforeSeq: parsed.data.beforeSeq,
          limit: parsed.data.limit,
        })
      : context.messages.listAllMessages(parsed.data.sessionKey);
    // Chat screen rebuild: older-message remote refill is disabled with the old virtualized loader.
    const sessionCursor = context.messages.latestSessionCursor(parsed.data.sessionKey);
    const visibleMessages = messages.filter((message) => !isNonUserAttachedFileEcho(message));
    log.info("messages.read.end", { sessionKey: parsed.data.sessionKey, messageCount: visibleMessages.length, cursor: sessionCursor });
    return {
      ok: true,
      source: "middleware-projection",
      sessionKey: parsed.data.sessionKey,
      messages: visibleMessages.map((message) => ({
        sessionKey: message.sessionKey,
        openclawSeq: message.openclawSeq,
        messageId: message.messageId,
        role: message.role,
        gatewaySeq: message.gatewaySeq,
        segmentId: message.segmentId,
        data: serializeProjectedMessage(message),
        updatedAtMs: message.updatedAtMs,
      })),
      messageCount: visibleMessages.length,
      cursor: sessionCursor,
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
