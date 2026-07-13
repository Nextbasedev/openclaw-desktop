import { execFileSync, spawn as spawnChild, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { IPty } from "node-pty";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";
import { createLogger } from "../../lib/logger.js";
import { ensureGatewayHistoryProjected, prewarmArchivedHistory } from "../chat/routes.js";
import {
  getActiveSkills,
  getSkillEnabledMap,
  installSkill,
  skillsDetail,
  skillsDiscover,
  skillsInstalledLocal,
  skillsVersions,
  toggleSkill,
  uninstallSkill,
} from "../skills/service.js";
import { fromJson, toJson } from "../../db/json.js";
import { HttpError } from "../../lib/errors.js";
import { normalizeHistoryMessages, readOpenClawMessageId } from "../chat/message-normalizer.js";

type CompatRecord = Record<string, any>;

const nowIso = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

type SlashCommandEntry = {
  name: string;
  nativeName?: string;
  textAliases?: string[];
  description: string;
  category?: string;
  source: "native" | "skill" | "plugin";
  scope: "text" | "native" | "both";
  acceptsArgs: boolean;
};

const DESKTOP_NATIVE_SLASH_COMMANDS: SlashCommandEntry[] = [
  {
    name: "status",
    description: "Show the current OpenClaw session status",
    category: "system",
    source: "native",
    scope: "native",
    acceptsArgs: false,
  },
];

function isSlashCommandEntry(value: unknown): value is SlashCommandEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.name === "string"
    && typeof item.description === "string"
    && (item.source === "native" || item.source === "skill" || item.source === "plugin")
    && (item.scope === "text" || item.scope === "native" || item.scope === "both")
    && typeof item.acceptsArgs === "boolean";
}

function slashCommandMatchesScope(command: SlashCommandEntry, scope: unknown) {
  if (scope !== "native" && scope !== "text" && scope !== "both") return true;
  return command.scope === scope || command.scope === "both" || scope === "both";
}

function withDesktopNativeCommands(commands: SlashCommandEntry[], input: CompatRecord) {
  const seen = new Set(commands.map((command) => command.name.toLowerCase()));
  const supplemental = DESKTOP_NATIVE_SLASH_COMMANDS
    .filter((command) => slashCommandMatchesScope(command, input.scope))
    .filter((command) => !seen.has(command.name.toLowerCase()));
  return [...commands, ...supplemental];
}

async function dynamicCommandsList(context: AppContext, input: CompatRecord) {
  try {
    const response = await context.gateway.request<unknown>("commands.list", {
      agentId: typeof input.agentId === "string" ? input.agentId : undefined,
      provider: typeof input.provider === "string" ? input.provider : undefined,
      scope: input.scope === "native" || input.scope === "text" || input.scope === "both" ? input.scope : undefined,
      includeArgs: typeof input.includeArgs === "boolean" ? input.includeArgs : undefined,
    }, 5_000);
    const payload = response && typeof response === "object" && "payload" in response
      ? (response as { payload?: unknown }).payload
      : response;
    const commands = payload && typeof payload === "object" && Array.isArray((payload as { commands?: unknown }).commands)
      ? (payload as { commands: unknown[] }).commands.filter(isSlashCommandEntry)
      : [];
    return { commands: withDesktopNativeCommands(commands, input) };
  } catch (error) {
    createLogger("compat").warn("commands.list.failed", { error: error instanceof Error ? error.message : String(error) });
    return { commands: withDesktopNativeCommands([], input) };
  }
}
const shortSessionId = (sessionKey: string) => (sessionKey.split(":").pop() || sessionKey).replace(/[^a-zA-Z0-9_-]/g, "").slice(-8) || Date.now().toString(36);
const isMissingApprovalError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /approval/i.test(message) && /(not found|missing|unknown|no pending|no such)/i.test(message);
};
const gatewaySessionLabel = (label: unknown, sessionKey: string) => {
  const base = rawSessionLabel(label);
  return `${base} · ${shortSessionId(sessionKey)}`;
};
const rawSessionLabel = (label: unknown) => String(label || "New Chat").replace(/\s+/g, " ").trim().slice(0, 60) || "New Chat";

const FILE_NAMING_GROQ_MODEL = "llama-3.1-8b-instant";
const FILE_NAMING_GROQ_DB_KEY = "file_naming.groq";
const FILE_NAMING_GROQ_TIMEOUT_MS = 2_500;

function readSecretSetting(context: AppContext | undefined, key: string) {
  if (!context) return undefined;
  try {
    const row = context.db.prepare("SELECT value_json FROM v2_secret_settings WHERE key = ?").get(key) as { value_json?: string } | undefined;
    return row?.value_json ? JSON.parse(row.value_json) as CompatRecord : undefined;
  } catch {
    return undefined;
  }
}

function writeSecretSetting(context: AppContext, key: string, value: CompatRecord) {
  context.db.prepare(`
    INSERT INTO v2_secret_settings(key, value_json, updated_at_ms)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms
  `).run(key, toJson(value), Date.now());
}

function deleteSecretSetting(context: AppContext, key: string) {
  context.db.prepare("DELETE FROM v2_secret_settings WHERE key = ?").run(key);
}

function fileNamingConfig(cfg: CompatRecord, context?: AppContext) {
  const stored = readSecretSetting(context, FILE_NAMING_GROQ_DB_KEY);
  const naming = cfg.tools?.fileNaming && typeof cfg.tools.fileNaming === "object" ? cfg.tools.fileNaming : {};
  const groq = naming.groq && typeof naming.groq === "object" ? naming.groq : {};
  const apiKey = String(stored?.apiKey || groq.apiKey || cfg.env?.vars?.GROQ_API_KEY_FILE_NAMING || "").trim();
  const enabled = (stored ? stored.enabled !== false : groq.enabled !== false) && Boolean(apiKey);
  return { enabled, apiKey, model: String(stored?.model || groq.model || FILE_NAMING_GROQ_MODEL).trim() || FILE_NAMING_GROQ_MODEL };
}

function maskedApiKey(value: string) {
  return value ? `••••${value.slice(-4)}` : null;
}

function fileNamingSettingsPayload(context?: AppContext) {
  const cfg = readOCPlatformConfig();
  const naming = fileNamingConfig(cfg, context);
  return { ok: true, settings: { provider: "groq", enabled: naming.enabled, connected: Boolean(naming.apiKey), model: naming.model, keyPreview: maskedApiKey(naming.apiKey) } };
}

async function validateGroqApiKey(apiKey: string, model: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FILE_NAMING_GROQ_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1,
        messages: [{ role: "user", content: "Return OK" }],
      }),
    });
    if (!response.ok) throw new Error(`Groq API key validation failed (${response.status})`);
  } finally {
    clearTimeout(timeout);
  }
}

async function writeFileNamingGroqSettings(context: AppContext, input: CompatRecord) {
  const key = String(input.apiKey || input.key || input.values?.["api-key"] || input.values?.apiKey || "").trim();
  if (!key) return { ok: false, error: { message: "Groq API key is required" } };
  const model = String(input.model || FILE_NAMING_GROQ_MODEL).trim() || FILE_NAMING_GROQ_MODEL;
  try {
    await validateGroqApiKey(key, model);
  } catch (error) {
    return { ok: false, error: { message: error instanceof Error ? error.message : "Invalid Groq API key" } };
  }
  writeSecretSetting(context, FILE_NAMING_GROQ_DB_KEY, { apiKey: key, enabled: input.enabled !== false, model });
  const cfg = readOCPlatformConfig();
  cfg.tools ??= {};
  cfg.tools.fileNaming ??= {};
  if (cfg.env?.vars?.GROQ_API_KEY_FILE_NAMING) delete cfg.env.vars.GROQ_API_KEY_FILE_NAMING;
  cfg.tools.fileNaming.groq = { enabled: input.enabled !== false, model };
  writeOCPlatformConfig(cfg);
  return fileNamingSettingsPayload(context);
}

function removeFileNamingGroqSettings(context?: AppContext) {
  if (context) deleteSecretSetting(context, FILE_NAMING_GROQ_DB_KEY);
  const cfg = readOCPlatformConfig();
  if (cfg.tools?.fileNaming?.groq) {
    delete cfg.tools.fileNaming.groq;
    if (Object.keys(cfg.tools.fileNaming).length === 0) delete cfg.tools.fileNaming;
  }
  if (cfg.env?.vars?.GROQ_API_KEY_FILE_NAMING) delete cfg.env.vars.GROQ_API_KEY_FILE_NAMING;
  writeOCPlatformConfig(cfg);
  return fileNamingSettingsPayload(context);
}

