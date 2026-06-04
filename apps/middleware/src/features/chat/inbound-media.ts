import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../../app.js";

const INBOUND_MEDIA_ID_RE = /^[^\s/\\\0]+$/u;
const MEDIA_ATTACHMENT_MARKER_CAPTURE_RE = /\[media attached:\s*([^\]]+)\]/gim;
const inboundMediaSourceById = new Map<string, string>();

export type InboundChatMedia = {
  id: string;
  path: string;
  mimeType: string;
  content: Buffer;
};

function inboundMediaDir() {
  return path.join(process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw"), "media", "inbound");
}

function isSafeInboundMediaId(id: string) {
  return Boolean(id) && id !== ".." && !id.includes("..") && !id.includes("/") && !id.includes("\\") && !id.includes("\0") && INBOUND_MEDIA_ID_RE.test(id);
}

function mediaMimeTypeFromFileName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function inboundMediaIdFromPath(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();

  if (trimmed.startsWith("media://")) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname !== "inbound") return null;
      const id = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
      return isSafeInboundMediaId(id) ? id : null;
    } catch {
      return null;
    }
  }

  const dir = inboundMediaDir();
  const filePath = path.resolve(trimmed);
  const relative = path.relative(dir, filePath);
  const id = path.basename(filePath);
  if (!isSafeInboundMediaId(id)) return null;

  // Prefer the strict local-state-dir match when it applies, but do not require it:
  // chat.history comes from the gateway and can contain absolute paths from a
  // different host/user/state dir than this middleware process.
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return id;
  return isSafeInboundMediaId(id) ? id : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function textValuesFromContent(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    if (typeof block === "string") return [block];
    if (!block || typeof block !== "object" || Array.isArray(block)) return [];
    const record = block as Record<string, unknown>;
    const values: string[] = [];
    if (typeof record.text === "string") values.push(record.text);
    if (typeof record.content === "string") values.push(record.content);
    return values;
  });
}

function inboundMediaSourcesFromText(text: string) {
  const sources: string[] = [];
  let match: RegExpExecArray | null;
  MEDIA_ATTACHMENT_MARKER_CAPTURE_RE.lastIndex = 0;
  while ((match = MEDIA_ATTACHMENT_MARKER_CAPTURE_RE.exec(text)) !== null) {
    const source = match[1]?.trim();
    if (source) sources.push(source);
  }
  return sources;
}

function defaultInboundMediaSourceForId(id: string) {
  return path.join(inboundMediaDir(), id);
}

function cacheInboundMediaSource(id: string, source: string) {
  if (!source.trim()) return;
  if (source.trim().toLowerCase().startsWith("media://inbound/")) {
    inboundMediaSourceById.set(id, defaultInboundMediaSourceForId(id));
    return;
  }
  inboundMediaSourceById.set(id, source.trim());
}

function inboundMediaIdsFromHistoryMessage(message: { MediaPath?: string; MediaPaths?: string[]; content?: unknown; text?: string }) {
  const rawPaths = Array.isArray(message.MediaPaths) ? message.MediaPaths : typeof message.MediaPath === "string" ? [message.MediaPath] : [];
  const textSources = [
    ...(typeof message.text === "string" ? inboundMediaSourcesFromText(message.text) : []),
    ...textValuesFromContent(message.content).flatMap(inboundMediaSourcesFromText),
  ];
  const ids: string[] = [];
  for (const rawPath of [...rawPaths, ...textSources]) {
    const id = inboundMediaIdFromPath(rawPath);
    if (!id) continue;
    ids.push(id);
    if (typeof rawPath === "string" && rawPath.trim()) cacheInboundMediaSource(id, rawPath);
  }
  return uniqueStrings(ids);
}

function addMediaIdsToOmittedImageBlocks(content: unknown, mediaIds: string[]) {
  if (!Array.isArray(content) || mediaIds.length === 0) return content;
  let nextImageIndex = 0;
  return content.map((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return block;
    const record = block as Record<string, unknown>;
    if (record.type !== "image" || record.omitted !== true || typeof record.mediaId === "string") return block;
    const mediaId = mediaIds[nextImageIndex];
    nextImageIndex += 1;
    return mediaId ? { ...record, mediaId } : block;
  });
}

