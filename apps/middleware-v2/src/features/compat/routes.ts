import { execFileSync, spawn as spawnChild, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";

type CompatRecord = Record<string, any>;

const nowIso = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

type CompatTerminal = {
  id: string;
  child: ChildProcessWithoutNullStreams;
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
};

function ensureDefaultSpace() {
  if (compatState.spaces.length > 0) return compatState.spaces[0];
  const timestamp = nowIso();
  const space = {
    id: "space_default",
    name: "Default",
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
  return compatState.activeSpaceId ?? ensureDefaultSpace().id;
}

function notDeleted(record: CompatRecord) {
  return !record.deleted;
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
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitStatus(repo: string) {
  const raw = git(repo, ["status", "--short"]);
  const files = raw.split(/\r?\n/).filter(Boolean).map((line) => ({ path: line.slice(3), status: line.slice(0, 2).trim() || "modified" }));
  return { dirty: files.length > 0, files };
}

function gitBranches(repo: string) {
  const current = git(repo, ["branch", "--show-current"]).trim();
  const branches = git(repo, ["branch", "--format=%(refname:short)"]).split(/\r?\n/).filter(Boolean).map((name) => ({ name, current: name === current }));
  return { branches, current };
}

function workspaceEntry(root: string, full: string, stat = fs.statSync(full)) {
  return { name: path.basename(full), path: path.relative(root, full).replace(/\\/g, "/"), type: stat.isDirectory() ? "directory" : "file", size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

function emptyUsage(days: number, providers: unknown[] = [], unavailable?: string) {
  return {
    range: { days },
    summary: { totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
    providers,
    usage: [],
    source: "middleware-v2-compat",
    unavailable,
  };
}

function dailyUsage(days: number) {
  const today = new Date();
  const daily = Array.from({ length: Math.max(1, days) }, (_, index) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - index - 1));
    const date = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    return { date, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 0, cost_usd: 0 };
  });
  return { range: { days }, daily, days: daily, source: "middleware-v2-compat" };
}

function terminalShell() {
  return process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
}

function broadcastTerminal(term: CompatTerminal, event: string, payload: CompatRecord) {
  const frame = { event, data: payload };
  for (const listener of [...term.listeners]) listener(event, payload);
  return frame;
}

function spawnTerminal(cwd: string) {
  const idValue = id("term");
  const child = spawnChild(terminalShell(), [], { cwd, env: process.env, shell: false });
  const term: CompatTerminal = { id: idValue, child, cwd, buffer: [], listeners: new Set() };
  const onData = (chunk: Buffer) => {
    const data = chunk.toString();
    term.buffer.push(data);
    if (term.buffer.length > 200) term.buffer.shift();
    broadcastTerminal(term, "data", { type: "terminal.data", terminalId: idValue, data });
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => {
    broadcastTerminal(term, "exit", { type: "terminal.exit", terminalId: idValue, exitCode: code ?? 0 });
    compatState.terminals.delete(idValue);
  });
  compatState.terminals.set(idValue, term);
  return { terminalId: idValue, cwd, streamUrl: `/api/terminal/${idValue}/stream`, websocketUrl: `/api/terminal/${idValue}/ws` };
}

function getTerminal(terminalId: string) {
  return compatState.terminals.get(terminalId) ?? null;
}

export async function registerCompatRoutes(app: FastifyInstance, context: AppContext) {
  app.get("/api/version", async () => ({
    ok: true,
    version: "0.1.0",
    service: "openclaw-middleware-v2",
  }));

  app.get("/api/bootstrap", async () => {
    const gateway = context.gateway.status();
    const spaceId = activeSpaceId();
    return {
      ok: true,
      service: "openclaw-middleware-v2",
      spaces: compatState.spaces.filter(notDeleted),
      activeSpaceId: spaceId,
      chats: listBySpace(compatState.chats, spaceId).filter((chat) => !chat.archived),
      projects: listBySpace(compatState.projects, spaceId),
      sessions: compatState.sessions.filter(notDeleted),
      gateway,
    };
  });

  app.get("/api/spaces", async () => ({
    spaces: compatState.spaces.filter(notDeleted),
    activeSpaceId: activeSpaceId(),
  }));

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
    return { space, activeSpaceId: space.id };
  });

  app.patch<{ Params: { spaceId: string } }>("/api/spaces/:spaceId", async (request, reply) => {
    const space = patchById(compatState.spaces, request.params.spaceId, request.body as CompatRecord);
    if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
    return { space };
  });

  app.post<{ Params: { spaceId: string } }>("/api/spaces/:spaceId/switch", async (request, reply) => {
    const space = compatState.spaces.find((item) => item.id === request.params.spaceId && notDeleted(item));
    if (!space) return reply.code(404).send({ ok: false, error: { message: "Space not found" } });
    compatState.activeSpaceId = space.id;
    return { activeSpaceId: space.id, space };
  });

  app.delete<{ Params: { spaceId: string } }>("/api/spaces/:spaceId", async (request) => {
    patchById(compatState.spaces, request.params.spaceId, { deleted: true });
    if (compatState.activeSpaceId === request.params.spaceId) compatState.activeSpaceId = ensureDefaultSpace().id;
    return { ok: true };
  });

  app.get("/api/chats", async (request) => {
    const query = request.query as CompatRecord;
    const archived = query.archived === "true" || query.archived === true;
    return {
      chats: listBySpace(compatState.chats, query.spaceId).filter((chat) => Boolean(chat.archived) === archived),
    };
  });

  app.post("/api/chats", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const timestamp = nowIso();
    const chat = {
      id: id("chat"),
      name: body.name || "New Chat",
      sessionKey: body.sessionKey ?? null,
      spaceId: body.spaceId || activeSpaceId(),
      agentId: body.agentId || "main",
      archived: false,
      pinned: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActiveAt: timestamp,
    };
    compatState.chats.push(chat);
    return { chat };
  });

  app.patch<{ Params: { chatId: string } }>("/api/chats/:chatId", async (request, reply) => {
    const chat = patchById(compatState.chats, request.params.chatId, request.body as CompatRecord);
    if (!chat) return reply.code(404).send({ ok: false, error: { message: "Chat not found" } });
    return { chat };
  });

  app.post<{ Params: { chatId: string } }>("/api/chats/:chatId/rename", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const chat = patchById(compatState.chats, request.params.chatId, { name: body.name || "New Chat" });
    if (!chat) return reply.code(404).send({ ok: false, error: { message: "Chat not found" } });
    return { chat };
  });

  app.post<{ Params: { chatId: string } }>("/api/chats/:chatId/archive", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const chat = patchById(compatState.chats, request.params.chatId, { archived: body.archived ?? true });
    if (!chat) return reply.code(404).send({ ok: false, error: { message: "Chat not found" } });
    return { chat };
  });

  app.delete<{ Params: { chatId: string } }>("/api/chats/:chatId", async (request) => {
    patchById(compatState.chats, request.params.chatId, { deleted: true });
    return { ok: true };
  });

  app.post<{ Params: { chatId: string } }>("/api/chats/:chatId/session", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const chat = patchById(compatState.chats, request.params.chatId, { sessionKey: body.sessionKey ?? null });
    if (!chat) return reply.code(404).send({ ok: false, error: { message: "Chat not found" } });
    return { chat };
  });

  app.get("/api/projects", async (request) => ({ projects: listBySpace(compatState.projects, (request.query as CompatRecord).spaceId) }));
  app.post("/api/projects", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const timestamp = nowIso();
    const project = { id: id("project"), name: body.name || "Untitled Project", spaceId: body.spaceId || activeSpaceId(), ...body, createdAt: timestamp, updatedAt: timestamp };
    compatState.projects.push(project);
    return { project };
  });
  app.patch<{ Params: { projectId: string } }>("/api/projects/:projectId", async (request, reply) => {
    const project = patchById(compatState.projects, request.params.projectId, request.body as CompatRecord);
    if (!project) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    return { project };
  });
  app.delete<{ Params: { projectId: string } }>("/api/projects/:projectId", async (request) => {
    patchById(compatState.projects, request.params.projectId, { deleted: true });
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
    return { topic };
  });
  app.patch<{ Params: { topicId: string } }>("/api/topics/:topicId", async (request, reply) => {
    const topic = patchById(compatState.topics, request.params.topicId, request.body as CompatRecord);
    if (!topic) return reply.code(404).send({ ok: false, error: { message: "Topic not found" } });
    return { topic };
  });
  app.post<{ Params: { topicId: string } }>("/api/topics/:topicId/archive", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const topic = patchById(compatState.topics, request.params.topicId, { archived: body.archived ?? true });
    if (!topic) return reply.code(404).send({ ok: false, error: { message: "Topic not found" } });
    return { topic };
  });
  app.delete<{ Params: { topicId: string } }>("/api/topics/:topicId", async (request) => {
    patchById(compatState.topics, request.params.topicId, { deleted: true });
    return { ok: true };
  });

  app.get("/api/sessions", async (request) => {
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
    const session = { id: id("session"), sessionKey: body.sessionKey || id("agent:main:desktop"), ...body, createdAt: timestamp, updatedAt: timestamp };
    compatState.sessions.push(session);
    return { session };
  });

  // --- project archive ---
  app.post<{ Params: { projectId: string } }>("/api/projects/:projectId/archive", async (request, reply) => {
    const body = (request.body ?? {}) as CompatRecord;
    const project = patchById(compatState.projects, request.params.projectId, { archived: body.archived ?? true });
    if (!project) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    return { project };
  });

  // --- repos ---
  app.get("/api/repos/recent", async () => ({ repos: [] }));
  app.post("/api/repos/scan", async () => ({ repos: [] }));
  app.post("/api/repos/select", async (request) => ({ ok: true, ...(request.body as CompatRecord) }));

  // --- git (project-scoped) ---
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/git/status", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found or has no workspace root" } });
    try { return gitStatus(root); } catch { return { dirty: false, files: [] }; }
  });
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/git/diff", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    const filePath = String((request.query as CompatRecord).path ?? "");
    try { return { patch: git(root, ["diff", "--", filePath]) }; } catch { return { patch: "" }; }
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
    try { return gitStatus(repoPath); } catch { return { dirty: false, files: [] }; }
  });
  app.get("/api/repos/git/diff", async (request) => {
    const query = request.query as CompatRecord;
    const repoPath = String(query.repoPath ?? "");
    const filePath = String(query.path ?? "");
    if (!repoPath) return { patch: "" };
    try { return { patch: git(repoPath, ["diff", "--", filePath]) }; } catch { return { patch: "" }; }
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

  // --- commands fallback ---
  app.post<{ Params: { command: string } }>("/api/commands/:command", async (request, reply) => {
    const command = request.params.command;
    const body = (request.body ?? {}) as CompatRecord;
    const input = (body.input ?? body ?? {}) as CompatRecord;

    switch (command) {
      case "middleware_usage":
        return emptyUsage(Number(input.days) || 30);
      case "middleware_usage_daily":
        return dailyUsage(Number(input.days) || 30);
      case "middleware_commands_list":
        return { commands: [] };
      case "middleware_autonaming_quick": {
        const name = String(input.text || input.prompt || "New Chat").replace(/\s+/g, " ").trim().slice(0, 60) || "New Chat";
        return { name, title: name };
      }
      case "middleware_chat_history": {
        const sessionKey = String(input.sessionKey ?? "");
        if (!sessionKey) return reply.code(400).send({ ok: false, error: { message: "sessionKey required" } });
        try {
          const history = await context.gateway.request<{ messages?: unknown[] }>("sessions.history", { sessionKey }, Number(input.timeoutMs) || 10_000);
          return { messages: history.messages ?? [] };
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
      case "middleware_connect_bootstrap": {
        const gateway = context.gateway.status();
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
      case "middleware_message_feedback":
      case "middleware_message_feedback_delete":
        return { ok: true };
      default:
        return reply.code(404).send({ ok: false, error: { message: `Command not implemented in middleware-v2: ${command}` } });
    }
  });

  // --- migration stubs ---
  app.get("/api/migration/telegram/scan", async () => ({ sessions: [], count: 0 }));
  app.post("/api/migration/telegram/import", async () => ({ ok: true, imported: 0 }));

  // --- self-update stubs ---
  app.get("/api/middleware/update/status", async () => ({ available: false, current: "0.1.0" }));
  app.post("/api/middleware/update", async () => ({ ok: true, status: "up-to-date" }));

  // --- terminal spawn ---
  app.post("/api/terminal/spawn", async (request) => {
    const body = (request.body ?? {}) as CompatRecord;
    const cwd = String(body.cwd ?? body.workspaceRoot ?? process.env.WORKSPACE_ROOT ?? path.join(os.homedir(), ".openclaw", "workspace"));
    return spawnTerminal(cwd);
  });
  app.post<{ Params: { projectId: string } }>("/api/projects/:projectId/terminal/spawn", async (request, reply) => {
    const root = projectRoot(request.params.projectId);
    if (!root) return reply.code(404).send({ ok: false, error: { message: "Project not found" } });
    return spawnTerminal(root);
  });
  app.post<{ Params: { ptyId: string } }>("/api/terminal/:ptyId/write", async (request, reply) => {
    const term = getTerminal(request.params.ptyId);
    if (!term) return reply.code(404).send({ ok: false, error: { message: "Terminal not found" } });
    const body = (request.body ?? {}) as CompatRecord;
    term.child.stdin.write(String(body.data ?? ""));
    return { ok: true };
  });
  app.post<{ Params: { ptyId: string } }>("/api/terminal/:ptyId/resize", async (request) => {
    // child_process doesn't support resize natively; no-op for compat
    return { ok: true };
  });
  app.post<{ Params: { ptyId: string } }>("/api/terminal/:ptyId/kill", async (request) => {
    const term = getTerminal(request.params.ptyId);
    if (term) { term.child.kill(); compatState.terminals.delete(request.params.ptyId); }
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
        if (msg.type === "write" && typeof msg.data === "string") term.child.stdin.write(msg.data);
        if (msg.type === "kill") { term.child.kill(); compatState.terminals.delete(term.id); }
      } catch {}
    });
    socket.on("close", () => term.listeners.delete(listener));
  });

  // --- pairing ---
  app.get("/pairing/local", async () => {
    const gateway = context.gateway.status();
    return { ok: true, url: `http://127.0.0.1:${context.config.port}`, token: "", mode: "local", openclaw: { connected: gateway.connected } };
  });
}