function sanitizeGeneratedFileName(value: unknown) {
  const cleaned = String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^title\s*:\s*/i, "")
    .replace(/["'`]/g, "")
    .replace(/[^a-zA-Z0-9 _.-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const extensionMatch = cleaned.match(/^(.+?\.(?:js|jsx|ts|tsx|py|md|json|csv|txt|sh|html|css|sql|ya?ml))\b/i);
  if (extensionMatch?.[1]) return extensionMatch[1].slice(0, 60);
  const codeWordIndex = cleaned.search(/\b(?:javascript|typescript|const|let|var|function|import|require|class|return)\b/i);
  const filename = (codeWordIndex > 0 ? cleaned.slice(0, codeWordIndex) : cleaned).trim();
  if (/^(new chat|untitled|conversation)$/i.test(filename)) return "";
  const words = filename.split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  return words.slice(0, 60);
}

function fallbackFileNameFromPrompt(prompt: unknown) {
  return rawSessionLabel(prompt);
}

async function groqFileNameFromPrompt(prompt: unknown, context?: AppContext) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!text) return fallbackFileNameFromPrompt(prompt);
  const cfg = readOCPlatformConfig();
  const naming = fileNamingConfig(cfg, context);
  if (!naming.enabled) return fallbackFileNameFromPrompt(prompt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FILE_NAMING_GROQ_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${naming.apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: naming.model,
        temperature: 0.2,
        max_tokens: 24,
        messages: [
          { role: "system", content: "Create a concise, meaningful file/chat title from the user's first prompt. Return only 4-8 human-readable words. No quotes, invalid filename characters, generic names like New Chat/Untitled/Conversation, explanations, or alternatives." },
          { role: "user", content: text.slice(0, 2000) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Groq filename request failed: ${response.status}`);
    const data = await response.json() as CompatRecord;
    const generated = sanitizeGeneratedFileName(data?.choices?.[0]?.message?.content);
    return generated || fallbackFileNameFromPrompt(prompt);
  } catch (error) {
    createLogger("compat").warn("file_naming.groq_failed", { error: error instanceof Error ? error.message : String(error) });
    return fallbackFileNameFromPrompt(prompt);
  } finally {
    clearTimeout(timeout);
  }
}

async function smartGatewaySessionLabel(label: unknown, sessionKey: string, context?: AppContext) {
  return gatewaySessionLabel(await groqFileNameFromPrompt(label, context), sessionKey);
}

type CompatTerminal = {
  id: string;
  proc: IPty;
  cwd: string;
  buffer: string[];
  listeners: Set<(event: string, payload: CompatRecord) => void>;
};


const cronSseClients = new Set<{ write: (event: string, payload: CompatRecord) => void }>();

function emitCronEvent(event: CompatRecord) {
  for (const client of [...cronSseClients]) {
    try { client.write("data", event); } catch { /* client closed */ }
  }
}

function readPackageVersion(packagePath: string, fallback = "0.1.0") {
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return String(pkg.version || fallback);
  } catch {
    return fallback;
  }
}

function readOpenClawVersion() {
  try {
    const output = execFileSync("openclaw", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1_500,
    });
    const match = output.match(/OpenClaw\s+([^\s]+)/i);
    if (match?.[1]) return match[1];
  } catch { /* fall through */ }

  const globalVersion = readPackageVersion("/usr/lib/node_modules/openclaw/package.json", "");
  return globalVersion || null;
}

function isoFromMs(value: unknown, fallbackMs = Date.now()) {
  const ms = typeof value === "number" && Number.isFinite(value) ? value : fallbackMs;
  return new Date(ms).toISOString();
}

function everyMsFromSchedule(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(1, Math.floor(value));
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/^(\d+)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
  if (!match) return 60_000;
  const amount = Math.max(1, Number(match[1]));
  const unit = match[2] || "m";
  if (unit === "ms") return amount;
  if (["s", "sec", "secs", "second", "seconds"].includes(unit)) return amount * 1_000;
  if (["h", "hr", "hrs", "hour", "hours"].includes(unit)) return amount * 3_600_000;
  if (["d", "day", "days"].includes(unit)) return amount * 86_400_000;
  return amount * 60_000;
}

function timeZoneOffsetMs(timeZone: string, utcMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  let hour = value("hour");
  if (hour === 24) hour = 0;
  const asUtcMs = Date.UTC(value("year"), value("month") - 1, value("day"), hour, value("minute"), value("second"));
  return asUtcMs - utcMs;
}

function atScheduleToIso(schedule: unknown, timezone: unknown) {
  const text = String(schedule || "").trim();
  const parsed = new Date(text);
  if (!text || Number.isNaN(parsed.getTime())) throw new Error("Invalid one-time cron schedule.");
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) return parsed.toISOString();

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return parsed.toISOString();

  const tz = String(timezone || "Asia/Kolkata");
  const [, year, month, day, hour, minute, second = "0"] = match;
  const localAsUtcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  let utcMs = localAsUtcMs - timeZoneOffsetMs(tz, localAsUtcMs);
  utcMs = localAsUtcMs - timeZoneOffsetMs(tz, utcMs);
  return new Date(utcMs).toISOString();
}

function scheduleToGateway(input: CompatRecord, existing?: CompatRecord) {
  const type = String(input.scheduleType ?? existing?.scheduleType ?? "cron");
  const schedule = input.schedule ?? existing?.schedule ?? "0 * * * *";
  if (type === "at") return { kind: "at", at: atScheduleToIso(schedule, input.timezone ?? existing?.timezone) };
  if (type === "every") return { kind: "every", everyMs: everyMsFromSchedule(schedule) };
  return { kind: "cron", expr: String(schedule || "0 * * * *"), tz: input.timezone ?? existing?.timezone ?? "Asia/Kolkata" };
}

function gatewayScheduleToCompat(schedule: CompatRecord | undefined) {
  if (!schedule || typeof schedule !== "object") return { scheduleType: "cron", schedule: "0 * * * *", timezone: "Asia/Kolkata" };
  if (schedule.kind === "at") return { scheduleType: "at", schedule: String(schedule.at || ""), timezone: null };
  if (schedule.kind === "every") {
    const everyMs = Number(schedule.everyMs || 0);
    const minutes = everyMs > 0 ? Math.max(1, Math.floor(everyMs / 60_000)) : 1;
    return { scheduleType: "every", schedule: `${minutes}m`, timezone: null };
  }
  return { scheduleType: "cron", schedule: String(schedule.expr || "0 * * * *"), timezone: schedule.tz ?? "Asia/Kolkata" };
}

function gatewaySessionToCompat(job: CompatRecord) {
  const target = String(job.sessionTarget ?? "isolated");
  if (target.startsWith("session:")) return target.slice("session:".length);
  return target;
}

function gatewayRunToCompat(run: CompatRecord, job?: CompatRecord) {
  const rawStatus = String(run.status || run.lastRunStatus || "completed").toLowerCase();
  const status = rawStatus === "ok" ? "completed" : rawStatus === "error" ? "failed" : rawStatus;
  const runAtMs = typeof run.runAtMs === "number" ? run.runAtMs : typeof run.ts === "number" ? run.ts : Date.now();
  const finishedMs = typeof run.ts === "number" ? run.ts : typeof run.finishedAtMs === "number" ? run.finishedAtMs : runAtMs;
  const runId = String(run.runId || run.sessionId || `${run.jobId || job?.id || "cron"}-${runAtMs}`);
  return {
    id: runId,
    runId,
    jobId: String(run.jobId || job?.id || job?.jobId || ""),
    status,
    startedAt: isoFromMs(runAtMs),
    finishedAt: status === "running" ? null : isoFromMs(finishedMs, runAtMs),
    result: run.summary ?? run.result ?? null,
    error: run.error ?? (status === "failed" ? run.summary ?? null : null),
    sessionKey: run.sessionKey ?? null,
    durationMs: run.durationMs ?? null,
    deliveryStatus: run.deliveryStatus ?? null,
  };
}

function cronEventFromRun(run: CompatRecord, job?: CompatRecord) {
  const compat = gatewayRunToCompat(run, job);
  return {
    type: compat.status === "running" ? "cron.run.started" : compat.status === "failed" ? "cron.run.failed" : "cron.run.completed",
    jobId: compat.jobId,
    runId: compat.runId,
    sessionKey: compat.sessionKey,
    name: job?.name ?? run.jobName ?? undefined,
    status: compat.status,
    timestamp: compat.finishedAt ?? compat.startedAt,
    result: compat.result,
    error: compat.error,
  };
}

function gatewayJobToCompat(job: CompatRecord, lastRun?: CompatRecord | null) {
  const schedule = gatewayScheduleToCompat(job.schedule);
  const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
  const delivery = job.delivery && typeof job.delivery === "object" ? job.delivery : {};
  const state = job.state && typeof job.state === "object" ? job.state : {};
  const convertedLastRun = lastRun ? gatewayRunToCompat(lastRun, job) : state.lastRunAtMs ? gatewayRunToCompat({
    jobId: job.id,
    status: state.lastRunStatus || state.lastStatus || "ok",
    runAtMs: state.lastRunAtMs,
    ts: state.lastRunAtMs,
    sessionKey: state.lastSessionKey,
  }, job) : null;
  return {
    id: String(job.id || job.jobId),
    jobId: String(job.id || job.jobId),
    name: job.name ?? "Scheduled task",
    scheduleType: schedule.scheduleType,
    schedule: schedule.schedule,
    timezone: schedule.timezone,
    session: gatewaySessionToCompat(job),
    parentSessionKey: String(job.sessionTarget || "").startsWith("session:") ? gatewaySessionToCompat(job) : null,
    task: payload.message ?? payload.text ?? "",
    message: payload.message ?? payload.text ?? null,
    model: payload.model ?? null,
    enabled: job.enabled !== false,
    paused: job.enabled === false,
    status: job.enabled === false ? "paused" : "active",
    deleteAfterRun: Boolean(job.deleteAfterRun),
    deliveryMode: delivery.mode ?? null,
    deliveryChannel: delivery.channel ?? null,
    deliveryTo: delivery.to ?? null,
    params: { gateway: job },
    createdAt: isoFromMs(job.createdAtMs),
    updatedAt: isoFromMs(job.updatedAtMs ?? job.createdAtMs),
    lastRun: convertedLastRun,
  };
}

function compatJobToGateway(input: CompatRecord, existing?: CompatRecord) {
  const message = String(input.message ?? input.task ?? existing?.message ?? existing?.task ?? "").trim();
  const model = input.model ?? existing?.model;
  const session = String(input.session ?? existing?.session ?? "isolated");
  const deliveryMode = input.deliveryMode ?? existing?.deliveryMode;
  const delivery = deliveryMode ? {
    mode: deliveryMode,
    channel: input.deliveryChannel ?? existing?.deliveryChannel,
    to: input.deliveryTo ?? existing?.deliveryTo,
  } : undefined;
  const payload: CompatRecord = { kind: "agentTurn", message };
  if (model) payload.model = model;
  return {
    name: input.name ?? existing?.name ?? "Scheduled task",
    schedule: scheduleToGateway(input, existing),
    sessionTarget: session && session !== "isolated" && session !== "current" && session !== "main" ? `session:${session}` : session || "isolated",
    wakeMode: input.wakeMode ?? "now",
    payload,
    delivery,
    enabled: input.enabled ?? existing?.enabled ?? true,
    deleteAfterRun: Boolean(input.deleteAfterRun ?? existing?.deleteAfterRun ?? false),
  };
}

const compatState = {
  spaces: [] as CompatRecord[],
  activeSpaceId: null as string | null,
  chats: [] as CompatRecord[],
  projects: [] as CompatRecord[],
  topics: [] as CompatRecord[],
  sessions: [] as CompatRecord[],
  branches: [] as CompatRecord[],
  pins: [] as CompatRecord[],
  cronJobs: [] as CompatRecord[],
  cronRuns: [] as CompatRecord[],
  terminals: new Map<string, CompatTerminal>(),
  loadedDbPath: null as string | null,
};

const DEFAULT_SPACE_ID = "space_default";
const DEFAULT_SPACE_NAME = "My Workspace";
const spacePatchFields = new Set(["name", "iconEmoji", "icon_emoji", "iconImage", "ImageIcon", "imageIcon", "icon_image", "repoRoot", "projectId", "sortOrder", "archived", "deleted"]);

const compatCollections = ["spaces", "chats", "projects", "topics", "sessions", "branches", "pins", "cronJobs", "cronRuns"] as const;

type CompatCollection = typeof compatCollections[number];

type V1SqliteMigrationResult = {
  ok: true;
  sourcePath: string;
  targetPath: string;
  summary: {
    imported: number;
    updated: number;
    skipped: number;
    spaces: number;
    chats: number;
    projects: number;
    topics: number;
    sessions: number;
    branches: number;
    pins: number;
    cronJobs: number;
    cronRuns: number;
  };
};

function loadCompatState(context: AppContext) {
  if (compatState.loadedDbPath === context.config.databasePath) return;
  for (const collection of compatCollections) compatState[collection] = [];
  compatState.activeSpaceId = null;
  const rows = context.db.prepare("SELECT key, data_json FROM v2_compat_state").all() as Array<{ key: string; data_json: string }>;
  const byKey = new Map(rows.map((row) => [row.key, fromJson(row.data_json)]));
  for (const collection of compatCollections) {
    const value = byKey.get(collection);
    if (Array.isArray(value)) compatState[collection] = value as CompatRecord[];
  }
  const active = byKey.get("activeSpaceId");
  if (typeof active === "string") compatState.activeSpaceId = active;
  let changed = false;
  compatState.spaces = compatState.spaces.map((space) => {
    if (space.id !== DEFAULT_SPACE_ID) return space;
    const normalized = normalizeDefaultSpace(space);
    if (JSON.stringify(normalized) !== JSON.stringify(space)) changed = true;
    return normalized;
  });
  compatState.loadedDbPath = context.config.databasePath;
  if (changed) saveCompatState(context);
}

function compatStateSaveStatement(context: AppContext) {
  return context.db.prepare(`
    INSERT INTO v2_compat_state(key, data_json, updated_at_ms)
    VALUES (@key, @dataJson, @updatedAtMs)
    ON CONFLICT(key) DO UPDATE SET
      data_json = excluded.data_json,
      updated_at_ms = excluded.updated_at_ms
  `);
}

function saveCompatKeys(context: AppContext, keys: Array<CompatCollection | "activeSpaceId">) {
  const save = compatStateSaveStatement(context);
  const timestamp = Date.now();
  const tx = context.db.transaction(() => {
    for (const key of keys) {
      save.run({
        key,
        dataJson: key === "activeSpaceId" ? toJson(compatState.activeSpaceId) : toJson(compatState[key]),
        updatedAtMs: timestamp,
      });
    }
  });
  tx();
}

function saveCompatState(context: AppContext) {
  saveCompatKeys(context, [...compatCollections, "activeSpaceId"]);
}

function saveCompatCollection(context: AppContext, collection?: CompatCollection) {
  if (!collection) {
    saveCompatState(context);
    return;
  }
  saveCompatKeys(context, [collection]);
}

function saveCompatCollections(context: AppContext, collections: CompatCollection[]) {
  saveCompatKeys(context, Array.from(new Set(collections)));
}

function defaultV1SqlitePath() {
  return path.join(os.homedir(), ".openclaw", "middleware", "middleware.db");
}

function normalizeV1SqlitePath(raw?: unknown) {
  const input = typeof raw === "string" && raw.trim() ? raw.trim() : process.env.MIDDLEWARE_V1_DB || defaultV1SqlitePath();
  if (input.endsWith(".sqlite") || input.endsWith(".sqlite3") || input.endsWith(".db")) return input;
  if (input.endsWith(".json")) return input.replace(/\.json$/, ".sqlite");
  return `${input}.sqlite`;
}

function recordMergeKey(collection: CompatCollection, record: CompatRecord) {
  const idValue = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  if (collection === "sessions") {
    const key = typeof record.sessionKey === "string" && record.sessionKey.trim()
      ? record.sessionKey.trim()
      : typeof record.key === "string" && record.key.trim()
        ? record.key.trim()
        : null;
    return key ? `sessionKey:${key}` : idValue ? `id:${idValue}` : null;
  }
  if (collection === "chats") {
    const key = typeof record.sessionKey === "string" && record.sessionKey.trim() ? record.sessionKey.trim() : null;
    return idValue ? `id:${idValue}` : key ? `sessionKey:${key}` : null;
  }
  return idValue ? `id:${idValue}` : null;
}

function mergeCompatRecords(collection: CompatCollection, incoming: CompatRecord[]) {
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const existing = compatState[collection];
  const index = new Map<string, number>();
  existing.forEach((record, i) => {
    const key = recordMergeKey(collection, record);
    if (key) index.set(key, i);
  });
  for (const record of incoming) {
    if (!record || typeof record !== "object" || Array.isArray(record)) { skipped += 1; continue; }
    const key = recordMergeKey(collection, record);
    if (!key) { skipped += 1; continue; }
    const at = index.get(key);
    if (at === undefined) {
      existing.push(record);
      index.set(key, existing.length - 1);
      imported += 1;
    } else {
      existing[at] = { ...existing[at], ...record };
      updated += 1;
    }
  }
  return { imported, updated, skipped };
}

function normalizeDefaultSpace(space: CompatRecord): CompatRecord {
  return {
    ...spaceForResponse(space),
    id: DEFAULT_SPACE_ID,
    name: typeof space.name === "string" && space.name.trim() ? space.name : DEFAULT_SPACE_NAME,
    archived: false,
    deleted: false,
    sortOrder: typeof space.sortOrder === "number" ? space.sortOrder : 0,
    createdAt: typeof space.createdAt === "string" ? space.createdAt : nowIso(),
    updatedAt: typeof space.updatedAt === "string" ? space.updatedAt : nowIso(),
  };
}

function sanitizeSpacePatch(input: CompatRecord) {
  const patch: CompatRecord = {};
  for (const key of spacePatchFields) {
    if (key in input) patch[key] = input[key];
  }
  const iconImage = spaceIconImageFrom(input);
  if (iconImage !== undefined) {
    patch.iconImage = iconImage;
    delete patch.ImageIcon;
    delete patch.imageIcon;
    delete patch.icon_image;
  }
  const iconEmoji = spaceIconEmojiFrom(input);
  if (iconEmoji !== undefined) {
    patch.iconEmoji = iconEmoji;
    delete patch.icon_emoji;
  }
  return patch;
}

function spaceIconImageFrom(input?: CompatRecord | null) {
  if (!input || typeof input !== "object") return undefined;
  return input.iconImage ?? input.ImageIcon ?? input.imageIcon ?? input.icon_image;
}

function spaceIconEmojiFrom(input?: CompatRecord | null) {
  if (!input || typeof input !== "object") return undefined;
  return input.iconEmoji ?? input.icon_emoji;
}

function spaceForResponse(space: CompatRecord) {
  const iconImage = spaceIconImageFrom(space);
  const iconEmoji = spaceIconEmojiFrom(space);
  const { ImageIcon: _ImageIcon, imageIcon: _imageIcon, icon_image: _icon_image, icon_emoji: _icon_emoji, ...rest } = space;
  return {
    ...rest,
    ...(iconImage !== undefined ? { iconImage } : {}),
    ...(iconEmoji !== undefined ? { iconEmoji } : {}),
  };
}

function spacesForResponse(spaces: CompatRecord[]) {
  return spaces.map(spaceForResponse);
}

function readV1State(sourcePath: string): CompatRecord {
  if (!fs.existsSync(sourcePath)) throw new Error(`v1 SQLite database not found: ${sourcePath}`);
  const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT value FROM kv_state WHERE key = 'state'").get() as { value?: string } | undefined;
    if (!row?.value) throw new Error("v1 SQLite database does not contain kv_state/state");
    const value = JSON.parse(row.value);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("v1 SQLite state is not an object");
    return value as CompatRecord;
  } finally {
    db.close();
  }
}

function migrateV1SqliteToV2(context: AppContext, sourcePathInput?: unknown): V1SqliteMigrationResult {
  loadCompatState(context);
  const sourcePath = normalizeV1SqlitePath(sourcePathInput);
  const v1State = readV1State(sourcePath);
  const totals = { imported: 0, updated: 0, skipped: 0, spaces: 0, chats: 0, projects: 0, topics: 0, sessions: 0, branches: 0, pins: 0, cronJobs: 0, cronRuns: 0 };
  for (const collection of compatCollections) {
    const incoming = Array.isArray(v1State[collection]) ? v1State[collection] as CompatRecord[] : [];
    const result = mergeCompatRecords(collection, incoming);
    totals.imported += result.imported;
    totals.updated += result.updated;
    totals.skipped += result.skipped;
    totals[collection] = result.imported + result.updated;
  }
  if (typeof v1State.activeSpaceId === "string" && v1State.activeSpaceId.trim()) compatState.activeSpaceId = v1State.activeSpaceId;
  saveCompatState(context);
  return { ok: true, sourcePath, targetPath: context.config.databasePath, summary: totals };
}

function ensureDefaultSpace() {
  if (compatState.spaces.length > 0) return compatState.spaces[0];
  const timestamp = nowIso();
  const space = {
    id: DEFAULT_SPACE_ID,
    name: DEFAULT_SPACE_NAME,
    archived: false,
    deleted: false,
    sortOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  compatState.spaces.push(space);
  compatState.activeSpaceId = space.id;
  return space;
}

function ensureDefaultFallbackSpace() {
  const existing = compatState.spaces.find((space) => space.id === DEFAULT_SPACE_ID);
  if (existing) {
    const normalized = normalizeDefaultSpace(existing);
    Object.keys(existing).forEach((key) => delete existing[key]);
    Object.assign(existing, normalized);
    return String(existing.id);
  }
  const timestamp = nowIso();
  compatState.spaces.unshift({
    id: DEFAULT_SPACE_ID,
    name: DEFAULT_SPACE_NAME,
    archived: false,
    deleted: false,
    sortOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return DEFAULT_SPACE_ID;
}

function activeSpaceId() {
  const current = compatState.spaces.find((space) => space.id === compatState.activeSpaceId && visibleSpace(space));
  if (current) return current.id;
  const fallback = compatState.spaces.find(visibleSpace) ?? ensureDefaultSpace();
  compatState.activeSpaceId = String(fallback.id);
  return compatState.activeSpaceId;
}

function stableCompatId(prefix: string, value: string) {
  return `${prefix}_${crypto.createHash("sha1").update(value).digest("hex").slice(0, 16)}`;
}


function readJsonFile(file: string): CompatRecord {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as CompatRecord; } catch { return {}; }
}

function readFirstLines(file: string, maxLines: number) {
  if (maxLines <= 0) return [] as string[];
  const fd = fs.openSync(file, "r");
  try {
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytesRead = 0;
    let newlineCount = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        const chunk = Buffer.from(buffer.subarray(0, bytesRead));
        chunks.push(chunk);
        for (let i = 0; i < chunk.length; i += 1) {
          if (chunk[i] === 10) newlineCount += 1;
        }
      }
    } while (bytesRead > 0 && newlineCount < maxLines);
    return Buffer.concat(chunks).toString("utf8").split(/\r?\n/).filter(Boolean).slice(0, maxLines);
  } finally {
    fs.closeSync(fd);
  }
}

function readJsonlFile(file: string, maxLines?: number) {
  try {
    const selected = typeof maxLines === "number" && maxLines >= 0
      ? readFirstLines(file, maxLines)
      : fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean);
    return selected.flatMap((line) => {
      try { return [JSON.parse(line) as CompatRecord]; } catch { return []; }
    });
  } catch { return [] as CompatRecord[]; }
}

function gatewaySessionsIndexPath(agentId = "main") {
  return path.join(os.homedir(), ".openclaw", "agents", agentId, "sessions", "sessions.json");
}

function gatewaySessionsDir(agentId = "main") {
  return path.dirname(gatewaySessionsIndexPath(agentId));
}

// Failure records are intentionally narrow: any UI-visible field must be
// stable and non-sensitive. Absolute paths, raw exception messages, and
// opaque Gateway cursors are deliberately excluded so scan diagnostics can
// be surfaced to the desktop UI without leaking filesystem or transport
// details.
type TelegramDiscoveryFailure = {
  source: "disk" | "gateway" | "transcripts";
  code: string;
};

type TelegramDiscoveryFailureSummary = {
  source: TelegramDiscoveryFailure["source"];
  code: string;
  count: number;
};

type TelegramDiscoverySource = CompatRecord;

function summarizeTelegramDiscoveryFailures(failures: TelegramDiscoveryFailure[]): TelegramDiscoveryFailureSummary[] {
  const counts = new Map<string, TelegramDiscoveryFailureSummary>();
  for (const failure of failures) {
    const key = `${failure.source}:${failure.code}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { source: failure.source, code: failure.code, count: 1 });
  }
  return [...counts.values()].sort((a, b) => a.source.localeCompare(b.source) || a.code.localeCompare(b.code));
}

function telegramTranscriptFiles(agentId: string) {
  const sessionsDir = gatewaySessionsDir(agentId);
  const dirs = Array.from(new Set([
    sessionsDir,
    path.join(sessionsDir, "archive"),
    path.join(sessionsDir, "archives"),
  ].map((dir) => path.resolve(dir))));
  const files: string[] = [];
  const failures: TelegramDiscoveryFailure[] = [];
  const pending = [...dirs];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const dir = pending.pop()!;
    if (visited.has(dir) || !fs.existsSync(dir)) continue;
    visited.add(dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      failures.push({ source: "transcripts", code: "transcript_directory_read_failed" });
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && /\.jsonl(?:\.|$)/.test(entry.name)) files.push(candidate);
    }
  }
  const sorted = Array.from(new Set(files)).sort();
  const snapshot = sorted.map((file) => {
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    return `${file}:${stat?.mtimeMs ?? 0}:${stat?.size ?? 0}`;
  }).join("|");
  return { files: sorted, snapshot, failures };
}

function bestTelegramTranscriptFile(files: string[]) {
  return [...files].sort((a, b) => {
    const aBase = path.basename(a);
    const bBase = path.basename(b);
    const aCheckpoint = aBase.includes(".checkpoint.") || /\.jsonl\.(?:reset|deleted)\./.test(aBase);
    const bCheckpoint = bBase.includes(".checkpoint.") || /\.jsonl\.(?:reset|deleted)\./.test(bBase);
    if (aCheckpoint !== bCheckpoint) return aCheckpoint ? 1 : -1;
    const aMs = fs.statSync(a, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    const bMs = fs.statSync(b, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    return bMs - aMs || a.localeCompare(b);
  })[0] ?? "";
}

function mergeTelegramSessionIndexes(...indexes: CompatRecord[]) {
  const merged: CompatRecord = {};
  for (const index of indexes) {
    for (const [key, rawEntry] of Object.entries(index)) {
      const entry = (rawEntry && typeof rawEntry === "object") ? rawEntry as CompatRecord : {};
      const previous = (merged[key] && typeof merged[key] === "object") ? merged[key] as CompatRecord : {};
      const related = [
        ...(Array.isArray(previous.relatedTranscriptFiles) ? previous.relatedTranscriptFiles.map(String) : []),
        ...(Array.isArray(entry.relatedTranscriptFiles) ? entry.relatedTranscriptFiles.map(String) : []),
      ];
      merged[key] = { ...previous, ...entry, relatedTranscriptFiles: Array.from(new Set(related.filter(Boolean))) };
    }
  }
  return merged;
}

function transcriptMessageCount(sessionFile: string) {
  return transcriptMessagesFromJsonl(sessionFile).length;
}

function transcriptFilesMessageCount(files: string[]) {
  return files.reduce((sum, file) => sum + transcriptMessageCount(file), 0);
}

let telegramDiscoveryCache: { cacheKey: string; expiresAt: number; result: { index: CompatRecord; source: TelegramDiscoverySource; failures: TelegramDiscoveryFailure[] } } | null = null;

function discoveredTelegramTranscriptEntries(agentId: string, knownIndex: CompatRecord = {}) {
  const now = Date.now();
  const transcriptFiles = telegramTranscriptFiles(agentId);
  const knownSessionFiles = new Map<string, string>();
  for (const [sourceSessionKey, rawEntry] of Object.entries(knownIndex)) {
    const entry = rawEntry && typeof rawEntry === "object" ? rawEntry as CompatRecord : {};
    const sessionFile = String(entry.sessionFile || entry.transcriptPath || "");
    const source = telegramSessionSource(sourceSessionKey, entry);
    if (sessionFile && source?.agentId === agentId) knownSessionFiles.set(path.resolve(sessionFile), sourceSessionKey);
  }
  const cacheKey = `${agentId}:${transcriptFiles.snapshot}:${[...knownSessionFiles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, key]) => `${file}:${key}`).join("|")}`;
  if (telegramDiscoveryCache?.cacheKey === cacheKey && telegramDiscoveryCache.expiresAt > now) return telegramDiscoveryCache.result;
  const buckets = new Map<string, { files: string[]; meta: ReturnType<typeof telegramMetaFromMessages> }>();
  const knownKeys = new Set(Object.keys(knownIndex));
  const failures = [...transcriptFiles.failures];
  let accepted = 0;
  for (const file of transcriptFiles.files) {
    const messages = transcriptMessagesFromJsonl(file, 40);
    const identity = telegramIdentityFromMessages(messages);
    const sourceSessionKey = knownSessionFiles.get(path.resolve(file)) ?? (identity
      ? identity.kind === "group"
        ? `agent:${agentId}:telegram:group:${identity.groupId}${identity.topicId ? `:topic:${identity.topicId}` : ""}`
        : (knownKeys.has(`agent:${agentId}:telegram:slash:${identity.userId}`) ? `agent:${agentId}:telegram:slash:${identity.userId}` : `agent:${agentId}:telegram:direct:${identity.userId}`)
      : null);
    if (!sourceSessionKey) {
      failures.push({ source: "transcripts", code: "unidentified_transcript" });
      continue;
    }
    const meta = telegramMetaFromMessages(messages);
    const bucket = buckets.get(sourceSessionKey) ?? { files: [], meta: null };
    bucket.files.push(file);
    bucket.meta = bucket.meta ?? meta;
    buckets.set(sourceSessionKey, bucket);
    accepted += 1;
  }
  const entries: CompatRecord = {};
  for (const [sourceSessionKey, bucket] of buckets) {
    const sourceSessionFile = bestTelegramTranscriptFile(bucket.files);
    const relatedTranscriptFiles = bucket.files.filter((file) => file !== sourceSessionFile);
    const meta = bucket.meta ?? telegramMetaFromMessages(transcriptMessagesFromJsonl(sourceSessionFile, 80));
    entries[sourceSessionKey] = {
      agentId,
      sessionId: path.basename(sourceSessionFile).replace(/\.jsonl(?:\..*)?$/, ""),
      sessionFile: sourceSessionFile,
      subject: meta?.groupSubject,
      groupSubject: meta?.groupSubject,
      topicName: meta?.topicName,
      displayName: meta?.groupSubject || meta?.sender,
      relatedTranscriptFiles,
      messageCount: transcriptFilesMessageCount(bucket.files),
      archivedMessageCount: transcriptFilesMessageCount(relatedTranscriptFiles),
      updatedAt: fs.statSync(sourceSessionFile, { throwIfNoEntry: false })?.mtimeMs ?? null,
    };
  }
  const result = {
    index: entries,
    source: {
      status: failures.some((failure) => failure.code === "transcript_directory_read_failed") ? "partial" : "complete",
      candidates: transcriptFiles.files.length,
      accepted,
      rejected: transcriptFiles.files.length - accepted,
    },
    failures,
  };
  telegramDiscoveryCache = { cacheKey, expiresAt: now + 60_000, result };
  return result;
}

function gatewaySessionsListLimit(input: CompatRecord) {
  const value = Number(input.historyLimit || input.sessionsListLimit || 1000);
  return Number.isFinite(value) && value > 0 ? Math.max(100, Math.floor(value)) : 1000;
}

function gatewayContinuation(payload: CompatRecord) {
  const pagination = payload.pagination && typeof payload.pagination === "object" ? payload.pagination as CompatRecord : {};
  const candidates: Array<[string, unknown]> = [
    ["cursor", payload.nextCursor ?? pagination.nextCursor],
    ["pageToken", payload.nextPageToken ?? pagination.nextPageToken],
    ["continuation", payload.continuation ?? pagination.continuation],
    ["continuationToken", payload.continuationToken ?? pagination.continuationToken],
  ];
  for (const [field, value] of candidates) {
    if (typeof value === "string" && value.trim()) return { field, token: value };
  }
  return null;
}

async function gatewayTelegramSessionEntries(context: AppContext, agentId: string, input: CompatRecord = {}) {
  const entries: CompatRecord = {};
  const failures: TelegramDiscoveryFailure[] = [];
  if (!context.gateway.status().connected) {
    return { index: entries, source: { status: "unavailable", pages: 0, accepted: 0 }, failures };
  }
  const baseInput = {
    limit: gatewaySessionsListLimit(input),
    includeDerivedTitles: true,
    includeLastMessage: true,
  };
  let continuation: ReturnType<typeof gatewayContinuation> = null;
  let pages = 0;
  const seenTokens = new Set<string>();
  do {
    try {
      const payload = await context.gateway.request<CompatRecord>("sessions.list", {
        ...baseInput,
        ...(continuation ? { [continuation.field]: continuation.token } : {}),
      }, 10_000);
      pages += 1;
      for (const row of gatewaySessionRows(payload)) {
      const sourceSessionKey = stringField(row, ["key", "sessionKey"]);
      if (!sourceSessionKey) continue;
      const parsed = telegramSessionSource(sourceSessionKey, row);
      if (!parsed || parsed.agentId !== agentId) continue;
      entries[sourceSessionKey] = {
        agentId: parsed.agentId,
        sessionId: stringField(row, ["sessionId", "session_id"]),
        sessionFile: stringField(row, ["sessionFile", "transcriptPath", "transcript_path"]),
        subject: stringField(row, ["groupSubject", "displayName", "derivedTitle", "label", "name"]),
        groupSubject: stringField(row, ["groupSubject"]),
        displayName: stringField(row, ["displayName", "derivedTitle", "label", "name"]),
        topicName: stringField(row, ["topicName", "threadLabel"]),
        channel: row.channel,
        lastChannel: row.lastChannel,
        origin: row.origin,
        deliveryContext: row.deliveryContext,
        updatedAt: row.updatedAt ?? row.updated_at ?? row.lastActiveAt ?? row.lastMessageAt ?? null,
      };
    }
      continuation = gatewayContinuation(payload);
      if (continuation && seenTokens.has(`${continuation.field}:${continuation.token}`)) {
        failures.push({ source: "gateway", code: "gateway_cursor_repeated" });
        break;
      }
      if (continuation) seenTokens.add(`${continuation.field}:${continuation.token}`);
    } catch {
      failures.push({
        source: "gateway",
        code: pages > 0 ? "gateway_page_failed" : "gateway_list_failed",
      });
      break;
    }
  } while (continuation);
  return {
    index: entries,
    source: { status: failures.length > 0 ? (pages > 0 ? "partial" : "failed") : "complete", pages, accepted: Object.keys(entries).length },
    failures,
  };
}

function parseTelegramSessionKey(key: string) {
  const direct = key.match(/^agent:([^:]+):telegram:(?:direct|slash):([^:]+)$/);
  if (direct) return { kind: "direct" as const, agentId: direct[1] || "main", userId: direct[2] || "" };
  const group = key.match(/^agent:([^:]+):telegram:(?:group|channel|supergroup|chat):([^:]+)(?::topic:(\d+))?$/);
  if (group) return { kind: "group" as const, agentId: group[1] || "main", groupId: group[2] || "", topicId: group[3] || null };
  return null;
}

function telegramSessionSource(sourceSessionKey: string, entry: CompatRecord = {}) {
  const parsed = parseTelegramSessionKey(sourceSessionKey);
  if (parsed) return parsed;
  if (sourceSessionKey.includes(":desktop:migrated-telegram-") || sourceSessionKey.includes(":subagent:")) return null;
  const deliveryContext = entry.deliveryContext && typeof entry.deliveryContext === "object" ? entry.deliveryContext as CompatRecord : {};
  const channel = String(entry.channel ?? entry.lastChannel ?? deliveryContext.channel ?? entry.origin?.provider ?? "").toLowerCase();
  const to = String(deliveryContext.to ?? entry.to ?? entry.chatId ?? "");
  if (channel !== "telegram" && !to.startsWith("telegram:")) return null;
  const agentId = stringField(entry, ["agentId"]) ?? sourceSessionKey.match(/^agent:([^:]+):/)?.[1] ?? "main";
  const target = to.replace(/^telegram:/, "").trim();
  const threadId = deliveryContext.threadId ?? entry.threadId ?? entry.topicId ?? null;
  if ((threadId !== null && threadId !== undefined && String(threadId).trim()) || target.startsWith("-")) {
    return { kind: "group" as const, agentId, groupId: target || sourceSessionKey, topicId: threadId === null || threadId === undefined ? null : String(threadId) };
  }
  return { kind: "direct" as const, agentId, userId: target || sourceSessionKey };
}

function telegramSessionSourceFromScan(session: CompatRecord) {
  const parsed = parseTelegramSessionKey(String(session.sourceSessionKey || ""));
  if (parsed) return parsed;
  const agentId = String(session.agentId || "main");
  if (session.chatType === "group") return { kind: "group" as const, agentId, groupId: String(session.groupId || session.sourceSessionKey || ""), topicId: session.topicId === undefined ? null : session.topicId };
  if (session.chatType === "direct") return { kind: "direct" as const, agentId, userId: String(session.userId || session.sourceSessionKey || "") };
  return null;
}

function parseDiscordSessionKey(key: string) {
  const direct = key.match(/^agent:([^:]+):discord:(?:direct|dm):([^:]+)$/);
  if (direct) return { kind: "direct" as const, agentId: direct[1] || "main", userId: direct[2] || "" };
  const channel = key.match(/^agent:([^:]+):discord:(channel|group):([^:]+)(?::thread:([^:]+))?$/);
  if (channel) return { kind: "channel" as const, agentId: channel[1] || "main", channelKind: channel[2] || "channel", channelId: channel[3] || "", threadId: channel[4] || null };
  return null;
}

function firstTextContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => typeof block?.text === "string" ? block.text : typeof block?.content === "string" ? block.content : "").join(" ");
}

function messageBody(message: CompatRecord) {
  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;
  return firstTextContent(message.content);
}

function cleanImportedName(text: string) {
  return text
    .replace(/```json\s*\{[\s\S]*?\}\s*```/g, " ")
    .replace(/^System \(untrusted\):.*$/gmi, " ")
    .replace(/Conversation info \(untrusted metadata\):[\s\S]*?(?=Sender \(untrusted metadata\):|\[[^\n]+\]|$)/gmi, " ")
    .replace(/Sender \(untrusted metadata\):[\s\S]*?(?=\[[^\n]+\]|$)/gmi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseConversationInfo(text: string) {
  const match = text.match(/Conversation info \(untrusted metadata\):\s*```json\s*([\s\S]*?)\s*```/i);
  if (!match) return null;
  try { return JSON.parse(match[1]) as CompatRecord; } catch { return null; }
}

function transcriptMessagesFromJsonl(sessionFile: string, maxLines?: number): CompatRecord[] {
  return readJsonlFile(sessionFile, maxLines)
    .filter((line) => line?.type === "message" || line?.message?.role)
    .map((line): CompatRecord => {
      const message = (line.message && typeof line.message === "object") ? line.message as CompatRecord : line;
      return { ...message, timestamp: message.timestamp ?? line.timestamp, __openclaw: { id: line.id, seq: line.seq } };
    })
    .filter((message) => Boolean(message?.role));
}

function telegramMetaFromMessages(messages: CompatRecord[]) {
  for (const message of messages) {
    const meta = parseConversationInfo(firstTextContent(message.content));
    if (!meta) continue;
    return {
      groupSubject: String(meta.group_subject || "").trim(),
      topicName: String(meta.topic_name || "").trim(),
      sender: String(meta.sender || "").trim(),
    };
  }
  return null;
}


function telegramIdentityFromMessages(messages: CompatRecord[]) {
  // Recursive transcript discovery must only accept transcripts whose
  // conversation-info metadata explicitly identifies Telegram. A bare
  // `sender_id` (which many non-Telegram transcript formats also emit) is
  // NOT sufficient: we require a Telegram-scoped `chat_id` ("telegram:<id>")
  // or an explicit platform marker. Transcripts without a verified Telegram
  // identity must instead rely on exact session-index association upstream.
  for (const message of messages) {
    const meta = parseConversationInfo(firstTextContent(message.content));
    if (!meta) continue;
    const rawChatId = String(meta.chat_id || "");
    const platform = String(meta.platform || "").toLowerCase();
    const isTelegramScope = /^telegram:/i.test(rawChatId) || platform === "telegram";
    if (!isTelegramScope) continue;
    const chatId = rawChatId.replace(/^telegram:/i, "").trim();
    if (!chatId) continue;
    const topicId = meta.topic_id === undefined || meta.topic_id === null ? null : String(meta.topic_id);
    const isGroup = Boolean(meta.is_group_chat) || meta.chat_type === "group" || Boolean(meta.group_subject);
    if (isGroup) return { kind: "group" as const, groupId: chatId, topicId };
    return { kind: "direct" as const, userId: chatId };
  }
  return null;
}

function archivedTelegramTranscriptFiles(sessionFile: string, parsed: NonNullable<ReturnType<typeof parseTelegramSessionKey>>) {
  const current = sessionFile ? path.resolve(sessionFile) : "";
  const sessionsDir = current ? path.dirname(current) : path.dirname(gatewaySessionsIndexPath(parsed.agentId));
  const candidateDirs = Array.from(new Set([
    sessionsDir,
    path.join(sessionsDir, "archive"),
    path.join(sessionsDir, "archives"),
  ].map((dir) => path.resolve(dir))));
  const entries = candidateDirs.flatMap((dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(dir, entry.name));
    } catch { return [] as string[]; }
  });
  const archiveSuffixRe = /\.jsonl\.(?:reset|deleted)\.\d{4}-\d{2}-\d{2}T/;
  const candidates = entries
    .filter((file) => archiveSuffixRe.test(path.basename(file)))
    .filter((file) => {
      const entry = path.basename(file);
      if (parsed.kind === "group" && parsed.topicId) return entry.includes(`-topic-${parsed.topicId}.jsonl.`);
      if (parsed.kind === "group") return !entry.includes("-topic-");
      return !entry.includes("-topic-");
    })
    .filter((file) => path.resolve(file) !== current)
    .filter((file) => {
      const probeMessages = transcriptMessagesFromJsonl(file, 80);
      const identity = telegramIdentityFromMessages(probeMessages);
      if (!identity) return parsed.kind === "group" && Boolean(parsed.topicId);
      if (parsed.kind === "group") return identity.kind === "group" && identity.groupId === parsed.groupId && (identity.topicId ?? null) === (parsed.topicId ?? null);
      return identity.kind === "direct" && identity.userId === parsed.userId;
    })
    .sort((a, b) => {
      const aMs = fs.statSync(a, { throwIfNoEntry: false })?.mtimeMs ?? 0;
      const bMs = fs.statSync(b, { throwIfNoEntry: false })?.mtimeMs ?? 0;
      return aMs - bMs || a.localeCompare(b);
    });
  return candidates;
}

function telegramTranscriptFilesForSession(session: CompatRecord) {
  const files = Array.isArray(session.archivedTranscriptFiles) ? session.archivedTranscriptFiles.map(String) : [];
  const source = String(session.sourceSessionFile || "");
  if (source) files.push(source);
  return Array.from(new Set(files.filter(Boolean)));
}

function telegramSourceMessagesForSession(session: CompatRecord) {
  return telegramTranscriptFilesForSession(session).flatMap((file) => transcriptMessagesFromJsonl(file));
}

function sampleTelegramMessagesForScan(sourceSessionFile: string, relatedTranscriptFiles: string[]) {
  const sampleFiles = [sourceSessionFile, ...relatedTranscriptFiles.slice(0, 2)].filter(Boolean);
  return sampleFiles.flatMap((file) => transcriptMessagesFromJsonl(file, 80));
}

function entryMessageCount(entry: CompatRecord) {
  const value = entry.messageCount ?? entry.messagesCount ?? entry.totalMessages ?? entry.message_count;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

function discordMetaFromMessages(messages: CompatRecord[]) {
  for (const message of messages) {
    const meta = parseConversationInfo(firstTextContent(message.content));
    if (!meta) continue;
    return {
      groupSubject: String(meta.group_subject || "").trim(),
      groupChannel: String(meta.group_channel || "").trim(),
      groupSpace: String(meta.group_space || "").trim(),
      threadLabel: String(meta.thread_label || "").trim(),
      sender: String(meta.sender || "").trim(),
    };
  }
  return null;
}

function lastUserMessagePreview(messages: CompatRecord[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const cleaned = cleanImportedName(messageBody(message));
    if (cleaned) return cleaned;
  }
  return null;
}

function uniqueName(base: string, used: Set<string>) {
  const root = (base || "Telegram import").trim() || "Telegram import";
  let name = root;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${root} (${n++})`;
  used.add(name.toLowerCase());
  return name;
}

type ImportedPlatformKind = "telegram" | "discord";

function importedPlatformProjectName(kind: ImportedPlatformKind) {
  return kind === "telegram" ? "Telegram" : "Discord";
}

function importedPlatformSpaceName(kind: ImportedPlatformKind) {
  return importedPlatformProjectName(kind);
}

function importedPlatformProjectMarker(kind: ImportedPlatformKind) {
  return { kind, scope: "session-migration" };
}

function importedPlatformSpaceMarker(kind: ImportedPlatformKind) {
  return { kind, scope: "session-migration" };
}

function isImportedPlatformSpace(space: CompatRecord, kind: ImportedPlatformKind) {
  const importedFrom = space.importedFrom && typeof space.importedFrom === "object" ? space.importedFrom as CompatRecord : {};
  return importedFrom.kind === kind && importedFrom.scope === "session-migration";
}

function ensureImportedPlatformSpace(kind: ImportedPlatformKind, timestamp = nowIso()) {
  const name = importedPlatformSpaceName(kind);
  let space = compatState.spaces.find((item) => isImportedPlatformSpace(item, kind));
  if (!space) {
    space = compatState.spaces.find((item) => visibleSpace(item) && String(item.name || "").trim().toLowerCase() === name.toLowerCase());
  }
  if (!space) {
    space = {
      id: id("space"),
      name,
      archived: false,
      deleted: false,
      sortOrder: compatState.spaces.length,
      createdAt: timestamp,
      updatedAt: timestamp,
      importedFrom: importedPlatformSpaceMarker(kind),
    };
    compatState.spaces.push(space);
    return space;
  }
  space.name = name;
  space.archived = false;
  space.deleted = false;
  space.updatedAt = timestamp;
  space.importedFrom = {
    ...(space.importedFrom && typeof space.importedFrom === "object" ? space.importedFrom as CompatRecord : {}),
    ...importedPlatformSpaceMarker(kind),
  };
  return space;
}

function isImportedPlatformProject(project: CompatRecord, kind: ImportedPlatformKind) {
  const importedFrom = project.importedFrom && typeof project.importedFrom === "object" ? project.importedFrom as CompatRecord : {};
  return importedFrom.kind === kind && importedFrom.scope === "session-migration";
}

function ensureImportedPlatformProject(kind: ImportedPlatformKind, targetSpaceId: string, timestamp = nowIso()) {
  const name = importedPlatformProjectName(kind);
  let project = compatState.projects.find((item) => isImportedPlatformProject(item, kind));
  if (!project) {
    project = compatState.projects.find((item) => {
      const importedFrom = item.importedFrom && typeof item.importedFrom === "object" ? item.importedFrom as CompatRecord : null;
      return notDeleted(item)
        && String(item.name || "").trim().toLowerCase() === name.toLowerCase()
        && (!importedFrom || importedFrom.kind === kind);
    });
  }
  if (!project) {
    project = {
      id: id("proj"),
      name,
      workspaceRoot: path.join(os.homedir(), ".openclaw", "workspace"),
      spaceId: targetSpaceId,
      archived: false,
      pinned: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      importedFrom: importedPlatformProjectMarker(kind),
    };
    compatState.projects.push(project);
    return project;
  }
  project.name = String(project.name || "").trim() || name;
  project.spaceId = targetSpaceId;
  project.archived = false;
  project.deleted = false;
  project.updatedAt = timestamp;
  project.importedFrom = {
    ...(project.importedFrom && typeof project.importedFrom === "object" ? project.importedFrom as CompatRecord : {}),
    ...importedPlatformProjectMarker(kind),
  };
  return project;
}

function pruneEmptyLegacyImportedPlatformProjects(kind: ImportedPlatformKind, timestamp = nowIso()) {
  const canonical = compatState.projects.find((item) => isImportedPlatformProject(item, kind));
  if (!canonical?.id) return false;
  let changed = false;
  for (const project of compatState.projects) {
    if (project.id === canonical.id) continue;
    const importedFrom = project.importedFrom && typeof project.importedFrom === "object" ? project.importedFrom as CompatRecord : {};
    if (importedFrom.kind !== kind || importedFrom.scope === "session-migration") continue;
    const hasTopics = compatState.topics.some((topic) => notDeleted(topic) && topic.projectId === project.id);
    const hasSessions = compatState.sessions.some((session) => notDeleted(session) && session.projectId === project.id);
    const hasChats = compatState.chats.some((chat) => notDeleted(chat) && chat.projectId === project.id);
    if (hasTopics || hasSessions || hasChats) continue;
    project.deleted = true;
    project.archived = true;
    project.updatedAt = timestamp;
    changed = true;
  }
  return changed;
}

function importedSessionSourceKey(record: CompatRecord) {
  return String(record.importedFrom?.sourceSessionKey || record.sessionKey || record.key || record.id || id("import"));
}

function isImportedSourceSession(kind: ImportedPlatformKind, sourceSessionKey: unknown) {
  const sourceKey = String(sourceSessionKey || "");
  if (!sourceKey) return false;
  return compatState.sessions.some((session) => session.importedFrom?.kind === kind && session.importedFrom?.sourceSessionKey === sourceKey)
    || compatState.chats.some((chat) => chat.importedFrom?.kind === kind && chat.importedFrom?.sourceSessionKey === sourceKey);
}

function importedSourceSessionKeyForDesktopSession(sessionKey: string) {
  const session = compatState.sessions.find((record) => (record.sessionKey === sessionKey || record.key === sessionKey) && record.importedFrom?.sourceSessionKey);
  const chat = compatState.chats.find((record) => record.sessionKey === sessionKey && record.importedFrom?.sourceSessionKey);
  const sourceKey = String(session?.importedFrom?.sourceSessionKey || chat?.importedFrom?.sourceSessionKey || "");
  return sourceKey && sourceKey !== sessionKey ? sourceKey : null;
}

function dedupeImportedPlatformRecords(kind: ImportedPlatformKind, timestamp = nowIso()) {
  let changed = false;
  const retire = (record: CompatRecord) => {
    if (record.deleted && record.archived) return;
    record.deleted = true;
    record.archived = true;
    record.updatedAt = timestamp;
    changed = true;
  };
  const groups = new Map<string, { sessions: CompatRecord[]; chats: CompatRecord[] }>();
  const sessionKeyToSourceKey = new Map<string, string>();
  for (const session of compatState.sessions) {
    if (session.importedFrom?.kind !== kind) continue;
    const sessionKey = String(session.sessionKey || session.key || "");
    if (sessionKey) sessionKeyToSourceKey.set(sessionKey, importedSessionSourceKey(session));
  }
  const add = (type: "sessions" | "chats", record: CompatRecord, fallbackSourceKey?: string | null) => {
    const sourceKey = record.importedFrom?.kind === kind ? importedSessionSourceKey(record) : fallbackSourceKey;
    if (!sourceKey) return;
    const group = groups.get(sourceKey) ?? { sessions: [], chats: [] };
    group[type].push(record);
    groups.set(sourceKey, group);
  };
  for (const session of compatState.sessions) add("sessions", session);
  for (const chat of compatState.chats) add("chats", chat, sessionKeyToSourceKey.get(String(chat.sessionKey || "")) ?? null);
  for (const [sourceKey, group] of groups) {
    const liveSessions = group.sessions.filter(notDeleted);
    const liveChats = group.chats.filter(notDeleted);
    const keepSession = liveSessions[0];
    const keepChat = liveChats.find((chat) => chat.importedFrom?.kind === kind && chat.importedFrom?.sourceSessionKey === sourceKey) ?? liveChats[0];
    for (const session of liveSessions.slice(1)) retire(session);
    for (const chat of liveChats) {
      if (chat !== keepChat) retire(chat);
    }
    const sessionKey = String(keepSession?.sessionKey || keepSession?.key || "");
    if (keepChat && sessionKey && keepChat.sessionKey !== sessionKey) {
      keepChat.sessionKey = sessionKey;
      keepChat.updatedAt = timestamp;
      changed = true;
    }
    if (keepChat && keepChat.importedFrom?.sourceSessionKey !== sourceKey) {
      keepChat.importedFrom = { kind, sourceSessionKey: sourceKey };
      keepChat.updatedAt = timestamp;
      changed = true;
    }
  }
  return changed;
}

function ensureImportedFlatChat(kind: ImportedPlatformKind, input: {
  sourceSessionKey: string;
  targetSpaceId: string;
  label: string;
  sessionKey: string;
  agentId?: unknown;
  timestamp?: string;
}) {
  const timestamp = input.timestamp ?? nowIso();
  const existing = compatState.chats.find((chat) => notDeleted(chat) && chat.importedFrom?.kind === kind && chat.importedFrom?.sourceSessionKey === input.sourceSessionKey)
    ?? compatState.chats.find((chat) => notDeleted(chat) && input.sessionKey && chat.sessionKey === input.sessionKey)
    ?? compatState.chats.find((chat) => chat.importedFrom?.kind === kind && chat.importedFrom?.sourceSessionKey === input.sourceSessionKey)
    ?? compatState.chats.find((chat) => input.sessionKey && chat.sessionKey === input.sessionKey);
  const patch = {
    name: input.label,
    sessionKey: input.sessionKey,
    agentId: input.agentId || "main",
    spaceId: input.targetSpaceId,
    projectId: null,
    topicId: null,
    deleted: false,
    archived: false,
    updatedAt: timestamp,
    lastActiveAt: existing?.lastActiveAt || timestamp,
    importedFrom: { kind, sourceSessionKey: input.sourceSessionKey },
  };
  if (existing) {
    Object.assign(existing, patch);
    return existing;
  }
  const chat = {
    id: id("chat"),
    ...patch,
    pinned: false,
    createdAt: timestamp,
  };
  compatState.chats.push(chat);
  return chat;
}

function retireImportedPlatformProjectStructure(kind: ImportedPlatformKind, timestamp = nowIso()) {
  let changed = false;
  for (const topic of compatState.topics) {
    if (topic.importedFrom?.kind !== kind) continue;
    if (!topic.deleted || !topic.archived) changed = true;
    topic.deleted = true;
    topic.archived = true;
    topic.updatedAt = timestamp;
  }
  for (const project of compatState.projects) {
    if (!isImportedPlatformProject(project, kind) && project.importedFrom?.kind !== kind) continue;
    if (!project.deleted || !project.archived) changed = true;
    project.deleted = true;
    project.archived = true;
    project.updatedAt = timestamp;
  }
  return changed;
}

function normalizeImportedPlatformState(kind: ImportedPlatformKind, timestamp = nowIso()) {
  const hasImports = compatState.projects.some((project) => project.importedFrom?.kind === kind)
    || compatState.topics.some((topic) => topic.importedFrom?.kind === kind)
    || compatState.sessions.some((session) => session.importedFrom?.kind === kind)
    || compatState.chats.some((chat) => chat.importedFrom?.kind === kind);
  if (!hasImports) return false;
  const before = JSON.stringify({ spaces: compatState.spaces, projects: compatState.projects, topics: compatState.topics, sessions: compatState.sessions, chats: compatState.chats });
  const space = ensureImportedPlatformSpace(kind, timestamp);
  const spaceId = String(space.id);
  for (const session of compatState.sessions) {
    if (session.importedFrom?.kind !== kind || !notDeleted(session)) continue;
    const sourceSessionKey = importedSessionSourceKey(session);
    const sessionKey = String(session.sessionKey || session.key || "");
    const label = String(session.label || session.name || `${importedPlatformProjectName(kind)} import`);
    session.spaceId = spaceId;
    session.projectId = null;
    session.topicId = null;
    session.updatedAt = timestamp;
    if (sessionKey) {
      ensureImportedFlatChat(kind, {
        sourceSessionKey,
        targetSpaceId: spaceId,
        label,
        sessionKey,
        agentId: session.agentId,
        timestamp,
      });
    }
  }
  for (const chat of compatState.chats) {
    if (chat.importedFrom?.kind !== kind || !notDeleted(chat)) continue;
    chat.spaceId = spaceId;
    chat.projectId = null;
    chat.topicId = null;
    chat.archived = false;
    chat.updatedAt = timestamp;
  }
  retireImportedPlatformProjectStructure(kind, timestamp);
  dedupeImportedPlatformRecords(kind, timestamp);
  const after = JSON.stringify({ spaces: compatState.spaces, projects: compatState.projects, topics: compatState.topics, sessions: compatState.sessions, chats: compatState.chats });
  return before !== after;
}

function importedTopicMetadata(kind: ImportedPlatformKind, sourceSessionKey: string, extra: CompatRecord = {}) {
  return { kind, sourceSessionKey, ...extra };
}

function createImportedSessionTopic(kind: ImportedPlatformKind, projectId: string, label: string, timestamp: string, sourceSessionKey: string, extra: CompatRecord = {}) {
  const topicId = id("topic");
  compatState.topics.push({
    id: topicId,
    projectId,
    name: label,
    archived: false,
    pinned: false,
    unreadCount: 0,
    sortOrder: Date.now(),
    createdAt: timestamp,
    updatedAt: timestamp,
    importedFrom: importedTopicMetadata(kind, sourceSessionKey, extra),
  });
  return topicId;
}

function telegramGroupName(entry: CompatRecord, groupId: string) {
  return String(entry.subject || entry.groupSubject || entry.displayName || entry.label || `Telegram group ${groupId}`).replace(/^telegram:g-/, "").trim() || `Telegram group ${groupId}`;
}

function telegramTopicFallback(entry: CompatRecord, topicId: string | null) {
  return String(entry.topicName || entry.chatName || (topicId ? `Topic ${topicId}` : "General")).trim();
}

function discordProjectName(entry: CompatRecord, channelId: string, meta?: ReturnType<typeof discordMetaFromMessages>) {
  const display = String(entry.subject || entry.groupSubject || entry.displayName || entry.label || "").replace(/^discord:/, "").trim();
  return meta?.groupSubject || display || `Discord channel ${channelId}`;
}

function discordTopicFallback(entry: CompatRecord, channelId: string, threadId: string | null, meta?: ReturnType<typeof discordMetaFromMessages>) {
  return String(meta?.threadLabel || meta?.groupChannel || entry.threadName || entry.channelName || entry.topicName || (threadId ? `Thread ${threadId}` : `Channel ${channelId}`)).trim();
}


type MiddlewareGitStatus = {
  repoRoot: string;
  currentBranch?: string;
  targetBranch?: string;
  upstream?: string;
  headSha?: string;
  headSubject?: string;
  remoteSha?: string;
  remoteSubject?: string;
  ahead?: number;
  behind?: number;
  dirty?: boolean;
  staged?: number;
  unstaged?: number;
  untracked?: number;
  diffSummary?: string;
  checkedAt: string;
  error?: string;
};

type MiddlewareUpdateStatus = {
  state: "idle" | "running" | "restarting" | "succeeded" | "failed";
  startedAt?: string;
  updatedAt: string;
  message?: string;
  repoRoot?: string;
  branch?: string;
  currentBranch?: string;
  runningBranch?: string;
  logPath?: string;
  git?: MiddlewareGitStatus;
};

type MiddlewareUpdateInput = {
  branch?: string;
};

type MiddlewareUpdateBranch = {
  name: string;
  sha?: string;
  updatedAt?: string;
  url?: string;
};

type MiddlewareUpdateBranchesResult = {
  branches: MiddlewareUpdateBranch[];
  defaultBranch: string;
  currentBranch?: string;
  runningBranch?: string;
  source: string;
};

const UPDATE_REPO_URL = "https://github.com/Nextbasedev/openclaw-desktop.git";
const DEFAULT_UPDATE_BRANCH = process.env.OPENCLAW_MIDDLEWARE_UPDATE_BRANCH || "main";
const UPDATE_SERVICE_NAME = process.env.OPENCLAW_MIDDLEWARE_SERVICE || "openclaw-middleware";
const UPDATE_STATUS_PATH = process.env.OPENCLAW_MIDDLEWARE_UPDATE_STATUS || path.join(os.tmpdir(), "openclaw-middleware-update-status.json");
const UPDATE_LOG_PATH = process.env.OPENCLAW_MIDDLEWARE_UPDATE_LOG || path.join(os.tmpdir(), "openclaw-middleware-update.log");
const UPDATE_ACTIVE_STALE_MS = 5 * 60 * 1000;

function findMiddlewareRepoRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, ".git")) && fs.existsSync(path.join(dir, "package.json"))) return dir;
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return path.resolve(process.cwd(), "../..");
}

function gitOutput(repoRoot: string, args: string[]) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryGitOutput(repoRoot: string, args: string[]) {
  try {
    const out = gitOutput(repoRoot, args);
    return out || undefined;
  } catch {
    return undefined;
  }
}

function readRunningMiddlewareBranch() {
  const repoRoot = findMiddlewareRepoRoot();
  return tryGitOutput(repoRoot, ["branch", "--show-current"])
    || tryGitOutput(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
    || undefined;
}

function shortSha(value?: string) {
  return value ? value.slice(0, 7) : "unknown";
}

function parsePorcelainStatus(text: string) {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const x = line[0];
    const y = line[1];
    if (line.startsWith("??")) { untracked += 1; continue; }
    if (x && x !== " ") staged += 1;
    if (y && y !== " ") unstaged += 1;
  }
  return { staged, unstaged, untracked, dirty: staged + unstaged + untracked > 0 };
}

function readMiddlewareGitStatus(branchInput?: unknown): MiddlewareGitStatus {
  const repoRoot = findMiddlewareRepoRoot();
  const checkedAt = nowIso();
  try {
    const currentBranch = gitOutput(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const targetBranch = normalizeMiddlewareUpdateBranch(branchInput || currentBranch || DEFAULT_UPDATE_BRANCH);
    let fetchError: string | undefined;
    try {
      gitOutput(repoRoot, ["fetch", "--quiet", "origin", targetBranch]);
    } catch (error) {
      fetchError = error instanceof Error ? error.message : String(error);
    }
    const upstream = `origin/${targetBranch}`;
    const headSha = gitOutput(repoRoot, ["rev-parse", "HEAD"]);
    const headSubject = gitOutput(repoRoot, ["log", "-1", "--format=%s", "HEAD"]);
    let remoteSha: string | undefined;
    let remoteSubject: string | undefined;
    let ahead = 0;
    let behind = 0;
    try {
      remoteSha = gitOutput(repoRoot, ["rev-parse", upstream]);
      remoteSubject = gitOutput(repoRoot, ["log", "-1", "--format=%s", upstream]);
      const counts = gitOutput(repoRoot, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`]).split(/\s+/).map((value) => Number(value));
      ahead = Number.isFinite(counts[0]) ? counts[0] : 0;
      behind = Number.isFinite(counts[1]) ? counts[1] : 0;
    } catch (error) {
      fetchError = fetchError || (error instanceof Error ? error.message : String(error));
    }
    const dirtyInfo = parsePorcelainStatus(gitOutput(repoRoot, ["status", "--porcelain"]));
    const diffSummary = [
      gitOutput(repoRoot, ["diff", "--stat"]),
      gitOutput(repoRoot, ["diff", "--cached", "--stat"]),
    ].filter(Boolean).join("\n");
    return {
      repoRoot,
      currentBranch,
      targetBranch,
      upstream,
      headSha,
      headSubject,
      remoteSha,
      remoteSubject,
      ahead,
      behind,
      ...dirtyInfo,
      diffSummary,
      checkedAt,
      error: fetchError,
    };
  } catch (error) {
    return { repoRoot, checkedAt, error: error instanceof Error ? error.message : String(error) };
  }
}

