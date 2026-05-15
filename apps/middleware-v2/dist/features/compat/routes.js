import { execFileSync, spawn as spawnChild } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { getActiveSkills, getSkillEnabledMap, installSkill, skillsDetail, skillsDiscover, skillsInstalledLocal, skillsVersions, toggleSkill, uninstallSkill, } from "../skills/service.js";
import { fromJson, toJson } from "../../db/json.js";
import { HttpError } from "../../lib/errors.js";
const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const shortSessionId = (sessionKey) => (sessionKey.split(":").pop() || sessionKey).replace(/[^a-zA-Z0-9_-]/g, "").slice(-8) || Date.now().toString(36);
const gatewaySessionLabel = (label, sessionKey) => {
    const base = String(label || "New Chat").replace(/\s+/g, " ").trim().slice(0, 60) || "New Chat";
    return `${base} · ${shortSessionId(sessionKey)}`;
};
const cronSseClients = new Set();
function emitCronEvent(event) {
    for (const client of [...cronSseClients]) {
        try {
            client.write("data", event);
        }
        catch { /* client closed */ }
    }
}
function isoFromMs(value, fallbackMs = Date.now()) {
    const ms = typeof value === "number" && Number.isFinite(value) ? value : fallbackMs;
    return new Date(ms).toISOString();
}
function everyMsFromSchedule(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return Math.max(1, Math.floor(value));
    const text = String(value || "").trim().toLowerCase();
    const match = text.match(/^(\d+)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
    if (!match)
        return 60_000;
    const amount = Math.max(1, Number(match[1]));
    const unit = match[2] || "m";
    if (unit === "ms")
        return amount;
    if (["s", "sec", "secs", "second", "seconds"].includes(unit))
        return amount * 1_000;
    if (["h", "hr", "hrs", "hour", "hours"].includes(unit))
        return amount * 3_600_000;
    if (["d", "day", "days"].includes(unit))
        return amount * 86_400_000;
    return amount * 60_000;
}
function scheduleToGateway(input, existing) {
    const type = String(input.scheduleType ?? existing?.scheduleType ?? "cron");
    const schedule = input.schedule ?? existing?.schedule ?? "0 * * * *";
    if (type === "at")
        return { kind: "at", at: new Date(String(schedule)).toISOString() };
    if (type === "every")
        return { kind: "every", everyMs: everyMsFromSchedule(schedule) };
    return { kind: "cron", expr: String(schedule || "0 * * * *"), tz: input.timezone ?? existing?.timezone ?? "Asia/Kolkata" };
}
function gatewayScheduleToCompat(schedule) {
    if (!schedule || typeof schedule !== "object")
        return { scheduleType: "cron", schedule: "0 * * * *", timezone: "Asia/Kolkata" };
    if (schedule.kind === "at")
        return { scheduleType: "at", schedule: String(schedule.at || ""), timezone: null };
    if (schedule.kind === "every") {
        const everyMs = Number(schedule.everyMs || 0);
        const minutes = everyMs > 0 ? Math.max(1, Math.floor(everyMs / 60_000)) : 1;
        return { scheduleType: "every", schedule: `${minutes}m`, timezone: null };
    }
    return { scheduleType: "cron", schedule: String(schedule.expr || "0 * * * *"), timezone: schedule.tz ?? "Asia/Kolkata" };
}
function gatewaySessionToCompat(job) {
    const target = String(job.sessionTarget ?? "isolated");
    if (target.startsWith("session:"))
        return target.slice("session:".length);
    return target;
}
function gatewayRunToCompat(run, job) {
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
function cronEventFromRun(run, job) {
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
function gatewayJobToCompat(job, lastRun) {
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
function compatJobToGateway(input, existing) {
    const message = String(input.message ?? input.task ?? existing?.message ?? existing?.task ?? "").trim();
    const model = input.model ?? existing?.model;
    const session = String(input.session ?? existing?.session ?? "isolated");
    const deliveryMode = input.deliveryMode ?? existing?.deliveryMode;
    const delivery = deliveryMode ? {
        mode: deliveryMode,
        channel: input.deliveryChannel ?? existing?.deliveryChannel,
        to: input.deliveryTo ?? existing?.deliveryTo,
    } : undefined;
    const payload = { kind: "agentTurn", message };
    if (model)
        payload.model = model;
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
    spaces: [],
    activeSpaceId: null,
    chats: [],
    projects: [],
    topics: [],
    sessions: [],
    cronJobs: [],
    cronRuns: [],
    terminals: new Map(),
    loadedDbPath: null,
};
const DEFAULT_SPACE_ID = "space_default";
const DEFAULT_SPACE_NAME = "My Workspace";
const compatCollections = ["spaces", "chats", "projects", "topics", "sessions", "cronJobs", "cronRuns"];
function loadCompatState(context) {
    if (compatState.loadedDbPath === context.config.databasePath)
        return;
    for (const collection of compatCollections)
        compatState[collection] = [];
    compatState.activeSpaceId = null;
    const rows = context.db.prepare("SELECT key, data_json FROM v2_compat_state").all();
    const byKey = new Map(rows.map((row) => [row.key, fromJson(row.data_json)]));
    for (const collection of compatCollections) {
        const value = byKey.get(collection);
        if (Array.isArray(value))
            compatState[collection] = value;
    }
    const active = byKey.get("activeSpaceId");
    if (typeof active === "string")
        compatState.activeSpaceId = active;
    let changed = false;
    compatState.spaces = compatState.spaces.map((space) => {
        if (space.id !== DEFAULT_SPACE_ID)
            return space;
        if (typeof space.name === "string" && space.name.trim() && space.name !== "Default")
            return space;
        changed = true;
        return { ...space, name: DEFAULT_SPACE_NAME, updatedAt: nowIso() };
    });
    compatState.loadedDbPath = context.config.databasePath;
    if (changed)
        saveCompatState(context);
}
function saveCompatState(context) {
    const save = context.db.prepare(`
    INSERT INTO v2_compat_state(key, data_json, updated_at_ms)
    VALUES (@key, @dataJson, @updatedAtMs)
    ON CONFLICT(key) DO UPDATE SET
      data_json = excluded.data_json,
      updated_at_ms = excluded.updated_at_ms
  `);
    const timestamp = Date.now();
    const tx = context.db.transaction(() => {
        for (const collection of compatCollections) {
            save.run({ key: collection, dataJson: toJson(compatState[collection]), updatedAtMs: timestamp });
        }
        save.run({ key: "activeSpaceId", dataJson: toJson(compatState.activeSpaceId), updatedAtMs: timestamp });
    });
    tx();
}
function saveCompatCollection(context, _collection) {
    saveCompatState(context);
}
function defaultV1SqlitePath() {
    return path.join(os.homedir(), ".openclaw", "middleware", "middleware.db");
}
function normalizeV1SqlitePath(raw) {
    const input = typeof raw === "string" && raw.trim() ? raw.trim() : process.env.MIDDLEWARE_V1_DB || defaultV1SqlitePath();
    if (input.endsWith(".sqlite") || input.endsWith(".sqlite3") || input.endsWith(".db"))
        return input;
    if (input.endsWith(".json"))
        return input.replace(/\.json$/, ".sqlite");
    return `${input}.sqlite`;
}
function recordMergeKey(collection, record) {
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
function mergeCompatRecords(collection, incoming) {
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const existing = compatState[collection];
    const index = new Map();
    existing.forEach((record, i) => {
        const key = recordMergeKey(collection, record);
        if (key)
            index.set(key, i);
    });
    for (const record of incoming) {
        if (!record || typeof record !== "object" || Array.isArray(record)) {
            skipped += 1;
            continue;
        }
        const key = recordMergeKey(collection, record);
        if (!key) {
            skipped += 1;
            continue;
        }
        const at = index.get(key);
        if (at === undefined) {
            existing.push(record);
            index.set(key, existing.length - 1);
            imported += 1;
        }
        else {
            existing[at] = { ...existing[at], ...record };
            updated += 1;
        }
    }
    return { imported, updated, skipped };
}
function readV1State(sourcePath) {
    if (!fs.existsSync(sourcePath))
        throw new Error(`v1 SQLite database not found: ${sourcePath}`);
    const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try {
        const row = db.prepare("SELECT value FROM kv_state WHERE key = 'state'").get();
        if (!row?.value)
            throw new Error("v1 SQLite database does not contain kv_state/state");
        const value = JSON.parse(row.value);
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("v1 SQLite state is not an object");
        return value;
    }
    finally {
        db.close();
    }
}
function migrateV1SqliteToV2(context, sourcePathInput) {
    loadCompatState(context);
    const sourcePath = normalizeV1SqlitePath(sourcePathInput);
    const v1State = readV1State(sourcePath);
    const totals = { imported: 0, updated: 0, skipped: 0, spaces: 0, chats: 0, projects: 0, topics: 0, sessions: 0, cronJobs: 0, cronRuns: 0 };
    for (const collection of compatCollections) {
        const incoming = Array.isArray(v1State[collection]) ? v1State[collection] : [];
        const result = mergeCompatRecords(collection, incoming);
        totals.imported += result.imported;
        totals.updated += result.updated;
        totals.skipped += result.skipped;
        totals[collection] = result.imported + result.updated;
    }
    if (typeof v1State.activeSpaceId === "string" && v1State.activeSpaceId.trim())
        compatState.activeSpaceId = v1State.activeSpaceId;
    saveCompatState(context);
    return { ok: true, sourcePath, targetPath: context.config.databasePath, summary: totals };
}
function ensureDefaultSpace() {
    if (compatState.spaces.length > 0)
        return compatState.spaces[0];
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
function activeSpaceId() {
    const current = compatState.spaces.find((space) => space.id === compatState.activeSpaceId && visibleSpace(space));
    if (current)
        return current.id;
    const fallback = compatState.spaces.find(visibleSpace) ?? ensureDefaultSpace();
    compatState.activeSpaceId = String(fallback.id);
    return compatState.activeSpaceId;
}
function stableCompatId(prefix, value) {
    return `${prefix}_${crypto.createHash("sha1").update(value).digest("hex").slice(0, 16)}`;
}
function stringField(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return null;
}
function timestampField(record, keys) {
    return stringField(record, keys) ?? nowIso();
}
function timeMs(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value !== "string" || !value.trim())
        return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function messageTimestampMs(message) {
    const value = message.timestamp ?? message.createdAt ?? message.created_at ?? message.updatedAt ?? message.updated_at;
    if (typeof value === "number" && Number.isFinite(value))
        return value > 0 && value < 1_000_000_000_000 ? value * 1_000 : value;
    if (typeof value === "string" && value.trim()) {
        const numeric = Number(value);
        if (Number.isFinite(numeric))
            return numeric > 0 && numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return 0;
}
function newestTimestamp(...values) {
    const newest = values.reduce((max, value) => Math.max(max, timeMs(value)), 0);
    return newest > 0 ? new Date(newest).toISOString() : nowIso();
}
function chatActivityMs(chat) {
    return Math.max(timeMs(chat.updatedAt), timeMs(chat.lastActiveAt), timeMs(chat.lastMessageAt), timeMs(chat.createdAt));
}
function sortedChatsForResponse(spaceId, archived) {
    return listBySpace(compatState.chats, spaceId)
        .filter((chat) => !isGatewayOnlySyncedChat(chat))
        .filter((chat) => typeof archived === "boolean" ? Boolean(chat.archived) === archived : !chat.archived)
        .sort((a, b) => chatActivityMs(b) - chatActivityMs(a));
}
function latestProjectedMessageActivity(context, sessionKey) {
    const row = context.db.prepare(`
    SELECT data_json, updated_at_ms
    FROM v2_messages
    WHERE session_key = ?
    ORDER BY updated_at_ms DESC, openclaw_seq DESC
    LIMIT 1
  `).get(sessionKey);
    if (!row || !Number.isFinite(Number(row.updated_at_ms)))
        return null;
    const data = fromJson(row.data_json);
    const text = stringField(data, ["text", "content"]);
    const timestampMs = messageTimestampMs(data) || Number(row.updated_at_ms);
    return {
        timestamp: new Date(timestampMs).toISOString(),
        text,
    };
}
function applyProjectedChatActivity(context) {
    let changed = false;
    for (const chat of compatState.chats) {
        if (isGatewayOnlySyncedChat(chat))
            continue;
        const sessionKey = typeof chat.sessionKey === "string" && chat.sessionKey.trim() ? chat.sessionKey.trim() : null;
        if (!sessionKey)
            continue;
        const projected = latestProjectedMessageActivity(context, sessionKey);
        if (!projected)
            continue;
        const timestamp = projected.timestamp;
        if (!timestamp)
            continue;
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
    if (changed)
        saveCompatState(context);
}
function isGatewayOnlySyncedChat(chat) {
    const sessionKey = typeof chat.sessionKey === "string" && chat.sessionKey.trim() ? chat.sessionKey.trim() : null;
    return Boolean(sessionKey && chat.id === stableCompatId("chat", sessionKey));
}
function touchCompatChatActivity(context, input) {
    loadCompatState(context);
    const sessionKey = input.sessionKey.trim();
    if (!sessionKey)
        return;
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
    if (typeof input.lastMessageText === "string")
        chat.lastMessageText = input.lastMessageText;
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
function labelFromGatewaySession(record, sessionKey) {
    const label = stringField(record, ["label", "title", "name", "derivedTitle"])
        ?? stringField(record.lastMessage && typeof record.lastMessage === "object" ? record.lastMessage : {}, ["text", "content"])
        ?? "New Chat";
    const suffix = ` · ${shortSessionId(sessionKey)}`;
    return label.endsWith(suffix) ? label.slice(0, -suffix.length) || "New Chat" : label;
}
function gatewaySessionRows(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return [];
    const rows = payload.sessions;
    return Array.isArray(rows) ? rows.filter((row) => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}
async function syncGatewaySessions(context) {
    try {
        const payload = await context.gateway.request("sessions.list", { limit: 500, includeDerivedTitles: true, includeLastMessage: true }, 10_000);
        const rows = gatewaySessionRows(payload);
        if (rows.length === 0)
            return;
        const beforeCleanup = compatState.chats.length;
        compatState.chats = compatState.chats.filter((chat) => !isGatewayOnlySyncedChat(chat));
        let changed = false;
        if (compatState.chats.length !== beforeCleanup)
            changed = true;
        for (const row of rows) {
            const sessionKey = stringField(row, ["key", "sessionKey"]);
            if (!sessionKey)
                continue;
            const name = labelFromGatewaySession(row, sessionKey);
            const agentId = stringField(row, ["agentId", "agent_id"]) ?? "main";
            const createdAt = timestampField(row, ["createdAt", "created_at"]);
            const chatIndex = compatState.chats.findIndex((chat) => chat.sessionKey === sessionKey);
            if (chatIndex < 0) {
                // Gateway contains every OpenClaw session, including Telegram, cron,
                // and detached task sessions. Do not mirror unknown Gateway sessions
                // into the Desktop chat sidebar; only update chats that already exist
                // in the compat chat collection.
            }
            else {
                const existing = compatState.chats[chatIndex];
                const next = { ...existing, name: existing.name || name, agentId: existing.agentId || agentId };
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
                    projectId: row.projectId ?? null,
                    topicId: row.topicId ?? null,
                    agentId,
                    label: name,
                    createdAt,
                    updatedAt: createdAt,
                });
                changed = true;
            }
            else {
                const existing = compatState.sessions[sessionIndex];
                const next = { ...existing, key: existing.key || sessionKey, sessionKey, agentId: existing.agentId || agentId, label: existing.label || name };
                if (JSON.stringify(next) !== JSON.stringify(existing)) {
                    compatState.sessions[sessionIndex] = next;
                    changed = true;
                }
            }
        }
        if (changed)
            saveCompatState(context);
    }
    catch {
        // Gateway session sync is best-effort; local compat data must still render offline.
    }
}
function notDeleted(record) {
    return !record.deleted;
}
function visibleSpace(record) {
    return notDeleted(record) && !record.archived;
}
function listBySpace(records, spaceId) {
    const filterSpaceId = typeof spaceId === "string" && spaceId.trim() ? spaceId : null;
    return records.filter((record) => notDeleted(record) && (!filterSpaceId || record.spaceId === filterSpaceId));
}
function patchById(records, idValue, patch) {
    const index = records.findIndex((record) => record.id === idValue);
    if (index < 0)
        return null;
    records[index] = { ...records[index], ...patch, updatedAt: nowIso() };
    return records[index];
}
function archiveChatsForSpace(spaceId) {
    const timestamp = nowIso();
    compatState.chats = compatState.chats.map((chat) => {
        if (chat.spaceId !== spaceId)
            return chat;
        if (chat.archived)
            return { ...chat, archivedBySpace: chat.archivedBySpace ?? false };
        return { ...chat, archived: true, archivedBySpace: true, updatedAt: timestamp };
    });
}
function restoreChatsForSpace(spaceId) {
    const timestamp = nowIso();
    compatState.chats = compatState.chats.map((chat) => {
        if (chat.spaceId !== spaceId || !chat.archived)
            return chat;
        if (chat.archivedBySpace === false)
            return chat;
        const { archivedBySpace: _archivedBySpace, ...rest } = chat;
        return { ...rest, archived: false, updatedAt: timestamp };
    });
}
async function deleteCompatChat(context, chatId) {
    const chat = compatState.chats.find((record) => record.id === chatId);
    const sessionKey = typeof chat?.sessionKey === "string" && chat.sessionKey.trim() ? chat.sessionKey.trim() : null;
    compatState.chats = compatState.chats.filter((record) => record.id !== chatId);
    if (sessionKey) {
        compatState.sessions = compatState.sessions.filter((session) => session.sessionKey !== sessionKey && session.key !== sessionKey);
        await Promise.allSettled([
            context.gateway.request("sessions.abort", { sessionKey }, 2_000),
            context.gateway.request("sessions.delete", { key: sessionKey, deleteTranscript: true }, 2_000),
        ]);
        context.db.prepare("DELETE FROM v2_messages WHERE session_key = ?").run(sessionKey);
        context.db.prepare("DELETE FROM v2_runs WHERE session_key = ?").run(sessionKey);
        context.db.prepare("DELETE FROM v2_tool_calls WHERE session_key = ?").run(sessionKey);
        context.db.prepare("DELETE FROM v2_sessions WHERE session_key = ?").run(sessionKey);
        context.db.prepare("DELETE FROM v2_gateway_offsets WHERE session_key = ?").run(sessionKey);
        context.db.prepare("DELETE FROM v2_projection_events WHERE session_key = ?").run(sessionKey);
    }
    saveCompatState(context);
    return { ok: true, chatId, sessionKey };
}
async function deleteCompatSpace(context, spaceId) {
    const deletedChatIds = compatState.chats
        .filter((chat) => chat.spaceId === spaceId)
        .map((chat) => typeof chat.id === "string" ? chat.id : null)
        .filter((chatId) => Boolean(chatId));
    const deletedProjectIds = compatState.projects
        .filter((project) => project.spaceId === spaceId)
        .map((project) => typeof project.id === "string" ? project.id : null)
        .filter((projectId) => Boolean(projectId));
    for (const chatId of deletedChatIds) {
        await deleteCompatChat(context, chatId);
    }
    compatState.spaces = compatState.spaces.filter((space) => space.id !== spaceId);
    compatState.projects = compatState.projects.map((project) => project.spaceId === spaceId ? { ...project, deleted: true, updatedAt: nowIso() } : project);
    if (deletedProjectIds.length > 0) {
        const deletedProjectIdSet = new Set(deletedProjectIds);
        compatState.topics = compatState.topics.map((topic) => deletedProjectIdSet.has(String(topic.projectId)) ? { ...topic, deleted: true, updatedAt: nowIso() } : topic);
        compatState.sessions = compatState.sessions.filter((session) => !deletedProjectIdSet.has(String(session.projectId)));
    }
    if (compatState.activeSpaceId === spaceId) {
        compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
    }
    saveCompatState(context);
    return { ok: true, spaceId, activeSpaceId: activeSpaceId(), deletedChatIds };
}
function projectById(projectId) {
    return compatState.projects.find((project) => project.id === projectId && notDeleted(project)) ?? null;
}
function projectRoot(projectId) {
    const project = projectById(projectId);
    const root = project?.workspaceRoot ?? project?.repoRoot ?? project?.path;
    return typeof root === "string" && root.trim() ? root : null;
}
function safeJoin(root, rel = "") {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, rel || ".");
    if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`))
        throw new Error("Path escapes workspace root");
    return resolved;
}
function git(repo, args) {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, maxBuffer: 64 * 1024 * 1024 }).trim();
}
function tryGit(repo, args) {
    try {
        return git(repo, args);
    }
    catch {
        return null;
    }
}
function fileState(status) {
    if (status.includes("A"))
        return "added";
    if (status.includes("D"))
        return "deleted";
    if (status.includes("R"))
        return "renamed";
    if (status.includes("C"))
        return "copied";
    if (status.includes("?"))
        return "untracked";
    if (status.includes("M"))
        return "modified";
    return "unknown";
}
function parseGitPorcelain(text) {
    return text.split(/\r?\n/).filter(Boolean).map((line) => {
        const match = line.match(/^(.{1,2})\s+(.+)$/);
        const status = match?.[1]?.trim() || "modified";
        const rawPath = match?.[2]?.trim() || line.trim();
        const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop().trim() : rawPath;
        return { path: filePath, state: fileState(status), status };
    });
}
function parseGitNumstat(text) {
    const stats = new Map();
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
        const [additionsRaw, deletionsRaw, filePath] = line.split("\t");
        if (!filePath)
            continue;
        stats.set(filePath, {
            additions: additionsRaw === "-" ? 0 : Number(additionsRaw || 0),
            deletions: deletionsRaw === "-" ? 0 : Number(deletionsRaw || 0),
        });
    }
    return stats;
}
function gitChangedFiles(repo) {
    const files = parseGitPorcelain(tryGit(repo, ["status", "--porcelain", "-u"]) ?? "");
    const stats = parseGitNumstat([
        tryGit(repo, ["diff", "--numstat"]),
        tryGit(repo, ["diff", "--cached", "--numstat"]),
    ].filter(Boolean).join("\n"));
    return files.map((file) => ({ ...file, ...(stats.get(file.path) ?? { additions: 0, deletions: 0 }) }));
}
function gitCommitStats(repo, hash) {
    const raw = tryGit(repo, ["show", "--first-parent", "--numstat", "--format=", hash]) ?? "";
    return raw.split(/\r?\n/).filter(Boolean).reduce((acc, line) => {
        const [additionsRaw, deletionsRaw] = line.split("\t");
        acc.additions += additionsRaw === "-" ? 0 : Number(additionsRaw || 0);
        acc.deletions += deletionsRaw === "-" ? 0 : Number(deletionsRaw || 0);
        return acc;
    }, { additions: 0, deletions: 0 });
}
function gitRecentCommits(repo, ref = "HEAD") {
    const raw = tryGit(repo, ["log", "-10", "--pretty=format:%H%x1f%s%x1f%cr", ref]);
    if (!raw)
        return [];
    return raw.split(/\r?\n/).filter(Boolean).map((line) => {
        const [hash = "", message = "", date = ""] = line.split("\x1f");
        return { hash, shortHash: hash.slice(0, 7), message, date, ...gitCommitStats(repo, hash) };
    });
}
function gitAheadBehind(repo) {
    const raw = tryGit(repo, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    const [ahead = "0", behind = "0"] = (raw ?? "0 0").split(/\s+/);
    return { ahead: Number(ahead || 0), behind: Number(behind || 0) };
}
function gitStatus(repo, projectId = null) {
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
    if (remoteUrl)
        tryGit(repo, ["fetch", "--prune", remoteName]);
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
function gitBranches(repo) {
    const local = (tryGit(repo, ["branch", "--format", "%(refname:short)"]) ?? "").split(/\r?\n/).filter(Boolean);
    const remote = (tryGit(repo, ["branch", "-r", "--format", "%(refname:short)"]) ?? "").split(/\r?\n/).filter(Boolean);
    const current = tryGit(repo, ["branch", "--show-current"]);
    return { local, remote, current, branches: local };
}
function gitDiff(repo, filePath) {
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
function gitCommitDetails(repo, hash) {
    if (!repo || !hash)
        return { diff: "" };
    const diff = tryGit(repo, ["show", "--first-parent", "--find-renames", "--find-copies", "--patch", "--format=medium", hash]) ?? "";
    return { diff };
}
function workspaceEntry(root, full, stat = fs.statSync(full)) {
    return { name: path.basename(full), path: path.relative(root, full).replace(/\\/g, "/"), type: stat.isDirectory() ? "directory" : "file", size: stat.size, modifiedAt: stat.mtime.toISOString() };
}
function readOCPlatformConfig() {
    try {
        return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".openclaw", "openclaw.json"), "utf8"));
    }
    catch {
        return {};
    }
}
const voiceDefaultModels = {
    openai: "gpt-4o-transcribe",
    groq: "whisper-large-v3-turbo",
    deepgram: "nova-3",
    google: "gemini-3-flash-preview",
    mistral: "voxtral-mini-latest",
};
const voiceProviderEnvVars = {
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
function openclawConfigPath() {
    return path.join(os.homedir(), ".openclaw", "openclaw.json");
}
function writeOCPlatformConfig(cfg) {
    const file = openclawConfigPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), "utf8");
}
function normalizeVoiceProvider(value) {
    const provider = String(value || "auto").trim().toLowerCase();
    return provider in voiceDefaultModels ? provider : "auto";
}
function voiceSettingsFromConfig(cfg) {
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
function voiceSettingsPayload() {
    return { settings: voiceSettingsFromConfig(readOCPlatformConfig()), options: voiceOptions };
}
function writeVoiceSettings(input) {
    const cfg = readOCPlatformConfig();
    cfg.tools ??= {};
    cfg.tools.media ??= {};
    cfg.tools.media.audio ??= {};
    const provider = normalizeVoiceProvider(input.provider);
    const model = String(input.model || (provider === "auto" ? "" : voiceDefaultModels[provider])).trim();
    const language = String(input.language || "").trim();
    cfg.tools.media.audio.enabled = input.enabled !== false;
    cfg.tools.media.audio.echoTranscript = Boolean(input.echoTranscript);
    if (language)
        cfg.tools.media.audio.language = language;
    else
        delete cfg.tools.media.audio.language;
    if (provider === "auto")
        delete cfg.tools.media.audio.models;
    else
        cfg.tools.media.audio.models = [{ type: "provider", provider, model: model || voiceDefaultModels[provider] }];
    writeOCPlatformConfig(cfg);
    return voiceSettingsPayload();
}
function providerDetails(providerId) {
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
function saveProviderCredentials(input) {
    const providerId = String(input.providerId || "").trim();
    const envVar = voiceProviderEnvVars[providerId];
    const key = String(input.values?.["api-key"] || input.values?.apiKey || input.values?.key || "").trim();
    if (!providerId || !envVar || !key)
        return { ok: false, error: { message: "providerId and API key are required" } };
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
function resolveWorkspaceFile(rawPath) {
    const root = path.resolve(workspaceRoot());
    const requested = String(rawPath || "").trim();
    if (!requested)
        throw new Error("path is required");
    const target = path.resolve(root, requested.replace(/^[/\\]+/, ""));
    if (target !== root && !target.startsWith(`${root}${path.sep}`))
        throw new Error("path must stay inside workspace");
    return { root, target, relativePath: path.relative(root, target).replace(/\\/g, "/") };
}
function readMemoryFile(input) {
    const { target } = resolveWorkspaceFile(input.path);
    return { content: fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "" };
}
function writeMemoryFile(input) {
    const { target, relativePath } = resolveWorkspaceFile(input.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(input.content ?? ""), "utf8");
    return { ok: true, path: relativePath };
}
function listMemoryDocuments() {
    const root = workspaceRoot();
    const candidates = ["MEMORY.md", "SOUL.md", "USER.md", "IDENTITY.md", "TOOLS.md", "AGENTS.md", "HEARTBEAT.md"];
    const docs = [];
    for (const name of candidates) {
        const file = path.join(root, name);
        if (!fs.existsSync(file))
            continue;
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
function storeMemoryEntry(input) {
    const content = String(input.content || "").trim();
    if (!content)
        return { ok: false, error: { message: "content is required" } };
    const date = new Date().toISOString().slice(0, 10);
    const { target, relativePath } = resolveWorkspaceFile(`memory/${date}.md`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const category = String(input.category || "note").trim();
    fs.appendFileSync(target, `\n\n## ${new Date().toISOString()} — ${category}\n\n${content}\n`, "utf8");
    return { ok: true, path: relativePath };
}
function recallMemoryEntries() {
    const docs = listMemoryDocuments();
    const entries = [];
    for (const doc of docs) {
        const file = path.join(workspaceRoot(), String(doc.path));
        const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
        for (const [index, chunk] of text.split(/\n{2,}/).entries()) {
            const content = chunk.trim();
            if (!content)
                continue;
            entries.push({ content: content.slice(0, 1200), path: doc.path, line: index + 1, totalScore: 0.5, category: "document", date: String(doc.name).replace(/\.md$/, "") });
            if (entries.length >= 100)
                return { entries };
        }
    }
    return { entries };
}
function normalizeCronJob(input, existing) {
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
function findCronJob(jobId) {
    const key = String(jobId || "");
    return compatState.cronJobs.find((job) => job.jobId === key || job.id === key) ?? null;
}
async function cronListJobsGateway(context) {
    const page = await context.gateway.request("cron.list", { includeDisabled: true, limit: 200 }, 30_000);
    const jobs = Array.isArray(page.jobs) ? page.jobs : [];
    const runsPage = await cronRunsPageGateway(context, { scope: "all", limit: 200 }).catch(() => ({ entries: [] }));
    const latestRunByJobId = new Map();
    for (const run of runsPage.entries || []) {
        const jobId = String(run.jobId || "");
        if (jobId && !latestRunByJobId.has(jobId))
            latestRunByJobId.set(jobId, run);
    }
    const compatJobs = jobs.map((job) => gatewayJobToCompat(job, latestRunByJobId.get(String(job.id)) ?? null));
    compatState.cronJobs = compatJobs;
    return { ...page, jobs: compatJobs };
}
async function cronGetJobGateway(context, jobId) {
    const jobs = await cronListJobsGateway(context);
    const key = String(jobId || "");
    return { job: jobs.jobs.find((job) => job.jobId === key || job.id === key) ?? null };
}
async function cronCreateJobGateway(context, input) {
    const job = await context.gateway.request("cron.add", compatJobToGateway(input), 30_000);
    const compat = gatewayJobToCompat(job);
    compatState.cronJobs = [compat, ...compatState.cronJobs.filter((item) => item.jobId !== compat.jobId)];
    emitCronEvent({ type: "cron.job.created", jobId: compat.jobId, job: compat, timestamp: nowIso() });
    return { job: compat, jobId: compat.jobId };
}
async function cronUpdateJobGateway(context, input) {
    const key = String(input.jobId || input.id || "");
    if (!key)
        return null;
    const existing = (await cronGetJobGateway(context, key)).job;
    if (!existing)
        return null;
    const patch = compatJobToGateway(input, existing);
    const job = await context.gateway.request("cron.update", { jobId: key, patch }, 30_000);
    const compat = gatewayJobToCompat(job, existing.lastRun ?? null);
    compatState.cronJobs = [compat, ...compatState.cronJobs.filter((item) => item.jobId !== compat.jobId)];
    emitCronEvent({ type: "cron.job.updated", jobId: compat.jobId, job: compat, timestamp: nowIso() });
    return { job: compat };
}
async function cronDeleteJobGateway(context, input) {
    const key = String(input.jobId || input.id || "");
    if (!key)
        return false;
    const result = await context.gateway.request("cron.remove", { jobId: key }, 30_000);
    compatState.cronJobs = compatState.cronJobs.filter((job) => job.jobId !== key && job.id !== key);
    emitCronEvent({ type: "cron.job.deleted", jobId: key, timestamp: nowIso() });
    return result.removed !== false;
}
async function cronRunsPageGateway(context, input) {
    const params = {
        limit: Number(input.limit || 50),
        offset: Number(input.offset || 0),
        sortDir: input.sortDir || "desc",
    };
    if (input.scope)
        params.scope = input.scope;
    if (input.jobId || input.id)
        params.jobId = input.jobId || input.id;
    if (!params.scope && !params.jobId)
        params.scope = "all";
    return context.gateway.request("cron.runs", params, 30_000);
}
async function cronListRunsGateway(context, input) {
    const page = await cronRunsPageGateway(context, input);
    const entries = Array.isArray(page.entries) ? page.entries : [];
    const jobsById = new Map(compatState.cronJobs.map((job) => [String(job.jobId), job]));
    const runs = entries.map((run) => gatewayRunToCompat(run, jobsById.get(String(run.jobId))));
    compatState.cronRuns = runs;
    return { ...page, runs, entries };
}
async function cronRecentActivityGateway(context, input) {
    const page = await cronRunsPageGateway(context, { ...input, scope: "all", limit: Number(input.limit || 50) });
    const entries = Array.isArray(page.entries) ? page.entries : [];
    const jobsById = new Map(compatState.cronJobs.map((job) => [String(job.jobId), job]));
    const events = entries.map((run) => cronEventFromRun(run, jobsById.get(String(run.jobId))));
    return { ...page, events, activity: events };
}
async function cronRunJobGateway(context, input) {
    const key = String(input.jobId || input.id || "");
    if (!key)
        throw new Error("jobId is required");
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
    const result = await context.gateway.request("cron.run", { jobId: key, mode: input.mode || "force" }, 30_000);
    setTimeout(async () => {
        try {
            const runs = await cronListRunsGateway(context, { jobId: key, limit: 1 });
            const latest = runs.runs?.[0];
            if (latest)
                emitCronEvent(cronEventFromRun(latest, job ?? undefined));
        }
        catch { /* best-effort refresh */ }
    }, 1_500).unref?.();
    return { queued: true, result, run: startedRun };
}
function cronListJobs() {
    return { jobs: [...compatState.cronJobs].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))) };
}
function cronCreateJob(input) {
    const job = normalizeCronJob(input);
    compatState.cronJobs.push(job);
    return { job, jobId: job.jobId };
}
function cronUpdateJob(input) {
    const key = input.jobId || input.id;
    const index = compatState.cronJobs.findIndex((job) => job.jobId === key || job.id === key);
    if (index < 0)
        return null;
    const job = normalizeCronJob(input, compatState.cronJobs[index]);
    compatState.cronJobs[index] = job;
    return { job };
}
function cronDeleteJob(input) {
    const key = input.jobId || input.id;
    const before = compatState.cronJobs.length;
    compatState.cronJobs = compatState.cronJobs.filter((job) => job.jobId !== key && job.id !== key);
    return before !== compatState.cronJobs.length;
}
function cronListRuns(input) {
    const key = input.jobId || input.id;
    const runs = key ? compatState.cronRuns.filter((run) => run.jobId === key) : compatState.cronRuns;
    return { runs };
}
function cronRecentActivity(input) {
    const limit = Number(input.limit || 50);
    const events = compatState.cronRuns.slice(-limit).reverse();
    return { events, activity: events };
}
function modelRefsFromConfig(cfg) {
    const defaults = cfg.agents?.defaults ?? {};
    const modelMapRefs = defaults.models && !Array.isArray(defaults.models) && typeof defaults.models === "object"
        ? Object.entries(defaults.models).flatMap(([key, value]) => {
            if (typeof value === "string")
                return [value];
            if (Array.isArray(value))
                return value.filter((item) => typeof item === "string");
            if (value && typeof value === "object") {
                const obj = value;
                const refs = [obj.primary, obj.model, ...(Array.isArray(obj.fallbacks) ? obj.fallbacks : [])].filter(Boolean);
                return refs.length > 0 ? refs.map(String) : [key];
            }
            return [];
        })
        : [];
    const refs = [
        ...modelMapRefs,
        ...(Array.isArray(defaults.models) ? defaults.models.map(String) : []),
        ...(Array.isArray(defaults.model?.models) ? defaults.model.models.map(String) : []),
        defaults.model?.primary ? String(defaults.model.primary) : null,
        ...(Array.isArray(defaults.model?.fallbacks) ? defaults.model.fallbacks.map(String) : []),
        typeof defaults.model === "string" ? defaults.model : null,
    ];
    return [...new Set(refs.filter((value) => typeof value === "string" && value.trim().length > 0))];
}
function normalizeModelEntry(value) {
    const ref = typeof value === "string" ? value : String(value?.id || value?.model || value?.value || "");
    const [providerFromRef, idFromRef] = ref.includes("/") ? ref.split(/\/(.+)/) : [String(value?.provider || "custom"), ref];
    const provider = String(value?.provider || providerFromRef || "custom");
    const entryId = String(value?.id || idFromRef || ref);
    return { id: entryId, name: String(value?.name || entryId || ref), provider, reasoning: Boolean(value?.reasoning) };
}
function modelsResponse(cfg) {
    const refs = modelRefsFromConfig(cfg);
    const defaultsModels = cfg.agents?.defaults?.models;
    const rawModels = Array.isArray(defaultsModels)
        ? defaultsModels
        : defaultsModels && typeof defaultsModels === "object"
            ? Object.entries(defaultsModels).flatMap(([provider, value]) => {
                if (typeof value === "string")
                    return [{ provider, id: value.includes("/") ? value.split(/\/(.+)/)[1] : value, name: value }];
                if (Array.isArray(value))
                    return value.map((item) => typeof item === "string" ? { provider, id: item.includes("/") ? item.split(/\/(.+)/)[1] : item, name: item } : { provider, ...item });
                if (value && typeof value === "object") {
                    const obj = value;
                    const candidates = [obj.primary, obj.model, ...(Array.isArray(obj.fallbacks) ? obj.fallbacks : [])].filter(Boolean);
                    if (candidates.length === 0)
                        return [provider];
                    return candidates.map((item) => ({ provider, id: String(item).includes("/") ? String(item).split(/\/(.+)/)[1] : String(item), name: String(item) }));
                }
                return [];
            })
            : Array.isArray(cfg.agents?.defaults?.model?.models)
                ? cfg.agents.defaults.model.models
                : refs;
    const models = (rawModels.length ? rawModels : refs).map(normalizeModelEntry);
    const currentModel = cfg.agents?.defaults?.model?.primary || (typeof cfg.agents?.defaults?.model === "string" ? cfg.agents.defaults.model : null) || refs[0] || null;
    if (currentModel && !models.some((model) => `${model.provider}/${model.id}` === currentModel || model.id === currentModel)) {
        models.unshift(normalizeModelEntry(currentModel));
    }
    return { models, currentModel, defaultModel: currentModel };
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
function safeWorkspaceFilePath(inputPath, fallback = "memory/notes.md") {
    const root = path.resolve(openclawWorkspaceRoot());
    const requested = typeof inputPath === "string" && inputPath.trim() ? inputPath.trim() : fallback;
    const full = path.resolve(root, requested);
    if (full !== root && !full.startsWith(root + path.sep)) {
        throw new HttpError(403, "Memory path escapes workspace", "PATH_FORBIDDEN");
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    return full;
}
function searchMemoryDocuments(query) {
    const q = String(query ?? "").trim().toLowerCase();
    const entries = [];
    for (const doc of listMemoryDocuments()) {
        const full = safeWorkspaceFilePath(doc.path);
        const content = fs.readFileSync(full, "utf8");
        content.split("\n").forEach((line, index) => {
            const text = line.trim();
            if (!text)
                return;
            if (q && !text.toLowerCase().includes(q))
                return;
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
function findGitRepos(root, maxDepth = 4, limit = 100) {
    const repos = [];
    const seen = new Set();
    function walk(dir, depth) {
        if (repos.length >= limit || depth > maxDepth)
            return;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        if (entries.some((entry) => entry.isDirectory() && entry.name === ".git")) {
            const repoRoot = dir;
            if (!seen.has(repoRoot)) {
                seen.add(repoRoot);
                let currentBranch = null;
                try {
                    currentBranch = git(repoRoot, ["branch", "--show-current"]).trim() || null;
                }
                catch { /* ignore */ }
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
            if (!entry.isDirectory() || ignored.has(entry.name) || entry.name.startsWith("."))
                continue;
            walk(path.join(dir, entry.name), depth + 1);
        }
    }
    walk(root, 0);
    return repos;
}
function usageNumber(value) {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
}
function normalizeUsage(raw) {
    const input = usageNumber(raw.input ?? raw.input_tokens ?? raw.prompt_tokens);
    const output = usageNumber(raw.output ?? raw.output_tokens ?? raw.completion_tokens);
    const cacheRead = usageNumber(raw.cacheRead ?? raw.cache_read_tokens);
    const cacheWrite = usageNumber(raw.cacheWrite ?? raw.cache_write_tokens);
    const total = usageNumber(raw.total ?? raw.total_tokens) || input + output + cacheRead + cacheWrite;
    return { input, output, cacheRead, cacheWrite, total };
}
function usageTimestampMs(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value < 10_000_000_000 ? value * 1000 : value;
    if (typeof value !== "string" || !value.trim())
        return Date.now();
    const numeric = Number(value);
    if (Number.isFinite(numeric))
        return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
}
function frontendUsageSummary(summary) {
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
function frontendDaily(days) {
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
function userHomeDir() {
    return process.env.HOME || os.homedir();
}
function usageFromSessions(requestedDays = 30) {
    const usage = [];
    const days = new Map();
    const cutoff = Date.now() - Math.max(1, requestedDays) * 24 * 60 * 60 * 1000;
    const agentsRoot = path.join(userHomeDir(), ".openclaw", "agents");
    if (fs.existsSync(agentsRoot)) {
        for (const agent of fs.readdirSync(agentsRoot)) {
            const sessionsDir = path.join(agentsRoot, agent, "sessions");
            if (!fs.existsSync(sessionsDir))
                continue;
            for (const file of fs.readdirSync(sessionsDir)) {
                if (!file.endsWith(".jsonl") || file.endsWith(".trajectory.jsonl"))
                    continue;
                const full = path.join(sessionsDir, file);
                const lines = fs.readFileSync(full, "utf8").split("\n");
                for (const line of lines) {
                    if (!line.includes('"usage"'))
                        continue;
                    try {
                        const entry = JSON.parse(line);
                        const message = entry.message && typeof entry.message === "object" ? entry.message : {};
                        const data = entry.data && typeof entry.data === "object" ? entry.data : {};
                        const raw = (message.usage ?? data.usage ?? entry.usage);
                        if (!raw || typeof raw !== "object" || Array.isArray(raw))
                            continue;
                        const normalized = normalizeUsage(raw);
                        const timestamp = entry.timestamp ?? entry.ts ?? message.timestamp ?? data.timestamp;
                        const timestampMs = usageTimestampMs(timestamp);
                        if (timestampMs < cutoff)
                            continue;
                        const cost = usageNumber((raw.cost && typeof raw.cost === "object" ? raw.cost.total : undefined) ?? raw.totalCost);
                        const item = {
                            ...normalized,
                            cost,
                            provider: message.provider ?? entry.provider,
                            model: message.model ?? entry.modelId,
                            timestamp: typeof timestamp === "string" || typeof timestamp === "number" ? timestamp : new Date(timestampMs).toISOString(),
                            sessionFile: full,
                        };
                        usage.push(item);
                        const dayKey = new Date(timestampMs).toISOString().slice(0, 10);
                        const daily = days.get(dayKey) ?? { day: dayKey, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0 };
                        daily.input += item.input;
                        daily.output += item.output;
                        daily.cacheRead += item.cacheRead;
                        daily.cacheWrite += item.cacheWrite;
                        daily.totalTokens += item.total;
                        daily.totalCost += item.cost;
                        days.set(dayKey, daily);
                    }
                    catch {
                        // Skip malformed transcript lines.
                    }
                }
            }
        }
    }
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
async function usageProviders(context) {
    try {
        const status = await context.gateway.request("usage.status", {}, 30_000);
        const payload = status.payload && typeof status.payload === "object" ? status.payload : status;
        return Array.isArray(payload.providers) ? payload.providers : [];
    }
    catch {
        return [];
    }
}
async function usageResponse(context, days) {
    const usage = usageFromSessions(days);
    const providers = await usageProviders(context);
    return {
        range: { days },
        summary: frontendUsageSummary(usage.summary),
        providers,
        usage: usage.usage.slice(-500),
        source: usage.source,
        unavailable: usage.unavailable,
    };
}
function dailyUsage(days) {
    const usage = usageFromSessions(days);
    const daily = frontendDaily(usage.days);
    return { range: { days }, daily, days: usage.days, source: usage.source, unavailable: usage.unavailable };
}
async function connectGatewayForStatus(context) {
    try {
        await context.gateway.connect();
    }
    catch {
        // status() below carries lastError; callers should still get a usable payload.
    }
    return context.gateway.status();
}
class ChildProcessTerminal {
    child;
    dataHandlers = new Set();
    exitHandlers = new Set();
    constructor(child) {
        this.child = child;
        child.stdout.on("data", (chunk) => this.emitData(chunk.toString()));
        child.stderr.on("data", (chunk) => this.emitData(chunk.toString()));
        child.on("exit", (code) => this.emitExit(code ?? 0));
    }
    emitData(data) { for (const handler of this.dataHandlers)
        handler(data); }
    emitExit(exitCode) { for (const handler of this.exitHandlers)
        handler({ exitCode }); }
    write(data) { this.child.stdin.write(data); }
    resize(_cols, _rows) { }
    kill() { this.child.kill(); }
    onData(handler) { this.dataHandlers.add(handler); return { dispose: () => this.dataHandlers.delete(handler) }; }
    onExit(handler) { this.exitHandlers.add(handler); return { dispose: () => this.exitHandlers.delete(handler) }; }
}
function terminalShell() {
    return process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
}
async function spawnPty(command, cwd, cols, rows) {
    try {
        const pty = await import("node-pty");
        return pty.spawn(command, [], { cwd, cols, rows, env: process.env });
    }
    catch {
        const child = spawnChild(command, [], { cwd, env: process.env, shell: false });
        return new ChildProcessTerminal(child);
    }
}
function broadcastTerminal(term, event, payload) {
    const frame = { event, data: payload };
    for (const listener of [...term.listeners])
        listener(event, payload);
    return frame;
}
async function spawnTerminal(cwd, body = {}) {
    const idValue = id("term");
    const proc = await spawnPty(terminalShell(), cwd, Number(body.cols ?? 80), Number(body.rows ?? 24));
    const term = { id: idValue, proc, cwd, buffer: [], listeners: new Set() };
    proc.onData((data) => {
        term.buffer.push(data);
        if (term.buffer.length > 200)
            term.buffer.shift();
        broadcastTerminal(term, "data", { type: "terminal.data", terminalId: idValue, data });
    });
    proc.onExit((event) => {
        broadcastTerminal(term, "exit", { type: "terminal.exit", terminalId: idValue, exitCode: event.exitCode ?? 0 });
        compatState.terminals.delete(idValue);
    });
    compatState.terminals.set(idValue, term);
    return { terminalId: idValue, cwd, streamUrl: `/api/terminal/${idValue}/stream`, websocketUrl: `/api/terminal/${idValue}/ws` };
}
function getTerminal(terminalId) {
    return compatState.terminals.get(terminalId) ?? null;
}
export async function registerCompatRoutes(app, context) {
    loadCompatState(context);
    context.compat = { touchChatActivity: (input) => touchCompatChatActivity(context, input) };
    if (compatState.spaces.length === 0) {
        ensureDefaultSpace();
        saveCompatState(context);
    }
    app.get("/api/version", async () => ({
        ok: true,
        version: "0.1.0",
        service: "openclaw-middleware-v2",
    }));
    app.get("/api/bootstrap", async () => {
        const gateway = await connectGatewayForStatus(context);
        await syncGatewaySessions(context);
        applyProjectedChatActivity(context);
        const spaceId = activeSpaceId();
        return {
            ok: true,
            service: "openclaw-middleware-v2",
            spaces: compatState.spaces.filter(visibleSpace),
            activeSpaceId: spaceId,
            chats: sortedChatsForResponse(spaceId, false),
            projects: listBySpace(compatState.projects, spaceId),
            sessions: compatState.sessions.filter(notDeleted),
            gateway,
        };
    });
    app.get("/api/spaces", async (request) => {
        const query = request.query;
        const archived = query.archived === "true" || query.archived === true;
        return {
            spaces: compatState.spaces.filter((space) => archived ? Boolean(space.archived) && notDeleted(space) : visibleSpace(space)),
            activeSpaceId: activeSpaceId(),
        };
    });
    app.post("/api/spaces", async (request) => {
        const body = (request.body ?? {});
        const timestamp = nowIso();
        const space = {
            id: id("space"),
            name: body.name || "New Space",
            archived: false,
            deleted: false,
            sortOrder: compatState.spaces.length,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        compatState.spaces.push(space);
        compatState.activeSpaceId = space.id;
        saveCompatState(context);
        return { space, activeSpaceId: space.id };
    });
    app.patch("/api/spaces/:spaceId", async (request, reply) => {
        const space = patchById(compatState.spaces, request.params.spaceId, request.body);
        if (!space)
            return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
        if (space.archived && compatState.activeSpaceId === space.id) {
            compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
        }
        saveCompatCollection(context, "spaces");
        return { space };
    });
    app.post("/api/spaces/:spaceId/archive", async (request, reply) => {
        const body = (request.body ?? {});
        const archived = body.archived ?? true;
        const space = patchById(compatState.spaces, request.params.spaceId, { archived });
        if (!space)
            return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
        if (archived)
            archiveChatsForSpace(request.params.spaceId);
        else
            restoreChatsForSpace(request.params.spaceId);
        if (archived && compatState.activeSpaceId === space.id) {
            compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
        }
        saveCompatState(context);
        return { ok: true, activeSpaceId: activeSpaceId(), space, archived };
    });
    app.post("/api/spaces/:spaceId/switch", async (request, reply) => {
        const space = compatState.spaces.find((item) => item.id === request.params.spaceId && visibleSpace(item));
        if (!space)
            return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
        space.updatedAt = nowIso();
        compatState.activeSpaceId = space.id;
        saveCompatState(context);
        return { activeSpaceId: space.id, space };
    });
    app.delete("/api/spaces/:spaceId", async (request) => {
        return deleteCompatSpace(context, request.params.spaceId);
    });
    app.get("/api/chats", async (request) => {
        await syncGatewaySessions(context);
        applyProjectedChatActivity(context);
        const query = request.query;
        const archived = query.archived === "true" || query.archived === true;
        return {
            chats: sortedChatsForResponse(query.spaceId, archived),
        };
    });
    app.post("/api/chats", async (request) => {
        const body = (request.body ?? {});
        const timestamp = nowIso();
        const sessionKey = String(body.sessionKey || `agent:${body.agentId || "main"}:desktop:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
        void context.gateway.request("sessions.create", {
            key: sessionKey,
            agentId: body.agentId || "main",
            label: gatewaySessionLabel(body.name, sessionKey),
        }).catch(() => { });
        const chat = {
            id: id("chat"),
            name: body.name || "New Chat",
            sessionKey,
            spaceId: body.spaceId || activeSpaceId(),
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
            agentId: body.agentId || "main",
            label: body.name || "New Chat",
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        compatState.chats.push(chat);
        compatState.sessions.push(session);
        saveCompatState(context);
        return { chat, session };
    });
    app.patch("/api/chats/:chatId", async (request, reply) => {
        const chat = patchById(compatState.chats, request.params.chatId, request.body);
        if (!chat)
            return reply.code(404).send({ ok: false, error: { message: "Chat not found" } });
        saveCompatCollection(context, "chats");
        return { chat };
    });
    app.post("/api/chats/:chatId/rename", async (request, reply) => {
        const body = (request.body ?? {});
        const chat = patchById(compatState.chats, request.params.chatId, { name: body.name || "New Chat" });
        if (!chat)
            return reply.code(404).send({ ok: false, error: { message: "Chat not found" } });
        saveCompatCollection(context, "chats");
        return { chat };
    });
    app.post("/api/spaces/:spaceId/rename", async (request, reply) => {
        const body = (request.body ?? {});
        const space = patchById(compatState.spaces, request.params.spaceId, { name: body.name || "New Space" });
        if (!space)
            return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
        saveCompatCollection(context, "spaces");
        return { space, activeSpaceId: activeSpaceId() };
    });
    app.post("/api/chats/:chatId/archive", async (request, reply) => {
        const body = (request.body ?? {});
        const archived = body.archived ?? true;
        const chat = patchById(compatState.chats, request.params.chatId, archived ? { archived: true, archivedBySpace: false } : { archived: false, archivedBySpace: undefined });
        if (!chat)
            return reply.code(404).send({ ok: false, error: { message: "Chat not found" } });
        saveCompatCollection(context, "chats");
        return { chat };
    });
    app.delete("/api/chats/:chatId", async (request) => {
        return deleteCompatChat(context, request.params.chatId);
    });
    app.post("/api/chats/:chatId/session", async (request) => {
        const body = (request.body ?? {});
        const sessionKey = body.sessionKey ?? null;
        let chat = patchById(compatState.chats, request.params.chatId, { sessionKey });
        if (!chat) {
            const timestamp = nowIso();
            chat = {
                id: request.params.chatId,
                name: body.name || "New Chat",
                sessionKey,
                spaceId: body.spaceId || activeSpaceId(),
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
    app.get("/api/projects", async (request) => ({ projects: listBySpace(compatState.projects, request.query.spaceId) }));
    app.post("/api/projects", async (request) => {
        const body = (request.body ?? {});
        const timestamp = nowIso();
        const project = { id: id("project"), name: body.name || "Untitled Project", spaceId: body.spaceId || activeSpaceId(), ...body, createdAt: timestamp, updatedAt: timestamp };
        compatState.projects.push(project);
        saveCompatCollection(context, "projects");
        return { project };
    });
    app.patch("/api/projects/:projectId", async (request, reply) => {
        const project = patchById(compatState.projects, request.params.projectId, request.body);
        if (!project)
            return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
        saveCompatCollection(context, "projects");
        return { project };
    });
    app.delete("/api/projects/:projectId", async (request) => {
        patchById(compatState.projects, request.params.projectId, { deleted: true });
        saveCompatCollection(context, "projects");
        return { ok: true };
    });
    app.get("/api/topics", async (request) => {
        const query = request.query;
        return { topics: compatState.topics.filter((topic) => notDeleted(topic) && (!query.projectId || topic.projectId === query.projectId)) };
    });
    app.post("/api/topics", async (request) => {
        const body = (request.body ?? {});
        const timestamp = nowIso();
        const topic = { id: id("topic"), name: body.name || "New Topic", archived: false, deleted: false, ...body, createdAt: timestamp, updatedAt: timestamp };
        compatState.topics.push(topic);
        saveCompatCollection(context, "topics");
        return { topic };
    });
    app.patch("/api/topics/:topicId", async (request, reply) => {
        const topic = patchById(compatState.topics, request.params.topicId, request.body);
        if (!topic)
            return reply.code(404).send({ ok: false, error: { message: "Topic not found" } });
        saveCompatCollection(context, "topics");
        return { topic };
    });
    app.post("/api/topics/:topicId/archive", async (request, reply) => {
        const body = (request.body ?? {});
        const topic = patchById(compatState.topics, request.params.topicId, { archived: body.archived ?? true });
        if (!topic)
            return reply.code(404).send({ ok: false, error: { message: "Topic not found" } });
        saveCompatCollection(context, "topics");
        return { topic };
    });
    app.delete("/api/topics/:topicId", async (request) => {
        patchById(compatState.topics, request.params.topicId, { deleted: true });
        saveCompatCollection(context, "topics");
        return { ok: true };
    });
    app.get("/api/sessions", async (request) => {
        await syncGatewaySessions(context);
        const query = request.query;
        return {
            sessions: compatState.sessions.filter((session) => notDeleted(session) &&
                (!query.projectId || session.projectId === query.projectId) &&
                (!query.topicId || session.topicId === query.topicId)),
        };
    });
    app.post("/api/sessions", async (request) => {
        const body = (request.body ?? {});
        const timestamp = nowIso();
        const sessionKey = String(body.sessionKey || `agent:${body.agentId || "main"}:desktop:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
        void context.gateway.request("sessions.create", {
            key: sessionKey,
            agentId: body.agentId || "main",
            label: gatewaySessionLabel(body.label, sessionKey),
        }).catch(() => { });
        const session = { id: id("session"), ...body, key: sessionKey, sessionKey, createdAt: timestamp, updatedAt: timestamp };
        compatState.sessions.push(session);
        saveCompatCollection(context, "sessions");
        return { session };
    });
    // --- project archive ---
    app.post("/api/projects/:projectId/archive", async (request, reply) => {
        const body = (request.body ?? {});
        const project = patchById(compatState.projects, request.params.projectId, { archived: body.archived ?? true });
        if (!project)
            return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
        saveCompatCollection(context, "projects");
        return { project };
    });
    // --- repos ---
    app.get("/api/repos/recent", async () => ({ repos: findGitRepos(openclawWorkspaceRoot(), 4, 50) }));
    app.post("/api/repos/scan", async (request) => {
        const body = (request.body ?? {});
        const root = String(body.path || body.root || body.workspaceRoot || openclawWorkspaceRoot());
        return { repos: findGitRepos(root, 5, 200), root };
    });
    app.post("/api/repos/select", async (request) => ({ ok: true, ...request.body }));
    // --- git (project-scoped) ---
    app.get("/api/projects/:projectId/git/status", async (request, reply) => {
        const root = projectRoot(request.params.projectId);
        if (!root)
            return reply.code(404).send({ ok: false, error: { message: "Project not found or has no workspace root" } });
        try {
            return gitStatus(root, request.params.projectId);
        }
        catch {
            return { hasGit: false, dirty: false, files: [], changedFiles: [], recentCommits: [], summary: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0 } };
        }
    });
    app.get("/api/projects/:projectId/git/diff", async (request, reply) => {
        const root = projectRoot(request.params.projectId);
        if (!root)
            return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
        const filePath = String(request.query.path ?? "");
        try {
            return gitDiff(root, filePath);
        }
        catch (error) {
            return { patch: null, error: error instanceof Error ? error.message : "Diff unavailable" };
        }
    });
    app.get("/api/projects/:projectId/git/branches", async (request, reply) => {
        const root = projectRoot(request.params.projectId);
        if (!root)
            return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
        try {
            return gitBranches(root);
        }
        catch {
            return { branches: [], current: "" };
        }
    });
    app.post("/api/projects/:projectId/git/checkout", async (request, reply) => {
        const root = projectRoot(request.params.projectId);
        if (!root)
            return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
        const body = (request.body ?? {});
        const branch = String(body.branch ?? body.branchName ?? "");
        if (!branch)
            return reply.code(400).send({ ok: false, error: { message: "Branch name required" } });
        try {
            git(root, ["checkout", branch]);
            return { ok: true, branch };
        }
        catch (error) {
            return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Checkout failed" } });
        }
    });
    // --- git (repo-path-scoped, no project) ---
    app.get("/api/repos/git/status", async (request) => {
        const repoPath = String(request.query.path ?? request.query.repoPath ?? "");
        if (!repoPath)
            return { dirty: false, files: [] };
        try {
            return gitStatus(repoPath, null);
        }
        catch {
            return { hasGit: false, dirty: false, files: [], changedFiles: [], recentCommits: [], summary: { totalFiles: 0, totalAdditions: 0, totalDeletions: 0 } };
        }
    });
    app.get("/api/repos/git/diff", async (request) => {
        const query = request.query;
        const repoPath = String(query.repoPath ?? "");
        const filePath = String(query.path ?? "");
        if (!repoPath)
            return { patch: "" };
        try {
            return gitDiff(repoPath, filePath);
        }
        catch (error) {
            return { patch: null, error: error instanceof Error ? error.message : "Diff unavailable" };
        }
    });
    app.get("/api/repos/git/branches", async (request) => {
        const repoPath = String(request.query.path ?? request.query.repoPath ?? "");
        if (!repoPath)
            return { branches: [], current: "" };
        try {
            return gitBranches(repoPath);
        }
        catch {
            return { branches: [], current: "" };
        }
    });
    app.post("/api/repos/git/checkout", async (request, reply) => {
        const body = (request.body ?? {});
        const repoPath = String(body.repoPath ?? body.path ?? "");
        const branch = String(body.branch ?? body.branchName ?? "");
        if (!repoPath || !branch)
            return reply.code(400).send({ ok: false, error: { message: "repoPath and branch required" } });
        try {
            git(repoPath, ["checkout", branch]);
            return { ok: true, branch };
        }
        catch (error) {
            return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Checkout failed" } });
        }
    });
    // --- workspace (project-scoped) ---
    app.get("/api/projects/:projectId/workspace/tree", async (request, reply) => {
        const root = projectRoot(request.params.projectId);
        if (!root)
            return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
        const rel = String(request.query.path ?? "");
        try {
            const dir = safeJoin(root, rel);
            const entries = fs.readdirSync(dir, { withFileTypes: true }).map((entry) => workspaceEntry(root, path.join(dir, entry.name)));
            return { entries };
        }
        catch {
            return { entries: [] };
        }
    });
    app.get("/api/projects/:projectId/workspace/file", async (request, reply) => {
        const root = projectRoot(request.params.projectId);
        if (!root)
            return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
        const rel = String(request.query.path ?? "");
        try {
            const file = safeJoin(root, rel);
            const content = fs.readFileSync(file, "utf8");
            return { path: rel, content, encoding: "utf-8", file: { path: rel, content, encoding: "utf-8" } };
        }
        catch {
            return reply.code(404).send({ ok: false, error: { message: "File not found" } });
        }
    });
    app.put("/api/projects/:projectId/workspace/file", async (request, reply) => {
        const root = projectRoot(request.params.projectId);
        if (!root)
            return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
        const body = (request.body ?? {});
        const rel = String(body.path ?? "");
        try {
            const file = safeJoin(root, rel);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, String(body.content ?? ""), "utf8");
            return { ok: true, path: rel };
        }
        catch {
            return reply.code(500).send({ ok: false, error: { message: "Write failed" } });
        }
    });
    // --- global workspace (no project scope) ---
    function globalWorkspaceRoot() {
        // Global workspace means connected OpenClaw workspace, not the Desktop app cwd.
        return openclawWorkspaceRoot();
    }
    app.get("/api/workspace/capabilities", async () => ({
        capabilities: { canTree: true, canStat: true, canRead: true, canWrite: true, canDownloadFile: true, canCreateDir: true, canMoveEntry: true, canDeleteEntry: true },
    }));
    app.get("/api/workspace/tree", async (request) => {
        const root = globalWorkspaceRoot();
        const rel = String(request.query.path ?? "");
        try {
            const dir = safeJoin(root, rel);
            const entries = fs.readdirSync(dir, { withFileTypes: true }).map((entry) => workspaceEntry(root, path.join(dir, entry.name)));
            return { entries };
        }
        catch {
            return { entries: [] };
        }
    });
    app.get("/api/workspace/stat", async (request, reply) => {
        const root = globalWorkspaceRoot();
        const rel = String(request.query.path ?? "");
        try {
            return { entry: workspaceEntry(root, safeJoin(root, rel)) };
        }
        catch {
            return reply.code(404).send({ ok: false, error: { message: "Not found" } });
        }
    });
    app.get("/api/workspace/file", async (request, reply) => {
        const root = globalWorkspaceRoot();
        const rel = String(request.query.path ?? "");
        try {
            const file = safeJoin(root, rel);
            const content = fs.readFileSync(file, "utf8");
            return { path: rel, content, encoding: "utf-8", file: { path: rel, content, encoding: "utf-8" } };
        }
        catch {
            return reply.code(404).send({ ok: false, error: { message: "File not found" } });
        }
    });
    app.put("/api/workspace/file", async (request, reply) => {
        const root = globalWorkspaceRoot();
        const body = (request.body ?? {});
        const rel = String(body.path ?? "");
        try {
            const file = safeJoin(root, rel);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, String(body.content ?? ""), "utf8");
            return { ok: true, path: rel };
        }
        catch {
            return reply.code(500).send({ ok: false, error: { message: "Write failed" } });
        }
    });
    app.delete("/api/workspace/file", async (request, reply) => {
        const root = globalWorkspaceRoot();
        const rel = String(request.query.path ?? "");
        try {
            fs.unlinkSync(safeJoin(root, rel));
            return { ok: true };
        }
        catch {
            return reply.code(404).send({ ok: false, error: { message: "Not found" } });
        }
    });
    app.post("/api/workspace/mkdir", async (request, reply) => {
        const root = globalWorkspaceRoot();
        const body = (request.body ?? {});
        const rel = String(body.path ?? "");
        try {
            fs.mkdirSync(safeJoin(root, rel), { recursive: true });
            return { ok: true };
        }
        catch {
            return reply.code(500).send({ ok: false, error: { message: "mkdir failed" } });
        }
    });
    app.post("/api/workspace/move", async (request, reply) => {
        const root = globalWorkspaceRoot();
        const body = (request.body ?? {});
        try {
            fs.renameSync(safeJoin(root, String(body.fromPath ?? "")), safeJoin(root, String(body.toPath ?? "")));
            return { ok: true };
        }
        catch {
            return reply.code(500).send({ ok: false, error: { message: "Move failed" } });
        }
    });
    app.get("/api/workspace/download", async (request, reply) => {
        const root = globalWorkspaceRoot();
        const rel = String(request.query.path ?? "");
        try {
            const file = safeJoin(root, rel);
            const content = fs.readFileSync(file);
            const mimeType = rel.endsWith(".json") ? "application/json" : rel.endsWith(".html") ? "text/html" : "application/octet-stream";
            return reply.type(mimeType).header("Content-Disposition", `attachment; filename="${path.basename(file)}"`).send(content);
        }
        catch {
            return reply.code(404).send({ ok: false, error: { message: "File not found" } });
        }
    });
    // --- legacy SSE streams ---
    app.get("/api/stream/cron", async (request, reply) => {
        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });
        const write = (event, payload) => {
            reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        };
        const client = { write };
        cronSseClients.add(client);
        write("cron.ready", { ok: true });
        const unsubscribe = context.gateway.onEvent((gatewayEvent) => {
            if (!gatewayEvent.event.startsWith("cron."))
                return;
            const payload = gatewayEvent.payload && typeof gatewayEvent.payload === "object" ? gatewayEvent.payload : {};
            const type = String(payload.type || gatewayEvent.event);
            write("data", { ...payload, type });
        });
        const interval = setInterval(() => reply.raw.write(":heartbeat\n\n"), 15_000);
        await new Promise((resolve) => {
            request.raw.on("close", () => {
                clearInterval(interval);
                unsubscribe();
                cronSseClients.delete(client);
                resolve();
            });
        });
    });
    app.get("/api/stream/chat/:sessionKey", async (request, reply) => {
        const sessionKey = decodeURIComponent(request.params.sessionKey);
        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });
        reply.raw.write(":ok\n\n");
        // Forward patches from the patch bus filtered by sessionKey
        const handler = (patch) => {
            if (patch.sessionKey !== sessionKey)
                return;
            const eventType = patch.type.startsWith("chat.") ? patch.type : "message";
            reply.raw.write(`event: ${eventType}\ndata: ${JSON.stringify(patch.payload)}\n\n`);
        };
        // Use the PatchBus broadcast by wrapping a fake WebSocket-like client
        const clientId = `sse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const originalBroadcast = context.patchBus.broadcast.bind(context.patchBus);
        const wrappedBroadcast = (patch) => {
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
            const latest = context.db.prepare("SELECT MAX(cursor) as c FROM v2_projection_events").get();
            lastCursor = latest?.c ?? 0;
        }
        catch { /* table may not exist yet */ }
        const pollInterval = setInterval(() => {
            try {
                const rows = context.db.prepare("SELECT cursor, session_key, event_type, payload_json, created_at_ms FROM v2_projection_events WHERE cursor > @lastCursor AND session_key = @sessionKey ORDER BY cursor ASC LIMIT 100").all({ lastCursor, sessionKey });
                for (const row of rows) {
                    const eventType = row.event_type.startsWith("chat.") ? row.event_type : "message";
                    const payload = JSON.parse(row.payload_json);
                    reply.raw.write(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
                    lastCursor = row.cursor;
                }
            }
            catch { /* ignore poll errors */ }
        }, 500);
        await new Promise((resolve) => {
            request.raw.on("close", () => {
                clearInterval(interval);
                clearInterval(pollInterval);
                resolve();
            });
        });
    });
    // --- commands fallback ---
    app.post("/api/commands/:command", async (request, reply) => {
        const command = request.params.command;
        const body = (request.body ?? {});
        const input = (body.input ?? body ?? {});
        switch (command) {
            case "middleware_usage":
                return usageResponse(context, Number(input.days) || 30);
            case "middleware_usage_daily":
                return dailyUsage(Number(input.days) || 30);
            case "middleware_models_list":
                return modelsResponse(readOCPlatformConfig());
            case "middleware_models_set_default": {
                const modelId = String(input.modelId || input.modelRef || "").trim();
                if (!modelId)
                    return reply.code(400).send({ ok: false, error: { message: "modelId is required" } });
                const cfg = readOCPlatformConfig();
                cfg.agents ??= {};
                cfg.agents.defaults ??= {};
                cfg.agents.defaults.model ??= {};
                if (typeof cfg.agents.defaults.model === "string")
                    cfg.agents.defaults.model = { primary: cfg.agents.defaults.model };
                cfg.agents.defaults.model.primary = modelId;
                fs.writeFileSync(path.join(os.homedir(), ".openclaw", "openclaw.json"), JSON.stringify(cfg, null, 2), "utf8");
                return { ok: true, modelId, currentModel: modelId, defaultModel: modelId };
            }
            case "middleware_models_auth_status":
                return { providers: [], configured: true };
            case "middleware_voice_settings_get":
                return voiceSettingsPayload();
            case "middleware_voice_settings_set":
                return writeVoiceSettings(input);
            case "middleware_onboarding_provider_details": {
                const providerId = String(input.providerId || "").trim();
                if (!providerId)
                    return reply.code(400).send({ ok: false, error: { message: "providerId is required" } });
                return providerDetails(providerId);
            }
            case "middleware_onboarding_provider_submit": {
                const saved = saveProviderCredentials(input);
                if (!saved.ok)
                    return reply.code(400).send(saved);
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
                if (!stored.ok)
                    return reply.code(400).send(stored);
                return stored;
            }
            case "middleware_memory_recall":
                return recallMemoryEntries();
            case "middleware_commands_list":
                return { commands: [] };
            case "middleware_skills_discover":
                return skillsDiscover(input);
            case "middleware_skills_installed_local":
            case "middleware_skills_installed":
                return skillsInstalledLocal(input);
            case "middleware_skills_detail":
                return skillsDetail(input);
            case "middleware_skills_versions":
                return skillsVersions(input);
            case "middleware_skills_install":
                return installSkill(context, input);
            case "middleware_skills_uninstall":
                return uninstallSkill(input);
            case "middleware_skills_toggle":
                return toggleSkill(input);
            case "middleware_skills_enabled_map":
                return getSkillEnabledMap();
            case "middleware_skills_active":
                return getActiveSkills();
            case "middleware_autonaming_quick": {
                const name = String(input.text || input.prompt || "New Chat").replace(/\s+/g, " ").trim().slice(0, 60) || "New Chat";
                return { name, title: name };
            }
            case "middleware_chat_history": {
                const sessionKey = String(input.sessionKey ?? "");
                if (!sessionKey)
                    return reply.code(400).send({ ok: false, error: { message: "sessionKey required" } });
                try {
                    const rows = context.messages.listMessages(sessionKey, { limit: 1000 });
                    return { messages: rows.map((r) => r.data) };
                }
                catch {
                    return { messages: [] };
                }
            }
            case "middleware_chat_model_set": {
                const sessionKey = String(input.sessionKey ?? "");
                const modelId = String(input.modelId ?? "");
                if (!sessionKey || !modelId)
                    return reply.code(400).send({ ok: false, error: { message: "sessionKey and modelId required" } });
                try {
                    await context.gateway.request("sessions.patch", { sessionKey, patch: { model: { primary: modelId } } });
                    return { ok: true };
                }
                catch (error) {
                    return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Model switch failed" } });
                }
            }
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
                const gateway = await connectGatewayForStatus(context);
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
                const approvalId = String(input.approvalId ?? "");
                const decision = String(input.decision ?? "deny");
                if (!approvalId)
                    return reply.code(400).send({ ok: false, error: { message: "approvalId required" } });
                try {
                    await context.gateway.request("exec.approval.resolve", { approvalId, decision });
                    return { ok: true };
                }
                catch (error) {
                    return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Approval resolution failed" } });
                }
            }
            case "middleware_git_commit_details": {
                const repoRoot = String(input.repoRoot ?? input.repoPath ?? "");
                const root = input.projectId ? projectRoot(String(input.projectId)) : repoRoot;
                const hash = String(input.hash ?? input.commit ?? "");
                if (!root || !hash)
                    return { diff: "" };
                return gitCommitDetails(root, hash);
            }
            case "middleware_memory_list": {
                const documents = listMemoryDocuments();
                return { documents, files: documents };
            }
            case "middleware_memory_read": {
                const filePath = safeWorkspaceFilePath(input.path, "memory/notes.md");
                if (!fs.existsSync(filePath))
                    return { content: "" };
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
                    spaces: compatState.spaces.filter((space) => {
                        const archived = input.archived === true || input.archived === "true";
                        return archived ? Boolean(space.archived) && notDeleted(space) : visibleSpace(space);
                    }),
                    activeSpaceId: activeSpaceId(),
                };
            case "middleware_spaces_create": {
                const timestamp = nowIso();
                const space = {
                    id: id("space"),
                    name: input.name || "New Space",
                    archived: false,
                    deleted: false,
                    sortOrder: compatState.spaces.length,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                };
                compatState.spaces.push(space);
                compatState.activeSpaceId = space.id;
                saveCompatState(context);
                return { space, activeSpaceId: space.id };
            }
            case "middleware_spaces_update": {
                const spaceId = String(input.spaceId ?? "");
                if (!spaceId)
                    return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
                const space = patchById(compatState.spaces, spaceId, input);
                if (!space)
                    return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
                if (space.archived && compatState.activeSpaceId === space.id) {
                    compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
                }
                saveCompatState(context);
                return { space, activeSpaceId: activeSpaceId() };
            }
            case "middleware_spaces_rename": {
                const spaceId = String(input.spaceId ?? "");
                if (!spaceId)
                    return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
                const space = patchById(compatState.spaces, spaceId, { name: input.name || "New Space" });
                if (!space)
                    return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
                saveCompatCollection(context, "spaces");
                return { space, activeSpaceId: activeSpaceId() };
            }
            case "middleware_spaces_archive": {
                const spaceId = String(input.spaceId ?? "");
                if (!spaceId)
                    return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
                const archived = input.archived ?? true;
                const space = patchById(compatState.spaces, spaceId, { archived });
                if (!space)
                    return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
                if (archived)
                    archiveChatsForSpace(spaceId);
                else
                    restoreChatsForSpace(spaceId);
                if (archived && compatState.activeSpaceId === space.id) {
                    compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
                }
                saveCompatState(context);
                return { ok: true, activeSpaceId: activeSpaceId(), space, archived };
            }
            case "middleware_spaces_switch": {
                const spaceId = String(input.spaceId ?? "");
                if (!spaceId)
                    return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
                const space = compatState.spaces.find((item) => item.id === spaceId && visibleSpace(item));
                if (!space)
                    return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
                space.updatedAt = nowIso();
                compatState.activeSpaceId = space.id;
                saveCompatState(context);
                return { activeSpaceId: space.id, space };
            }
            case "middleware_spaces_delete": {
                const spaceId = String(input.spaceId ?? "");
                if (!spaceId)
                    return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
                return deleteCompatSpace(context, spaceId);
            }
            case "middleware_sessions_create": {
                const sessionKey = String(input.sessionKey || `agent:main:desktop:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
                const timestamp = nowIso();
                try {
                    await context.gateway.request("sessions.create", {
                        key: sessionKey,
                        agentId: input.agentId || "main",
                        label: gatewaySessionLabel(input.label, sessionKey),
                    });
                }
                catch { /* session may already exist */ }
                const session = {
                    id: id("session"),
                    sessionKey,
                    projectId: input.projectId || null,
                    topicId: input.topicId || null,
                    agentId: input.agentId || "main",
                    label: input.label || "New Chat",
                    createdAt: timestamp,
                    updatedAt: timestamp,
                };
                compatState.sessions.push(session);
                saveCompatCollection(context, "sessions");
                return { session };
            }
            case "middleware_chats_delete": {
                const chatId = String(input.chatId ?? "");
                if (!chatId)
                    return reply.code(400).send({ ok: false, error: { message: "chatId required" } });
                return deleteCompatChat(context, chatId);
            }
            case "middleware_chats_create": {
                const sessionKey = String(input.sessionKey || `agent:main:desktop:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
                const timestamp = nowIso();
                try {
                    await context.gateway.request("sessions.create", {
                        key: sessionKey,
                        agentId: input.agentId || "main",
                        label: gatewaySessionLabel(input.name, sessionKey),
                    });
                }
                catch { /* session may already exist */ }
                const chat = {
                    id: id("chat"),
                    name: input.name || "New Chat",
                    sessionKey,
                    spaceId: input.spaceId || activeSpaceId(),
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
                    projectId: input.projectId || null,
                    topicId: input.topicId || null,
                    agentId: input.agentId || "main",
                    label: input.name || "New Chat",
                    createdAt: timestamp,
                    updatedAt: timestamp,
                };
                compatState.chats.push(chat);
                compatState.sessions.push(session);
                saveCompatState(context);
                return { chat, session };
            }
            case "middleware_chat_stop": {
                const sk = String(input.sessionKey ?? "");
                if (!sk)
                    return reply.code(400).send({ ok: false, error: { message: "sessionKey required" } });
                try {
                    await context.gateway.request("sessions.abort", { sessionKey: sk });
                }
                catch { /* may not be running */ }
                return { ok: true };
            }
            case "middleware_cron_list":
            case "middleware_cron_list_jobs":
                return cronListJobsGateway(context).catch(() => cronListJobs());
            case "middleware_cron_get_job":
                return cronGetJobGateway(context, input.jobId || input.id).catch(() => ({ job: findCronJob(input.jobId || input.id) }));
            case "middleware_cron_create_job": {
                try {
                    return await cronCreateJobGateway(context, input);
                }
                catch (error) {
                    return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Cron job create failed" } });
                }
            }
            case "middleware_cron_update_job": {
                try {
                    const result = await cronUpdateJobGateway(context, input);
                    if (!result)
                        return reply.code(404).send({ ok: false, error: { message: "Cron job not found" } });
                    return result;
                }
                catch (error) {
                    return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Cron job update failed" } });
                }
            }
            case "middleware_cron_delete_job": {
                try {
                    const deleted = await cronDeleteJobGateway(context, input);
                    if (!deleted)
                        return reply.code(404).send({ ok: false, error: { message: "Cron job not found" } });
                    return { ok: true, deleted: true, jobId: input.jobId || input.id };
                }
                catch (error) {
                    return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Cron job delete failed" } });
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
            case "middleware_cron_job_conversation": {
                const run = compatState.cronRuns.find((item) => item.jobId === input.jobId || item.runId === input.runId || item.id === input.runId);
                if (!run?.sessionKey)
                    return { messages: [], lastRun: run ?? null };
                try {
                    const history = await context.gateway.request("chat.history", { sessionKey: run.sessionKey }, 30_000);
                    return { ...(history || {}), messages: history?.messages ?? [], lastRun: run };
                }
                catch {
                    return { messages: [], lastRun: run };
                }
            }
            default:
                // Safe fallback: return empty ok instead of 404 so UI doesn't crash on unimplemented commands
                return { ok: true };
        }
    });
    // --- migration stubs ---
    app.get("/api/migration/telegram/scan", async () => ({ sessions: [], count: 0 }));
    app.post("/api/migration/telegram/import", async () => ({ ok: true, imported: 0 }));
    app.post("/api/migration/v1-sqlite/import", async (request) => {
        const body = (request.body ?? {});
        return migrateV1SqliteToV2(context, body.sourcePath);
    });
    // --- self-update stubs ---
    app.get("/api/middleware/update/status", async () => ({ available: false, current: "0.1.0" }));
    app.post("/api/middleware/update", async () => ({ ok: true, status: "up-to-date" }));
    // --- terminal spawn ---
    app.post("/api/terminal/spawn", async (request) => {
        const body = (request.body ?? {});
        const cwd = String(body.cwd ?? body.workspaceRoot ?? process.env.WORKSPACE_ROOT ?? path.join(os.homedir(), ".openclaw", "workspace"));
        return spawnTerminal(cwd, body);
    });
    app.post("/api/projects/:projectId/terminal/spawn", async (request, reply) => {
        const root = projectRoot(request.params.projectId);
        if (!root)
            return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
        return spawnTerminal(root, (request.body ?? {}));
    });
    app.post("/api/terminal/:ptyId/write", async (request, reply) => {
        const term = getTerminal(request.params.ptyId);
        if (!term)
            return reply.code(404).send({ ok: false, error: { message: "Terminal not found" } });
        const body = (request.body ?? {});
        term.proc.write(String(body.data ?? ""));
        return { ok: true };
    });
    app.post("/api/terminal/:ptyId/resize", async (request) => {
        const term = getTerminal(request.params.ptyId);
        if (!term)
            return { ok: true };
        const body = (request.body ?? {});
        term.proc.resize(Number(body.cols ?? 80), Number(body.rows ?? 24));
        return { ok: true };
    });
    app.post("/api/terminal/:ptyId/kill", async (request) => {
        const term = getTerminal(request.params.ptyId);
        if (term) {
            term.proc.kill();
            compatState.terminals.delete(request.params.ptyId);
        }
        return { ok: true };
    });
    // --- terminal stream (SSE) ---
    app.get("/api/terminal/:ptyId/stream", async (request, reply) => {
        const term = getTerminal(request.params.ptyId);
        if (!term)
            return reply.code(404).send({ ok: false, error: { message: "Terminal not found" } });
        reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        for (const data of term.buffer) {
            reply.raw.write(`event: data\ndata: ${JSON.stringify({ type: "terminal.data", terminalId: term.id, data })}\n\n`);
        }
        const listener = (event, payload) => {
            reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        };
        term.listeners.add(listener);
        request.raw.on("close", () => term.listeners.delete(listener));
    });
    // --- terminal WebSocket ---
    app.get("/api/terminal/:ptyId/ws", { websocket: true }, async (socket, request) => {
        const term = getTerminal(request.params.ptyId);
        if (!term) {
            socket.close();
            return;
        }
        for (const data of term.buffer) {
            socket.send(JSON.stringify({ event: "data", data: { type: "terminal.data", terminalId: term.id, data } }));
        }
        const listener = (event, payload) => {
            if (socket.readyState === 1)
                socket.send(JSON.stringify({ event, data: payload }));
        };
        term.listeners.add(listener);
        socket.on("message", (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === "write" && typeof msg.data === "string")
                    term.proc.write(msg.data);
                if (msg.type === "resize" && msg.cols && msg.rows)
                    term.proc.resize(msg.cols, msg.rows);
                if (msg.type === "kill") {
                    term.proc.kill();
                    compatState.terminals.delete(term.id);
                }
            }
            catch { }
        });
        socket.on("close", () => term.listeners.delete(listener));
    });
    // --- pairing ---
    app.post("/pairing/claim", async (request, reply) => {
        const body = (request.body ?? {});
        const code = String(body.code ?? "").trim().toUpperCase();
        const expectedCode = String(context.config.pairingCode ?? process.env.MIDDLEWARE_PAIRING_CODE ?? "").trim().toUpperCase();
        if (!expectedCode || code !== expectedCode) {
            return reply.code(403).send({ ok: false, error: { code: "INVALID_PAIRING_CODE", message: "Invalid pairing code" } });
        }
        const host = request.headers.host ?? `127.0.0.1:${context.config.port}`;
        const url = `http://${host}`;
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