export function enrichInboundMediaMessages(messages: unknown[]) {
  return messages.map((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return message;
    const record = message as Record<string, unknown>;
    const mediaIds = inboundMediaIdsFromHistoryMessage(record as { MediaPath?: string; MediaPaths?: string[]; content?: unknown; text?: string });
    if (mediaIds.length === 0) return message;
    const content = addMediaIdsToOmittedImageBlocks(record.content, mediaIds);
    return { ...record, content, mediaIds };
  });
}

function inboundMediaAuthToken(context: AppContext) {
  return (context.config.middlewareToken ?? process.env.MIDDLEWARE_TOKEN ?? process.env.JARVIS_SERVER_TOKEN ?? "").trim();
}

function isInboundMediaRequestAuthorized(request: FastifyRequest, context: AppContext) {
  const expectedToken = inboundMediaAuthToken(context);
  if (!expectedToken) return true;
  const authorization = request.headers.authorization?.trim() ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const query = request.query as Record<string, unknown> | undefined;
  const queryToken = typeof query?.token === "string" ? query.token.trim() : "";
  return bearer === expectedToken || queryToken === expectedToken;
}

export async function readInboundChatMedia(id: string): Promise<InboundChatMedia | null> {
  if (!isSafeInboundMediaId(id)) {
    const error = new Error("Invalid media id");
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }

  const dir = inboundMediaDir();
  const filePath = path.join(dir, id);
  const relative = path.relative(dir, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    const error = new Error("Invalid media id");
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }

  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (stat.isSymbolicLink()) return null;
  if (!stat.isFile()) return null;

  return {
    id,
    path: filePath,
    mimeType: mediaMimeTypeFromFileName(id),
    content: await fs.readFile(filePath),
  };
}

function gatewayHttpUrlFromWebSocketUrl(gatewayUrl: string) {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/__openclaw__/assistant-media";
  url.search = "";
  url.hash = "";
  return url;
}

function gatewayFallbackSourcesForInboundMedia(id: string) {
  return uniqueStrings([
    inboundMediaSourceById.get(id),
    defaultInboundMediaSourceForId(id),
    path.join(os.homedir(), ".openclaw", "media", "inbound", id),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0));
}

async function fetchInboundChatMediaFromGateway(id: string, context: AppContext): Promise<InboundChatMedia | null> {
  const sources = gatewayFallbackSourcesForInboundMedia(id);
  if (sources.length === 0) return null;

  for (const source of sources) {
    const url = gatewayHttpUrlFromWebSocketUrl(context.config.openclawGatewayUrl);
    url.searchParams.set("source", source);

    const response = await fetch(url, {
      headers: context.config.openclawGatewayToken ? { Authorization: `Bearer ${context.config.openclawGatewayToken}` } : undefined,
    });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`gateway media fetch failed: HTTP ${response.status}`);

    const content = Buffer.from(await response.arrayBuffer());
    inboundMediaSourceById.set(id, source);
    return {
      id,
      path: source,
      mimeType: response.headers.get("content-type") ?? mediaMimeTypeFromFileName(id),
      content,
    };
  }

  return null;
}

export async function inboundChatMediaRoute(request: FastifyRequest, reply: FastifyReply, context: AppContext) {
  if (!isInboundMediaRequestAuthorized(request, context)) {
    reply.code(401).send({ error: "Unauthorized" });
    return;
  }

  const params = request.params as { id?: string } | undefined;
  const id = params?.id ?? "";
  let media: InboundChatMedia | null;
  try {
    media = await readInboundChatMedia(id);
    if (!media) media = await fetchInboundChatMediaFromGateway(id, context);
  } catch (error) {
    if ((error as Error & { statusCode?: number }).statusCode === 400) {
      reply.code(400).send({ error: "Invalid media id" });
      return;
    }
    throw error;
  }

  if (!media) {
    reply.code(404).send({ error: "Media not found" });
    return;
  }

  reply.header("Content-Type", media.mimeType);
  reply.header("Content-Length", media.content.length);
  reply.header("Cache-Control", "private, max-age=31536000, immutable");
  reply.send(media.content);
}
