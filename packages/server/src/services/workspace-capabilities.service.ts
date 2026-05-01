export type WorkspaceCapabilities = {
  canTree: boolean
  canStat: boolean
  canRead: boolean
  canWrite: boolean
  canDownloadFile: boolean
  canCreateDir: boolean
  canMoveEntry: boolean
  canDeleteEntry: boolean
}

const REMOTE_WORKSPACE_CAPABILITIES: WorkspaceCapabilities = {
  canTree: true,
  canStat: true,
  canRead: true,
  canWrite: true,
  canDownloadFile: true,
  canCreateDir: true,
  canMoveEntry: true,
  canDeleteEntry: true,
}

export function getWorkspaceCapabilities(): WorkspaceCapabilities {
  return { ...REMOTE_WORKSPACE_CAPABILITIES }
}
