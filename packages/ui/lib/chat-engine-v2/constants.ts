/**
 * Chat history loading is intentionally unwindowed.
 *
 * Opening a session must request and render the full locally-projected history
 * in one pass. These compatibility constants remain only for old tests/imports;
 * they must not be used to cap initial chat history.
 */
export const UI_INITIAL_WINDOW = Number.MAX_SAFE_INTEGER
export const UI_OLDER_PAGE = Number.MAX_SAFE_INTEGER
export const UI_STORE_WINDOW = Number.MAX_SAFE_INTEGER
