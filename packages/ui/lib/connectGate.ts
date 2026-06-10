export function shouldForceConnectGate(params: {
  initialConnect: boolean
  activeTab: string
  routePath: string
}): boolean {
  if (!params.initialConnect) return false
  return params.activeTab !== "connect" || params.routePath !== "/connect"
}