function middlewareGitStatusMessage(git: MiddlewareGitStatus) {
  if (git.error && !git.headSha) return `Git status unavailable: ${git.error}`;
  const branch = git.currentBranch || "unknown branch";
  const target = git.upstream || (git.targetBranch ? `origin/${git.targetBranch}` : "remote");
  const parts: string[] = [];
  if ((git.behind ?? 0) > 0) parts.push(`${branch} is ${git.behind} commit${git.behind === 1 ? "" : "s"} behind ${target}`);
  else if ((git.ahead ?? 0) > 0) parts.push(`${branch} is ${git.ahead} commit${git.ahead === 1 ? "" : "s"} ahead of ${target}`);
  else parts.push(`${branch} is up to date with ${target}`);
  if (git.dirty) parts.push(`working tree has ${(git.staged ?? 0) + (git.unstaged ?? 0) + (git.untracked ?? 0)} changed file${((git.staged ?? 0) + (git.unstaged ?? 0) + (git.untracked ?? 0)) === 1 ? "" : "s"}`);
  if (git.remoteSha && git.remoteSha !== git.headSha) parts.push(`local ${shortSha(git.headSha)} → remote ${shortSha(git.remoteSha)}`);
  else if (git.headSha) parts.push(`commit ${shortSha(git.headSha)}`);
  return parts.join("; ");
}

function readMiddlewareUpdateStatus(input: MiddlewareUpdateInput = {}): MiddlewareUpdateStatus {
  const requestedBranch = Object.prototype.hasOwnProperty.call(input, "branch")
    ? input.branch
    : undefined;
  let status: MiddlewareUpdateStatus;
  try {
    const parsed = JSON.parse(fs.readFileSync(UPDATE_STATUS_PATH, "utf8")) as MiddlewareUpdateStatus;
    status = parsed?.state && parsed?.updatedAt ? parsed : { state: "idle", updatedAt: nowIso(), branch: DEFAULT_UPDATE_BRANCH, logPath: UPDATE_LOG_PATH };
  } catch {
    status = { state: "idle", updatedAt: nowIso(), branch: DEFAULT_UPDATE_BRANCH, logPath: UPDATE_LOG_PATH };
  }
  if ((status.state === "running" || status.state === "restarting") && isStaleMiddlewareUpdateStatus(status)) {
    status = {
      ...status,
      state: "succeeded",
      message: status.state === "restarting"
        ? "Middleware service is back online after restart."
      : "Previous Middleware update status was stale; service is online.",
      updatedAt: nowIso(),
    };
    writeMiddlewareUpdateStatus(status);
  }
  const git = readMiddlewareGitStatus(requestedBranch);
  const statusMessage = status.state === "running" || status.state === "restarting" || status.state === "failed" || status.state === "succeeded"
    ? status.message
    : undefined;
  return {
    ...status,
    branch: git.targetBranch || status.branch,
    currentBranch: git.currentBranch || status.currentBranch,
    runningBranch: git.currentBranch || status.runningBranch,
    repoRoot: git.repoRoot || status.repoRoot,
    git,
    message: statusMessage || middlewareGitStatusMessage(git),
  };
}

function isStaleMiddlewareUpdateStatus(status: MiddlewareUpdateStatus) {
  const updatedAtMs = Date.parse(status.updatedAt || "");
  if (!Number.isFinite(updatedAtMs)) return true;
  return Date.now() - updatedAtMs > UPDATE_ACTIVE_STALE_MS;
}

function normalizeMiddlewareUpdateBranch(value: unknown) {
  const branch = String(value || DEFAULT_UPDATE_BRANCH).trim() || DEFAULT_UPDATE_BRANCH;
  if (!/^[A-Za-z0-9._\/-]{1,120}$/.test(branch) || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) {
    throw new HttpError(400, "Invalid update branch");
  }
  return branch;
}

function writeMiddlewareUpdateStatus(status: MiddlewareUpdateStatus) {
  fs.writeFileSync(UPDATE_STATUS_PATH, JSON.stringify({ ...status, updatedAt: nowIso() }, null, 2));
}

