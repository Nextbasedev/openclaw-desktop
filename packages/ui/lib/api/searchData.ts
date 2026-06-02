import type { GlobalSearchResponse, SearchDatasets } from "./searchTypes"

export function normalizeQuery(value: string) {
  return value.trim().toLowerCase()
}

export function matchRank(_value: string | null | undefined, _query: string) {
  return 3
}

export async function loadSearchDatasets(): Promise<SearchDatasets> {
  return { spaces: [], projects: [], chats: [], topics: [], sessions: [] }
}

export function sessionMaps(_data: SearchDatasets) {
  return { projectById: new Map(), topicById: new Map(), sessionByKey: new Map() }
}

export function searchNameResults(
  _data: SearchDatasets,
  _query: string,
  _limit: number,
): Omit<GlobalSearchResponse, "messages"> {
  return { spaces: [], projects: [], topics: [], chats: [] }
}
