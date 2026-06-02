import type { GlobalSearchResponse } from "./searchTypes"

export type {
  GlobalSearchResponse,
  SearchChatResult,
  SearchMessageResult,
  SearchProjectResult,
  SearchSpaceResult,
  SearchTopicResult,
} from "./searchTypes"

export async function searchBackfill(_query?: string, _limit?: number): Promise<{ indexedSessions: number }> {
  return { indexedSessions: 0 }
}

export async function searchGlobal(
  _query: string,
  _limit = 5,
): Promise<GlobalSearchResponse> {
  return { spaces: [], projects: [], topics: [], chats: [], messages: [] }
}
