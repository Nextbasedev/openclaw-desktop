import crypto from "node:crypto"
import type { Store } from "./store.js"
import { HttpError } from "../lib/http-error.js"

type RecState = { topics: any[]; chats: any[]; sessions: any[]; [key: string]: any }
type AnyStore = Store & { read: () => unknown; write: (s: unknown) => void }

function state(store: Store): RecState {
  const s = (store as AnyStore).read() as RecState
  s.topics ??= []
  s.chats ??= []
  s.sessions ??= []
  return s
}
function save(store: Store, s: RecState) { (store as AnyStore).write(s) }
function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}` }
function now() { return new Date().toISOString() }

export function recordRoutes(store: Store) {
  return {
    topicsList: (projectId: string) => ({ topics: state(store).topics.filter((t) => t.projectId === projectId && !t.deleted) }),
    topicsCreate: (body: any) => { const s = state(store); const t = { id: id("topic"), projectId: body.projectId, name: body.name || "General", archived: false, pinned: Boolean(body.pinned), unreadCount: 0, sortOrder: body.sortOrder ?? 0, createdAt: now(), updatedAt: now() }; s.topics.push(t); save(store,s); return { topic: t } },
    topicsUpdate: (topicId: string, body: any) => { const s = state(store); const t = s.topics.find((x)=>x.id===topicId); if(!t) throw new HttpError(404,"Topic not found","NOT_FOUND"); Object.assign(t, body, { updatedAt: now() }); save(store,s); return { topic: t } },
    topicsDelete: (topicId: string) => { const s = state(store); s.topics = s.topics.filter((t)=>t.id!==topicId); save(store,s); return { ok: true } },
    topicsArchive: (topicId: string, archived = true) => { const s = state(store); const t = s.topics.find((x)=>x.id===topicId); if(!t) throw new HttpError(404,"Topic not found","NOT_FOUND"); t.archived = archived; t.updatedAt = now(); save(store,s); return { ok: true, topicId, archived } },

    chatsList: () => ({ chats: state(store).chats.filter((c)=>!c.deleted) }),
    chatsCreate: (body: any) => { const s = state(store); const c = { id: id("chat"), name: body.name || "New Chat", sessionKey: body.sessionKey, agentId: body.agentId || "main", archived: false, pinned: false, createdAt: now(), updatedAt: now(), lastActiveAt: now() }; s.chats.push(c); save(store,s); return { chat: c } },
    chatsUpdate: (chatId: string, body: any) => { const s = state(store); const c = s.chats.find((x)=>x.id===chatId); if(!c) throw new HttpError(404,"Chat not found","NOT_FOUND"); Object.assign(c, body, { updatedAt: now() }); save(store,s); return { chat: c } },
    chatsRename: (chatId: string, name: string) => { const s = state(store); const c = s.chats.find((x)=>x.id===chatId); if(!c) throw new HttpError(404,"Chat not found","NOT_FOUND"); c.name = name; c.updatedAt = now(); save(store,s); return { chat: c } },
    chatsArchive: (chatId: string, archived = true) => { const s = state(store); const c = s.chats.find((x)=>x.id===chatId); if(!c) throw new HttpError(404,"Chat not found","NOT_FOUND"); c.archived = archived; c.updatedAt = now(); save(store,s); return { ok: true, chatId, archived } },
    chatsDelete: (chatId: string) => { const s = state(store); s.chats = s.chats.filter((c)=>c.id!==chatId); save(store,s); return { ok: true } },
    chatsAttachSession: (chatId: string, sessionKey: string) => { const s = state(store); const c = s.chats.find((x)=>x.id===chatId); if(!c) throw new HttpError(404,"Chat not found","NOT_FOUND"); c.sessionKey = sessionKey; c.updatedAt = now(); save(store,s); return { chat: c } },

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
