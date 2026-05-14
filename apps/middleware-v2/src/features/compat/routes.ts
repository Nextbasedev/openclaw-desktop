import { execFileSync, spawn as spawnChild, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { IPty } from "node-pty";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";
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

type CompatRecord = Record<string, any>;

const nowIso = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const shortSessionId = (sessionKey: string) => (sessionKey.split(":").pop() || sessionKey).replace(/[^a-zA-Z0-9_-]/g, "").slice(-8) || Date.now().toString(36);
const gatewaySessionLabel = (label: unknown, sessionKey: string) => {
  const base = String(label || "New Chat").replace(/\s+/g, " ").trim().slice(0, 60) || "New Chat";
  return `${base} · ${shortSessionId(sessionKey)}`;
};

type CompatTerminal = {
  id: string;
  proc: IPty;
  cwd: string;
  buffer: string[];
  listeners: Set<(event: string, payload: CompatRecord) => void>;
};

const compatState = {
  spaces: [] as CompatRecord[],
  activeSpaceId: null as string | null,
  chats: [] as CompatRecord[],
  projects: [] as CompatRecord[],
  topics: [] as CompatRecord[],
  sessions: [] as CompatRecord[],
  terminals: new Map<string, CompatTerminal>(),
  loadedDbPath: null as string | null,
};

const DEFAULT_SPACE_ID = "space_default";
const DEFAULT_SPACE_NAME = "My Workspace";

const compatCollections = ["spaces", "chats", "projects", "topics", "sessions"] as const;

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
    if (typeof space.name === "string" && space.name.trim() && space.name !== "Default") return space;
    changed = true;
    return { ...space, name: DEFAULT_SPACE_NAME, updatedAt: nowIso() };
  });
  compatState.loadedDbPath = context.config.databasePath;
  if (changed) saveCompatState(context);
}

