import { tauriInvoke } from "@/lib/tauri"

export type Topic = {
  id: string
  projectId: string
  name: string
  archived: boolean
  unreadCount: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type TopicListResponse = {
  topics: Topic[]
}

export type TopicResponse = {
  topic: Topic
}

export async function fetchTopics(projectId: string): Promise<TopicListResponse> {
  return tauriInvoke<TopicListResponse>("middleware_topics_list", {
    input: { projectId },
  })
}

export async function archiveTopic(
  topicId: string,
  archived = true,
): Promise<{ ok: boolean; topicId: string; archived: boolean }> {
  return tauriInvoke("middleware_topics_archive", {
    input: { topicId, archived },
  })
}
