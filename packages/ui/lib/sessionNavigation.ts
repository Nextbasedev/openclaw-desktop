import { invoke } from "@/lib/ipc"
import type { ActiveChat } from "@/types/chat"
import type { ActiveTopic } from "@/types/project"

type SessionRecord = {
  key: string
  label: string
  hidden: boolean
  projectId?: string
  topicId?: string
}

type ChatRecord = {
  id: string
  name: string
  sessionKey?: string
  archived: boolean
}

type ProjectRecord = {
  id: string
  name: string
  archived: boolean
}

type TopicRecord = {
  id: string
  name: string
  projectId: string
  archived: boolean
}

export type SessionNavigationTarget =
  | {
      kind: "chat"
      chat: ActiveChat
      sessionKey: string
      title: string
    }
  | {
      kind: "topic"
      topic: ActiveTopic
      sessionKey: string
      title: string
    }

async function createStandaloneSession(label: string) {
  const result = await invoke<{ session: { key?: string; sessionKey?: string } }>(
    "middleware_sessions_create",
    { input: { agentId: "main", label } },
  )
  const sessionKey = result.session.key ?? result.session.sessionKey
  if (!sessionKey) throw new Error("Session creation did not return a sessionKey")
  return sessionKey
}

export async function ensureChatSession(chat: ActiveChat) {
  if (chat.sessionKey) {
    return {
      chat,
      sessionKey: chat.sessionKey,
      title: chat.name,
    }
  }

  const sessionKey = await createStandaloneSession(chat.name)
  await invoke("middleware_chats_attach_session", {
    input: { chatId: chat.id, sessionKey },
  })

  return {
    chat: { ...chat, sessionKey },
    sessionKey,
    title: chat.name,
  }
}

async function findSession(sessionKey: string) {
  const result = await invoke<{ sessions: SessionRecord[] }>(
    "middleware_sessions_list",
    { input: { includeExisting: true } },
  )
  return (result.sessions || []).find(
    (session) => session.key === sessionKey && !session.hidden,
  )
}

async function resolveTopic(
  projectId: string,
  topicId: string,
): Promise<ActiveTopic | null> {
  const projectResult = await invoke<{ projects: ProjectRecord[] }>(
    "middleware_projects_list",
    { input: {} },
  )
  const project = (projectResult.projects || []).find(
    (item) => item.id === projectId && !item.archived,
  )
  if (!project) return null

  const topicResult = await invoke<{ topics: TopicRecord[] }>(
    "middleware_topics_list",
    { input: { projectId } },
  )
  const topic = (topicResult.topics || []).find(
    (item) => item.id === topicId && !item.archived,
  )
  if (!topic) return null

  return {
    id: topic.id,
    name: topic.name,
    projectId: project.id,
    projectName: project.name,
  }
}

async function findChatBySessionKey(sessionKey: string) {
  const result = await invoke<{ chats: ChatRecord[] }>("middleware_chats_list", {
    input: {},
  })
  const chat = (result.chats || []).find(
    (item) => !item.archived && item.sessionKey === sessionKey,
  )
  if (!chat) return null

  return {
    id: chat.id,
    name: chat.name,
    sessionKey,
  } satisfies ActiveChat
}

async function ensureChatForSession(session: SessionRecord) {
  const existingChat = await findChatBySessionKey(session.key)
  if (existingChat) {
    return {
      kind: "chat" as const,
      chat: existingChat,
      sessionKey: session.key,
      title: existingChat.name,
    }
  }

  const label = session.label?.trim() || "New Chat"
  const result = await invoke<{ chat: { id: string; name: string } }>(
    "middleware_chats_create",
    {
      input: {
        name: label,
        sessionKey: session.key,
      },
    },
  )

  return {
    kind: "chat" as const,
    chat: {
      id: result.chat.id,
      name: result.chat.name,
      sessionKey: session.key,
    },
    sessionKey: session.key,
    title: result.chat.name,
  }
}

export async function resolveSessionNavigationTarget(
  sessionKey: string,
): Promise<SessionNavigationTarget | null> {
  const session = await findSession(sessionKey)
  if (!session) return null

  if (session.projectId && session.topicId) {
    const topic = await resolveTopic(session.projectId, session.topicId)
    if (topic) {
      return {
        kind: "topic",
        topic,
        sessionKey: session.key,
        title: session.label?.trim() || topic.name,
      }
    }
  }

  return ensureChatForSession(session)
}