function fallbackMiddlewareUpdateBranches(source = "fallback"): MiddlewareUpdateBranchesResult {
  const repoRoot = findMiddlewareRepoRoot();
  const currentBranch = readRunningMiddlewareBranch();
  const defaultBranch = currentBranch || DEFAULT_UPDATE_BRANCH;
  const names = new Set<string>([defaultBranch, DEFAULT_UPDATE_BRANCH, "main", "dev-2-temp", "dev-2", "dev-3-harsh"]);
  try {
    const refs = gitOutput(repoRoot, ["branch", "-r", "--format=%(refname:short)"]);
    for (const ref of refs.split(/\r?\n/).filter(Boolean)) {
      const trimmed = ref.trim();
      if (!trimmed || trimmed === "origin" || trimmed === "origin/HEAD" || trimmed.endsWith("/HEAD")) continue;
      const name = trimmed.replace(/^origin\//, "").trim();
      if (name && name !== "HEAD") names.add(name);
    }
  } catch {}
  return {
    branches: [...names].filter(Boolean).map((name) => ({ name, url: `https://github.com/Nextbasedev/openclaw-desktop/tree/${encodeURIComponent(name)}` })),
    defaultBranch,
    currentBranch,
    runningBranch: currentBranch,
    source,
  };
}

async function listMiddlewareUpdateBranches(): Promise<MiddlewareUpdateBranchesResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch("https://api.github.com/repos/Nextbasedev/openclaw-desktop/branches?per_page=100", {
      headers: { "Accept": "application/vnd.github+json", "User-Agent": "openclaw-desktop-middleware" },
      signal: controller.signal,
    });
    if (!res.ok) return fallbackMiddlewareUpdateBranches(`github-${res.status}`);
    const rawBranches = await res.json() as Array<{ name?: string; commit?: { sha?: string; url?: string } }>;
    const remoteBranches = await Promise.all(rawBranches.map(async (branch): Promise<MiddlewareUpdateBranch | null> => {
      const name = String(branch.name || "").trim();
      if (!name) return null;
      let updatedAt: string | undefined;
      if (branch.commit?.url) {
        try {
          const commitRes = await fetch(branch.commit.url, {
            headers: { "Accept": "application/vnd.github+json", "User-Agent": "openclaw-desktop-middleware" },
            signal: controller.signal,
          });
          if (commitRes.ok) {
            const commit = await commitRes.json() as { commit?: { committer?: { date?: string }; author?: { date?: string } } };
            updatedAt = commit.commit?.committer?.date || commit.commit?.author?.date;
          }
        } catch {}
      }
      return { name, sha: branch.commit?.sha, updatedAt, url: `https://github.com/Nextbasedev/openclaw-desktop/tree/${encodeURIComponent(name)}` };
    }));
    const sorted = remoteBranches
      .filter((branch): branch is MiddlewareUpdateBranch => Boolean(branch));
    sorted.sort((a, b) => Date.parse(b.updatedAt || "0") - Date.parse(a.updatedAt || "0") || a.name.localeCompare(b.name));
    const currentBranch = readRunningMiddlewareBranch();
    const defaultBranch = currentBranch || DEFAULT_UPDATE_BRANCH;
    const hasCurrent = currentBranch ? sorted.some((branch) => branch.name === currentBranch) : true;
    const branches = sorted.length > 0 ? [...sorted] : fallbackMiddlewareUpdateBranches().branches;
    if (currentBranch && !hasCurrent) branches.unshift({ name: currentBranch, url: `https://github.com/Nextbasedev/openclaw-desktop/tree/${encodeURIComponent(currentBranch)}` });
    return { branches, defaultBranch, currentBranch, runningBranch: currentBranch, source: "github" };
  } catch {
    return fallbackMiddlewareUpdateBranches("fallback");
  } finally {
    clearTimeout(timeout);
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function startMiddlewareUpdate(input: MiddlewareUpdateInput = {}) {
  const branch = normalizeMiddlewareUpdateBranch(input.branch);
  const current = readMiddlewareUpdateStatus({ branch });
  if (current.state === "running" || current.state === "restarting") {
    return { ok: true, accepted: false, status: current, message: "Middleware update is already running" };
  }

  const repoRoot = findMiddlewareRepoRoot();
  const startedAt = nowIso();
  const status: MiddlewareUpdateStatus = {
    state: "running",
    startedAt,
    updatedAt: startedAt,
    message: `Starting Middleware update from ${branch}`,
    repoRoot,
    branch,
    logPath: UPDATE_LOG_PATH,
  };
  writeMiddlewareUpdateStatus(status);
  fs.writeFileSync(UPDATE_LOG_PATH, `[${startedAt}] Starting OpenClaw Middleware update\n`);

  const script = `
set -euo pipefail
STATUS=${shellQuote(UPDATE_STATUS_PATH)}
LOG=${shellQuote(UPDATE_LOG_PATH)}
REPO=${shellQuote(repoRoot)}
BRANCH=${shellQuote(branch)}
REPO_URL=${shellQuote(UPDATE_REPO_URL)}
SERVICE=${shellQuote(UPDATE_SERVICE_NAME)}
write_status() {
  node -e "const fs=require('fs'); const p=process.argv[1]; const state=process.argv[2]; const message=process.argv[3]; const repo=process.argv[4]; const branch=process.argv[5]; const log=process.argv[6]; fs.writeFileSync(p, JSON.stringify({state, message, repoRoot: repo, branch, logPath: log, updatedAt: new Date().toISOString()}, null, 2))" "$STATUS" "$1" "$2" "$REPO" "$BRANCH" "$LOG"
}
exec >>"$LOG" 2>&1
cd "$REPO"
write_status running "Fetching $BRANCH from GitHub"
echo "[$(date -u +%FT%TZ)] Fetching $BRANCH from $REPO_URL"
git remote set-url origin "$REPO_URL" || true
git fetch origin "$BRANCH"
if ! git diff --quiet || ! git diff --cached --quiet; then
  write_status running "Preserving local changes in git stash"
  echo "[$(date -u +%FT%TZ)] Preserving local changes in git stash"
  git stash push -u -m "openclaw-middleware-update-$(date -u +%Y%m%dT%H%M%SZ)" || true
fi
write_status running "Pulling latest $BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
if command -v corepack >/dev/null 2>&1; then corepack enable || true; fi
write_status running "Installing dependencies"
echo "[$(date -u +%FT%TZ)] Installing dependencies"
pnpm install --frozen-lockfile
write_status running "Building middleware"
echo "[$(date -u +%FT%TZ)] Building middleware"
pnpm --filter @openclaw/desktop-middleware build
write_status restarting "Build complete; starting Middleware service"
echo "[$(date -u +%FT%TZ)] Restarting $SERVICE"
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "$SERVICE.service" >/dev/null 2>&1; then
  systemctl restart "$SERVICE"
  write_status succeeded "Middleware updated from $BRANCH and service started"
else
  write_status failed "systemd service $SERVICE was not found; build succeeded but restart is manual"
  exit 1
fi
`;

  const child = spawnChild("bash", ["-lc", script], { detached: true, stdio: "ignore" });
  child.unref();
  return { ok: true, accepted: true, status };
}

async function scanTelegramSessions(context: AppContext, input: CompatRecord = {}) {
  loadCompatState(context);
  const agentId = String(input.agentId || "main");
  const diskIndexPath = gatewaySessionsIndexPath(agentId);
  let diskIndex: CompatRecord = {};
  const failures: TelegramDiscoveryFailure[] = [];
  let diskSource: TelegramDiscoverySource = { status: "unavailable", candidates: 0, accepted: 0 };
  if (fs.existsSync(diskIndexPath)) {
    try {
      const value = JSON.parse(fs.readFileSync(diskIndexPath, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Session index is not an object");
      diskIndex = value as CompatRecord;
      diskSource = { status: "complete", candidates: Object.keys(diskIndex).length, accepted: Object.keys(diskIndex).length };
    } catch (error) {
      diskSource = { status: "failed", candidates: 0, accepted: 0 };
      void error;
      failures.push({ source: "disk", code: "session_index_read_failed" });
    }
  }
  const gateway = input.includeGateway === false || input.includeGateway === "false"
    ? { index: {} as CompatRecord, source: { status: "skipped", pages: 0, accepted: 0 }, failures: [] as TelegramDiscoveryFailure[] }
    : await gatewayTelegramSessionEntries(context, agentId, input);
  const discovered = discoveredTelegramTranscriptEntries(agentId, { ...gateway.index, ...diskIndex });
  failures.push(...gateway.failures, ...discovered.failures);
  const index = mergeTelegramSessionIndexes(discovered.index, gateway.index, diskIndex);
  const limit = Math.max(0, Number(input.limit || 0));
  const usedNames = new Set<string>();
  const importedKeys = new Set([
    ...compatState.chats.map((chat) => chat.importedFrom?.sourceSessionKey).filter(Boolean),
    ...compatState.sessions.map((session) => session.importedFrom?.sourceSessionKey).filter(Boolean),
  ].map(String));
  const sessions = Object.entries(index).map(([sourceSessionKey, entryRaw]) => {
    const entry = (entryRaw && typeof entryRaw === "object") ? entryRaw as CompatRecord : {};
    const parsed = telegramSessionSource(sourceSessionKey, entry);
    if (!parsed) return null;
    const sourceSessionFile = String(entry.sessionFile || entry.transcriptPath || "");
    const relatedTranscriptFiles = Array.isArray(entry.relatedTranscriptFiles) ? entry.relatedTranscriptFiles.map(String) : [];
    const transcriptFiles = Array.from(new Set([...relatedTranscriptFiles, sourceSessionFile].filter(Boolean)));
    const archivedTranscriptFiles = transcriptFiles.filter((file) => file !== sourceSessionFile);
    const sampleMessages = sampleTelegramMessagesForScan(sourceSessionFile, relatedTranscriptFiles);
    const telegramMeta = telegramMetaFromMessages(sampleMessages);
    const topicName = parsed.kind === "group"
      ? (telegramMeta?.topicName || telegramTopicFallback(entry, parsed.topicId))
      : undefined;
    const fallback = parsed.kind === "direct"
      ? (telegramMeta?.sender || "Telegram direct")
      : (topicName || telegramTopicFallback(entry, parsed.topicId));
    const preview = lastUserMessagePreview(sampleMessages);
    const proposedName = uniqueName(parsed.kind === "group" ? fallback : (preview ? preview.slice(0, 45).trim() : fallback), usedNames);
    const messageCount = entryMessageCount(entry);
    const archivedMessageCount = entryMessageCount({ messageCount: entry.archivedMessageCount });
    return {
      sourceSessionKey,
      sourceSessionId: String(entry.sessionId || ""),
      sourceSessionFile,
      agentId: parsed.agentId,
      archivedTranscriptFiles,
      proposedName,
      messageCount,
      archivedMessageCount,
      lastUserMessagePreview: preview,
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : (timeMs(entry.updatedAt) || null),
      chatType: parsed.kind,
      groupId: parsed.kind === "group" ? parsed.groupId : undefined,
      groupName: parsed.kind === "group" ? (telegramMeta?.groupSubject || telegramGroupName(entry, parsed.groupId)) : undefined,
      topicId: parsed.kind === "group" ? parsed.topicId : undefined,
      topicName: parsed.kind === "group" ? topicName : undefined,
      alreadyImported: importedKeys.has(sourceSessionKey),
    };
  }).filter(Boolean) as CompatRecord[];
  sessions.sort((left, right) => {
    const timestamp = (value: unknown) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
      const parsed = Date.parse(String(value || ""));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const byUpdatedAt = timestamp(right.updatedAt) - timestamp(left.updatedAt);
    return byUpdatedAt || String(left.sourceSessionKey).localeCompare(String(right.sourceSessionKey));
  });
  const selected = limit > 0 ? sessions.slice(0, limit) : sessions;
  const groups = new Map<string, CompatRecord>();
  for (const session of selected) {
    if (session.chatType !== "group") continue;
    const current = groups.get(session.groupId) ?? { groupId: session.groupId, name: session.groupName, topics: 0 };
    current.topics += 1;
    groups.set(session.groupId, current);
  }
  return {
    sessions: selected,
    summary: {
      total: selected.length,
      direct: selected.filter((session) => session.chatType === "direct").length,
      groups: groups.size,
      topics: selected.filter((session) => session.chatType === "group").length,
      alreadyImported: selected.filter((session) => session.alreadyImported).length,
    },
    groups: [...groups.values()],
    diagnostics: {
      sources: {
        disk: diskSource,
        gateway: gateway.source,
        transcripts: discovered.source,
      },
      partialFailures: summarizeTelegramDiscoveryFailures(failures),
    },
  };
}

function scanDiscordSessions(context: AppContext, input: CompatRecord = {}) {
  loadCompatState(context);
  const agentId = String(input.agentId || "main");
  const index = readJsonFile(gatewaySessionsIndexPath(agentId));
  const limit = Math.max(0, Number(input.limit || 0));
  const usedNames = new Set<string>();
  const importedKeys = new Set([
    ...compatState.chats.map((chat) => chat.importedFrom?.sourceSessionKey).filter(Boolean),
    ...compatState.sessions.map((session) => session.importedFrom?.sourceSessionKey).filter(Boolean),
  ].map(String));
  const sessions = Object.entries(index).map(([sourceSessionKey, entryRaw]) => {
    const parsed = parseDiscordSessionKey(sourceSessionKey);
    if (!parsed) return null;
    const entry = (entryRaw && typeof entryRaw === "object") ? entryRaw as CompatRecord : {};
    const sourceSessionFile = String(entry.sessionFile || "");
    const messages = sourceSessionFile ? transcriptMessagesFromJsonl(sourceSessionFile) : [];
    const discordMeta = discordMetaFromMessages(messages);
    const preview = lastUserMessagePreview(messages);
    const fallback = parsed.kind === "direct"
      ? (discordMeta?.sender || "Discord direct")
      : discordTopicFallback(entry, parsed.channelId, parsed.threadId, discordMeta);
    const proposedName = uniqueName(parsed.kind === "channel" ? fallback : (preview ? preview.slice(0, 45).trim() : fallback), usedNames);
    return {
      sourceSessionKey,
      sourceSessionId: String(entry.sessionId || ""),
      sourceSessionFile,
      proposedName,
      messageCount: messages.filter((message) => message?.role && message.role !== "system").length,
      lastUserMessagePreview: preview,
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : null,
      chatType: parsed.kind,
      groupId: parsed.kind === "channel" ? (discordMeta?.groupSpace || parsed.channelId) : undefined,
      groupName: parsed.kind === "channel" ? discordProjectName(entry, parsed.channelId, discordMeta) : undefined,
      channelId: parsed.kind === "channel" ? parsed.channelId : undefined,
      threadId: parsed.kind === "channel" ? parsed.threadId : undefined,
      topicName: parsed.kind === "channel" ? proposedName : undefined,
      alreadyImported: importedKeys.has(sourceSessionKey),
    };
  }).filter(Boolean) as CompatRecord[];
  const selected = limit > 0 ? sessions.slice(0, limit) : sessions;
  const groups = new Map<string, CompatRecord>();
  for (const session of selected) {
    if (session.chatType !== "channel") continue;
    const current = groups.get(session.groupId) ?? { groupId: session.groupId, name: session.groupName, topics: 0 };
    current.topics += 1;
    groups.set(session.groupId, current);
  }
  return {
    sessions: selected,
    summary: {
      total: selected.length,
      direct: selected.filter((session) => session.chatType === "direct").length,
      groups: groups.size,
      topics: selected.filter((session) => session.chatType === "channel").length,
      alreadyImported: selected.filter((session) => session.alreadyImported).length,
    },
    groups: [...groups.values()],
  };
}

function transcriptMessageBodyFromHistoryMessage(message: CompatRecord) {
  const stripped = { ...message };
  delete stripped.__openclaw;
  if (stripped.content === undefined && typeof stripped.text === "string") {
    stripped.content = stripped.text;
  }
  return stripped;
}

function transcriptLineFromHistoryMessage(message: CompatRecord, parentId: string | null) {
  const meta = message.__openclaw && typeof message.__openclaw === "object" ? message.__openclaw as CompatRecord : {};
  const idValue = String(meta.id || message.id || crypto.randomUUID());
  const timestamp = typeof message.timestamp === "number" ? new Date(message.timestamp).toISOString() : typeof message.timestamp === "string" ? message.timestamp : nowIso();
  return {
    type: "message",
    id: idValue,
    parentId,
    timestamp,
    message: transcriptMessageBodyFromHistoryMessage(message),
  };
}

function copyHistoryMessagesToTranscript(transcriptPath: string, messages: CompatRecord[]) {
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  const existing = fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, "utf8") : "";
  const header = existing.split(/\r?\n/).find((line) => {
    if (!line.trim()) return false;
    try { return JSON.parse(line)?.type === "session"; } catch { return false; }
  }) || JSON.stringify({ type: "session", version: 1, id: path.basename(transcriptPath, ".jsonl"), timestamp: nowIso(), cwd: process.cwd() });
  let parentId: string | null = null;
  const messageLines = messages.filter((message) => message && message.role !== "system").map((message) => {
    const line = transcriptLineFromHistoryMessage(message, parentId);
    parentId = line.id;
    return JSON.stringify(line);
  });
  const lines = [header, ...messageLines];
  fs.writeFileSync(transcriptPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}

function persistImportedChatMessages(context: AppContext, input: { sessionKey: string; sessionId: string; transcriptPath: string; label: string; messages: CompatRecord[] }) {
  const segment = context.messages.ensureActiveSegment({
    sessionKey: input.sessionKey,
    sessionId: input.sessionId,
    sessionFile: input.transcriptPath,
  });
  const normalized = normalizeHistoryMessages(input.sessionKey, input.messages);
  const result = normalized.length > 0
    ? context.messages.upsertMessages(normalized, { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq })
    : { upserted: 0 };
  context.messages.upsertSession({
    sessionKey: input.sessionKey,
    sessionId: input.sessionId,
    data: { sessionKey: input.sessionKey, sessionId: input.sessionId, status: "done", statusLabel: null, label: input.label, sessionFile: input.transcriptPath },
  });
  context.messages.appendProjectionEvent({
    sessionKey: input.sessionKey,
    eventType: "session.upsert",
    payload: { sessionKey: input.sessionKey, sessionId: input.sessionId, label: input.label },
  });
  return result.upserted;
}

function importedPlatformSessionLink(sessionKey: string) {
  const session = compatState.sessions.find((item) => (item.sessionKey === sessionKey || item.key === sessionKey) && item.importedFrom?.kind && item.importedFrom?.sourceSessionKey);
  const chat = compatState.chats.find((item) => item.sessionKey === sessionKey && item.importedFrom?.kind && item.importedFrom?.sourceSessionKey);
  const source = session?.importedFrom ?? chat?.importedFrom;
  const kind = source?.kind === "telegram" || source?.kind === "discord" ? source.kind as ImportedPlatformKind : null;
  const sourceSessionKey = typeof source?.sourceSessionKey === "string" ? source.sourceSessionKey : null;
  if (!kind || !sourceSessionKey) return null;
  return { kind, sourceSessionKey, label: String(session?.label || session?.name || chat?.name || `${importedPlatformProjectName(kind)} import`) };
}

function importedDesktopSessionKey(kind: ImportedPlatformKind, sourceSessionKey: string) {
  const session = compatState.sessions.find((item) => item.importedFrom?.kind === kind && item.importedFrom?.sourceSessionKey === sourceSessionKey && (item.sessionKey || item.key));
  if (session) return String(session.sessionKey || session.key);
  const chat = compatState.chats.find((item) => item.importedFrom?.kind === kind && item.importedFrom?.sourceSessionKey === sourceSessionKey && item.sessionKey);
  return chat?.sessionKey ? String(chat.sessionKey) : null;
}

async function hydrateImportedPlatformSessionMessages(context: AppContext, kind: ImportedPlatformKind, sourceSessionKey: string, fallbackLabel?: string, sourceRecord?: CompatRecord) {
  const desktopSessionKey = importedDesktopSessionKey(kind, sourceSessionKey);
  if (!desktopSessionKey) return { hydrated: false, reason: "missing_desktop_session" };
  const scan = sourceRecord ? null : kind === "telegram"
    ? await scanTelegramSessions(context, { sourceSessionKeys: [sourceSessionKey] })
    : scanDiscordSessions(context, { sourceSessionKeys: [sourceSessionKey] });
  const source = sourceRecord ?? scan?.sessions.find((item: CompatRecord) => item.sourceSessionKey === sourceSessionKey);
  if (!source) return { hydrated: false, reason: "missing_source_session", desktopSessionKey };
  const sourceMessages = kind === "telegram" ? telegramSourceMessagesForSession(source) : transcriptMessagesFromJsonl(source.sourceSessionFile);
  if (sourceMessages.length === 0) return { hydrated: false, reason: "empty_source_messages", desktopSessionKey };
  const transcriptPath = kind === "telegram"
    ? (telegramTranscriptFilesForSession(source).slice(-1)[0] || String(source.sourceSessionFile || ""))
    : String(source.sourceSessionFile || "");
  if (!transcriptPath) return { hydrated: false, reason: "missing_source_file", desktopSessionKey };
  const label = String(fallbackLabel || source.proposedName || `${importedPlatformProjectName(kind)} import`);
  const sessionId = String(source.sourceSessionId || desktopSessionKey);
  const upserted = persistImportedChatMessages(context, { sessionKey: desktopSessionKey, sessionId, transcriptPath, label, messages: sourceMessages });
  return { hydrated: true, desktopSessionKey, upserted, copiedMessages: sourceMessages.filter((message) => message.role !== "system").length };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

function migrationImportConcurrency(input: CompatRecord) {
  const value = Number(input.concurrency ?? input.importConcurrency ?? 8);
  return Number.isFinite(value) && value > 0 ? Math.min(8, Math.max(1, Math.floor(value))) : 8;
}

function agentIdFromSessionKey(sessionKey: string) {
  const match = sessionKey.match(/^agent:([^:]+):/);
  return match?.[1] || "main";
}

function messageIdOf(message: CompatRecord) {
  return readOpenClawMessageId(message) ?? null;
}

function sessionFileFromCreateResult(created: CompatRecord) {
  const candidate = created?.payload?.entry?.sessionFile ?? created?.entry?.sessionFile ?? created?.sessionFile;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function sessionIdFromCreateResult(created: CompatRecord, fallbackSessionKey: string) {
  const candidate = created?.payload?.entry?.sessionId ?? created?.entry?.sessionId ?? created?.sessionId ?? created?.payload?.entry?.id ?? created?.entry?.id;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : fallbackSessionKey;
}

function normalizeHistoryForFork(history: CompatRecord) {
  return Array.isArray(history.messages) ? history.messages.filter((message) => message && typeof message === "object" && !Array.isArray(message)) as CompatRecord[] : [];
}

function messageSeqOf(message: CompatRecord) {
  const meta = message.__openclaw && typeof message.__openclaw === "object" ? message.__openclaw as CompatRecord : {};
  const seq = Number(meta.seq ?? message.gatewayIndex ?? message.openclawSeq);
  return Number.isInteger(seq) && seq >= 0 ? seq : null;
}

function findForkMessageIndex(messages: CompatRecord[], input: CompatRecord) {
  const messageId = String(input.messageId ?? "").trim();
  if (messageId) {
    const byId = messages.findIndex((message) => messageIdOf(message) === messageId || message.id === messageId || message.messageId === messageId);
    if (byId >= 0) return byId;
  }

  const gatewayIndex = Number(input.gatewayIndex);
  if (!Number.isInteger(gatewayIndex) || gatewayIndex < 0) return -1;
  const bySeq = messages.findIndex((message) => messageSeqOf(message) === gatewayIndex);
  if (bySeq >= 0) return bySeq;

  // Last-resort compatibility for very old histories where the UI only sent an
  // array offset and the messages have no transcript sequence/id metadata.
  return messageId ? -1 : gatewayIndex < messages.length ? gatewayIndex : -1;
}

function sourceChatForSession(sessionKey: string) {
  return compatState.chats.find((chat) => chat.sessionKey === sessionKey || chat.key === sessionKey) ?? null;
}

function sourceSessionForSession(sessionKey: string) {
  return compatState.sessions.find((session) => session.sessionKey === sessionKey || session.key === sessionKey) ?? null;
}

async function createChatFork(context: AppContext, input: CompatRecord) {
  loadCompatState(context);
  const sourceSessionKey = String(input.sessionKey ?? "").trim();
  const sourceMessageId = String(input.messageId ?? "").trim();
  if (!sourceSessionKey) throw new HttpError(400, "sessionKey required", "BAD_REQUEST");
  if (!sourceMessageId && input.gatewayIndex === undefined) throw new HttpError(400, "messageId or gatewayIndex required", "BAD_REQUEST");

  const history = await context.gateway.request<CompatRecord>("chat.history", { sessionKey: sourceSessionKey }, 30_000);
  const messages = normalizeHistoryForFork(history);
  const messageIndex = findForkMessageIndex(messages, input);
  if (messageIndex < 0 || messageIndex >= messages.length) {
    throw new HttpError(400, `Message index ${messageIndex} out of range (${messages.length} messages)`, "BAD_REQUEST");
  }
  const sliced = messages.slice(0, messageIndex + 1);
  const selectedMessageId = sourceMessageId || messageIdOf(messages[messageIndex]) || `index:${messageIndex}`;
  const agentId = String(input.agentId || history.agentId || agentIdFromSessionKey(sourceSessionKey));
  const newSessionKey = String(input.branchSessionKey || input.newSessionKey || `agent:${agentId}:desktop:fork-${crypto.randomUUID()}`);
  const forkLabel = String(input.name || input.label || input.branchName || `Fork ${crypto.randomUUID().slice(0, 8)}`);
  const created = await context.gateway.request<CompatRecord>("sessions.create", {
    key: newSessionKey,
    agentId,
    label: gatewaySessionLabel(forkLabel, newSessionKey),
    parentSessionKey: sourceSessionKey,
  }, 30_000);
  const transcriptPath = sessionFileFromCreateResult(created);
  if (!transcriptPath) throw new Error("sessions.create did not return entry.sessionFile");
  copyHistoryMessagesToTranscript(transcriptPath, sliced);

  const now = nowIso();
  const requestContext = input.context && typeof input.context === "object" && !Array.isArray(input.context) ? input.context as CompatRecord : {};
  const isTopicFork = requestContext.type === "topic" && typeof requestContext.projectId === "string" && requestContext.projectId.trim().length > 0;
  const chatId = isTopicFork ? null : id("chat");
  const branchId = id("branch");
  const sourceChat = sourceChatForSession(sourceSessionKey);
  const sourceSession = sourceSessionForSession(sourceSessionKey);
  const projectId = isTopicFork ? String(requestContext.projectId) : sourceSession?.projectId ?? null;
  const topicId = isTopicFork ? id("topic") : null;
  const spaceId = sourceChat?.spaceId || activeSpaceId();
  const sessionId = sessionIdFromCreateResult(created, newSessionKey);

  if (isTopicFork && topicId) {
    compatState.topics.push({
      id: topicId,
      name: forkLabel,
      projectId,
      archived: false,
      pinned: false,
      unreadCount: 0,
      sortOrder: Date.now(),
      createdAt: now,
      updatedAt: now,
      forkedFrom: {
        topicId: requestContext.topicId ?? sourceSession?.topicId ?? null,
        sessionKey: sourceSessionKey,
        messageId: selectedMessageId,
      },
    });
  } else {
    compatState.chats.push({
      id: chatId,
      name: forkLabel,
      sessionKey: newSessionKey,
      spaceId,
      agentId,
      archived: false,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
    });
  }
  const session = {
    id: id("session"),
    key: newSessionKey,
    sessionKey: newSessionKey,
    projectId,
    topicId,
    agentId,
    label: forkLabel,
    status: "idle",
    hidden: false,
    createdAt: now,
    updatedAt: now,
  };
  const branch = {
    id: branchId,
    sourceSessionKey,
    sourceMessageId: selectedMessageId,
    branchSessionKey: newSessionKey,
    branchTopicId: topicId,
    branchReason: "fork",
    createdAt: now,
    metadata: {
      sourceGatewaySessionId: sourceSessionKey,
      newGatewaySessionId: newSessionKey,
      messageIndex,
      transcriptPath,
    },
  };

  compatState.sessions.push(session);
  compatState.branches.push(branch);
  saveCompatState(context);

  context.messages.upsertSession({
    sessionKey: newSessionKey,
    sessionId,
    data: { sessionKey: newSessionKey, sessionId, status: "done", statusLabel: null, label: forkLabel, parentSessionKey: sourceSessionKey },
  });
  context.messages.upsertMessages(normalizeHistoryMessages(newSessionKey, sliced));
  context.messages.appendProjectionEvent({
    sessionKey: newSessionKey,
    eventType: "session.upsert",
    payload: { sessionKey: newSessionKey, sessionId, label: forkLabel, parentSessionKey: sourceSessionKey, isFork: true },
  });

  return {
    ok: true,
    chatId,
    sessionKey: newSessionKey,
    name: forkLabel,
    messages: sliced,
    sourceSessionKey,
    sourceMessageId: selectedMessageId,
    branch,
    projectId: session.projectId,
    topicId: session.topicId,
  };
}

async function chatForkHistory(context: AppContext, input: CompatRecord) {
  loadCompatState(context);
  const sessionKey = String(input.sessionKey ?? "").trim();
  if (!sessionKey) throw new HttpError(400, "sessionKey required", "BAD_REQUEST");
  const branch = compatState.branches.find((item) => item.branchSessionKey === sessionKey && item.branchReason === "fork");
  if (!branch) return { messages: [], isFork: false };
  const messageIndex = Number(branch.metadata?.messageIndex ?? -1);
  try {
    const history = await context.gateway.request<CompatRecord>("chat.history", { sessionKey: branch.sourceSessionKey }, 30_000);
    const messages = normalizeHistoryForFork(history);
    return {
      messages: messageIndex >= 0 ? messages.slice(0, messageIndex + 1) : [],
      isFork: true,
      sourceSessionKey: branch.sourceSessionKey,
      sourceMessageId: branch.sourceMessageId,
    };
  } catch {
    return {
      messages: [],
      isFork: true,
      sourceSessionKey: branch.sourceSessionKey,
      sourceMessageId: branch.sourceMessageId,
    };
  }
}

function findMessageIndexById(messages: CompatRecord[], messageId: string) {
  return messages.findIndex((message) => messageIdOf(message) === messageId || message.id === messageId || message.messageId === messageId);
}

function nextAssistantAfter(messages: CompatRecord[], index: number) {
  for (let i = index + 1; i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.role === "user") return null;
    if (message?.role === "assistant") return message;
  }
  return null;
}

function editedUserMessage(original: CompatRecord, text: string, messageId: string) {
  return {
    ...original,
    id: messageId,
    messageId,
    role: "user",
    text,
    content: text,
    createdAt: new Date().toISOString(),
    __openclaw: undefined,
  };
}

function appendProjectedChatMessage(context: AppContext, sessionKey: string, message: CompatRecord) {
  const [projected] = normalizeHistoryMessages(sessionKey, [message]);
  if (projected) context.messages.upsertMessages([projected]);
  context.messages.appendProjectionEvent({
    sessionKey,
    eventType: "chat.message.upsert",
    payload: { type: "chat.message", ...message },
  });
}

async function createEditPreview(context: AppContext, input: CompatRecord) {
  loadCompatState(context);
  const sourceSessionKey = String(input.sessionKey ?? "").trim();
  const sourceUserMessageId = String(input.userMessageId ?? input.messageId ?? "").trim();
  const text = String(input.text ?? "").trim();
  if (!sourceSessionKey) throw new HttpError(400, "sessionKey required", "BAD_REQUEST");
  if (!sourceUserMessageId) throw new HttpError(400, "userMessageId required", "BAD_REQUEST");
  if (!text) throw new HttpError(400, "text required", "BAD_REQUEST");

  const history = await context.gateway.request<CompatRecord>("chat.history", { sessionKey: sourceSessionKey }, 30_000);
  const messages = normalizeHistoryForFork(history);
  const userIndex = findMessageIndexById(messages, sourceUserMessageId);
  if (userIndex < 0 || messages[userIndex]?.role !== "user") {
    throw new HttpError(404, "User message not found", "NOT_FOUND");
  }

  const originalUser = messages[userIndex];
  const originalAssistant = nextAssistantAfter(messages, userIndex);
  const agentId = String(input.agentId || history.agentId || agentIdFromSessionKey(sourceSessionKey));
  const branchSessionKey = String(input.branchSessionKey || `agent:${agentId}:desktop:edit-${crypto.randomUUID()}`);
  const sourceChat = sourceChatForSession(sourceSessionKey);
  const sourceSession = sourceSessionForSession(sourceSessionKey);
  const branchLabel = String(input.name || input.label || `Edit preview ${crypto.randomUUID().slice(0, 8)}`);
  const created = await context.gateway.request<CompatRecord>("sessions.create", {
    key: branchSessionKey,
    agentId,
    label: gatewaySessionLabel(branchLabel, branchSessionKey),
    parentSessionKey: sourceSessionKey,
  }, 30_000);
  const transcriptPath = sessionFileFromCreateResult(created);
  if (!transcriptPath) throw new Error("sessions.create did not return entry.sessionFile");

  const prefix = messages.slice(0, userIndex);
  copyHistoryMessagesToTranscript(transcriptPath, prefix);
  const editedUser = editedUserMessage(originalUser, text, `edited:${sourceUserMessageId}`);
  const sessionId = sessionIdFromCreateResult(created, branchSessionKey);
  const now = nowIso();
  const branch = {
    id: id("branch"),
    sourceSessionKey,
    sourceMessageId: sourceUserMessageId,
    branchSessionKey,
    branchTopicId: null,
    branchReason: "edit-preview",
    createdAt: now,
    metadata: { userIndex, transcriptPath, sourceAssistantMessageId: originalAssistant ? messageIdOf(originalAssistant) : null },
  };
  compatState.sessions.push({
    id: id("session"),
    key: branchSessionKey,
    sessionKey: branchSessionKey,
    projectId: sourceSession?.projectId ?? null,
    topicId: sourceSession?.topicId ?? null,
    agentId,
    label: branchLabel,
    status: "thinking",
    hidden: true,
    createdAt: now,
    updatedAt: now,
  });
  compatState.branches.push(branch);
  saveCompatState(context);

  context.messages.upsertSession({
    sessionKey: branchSessionKey,
    sessionId,
    data: { sessionKey: branchSessionKey, sessionId, status: "thinking", statusLabel: "Thinking", label: branchLabel, parentSessionKey: sourceSessionKey, sourceChatId: sourceChat?.id ?? null },
  });
  context.messages.upsertMessages(normalizeHistoryMessages(branchSessionKey, [...prefix, editedUser]));

  void (async () => {
    try {
      await context.gateway.request("chat.send", { sessionKey: branchSessionKey, message: text, timeoutMs: 120_000, idempotencyKey: `edit:${branchSessionKey}:${sourceUserMessageId}` }, 130_000);
      const branchHistory = await context.gateway.request<CompatRecord>("chat.history", { sessionKey: branchSessionKey, limit: 200 }, 30_000);
      const branchMessages = normalizeHistoryForFork(branchHistory);
      context.messages.upsertMessages(normalizeHistoryMessages(branchSessionKey, branchMessages));
      const assistant = [...branchMessages].reverse().find((message) => message.role === "assistant");
      if (assistant) appendProjectedChatMessage(context, branchSessionKey, assistant);
      context.messages.appendProjectionEvent({ sessionKey: branchSessionKey, eventType: "chat.status", payload: { type: "chat.status", state: "done", status: "done" } });
    } catch (error) {
      context.messages.appendProjectionEvent({ sessionKey: branchSessionKey, eventType: "chat.error", payload: { type: "chat.error", message: error instanceof Error ? error.message : "Edit preview failed" } });
    }
  })();

  return {
    branchSessionKey,
    sourceUserMessageId,
    sourceAssistantMessageId: originalAssistant ? messageIdOf(originalAssistant) : null,
    original: { user: originalUser, assistant: originalAssistant },
    edited: { user: editedUser, assistant: null },
    branch,
  };
}

async function importTelegramSessions(context: AppContext, input: CompatRecord = {}) {
  loadCompatState(context);
  const scan = await scanTelegramSessions(context, input);
  const selectedKeys = Array.isArray(input.sourceSessionKeys) && input.sourceSessionKeys.length > 0 ? new Set(input.sourceSessionKeys.map(String)) : null;
  const dryRun = Boolean(input.dryRun);
  const targetSpaceId = dryRun ? activeSpaceId() : String(ensureImportedPlatformSpace("telegram").id);
  const imported: CompatRecord[] = [];
  const skipped: CompatRecord[] = [];
  const failed: CompatRecord[] = [];
  const sessionsToImport = scan.sessions.filter((session) => !selectedKeys || selectedKeys.has(session.sourceSessionKey));
  const outcomes = await mapWithConcurrency(sessionsToImport, migrationImportConcurrency(input), async (session) => {
    const parsed = telegramSessionSourceFromScan(session);
    if (!parsed) return { type: "skipped" as const, value: { sourceSessionKey: session.sourceSessionKey, reason: "invalid_session_key" } };
    const alreadyImported = Boolean(session.alreadyImported) || isImportedSourceSession("telegram", session.sourceSessionKey);
    const repaired = alreadyImported ? repairImportedSessionSpace("telegram", session.sourceSessionKey, targetSpaceId) : false;
    if (alreadyImported) {
      return { type: "skipped" as const, value: { sourceSessionKey: session.sourceSessionKey, reason: "already_imported", repairedSpace: repaired } };
    }
    const sourceMessages = telegramSourceMessagesForSession(session);
    const label = parsed.kind === "group"
      ? String(session.proposedName || session.topicName || "Telegram import")
      : String(session.proposedName || "Telegram import");
    if (dryRun) return { type: "imported" as const, value: { sourceSessionKey: session.sourceSessionKey, name: label, copiedMessages: sourceMessages.length, archivedTranscriptFiles: session.archivedTranscriptFiles ?? [], dryRun: true } };
    try {
      const desktopSessionKey = `agent:${parsed.agentId}:desktop:migrated-telegram-${crypto.randomUUID()}`;
      // Transcript-discovered Telegram topics often do not exist in the
      // Gateway sessions index, so linking them as parentSessionKey makes
      // sessions.create fail. Preserve source linkage in compat importedFrom
      // metadata instead; the copied transcript is the durable history.
      const created = await context.gateway.request<CompatRecord>("sessions.create", { key: desktopSessionKey, agentId: parsed.agentId, label: gatewaySessionLabel(label, desktopSessionKey) }, 30_000);
      const transcriptPath = sessionFileFromCreateResult(created);
      if (typeof transcriptPath !== "string" || !transcriptPath) throw new Error("sessions.create did not return entry.sessionFile");
      copyHistoryMessagesToTranscript(transcriptPath, sourceMessages);
      const sessionId = sessionIdFromCreateResult(created, desktopSessionKey);
      persistImportedChatMessages(context, { sessionKey: desktopSessionKey, sessionId, transcriptPath, label, messages: sourceMessages });
      const timestamp = nowIso();
      compatState.sessions.push({ id: stableCompatId("session", desktopSessionKey), key: desktopSessionKey, sessionKey: desktopSessionKey, label, agentId: parsed.agentId, status: "idle", hidden: false, spaceId: targetSpaceId, projectId: null, topicId: null, createdAt: timestamp, updatedAt: timestamp, importedFrom: { kind: "telegram", sourceSessionKey: session.sourceSessionKey } });
      const chat = ensureImportedFlatChat("telegram", { sourceSessionKey: session.sourceSessionKey, targetSpaceId, label, sessionKey: desktopSessionKey, agentId: parsed.agentId, timestamp });
      // Fire-and-forget pre-warm: don't block the import loop since each
      // prewarm can take seconds. The first chat open will still be fast
      // if prewarm finishes in the background before the user clicks.
      void prewarmArchivedHistory(context, desktopSessionKey).catch(() => { /* non-fatal */ });
      return { type: "imported" as const, value: { sourceSessionKey: session.sourceSessionKey, desktopSessionKey, chatId: chat.id, projectId: null, topicId: null, spaceId: targetSpaceId, name: label, copiedMessages: sourceMessages.filter((message) => message.role !== "system").length, archivedTranscriptFiles: session.archivedTranscriptFiles ?? [], transcriptPath } };
    } catch (error) {
      return { type: "failed" as const, value: { sourceSessionKey: session.sourceSessionKey, error: error instanceof Error ? error.message : String(error) } };
    }
  });
  for (const outcome of outcomes) {
    if (outcome.type === "imported") imported.push(outcome.value);
    else if (outcome.type === "skipped") skipped.push(outcome.value);
    else failed.push(outcome.value);
  }
  if (!dryRun) normalizeImportedPlatformState("telegram");
  if (!dryRun) saveCompatState(context);
  return { imported, skipped, failed, summary: { imported: imported.length, skipped: skipped.length, failed: failed.length } };
}

function repairImportedSessionSpace(kind: ImportedPlatformKind, sourceSessionKey: unknown, targetSpaceId: string) {
  const sourceKey = String(sourceSessionKey || "");
  if (!sourceKey || !targetSpaceId) return false;
  const timestamp = nowIso();
  const before = JSON.stringify({ sessions: compatState.sessions, chats: compatState.chats, projects: compatState.projects, topics: compatState.topics });
  const matchingSessions = compatState.sessions.filter((session) => session.importedFrom?.kind === kind && session.importedFrom?.sourceSessionKey === sourceKey);
  const matchingChats = compatState.chats.filter((chat) => chat.importedFrom?.kind === kind && chat.importedFrom?.sourceSessionKey === sourceKey);
  if (matchingSessions.length === 0 && matchingChats.length === 0) return false;
  for (const session of matchingSessions) {
    session.spaceId = targetSpaceId;
    session.projectId = null;
    session.topicId = null;
    session.updatedAt = timestamp;
    const sessionKey = String(session.sessionKey || session.key || "");
    if (sessionKey) {
      ensureImportedFlatChat(kind, {
        sourceSessionKey: sourceKey,
        targetSpaceId,
        label: String(session.label || session.name || matchingChats[0]?.name || `${importedPlatformProjectName(kind)} import`),
        sessionKey,
        agentId: session.agentId,
        timestamp,
      });
    }
  }
  for (const chat of matchingChats) {
    chat.spaceId = targetSpaceId;
    chat.projectId = null;
    chat.topicId = null;
    chat.archived = false;
    chat.updatedAt = timestamp;
  }
  retireImportedPlatformProjectStructure(kind, timestamp);
  const after = JSON.stringify({ sessions: compatState.sessions, chats: compatState.chats, projects: compatState.projects, topics: compatState.topics });
  return before !== after;
}

async function importDiscordSessions(context: AppContext, input: CompatRecord = {}) {
  loadCompatState(context);
  const scan = scanDiscordSessions(context, input);
  const selectedKeys = Array.isArray(input.sourceSessionKeys) && input.sourceSessionKeys.length > 0 ? new Set(input.sourceSessionKeys.map(String)) : null;
  const dryRun = Boolean(input.dryRun);
  const targetSpaceId = dryRun ? activeSpaceId() : String(ensureImportedPlatformSpace("discord").id);
  const imported: CompatRecord[] = [];
  const skipped: CompatRecord[] = [];
  const failed: CompatRecord[] = [];
  for (const session of scan.sessions) {
    if (selectedKeys && !selectedKeys.has(session.sourceSessionKey)) continue;
    const parsed = parseDiscordSessionKey(session.sourceSessionKey);
    if (!parsed) continue;
    const alreadyImported = Boolean(session.alreadyImported) || isImportedSourceSession("discord", session.sourceSessionKey);
    const repaired = alreadyImported ? repairImportedSessionSpace("discord", session.sourceSessionKey, targetSpaceId) : false;
    if (alreadyImported) {
      skipped.push({ sourceSessionKey: session.sourceSessionKey, reason: "already_imported", repairedSpace: repaired });
      continue;
    }
    const sourceMessages = transcriptMessagesFromJsonl(session.sourceSessionFile);
    if (dryRun) { imported.push({ sourceSessionKey: session.sourceSessionKey, name: session.proposedName, copiedMessages: sourceMessages.length, dryRun: true }); continue; }
    try {
      const desktopSessionKey = `agent:${parsed.agentId}:desktop:migrated-discord-${crypto.randomUUID()}`;
      const label = session.proposedName || "Discord import";
      const created = await context.gateway.request<CompatRecord>("sessions.create", { key: desktopSessionKey, agentId: parsed.agentId, label: gatewaySessionLabel(label, desktopSessionKey), parentSessionKey: session.sourceSessionKey }, 30_000);
      const transcriptPath = sessionFileFromCreateResult(created);
      if (typeof transcriptPath !== "string" || !transcriptPath) throw new Error("sessions.create did not return entry.sessionFile");
      copyHistoryMessagesToTranscript(transcriptPath, sourceMessages);
      const sessionId = sessionIdFromCreateResult(created, desktopSessionKey);
      persistImportedChatMessages(context, { sessionKey: desktopSessionKey, sessionId, transcriptPath, label, messages: sourceMessages });
      const timestamp = nowIso();
      compatState.sessions.push({ id: stableCompatId("session", desktopSessionKey), key: desktopSessionKey, sessionKey: desktopSessionKey, label, agentId: parsed.agentId, status: "idle", hidden: false, spaceId: targetSpaceId, projectId: null, topicId: null, createdAt: timestamp, updatedAt: timestamp, importedFrom: { kind: "discord", sourceSessionKey: session.sourceSessionKey } });
      const chat = ensureImportedFlatChat("discord", { sourceSessionKey: session.sourceSessionKey, targetSpaceId, label, sessionKey: desktopSessionKey, agentId: parsed.agentId, timestamp });
      imported.push({ sourceSessionKey: session.sourceSessionKey, desktopSessionKey, chatId: chat.id, projectId: null, topicId: null, spaceId: targetSpaceId, name: label, copiedMessages: sourceMessages.filter((message) => message.role !== "system").length, transcriptPath });
    } catch (error) {
      failed.push({ sourceSessionKey: session.sourceSessionKey, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!dryRun) normalizeImportedPlatformState("discord");
  if (!dryRun) saveCompatState(context);
  return { imported, skipped, failed, summary: { imported: imported.length, skipped: skipped.length, failed: failed.length } };
}

function stringField(record: CompatRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function timestampField(record: CompatRecord, keys: string[]) {
  return stringField(record, keys) ?? nowIso();
}

function optionalTimestampField(record: CompatRecord, keys: string[]) {
  return stringField(record, keys);
}

function timeMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function messageTimestampMs(message: CompatRecord) {
  const value = message.timestamp ?? message.createdAt ?? message.created_at ?? message.updatedAt ?? message.updated_at;
  if (typeof value === "number" && Number.isFinite(value)) return value > 0 && value < 1_000_000_000_000 ? value * 1_000 : value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 0 && numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function newestTimestamp(...values: unknown[]) {
  const newest = values.reduce<number>((max, value) => Math.max(max, timeMs(value)), 0);
  return newest > 0 ? new Date(newest).toISOString() : nowIso();
}

function chatActivityMs(chat: CompatRecord) {
  return Math.max(timeMs(chat.updatedAt), timeMs(chat.lastActiveAt), timeMs(chat.lastMessageAt), timeMs(chat.createdAt));
}

function isSubagentSessionKeyValue(value: unknown) {
  return typeof value === "string" && /^agent:[^\s"',}\]]+(?::[^\s"',}\]]+)*:subagent:[^\s"',}\]]+$/.test(value.trim());
}

function isSubagentRecord(record: CompatRecord) {
  return isSubagentSessionKeyValue(record.sessionKey ?? record.key) || record.isSubagent === true || typeof record.parentSessionKey === "string";
}

function sessionForChat(chat: CompatRecord) {
  const sessionKey = typeof chat.sessionKey === "string" && chat.sessionKey.trim() ? chat.sessionKey.trim() : null;
  if (!sessionKey) return null;
  return compatState.sessions.find((session) => session.sessionKey === sessionKey || session.key === sessionKey) ?? null;
}

function sessionActivityMs(session: CompatRecord | null) {
  if (!session) return 0;
  return Math.max(timeMs(session.updatedAt), timeMs(session.lastActiveAt), timeMs(session.lastMessageAt), timeMs(session.createdAt));
}

function chatForResponse(chat: CompatRecord) {
  if (!chat.syncedFromGateway) return chat;
  const session = sessionForChat(chat);
  const activityMs = sessionActivityMs(session);
  if (activityMs <= 0) return chat;
  const activityAt = new Date(activityMs).toISOString();
  const createdAt = typeof session?.createdAt === "string" && session.createdAt.trim() ? session.createdAt : chat.createdAt;
  return { ...chat, createdAt, updatedAt: activityAt, lastActiveAt: activityAt, lastMessageAt: activityAt };
}

function isProjectScopedChat(chat: CompatRecord) {
  return typeof chat.projectId === "string" && chat.projectId.trim()
    || typeof chat.topicId === "string" && chat.topicId.trim();
}

function sortedChatsForResponse(spaceId?: unknown, archived?: boolean) {
  return listBySpace(compatState.chats, spaceId)
    .filter((chat) => !isSubagentRecord(chat))
    .filter((chat) => !isProjectScopedChat(chat))
    .filter((chat) => typeof archived === "boolean" ? Boolean(chat.archived) === archived : !chat.archived)
    .map(chatForResponse)
    .sort((a, b) => {
      const activityDiff = chatActivityMs(b) - chatActivityMs(a);
      if (activityDiff !== 0) return activityDiff;
      const createdDiff = timeMs(b.createdAt) - timeMs(a.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return String(a.id ?? a.sessionKey ?? "").localeCompare(String(b.id ?? b.sessionKey ?? ""));
    });
}

function latestProjectedMessageActivity(context: AppContext, sessionKey: string) {
  const row = context.db.prepare(`
    SELECT data_json, updated_at_ms
    FROM v2_messages
    WHERE session_key = ?
    ORDER BY updated_at_ms DESC, openclaw_seq DESC
    LIMIT 1
  `).get(sessionKey) as { data_json: string; updated_at_ms: number } | undefined;
  if (!row || !Number.isFinite(Number(row.updated_at_ms))) return null;
  const data = fromJson(row.data_json) as CompatRecord;
  const text = stringField(data, ["text", "content"]);
  const timestampMs = messageTimestampMs(data) || Number(row.updated_at_ms);
  return {
    timestamp: new Date(timestampMs).toISOString(),
    text,
  };
}

function applyProjectedChatActivity(context: AppContext) {
  let changed = false;
  for (const chat of compatState.chats) {
    if (isGatewayOnlySyncedChat(chat)) continue;
    const sessionKey = typeof chat.sessionKey === "string" && chat.sessionKey.trim() ? chat.sessionKey.trim() : null;
    if (!sessionKey) continue;
    const projected = latestProjectedMessageActivity(context, sessionKey);
    if (!projected) continue;
    const timestamp = projected.timestamp;
    if (!timestamp) continue;
    const next = {
      ...chat,
      updatedAt: timestamp,
      lastActiveAt: timestamp,
      ...(projected ? { lastMessageAt: timestamp } : { lastMessageAt: undefined }),
      ...(projected?.text ? { lastMessageText: projected.text } : {}),
    };
    if (JSON.stringify(next) !== JSON.stringify(chat)) {
      Object.assign(chat, next);
      changed = true;
    }
  }
  if (changed) saveCompatState(context);
}

function isGatewayOnlySyncedChat(chat: CompatRecord) {
  const sessionKey = typeof chat.sessionKey === "string" && chat.sessionKey.trim() ? chat.sessionKey.trim() : null;
  return Boolean(sessionKey && chat.id === stableCompatId("chat", sessionKey));
}

function isGatewayOnlySyncedSession(session: CompatRecord) {
  const sessionKey = typeof session.sessionKey === "string" && session.sessionKey.trim()
    ? session.sessionKey.trim()
    : (typeof session.key === "string" && session.key.trim() ? session.key.trim() : null);
  return Boolean(sessionKey && !isDesktopSessionKey(sessionKey) && session.id === stableCompatId("session", sessionKey));
}

function activeTopicById(topicId: unknown) {
  return typeof topicId === "string" && topicId.trim()
    ? compatState.topics.find((topic) => topic.id === topicId && notDeleted(topic)) ?? null
    : null;
}

function activeProjectId(projectId: unknown) {
  return typeof projectId === "string" && projectId.trim() && projectSpaceId(projectId) ? projectId : null;
}

function touchCompatChatActivity(context: AppContext, input: { sessionKey: string; at?: string; lastMessageText?: string | null }) {
  loadCompatState(context);
  const sessionKey = input.sessionKey.trim();
  if (!sessionKey) return;
  const timestamp = input.at && timeMs(input.at) > 0 ? new Date(timeMs(input.at)).toISOString() : nowIso();

  let chat = compatState.chats.find((record) => record.sessionKey === sessionKey);
  if (!chat) {
    let session = compatState.sessions.find((record) => record.sessionKey === sessionKey || record.key === sessionKey);
    if (!session) {
      session = {
        id: stableCompatId("session", sessionKey),
        key: sessionKey,
        sessionKey,
        agentId: "main",
        label: "New Chat",
        createdAt: timestamp,
      };
      compatState.sessions.push(session);
    }
    session.updatedAt = newestTimestamp(timestamp, session.updatedAt, session.lastActiveAt, session.lastMessageAt);
    session.lastActiveAt = session.updatedAt;
    session.lastMessageAt = session.updatedAt;
    saveCompatState(context);
    return;
  }

  const nextTimestamp = newestTimestamp(timestamp, chat.updatedAt, chat.lastActiveAt, chat.lastMessageAt);
  chat.updatedAt = nextTimestamp;
  chat.lastActiveAt = nextTimestamp;
  chat.lastMessageAt = nextTimestamp;
  if (typeof input.lastMessageText === "string") chat.lastMessageText = input.lastMessageText;

  let session = compatState.sessions.find((record) => record.sessionKey === sessionKey || record.key === sessionKey);
  if (!session) {
    session = {
      id: stableCompatId("session", sessionKey),
      key: sessionKey,
      sessionKey,
      agentId: chat.agentId || "main",
      label: chat.name || "New Chat",
      createdAt: chat.createdAt || timestamp,
    };
    compatState.sessions.push(session);
  }
  session.key = session.key || sessionKey;
  session.sessionKey = sessionKey;
  session.updatedAt = newestTimestamp(nextTimestamp, session.updatedAt, session.lastActiveAt, session.lastMessageAt);
  session.lastActiveAt = session.updatedAt;
  session.lastMessageAt = session.updatedAt;

  saveCompatState(context);
}

function labelFromGatewaySession(record: CompatRecord, sessionKey: string) {
  const label = stringField(record, ["label", "title", "name", "derivedTitle"])
    ?? stringField(record.lastMessage && typeof record.lastMessage === "object" ? record.lastMessage as CompatRecord : {}, ["text", "content"])
    ?? "New Chat";
  const suffix = ` · ${shortSessionId(sessionKey)}`;
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) || "New Chat" : label;
}

function gatewaySessionRows(payload: unknown): CompatRecord[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const rows = (payload as CompatRecord).sessions;
  return Array.isArray(rows) ? rows.filter((row): row is CompatRecord => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

function isDesktopSessionKey(sessionKey: string) {
  return /^agent:[^:]+:desktop(?::|$)/.test(sessionKey);
}

let syncGatewaySessionsCache: { promise: Promise<void>; expiresAtMs: number } | null = null;
const SYNC_GATEWAY_CACHE_TTL_MS = 5_000;
let lastFullSyncAtMs = 0;
const BOOTSTRAP_FRESH_MS = 30_000;
const BOOTSTRAP_STALE_SERVE_MS = 5 * 60 * 1000; // serve stale up to 5min, always sync in background

/** Clear the syncGatewaySessions cache. Exported for test isolation. */
export function clearSyncGatewaySessionsCache() { syncGatewaySessionsCache = null; }

/** Trigger a background sync on the next bootstrap/chats request.
 *  Does NOT reset lastFullSyncAtMs to 0 — that would force a blocking sync
 *  even though compatState already has the mutation applied in-memory.
 *  Instead, we set the timestamp to an old-but-nonzero value so the next
 *  request serves immediately from compatState and syncs in background. */
export function invalidateBootstrapCache() {
  // Set to 1ms — nonzero (so we serve from compatState) but old enough
  // that the next request triggers a background sync.
  if (lastFullSyncAtMs > 0) lastFullSyncAtMs = 1;
}

/** Clear bootstrap cache for test isolation. */
export function clearBootstrapCacheForTests() { lastFullSyncAtMs = 0; }

async function syncGatewaySessions(context: AppContext) {
  // Don't cache if Gateway is disconnected — no-op results should not
  // suppress a real sync when Gateway reconnects moments later.
  if (!context.gateway.status().connected) {
    return syncGatewaySessionsUncached(context);
  }
  // Deduplicate concurrent calls: reuse the same promise within a short TTL
  // window. Multiple routes (/api/chats, /api/bootstrap) call this on every
  // request, each triggering a 600-2500ms Gateway sessions.list call.
  const now = Date.now();
  if (syncGatewaySessionsCache && now < syncGatewaySessionsCache.expiresAtMs) {
    return syncGatewaySessionsCache.promise;
  }
  const promise = syncGatewaySessionsUncached(context);
  const cached = { promise, expiresAtMs: now + SYNC_GATEWAY_CACHE_TTL_MS };
  syncGatewaySessionsCache = cached;
  // Only clear on error if this is still the active cache entry
  promise.catch(() => { if (syncGatewaySessionsCache === cached) syncGatewaySessionsCache = null; });
  return promise;
}

async function syncGatewaySessionsUncached(context: AppContext) {
  try {
    // Startup/bootstrap should never block on establishing Gateway auth. If the
    // socket is not already connected, return cached/local chats immediately;
    // connect_status/connect_bootstrap can kick the Gateway connect in background.
    if (!context.gateway.status().connected) return;
    const payload = await context.gateway.request("sessions.list", { limit: 500, includeDerivedTitles: true, includeLastMessage: true }, 10_000);
    const rows = gatewaySessionRows(payload);
    if (rows.length === 0) return;
    let changed = false;
    const syncedSessionKeys = new Set<string>();
    const projectScopedGatewayKeys = new Set<string>();
    const fallbackSpaceId = ensureDefaultFallbackSpace();
    for (const row of rows) {
      const sessionKey = stringField(row, ["key", "sessionKey"]);
      if (!sessionKey) continue;
      const isDesktopSession = isDesktopSessionKey(sessionKey);
      if (!isDesktopSession && (isSubagentRecord(row) || isSubagentSessionKeyValue(sessionKey))) {
        const existingSubagentChatIndex = compatState.chats.findIndex((chat) => chat.sessionKey === sessionKey);
        if (existingSubagentChatIndex >= 0) {
          compatState.chats[existingSubagentChatIndex] = { ...compatState.chats[existingSubagentChatIndex], deleted: true, archived: true };
          changed = true;
        }
        continue;
      }
      if (!isDesktopSession) continue;
      syncedSessionKeys.add(sessionKey);
      const name = labelFromGatewaySession(row, sessionKey);
      const agentId = stringField(row, ["agentId", "agent_id"]) ?? "main";
      const rowCreatedAt = optionalTimestampField(row, ["createdAt", "created_at"]);
      const rowActivityAt = optionalTimestampField(row, ["updatedAt", "updated_at", "lastActiveAt", "lastMessageAt"]);
      const createdAt = rowCreatedAt ?? rowActivityAt ?? nowIso();
      const activityAt = newestTimestamp(rowActivityAt, createdAt);
      const rowProjectId = row.projectId ?? null;
      const rowTopicId = row.topicId ?? null;
      const existingSessionForKey = compatState.sessions.find((session) => (session.sessionKey === sessionKey || session.key === sessionKey) && notDeleted(session));
      const existingTopic = activeTopicById(existingSessionForKey?.topicId);
      const rowTopic = activeTopicById(rowTopicId);
      const sessionTopicId = existingTopic?.id ?? rowTopic?.id ?? null;
      const sessionProjectId = activeProjectId(existingSessionForKey?.projectId)
        ?? (existingTopic ? activeProjectId(existingTopic.projectId) : null)
        ?? activeProjectId(rowProjectId)
        ?? (rowTopic ? activeProjectId(rowTopic.projectId) : null);
      const isProjectScopedSession = Boolean(sessionProjectId || sessionTopicId);
      const rowSpaceId = projectSpaceId(sessionProjectId) ?? projectSpaceId(rowProjectId) ?? existingSessionForKey?.spaceId ?? fallbackSpaceId;
      if (isProjectScopedSession) projectScopedGatewayKeys.add(sessionKey);

      const chatIndex = compatState.chats.findIndex((chat) => chat.sessionKey === sessionKey);
      if (isProjectScopedSession && chatIndex >= 0 && isGatewayOnlySyncedChat(compatState.chats[chatIndex])) {
        compatState.chats[chatIndex] = { ...compatState.chats[chatIndex], deleted: true, archived: true, updatedAt: activityAt };
        changed = true;
      } else if (!isProjectScopedSession && chatIndex < 0) {
        compatState.chats.push({
          id: stableCompatId("chat", sessionKey),
          name,
          sessionKey,
          spaceId: rowSpaceId,
          agentId,
          archived: false,
          pinned: false,
          syncedFromGateway: true,
          createdAt,
          updatedAt: activityAt,
          lastActiveAt: activityAt,
          lastMessageAt: activityAt,
        });
        changed = true;
      } else if (!isProjectScopedSession && chatIndex >= 0) {
        const existing = compatState.chats[chatIndex];
        const existingCreatedAt = existing.createdAt || createdAt;
        const existingSession = compatState.sessions.find((session) => session.sessionKey === sessionKey || session.key === sessionKey);
        const sessionActivityAt = existingSession
          ? newestTimestamp(existingSession.updatedAt, existingSession.lastActiveAt, existingSession.lastMessageAt, existingSession.createdAt)
          : null;
        const existingActivityAt = existing.syncedFromGateway
          ? (rowActivityAt
            ? newestTimestamp(rowActivityAt, sessionActivityAt, existingCreatedAt)
            : (sessionActivityAt ?? newestTimestamp(existing.updatedAt, existing.lastActiveAt, existing.lastMessageAt, existingCreatedAt)))
          : newestTimestamp(rowActivityAt, rowCreatedAt, existing.updatedAt, existing.lastActiveAt, existing.lastMessageAt, existingCreatedAt);
        const next = {
          ...existing,
          name: existing.name || name,
          spaceId: existing.syncedFromGateway ? rowSpaceId : existing.spaceId,
          agentId: existing.agentId || agentId,
          createdAt: existingCreatedAt,
          updatedAt: existingActivityAt,
          lastActiveAt: existingActivityAt,
          lastMessageAt: existingActivityAt,
        };
        if (JSON.stringify(next) !== JSON.stringify(existing)) {
          compatState.chats[chatIndex] = next;
          changed = true;
        }
      }

      const sessionIndex = compatState.sessions.findIndex((session) => session.sessionKey === sessionKey || session.key === sessionKey);
      if (sessionIndex < 0) {
        compatState.sessions.push({
          id: stableCompatId("session", sessionKey),
          key: sessionKey,
          sessionKey,
          projectId: sessionProjectId,
          topicId: sessionTopicId,
          spaceId: rowSpaceId,
          agentId,
          label: name,
          createdAt,
          updatedAt: activityAt,
          lastActiveAt: activityAt,
          lastMessageAt: activityAt,
        });
        changed = true;
      } else {
        const existing = compatState.sessions[sessionIndex];
        const existingCreatedAt = existing.createdAt || createdAt;
        const existingActivityAt = newestTimestamp(rowActivityAt, rowCreatedAt, existing.updatedAt, existing.lastActiveAt, existing.lastMessageAt, existingCreatedAt);
        const next = {
          ...existing,
          key: existing.key || sessionKey,
          sessionKey,
          projectId: existing.projectId ?? rowProjectId,
          topicId: existing.topicId ?? rowTopicId,
          spaceId: projectSpaceId(existing.projectId ?? rowProjectId) ?? ((existing.projectId ?? rowProjectId) ? existing.spaceId ?? rowSpaceId : rowSpaceId),
          agentId: existing.agentId || agentId,
          label: existing.label || name,
          createdAt: existingCreatedAt,
          updatedAt: existingActivityAt,
          lastActiveAt: existingActivityAt,
          lastMessageAt: existingActivityAt,
        };
        if (JSON.stringify(next) !== JSON.stringify(existing)) {
          compatState.sessions[sessionIndex] = next;
          changed = true;
        }
      }
    }
    const beforeCleanup = compatState.chats.length;
    compatState.chats = compatState.chats.filter((chat) => {
      if (!isGatewayOnlySyncedChat(chat)) return true;
      const sessionKey = typeof chat.sessionKey === "string" ? chat.sessionKey : "";
      return syncedSessionKeys.has(sessionKey) && !projectScopedGatewayKeys.has(sessionKey);
    });
    if (compatState.chats.length !== beforeCleanup) changed = true;
    const beforeSessionCleanup = compatState.sessions.length;
    compatState.sessions = compatState.sessions.filter((session) => {
      if (!isGatewayOnlySyncedSession(session)) return true;
      const sessionKey = typeof session.sessionKey === "string" && session.sessionKey.trim()
        ? session.sessionKey.trim()
        : (typeof session.key === "string" ? session.key.trim() : "");
      return syncedSessionKeys.has(sessionKey);
    });
    if (compatState.sessions.length !== beforeSessionCleanup) changed = true;
    if (changed) saveCompatState(context);
  } catch {
    // Gateway session sync is best-effort; local compat data must still render offline.
  }
}

function notDeleted(record: CompatRecord) {
  return !record.deleted;
}

function visibleSpace(record: CompatRecord) {
  return notDeleted(record) && !record.archived;
}

function listBySpace(records: CompatRecord[], spaceId?: unknown) {
  const filterSpaceId = typeof spaceId === "string" && spaceId.trim() ? spaceId : null;
  return records.filter((record) => notDeleted(record) && (!filterSpaceId || record.spaceId === filterSpaceId));
}

function projectSpaceId(projectId?: unknown) {
  if (typeof projectId !== "string" || !projectId.trim()) return null;
  const project = compatState.projects.find((record) => record.id === projectId && notDeleted(record));
  return typeof project?.spaceId === "string" && project.spaceId.trim() ? project.spaceId : null;
}

function topicSpaceId(topic: CompatRecord) {
  if (typeof topic.spaceId === "string" && topic.spaceId.trim()) return topic.spaceId;
  return projectSpaceId(topic.projectId) ?? DEFAULT_SPACE_ID;
}

function sessionSpaceId(session: CompatRecord) {
  if (typeof session.spaceId === "string" && session.spaceId.trim()) return session.spaceId;
  const fromProject = projectSpaceId(session.projectId);
  if (fromProject) return fromProject;
  return DEFAULT_SPACE_ID;
}

function sessionsForSpace(spaceId?: unknown) {
  const filterSpaceId = typeof spaceId === "string" && spaceId.trim() ? spaceId : null;
  return compatState.sessions.filter((session) => notDeleted(session) && (!filterSpaceId || sessionSpaceId(session) === filterSpaceId));
}

function wantsGlobalList(query: CompatRecord) {
  return query.all === "true" || query.all === true || query.global === "true" || query.global === true;
}

function listSpaceId(query: CompatRecord) {
  if (wantsGlobalList(query)) return undefined;
  if (query.projectId || query.topicId) return undefined;
  return typeof query.spaceId === "string" && query.spaceId.trim() ? query.spaceId : activeSpaceId();
}

function sessionWriteSpaceId(body: CompatRecord) {
  if (typeof body.spaceId === "string" && body.spaceId.trim()) return body.spaceId;
  const fromProject = projectSpaceId(body.projectId);
  if (fromProject) return fromProject;
  return activeSpaceId();
}

function patchById(records: CompatRecord[], idValue: string, patch: CompatRecord) {
  const index = records.findIndex((record) => record.id === idValue);
  if (index < 0) return null;
  records[index] = { ...records[index], ...patch, updatedAt: nowIso() };
  return records[index];
}

function archiveChatsForSpace(spaceId: string) {
  const timestamp = nowIso();
  compatState.chats = compatState.chats.map((chat) => {
    if (chat.spaceId !== spaceId) return chat;
    if (chat.archived) return { ...chat, archivedBySpace: chat.archivedBySpace ?? false };
    return { ...chat, archived: true, archivedBySpace: true, updatedAt: timestamp };
  });
}

function restoreChatsForSpace(spaceId: string) {
  const timestamp = nowIso();
  compatState.chats = compatState.chats.map((chat) => {
    if (chat.spaceId !== spaceId || !chat.archived) return chat;
    if (chat.archivedBySpace === false) return chat;
    const { archivedBySpace: _archivedBySpace, ...rest } = chat;
    return { ...rest, archived: false, updatedAt: timestamp };
  });
}

async function deleteCompatChat(context: AppContext, chatId: string) {
  const chat = compatState.chats.find((record) => record.id === chatId);
  const sessionKey = typeof chat?.sessionKey === "string" && chat.sessionKey.trim() ? chat.sessionKey.trim() : null;
  const importedSession = sessionKey
    ? compatState.sessions.find((session) => (session.sessionKey === sessionKey || session.key === sessionKey) && session.importedFrom?.kind)
    : null;
  const importedLocalOnly = Boolean(chat?.importedFrom?.kind || importedSession?.importedFrom?.kind);

  compatState.chats = compatState.chats.filter((record) => record.id !== chatId);
  if (sessionKey) {
    compatState.sessions = compatState.sessions.filter((session) => session.sessionKey !== sessionKey && session.key !== sessionKey);
    if (!importedLocalOnly) {
      await Promise.allSettled([
        context.gateway.request("sessions.abort", { sessionKey }, 2_000),
        context.gateway.request("sessions.delete", { key: sessionKey, deleteTranscript: true }, 2_000),
      ]);
    }
    context.db.prepare("DELETE FROM v2_messages WHERE session_key = ?").run(sessionKey);
    context.db.prepare("DELETE FROM v2_runs WHERE session_key = ?").run(sessionKey);
    context.db.prepare("DELETE FROM v2_tool_calls WHERE session_key = ?").run(sessionKey);
    context.db.prepare("DELETE FROM v2_sessions WHERE session_key = ?").run(sessionKey);
    context.db.prepare("DELETE FROM v2_gateway_offsets WHERE session_key = ?").run(sessionKey);
    context.db.prepare("DELETE FROM v2_projection_events WHERE session_key = ?").run(sessionKey);
  }
  saveCompatState(context);
  return { ok: true, chatId, sessionKey, localOnly: importedLocalOnly };
}

async function deleteCompatSpace(context: AppContext, spaceId: string) {
  if (spaceId === DEFAULT_SPACE_ID) {
    const existing = compatState.spaces.find((space) => space.id === DEFAULT_SPACE_ID) ?? {};
    const normalized = normalizeDefaultSpace(existing);
    const index = compatState.spaces.findIndex((space) => space.id === DEFAULT_SPACE_ID);
    if (index >= 0) compatState.spaces[index] = normalized;
    else compatState.spaces.unshift(normalized);
    saveCompatState(context);
    return { ok: true, spaceId, activeSpaceId: activeSpaceId(), deletedChatIds: [] };
  }
  const deletedChatIds = compatState.chats
    .filter((chat) => chat.spaceId === spaceId)
    .map((chat) => typeof chat.id === "string" ? chat.id : null)
    .filter((chatId): chatId is string => Boolean(chatId));
  const deletedProjectIds = compatState.projects
    .filter((project) => project.spaceId === spaceId)
    .map((project) => typeof project.id === "string" ? project.id : null)
    .filter((projectId): projectId is string => Boolean(projectId));

  for (const chatId of deletedChatIds) {
    await deleteCompatChat(context, chatId);
  }

  compatState.spaces = compatState.spaces.filter((space) => space.id !== spaceId);
  compatState.projects = compatState.projects.map((project) =>
    project.spaceId === spaceId ? { ...project, deleted: true, updatedAt: nowIso() } : project,
  );
  if (deletedProjectIds.length > 0) {
    const deletedProjectIdSet = new Set(deletedProjectIds);
    compatState.topics = compatState.topics.map((topic) =>
      deletedProjectIdSet.has(String(topic.projectId)) ? { ...topic, deleted: true, updatedAt: nowIso() } : topic,
    );
    compatState.sessions = compatState.sessions.filter((session) => !deletedProjectIdSet.has(String(session.projectId)));
  }

  if (compatState.activeSpaceId === spaceId) {
    compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
  }
  saveCompatState(context);
  return { ok: true, spaceId, activeSpaceId: activeSpaceId(), deletedChatIds };
}

function projectById(projectId: string) {
  return compatState.projects.find((project) => project.id === projectId && notDeleted(project)) ?? null;
}

function projectRoot(projectId: string) {
  const project = projectById(projectId);
  const root = project?.workspaceRoot ?? project?.repoRoot ?? project?.path;
  return typeof root === "string" && root.trim() ? root : null;
}

function safeJoin(root: string, rel = "") {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, rel || ".");
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Path escapes workspace root");
  return resolved;
}

function git(repo: string, args: string[]) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, maxBuffer: 64 * 1024 * 1024 }).trim();
}

function tryGit(repo: string, args: string[]) {
  try { return git(repo, args); } catch { return null; }
}

function fileState(status: string) {
  if (status.includes("A")) return "added";
  if (status.includes("D")) return "deleted";
  if (status.includes("R")) return "renamed";
  if (status.includes("C")) return "copied";
  if (status.includes("?")) return "untracked";
  if (status.includes("M")) return "modified";
  return "unknown";
}

function parseGitPorcelain(text: string) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const match = line.match(/^(.{1,2})\s+(.+)$/);
    const status = match?.[1]?.trim() || "modified";
    const rawPath = match?.[2]?.trim() || line.trim();
    const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop()!.trim() : rawPath;
    return { path: filePath, state: fileState(status), status };
  });
}

function parseGitNumstat(text: string) {
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const [additionsRaw, deletionsRaw, filePath] = line.split("\t");
    if (!filePath) continue;
    stats.set(filePath, {
      additions: additionsRaw === "-" ? 0 : Number(additionsRaw || 0),
      deletions: deletionsRaw === "-" ? 0 : Number(deletionsRaw || 0),
    });
  }
  return stats;
}

function gitChangedFiles(repo: string) {
  const files = parseGitPorcelain(tryGit(repo, ["status", "--porcelain", "-u"]) ?? "");
  const stats = parseGitNumstat([
    tryGit(repo, ["diff", "--numstat"]),
    tryGit(repo, ["diff", "--cached", "--numstat"]),
  ].filter(Boolean).join("\n"));
  return files.map((file) => ({ ...file, ...(stats.get(file.path) ?? { additions: 0, deletions: 0 }) }));
}

function gitCommitStats(repo: string, hash: string) {
  const raw = tryGit(repo, ["show", "--first-parent", "--numstat", "--format=", hash]) ?? "";
  return raw.split(/\r?\n/).filter(Boolean).reduce((acc, line) => {
    const [additionsRaw, deletionsRaw] = line.split("\t");
    acc.additions += additionsRaw === "-" ? 0 : Number(additionsRaw || 0);
    acc.deletions += deletionsRaw === "-" ? 0 : Number(deletionsRaw || 0);
    return acc;
  }, { additions: 0, deletions: 0 });
}

function gitRecentCommits(repo: string, ref = "HEAD") {
  const raw = tryGit(repo, ["log", "-10", "--pretty=format:%H%x1f%s%x1f%cr", ref]);
  if (!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash = "", message = "", date = ""] = line.split("\x1f");
    return { hash, shortHash: hash.slice(0, 7), message, date, ...gitCommitStats(repo, hash) };
  });
}

