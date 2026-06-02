export function collectDiagnostics(_input?: unknown) { return { sessions: [] } }
export function collectChatDiagnostics() { return collectDiagnostics() }
export function getChatDiagnosticsSnapshot() { return collectDiagnostics() }
