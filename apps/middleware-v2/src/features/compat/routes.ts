import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";

type CompatRecord = Record<string, any>;

const nowIso = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const compatState = {
  spaces: [] as CompatRecord[],
  activeSpaceId: null as string | null,
  chats: [] as CompatRecord[],
  projects: [] as CompatRecord[],
  topics: [] as CompatRecord[],
  sessions: [] as CompatRecord[],
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
}
