import {
  type RawHistoryMessage,
  parseChatHistory,
} from "@/lib/chatHistoryParser"
import {
  getCachedChatSessionMessages,
  publishChatSessionMessages,
} from "@/lib/chatSessionStore"
import { fetchChatBootstrapV2 } from "@/lib/chat-engine-v2/client"
import { dedupeRequest } from "@/lib/requestDedupe"
import { loadSearchDatasets, matchRank, sessionMaps } from "./searchData"
import type { SearchDatasets, SearchMessageResult } from "./searchTypes"

type SearchSessionCandidate = {
  sessionKey: string
  updatedAt?: string
  title: string
  chatId?: string
  chatName?: string
  projectId?: string
  projectName?: string
  topicId?: string
  topicName?: string
}

function makeSnippet(text: string, query: string) {
  const normalizedText = text.toLowerCase()
  const index = normalizedText.indexOf(query)
  if (index < 0) return text.slice(0, 140)
  const start = Math.max(0, index - 36)
  const end = Math.min(text.length, index + query.length + 72)
  const prefix = start > 0 ? "... " : ""
  const suffix = end < text.length ? " ..." : ""
  return `${prefix}${text.slice(start, end).trim()}${suffix}`
}

function buildSessionCandidates(data: SearchDatasets): SearchSessionCandidate[] {
  const { projectById, topicById, sessionByKey } = sessionMaps(data)
  const chatBySessionKey = new Map(
    data.chats
      .filter((chat): chat is typeof chat & { sessionKey: string } => Boolean(chat.sessionKey))
      .map((chat) => [chat.sessionKey, chat]),
  )
  const candidates: SearchSessionCandidate[] = []
  const seen = new Set<string>()

  for (const session of data.sessions) {
    const chat = chatBySessionKey.get(session.key)
    const topic = session.topicId ? topicById.get(session.topicId) : undefined
    const project = session.projectId
      ? projectById.get(session.projectId)
      : topic
        ? projectById.get(topic.projectId)
        : undefined

    candidates.push({
      sessionKey: session.key,
      updatedAt: chat?.updatedAt ?? session.updatedAt,
      title:
        chat?.name ??
        session.label?.trim() ??
        topic?.name ??
        project?.name ??
        session.key,
      chatId: chat?.id,
      chatName: chat?.name,
      projectId: project?.id,
      projectName: project?.name,
      topicId: topic?.id,
      topicName: topic?.name,
    })
    seen.add(session.key)
  }

  for (const chat of data.chats) {
    if (!chat.sessionKey || seen.has(chat.sessionKey)) continue
    const session = sessionByKey.get(chat.sessionKey)
    const topic = session?.topicId ? topicById.get(session.topicId) : undefined
    const project = session?.projectId
      ? projectById.get(session.projectId)
      : topic
        ? projectById.get(topic.projectId)
        : undefined
    candidates.push({
      sessionKey: chat.sessionKey,
      updatedAt: chat.updatedAt ?? session?.updatedAt,
      title: chat.name,
      chatId: chat.id,
      chatName: chat.name,
      projectId: project?.id,
      projectName: project?.name,
      topicId: topic?.id,
      topicName: topic?.name,
    })
  }

  return candidates
}

export function searchCachedMessages(
  data: SearchDatasets,
  query: string,
  limit: number,
): SearchMessageResult[] {
  const results: Array<SearchMessageResult & { rank: number; time: number }> = []

  for (const candidate of buildSessionCandidates(data)) {
    const cachedMessages = getCachedChatSessionMessages(candidate.sessionKey)
    if (!cachedMessages?.length) continue

    for (const message of cachedMessages) {
      const text = message.text?.trim()
      if (!text) continue
      const rank = matchRank(text, query)
      if (rank === 3) continue
      results.push({
        id: `${candidate.sessionKey}:${message.messageId ?? results.length}`,
        sessionKey: candidate.sessionKey,
        messageId: message.messageId,
        role: message.role,
        snippet: makeSnippet(text, query),
        chatId: candidate.chatId,
        chatName: candidate.chatName,
        projectId: candidate.projectId,
        projectName: candidate.projectName,
        topicId: candidate.topicId,
        topicName: candidate.topicName,
        createdAt: message.createdAt,
        rank,
        time: Date.parse(message.createdAt ?? "") || 0,
      })
    }
  }

  return results
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank
      return right.time - left.time
    })
    .slice(0, limit)
    .map(({ rank: _rank, time: _time, ...message }) => message)
}

async function hydrateSessionHistory(sessionKey: string) {
  await dedupeRequest(
    `search:history:${sessionKey}`,
    async () => {
      const history = await fetchChatBootstrapV2(sessionKey)
      const parsed = parseChatHistory((history.messages as RawHistoryMessage[]) ?? [])
      publishChatSessionMessages(sessionKey, parsed.messages, "global-search")
      return parsed.messages.length
    },
    { ttlMs: 60_000 },
  )
}

export async function searchBackfill(
  query: string,
  limit = 6,
): Promise<{ indexedSessions: number }> {
  const normalizedQuery = query.trim().toLowerCase()
  const data = await loadSearchDatasets()
  const candidates = buildSessionCandidates(data)
    .filter((candidate) => !getCachedChatSessionMessages(candidate.sessionKey))
    .map((candidate) => {
      const textPool = [
        candidate.title,
        candidate.chatName,
        candidate.topicName,
        candidate.projectName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return {
        sessionKey: candidate.sessionKey,
        rank: normalizedQuery ? matchRank(textPool, normalizedQuery) : 2,
        updatedAt: Date.parse(candidate.updatedAt ?? "") || 0,
      }
    })
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank
      return right.updatedAt - left.updatedAt
    })
    .slice(0, Math.max(1, Math.min(limit, 12)))

  let indexedSessions = 0
  await Promise.all(
    candidates.map(async (candidate) => {
      try {
        await hydrateSessionHistory(candidate.sessionKey)
        indexedSessions += 1
      } catch {}
    }),
  )

  return { indexedSessions }
}
