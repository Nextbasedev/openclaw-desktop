export type MessageSearchResult = never
export async function searchMessages() { return [] as MessageSearchResult[] }
export async function searchCachedMessages() { return [] as MessageSearchResult[] }
export async function searchBackfill(_query?: string, _limit?: number): Promise<{ indexedSessions: number }> { return { indexedSessions: 0 } }
