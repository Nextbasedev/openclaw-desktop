import { invoke } from "@/lib/ipc"
import { dedupeRequest } from "@/lib/requestDedupe"
import { fetchChats } from "./chats"
import { fetchProjects } from "./projects"
import { fetchSpaces } from "./spaces"
import { fetchTopics } from "./topics"
import type { GlobalSearchResponse, SearchDatasets } from "./searchTypes"

export function normalizeQuery(value: string) {
  return value.trim().toLowerCase()
}

export function matchRank(value: string | null | undefined, query: string) {
  const normalized = value?.trim().toLowerCase() ?? ""
  if (!normalized) return 3
  if (normalized === query) return 0
  if (normalized.startsWith(query)) return 1
  if (normalized.includes(query)) return 2
  return 3
}

function sortByNameMatch<T extends { name: string; updatedAt?: string }>(
  items: T[],
  query: string,
) {
  return [...items].sort((left, right) => {
    const rankDiff = matchRank(left.name, query) - matchRank(right.name, query)
    if (rankDiff !== 0) return rankDiff
    const rightTime = Date.parse(right.updatedAt ?? "") || 0
    const leftTime = Date.parse(left.updatedAt ?? "") || 0
    return rightTime - leftTime
  })
}

function omitUpdatedAt<T extends { updatedAt?: string }>(item: T): Omit<T, "updatedAt"> {
  const { updatedAt, ...rest } = item
  void updatedAt
  return rest
}

export async function loadSearchDatasets(): Promise<SearchDatasets> {
  return dedupeRequest(
    "search:datasets",
    async () => {
      const [spaceResult, projectResult, chatResult, sessionResult] = await Promise.all([
        fetchSpaces(false).catch(() => ({ spaces: [] })),
        fetchProjects().catch(() => ({ projects: [] })),
        fetchChats(false).catch(() => ({ chats: [] })),
        invoke<{ sessions: SearchDatasets["sessions"] }>("middleware_sessions_list", {
          input: { includeExisting: true },
        }).catch(() => ({ sessions: [] })),
      ])

      const projects = (projectResult.projects ?? []).filter(
        (project) => !project.archived,
      )
      const topicGroups = await Promise.all(
        projects.map(async (project) => {
          const result = await fetchTopics(project.id).catch(() => ({ topics: [] }))
          return result.topics ?? []
        }),
      )

      return {
        spaces: (spaceResult.spaces ?? []).filter((space) => !space.archived),
        projects,
        chats: (chatResult.chats ?? []).filter((chat) => !chat.archived),
        topics: topicGroups.flat().filter((topic) => !topic.archived),
        sessions: (sessionResult.sessions ?? []).filter((session) => !session.hidden),
      }
    },
    { ttlMs: 5_000 },
  )
}

export function sessionMaps(data: SearchDatasets) {
  const projectById = new Map(data.projects.map((project) => [project.id, project]))
  const topicById = new Map(data.topics.map((topic) => [topic.id, topic]))
  const sessionByKey = new Map(data.sessions.map((session) => [session.key, session]))
  return { projectById, topicById, sessionByKey }
}

export function searchNameResults(
  data: SearchDatasets,
  query: string,
  limit: number,
): Omit<GlobalSearchResponse, "messages"> {
  const { projectById, topicById, sessionByKey } = sessionMaps(data)
  const projectSessionCounts = new Map<string, number>()
  const topicSessionCounts = new Map<string, number>()
  const topicCountsByProject = new Map<string, number>()

  for (const session of data.sessions) {
    if (session.projectId) {
      projectSessionCounts.set(
        session.projectId,
        (projectSessionCounts.get(session.projectId) ?? 0) + 1,
      )
    }
    if (session.topicId) {
      topicSessionCounts.set(
        session.topicId,
        (topicSessionCounts.get(session.topicId) ?? 0) + 1,
      )
    }
  }

  for (const topic of data.topics) {
    topicCountsByProject.set(
      topic.projectId,
      (topicCountsByProject.get(topic.projectId) ?? 0) + 1,
    )
  }

  const spaces = sortByNameMatch(
    data.spaces
      .filter((space) => space.name.toLowerCase().includes(query))
      .map((space) => ({
        id: space.id,
        name: space.name,
        updatedAt: space.updatedAt,
      })),
    query,
  )
    .slice(0, limit)
    .map(omitUpdatedAt)

  const projects = sortByNameMatch(
    data.projects
      .filter((project) => project.name.toLowerCase().includes(query))
      .map((project) => ({
        id: project.id,
        name: project.name,
        topicCount: topicCountsByProject.get(project.id) ?? 0,
        sessionCount: projectSessionCounts.get(project.id) ?? 0,
      })),
    query,
  ).slice(0, limit)

  const topics = sortByNameMatch(
    data.topics
      .filter((topic) => topic.name.toLowerCase().includes(query))
      .map((topic) => ({
        id: topic.id,
        name: topic.name,
        projectId: topic.projectId,
        projectName: projectById.get(topic.projectId)?.name ?? "Project",
        sessionCount: topicSessionCounts.get(topic.id) ?? 0,
        updatedAt: topic.updatedAt,
      })),
    query,
  )
    .slice(0, limit)
    .map(omitUpdatedAt)

  const chats = sortByNameMatch(
    data.chats
      .filter((chat) => chat.name.toLowerCase().includes(query))
      .map((chat) => {
        const session = chat.sessionKey ? sessionByKey.get(chat.sessionKey) : undefined
        const topic = session?.topicId ? topicById.get(session.topicId) : undefined
        const project = session?.projectId
          ? projectById.get(session.projectId)
          : topic
            ? projectById.get(topic.projectId)
            : undefined
        return {
          id: chat.id,
          name: chat.name,
          sessionKey: chat.sessionKey,
          projectId: project?.id,
          projectName: project?.name,
          topicId: topic?.id,
          topicName: topic?.name,
          updatedAt: chat.updatedAt ?? session?.updatedAt,
        }
      }),
    query,
  )
    .slice(0, limit)
    .map(omitUpdatedAt)

  return { spaces, projects, topics, chats }
}
