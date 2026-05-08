import crypto from "node:crypto"
import type { Store } from "./store.js"
import { HttpError } from "../lib/http-error.js"

type RecState = { topics: any[]; chats: any[]; spaces: any[]; activeSpaceId?: string | null; sessions: any[]; [key: string]: any }
type AnyStore = Store & { read: () => unknown; write: (s: unknown) => void }

function state(store: Store): RecState {
  const s = (store as AnyStore).read() as RecState
  s.topics ??= []
  s.chats ??= []
  s.spaces ??= []
  s.activeSpaceId ??= null
  s.sessions ??= []
  ensureDefaultSpace(s)
  return s
}
function save(store: Store, s: RecState) { (store as AnyStore).write(s) }
function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}` }
function now() { return new Date().toISOString() }

function ensureDefaultSpace(s: RecState) {
  const activeSpaces = s.spaces.filter((space) => !space.archived && !space.deleted)
  if (activeSpaces.length === 0) {
    const timestamp = now()
    const space = { id: id("space"), name: "General", repoRoot: null, projectId: null, sortOrder: 0, archived: false, createdAt: timestamp, updatedAt: timestamp }
    s.spaces.push(space)
    s.activeSpaceId = space.id
    for (const chat of s.chats) chat.spaceId ??= space.id
    return space
  }
  if (!s.activeSpaceId || !activeSpaces.some((space) => space.id === s.activeSpaceId)) s.activeSpaceId = activeSpaces[0]?.id ?? null
  for (const chat of s.chats) chat.spaceId ??= s.activeSpaceId
  return activeSpaces.find((space) => space.id === s.activeSpaceId) ?? activeSpaces[0]
}

export function recordRoutes(store: Store) {
  return {
    topicsList: (projectId: string) => ({ topics: state(store).topics.filter((t) => t.projectId === projectId && !t.deleted) }),
    topicsCreate: (body: any) => { const s = state(store); const t = { id: id("topic"), projectId: body.projectId, name: body.name || "General", archived: false, pinned: Boolean(body.pinned), unreadCount: 0, sortOrder: body.sortOrder ?? 0, createdAt: now(), updatedAt: now() }; s.topics.push(t); save(store,s); return { topic: t } },
    topicsUpdate: (topicId: string, body: any) => { const s = state(store); const t = s.topics.find((x)=>x.id===topicId); if(!t) throw new HttpError(404,"Topic not found","NOT_FOUND"); Object.assign(t, body, { updatedAt: now() }); save(store,s); return { topic: t } },
    topicsDelete: (topicId: string) => { const s = state(store); s.topics = s.topics.filter((t)=>t.id!==topicId); save(store,s); return { ok: true } },
    topicsArchive: (topicId: string, archived = true) => { const s = state(store); const t = s.topics.find((x)=>x.id===topicId); if(!t) throw new HttpError(404,"Topic not found","NOT_FOUND"); t.archived = archived; t.updatedAt = now(); save(store,s); return { ok: true, topicId, archived } },

    chatsList: (filters: { archived?: boolean; spaceId?: string | null } = {}) => ({ chats: state(store).chats.filter((c)=>!c.deleted && Boolean(c.archived) === Boolean(filters.archived) && (!filters.spaceId || c.spaceId === filters.spaceId)) }),
    chatsCreate: (body: any) => { const s = state(store); const activeSpace = ensureDefaultSpace(s); const timestamp = now(); const c = { id: id("chat"), name: body.name || "New Chat", sessionKey: body.sessionKey, spaceId: body.spaceId || activeSpace?.id || s.activeSpaceId, agentId: body.agentId || "main", archived: false, pinned: false, createdAt: timestamp, updatedAt: timestamp, lastActiveAt: timestamp }; s.chats.push(c); save(store,s); return { chat: c } },
    chatsUpdate: (chatId: string, body: any) => { const s = state(store); const c = s.chats.find((x)=>x.id===chatId); if(!c) throw new HttpError(404,"Chat not found","NOT_FOUND"); Object.assign(c, body, { updatedAt: now() }); save(store,s); return { chat: c } },
    chatsRename: (chatId: string, name: string) => { const s = state(store); const c = s.chats.find((x)=>x.id===chatId); if(!c) throw new HttpError(404,"Chat not found","NOT_FOUND"); c.name = name; c.updatedAt = now(); save(store,s); return { chat: c } },
    chatsArchive: (chatId: string, archived = true) => { const s = state(store); const c = s.chats.find((x)=>x.id===chatId); if(!c) throw new HttpError(404,"Chat not found","NOT_FOUND"); c.archived = archived; c.updatedAt = now(); save(store,s); return { ok: true, chatId, archived } },
    chatsDelete: (chatId: string) => { const s = state(store); s.chats = s.chats.filter((c)=>c.id!==chatId); save(store,s); return { ok: true } },
    chatsAttachSession: (chatId: string, sessionKey: string) => { const s = state(store); const c = s.chats.find((x)=>x.id===chatId); if(!c) throw new HttpError(404,"Chat not found","NOT_FOUND"); c.sessionKey = sessionKey; c.updatedAt = now(); save(store,s); return { chat: c } },

    spacesList: () => { const s = state(store); const active = ensureDefaultSpace(s); save(store, s); return { spaces: s.spaces.filter((space)=>!space.archived && !space.deleted).sort((a,b)=>(a.sortOrder ?? 0) - (b.sortOrder ?? 0)), activeSpaceId: s.activeSpaceId || active?.id } },
    spacesCreate: (body: any = {}) => { const s = state(store); ensureDefaultSpace(s); const timestamp = now(); const maxSort = Math.max(0, ...s.spaces.map((space)=>Number(space.sortOrder || 0))); const space = { id: id("space"), name: String(body.name || "New Project").trim() || "New Project", repoRoot: body.repoRoot || null, projectId: body.projectId || null, sortOrder: maxSort + 1, archived: false, createdAt: timestamp, updatedAt: timestamp }; s.spaces.push(space); s.activeSpaceId = space.id; save(store,s); return { space, activeSpaceId: space.id } },
    spacesUpdate: (spaceId: string, body: any = {}) => { const s = state(store); const space = s.spaces.find((x)=>x.id===spaceId && !x.archived && !x.deleted); if(!space) throw new HttpError(404,"Project not found","NOT_FOUND"); if (body.name !== undefined) { const name = String(body.name || "").trim(); if(!name) throw new HttpError(400,"Project name cannot be empty","BAD_REQUEST"); space.name = name } if (body.repoRoot !== undefined) space.repoRoot = body.repoRoot ? String(body.repoRoot).trim() : null; if (body.projectId !== undefined) space.projectId = body.projectId ? String(body.projectId).trim() : null; space.updatedAt = now(); save(store,s); return { space } },
    spacesSwitch: (spaceId: string) => { const s = state(store); const space = s.spaces.find((x)=>x.id===spaceId && !x.archived && !x.deleted); if(!space) throw new HttpError(404,"Project not found","NOT_FOUND"); s.activeSpaceId = spaceId; save(store,s); return { activeSpaceId: spaceId } },
    spacesDelete: (spaceId: string) => { const s = state(store); const activeSpaces = s.spaces.filter((x)=>!x.archived && !x.deleted); if(activeSpaces.length <= 1) throw new HttpError(400,"Cannot delete the last project","BAD_REQUEST"); const space = activeSpaces.find((x)=>x.id===spaceId); if(!space) throw new HttpError(404,"Project not found","NOT_FOUND"); const fallback = s.activeSpaceId && s.activeSpaceId !== spaceId ? s.activeSpaceId : activeSpaces.find((x)=>x.id!==spaceId)?.id; space.archived = true; space.updatedAt = now(); for (const chat of s.chats.filter((chat)=>chat.spaceId===spaceId)) { chat.archived = true; chat.updatedAt = now() } s.activeSpaceId = fallback || null; save(store,s); return { ok: true, activeSpaceId: s.activeSpaceId } },

    sessionsList: (filters: { projectId?: string; topicId?: string } = {}) => ({
      sessions: state(store).sessions.filter((x) => {
        if (x.deleted) return false
        if (filters.projectId && x.projectId !== filters.projectId) return false
        if (filters.topicId && x.topicId !== filters.topicId) return false
        return true
      }),
    }),
    sessionsCreate: (body: any) => { const s = state(store); const key = body.sessionKey || `agent:main:desktop:${crypto.randomUUID()}`; const sess = { key, sessionKey: key, label: body.label || "New Chat", agentId: body.agentId || "main", status: "idle", hidden: false, projectId: body.projectId, topicId: body.topicId, createdAt: now(), updatedAt: now() }; s.sessions.push(sess); save(store,s); return { session: sess } },
  }
}