function gitAheadBehind(repo: string) {
  const raw = tryGit(repo, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
  const [ahead = "0", behind = "0"] = (raw ?? "0 0").split(/\s+/);
  return { ahead: Number(ahead || 0), behind: Number(behind || 0) };
}

function gitStatus(repo: string, projectId: string | null = null) {
  const repoRoot = tryGit(repo, ["rev-parse", "--show-toplevel"]);
  if (!repoRoot) {
    return {
      projectId,
      repoRoot: repo,
      hasGit: false,
      mode: "local",
      source: "local-fs",
      branch: null,
      currentBranch: null,
      upstream: null,
      remoteUrl: null,
      ahead: 0,
      behind: 0,
      clean: true,
      dirty: false,
      changedFiles: [],
      files: [],
      recentCommits: [],
      summary: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0 },
      error: "Not a git repository",
    };
  }
  const branch = tryGit(repo, ["branch", "--show-current"]) || tryGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const upstream = tryGit(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const remoteName = upstream?.split("/")[0] || "origin";
  const remoteUrl = tryGit(repo, ["remote", "get-url", remoteName]);
  if (remoteUrl) tryGit(repo, ["fetch", "--prune", remoteName]);
  const files = gitChangedFiles(repo);
  const summary = files.reduce((acc, file) => {
    acc.totalAdditions += file.additions ?? 0;
    acc.totalDeletions += file.deletions ?? 0;
    return acc;
  }, { totalFiles: files.length, totalAdditions: 0, totalDeletions: 0 });
  return {
    projectId,
    repoRoot,
    hasGit: true,
    mode: "local",
    source: "local-fs",
    branch,
    currentBranch: branch,
    upstream,
    remoteUrl,
    ...gitAheadBehind(repo),
    clean: files.length === 0,
    dirty: files.length > 0,
    changedFiles: files,
    files,
    recentCommits: gitRecentCommits(repo, upstream || "HEAD"),
    summary,
  };
}

function gitBranches(repo: string) {
  const local = (tryGit(repo, ["branch", "--format", "%(refname:short)"]) ?? "").split(/\r?\n/).filter(Boolean);
  const remote = (tryGit(repo, ["branch", "-r", "--format", "%(refname:short)"]) ?? "").split(/\r?\n/).filter(Boolean);
  const current = tryGit(repo, ["branch", "--show-current"]);
  return { local, remote, current, branches: local };
}

function gitDiff(repo: string, filePath: string) {
  const repoRoot = tryGit(repo, ["rev-parse", "--show-toplevel"]);
  const changed = gitChangedFiles(repo);
  const state = changed.find((file) => file.path === filePath)?.state ?? "modified";
  const patch = [
    tryGit(repo, ["diff", "--cached", "--", filePath]),
    tryGit(repo, ["diff", "--", filePath]),
  ].filter(Boolean).join("\n") || null;
  const stats = parseGitNumstat([
    tryGit(repo, ["diff", "--numstat", "--", filePath]),
    tryGit(repo, ["diff", "--cached", "--numstat", "--", filePath]),
  ].filter(Boolean).join("\n")).get(filePath) ?? { additions: 0, deletions: 0 };
  return {
    mode: "local",
    source: "local-fs",
    repoRoot: repoRoot ?? repo,
    path: filePath,
    state,
    oldContent: null,
    newContent: null,
    patch,
    ...stats,
    checkedAt: new Date().toISOString(),
    ...(patch ? {} : { error: state === "untracked" ? "Untracked file has no git diff until it is staged" : "No diff available for this file" }),
  };
}

function gitCommitDetails(repo: string, hash: string) {
  if (!repo || !hash) return { diff: "" };
  const diff = tryGit(repo, ["show", "--first-parent", "--find-renames", "--find-copies", "--patch", "--format=medium", hash]) ?? "";
  return { diff };
}

function workspaceEntry(root: string, full: string, stat = fs.statSync(full)) {
  return { name: path.basename(full), path: path.relative(root, full).replace(/\\/g, "/"), type: stat.isDirectory() ? "directory" : "file", size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

function workspaceCapabilities() {
  return { capabilities: { canTree: true, canStat: true, canRead: true, canWrite: true, canDownloadFile: true, canCreateDir: true, canMoveEntry: true, canDeleteEntry: true } };
}

function workspaceTree(root: string, rel: string) {
  const dir = safeJoin(root, rel);
  const entries = fs.readdirSync(dir, { withFileTypes: true }).map((entry) => workspaceEntry(root, path.join(dir, entry.name)));
  return { entries };
}

function workspaceStat(root: string, rel: string) {
  return { entry: workspaceEntry(root, safeJoin(root, rel)) };
}

function workspaceReadFile(root: string, rel: string) {
  const file = safeJoin(root, rel);
  const content = fs.readFileSync(file, "utf8");
  return { path: rel, content, encoding: "utf-8", file: { path: rel, content, encoding: "utf-8" } };
}

function workspaceWriteFile(root: string, body: CompatRecord) {
  const rel = String(body.path ?? "");
  const file = safeJoin(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(body.content ?? ""), "utf8");
  return { ok: true, path: rel };
}

function workspaceDeleteFile(root: string, rel: string) {
  fs.unlinkSync(safeJoin(root, rel));
  return { ok: true, path: rel };
}

function workspaceMkdir(root: string, body: CompatRecord) {
  const rel = String(body.path ?? "");
  fs.mkdirSync(safeJoin(root, rel), { recursive: true });
  return { ok: true, path: rel };
}

function workspaceMove(root: string, body: CompatRecord) {
  const fromPath = String(body.fromPath ?? body.oldPath ?? body.source ?? "");
  const toPath = String(body.toPath ?? body.newPath ?? body.destination ?? "");
  fs.renameSync(safeJoin(root, fromPath), safeJoin(root, toPath));
  return { ok: true, fromPath, toPath };
}

function openclawConfigPath() {
  return path.join(os.homedir(), ".openclaw", "openclaw.json");
}

function readOCPlatformConfig(): CompatRecord {
  try { return JSON.parse(fs.readFileSync(openclawConfigPath(), "utf8")); } catch { return {}; }
}

function writeOCPlatformConfig(cfg: CompatRecord) {
  const configPath = openclawConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");
}

const voiceDefaultModels: Record<string, string> = {
  openai: "gpt-4o-transcribe",
  groq: "whisper-large-v3-turbo",
  deepgram: "nova-3",
  google: "gemini-3-flash-preview",
  mistral: "voxtral-mini-latest",
};

const voiceProviderEnvVars: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  google: "GEMINI_API_KEY",
  mistral: "MISTRAL_API_KEY",
};

const voiceOptions = [
  { provider: "auto", model: "", label: "Auto - best available" },
  { provider: "openai", model: "gpt-4o-transcribe", label: "OpenAI - gpt-4o-transcribe" },
  { provider: "openai", model: "gpt-4o-mini-transcribe", label: "OpenAI - gpt-4o-mini-transcribe" },
  { provider: "openai", model: "whisper-1", label: "OpenAI - whisper-1" },
  { provider: "groq", model: "whisper-large-v3-turbo", label: "Groq - whisper-large-v3-turbo" },
  { provider: "groq", model: "whisper-large-v3", label: "Groq - whisper-large-v3" },
  { provider: "deepgram", model: "nova-3", label: "Deepgram - nova-3" },
  { provider: "deepgram", model: "nova-2", label: "Deepgram - nova-2" },
  { provider: "google", model: "gemini-3-flash-preview", label: "Google - gemini-3-flash-preview" },
  { provider: "google", model: "gemini-2.5-flash", label: "Google - gemini-2.5-flash" },
  { provider: "mistral", model: "voxtral-mini-latest", label: "Mistral - voxtral-mini-latest" },
  { provider: "mistral", model: "voxtral-small-latest", label: "Mistral - voxtral-small-latest" },
];

function normalizeVoiceProvider(value: unknown) {
  const provider = String(value || "auto").trim().toLowerCase();
  return provider in voiceDefaultModels ? provider : "auto";
}

function voiceSettingsFromConfig(cfg: CompatRecord) {
  const audio = cfg.tools?.media?.audio && typeof cfg.tools.media.audio === "object" ? cfg.tools.media.audio : {};
  const firstModel = Array.isArray(audio.models) ? audio.models[0] : null;
  const provider = normalizeVoiceProvider(firstModel?.provider);
  return {
    enabled: audio.enabled !== false,
    provider,
    model: provider === "auto" ? "" : String(firstModel?.model || voiceDefaultModels[provider]),
    language: String(audio.language || "").trim(),
    echoTranscript: Boolean(audio.echoTranscript),
  };
}

function voiceApiKeyConfigured(cfg: CompatRecord, provider: string) {
  if (provider === "auto") return Boolean(localVoiceTranscriber());
  const envVar = voiceProviderEnvVars[provider];
  if (!envVar) return false;
  return Boolean(String(process.env[envVar] || cfg.env?.vars?.[envVar] || "").trim());
}

function voiceSettingsPayload() {
  const cfg = readOCPlatformConfig();
  const settings = voiceSettingsFromConfig(cfg);
  return { settings, options: voiceOptions, status: { apiKeyConfigured: voiceApiKeyConfigured(cfg, settings.provider), localTranscriberAvailable: Boolean(localVoiceTranscriber()) } };
}

function localVoiceTranscriber() {
  const python = String(process.env.OPENCLAW_VOICE_TRANSCRIBE_PYTHON || path.join(os.homedir(), ".whisper-venv", "bin", "python"));
  const script = String(process.env.OPENCLAW_VOICE_TRANSCRIBE_SCRIPT || path.join(workspaceRoot(), "whisper", "transcribe.py"));
  return fs.existsSync(python) && fs.existsSync(script) ? { python, script } : null;
}

function audioAttachmentBuffer(input: CompatRecord) {
  const attachment = input.attachment && typeof input.attachment === "object" ? input.attachment as CompatRecord : input;
  const content = String(attachment.content || attachment.data || attachment.base64 || "");
  if (!content) throw new HttpError(400, "Audio attachment is required", "VOICE_ATTACHMENT_REQUIRED");
  const base64 = content.replace(/^data:[^;,]+;base64,/i, "");
  return Buffer.from(base64, String(attachment.encoding || "base64") === "base64" ? "base64" : "utf8");
}

function audioAttachmentExtension(input: CompatRecord) {
  const attachment = input.attachment && typeof input.attachment === "object" ? input.attachment as CompatRecord : input;
  const mimeType = String(attachment.mimeType || attachment.mime_type || attachment.contentType || "audio/webm").split(";")[0]?.toLowerCase();
  if (mimeType === "audio/ogg") return "ogg";
  if (mimeType === "audio/mp4") return "m4a";
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/wav") return "wav";
  return "webm";
}

function transcribeVoice(input: CompatRecord) {
  const local = localVoiceTranscriber();
  if (!local) {
    throw new HttpError(501, "Voice transcription is not configured on this desktop middleware. Configure a voice provider or install the local Whisper transcriber.", "VOICE_TRANSCRIPTION_UNSUPPORTED", { unsupported: true });
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-voice-"));
  const audioFile = path.join(tmpDir, `input.${audioAttachmentExtension(input)}`);
  try {
    fs.writeFileSync(audioFile, audioAttachmentBuffer(input));
    const transcript = execFileSync(local.python, [local.script, audioFile], { encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 }).trim();
    return { ok: true, transcript, provider: "local", model: "faster-whisper-base" };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, error instanceof Error ? error.message : "Voice transcription failed", "VOICE_TRANSCRIPTION_FAILED");
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup failure */ }
  }
}

function writeVoiceSettings(input: CompatRecord) {
  const cfg = readOCPlatformConfig();
  cfg.tools ??= {};
  cfg.tools.media ??= {};
  cfg.tools.media.audio ??= {};
  const provider = normalizeVoiceProvider(input.provider);
  const model = String(input.model || (provider === "auto" ? "" : voiceDefaultModels[provider])).trim();
  const language = String(input.language || "").trim();
  cfg.tools.media.audio.enabled = input.enabled !== false;
  cfg.tools.media.audio.echoTranscript = Boolean(input.echoTranscript);
  if (language) cfg.tools.media.audio.language = language;
  else delete cfg.tools.media.audio.language;
  if (provider === "auto") delete cfg.tools.media.audio.models;
  else cfg.tools.media.audio.models = [{ type: "provider", provider, model: model || voiceDefaultModels[provider] }];
  writeOCPlatformConfig(cfg);
  return voiceSettingsPayload();
}

function providerDetails(providerId: string) {
  const envVar = voiceProviderEnvVars[providerId] ?? `${providerId.toUpperCase()}_API_KEY`;
  const name = providerId.charAt(0).toUpperCase() + providerId.slice(1);
  return {
    provider: {
      id: providerId,
      displayName: name,
      authMethods: ["api-key"],
      submit: {
        payloadShape: {
          values: {
            fields: {
              credentials: [{
                key: "api-key",
                label: `${name} API key`,
                help: `Saved as ${envVar}`,
                authMethod: "api-key",
                inputKind: "secret",
                required: true,
                sensitive: true,
                envVar,
              }],
            },
          },
        },
      },
    },
  };
}

function saveProviderCredentials(input: CompatRecord) {
  const providerId = String(input.providerId || "").trim();
  const envVar = voiceProviderEnvVars[providerId];
  const key = String(input.values?.["api-key"] || input.values?.apiKey || input.values?.key || "").trim();
  if (!providerId || !envVar || !key) return { ok: false, error: { message: "providerId and API key are required" } };
  const cfg = readOCPlatformConfig();
  cfg.env ??= {};
  cfg.env.vars ??= {};
  cfg.env.vars[envVar] = key;
  writeOCPlatformConfig(cfg);
  return { ok: true, providerId, envVar };
}

function workspaceRoot() {
  return process.env.WORKSPACE_ROOT || path.join(os.homedir(), ".openclaw", "workspace");
}

function resolveWorkspaceFile(rawPath: unknown) {
  const root = path.resolve(workspaceRoot());
  const requested = String(rawPath || "").trim();
  if (!requested) throw new Error("path is required");
  const target = path.resolve(root, requested.replace(/^[/\\]+/, ""));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("path must stay inside workspace");
  return { root, target, relativePath: path.relative(root, target).replace(/\\/g, "/") };
}

function readMemoryFile(input: CompatRecord) {
  const { target } = resolveWorkspaceFile(input.path);
  return { content: fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "" };
}

function writeMemoryFile(input: CompatRecord) {
  const { target, relativePath } = resolveWorkspaceFile(input.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, String(input.content ?? ""), "utf8");
  return { ok: true, path: relativePath };
}

function listMemoryDocuments() {
  const root = workspaceRoot();
  const candidates = ["MEMORY.md", "SOUL.md", "USER.md", "IDENTITY.md", "TOOLS.md", "AGENTS.md", "HEARTBEAT.md"];
  const docs: CompatRecord[] = [];
  for (const name of candidates) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const stat = fs.statSync(file);
    docs.push({ name, path: name, type: "file", size: stat.size, updatedAt: stat.mtime.toISOString(), modifiedAt: stat.mtime.toISOString() });
  }
  const memoryDir = path.join(root, "memory");
  if (fs.existsSync(memoryDir)) {
    for (const name of fs.readdirSync(memoryDir).filter((entry) => entry.endsWith(".md")).sort().reverse()) {
      const file = path.join(memoryDir, name);
      const stat = fs.statSync(file);
      docs.push({ name, path: `memory/${name}`, type: "file", size: stat.size, updatedAt: stat.mtime.toISOString(), modifiedAt: stat.mtime.toISOString() });
    }
  }
  return docs;
}

