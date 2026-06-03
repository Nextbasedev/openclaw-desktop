import type { OCPlatformMessageData } from "../sync/types.contract";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Extract display text from an OCPlatform message body.
 * Kept in sync with middleware message-normalizer.textFromMessage.
 */
export function textFromMessage(message: OCPlatformMessageData | undefined | null): string {
  if (!message) return "";
  if (typeof message.text === "string") return message.text;
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (isObject(block) && typeof block.text === "string") return block.text;
        return "";
      })
      .join("");
  }
  return "";
}

export function readRole(message: OCPlatformMessageData | undefined | null, fallback = "assistant"): string {
  if (!message) return fallback;
  if (typeof message.role === "string" && message.role) return message.role;
  return fallback;
}

export function readMessageId(message: OCPlatformMessageData | undefined | null): string | null {
  if (!message) return null;
  if (typeof message.messageId === "string" && message.messageId) return message.messageId;
  const oc = message.__openclaw;
  if (oc && typeof oc.id === "string" && oc.id) return oc.id;
  return null;
}

export function readSeq(message: OCPlatformMessageData | undefined | null): number | null {
  const oc = message?.__openclaw;
  if (oc && typeof oc.seq === "number" && Number.isFinite(oc.seq)) return oc.seq;
  return null;
}

export function readRunId(message: OCPlatformMessageData | undefined | null): string | null {
  const oc = message?.__openclaw;
  if (oc && typeof oc.runId === "string" && oc.runId) return oc.runId;
  return null;
}

export function readClientMessageId(message: OCPlatformMessageData | undefined | null): string | null {
  const oc = message?.__openclaw;
  if (oc && typeof oc.clientMessageId === "string" && oc.clientMessageId) return oc.clientMessageId;
  if (typeof message?.clientMessageId === "string" && message.clientMessageId) return message.clientMessageId as string;
  return null;
}

/**
 * Append-only continuation guard for streaming text.
 * Returns true when `next` is a continuation/extension of `prev` (or prev empty),
 * so the reveal animation never needs to blank and restart.
 */
export function isContinuation(prev: string, next: string): boolean {
  if (!prev) return true;
  return next.startsWith(prev);
}
