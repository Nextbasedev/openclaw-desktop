import {
  loadSearchDatasets,
  normalizeQuery,
  searchNameResults,
} from "./searchData"
import { searchBackfill, searchCachedMessages } from "./searchMessages"
import type { GlobalSearchResponse } from "./searchTypes"

export type {
  GlobalSearchResponse,
  SearchChatResult,
  SearchMessageResult,
  SearchProjectResult,
  SearchSpaceResult,
  SearchTopicResult,
} from "./searchTypes"

export { searchBackfill }

export async function searchGlobal(
  query: string,
  limit = 5,
): Promise<GlobalSearchResponse> {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) {
    return { spaces: [], projects: [], topics: [], chats: [], messages: [] }
  }

  const safeLimit = Math.max(1, Math.min(limit, 20))
  const data = await loadSearchDatasets()
  const names = searchNameResults(data, normalizedQuery, safeLimit)

  return {
    ...names,
    messages: searchCachedMessages(data, normalizedQuery, safeLimit),
  }
}