function storeMemoryEntry(input: CompatRecord) {
  const content = String(input.content || "").trim();
  if (!content) return { ok: false, error: { message: "content is required" } };
  const date = new Date().toISOString().slice(0, 10);
  const { target, relativePath } = resolveWorkspaceFile(`memory/${date}.md`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const category = String(input.category || "note").trim();
  fs.appendFileSync(target, `\n\n## ${new Date().toISOString()} — ${category}\n\n${content}\n`, "utf8");
  return { ok: true, path: relativePath };
}

function recallMemoryEntries() {
  const docs = listMemoryDocuments();
  const entries: CompatRecord[] = [];
  for (const doc of docs) {
    const file = path.join(workspaceRoot(), String(doc.path));
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    for (const [index, chunk] of text.split(/\n{2,}/).entries()) {
      const content = chunk.trim();
      if (!content) continue;
      entries.push({ content: content.slice(0, 1200), path: doc.path, line: index + 1, totalScore: 0.5, category: "document", date: String(doc.name).replace(/\.md$/, "") });
      if (entries.length >= 100) return { entries };
    }
  }
  return { entries };
}

function normalizeCronJob(input: CompatRecord, existing?: CompatRecord) {
  const timestamp = nowIso();
  const paused = input.paused !== undefined ? Boolean(input.paused) : input.enabled !== undefined ? !Boolean(input.enabled) : Boolean(existing?.paused ?? false);
  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : input.paused !== undefined ? !paused : Boolean(existing?.enabled ?? true);
  const message = input.message !== undefined ? input.message : existing?.message ?? null;
  const task = input.task !== undefined ? input.task : existing?.task ?? message ?? "";
  return {
    id: existing?.id || input.id || input.jobId || id("cron"),
    jobId: existing?.jobId || input.jobId || input.id || id("cron"),
    name: input.name ?? existing?.name ?? "Scheduled task",
    scheduleType: input.scheduleType ?? existing?.scheduleType ?? "cron",
    schedule: input.schedule ?? existing?.schedule ?? "0 * * * *",
    timezone: input.timezone ?? existing?.timezone ?? "Asia/Kolkata",
    session: input.session ?? existing?.session ?? "isolated",
    parentSessionKey: input.parentSessionKey ?? existing?.parentSessionKey ?? null,
    task,
    message,
    model: input.model ?? existing?.model ?? null,
    enabled,
    paused,
    status: paused || !enabled ? "paused" : "active",
    deleteAfterRun: Boolean(input.deleteAfterRun ?? existing?.deleteAfterRun ?? false),
    deliveryMode: input.deliveryMode ?? existing?.deliveryMode ?? "announce",
    deliveryChannel: input.deliveryChannel ?? existing?.deliveryChannel ?? null,
    deliveryTo: input.deliveryTo ?? existing?.deliveryTo ?? null,
    params: input.params ?? existing?.params ?? null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    lastRun: existing?.lastRun ?? null,
  };
}

function findCronJob(jobId: unknown) {
  const key = String(jobId || "");
  return compatState.cronJobs.find((job) => job.jobId === key || job.id === key) ?? null;
}

async function cronListJobsGateway(context: AppContext) {
  const page = await context.gateway.request<CompatRecord>("cron.list", { includeDisabled: true, limit: 200 }, 30_000);
  const jobs = Array.isArray(page.jobs) ? page.jobs : [];
  const runsPage = await cronRunsPageGateway(context, { scope: "all", limit: 200 }).catch(() => ({ entries: [] as CompatRecord[] }));
  const latestRunByJobId = new Map<string, CompatRecord>();
  for (const run of runsPage.entries || []) {
    const jobId = String(run.jobId || "");
    if (jobId && !latestRunByJobId.has(jobId)) latestRunByJobId.set(jobId, run);
  }
  const compatJobs = jobs.map((job) => gatewayJobToCompat(job, latestRunByJobId.get(String(job.id)) ?? null));
  compatState.cronJobs = compatJobs;
  return { ...page, jobs: compatJobs };
}

async function cronGetJobGateway(context: AppContext, jobId: unknown) {
  const jobs = await cronListJobsGateway(context);
  const key = String(jobId || "");
  return { job: jobs.jobs.find((job: CompatRecord) => job.jobId === key || job.id === key) ?? null };
}

function cronCommandErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("schedule.") || normalized.includes("one-time cron schedule") || normalized.includes("in the past")) return 400;
  return 500;
}

async function cronCreateJobGateway(context: AppContext, input: CompatRecord) {
  const job = await context.gateway.request<CompatRecord>("cron.add", compatJobToGateway(input), 30_000);
  const compat = gatewayJobToCompat(job);
  compatState.cronJobs = [compat, ...compatState.cronJobs.filter((item) => item.jobId !== compat.jobId)];
  emitCronEvent({ type: "cron.job.created", jobId: compat.jobId, job: compat, timestamp: nowIso() });
  return { job: compat, jobId: compat.jobId };
}

async function cronUpdateJobGateway(context: AppContext, input: CompatRecord) {
  const key = String(input.jobId || input.id || "");
  if (!key) return null;
  const existing = (await cronGetJobGateway(context, key)).job;
  if (!existing) return null;
  const patch = compatJobToGateway(input, existing);
  const job = await context.gateway.request<CompatRecord>("cron.update", { jobId: key, patch }, 30_000);
  const compat = gatewayJobToCompat(job, existing.lastRun ?? null);
  compatState.cronJobs = [compat, ...compatState.cronJobs.filter((item) => item.jobId !== compat.jobId)];
  emitCronEvent({ type: "cron.job.updated", jobId: compat.jobId, job: compat, timestamp: nowIso() });
  return { job: compat };
}

async function cronDeleteJobGateway(context: AppContext, input: CompatRecord) {
  const key = String(input.jobId || input.id || "");
  if (!key) return false;
  const result = await context.gateway.request<CompatRecord>("cron.remove", { jobId: key }, 30_000);
  compatState.cronJobs = compatState.cronJobs.filter((job) => job.jobId !== key && job.id !== key);
  emitCronEvent({ type: "cron.job.deleted", jobId: key, timestamp: nowIso() });
  return result.removed !== false;
}

async function cronRunsPageGateway(context: AppContext, input: CompatRecord) {
  const params: CompatRecord = {
    limit: Number(input.limit || 50),
    offset: Number(input.offset || 0),
    sortDir: input.sortDir || "desc",
  };
  if (input.scope) params.scope = input.scope;
  if (input.jobId || input.id) params.jobId = input.jobId || input.id;
  if (!params.scope && !params.jobId) params.scope = "all";
  return context.gateway.request<CompatRecord>("cron.runs", params, 30_000);
}

async function cronListRunsGateway(context: AppContext, input: CompatRecord) {
  const page = await cronRunsPageGateway(context, input);
  const entries = Array.isArray(page.entries) ? page.entries : [];
  const jobsById = new Map(compatState.cronJobs.map((job) => [String(job.jobId), job]));
  const runs = entries.map((run) => gatewayRunToCompat(run, jobsById.get(String(run.jobId))));
  compatState.cronRuns = runs;
  return { ...page, runs, entries };
}

async function cronRecentActivityGateway(context: AppContext, input: CompatRecord) {
  const page = await cronRunsPageGateway(context, { ...input, scope: "all", limit: Number(input.limit || 50) });
  const entries = Array.isArray(page.entries) ? page.entries : [];
  const jobsById = new Map(compatState.cronJobs.map((job) => [String(job.jobId), job]));
  const events = entries.map((run) => cronEventFromRun(run, jobsById.get(String(run.jobId))));
  return { ...page, events, activity: events };
}

async function cronRunJobGateway(context: AppContext, input: CompatRecord) {
  const key = String(input.jobId || input.id || "");
  if (!key) throw new Error("jobId is required");
  const job = findCronJob(key) ?? (await cronGetJobGateway(context, key)).job;
  const startedRun = {
    jobId: key,
    runId: `manual-${Date.now()}`,
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    error: null,
    sessionKey: null,
  };
  emitCronEvent({ type: "cron.run.started", jobId: key, runId: startedRun.runId, name: job?.name, status: "running", timestamp: startedRun.startedAt });
  const result = await context.gateway.request<CompatRecord>("cron.run", { jobId: key, mode: input.mode || "force" }, 30_000);
  setTimeout(async () => {
    try {
      const runs = await cronListRunsGateway(context, { jobId: key, limit: 1 });
      const latest = runs.runs?.[0];
      if (latest) emitCronEvent(cronEventFromRun(latest, job ?? undefined));
    } catch { /* best-effort refresh */ }
  }, 1_500).unref?.();
  return { queued: true, result, run: startedRun };
}

function cronListJobs() {
  return { jobs: [...compatState.cronJobs].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))) };
}

function cronCreateJob(input: CompatRecord) {
  const job = normalizeCronJob(input);
  compatState.cronJobs.push(job);
  return { job, jobId: job.jobId };
}

function cronUpdateJob(input: CompatRecord) {
  const key = input.jobId || input.id;
  const index = compatState.cronJobs.findIndex((job) => job.jobId === key || job.id === key);
  if (index < 0) return null;
  const job = normalizeCronJob(input, compatState.cronJobs[index]);
  compatState.cronJobs[index] = job;
  return { job };
}

function cronDeleteJob(input: CompatRecord) {
  const key = input.jobId || input.id;
  const before = compatState.cronJobs.length;
  compatState.cronJobs = compatState.cronJobs.filter((job) => job.jobId !== key && job.id !== key);
  return before !== compatState.cronJobs.length;
}

function cronListRuns(input: CompatRecord) {
  const key = input.jobId || input.id;
  const runs = key ? compatState.cronRuns.filter((run) => run.jobId === key) : compatState.cronRuns;
  return { runs };
}

function cronRecentActivity(input: CompatRecord) {
  const limit = Number(input.limit || 50);
  const events = compatState.cronRuns.slice(-limit).reverse();
  return { events, activity: events };
}

