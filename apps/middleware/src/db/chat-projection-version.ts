export const CHAT_PROJECTION_VERSION = 4;
export const CHAT_PROJECTION_VERSION_META_KEY = "projection_version";
export function chatProjectionResyncRequiredMetaKey(sessionKey: string) {
  return `projection_resync_required:${sessionKey}`;
}