function saveCompatState(context: AppContext) {
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

function saveCompatCollection(context: AppContext, _collection?: CompatCollection) {
  saveCompatState(context);
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
  const totals = { imported: 0, updated: 0, skipped: 0, spaces: 0, chats: 0, projects: 0, topics: 0, sessions: 0 };
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

function timeMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestTimestamp(...values: unknown[]) {
  const newest = values.reduce<number>((max, value) => Math.max(max, timeMs(value)), 0);
  return newest > 0 ? new Date(newest).toISOString() : nowIso();
}

function chatActivityMs(chat: CompatRecord) {
  return Math.max(timeMs(chat.updatedAt), timeMs(chat.lastActiveAt), timeMs(chat.lastMessageAt), timeMs(chat.createdAt));
}

function sortedChatsForResponse(spaceId?: unknown, archived?: boolean) {
  return listBySpace(compatState.chats, spaceId)
    .filter((chat) => typeof archived === "boolean" ? Boolean(chat.archived) === archived : !chat.archived)
    .sort((a, b) => chatActivityMs(b) - chatActivityMs(a));
}

function touchCompatChatActivity(context: AppContext, input: { sessionKey: string; at?: string; lastMessageText?: string | null }) {
  loadCompatState(context);
  const sessionKey = input.sessionKey.trim();
  if (!sessionKey) return;
  const timestamp = input.at && timeMs(input.at) > 0 ? new Date(timeMs(input.at)).toISOString() : nowIso();
  const defaultSpace = ensureDefaultSpace();

  let chat = compatState.chats.find((record) => record.sessionKey === sessionKey);
  if (!chat) {
    chat = {
      id: stableCompatId("chat", sessionKey),
      name: "New Chat",
      sessionKey,
      spaceId: defaultSpace.id,
      agentId: "main",
      archived: false,
      pinned: false,
      createdAt: timestamp,
    };
    compatState.chats.push(chat);
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

async function syncGatewaySessions(context: AppContext) {
  try {
    const payload = await context.gateway.request("sessions.list", { limit: 500, includeDerivedTitles: true, includeLastMessage: true }, 10_000);
    const rows = gatewaySessionRows(payload);
    if (rows.length === 0) return;
    const defaultSpace = ensureDefaultSpace();
    let changed = false;
    for (const row of rows) {
      const sessionKey = stringField(row, ["key", "sessionKey"]);
      if (!sessionKey) continue;
      const name = labelFromGatewaySession(row, sessionKey);
      const agentId = stringField(row, ["agentId", "agent_id"]) ?? "main";
      const createdAt = timestampField(row, ["createdAt", "created_at"]);
      const updatedAt = timestampField(row, ["lastMessageAt", "lastActiveAt", "updatedAt", "updated_at"]);

      const chatIndex = compatState.chats.findIndex((chat) => chat.sessionKey === sessionKey);
      if (chatIndex < 0) {
        compatState.chats.push({
          id: stableCompatId("chat", sessionKey),
          name,
          sessionKey,
          spaceId: defaultSpace.id,
          agentId,
          archived: false,
          pinned: false,
          createdAt,
          updatedAt,
          lastActiveAt: updatedAt,
        });
        changed = true;
      } else {
        const existing = compatState.chats[chatIndex];
        const nextUpdatedAt = newestTimestamp(existing.updatedAt, existing.lastActiveAt, existing.lastMessageAt, updatedAt);
        const next = { ...existing, name: existing.name || name, agentId: existing.agentId || agentId, updatedAt: nextUpdatedAt, lastActiveAt: nextUpdatedAt, lastMessageAt: nextUpdatedAt };
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
          updatedAt,
        });
        changed = true;
      } else {
        const existing = compatState.sessions[sessionIndex];
        const nextUpdatedAt = newestTimestamp(existing.updatedAt, existing.lastActiveAt, existing.lastMessageAt, updatedAt);
        const next = { ...existing, key: existing.key || sessionKey, sessionKey, agentId: existing.agentId || agentId, label: existing.label || name, updatedAt: nextUpdatedAt, lastActiveAt: nextUpdatedAt, lastMessageAt: nextUpdatedAt };
        if (JSON.stringify(next) !== JSON.stringify(existing)) {
          compatState.sessions[sessionIndex] = next;
          changed = true;
        }
      }
    }
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

function patchById(records: CompatRecord[], idValue: string, patch: CompatRecord) {
  const index = records.findIndex((record) => record.id === idValue);
  if (index < 0) return null;
  records[index] = { ...records[index], ...patch, updatedAt: nowIso() };
  return records[index];
}

function archiveChatsForSpace(spaceId: string) {
  const timestamp = nowIso();
  compatState.chats = compatState.chats.map((chat) => {
    if (chat.spaceId !== spaceId || chat.archived) return chat;
    return { ...chat, archived: true, updatedAt: timestamp };
  });
}

function restoreChatsForSpace(spaceId: string) {
  const timestamp = nowIso();
  compatState.chats = compatState.chats.map((chat) => {
    if (chat.spaceId !== spaceId || !chat.archived) return chat;
    return { ...chat, archived: false, updatedAt: timestamp };
  });
}

async function deleteCompatChat(context: AppContext, chatId: string) {
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

function readOCPlatformConfig(): CompatRecord {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".openclaw", "openclaw.json"), "utf8")); } catch { return {}; }
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

function modelsResponse(cfg: CompatRecord) {
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


function openclawWorkspaceRoot() {
  const cfg = readOCPlatformConfig();
  const configured = cfg.agents?.defaults?.workspace || cfg.workspaceRoot || cfg.workspace_root || process.env.WORKSPACE_ROOT;
  return typeof configured === "string" && configured.trim() ? configured : path.join(os.homedir(), ".openclaw", "workspace");
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

function userHomeDir() {
  return process.env.HOME || os.homedir();
}

function usageFromSessions(requestedDays = 30) {
  const usage: CompatRecord[] = [];
  const days = new Map<string, CompatRecord>();
  const cutoff = Date.now() - Math.max(1, requestedDays) * 24 * 60 * 60 * 1000;
  const agentsRoot = path.join(userHomeDir(), ".openclaw", "agents");
  if (fs.existsSync(agentsRoot)) {
    for (const agent of fs.readdirSync(agentsRoot)) {
      const sessionsDir = path.join(agentsRoot, agent, "sessions");
      if (!fs.existsSync(sessionsDir)) continue;
      for (const file of fs.readdirSync(sessionsDir)) {
        if (!file.endsWith(".jsonl") || file.endsWith(".trajectory.jsonl")) continue;
        const full = path.join(sessionsDir, file);
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
            if (timestampMs < cutoff) continue;
            const cost = usageNumber((raw.cost && typeof raw.cost === "object" ? (raw.cost as CompatRecord).total : undefined) ?? raw.totalCost);
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
          } catch {
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

async function usageProviders(context: AppContext) {
  try {
    const status = await context.gateway.request<CompatRecord>("usage.status", {}, 30_000);
    const payload = status.payload && typeof status.payload === "object" ? status.payload as CompatRecord : status;
    return Array.isArray(payload.providers) ? payload.providers : [];
  } catch {
    return [];
  }
}

async function usageResponse(context: AppContext, days: number) {
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

function dailyUsage(days: number) {
  const usage = usageFromSessions(days);
  const daily = frontendDaily(usage.days);
  return { range: { days }, daily, days: usage.days, source: usage.source, unavailable: usage.unavailable };
}

async function connectGatewayForStatus(context: AppContext) {
  try {
    await context.gateway.connect();
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

async function spawnTerminal(cwd: string, body: CompatRecord = {}) {
  const idValue = id("term");
  const proc = await spawnPty(terminalShell(), cwd, Number(body.cols ?? 80), Number(body.rows ?? 24));
  const term: CompatTerminal = { id: idValue, proc, cwd, buffer: [], listeners: new Set() };
  proc.onData((data) => {
    term.buffer.push(data);
    if (term.buffer.length > 200) term.buffer.shift();
    broadcastTerminal(term, "data", { type: "terminal.data", terminalId: idValue, data });
  });
  proc.onExit((event) => {
    broadcastTerminal(term, "exit", { type: "terminal.exit", terminalId: idValue, exitCode: event.exitCode ?? 0 });
    compatState.terminals.delete(idValue);
  });
  compatState.terminals.set(idValue, term);
  return { terminalId: idValue, cwd, streamUrl: `/api/terminal/${idValue}/stream`, websocketUrl: `/api/terminal/${idValue}/ws` };
}

function getTerminal(terminalId: string) {
  return compatState.terminals.get(terminalId) ?? null;
}

export async function registerCompatRoutes(app: FastifyInstance, context: AppContext) {
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
    const query = request.query as CompatRecord;
    const archived = query.archived === "true" || query.archived === true;
    return {
      spaces: compatState.spaces.filter((space) => archived ? Boolean(space.archived) && notDeleted(space) : visibleSpace(space)),
      activeSpaceId: activeSpaceId(),
    };
  });

  app.post("/api/spaces", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
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

  app.patch<{ Params: { spaceId: string } }>("/api/spaces/:spaceId", async (request, reply) => {
    const space = patchById(compatState.spaces, request.params.spaceId, request.body as CompatRecord);
    if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
    if (space.archived && compatState.activeSpaceId === space.id) {
      compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
    }
    saveCompatCollection(context, "spaces");
    return { space };
  });

  app.post<{ Params: { spaceId: string } }>("/api/spaces/:spaceId/archive", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const archived = body.archived ?? true;
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
    patchById(compatState.spaces, request.params.spaceId, { deleted: true });
    if (compatState.activeSpaceId === request.params.spaceId) {
      compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
    }
    saveCompatState(context);
    return { ok: true };
  });

  app.get("/api/chats", async (request) => {
    await syncGatewaySessions(context);
    const query = request.query as CompatRecord;
    const archived = query.archived === "true" || query.archived === true;
    return {
      chats: sortedChatsForResponse(query.spaceId, archived),
    };
  });

  app.post("/api/chats", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const timestamp = nowIso();
    const sessionKey = String(body.sessionKey || `agent:${body.agentId || "main"}:desktop:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    void context.gateway.request("sessions.create", {
      key: sessionKey,
      agentId: body.agentId || "main",
      label: gatewaySessionLabel(body.name, sessionKey),
    }).catch(() => { /* session may already exist or gateway may be offline */ });
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
    return { space, activeSpaceId: activeSpaceId() };
  });

  app.post<{ Params: { chatId: string } }>("/api/chats/:chatId/archive", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const chat = patchById(compatState.chats, request.params.chatId, { archived: body.archived ?? true });
    if (!chat) return reply.code(404).send({ ok: false, error: { message: "Chat not found" } });
    saveCompatCollection(context, "chats");
    return { chat };
  });

  app.delete<{ Params: { chatId: string } }>("/api/chats/:chatId", async (request) => {
    return deleteCompatChat(context, request.params.chatId);
  });

  app.post<{ Params: { chatId: string } }>("/api/chats/:chatId/session", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
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

  app.get("/api/projects", async (request) => ({ projects: listBySpace(compatState.projects, (request.query as CompatRecord).spaceId) }));
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
    return { topics: compatState.topics.filter((topic) => notDeleted(topic) && (!query.projectId || topic.projectId === query.projectId)) };
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
    await syncGatewaySessions(context);
    const query = request.query as CompatRecord;
    return {
      sessions: compatState.sessions.filter((session) =>
        notDeleted(session) &&
        (!query.projectId || session.projectId === query.projectId) &&
        (!query.topicId || session.topicId === query.topicId)
      ),
    };
  });
  app.post("/api/sessions", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const timestamp = nowIso();
    const sessionKey = String(body.sessionKey || `agent:${body.agentId || "main"}:desktop:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    void context.gateway.request("sessions.create", {
      key: sessionKey,
      agentId: body.agentId || "main",
      label: gatewaySessionLabel(body.label, sessionKey),
    }).catch(() => { /* session may already exist or gateway may be offline */ });
    const session = { id: id("session"), ...body, key: sessionKey, sessionKey, createdAt: timestamp, updatedAt: timestamp };
    compatState.sessions.push(session);
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
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/workspace/tree", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    const rel = String((request.query as CompatRecord).path ?? "");
    try {
      const dir = safeJoin(root, rel);
      const entries = fs.readdirSync(dir, { withFileTypes: true }).map((entry) => workspaceEntry(root, path.join(dir, entry.name)));
      return { entries };
    } catch { return { entries: [] }; }
  });
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/workspace/file", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    const rel = String((request.query as CompatRecord).path ?? "");
    try {
      const file = safeJoin(root, rel);
      const content = fs.readFileSync(file, "utf8");
      return { path: rel, content, encoding: "utf-8", file: { path: rel, content, encoding: "utf-8" } };
    } catch { return reply.code(404).send({ ok: false, error: { message: "File not found" } }); }
  });
  app.put<{ Params: { projectId: string } }>("/api/projects/:projectId/workspace/file", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    const body = (request.body ?? {}) as CompatRecord;
    const rel = String(body.path ?? "");
    try {
      const file = safeJoin(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, String(body.content ?? ""), "utf8");
      return { ok: true, path: rel };
    } catch { return reply.code(500).send({ ok: false, error: { message: "Write failed" } }); }
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
    reply.raw.write("event: cron.ready\ndata: {\"ok\":true}\n\n");
    const interval = setInterval(() => reply.raw.write(":heartbeat\n\n"), 15_000);
    await new Promise<void>((resolve) => {
      request.raw.on("close", () => {
        clearInterval(interval);
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

    switch (command) {
      case "middleware_usage":
        return usageResponse(context, Number(input.days) || 30);
      case "middleware_usage_daily":
        return dailyUsage(Number(input.days) || 30);
      case "middleware_models_list":
        return modelsResponse(readOCPlatformConfig());
      case "middleware_models_set_default": {
        const modelId = String(input.modelId || input.modelRef || "").trim();
        if (!modelId) return reply.code(400).send({ ok: false, error: { message: "modelId is required" } });
        const cfg = readOCPlatformConfig();
        cfg.agents ??= {}; cfg.agents.defaults ??= {}; cfg.agents.defaults.model ??= {};
        if (typeof cfg.agents.defaults.model === "string") cfg.agents.defaults.model = { primary: cfg.agents.defaults.model };
        cfg.agents.defaults.model.primary = modelId;
        fs.writeFileSync(path.join(os.homedir(), ".openclaw", "openclaw.json"), JSON.stringify(cfg, null, 2), "utf8");
        return { ok: true, modelId, currentModel: modelId, defaultModel: modelId };
      }
      case "middleware_models_auth_status":
        return { providers: [], configured: true };
      case "middleware_commands_list":
        return { commands: [] };
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
        const name = String(input.text || input.prompt || "New Chat").replace(/\s+/g, " ").trim().slice(0, 60) || "New Chat";
        return { name, title: name };
      }
      case "middleware_chat_history": {
        const sessionKey = String(input.sessionKey ?? "");
        if (!sessionKey) return reply.code(400).send({ ok: false, error: { message: "sessionKey required" } });
        try {
          const rows = context.messages.listMessages(sessionKey, { limit: 1000 });
          return { messages: rows.map((r) => r.data) };
        } catch { return { messages: [] }; }
      }
      case "middleware_chat_model_set": {
        const sessionKey = String(input.sessionKey ?? "");
        const modelId = String(input.modelId ?? "");
        if (!sessionKey || !modelId) return reply.code(400).send({ ok: false, error: { message: "sessionKey and modelId required" } });
        try {
          await context.gateway.request("sessions.patch", { sessionKey, patch: { model: { primary: modelId } } });
          return { ok: true };
        } catch (error) { return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Model switch failed" } }); }
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
        if (!approvalId) return reply.code(400).send({ ok: false, error: { message: "approvalId required" } });
        try {
          await context.gateway.request("exec.approval.resolve", { approvalId, decision });
          return { ok: true };
        } catch (error) { return reply.code(500).send({ ok: false, error: { message: error instanceof Error ? error.message : "Approval resolution failed" } }); }
      }
      case "middleware_git_commit_details": {
        const repoRoot = String(input.repoRoot ?? input.repoPath ?? "");
        const root = input.projectId ? projectRoot(String(input.projectId)) : repoRoot;
        const hash = String(input.hash ?? input.commit ?? "");
        if (!root || !hash) return { diff: "" };
        return gitCommitDetails(root, hash);
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
        if (!spaceId) return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
        const space = patchById(compatState.spaces, spaceId, input);
        if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
        if (space.archived && compatState.activeSpaceId === space.id) {
          compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
        }
        saveCompatState(context);
        return { space, activeSpaceId: activeSpaceId() };
      }
      case "middleware_spaces_rename": {
        const spaceId = String(input.spaceId ?? "");
        if (!spaceId) return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
        const space = patchById(compatState.spaces, spaceId, { name: input.name || "New Space" });
        if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
        saveCompatCollection(context, "spaces");
        return { space, activeSpaceId: activeSpaceId() };
      }
      case "middleware_spaces_archive": {
        const spaceId = String(input.spaceId ?? "");
        if (!spaceId) return reply.code(400).send({ ok: false, error: { message: "spaceId required" } });
        const archived = input.archived ?? true;
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
        patchById(compatState.spaces, spaceId, { deleted: true });
        if (compatState.activeSpaceId === spaceId) {
          compatState.activeSpaceId = compatState.spaces.find((item) => visibleSpace(item))?.id ?? ensureDefaultSpace().id;
        }
        saveCompatState(context);
        return { ok: true, activeSpaceId: activeSpaceId() };
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
        } catch { /* session may already exist */ }
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
        if (!chatId) return reply.code(400).send({ ok: false, error: { message: "chatId required" } });
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
        } catch { /* session may already exist */ }
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
        if (!sk) return reply.code(400).send({ ok: false, error: { message: "sessionKey required" } });
        try { await context.gateway.request("sessions.abort", { sessionKey: sk }); } catch { /* may not be running */ }
        return { ok: true };
      }
      case "middleware_cron_list":
      case "middleware_cron_get_job":
        return { jobs: [], job: null };
      default:
        // Safe fallback: return empty ok instead of 404 so UI doesn't crash on unimplemented commands
        return { ok: true };
    }
  });

  // --- migration stubs ---
  app.get("/api/migration/telegram/scan", async () => ({ sessions: [], count: 0 }));
  app.post("/api/migration/telegram/import", async () => ({ ok: true, imported: 0 }));
  app.post("/api/migration/v1-sqlite/import", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    return migrateV1SqliteToV2(context, body.sourcePath);
  });

  // --- self-update stubs ---
  app.get("/api/middleware/update/status", async () => ({ available: false, current: "0.1.0" }));
  app.post("/api/middleware/update", async () => ({ ok: true, status: "up-to-date" }));

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
    if (term) { term.proc.kill(); compatState.terminals.delete(request.params.ptyId); }
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
    const listener = (event: string, payload: CompatRecord) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    term.listeners.add(listener);
    request.raw.on("close", () => term.listeners.delete(listener));
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
        if (msg.type === "kill") { term.proc.kill(); compatState.terminals.delete(term.id); }
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
