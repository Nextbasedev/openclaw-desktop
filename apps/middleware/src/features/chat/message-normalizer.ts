import type { OpenClawMessage, ProjectedMessage } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function textFromMessage(message: OpenClawMessage): string {
  if (typeof message.text === "string") return message.text;
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (typeof block === "string") return block;
      if (isObject(block) && typeof block.text === "string") return block.text;
      return "";
    }).join("");
  }
  return "";
}

export function normalizeMessageText(value: string): string {
  return value
    .replace(/^Sender \(untrusted metadata\):\s*```(?:json)?\s*[\s\S]*?```\s*/i, "")
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:UTC|GMT[+-]\d{1,2}:?\d{2})\]\s*/i, "")
    .replace(/^\[Attached images?:[^\]]+\]\s*/gim, "")
    .replace(/^\[Attached audio(?: file)?:[^\]]+\]\s*/gim, "")
    .replace(/^\[Attached file:[^\]]+\]\s*/gim, "")
    .replace(/<attached-file\b[\s\S]*?<\/attached-file>/gi, "")
    .replace(/\n\n\[Bootstrap truncation warning\][\s\S]*$/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function messageTextMatchesSent(candidateText: string, sentText: string): boolean {
  const candidate = normalizeMessageText(candidateText);
  const sent = normalizeMessageText(sentText);
  if (!candidate || !sent) return false;
  return candidate === sent || candidate.endsWith(` ${sent}`);
}

export function readOpenClawSeq(message: OpenClawMessage, fallbackSeq: number): number {
  const seq = message.__openclaw?.seq;
  return typeof seq === "number" && Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : fallbackSeq;
}

export function readOpenClawMessageId(message: OpenClawMessage): string | null {
  const id = message.__openclaw?.id ?? message.messageId ?? message.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function readMessageTimestampMs(message: OpenClawMessage, fallbackMs: number): number {
  const value = message.timestamp ?? message.createdAt ?? message.created_at ?? message.updatedAt ?? message.updated_at;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 1_000_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 0 && numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallbackMs;
}

export function normalizeHistoryMessages(sessionKey: string, messages: unknown[], nowMs = Date.now(), firstFallbackSeq = 1): ProjectedMessage[] {
  return messages
    .filter((message): message is OpenClawMessage => Boolean(message) && typeof message === "object" && !Array.isArray(message))
    .map((message, index) => ({
      sessionKey,
      openclawSeq: readOpenClawSeq(message, firstFallbackSeq + index),
      messageId: readOpenClawMessageId(message),
      role: typeof message.role === "string" ? message.role : null,
      data: message,
      updatedAtMs: readMessageTimestampMs(message, nowMs),
    }));
}