function modelRefsFromConfig(cfg: CompatRecord): string[] {
  const defaults = cfg.agents?.defaults ?? {};
  const modelMapRefs: string[] = defaults.models && !Array.isArray(defaults.models) && typeof defaults.models === "object"
    ? Object.entries(defaults.models as Record<string, unknown>).flatMap(([key, value]: [string, unknown]): string[] => {
        if (typeof value === "string") return [value];
        if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
        if (value && typeof value === "object") {
          const obj = value as CompatRecord;
          const refs = [obj.primary, obj.model, ...(Array.isArray(obj.fallbacks) ? obj.fallbacks : [])].filter(Boolean);
          return refs.length > 0 ? refs.map(String) : [key];
        }
        return [];
      })
    : [];
  const refs = [
    ...modelMapRefs,
    ...(Array.isArray(defaults.models) ? (defaults.models as unknown[]).map(String) : []),
    ...(Array.isArray(defaults.model?.models) ? (defaults.model.models as unknown[]).map(String) : []),
    defaults.model?.primary ? String(defaults.model.primary) : null,
    ...(Array.isArray(defaults.model?.fallbacks) ? (defaults.model.fallbacks as unknown[]).map(String) : []),
    typeof defaults.model === "string" ? defaults.model : null,
  ];
  return [...new Set(refs.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function normalizeModelEntry(value: unknown) {
  const ref = typeof value === "string" ? value : String((value as CompatRecord)?.id || (value as CompatRecord)?.model || (value as CompatRecord)?.value || "");
  const [providerFromRef, idFromRef] = ref.includes("/") ? ref.split(/\/(.+)/) : [String((value as CompatRecord)?.provider || "custom"), ref];
  const provider = String((value as CompatRecord)?.provider || providerFromRef || "custom");
  const entryId = String((value as CompatRecord)?.id || idFromRef || ref);
  return { id: entryId, name: String((value as CompatRecord)?.name || entryId || ref), provider, reasoning: Boolean((value as CompatRecord)?.reasoning) };
}

function configuredModelsResponse(cfg: CompatRecord) {
  const refs = modelRefsFromConfig(cfg);
  const defaultsModels = cfg.agents?.defaults?.models;
  const rawModels: unknown[] = Array.isArray(defaultsModels)
    ? defaultsModels as unknown[]
    : defaultsModels && typeof defaultsModels === "object"
      ? Object.entries(defaultsModels as Record<string, unknown>).flatMap(([provider, value]: [string, unknown]): unknown[] => {
          if (typeof value === "string") return [{ provider, id: value.includes("/") ? value.split(/\/(.+)/)[1] : value, name: value }];
          if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? { provider, id: item.includes("/") ? item.split(/\/(.+)/)[1] : item, name: item } : { provider, ...(item as CompatRecord) });
          if (value && typeof value === "object") {
            const obj = value as CompatRecord;
            const candidates = [obj.primary, obj.model, ...(Array.isArray(obj.fallbacks) ? obj.fallbacks : [])].filter(Boolean);
            if (candidates.length === 0) return [provider];
            return candidates.map((item: unknown) => ({ provider, id: String(item).includes("/") ? String(item).split(/\/(.+)/)[1] : String(item), name: String(item) }));
          }
          return [];
        })
      : Array.isArray(cfg.agents?.defaults?.model?.models)
        ? cfg.agents.defaults.model.models as unknown[]
        : refs as unknown[];
  const models = (rawModels.length ? rawModels : refs).map(normalizeModelEntry);
  const currentModel = cfg.agents?.defaults?.model?.primary || (typeof cfg.agents?.defaults?.model === "string" ? cfg.agents.defaults.model : null) || refs[0] || null;
  if (currentModel && !models.some((model) => `${model.provider}/${model.id}` === currentModel || model.id === currentModel)) {
    models.unshift(normalizeModelEntry(currentModel));
  }
  return { models, currentModel, defaultModel: currentModel };
}

function mergeModelLists(primary: ReturnType<typeof normalizeModelEntry>[], fallback: ReturnType<typeof normalizeModelEntry>[]) {
  const seen = new Set<string>();
  const merged: ReturnType<typeof normalizeModelEntry>[] = [];
  for (const model of [...primary, ...fallback]) {
    const key = `${model.provider}/${model.id}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(model);
  }
  return merged;
}

async function modelsResponse(context: AppContext, cfg: CompatRecord) {
  const configured = configuredModelsResponse(cfg);
  try {
    const official = await context.gateway.request<{ models?: unknown[] }>("models.list", {}, 12_000);
    const officialModels = Array.isArray(official?.models) ? official.models.map(normalizeModelEntry) : [];
    const models = mergeModelLists(officialModels, configured.models);
    if (configured.currentModel && !models.some((model) => `${model.provider}/${model.id}` === configured.currentModel || model.id === configured.currentModel)) {
      models.unshift(normalizeModelEntry(configured.currentModel));
    }
    return { ...configured, models, source: "gateway", official: true };
  } catch (error) {
    return {
      ...configured,
      source: "config",
      official: false,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}


function openclawWorkspaceRoot() {
  const cfg = readOCPlatformConfig();
  const configured = cfg.agents?.defaults?.workspace || cfg.workspaceRoot || cfg.workspace_root || process.env.WORKSPACE_ROOT;
  return typeof configured === "string" && configured.trim() ? configured : path.join(os.homedir(), ".openclaw", "workspace");
}

function memoryDir() {
  const dir = path.join(openclawWorkspaceRoot(), "memory");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeWorkspaceFilePath(inputPath: unknown, fallback = "memory/notes.md") {
  const root = path.resolve(openclawWorkspaceRoot());
  const requested = typeof inputPath === "string" && inputPath.trim() ? inputPath.trim() : fallback;
  const full = path.resolve(root, requested);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new HttpError(403, "Memory path escapes workspace", "PATH_FORBIDDEN");
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  return full;
}

function searchMemoryDocuments(query: unknown) {
  const q = String(query ?? "").trim().toLowerCase();
  const entries: CompatRecord[] = [];
  for (const doc of listMemoryDocuments()) {
    const full = safeWorkspaceFilePath(doc.path);
    const content = fs.readFileSync(full, "utf8");
    content.split("\n").forEach((line, index) => {
      const text = line.trim();
      if (!text) return;
      if (q && !text.toLowerCase().includes(q)) return;
      entries.push({
        path: doc.path,
        line: index + 1,
        content: text,
        text,
        category: /^#+\s/.test(text) ? "decision" : "fact",
        totalScore: q ? Math.min(1, Math.max(0.35, q.length / Math.max(text.length, q.length))) : 0.65,
        tags: [String(doc.name).replace(/\.md$/, "")],
      });
    });
  }
  return entries.slice(0, 50);
}

function findGitRepos(root: string, maxDepth = 4, limit = 100) {
  const repos: CompatRecord[] = [];
  const seen = new Set<string>();
  function walk(dir: string, depth: number) {
    if (repos.length >= limit || depth > maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((entry) => entry.isDirectory() && entry.name === ".git")) {
      const repoRoot = dir;
      if (!seen.has(repoRoot)) {
        seen.add(repoRoot);
        let currentBranch: string | null = null;
        try { currentBranch = git(repoRoot, ["branch", "--show-current"]).trim() || null; } catch { /* ignore */ }
        repos.push({
          id: `repo_${Buffer.from(repoRoot).toString("base64url").slice(0, 24)}`,
          name: path.basename(repoRoot),
          path: repoRoot,
          repoRoot,
          workspaceRoot: repoRoot,
          currentBranch,
          provider: "local",
        });
      }
      return;
    }
    const ignored = new Set(["node_modules", ".next", "dist", "build", "out", "target", ".cache", ".turbo", ".venv", "venv", "__pycache__"]);
    for (const entry of entries) {
      if (!entry.isDirectory() || ignored.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  }
  walk(root, 0);
  return repos;
}

function usageNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeUsage(raw: CompatRecord) {
  const input = usageNumber(raw.input ?? raw.input_tokens ?? raw.prompt_tokens);
  const output = usageNumber(raw.output ?? raw.output_tokens ?? raw.completion_tokens);
  const cacheRead = usageNumber(raw.cacheRead ?? raw.cache_read_tokens);
  const cacheWrite = usageNumber(raw.cacheWrite ?? raw.cache_write_tokens);
  const total = usageNumber(raw.total ?? raw.total_tokens) || input + output + cacheRead + cacheWrite;
  return { input, output, cacheRead, cacheWrite, total };
}

function usageTimestampMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value !== "string" || !value.trim()) return Date.now();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function frontendUsageSummary(summary: CompatRecord) {
  return {
    totalCost: usageNumber(summary.totalCost),
    totalInputTokens: usageNumber(summary.input ?? summary.totalInputTokens),
    totalOutputTokens: usageNumber(summary.output ?? summary.totalOutputTokens),
    cacheReadTokens: usageNumber(summary.cacheRead ?? summary.cacheReadTokens),
    cacheWriteTokens: usageNumber(summary.cacheWrite ?? summary.cacheWriteTokens),
    totalTokens: usageNumber(summary.totalTokens),
    input: usageNumber(summary.input),
    output: usageNumber(summary.output),
    cacheRead: usageNumber(summary.cacheRead),
    cacheWrite: usageNumber(summary.cacheWrite),
  };
}

function frontendDaily(days: CompatRecord[]) {
  return days.map((day) => ({
    date: day.day ?? day.date,
    day: day.day ?? day.date,
    input_tokens: usageNumber(day.input ?? day.input_tokens),
    output_tokens: usageNumber(day.output ?? day.output_tokens),
    cache_read_tokens: usageNumber(day.cacheRead ?? day.cache_read_tokens),
    cache_write_tokens: usageNumber(day.cacheWrite ?? day.cache_write_tokens),
    total_tokens: usageNumber(day.totalTokens ?? day.total_tokens),
    cost_usd: usageNumber(day.totalCost ?? day.cost_usd),
  }));
}

function gatewayUsageSummary(cost: CompatRecord) {
  const totals = cost.totals && typeof cost.totals === "object" ? cost.totals as CompatRecord : cost;
  return {
    input: usageNumber(totals.input ?? totals.totalInputTokens),
    output: usageNumber(totals.output ?? totals.totalOutputTokens),
    cacheRead: usageNumber(totals.cacheRead ?? totals.cacheReadTokens),
    cacheWrite: usageNumber(totals.cacheWrite ?? totals.cacheWriteTokens),
    totalTokens: usageNumber(totals.totalTokens),
    totalCost: usageNumber(totals.totalCost ?? totals.cost_usd),
  };
}

function gatewayUsageDays(cost: CompatRecord) {
  return Array.isArray(cost.daily) ? cost.daily as CompatRecord[] : [];
}

type UsagePricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

const LAST_RESORT_USAGE_PRICING: Record<string, UsagePricing> = {
  // Compatibility only: these custom gateway models may be absent from public
  // pricing catalogs and older transcript rows can persist cost=0. Prefer
  // configured pricing from OpenClaw config/env; use this only when no dynamic
  // pricing source is available. Prices are USD per 1M tokens.
  "openai-codex/gpt-5.5": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
  "openai-codex/gpt-5.4": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
};

type UsagePricingCache = {
  fingerprint: string;
  pricing: Record<string, UsagePricing>;
};

let usagePricingCache: UsagePricingCache | null = null;

function normalizePricingKey(provider: unknown, model: unknown) {
  const providerId = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  const modelId = typeof model === "string" ? model.trim().toLowerCase() : "";
  return providerId && modelId ? `${providerId}/${modelId}` : "";
}

function finitePricingNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function normalizeUsagePricing(raw: unknown): UsagePricing | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as CompatRecord;
  const input = finitePricingNumber(record.input ?? record.inputCost ?? record.input_cost_per_million);
  const output = finitePricingNumber(record.output ?? record.outputCost ?? record.output_cost_per_million);
  if (input === undefined || output === undefined) return null;
  return {
    input,
    output,
    cacheRead: finitePricingNumber(record.cacheRead ?? record.cache_read ?? record.cacheReadCost ?? record.cache_read_cost_per_million) ?? 0,
    cacheWrite: finitePricingNumber(record.cacheWrite ?? record.cache_write ?? record.cacheWriteCost ?? record.cache_write_cost_per_million) ?? 0,
  };
}

function addUsagePricing(target: Record<string, UsagePricing>, key: unknown, pricing: unknown) {
  if (typeof key !== "string" || !key.trim()) return;
  const normalizedPricing = normalizeUsagePricing(pricing);
  if (!normalizedPricing) return;
  target[key.trim().toLowerCase()] = normalizedPricing;
}

function usagePricingConfigFiles() {
  return [
    process.env.MIDDLEWARE_USAGE_PRICING_FILE,
    path.join(userHomeDir(), ".openclaw", "openclaw.json"),
    path.join(userHomeDir(), ".openclaw", "agents", "main", "models.json"),
  ].filter((file): file is string => typeof file === "string" && file.length > 0);
}

function usagePricingFingerprint(files: string[]) {
  return files.map((file) => {
    try {
      const stat = fs.statSync(file);
      return `${file}:${stat.mtimeMs}:${stat.size}`;
    } catch {
      return `${file}:missing`;
    }
  }).join("|") + `|env:${process.env.MIDDLEWARE_USAGE_PRICING_JSON ?? process.env.MIDDLEWARE_USAGE_PRICING ?? ""}`;
}

function addPricingFromProviders(target: Record<string, UsagePricing>, providers: unknown) {
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return;
  for (const [providerKey, providerConfig] of Object.entries(providers as CompatRecord)) {
    const models = (providerConfig as CompatRecord | undefined)?.models;
    if (!Array.isArray(models)) continue;
    for (const model of models) {
      if (!model || typeof model !== "object" || Array.isArray(model)) continue;
      const modelRecord = model as CompatRecord;
      const modelId = modelRecord.id ?? modelRecord.model ?? modelRecord.name;
      const pricing = modelRecord.cost ?? modelRecord.pricing ?? modelRecord;
      addUsagePricing(target, normalizePricingKey(providerKey, modelId), pricing);
    }
  }
}

function addPricingFromMap(target: Record<string, UsagePricing>, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as CompatRecord;
  addPricingFromProviders(target, record.providers);
  for (const [key, pricing] of Object.entries(record)) {
    if (key === "providers" || key === "models") continue;
    addUsagePricing(target, key, pricing);
  }
  if (record.models && typeof record.models === "object") addPricingFromMap(target, record.models);
}

function loadConfiguredUsagePricing() {
  const files = usagePricingConfigFiles();
  const fingerprint = usagePricingFingerprint(files);
  if (usagePricingCache?.fingerprint === fingerprint) return usagePricingCache.pricing;

  const pricing: Record<string, UsagePricing> = {};
  const envPricing = process.env.MIDDLEWARE_USAGE_PRICING_JSON ?? process.env.MIDDLEWARE_USAGE_PRICING;
  if (envPricing) {
    try { addPricingFromMap(pricing, JSON.parse(envPricing)); } catch {}
  }
  for (const file of files) {
    const parsed = readJsonFile(file);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const record = parsed as CompatRecord;
    addPricingFromProviders(pricing, (record.models as CompatRecord | undefined)?.providers ?? record.providers);
    addPricingFromMap(pricing, record.usagePricing ?? record.pricing ?? record.modelPricing);
  }

  usagePricingCache = { fingerprint, pricing };
  return pricing;
}

function resolveUsagePricing(provider: unknown, model: unknown) {
  const key = normalizePricingKey(provider, model);
  if (!key) return null;
  return loadConfiguredUsagePricing()[key] ?? LAST_RESORT_USAGE_PRICING[key] ?? null;
}

function estimateUsageCostFromPricing(usage: CompatRecord, provider: unknown, model: unknown) {
  const pricing = resolveUsagePricing(provider, model);
  if (!pricing) return 0;
  const input = usageNumber(usage.input);
  const output = usageNumber(usage.output);
  const cacheRead = usageNumber(usage.cacheRead);
  const cacheWrite = usageNumber(usage.cacheWrite);
  if (input + output + cacheRead + cacheWrite <= 0) return 0;
  return (input * pricing.input + output * pricing.output + cacheRead * pricing.cacheRead + cacheWrite * pricing.cacheWrite) / 1_000_000;
}

function hasBillableUsage(summary: CompatRecord) {
  return usageNumber(summary.totalTokens) > 0
    || usageNumber(summary.input) + usageNumber(summary.output) + usageNumber(summary.cacheRead) + usageNumber(summary.cacheWrite) > 0;
}

function mergeEstimatedCosts(gatewayCost: CompatRecord, transcriptUsage: ReturnType<typeof usageFromSessions>) {
  const gatewaySummary = gatewayUsageSummary(gatewayCost);
  const transcriptSummary = transcriptUsage.summary as CompatRecord;
  const gatewayTotalCost = usageNumber(gatewaySummary.totalCost);
  const transcriptTotalCost = usageNumber(transcriptSummary.totalCost);
  if (transcriptTotalCost > gatewayTotalCost) {
    const totals = gatewayCost.totals && typeof gatewayCost.totals === "object" ? gatewayCost.totals as CompatRecord : gatewayCost;
    totals.totalCost = transcriptTotalCost;
  }

  const transcriptCostByDay = new Map(
    transcriptUsage.days.map((day) => [String(day.day ?? day.date), usageNumber(day.totalCost)]),
  );
  for (const day of gatewayUsageDays(gatewayCost)) {
    const key = String(day.day ?? day.date ?? "");
    const estimatedCost = transcriptCostByDay.get(key) ?? 0;
    if (estimatedCost > usageNumber(day.totalCost ?? day.cost_usd) && hasBillableUsage(day)) {
      day.totalCost = estimatedCost;
      day.cost_usd = estimatedCost;
    }
  }
  return gatewayCost;
}

async function gatewayUsageCost(context: AppContext, days: number) {
  try {
    const payload = await context.gateway.request<CompatRecord>("usage.cost", { days }, 8_000);
    if (!payload || typeof payload !== "object") return null;
    const hasTotals = payload.totals && typeof payload.totals === "object";
    const hasDaily = Array.isArray(payload.daily);
    return hasTotals || hasDaily ? payload : null;
  } catch {
    return null;
  }
}

function userHomeDir() {
  return process.env.HOME || os.homedir();
}

type UsageCacheFile = {
  size: number;
  mtimeMs: number;
  usage: CompatRecord[];
};

type UsageCacheState = {
  version: number;
  files: Record<string, UsageCacheFile>;
};

const USAGE_CACHE_VERSION = 2;
let usageCacheState: UsageCacheState | null = null;

function usageCachePath() {
  return path.join(userHomeDir(), ".openclaw", "middleware", "usage-cache.json");
}

function loadUsageCache(): UsageCacheState {
  if (usageCacheState) return usageCacheState;
  try {
    const parsed = JSON.parse(fs.readFileSync(usageCachePath(), "utf8")) as UsageCacheState;
    usageCacheState = parsed?.version === USAGE_CACHE_VERSION && parsed.files && typeof parsed.files === "object"
      ? parsed
      : { version: USAGE_CACHE_VERSION, files: {} };
  } catch {
    usageCacheState = { version: USAGE_CACHE_VERSION, files: {} };
  }
  return usageCacheState;
}

function saveUsageCache(cache: UsageCacheState) {
  try {
    const file = usageCachePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache));
  } catch {
    // Cache writes are best-effort; usage can still be recomputed from transcripts.
  }
}

function listUsageTranscriptFiles() {
  const files: string[] = [];
  const agentsRoot = path.join(userHomeDir(), ".openclaw", "agents");
  if (!fs.existsSync(agentsRoot)) return files;
  for (const agent of fs.readdirSync(agentsRoot)) {
    const sessionsDir = path.join(agentsRoot, agent, "sessions");
    if (!fs.existsSync(sessionsDir)) continue;
    for (const file of fs.readdirSync(sessionsDir)) {
      if (!file.endsWith(".jsonl") || file.endsWith(".trajectory.jsonl")) continue;
      files.push(path.join(sessionsDir, file));
    }
  }
  return files;
}

function parseUsageTranscriptFile(full: string) {
  const parsedUsage: CompatRecord[] = [];
  const lines = fs.readFileSync(full, "utf8").split("\n");
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    try {
      const entry = JSON.parse(line) as CompatRecord;
      const message = entry.message && typeof entry.message === "object" ? entry.message as CompatRecord : {};
      const data = entry.data && typeof entry.data === "object" ? entry.data as CompatRecord : {};
      const raw = (message.usage ?? data.usage ?? entry.usage) as CompatRecord | undefined;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const normalized = normalizeUsage(raw);
      const timestamp = entry.timestamp ?? entry.ts ?? message.timestamp ?? data.timestamp;
      const timestampMs = usageTimestampMs(timestamp);
      const provider = message.provider ?? entry.provider;
      const model = message.model ?? entry.modelId;
      const storedCost = usageNumber((raw.cost && typeof raw.cost === "object" ? (raw.cost as CompatRecord).total : undefined) ?? raw.totalCost);
      const estimatedCost = estimateUsageCostFromPricing(normalized, provider, model);
      const cost = storedCost > 0 ? storedCost : estimatedCost;
      parsedUsage.push({
        ...normalized,
        cost,
        provider,
        model,
        timestamp: typeof timestamp === "string" || typeof timestamp === "number" ? timestamp : new Date(timestampMs).toISOString(),
        timestampMs,
        sessionFile: full,
      });
    } catch {
      // Skip malformed transcript lines.
    }
  }
  return parsedUsage;
}

function usageFromSessions(requestedDays = 30) {
  const usage: CompatRecord[] = [];
  const days = new Map<string, CompatRecord>();
  const cutoff = Date.now() - Math.max(1, requestedDays) * 24 * 60 * 60 * 1000;
  const cache = loadUsageCache();
  const seenFiles = new Set<string>();
  let cacheChanged = false;

  for (const full of listUsageTranscriptFiles()) {
    seenFiles.add(full);
    let stat: fs.Stats;
    try { stat = fs.statSync(full); } catch { continue; }
    const size = stat.size;
    const mtimeMs = Math.round(stat.mtimeMs);
    let fileUsage = cache.files[full]?.usage;
    if (!fileUsage || cache.files[full].size !== size || cache.files[full].mtimeMs !== mtimeMs) {
      fileUsage = parseUsageTranscriptFile(full);
      cache.files[full] = { size, mtimeMs, usage: fileUsage };
      cacheChanged = true;
    }

    for (const item of fileUsage) {
      const timestampMs = usageTimestampMs(item.timestampMs ?? item.timestamp);
      if (timestampMs < cutoff) continue;
      usage.push(item);
      const dayKey = new Date(timestampMs).toISOString().slice(0, 10);
      const daily = days.get(dayKey) ?? { day: dayKey, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0 };
      daily.input += usageNumber(item.input);
      daily.output += usageNumber(item.output);
      daily.cacheRead += usageNumber(item.cacheRead);
      daily.cacheWrite += usageNumber(item.cacheWrite);
      daily.totalTokens += usageNumber(item.total);
      daily.totalCost += usageNumber(item.cost);
      days.set(dayKey, daily);
    }
  }

  for (const file of Object.keys(cache.files)) {
    if (!seenFiles.has(file)) {
      delete cache.files[file];
      cacheChanged = true;
    }
  }
  if (cacheChanged) saveUsageCache(cache);

  const summary = usage.reduce((acc, item) => {
    acc.input += usageNumber(item.input);
    acc.output += usageNumber(item.output);
    acc.cacheRead += usageNumber(item.cacheRead);
    acc.cacheWrite += usageNumber(item.cacheWrite);
    acc.totalTokens += usageNumber(item.total);
    acc.totalCost += usageNumber(item.cost);
    return acc;
  }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0 });
  return {
    summary,
    usage,
    days: [...days.values()].sort((a, b) => String(a.day).localeCompare(String(b.day))),
    source: "openclaw-session-transcripts",
    unavailable: usage.length === 0,
  };
}

async function usageProviders(context: AppContext) {
  try {
    const status = await context.gateway.request<CompatRecord>("usage.status", {}, 2_000);
    const payload = status.payload && typeof status.payload === "object" ? status.payload as CompatRecord : status;
    return Array.isArray(payload.providers) ? payload.providers : [];
  } catch {
    return [];
  }
}

async function usageResponse(context: AppContext, days: number) {
  const providers = await usageProviders(context);
  const gatewayCost = await gatewayUsageCost(context, days);
  const usage = usageFromSessions(days);
  if (gatewayCost) {
    const correctedGatewayCost = mergeEstimatedCosts(gatewayCost, usage);
    return {
      range: { days },
      summary: frontendUsageSummary(gatewayUsageSummary(correctedGatewayCost)),
      providers,
      usage: [],
      source: "gateway-usage-cost",
      unavailable: false,
    };
  }


  return {
    range: { days },
    summary: frontendUsageSummary(usage.summary),
    providers,
    usage: usage.usage.slice(-500),
    source: usage.source,
    unavailable: usage.unavailable,
  };
}

async function dailyUsage(context: AppContext, days: number) {
  const gatewayCost = await gatewayUsageCost(context, days);
  const usage = usageFromSessions(days);
  if (gatewayCost) {
    const correctedGatewayCost = mergeEstimatedCosts(gatewayCost, usage);
    const daily = frontendDaily(gatewayUsageDays(correctedGatewayCost)).slice(-days);
    return { range: { days }, daily, days: gatewayUsageDays(correctedGatewayCost), source: "gateway-usage-cost", unavailable: false };
  }


  const daily = frontendDaily(usage.days);
  return { range: { days }, daily, days: usage.days, source: usage.source, unavailable: usage.unavailable };
}

function kickGatewayConnect(context: AppContext) {
  void context.gateway.connect().catch(() => {
    // status() carries lastError; callers should still get a usable payload.
  });
}

async function connectGatewayForStatus(context: AppContext, options: { wait?: boolean; timeoutMs?: number } = {}) {
  const wait = options.wait === true;
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!wait) {
    kickGatewayConnect(context);
    return context.gateway.status();
  }
  try {
    await Promise.race([
      context.gateway.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Gateway connect status timeout")), timeoutMs)),
    ]);
  } catch {
    // status() below carries lastError; callers should still get a usable payload.
  }
  return context.gateway.status();
}

type DataHandler = (data: string) => void;
type ExitHandler = (event: { exitCode: number }) => void;

class ChildProcessTerminal {
  private dataHandlers = new Set<DataHandler>();
  private exitHandlers = new Set<ExitHandler>();

  constructor(private child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk) => this.emitData(chunk.toString()));
    child.stderr.on("data", (chunk) => this.emitData(chunk.toString()));
    child.on("exit", (code) => this.emitExit(code ?? 0));
  }

  private emitData(data: string) { for (const handler of this.dataHandlers) handler(data); }
  private emitExit(exitCode: number) { for (const handler of this.exitHandlers) handler({ exitCode }); }
  write(data: string) { this.child.stdin.write(data); }
  resize(_cols: number, _rows: number) {}
  kill() { this.child.kill(); }
  onData(handler: DataHandler) { this.dataHandlers.add(handler); return { dispose: () => this.dataHandlers.delete(handler) }; }
  onExit(handler: ExitHandler) { this.exitHandlers.add(handler); return { dispose: () => this.exitHandlers.delete(handler) }; }
}

function terminalShell() {
  return process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
}

async function spawnPty(command: string, cwd: string, cols: number, rows: number): Promise<IPty> {
  try {
    const pty = await import("node-pty");
    return pty.spawn(command, [], { cwd, cols, rows, env: process.env });
  } catch {
    const child = spawnChild(command, [], { cwd, env: process.env, shell: false });
    return new ChildProcessTerminal(child) as unknown as IPty;
  }
}

function broadcastTerminal(term: CompatTerminal, event: string, payload: CompatRecord) {
  const frame = { event, data: payload };
  for (const listener of [...term.listeners]) listener(event, payload);
  return frame;
}

function safeTerminalCwd(rawCwd: unknown) {
  const root = workspaceRoot();
  fs.mkdirSync(root, { recursive: true });
  try {
    const cwd = rawCwd ? safeJoin(root, String(rawCwd)) : root;
    const stat = fs.existsSync(cwd) ? fs.statSync(cwd) : null;
    return stat?.isDirectory() ? cwd : root;
  } catch {
    return root;
  }
}

async function spawnTerminal(cwd: string, body: CompatRecord = {}) {
  const idValue = id("term");
  const resolvedCwd = safeTerminalCwd(cwd === workspaceRoot() ? undefined : cwd);
  const proc = await spawnPty(terminalShell(), resolvedCwd, Number(body.cols ?? 80), Number(body.rows ?? 24));
  const term: CompatTerminal = { id: idValue, proc, cwd: resolvedCwd, buffer: [], listeners: new Set() };
  proc.onData((data) => {
    term.buffer.push(data);
    if (term.buffer.length > 200) term.buffer.shift();
    broadcastTerminal(term, "data", { type: "terminal.data", terminalId: idValue, data });
  });
  proc.onExit((event) => {
    closeCompatTerminal(term, "exit", { exitCode: event.exitCode ?? 0 });
  });
  compatState.terminals.set(idValue, term);
  return { terminalId: idValue, cwd: resolvedCwd, streamUrl: `/api/terminal/${idValue}/stream`, websocketUrl: `/api/terminal/${idValue}/ws` };
}

function getTerminal(terminalId: string) {
  return compatState.terminals.get(terminalId) ?? null;
}

function closeCompatTerminal(term: CompatTerminal, event: "exit" | "error" | "kill", payload: CompatRecord = {}) {
  compatState.terminals.delete(term.id);
  if (event === "error") {
    broadcastTerminal(term, "error", { type: "terminal.error", terminalId: term.id, ...payload });
  } else if (event === "exit") {
    broadcastTerminal(term, "exit", { type: "terminal.exit", terminalId: term.id, ...payload });
  }
  if (event === "kill") {
    try { term.proc.kill(); } catch (error) {
      broadcastTerminal(term, "error", {
        type: "terminal.error",
        terminalId: term.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    broadcastTerminal(term, "exit", { type: "terminal.exit", terminalId: term.id, killed: true });
  }
}

export async function registerCompatRoutes(app: FastifyInstance, context: AppContext) {
  loadCompatState(context);
  context.compat = {
    touchChatActivity: (input) => touchCompatChatActivity(context, input),
    hydrateImportedChatHistory: async (sessionKey) => {
      loadCompatState(context);
      const link = importedPlatformSessionLink(sessionKey);
      if (!link) return { hydrated: false, reason: "not_imported_platform_session" };
      return hydrateImportedPlatformSessionMessages(context, link.kind, link.sourceSessionKey, link.label);
    },
    // Used by /api/chat/messages to skip gateway chat.history refill for
    // imported Telegram/Discord sessions (source of truth is the local projection).
    importedPlatformSessionLink: (sessionKey) => {
      loadCompatState(context);
      return importedPlatformSessionLink(sessionKey);
    },
    resolveImportedSourceSessionKey: (sessionKey) => importedSourceSessionKeyForDesktopSession(sessionKey),
  };
  if (compatState.spaces.length === 0) {
    ensureDefaultSpace();
    saveCompatState(context);
  }
  // Invalidate bootstrap cache on Gateway reconnect so stale sidebar/chat data refreshes
  context.gateway.onReconnect(() => {
    createLogger("compat").info("gateway.reconnect.invalidate-bootstrap-cache");
    invalidateBootstrapCache();
  });

  app.get("/api/version", async () => ({
    ok: true,
    version: "0.1.0",
    service: "openclaw-middleware",
  }));

  app.get("/api/bootstrap", async () => {
    const gateway = await connectGatewayForStatus(context);
    const syncAge = Date.now() - lastFullSyncAtMs;
    const hasAnyCachedState = lastFullSyncAtMs > 0 && syncAge < BOOTSTRAP_STALE_SERVE_MS;
    if (hasAnyCachedState) {
      // Serve from in-memory compatState immediately, sync in background
      void syncGatewaySessions(context).then(() => {
        lastFullSyncAtMs = Date.now();
        applyProjectedChatActivity(context);
      }).catch(() => {});
    } else {
      // First load or cache too old — must sync blocking
      await syncGatewaySessions(context);
      lastFullSyncAtMs = Date.now();
      applyProjectedChatActivity(context);
    }
    const spaceId = activeSpaceId();
    const normalizedTelegramImports = normalizeImportedPlatformState("telegram");
    const normalizedDiscordImports = normalizeImportedPlatformState("discord");
    if (normalizedTelegramImports || normalizedDiscordImports) saveCompatState(context);
    const projects = listBySpace(compatState.projects, spaceId);
    const projectIds = new Set(projects.map((project) => project.id).filter(Boolean));
    return {
      ok: true,
      service: "openclaw-middleware",
      spaces: spacesForResponse(compatState.spaces.filter(visibleSpace)),
      activeSpaceId: spaceId,
      chats: sortedChatsForResponse(spaceId, false),
      projects,
      topics: compatState.topics.filter((topic) => notDeleted(topic) && projectIds.has(topic.projectId)),
      sessions: sessionsForSpace(spaceId),
      gateway,
    };
  });

  app.get("/api/spaces", async (request) => {
    const query = request.query as CompatRecord;
    const archived = query.archived === "true" || query.archived === true;
    return {
      spaces: spacesForResponse(compatState.spaces.filter((space) => archived ? Boolean(space.archived) && notDeleted(space) : visibleSpace(space))),
      activeSpaceId: activeSpaceId(),
    };
  });

  app.post("/api/spaces", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const timestamp = nowIso();
    const iconImage = spaceIconImageFrom(body);
    const iconEmoji = spaceIconEmojiFrom(body);
    const space = {
      id: id("space"),
      name: body.name || "New Space",
      ...(iconEmoji ? { iconEmoji } : {}),
      ...(iconImage ? { iconImage } : {}),
      archived: false,
      deleted: false,
      sortOrder: compatState.spaces.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    compatState.spaces.push(space);
    compatState.activeSpaceId = space.id;
    saveCompatState(context);
    return { space: spaceForResponse(space), activeSpaceId: space.id };
  });

  app.patch<{ Params: { spaceId: string } }>("/api/spaces/:spaceId", async (request, reply) => {
    const patch = sanitizeSpacePatch(request.body as CompatRecord);
    const space = patchById(compatState.spaces, request.params.spaceId, patch);
    if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
    if (space.archived && compatState.activeSpaceId === space.id) {
      compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
    }
    saveCompatCollection(context, "spaces");
    return { space: spaceForResponse(space) };
  });

  app.post<{ Params: { spaceId: string } }>("/api/spaces/:spaceId/archive", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const archived = body.archived ?? true;
    if (request.params.spaceId === DEFAULT_SPACE_ID) {
      const existing = compatState.spaces.find((item) => item.id === DEFAULT_SPACE_ID) ?? {};
      const space = patchById(compatState.spaces, DEFAULT_SPACE_ID, normalizeDefaultSpace(existing)) ?? normalizeDefaultSpace(existing);
      saveCompatCollection(context, "spaces");
      return { ok: true, activeSpaceId: activeSpaceId(), space, archived: false };
    }
    const space = patchById(compatState.spaces, request.params.spaceId, { archived });
    if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
    if (archived) archiveChatsForSpace(request.params.spaceId);
    else restoreChatsForSpace(request.params.spaceId);
    if (archived && compatState.activeSpaceId === space.id) {
      compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
    }
    saveCompatState(context);
    return { ok: true, activeSpaceId: activeSpaceId(), space, archived };
  });

  app.post<{ Params: { spaceId: string } }>("/api/spaces/:spaceId/switch", async (request, reply) => {
    const space = compatState.spaces.find((item) => item.id === request.params.spaceId && visibleSpace(item));
    if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
    space.updatedAt = nowIso();
    compatState.activeSpaceId = space.id;
    saveCompatState(context);
    return { activeSpaceId: space.id, space };
  });

  app.delete<{ Params: { spaceId: string } }>("/api/spaces/:spaceId", async (request) => {
    return deleteCompatSpace(context, request.params.spaceId);
  });

  app.get("/api/chats", async (request) => {
    const syncAge = Date.now() - lastFullSyncAtMs;
    const hasAnyCachedState = lastFullSyncAtMs > 0 && syncAge < BOOTSTRAP_STALE_SERVE_MS;
    if (hasAnyCachedState) {
      // chats served from cached compatState
      void syncGatewaySessions(context).then(() => {
        lastFullSyncAtMs = Date.now();
        applyProjectedChatActivity(context);
      }).catch(() => {});
    } else {
      await syncGatewaySessions(context);
      lastFullSyncAtMs = Date.now();
      applyProjectedChatActivity(context);
    }
    const query = request.query as CompatRecord;
    const archived = query.archived === "true" || query.archived === true;
    const spaceId = listSpaceId(query);
    return {
      chats: sortedChatsForResponse(spaceId, archived),
    };
  });

  app.post("/api/chats", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const timestamp = nowIso();
    const sessionKey = String(body.sessionKey || `agent:${body.agentId || "main"}:desktop:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    const spaceId = sessionWriteSpaceId(body);
    const displayName = await groqFileNameFromPrompt(body.name || "New Chat", context);
    void context.gateway.request("sessions.create", {
      key: sessionKey,
      agentId: body.agentId || "main",
      label: gatewaySessionLabel(displayName, sessionKey),
    }).catch(() => { /* session may already exist or gateway may be offline */ });
    const chat = {
      id: id("chat"),
      name: displayName,
      sessionKey,
      spaceId,
      agentId: body.agentId || "main",
      archived: false,
      pinned: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActiveAt: timestamp,
    };
    const session = {
      id: id("session"),
      key: sessionKey,
      sessionKey,
      projectId: body.projectId || null,
      topicId: body.topicId || null,
      spaceId,
      agentId: body.agentId || "main",
      label: displayName,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    compatState.chats.push(chat);
    compatState.sessions.push(session);
    saveCompatCollections(context, ["chats", "sessions"]);
    return { chat, session };
  });

  app.patch<{ Params: { chatId: string } }>("/api/chats/:chatId", async (request, reply) => {
    const chat = patchById(compatState.chats, request.params.chatId, request.body as CompatRecord);
    if (!chat) return reply.code(404).send({ ok: false, error: { message: "Chat not found" } });
    saveCompatCollection(context, "chats");
    return { chat };
  });

  app.post<{ Params: { chatId: string } }>("/api/chats/:chatId/rename", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const chat = patchById(compatState.chats, request.params.chatId, { name: body.name || "New Chat" });
    if (!chat) return reply.code(404).send({ ok: false, error: { message: "Chat not found" } });
    saveCompatCollection(context, "chats");
    return { chat };
  });

  app.post<{ Params: { spaceId: string } }>("/api/spaces/:spaceId/rename", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const space = patchById(compatState.spaces, request.params.spaceId, { name: body.name || "New Space" });
    if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
    saveCompatCollection(context, "spaces");
    return { space: spaceForResponse(space), activeSpaceId: activeSpaceId() };
  });

  app.post<{ Params: { chatId: string } }>("/api/chats/:chatId/archive", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const archived = body.archived ?? true;
    const chat = patchById(
      compatState.chats,
      request.params.chatId,
      archived ? { archived: true, archivedBySpace: false } : { archived: false, archivedBySpace: undefined },
    );
    if (!chat) return reply.code(404).send({ ok: false, error: { message: "Chat not found" } });
    saveCompatCollection(context, "chats");
    return { chat };
  });

  app.delete("/api/chats", async () => {
    const allChats = compatState.chats.filter(notDeleted);
    const deletedIds: string[] = [];
    const sessionKeys: string[] = [];

    for (const chat of allChats) {
      const sessionKey = typeof chat.sessionKey === "string" && chat.sessionKey.trim() ? chat.sessionKey.trim() : null;
      deletedIds.push(chat.id);
      if (sessionKey) sessionKeys.push(sessionKey);
    }

    // Clear compat state (local only — do NOT touch Gateway sessions)
    compatState.chats = compatState.chats.filter((c) => !deletedIds.includes(c.id));
    compatState.sessions = compatState.sessions.filter(
      (s) => !sessionKeys.includes(s.sessionKey) && !sessionKeys.includes(s.key ?? "")
    );
    saveCompatState(context);

    // Clean up local SQLite projections only
    for (const sk of sessionKeys) {
      try {
        context.db.prepare("DELETE FROM v2_messages WHERE session_key = ?").run(sk);
        context.db.prepare("DELETE FROM v2_runs WHERE session_key = ?").run(sk);
        context.db.prepare("DELETE FROM v2_tool_calls WHERE session_key = ?").run(sk);
        context.db.prepare("DELETE FROM v2_sessions WHERE session_key = ?").run(sk);
        context.db.prepare("DELETE FROM v2_gateway_offsets WHERE session_key = ?").run(sk);
        context.db.prepare("DELETE FROM v2_projection_events WHERE session_key = ?").run(sk);
        context.db.prepare("DELETE FROM v2_chat_segments WHERE session_key = ?").run(sk);
        context.db.prepare("DELETE FROM v2_archive_imports WHERE session_key = ?").run(sk);
      } catch {}
    }

    return { ok: true, deleted: deletedIds.length, sessionsCleaned: sessionKeys.length };
  });

  app.delete<{ Params: { chatId: string } }>("/api/chats/:chatId", async (request) => {
    return deleteCompatChat(context, request.params.chatId);
  });

  app.post<{ Params: { chatId: string } }>("/api/chats/:chatId/session", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const sessionKey = body.sessionKey ?? null;
    const existingChat = compatState.chats.find((item) => item.id === request.params.chatId && notDeleted(item));
    const spaceId = typeof body.spaceId === "string" && body.spaceId.trim()
      ? body.spaceId
      : typeof existingChat?.spaceId === "string" && existingChat.spaceId.trim()
        ? existingChat.spaceId
        : sessionWriteSpaceId(body);
    let chat = patchById(compatState.chats, request.params.chatId, { sessionKey, spaceId });
    if (!chat) {
      const timestamp = nowIso();
      chat = {
        id: request.params.chatId,
        name: body.name || "New Chat",
        sessionKey,
        spaceId,
        agentId: body.agentId || "main",
        archived: false,
        pinned: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActiveAt: timestamp,
      };
      compatState.chats.push(chat);
    }
    saveCompatCollection(context, "chats");
    return { chat };
  });

  app.get("/api/projects", async (request) => {
    const query = request.query as CompatRecord;
    return { projects: listBySpace(compatState.projects, listSpaceId(query)) };
  });
  app.post("/api/projects", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const timestamp = nowIso();
    const project = { id: id("project"), name: body.name || "Untitled Project", spaceId: body.spaceId || activeSpaceId(), ...body, createdAt: timestamp, updatedAt: timestamp };
    compatState.projects.push(project);
    saveCompatCollection(context, "projects");
    return { project };
  });
  app.patch<{ Params: { projectId: string } }>("/api/projects/:projectId", async (request, reply) => {
    const project = patchById(compatState.projects, request.params.projectId, request.body as CompatRecord);
    if (!project) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    saveCompatCollection(context, "projects");
    return { project };
  });
  app.delete<{ Params: { projectId: string } }>("/api/projects/:projectId", async (request) => {
    patchById(compatState.projects, request.params.projectId, { deleted: true });
    saveCompatCollection(context, "projects");
    return { ok: true };
  });

  app.get("/api/topics", async (request) => {
    const query = request.query as CompatRecord;
    const spaceId = listSpaceId(query);
    return { topics: compatState.topics.filter((topic) =>
      notDeleted(topic) &&
      (!spaceId || topicSpaceId(topic) === spaceId) &&
      (!query.projectId || topic.projectId === query.projectId)
    ) };
  });
  app.post("/api/topics", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const timestamp = nowIso();
    const topic = { id: id("topic"), name: body.name || "New Topic", archived: false, deleted: false, ...body, createdAt: timestamp, updatedAt: timestamp };
    compatState.topics.push(topic);
    saveCompatCollection(context, "topics");
    return { topic };
  });
  app.patch<{ Params: { topicId: string } }>("/api/topics/:topicId", async (request, reply) => {
    const topic = patchById(compatState.topics, request.params.topicId, request.body as CompatRecord);
    if (!topic) return reply.code(404).send({ ok: false, error: { message: "Topic not found" } });
    saveCompatCollection(context, "topics");
    return { topic };
  });
  app.post<{ Params: { topicId: string } }>("/api/topics/:topicId/archive", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const topic = patchById(compatState.topics, request.params.topicId, { archived: body.archived ?? true });
    if (!topic) return reply.code(404).send({ ok: false, error: { message: "Topic not found" } });
    saveCompatCollection(context, "topics");
    return { topic };
  });
  app.delete<{ Params: { topicId: string } }>("/api/topics/:topicId", async (request) => {
    patchById(compatState.topics, request.params.topicId, { deleted: true });
    saveCompatCollection(context, "topics");
    return { ok: true };
  });

  app.get("/api/sessions", async (request) => {
    const syncAge = Date.now() - lastFullSyncAtMs;
    const hasAnyCachedState = lastFullSyncAtMs > 0 && syncAge < BOOTSTRAP_STALE_SERVE_MS;
    if (hasAnyCachedState) {
      // sessions served from cached compatState
      void syncGatewaySessions(context).then(() => {
        lastFullSyncAtMs = Date.now();
      }).catch(() => {});
    } else {
      await syncGatewaySessions(context);
      lastFullSyncAtMs = Date.now();
    }
    const query = request.query as CompatRecord;
    const spaceId = listSpaceId(query);
    return {
      sessions: compatState.sessions.filter((session) =>
        notDeleted(session) &&
        (!spaceId || sessionSpaceId(session) === spaceId) &&
        (!query.projectId || session.projectId === query.projectId) &&
        (!query.topicId || session.topicId === query.topicId)
      ),
    };
  });
  app.post("/api/sessions", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const timestamp = nowIso();
    const sessionKey = String(body.sessionKey || `agent:${body.agentId || "main"}:desktop:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    try {
      await context.gateway.request("sessions.create", {
        key: sessionKey,
        agentId: body.agentId || "main",
        label: gatewaySessionLabel(body.label, sessionKey),
      });
    } catch { /* session may already exist or gateway may be offline */ }
    const existingIndex = compatState.sessions.findIndex((session) => session.sessionKey === sessionKey || session.key === sessionKey);
    const sessionPatch = { ...body, spaceId: sessionWriteSpaceId(body), key: sessionKey, sessionKey, updatedAt: timestamp };
    const session = existingIndex >= 0
      ? { ...compatState.sessions[existingIndex], ...sessionPatch, createdAt: compatState.sessions[existingIndex].createdAt || timestamp, deleted: false }
      : { id: id("session"), ...sessionPatch, createdAt: timestamp };
    if (existingIndex >= 0) compatState.sessions[existingIndex] = session;
    else compatState.sessions.push(session);
    saveCompatCollection(context, "sessions");
    return { session };
  });

  // --- project archive ---
  app.post<{ Params: { projectId: string } }>("/api/projects/:projectId/archive", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const project = patchById(compatState.projects, request.params.projectId, { archived: body.archived ?? true });
    if (!project) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    saveCompatCollection(context, "projects");
    return { project };
  });

  // --- repos ---
  app.get("/api/repos/recent", async () => ({ repos: findGitRepos(openclawWorkspaceRoot(), 4, 50) }));
  app.post("/api/repos/scan", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const root = String(body.path || body.root || body.workspaceRoot || openclawWorkspaceRoot());
    return { repos: findGitRepos(root, 5, 200), root };
  });
  app.post("/api/repos/select", async (request) => ({ ok: true, ...(request.body as CompatRecord) }));

  // --- git (project-scoped) ---
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/git/status", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found or has no workspace root" } });
    try { return gitStatus(root, request.params.projectId); } catch { return { hasGit: false, dirty: false, files: [], changedFiles: [], recentCommits: [], summary: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0 } }; }
  });
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/git/diff", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    const filePath = String((request.query as CompatRecord).path ?? "");
    try { return gitDiff(root, filePath); } catch (error) { return { patch: null, error: error instanceof Error ? error.message : "Diff unavailable" }; }
  });
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/git/branches", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    try { return gitBranches(root); } catch { return { branches: [], current: "" }; }
  });
  app.post<{ Params: { projectId: string } }>("/api/projects/:projectId/git/checkout", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    const body = (request.body ?? {}) as CompatRecord;
    const branch = String(body.branch ?? body.branchName ?? "");
    if (!branch) return reply.code(400).send({ ok: false, error: { message: "Branch name required" } });
    try { git(root, ["checkout", branch]); return { ok: true, branch }; } catch (error) { return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Checkout failed" } }); }
  });

  // --- git (repo-path-scoped, no project) ---
  app.get("/api/repos/git/status", async (request) => {
    const repoPath = String((request.query as CompatRecord).path ?? (request.query as CompatRecord).repoPath ?? "");
    if (!repoPath) return { dirty: false, files: [] };
    try { return gitStatus(repoPath, null); } catch { return { hasGit: false, dirty: false, files: [], changedFiles: [], recentCommits: [], summary: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0 } }; }
  });
  app.get("/api/repos/git/diff", async (request) => {
    const query = request.query as CompatRecord;
    const repoPath = String(query.repoPath ?? "");
    const filePath = String(query.path ?? "");
    if (!repoPath) return { patch: "" };
    try { return gitDiff(repoPath, filePath); } catch (error) { return { patch: null, error: error instanceof Error ? error.message : "Diff unavailable" }; }
  });
  app.get("/api/repos/git/branches", async (request) => {
    const repoPath = String((request.query as CompatRecord).path ?? (request.query as CompatRecord).repoPath ?? "");
    if (!repoPath) return { branches: [], current: "" };
    try { return gitBranches(repoPath); } catch { return { branches: [], current: "" }; }
  });
  app.post("/api/repos/git/checkout", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const repoPath = String(body.repoPath ?? body.path ?? "");
    const branch = String(body.branch ?? body.branchName ?? "");
    if (!repoPath || !branch) return reply.code(400).send({ ok: false, error: { message: "repoPath and branch required" } });
    try { git(repoPath, ["checkout", branch]); return { ok: true, branch }; } catch (error) { return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Checkout failed" } }); }
  });

  // --- workspace (project-scoped) ---
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/workspace/capabilities", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    return workspaceCapabilities();
  });

  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/workspace/tree", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    const rel = String((request.query as CompatRecord).path ?? "");
    try {
      return workspaceTree(root, rel);
    } catch { return { entries: [] }; }
  });

  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/workspace/stat", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    const rel = String((request.query as CompatRecord).path ?? "");
    try { return workspaceStat(root, rel); }
    catch { return reply.code(404).send({ ok: false, error: { message: "Not found" } }); }
  });

  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/workspace/file", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    const rel = String((request.query as CompatRecord).path ?? "");
    try {
      return workspaceReadFile(root, rel);
    } catch { return reply.code(404).send({ ok: false, error: { message: "File not found" } }); }
  });
  app.put<{ Params: { projectId: string } }>("/api/projects/:projectId/workspace/file", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    const body = (request.body ?? {}) as CompatRecord;
    try {
      return workspaceWriteFile(root, body);
    } catch { return reply.code(500).send({ ok: false, error: { message: "Write failed" } }); }
  });

  app.delete<{ Params: { projectId: string } }>("/api/projects/:projectId/workspace/file", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    const rel = String((request.query as CompatRecord).path ?? "");
    try { return workspaceDeleteFile(root, rel); }
    catch { return reply.code(404).send({ ok: false, error: { message: "Not found" } }); }
  });

  app.post<{ Params: { projectId: string } }>("/api/projects/:projectId/workspace/mkdir", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    try { return workspaceMkdir(root, (request.body ?? {}) as CompatRecord); }
    catch { return reply.code(500).send({ ok: false, error: { message: "mkdir failed" } }); }
  });

  app.post<{ Params: { projectId: string } }>("/api/projects/:projectId/workspace/move", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    try { return workspaceMove(root, (request.body ?? {}) as CompatRecord); }
    catch { return reply.code(500).send({ ok: false, error: { message: "Move failed" } }); }
  });

  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/workspace/download", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    const rel = String((request.query as CompatRecord).path ?? "");
    try {
      const file = safeJoin(root, rel);
      const content = fs.readFileSync(file);
      const mimeType = rel.endsWith(".json") ? "application/json" : rel.endsWith(".html") ? "text/html" : "application/octet-stream";
      return reply.type(mimeType).header("Content-Disposition", `attachment; filename="${path.basename(file)}"`).send(content);
    } catch { return reply.code(404).send({ ok: false, error: { message: "File not found" } }); }
  });

    // --- folder browser for inspector scope picker ---
  const NOISY_FOLDERS = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache", ".turbo", "coverage", "__pycache__", ".venv", "vendor", ".gradle", ".idea", ".vscode", ".DS_Store"]);

  app.get("/api/folders/tree", async (request) => {
    const root = openclawWorkspaceRoot();
    const query = request.query as CompatRecord;
    const rel = String(query.path ?? "");
    const showHidden = query.showHidden === "true";
    try {
      const dir = rel ? safeJoin(root, rel) : root;
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .filter((e) => showHidden || !NOISY_FOLDERS.has(e.name))
        .filter((e) => showHidden || !e.name.startsWith("."))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => {
          const entryPath = rel ? `${rel}/${e.name}` : e.name;
          const absPath = path.join(dir, e.name);
          const hasGit = fs.existsSync(path.join(absPath, ".git"));
          let gitRoot: string | null = null;
          if (hasGit) gitRoot = absPath;
          else {
            let check = absPath;
            while (check !== root && check !== path.dirname(check)) {
              if (fs.existsSync(path.join(check, ".git"))) { gitRoot = check; break; }
              check = path.dirname(check);
            }
          }
          const existingProject = compatState.projects.find(
            (p: CompatRecord) => !p.deleted && !p.archived && (p.workspaceRoot === absPath || p.repoRoot === absPath)
          );
          let disabledReason: string | null = null;
          try { fs.accessSync(absPath, fs.constants.R_OK); } catch { disabledReason = "Permission denied"; }
          return {
            name: e.name,
            path: entryPath,
            absolutePath: absPath,
            type: "directory" as const,
            hasGit: hasGit || Boolean(gitRoot),
            gitRoot,
            isGitRoot: hasGit,
            isProjectRoot: Boolean(existingProject),
            projectId: existingProject?.id ?? null,
            isSymlink: false,
            disabledReason,
          };
        });
      return { root: { name: path.basename(root), path: "", absolutePath: root, type: "directory" as const }, entries };
    } catch (err) {
      return { root: { name: path.basename(root), path: "", absolutePath: root, type: "directory" as const }, entries: [], error: err instanceof Error ? err.message : "Failed to read directory" };
    }
  });

  // --- global workspace (no project scope) ---
  function globalWorkspaceRoot() {
    // Global workspace means connected OpenClaw workspace, not the Desktop app cwd.
    return openclawWorkspaceRoot();
  }

  app.get("/api/workspace/capabilities", async () => ({
    ...workspaceCapabilities(),
  }));

  app.get("/api/workspace/tree", async (request) => {
    const root = globalWorkspaceRoot();
    const rel = String((request.query as CompatRecord).path ?? "");
    try {
      const dir = safeJoin(root, rel);
      const entries = fs.readdirSync(dir, { withFileTypes: true }).map((entry) => workspaceEntry(root, path.join(dir, entry.name)));
      return { entries };
    } catch { return { entries: [] }; }
  });

  app.get("/api/workspace/stat", async (request, reply) => {
    const root = globalWorkspaceRoot();
    const rel = String((request.query as CompatRecord).path ?? "");
    try { return { entry: workspaceEntry(root, safeJoin(root, rel)) }; }
    catch { return reply.code(404).send({ ok: false, error: { message: "Not found" } }); }
  });

  app.get("/api/workspace/file", async (request, reply) => {
    const root = globalWorkspaceRoot();
    const rel = String((request.query as CompatRecord).path ?? "");
    try {
      const file = safeJoin(root, rel);
      const content = fs.readFileSync(file, "utf8");
      return { path: rel, content, encoding: "utf-8", file: { path: rel, content, encoding: "utf-8" } };
    } catch { return reply.code(404).send({ ok: false, error: { message: "File not found" } }); }
  });

  app.put("/api/workspace/file", async (request, reply) => {
    const root = globalWorkspaceRoot();
    const body = (request.body ?? {}) as CompatRecord;
    const rel = String(body.path ?? "");
    try {
      const file = safeJoin(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, String(body.content ?? ""), "utf8");
      return { ok: true, path: rel };
    } catch { return reply.code(500).send({ ok: false, error: { message: "Write failed" } }); }
  });

  app.delete("/api/workspace/file", async (request, reply) => {
    const root = globalWorkspaceRoot();
    const rel = String((request.query as CompatRecord).path ?? "");
    try { fs.unlinkSync(safeJoin(root, rel)); return { ok: true }; }
    catch { return reply.code(404).send({ ok: false, error: { message: "Not found" } }); }
  });

  app.post("/api/workspace/mkdir", async (request, reply) => {
    const root = globalWorkspaceRoot();
    const body = (request.body ?? {}) as CompatRecord;
    const rel = String(body.path ?? "");
    try { fs.mkdirSync(safeJoin(root, rel), { recursive: true }); return { ok: true }; }
    catch { return reply.code(500).send({ ok: false, error: { message: "mkdir failed" } }); }
  });

  app.post("/api/workspace/move", async (request, reply) => {
    const root = globalWorkspaceRoot();
    const body = (request.body ?? {}) as CompatRecord;
    try { fs.renameSync(safeJoin(root, String(body.fromPath ?? "")), safeJoin(root, String(body.toPath ?? ""))); return { ok: true }; }
    catch { return reply.code(500).send({ ok: false, error: { message: "Move failed" } }); }
  });

  app.get("/api/workspace/download", async (request, reply) => {
    const root = globalWorkspaceRoot();
    const rel = String((request.query as CompatRecord).path ?? "");
    try {
      const file = safeJoin(root, rel);
      const content = fs.readFileSync(file);
      const mimeType = rel.endsWith(".json") ? "application/json" : rel.endsWith(".html") ? "text/html" : "application/octet-stream";
      return reply.type(mimeType).header("Content-Disposition", `attachment; filename="${path.basename(file)}"`).send(content);
    } catch { return reply.code(404).send({ ok: false, error: { message: "File not found" } }); }
  });

  // --- legacy SSE streams ---
  app.get("/api/stream/cron", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (event: string, payload: CompatRecord) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    // Keep the first line compatible with the desktop smoke test while
    // preserving the structured cron.ready SSE event used by clients.
    reply.raw.write(": cron stream ready\n\n");
    const client = { write };
    cronSseClients.add(client);
    write("cron.ready", { ok: true });
    const unsubscribe = context.gateway.onEvent((gatewayEvent) => {
      if (!gatewayEvent.event.startsWith("cron.")) return;
      const payload = gatewayEvent.payload && typeof gatewayEvent.payload === "object" ? gatewayEvent.payload as CompatRecord : {};
      const type = String(payload.type || gatewayEvent.event);
      write("data", { ...payload, type });
    });
    const interval = setInterval(() => reply.raw.write(":heartbeat\n\n"), 15_000);
    await new Promise<void>((resolve) => {
      request.raw.on("close", () => {
        clearInterval(interval);
        unsubscribe();
        cronSseClients.delete(client);
        resolve();
      });
    });
  });

  app.get<{ Params: { sessionKey: string } }>("/api/stream/chat/:sessionKey", async (request, reply) => {
    const sessionKey = decodeURIComponent(request.params.sessionKey);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(":ok\n\n");
    // Forward patches from the patch bus filtered by sessionKey
    const handler = (patch: { cursor: number; type: string; sessionKey: string | null; payload: unknown }) => {
      if (patch.sessionKey !== sessionKey) return;
      const eventType = patch.type.startsWith("chat.") ? patch.type : "message";
      reply.raw.write(`event: ${eventType}\ndata: ${JSON.stringify(patch.payload)}\n\n`);
    };
    // Use the PatchBus broadcast by wrapping a fake WebSocket-like client
    const clientId = `sse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const originalBroadcast = context.patchBus.broadcast.bind(context.patchBus);
    const wrappedBroadcast = (patch: Parameters<typeof originalBroadcast>[0]) => {
      handler(patch);
      return originalBroadcast(patch);
    };
    // Monkey-patch is fragile; instead, subscribe to the DB poll
    const interval = setInterval(() => {
      // Heartbeat to keep connection alive
      reply.raw.write(":heartbeat\n\n");
    }, 15_000);
    // Listen for patches via a polling approach on the projection events table
    let lastCursor = 0;
    try {
      const latest = context.db.prepare("SELECT MAX(cursor) as c FROM v2_projection_events").get() as { c: number } | undefined;
      lastCursor = latest?.c ?? 0;
    } catch { /* table may not exist yet */ }
    const pollInterval = setInterval(() => {
      try {
        const rows = context.db.prepare(
          "SELECT cursor, session_key, event_type, payload_json, created_at_ms FROM v2_projection_events WHERE cursor > @lastCursor AND session_key = @sessionKey ORDER BY cursor ASC LIMIT 100"
        ).all({ lastCursor, sessionKey }) as Array<{ cursor: number; session_key: string; event_type: string; payload_json: string; created_at_ms: number }>;
        for (const row of rows) {
          const eventType = row.event_type.startsWith("chat.") ? row.event_type : "message";
          const payload = JSON.parse(row.payload_json);
          reply.raw.write(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
          lastCursor = row.cursor;
        }
      } catch { /* ignore poll errors */ }
    }, 500);
    await new Promise<void>((resolve) => {
      request.raw.on("close", () => {
        clearInterval(interval);
        clearInterval(pollInterval);
        resolve();
      });
    });
  });

  // --- commands fallback ---
  app.post<{ Params: { command: string } }>("/api/commands/:command", async (request, reply) => {
    const command = request.params.command;
    const body = (request.body ?? {}) as CompatRecord;
    const input = (body.input ?? body ?? {}) as CompatRecord;

    if (command.startsWith("middleware_chat_fork") && command !== "middleware_chat_fork" && command !== "middleware_chat_fork_history") {
      return reply.code(404).send({ ok: false, error: { message: `Unknown command: ${command}` } });
    }

    switch (command) {
      case "middleware_usage":
        return usageResponse(context, Number(input.days) || 30);
      case "middleware_usage_daily":
        return dailyUsage(context, Number(input.days) || 30);
      case "middleware_models_list":
        return modelsResponse(context, readOCPlatformConfig());
      case "middleware_models_set_default": {
        const modelId = String(input.modelId || input.modelRef || "").trim();
        if (!modelId) return reply.code(400).send({ ok: false, error: { message: "modelId is required" } });
        const cfg = readOCPlatformConfig();
        cfg.agents ??= {}; cfg.agents.defaults ??= {}; cfg.agents.defaults.model ??= {};
        if (typeof cfg.agents.defaults.model === "string") cfg.agents.defaults.model = { primary: cfg.agents.defaults.model };
        cfg.agents.defaults.model.primary = modelId;
        writeOCPlatformConfig(cfg);
        return { ok: true, modelId, ...(await modelsResponse(context, cfg)) };
      }
      case "middleware_models_auth_status":
        return { providers: [], configured: true };
      case "middleware_file_naming_groq_get":
        return fileNamingSettingsPayload(context);
      case "middleware_file_naming_groq_set": {
        const saved = await writeFileNamingGroqSettings(context, input);
        if (!saved.ok) return reply.code(400).send(saved);
        return saved;
      }
      case "middleware_file_naming_groq_remove":
        return removeFileNamingGroqSettings(context);
      case "middleware_voice_settings_get":
        return voiceSettingsPayload();
      case "middleware_voice_settings_set":
        return writeVoiceSettings(input);
      case "middleware_onboarding_provider_details": {
        const providerId = String(input.providerId || "").trim();
        if (!providerId) return reply.code(400).send({ ok: false, error: { message: "providerId is required" } });
        return providerDetails(providerId);
      }
      case "middleware_onboarding_provider_submit": {
        const saved = saveProviderCredentials(input);
        if (!saved.ok) return reply.code(400).send(saved);
        return saved;
      }
      case "middleware_memory_list": {
        const documents = listMemoryDocuments();
        return { documents, files: documents };
      }
      case "middleware_memory_read":
        return readMemoryFile(input);
      case "middleware_memory_write":
        return writeMemoryFile(input);
      case "middleware_memory_store": {
        const stored = storeMemoryEntry(input);
        if (!stored.ok) return reply.code(400).send(stored);
        return stored;
      }
      case "middleware_memory_recall":
        return recallMemoryEntries();
      case "middleware_commands_list":
        return dynamicCommandsList(context, input);
      case "middleware_skills_discover":
        return skillsDiscover(input as Parameters<typeof skillsDiscover>[0]);
      case "middleware_skills_installed_local":
      case "middleware_skills_installed":
        return skillsInstalledLocal(input as Parameters<typeof skillsInstalledLocal>[0]);
      case "middleware_skills_detail":
        return skillsDetail(input as Parameters<typeof skillsDetail>[0]);
      case "middleware_skills_versions":
        return skillsVersions(input as Parameters<typeof skillsVersions>[0]);
      case "middleware_skills_install":
        return installSkill(context, input as Parameters<typeof installSkill>[1]);
      case "middleware_skills_uninstall":
        return uninstallSkill(input as Parameters<typeof uninstallSkill>[0]);
      case "middleware_skills_toggle":
        return toggleSkill(input as Parameters<typeof toggleSkill>[0]);
      case "middleware_skills_enabled_map":
        return getSkillEnabledMap();
      case "middleware_skills_active":
        return getActiveSkills();
      case "middleware_autonaming_quick": {
        const name = await groqFileNameFromPrompt(input.text || input.prompt || "New Chat", context);
        return { name, title: name };
      }
      case "middleware_chat_history": {
        const sessionKey = String(input.sessionKey ?? "");
        if (!sessionKey) return reply.code(400).send({ ok: false, error: { message: "sessionKey required" } });
        try {
          let rows = context.messages.listMessages(sessionKey, { limit: 1000 });
          if (rows.length === 0) {
            const projected = await ensureGatewayHistoryProjected(context, sessionKey, { limit: 1000 });
            rows = context.messages.listMessages(projected.sessionKey, { limit: 1000 });
          }
          return { messages: rows.map((r) => r.data) };
        } catch { return { messages: [] }; }
      }
      case "middleware_chat_model_set": {
        const sessionKey = String(input.sessionKey ?? "");
        const modelId = String(input.modelId ?? "");
        if (!sessionKey || !modelId) return reply.code(400).send({ ok: false, error: { message: "sessionKey and modelId required" } });
        try {
          await context.gateway.request("sessions.patch", { key: sessionKey, model: modelId });
          return { ok: true };
        } catch (error) { return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Model switch failed" } }); }
      }
      case "middleware_chat_send": {
        const sessionKey = String(input.sessionKey ?? "");
        const message = String(input.message ?? input.text ?? input.prompt ?? "");
        if (!sessionKey || !message.trim()) return reply.code(400).send({ ok: false, error: { message: "sessionKey and message required" } });
        try {
          const timeoutMs = Number(input.timeoutMs ?? 130_000);
          const result = await context.gateway.request("chat.send", {
            sessionKey,
            message,
            idempotencyKey: String(input.idempotencyKey ?? `compat:${sessionKey}:${crypto.randomUUID()}`),
            timeoutMs,
            ...(typeof input.model === "string" ? { model: input.model } : {}),
            ...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
          }, timeoutMs);
          return { ok: true, result, sessionKey };
        } catch (error) {
          return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Chat send failed" } });
        }
      }
      case "middleware_chat_regenerate": {
        const sessionKey = String(input.sessionKey ?? "");
        if (!sessionKey) return reply.code(400).send({ ok: false, error: { message: "sessionKey required" } });
        const rows = context.messages.listMessages(sessionKey, { limit: 1000 });
        const lastUser = [...rows].reverse().find((row) => row.data?.role === "user");
        const message = String(lastUser?.data?.text ?? "").trim();
        if (!message) return reply.code(404).send({ ok: false, error: { message: "No user message available to regenerate" } });
        try {
          const result = await context.gateway.request("chat.send", { sessionKey, message, timeoutMs: input.timeoutMs ?? 130_000 }, Number(input.timeoutMs ?? 130_000));
          return { ok: true, result, sessionKey };
        } catch (error) {
          return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Regenerate failed" } });
        }
      }
      case "middleware_chat_select_edit_branch": {
        const branchSessionKey = String(input.branchSessionKey ?? input.sessionKey ?? "");
        const branch = compatState.branches.find((item) => item.branchSessionKey === branchSessionKey || item.sessionKey === branchSessionKey) ?? null;
        if (branch) branch.selectedAt = nowIso();
        saveCompatCollection(context, "branches");
        return { ok: true, branch, branchSessionKey };
      }
      case "middleware_branch_list": {
        const sourceSessionKey = input.sourceSessionKey ? String(input.sourceSessionKey) : null;
        const branches = compatState.branches.filter((branch) => !sourceSessionKey || branch.sourceSessionKey === sourceSessionKey);
        return { branches };
      }
      case "middleware_pins_list": {
        const sessionKey = String(input.sessionKey ?? "global");
        const pins = compatState.pins.filter((pin) => pin.sessionKey === sessionKey);
        return { pins };
      }
      case "middleware_pins_add": {
        const sessionKey = String(input.sessionKey ?? "global");
        const messageId = String(input.messageId ?? input.id ?? "");
        if (!messageId) return reply.code(400).send({ ok: false, error: { message: "messageId required" } });
        const existing = compatState.pins.find((pin) => pin.sessionKey === sessionKey && pin.messageId === messageId);
        const pin = existing ?? { id: id("pin"), sessionKey, messageId, createdAt: nowIso() };
        Object.assign(pin, input, { sessionKey, messageId, pinnedAt: input.pinnedAt ?? pin.pinnedAt ?? nowIso() });
        if (!existing) compatState.pins.push(pin);
        saveCompatCollection(context, "pins");
        return { ok: true, pin };
      }
      case "middleware_pins_remove": {
        const sessionKey = String(input.sessionKey ?? "global");
        const messageId = String(input.messageId ?? input.id ?? "");
        const before = compatState.pins.length;
        compatState.pins = compatState.pins.filter((pin) => !(pin.sessionKey === sessionKey && (pin.messageId === messageId || pin.id === messageId)));
        if (before !== compatState.pins.length) saveCompatCollection(context, "pins");
        return { ok: true, removed: before - compatState.pins.length };
      }
      case "middleware_version_info": {
        const version = readPackageVersion(path.join(process.cwd(), "package.json"));
        const openclawVersion = readOpenClawVersion() ?? version;
        return { ok: true, version, middleware: version, openclawVersion, nodeVersion: process.version, node: process.version, service: "openclaw-middleware" };
      }
      case "middleware_profiles_list": {
        const gateway = await connectGatewayForStatus(context);
        return { profiles: [{ id: "desktop_middleware", name: "Desktop Middleware", mode: "local", gatewayUrl: gateway.gatewayUrl ?? context.config.openclawGatewayUrl, workspaceRoot: workspaceRoot(), isDefault: true, status: gateway.connected ? "connected" : "disconnected", error: gateway.lastError ?? null }] };
      }
      case "middleware_pty_spawn_workspace": {
        const terminal = await spawnTerminal(safeTerminalCwd(input.cwd), input);
        return { ...terminal, ptyId: terminal.terminalId };
      }
      case "middleware_voice_transcribe":
        return transcribeVoice(input);
      case "middleware_sync_pull_now":
        return { ok: true, skipped: true, reason: "Gateway sync is handled by live bootstrap" };
      case "middleware_openclaw_bot_name_get": {
        const cfg = readOCPlatformConfig();
        const botName = cfg.bot?.name ?? "OpenClaw";
        return { botName, name: botName };
      }
      case "middleware_openclaw_bot_name_set": {
        const cfg = readOCPlatformConfig();
        const botName = String(input.botName ?? input.name ?? "OpenClaw");
        cfg.bot ??= {};
        cfg.bot.name = botName;
        writeOCPlatformConfig(cfg);
        return { ok: true, botName, name: botName };
      }
      case "middleware_onboarding_core":
        return { ok: true, core: { configured: true }, state: { completed: true } };
      case "middleware_onboarding_flow":
        return { ok: true, flow: { completed: true, step: "done" }, state: { completed: true } };
      case "middleware_onboarding_providers":
        return { ok: true, providers: voiceOptions.filter((option) => option.provider !== "auto").map((option) => ({ id: option.provider, name: option.label.split(" - ")[0] })) };
      case "middleware_onboarding_model_contract":
        return { ok: true, contract: { providerId: input.providerId ?? "custom", fields: [] } };
      case "middleware_onboarding_model_submit":
        return { ok: true, modelId: input.modelId ?? input.model ?? null };
      case "middleware_onboarding_sign_out":
        return { ok: true };
      case "middleware_onboarding_delete_account":
        return reply.code(501).send({ ok: false, error: { message: "Account deletion is not supported by desktop middleware" } });
      case "middleware_connect_status": {
        const gateway = await connectGatewayForStatus(context);
        return {
          gatewayConfigured: true,
          gatewayUrl: gateway.gatewayUrl ?? context.config.openclawGatewayUrl,
          gatewayToken: "configured",
          hasConnection: gateway.connected,
          hasIdentity: true,
          status: gateway.connected ? "connected" : "disconnected",
          error: gateway.lastError ?? null,
        };
      }
      case "middleware_connect_test": {
        const startedAt = Date.now();
        const gateway = await connectGatewayForStatus(context, { wait: true, timeoutMs: 5_000 });
        return { ready: gateway.connected, latencyMs: Date.now() - startedAt, error: gateway.lastError ?? null };
      }
      case "middleware_connect_reset":
      case "middleware_connect_disconnect":
      case "middleware_connect_delete_all":
        return { ok: true };
      case "middleware_connect_bootstrap": {
        const gateway = await connectGatewayForStatus(context);
        return { ok: true, gateway, openclaw: { connected: gateway.connected } };
      }
      case "middleware_exec_approval_resolve": {
        const approvalId = String(input.approvalId ?? input.id ?? "").trim();
        const decision = String(input.decision ?? "deny");
        if (!approvalId) return reply.code(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "approvalId required" } });
        try {
          await context.gateway.request("exec.approval.resolve", { approvalId, decision });
          return { ok: true };
        } catch (error) {
          if (isMissingApprovalError(error)) return reply.code(404).send({ ok: false, error: { code: "APPROVAL_NOT_FOUND", message: "Approval request not found", details: { approvalId } } });
          return reply.code(500).send({ ok: false, error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Approval resolution failed" } });
        }
      }
      case "middleware_git_commit_details": {
        const repoRoot = String(input.repoRoot ?? input.repoPath ?? "");
        const root = input.projectId ? projectRoot(String(input.projectId)) : repoRoot;
        const hash = String(input.hash ?? input.commit ?? "");
        if (!root || !hash) return { diff: "" };
        return gitCommitDetails(root, hash);
      }
      case "middleware_memory_list": {
        const documents = listMemoryDocuments();
        return { documents, files: documents };
      }
      case "middleware_memory_read": {
        const filePath = safeWorkspaceFilePath(input.path, "memory/notes.md");
        if (!fs.existsSync(filePath)) return { content: "" };
        if (!fs.statSync(filePath).isFile()) {
          return reply.code(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "Memory path is a directory" } });
        }
        return { content: fs.readFileSync(filePath, "utf8") };
      }
      case "middleware_memory_write": {
        const filePath = safeWorkspaceFilePath(input.path, "memory/notes.md");
        fs.writeFileSync(filePath, String(input.content ?? ""), "utf8");
        return { ok: true, path: input.path };
      }
      case "middleware_memory_store": {
        const today = new Date().toISOString().slice(0, 10);
        const relativePath = `memory/${today}.md`;
        const filePath = safeWorkspaceFilePath(relativePath);
        fs.appendFileSync(filePath, `\n- ${String(input.content ?? input.text ?? "")}\n`, "utf8");
        return { ok: true, path: relativePath };
      }
      case "middleware_memory_recall": {
        const entries = searchMemoryDocuments(input.query ?? input.text ?? "");
        return { entries, results: entries };
      }
      case "middleware_message_feedback":
      case "middleware_message_feedback_delete":
        return { ok: true };
      case "middleware_spaces_list":
        return {
          spaces: spacesForResponse(compatState.spaces.filter((space) => {
            const archived = input.archived === true || input.archived === "true";
            return archived ? Boolean(space.archived) && notDeleted(space) : visibleSpace(space);
          })),
          activeSpaceId: activeSpaceId(),
        };
      case "middleware_spaces_create": {
        const timestamp = nowIso();
        const iconImage = spaceIconImageFrom(input);
        const iconEmoji = spaceIconEmojiFrom(input);
        const space = {
          id: id("space"),
          name: input.name || "New Space",
          ...(iconEmoji ? { iconEmoji } : {}),
          ...(iconImage ? { iconImage } : {}),
          archived: false,
          deleted: false,
          sortOrder: compatState.spaces.length,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        compatState.spaces.push(space);
        compatState.activeSpaceId = space.id;
        saveCompatState(context);
        return { space: spaceForResponse(space), activeSpaceId: space.id };
      }
      case "middleware_spaces_update": {
        const spaceId = String(input.spaceId ?? "");
        if (!spaceId) return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
        const patch = sanitizeSpacePatch(input);
        const space = patchById(compatState.spaces, spaceId, patch);
        if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
        if (space.archived && compatState.activeSpaceId === space.id) {
          compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
        }
        saveCompatState(context);
        return { space: spaceForResponse(space), activeSpaceId: activeSpaceId() };
      }
      case "middleware_spaces_rename": {
        const spaceId = String(input.spaceId ?? "");
        if (!spaceId) return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
        const space = patchById(compatState.spaces, spaceId, { name: input.name || "New Space" });
        if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
        saveCompatCollection(context, "spaces");
        return { space: spaceForResponse(space), activeSpaceId: activeSpaceId() };
      }
      case "middleware_spaces_archive": {
        const spaceId = String(input.spaceId ?? "");
        if (!spaceId) return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
        const archived = input.archived ?? true;
        if (spaceId === DEFAULT_SPACE_ID) {
          const existing = compatState.spaces.find((item) => item.id === DEFAULT_SPACE_ID) ?? {};
          const space = patchById(compatState.spaces, DEFAULT_SPACE_ID, normalizeDefaultSpace(existing)) ?? normalizeDefaultSpace(existing);
          saveCompatState(context);
          return { ok: true, activeSpaceId: activeSpaceId(), space, archived: false };
        }
        const space = patchById(compatState.spaces, spaceId, { archived });
        if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
        if (archived) archiveChatsForSpace(spaceId);
        else restoreChatsForSpace(spaceId);
        if (archived && compatState.activeSpaceId === space.id) {
          compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
        }
        saveCompatState(context);
        return { ok: true, activeSpaceId: activeSpaceId(), space, archived };
      }
      case "middleware_spaces_switch": {
        const spaceId = String(input.spaceId ?? "");
        if (!spaceId) return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
        const space = compatState.spaces.find((item) => item.id === spaceId && visibleSpace(item));
        if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
        space.updatedAt = nowIso();
        compatState.activeSpaceId = space.id;
        saveCompatState(context);
        return { activeSpaceId: space.id, space };
      }
      case "middleware_spaces_delete": {
        const spaceId = String(input.spaceId ?? "");
        if (!spaceId) return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
        return deleteCompatSpace(context, spaceId);
      }
      case "middleware_sessions_create": {
        const sessionKey = String(input.sessionKey || `agent:main:desktop:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
        const timestamp = nowIso();
        const displayName = await groqFileNameFromPrompt(input.label || "New Chat", context);
        try {
          await context.gateway.request("sessions.create", {
            key: sessionKey,
            agentId: input.agentId || "main",
            label: gatewaySessionLabel(displayName, sessionKey),
          });
        } catch { /* session may already exist */ }
        const session = {
          id: id("session"),
          sessionKey,
          spaceId: sessionWriteSpaceId(input),
          projectId: input.projectId || null,
          topicId: input.topicId || null,
          agentId: input.agentId || "main",
          label: displayName,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        compatState.sessions.push(session);
        saveCompatCollection(context, "sessions");
        return { session };
      }
      case "middleware_chats_delete": {
        const chatId = String(input.chatId ?? "");
        if (!chatId) return reply.code(400).send({ ok: false, error: { message: "chatId required" } });
        return deleteCompatChat(context, chatId);
      }
      case "middleware_chats_create": {
        const sessionKey = String(input.sessionKey || `agent:main:desktop:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
        const timestamp = nowIso();
        // Use the instant local fallback name so chat creation (and therefore
        // the optimistic first-message render on the client) is not blocked by
        // a Groq labeling HTTP call (up to 2.5s). The client auto-renames the
        // chat with a better title immediately after the first send, so the
        // final user-visible name is unchanged.
        const displayName = fallbackFileNameFromPrompt(input.name || "New Chat");
        try {
          await context.gateway.request("sessions.create", {
            key: sessionKey,
            agentId: input.agentId || "main",
            label: gatewaySessionLabel(displayName, sessionKey),
          });
        } catch { /* session may already exist */ }
        const writeSpaceId = sessionWriteSpaceId(input);
        const chat = {
          // Honor a client-provided chat id so the UI can render the optimistic
          // first message before this round-trip completes (no reconciliation).
          id: String(input.chatId || id("chat")),
          name: displayName,
          sessionKey,
          spaceId: writeSpaceId,
          agentId: input.agentId || "main",
          archived: false,
          pinned: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastActiveAt: timestamp,
        };
        const session = {
          id: id("session"),
          key: sessionKey,
          sessionKey,
          spaceId: writeSpaceId,
          projectId: input.projectId || null,
          topicId: input.topicId || null,
          agentId: input.agentId || "main",
          label: displayName,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        compatState.chats.push(chat);
        compatState.sessions.push(session);
        saveCompatState(context);
        return { chat, session };
      }
      case "middleware_chat_fork":
        return createChatFork(context, input).catch((error) => reply.code(error instanceof HttpError ? error.statusCode : 500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Fork failed" } }));
      case "middleware_chat_fork_history":
        return chatForkHistory(context, input).catch((error) => reply.code(error instanceof HttpError ? error.statusCode : 500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Fork history failed" } }));
      case "middleware_chat_edit_last_preview":
        return createEditPreview(context, input).catch((error) => reply.code(error instanceof HttpError ? error.statusCode : 500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Edit preview failed" } }));
      case "middleware_chat_stop": {
        const sk = String(input.sessionKey ?? "");
        if (!sk) return reply.code(400).send({ ok: false, error: { message: "sessionKey required" } });
        try { await context.gateway.request("sessions.abort", { sessionKey: sk }); } catch { /* may not be running */ }
        return { ok: true };
      }
      case "middleware_cron_list":
      case "middleware_cron_list_jobs":
        return cronListJobsGateway(context).catch(() => cronListJobs());
      case "middleware_cron_get_job":
        return cronGetJobGateway(context, input.jobId || input.id).catch(() => ({ job: findCronJob(input.jobId || input.id) }));
      case "middleware_cron_create_job": {
        try { return await cronCreateJobGateway(context, input); }
        catch { return cronCreateJob(input); }
      }
      case "middleware_cron_update_job": {
        try {
          const result = await cronUpdateJobGateway(context, input);
          if (!result) return reply.code(404).send({ ok: false, error: { message: "Cron job not found" } });
          return result;
        } catch (error) {
          const result = cronUpdateJob(input);
          if (!result) return reply.code(cronCommandErrorStatus(error)).send({ ok: false, error: { message: error instanceof Error ? error.message : "Cron job update failed" } });
          emitCronEvent({ type: "cron.job.updated", jobId: result.job.jobId, job: result.job, timestamp: nowIso() });
          return result;
        }
      }
      case "middleware_cron_delete_job": {
        try {
          const deleted = await cronDeleteJobGateway(context, input);
          if (!deleted) return reply.code(404).send({ ok: false, error: { message: "Cron job not found" } });
          return { ok: true, deleted: true, jobId: input.jobId || input.id };
        } catch (error) {
          const deleted = cronDeleteJob(input);
          if (!deleted) return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Cron job delete failed" } });
          emitCronEvent({ type: "cron.job.deleted", jobId: String(input.jobId || input.id || ""), timestamp: nowIso() });
          return { ok: true, deleted: true, jobId: input.jobId || input.id };
        }
      }
      case "middleware_cron_run_job":
        return cronRunJobGateway(context, input).catch((error) => reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Cron job run failed" } }));
      case "middleware_cron_pause_job":
        return cronUpdateJobGateway(context, { ...input, enabled: !Boolean(input.paused) }).catch((error) => reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Cron job pause failed" } }));
      case "middleware_cron_job_status":
        return context.gateway.request("cron.status", {}, 30_000);
      case "middleware_cron_list_runs":
        return cronListRunsGateway(context, input).catch(() => cronListRuns(input));
      case "middleware_cron_recent_activity":
        return cronRecentActivityGateway(context, input).catch(() => cronRecentActivity(input));
      case "middleware_cron_reset_fixtures":
        compatState.cronJobs = [];
        compatState.cronRuns = [];
        saveCompatCollection(context, "cronJobs");
        saveCompatCollection(context, "cronRuns");
        emitCronEvent({ type: "cron.fixtures.reset", timestamp: nowIso() });
        return { ok: true };
      case "middleware_cron_job_conversation": {
        const run = compatState.cronRuns.find((item) => item.jobId === input.jobId || item.runId === input.runId || item.id === input.runId);
        if (!run?.sessionKey) return { messages: [], lastRun: run ?? null };
        try {
          const history = await context.gateway.request("chat.history", { sessionKey: run.sessionKey }, 30_000) as CompatRecord;
          return { ...(history || {}), messages: history?.messages ?? [], lastRun: run };
        } catch {
          return { messages: [], lastRun: run };
        }
      }
      default:
        return reply.code(501).send({ ok: false, error: { message: `Unsupported middleware command: ${command}` } });
    }
  });

  // --- migrations ---
  app.get("/api/migration/telegram/scan", async (request) => scanTelegramSessions(context, (request.query ?? {}) as CompatRecord));
  app.post("/api/migration/telegram/import", async (request) => importTelegramSessions(context, ((request.body ?? {}) as CompatRecord).input ?? (request.body ?? {}) as CompatRecord));
  app.get("/api/migration/discord/scan", async (request) => scanDiscordSessions(context, (request.query ?? {}) as CompatRecord));
  app.post("/api/migration/discord/import", async (request) => importDiscordSessions(context, ((request.body ?? {}) as CompatRecord).input ?? (request.body ?? {}) as CompatRecord));
  app.post("/api/migration/v1-sqlite/import", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    return migrateV1SqliteToV2(context, body.sourcePath);
  });

  // --- self-update ---
  app.get("/api/middleware/update/status", async (request) => readMiddlewareUpdateStatus((request.query ?? {}) as MiddlewareUpdateInput));
  app.get("/api/middleware/update/branches", async () => listMiddlewareUpdateBranches());
  app.post("/api/middleware/update", async (request) => startMiddlewareUpdate(((request.body ?? {}) as CompatRecord).input ?? (request.body ?? {}) as MiddlewareUpdateInput));

  // --- terminal spawn ---
  app.post("/api/terminal/spawn", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const cwd = String(body.cwd ?? body.workspaceRoot ?? process.env.WORKSPACE_ROOT ?? path.join(os.homedir(), ".openclaw", "workspace"));
    return spawnTerminal(cwd, body);
  });
  app.post<{ Params: { projectId: string } }>("/api/projects/:projectId/terminal/spawn", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    return spawnTerminal(root, (request.body ?? {}) as CompatRecord);
  });
  app.post<{ Params: { ptyId: string } }>("/api/terminal/:ptyId/write", async (request, reply) => {
    const term = getTerminal(request.params.ptyId);
    if (!term) return reply.code(404).send({ ok: false, error: { message: "Terminal not found" } });
    const body = (request.body ?? {}) as CompatRecord;
    term.proc.write(String(body.data ?? ""));
    return { ok: true };
  });
  app.post<{ Params: { ptyId: string } }>("/api/terminal/:ptyId/resize", async (request) => {
    const term = getTerminal(request.params.ptyId);
    if (!term) return { ok: true };
    const body = (request.body ?? {}) as CompatRecord;
    term.proc.resize(Number(body.cols ?? 80), Number(body.rows ?? 24));
    return { ok: true };
  });
  app.post<{ Params: { ptyId: string } }>("/api/terminal/:ptyId/kill", async (request) => {
    const term = getTerminal(request.params.ptyId);
    if (term) closeCompatTerminal(term, "kill");
    return { ok: true };
  });

  // --- terminal stream (SSE) ---
  app.get<{ Params: { ptyId: string } }>("/api/terminal/:ptyId/stream", async (request, reply) => {
    const term = getTerminal(request.params.ptyId);
    if (!term) return reply.code(404).send({ ok: false, error: { message: "Terminal not found" } });
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    for (const data of term.buffer) {
      reply.raw.write(`event: data\ndata: ${JSON.stringify({ type: "terminal.data", terminalId: term.id, data })}\n\n`);
    }
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      term.listeners.delete(listener);
    };
    const finish = () => {
      cleanup();
      if (!reply.raw.destroyed) reply.raw.end();
    };
    const listener = (event: string, payload: CompatRecord) => {
      if (closed || reply.raw.destroyed) return;
      const sseEvent = event === "error" ? "error_event" : event;
      reply.raw.write(`event: ${sseEvent}\ndata: ${JSON.stringify(payload)}\n\n`);
      if (event === "exit" || event === "error") finish();
    };
    term.listeners.add(listener);
    request.raw.on("close", cleanup);
  });

  // --- terminal WebSocket ---
  app.get<{ Params: { ptyId: string } }>("/api/terminal/:ptyId/ws", { websocket: true }, async (socket, request) => {
    const term = getTerminal(request.params.ptyId);
    if (!term) { socket.close(); return; }
    for (const data of term.buffer) {
      socket.send(JSON.stringify({ event: "data", data: { type: "terminal.data", terminalId: term.id, data } }));
    }
    const listener = (event: string, payload: CompatRecord) => {
      if (socket.readyState === 1) socket.send(JSON.stringify({ event, data: payload }));
    };
    term.listeners.add(listener);
    socket.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; data?: string; cols?: number; rows?: number };
        if (msg.type === "write" && typeof msg.data === "string") term.proc.write(msg.data);
        if (msg.type === "resize" && msg.cols && msg.rows) term.proc.resize(msg.cols, msg.rows);
        if (msg.type === "kill") closeCompatTerminal(term, "kill");
      } catch {}
    });
    socket.on("close", () => term.listeners.delete(listener));
  });

  // --- pairing ---
  app.post("/pairing/claim", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const code = String(body.code ?? "").trim().toUpperCase();
    const expectedCode = String(context.config.pairingCode ?? process.env.MIDDLEWARE_PAIRING_CODE ?? "").trim().toUpperCase();
    if (!expectedCode || code !== expectedCode) {
      return reply.code(403).send({ ok: false, error: { code: "INVALID_PAIRING_CODE", message: "Invalid pairing code" } });
    }
    const headerValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
    const forwardedProto = headerValue(request.headers["x-forwarded-proto"])?.split(",")[0]?.trim();
    const forwardedHost = headerValue(request.headers["x-forwarded-host"])?.split(",")[0]?.trim();
    const host = forwardedHost || headerValue(request.headers.host) || `127.0.0.1:${context.config.port}`;
    const hostname = String(host).replace(/^\[([^\]]+)\].*$/, "$1").replace(/:\d+$/, "");
    const isPlainHttpHost = hostname === "localhost" || hostname === "127.0.0.1" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
    const proto = forwardedProto || (isPlainHttpHost ? "http" : "https");
    const url = `${proto}://${host}`;
    return {
      ok: true,
      url,
      token: context.config.middlewareToken ?? process.env.MIDDLEWARE_TOKEN ?? "",
      mode: "remote",
      openclaw: { connected: context.gateway.status().connected },
    };
  });

  app.get("/pairing/local", async () => {
    const gateway = context.gateway.status();
    return { ok: true, url: `http://127.0.0.1:${context.config.port}`, token: context.config.middlewareToken ?? "", mode: "local", openclaw: { connected: gateway.connected } };
  });
}
