const REDACTED = "[redacted]";

const SECRET_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "apiKey",
  "password",
  "secret",
  "client_secret",
  "privateKey",
  "private_key",
  "signature",
]);

const CONTENT_KEYS = new Set([
  "message",
  "text",
  "content",
  "body",
  "prompt",
  "fileContents",
  "fileContent",
  "data_json",
]);

export type LogMeta = Record<string, unknown>;

type LogLevel = "info" | "warn" | "error";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shouldRedactKey(key: string) {
  const normalized = key.trim().toLowerCase();
  return SECRET_KEYS.has(key) || SECRET_KEYS.has(normalized) || normalized.includes("token") || normalized.includes("secret") || normalized.includes("authorization") || normalized.includes("cookie") || CONTENT_KEYS.has(key) || CONTENT_KEYS.has(normalized);
}

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[max-depth]";
  if (value instanceof Error) return { name: value.name, message: redactErrorMessage(value.message) };
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactLogValue(item, depth + 1));
  if (!isPlainObject(value)) return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = shouldRedactKey(key) ? REDACTED : redactLogValue(child, depth + 1);
  }
  return redacted;
}

export function redactErrorMessage(message: unknown): string {
  const raw = typeof message === "string" ? message : String(message ?? "");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+\-/=]+/gi, "Bearer [redacted]")
    .replace(/(token|api[_-]?key|authorization|cookie|secret)=([^\s&]+)/gi, "$1=[redacted]")
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "[redacted]")
    .slice(0, 500);
}

export function errorMeta(error: unknown): LogMeta {
  if (error instanceof Error) return { errorKind: error.name, errorMessage: redactErrorMessage(error.message) };
  return { errorKind: typeof error, errorMessage: redactErrorMessage(error) };
}

export function safePathFromUrl(url: string | undefined): string {
  if (!url) return "";
  const path = url.split("?", 1)[0] || "/";
  return path.slice(0, 300);
}

export function safeUrlForLog(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return safePathFromUrl(url);
  }
}

export function createLogger(scope: string) {
  const write = (level: LogLevel, event: string, meta?: unknown) => {
    const sanitized = meta === undefined ? undefined : redactLogValue(meta);
    const suffix = sanitized === undefined ? "" : ` ${JSON.stringify(sanitized)}`;
    const line = `[mw-v2:${scope}] ${event}${suffix}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    info(event: string, meta?: LogMeta) { write("info", event, meta); },
    warn(event: string, meta?: LogMeta) { write("warn", event, meta); },
    error(event: string, meta?: LogMeta) { write("error", event, meta); },
  };
}
