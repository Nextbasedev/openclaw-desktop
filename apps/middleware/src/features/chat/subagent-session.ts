export const SUBAGENT_SESSION_KEY_RE = /agent:[^\s"',}\]]+(?::[^\s"',}\]]+)*:subagent:[^\s"',}\]]+/g;
const SUBAGENT_SESSION_KEY_EXACT_RE = /^agent:[^\s"',}\]]+(?::[^\s"',}\]]+)*:subagent:[^\s"',}\]]+$/;
const AGENT_SESSION_KEY_EXACT_RE = /^agent:[^\s"',}\]]+(?::[^\s"',}\]]+)+$/;

export function isSubagentSessionKey(value: string | null | undefined): value is string {
  return Boolean(value && SUBAGENT_SESSION_KEY_EXACT_RE.test(value));
}

function isAgentSessionKey(value: string | null | undefined): value is string {
  return Boolean(value && AGENT_SESSION_KEY_EXACT_RE.test(value));
}

function explicitChildSessionKey(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const childSessionKey = (value as Record<string, unknown>).childSessionKey;
  return typeof childSessionKey === "string" && isAgentSessionKey(childSessionKey)
    ? childSessionKey
    : null;
}

function sessionKeyFromString(value: string): string | null {
  const direct = value.match(SUBAGENT_SESSION_KEY_RE)?.[0];
  if (direct) return direct;

  const childKeyMatch = value.match(/"childSessionKey"\s*:\s*"([^"]+)"/);
  if (childKeyMatch?.[1] && isAgentSessionKey(childKeyMatch[1])) return childKeyMatch[1];

  const sessionKeyMatch = value.match(/"sessionKey"\s*:\s*"([^"]+)"/);
  if (sessionKeyMatch?.[1] && isSubagentSessionKey(sessionKeyMatch[1])) return sessionKeyMatch[1];

  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return extractSubagentSessionKey(JSON.parse(trimmed) as unknown);
  } catch {
    return null;
  }
}

export function extractSubagentSessionKey(value: unknown): string | null {
  if (typeof value === "string") return sessionKeyFromString(value);
  if (!value || typeof value !== "object") return null;

  const seen = new Set<object>();
  const queue: unknown[] = [value];
  while (queue.length > 0) {
    const current = queue.shift();
    if (typeof current === "string") {
      const key = sessionKeyFromString(current);
      if (key) return key;
      continue;
    }
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    const childSessionKey = explicitChildSessionKey(current);
    if (childSessionKey) return childSessionKey;

    const record = current as Record<string, unknown>;
    const candidateSessionKey = record.sessionKey;
    if (typeof candidateSessionKey === "string" && isSubagentSessionKey(candidateSessionKey)) return candidateSessionKey;

    for (const child of Object.values(record)) {
      if (typeof child === "string" || (child && typeof child === "object")) queue.push(child);
    }
  }
  return null;
}

export function extractSubagentSessionKeys(value: unknown): string[] {
  const keys = new Set<string>();

  function visit(current: unknown, seen: Set<object>) {
    if (typeof current === "string") {
      for (const match of current.matchAll(SUBAGENT_SESSION_KEY_RE)) keys.add(match[0]);
      const parsed = sessionKeyFromString(current);
      if (parsed) keys.add(parsed);
      return;
    }
    if (!current || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);

    const childSessionKey = explicitChildSessionKey(current);
    if (childSessionKey) keys.add(childSessionKey);

    const record = current as Record<string, unknown>;
    const candidateSessionKey = record.sessionKey;
    if (typeof candidateSessionKey === "string" && isSubagentSessionKey(candidateSessionKey)) keys.add(candidateSessionKey);
    for (const child of Object.values(record)) visit(child, seen);
  }

  visit(value, new Set());
  return Array.from(keys);
}
