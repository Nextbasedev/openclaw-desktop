export function appHasLiveConnection(status: { hasConnection?: boolean } | null | undefined): boolean {
  return status?.hasConnection === true
}
