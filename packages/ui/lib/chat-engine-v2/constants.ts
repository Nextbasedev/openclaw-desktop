/**
 * Shared chat-window constants — single documented contract.
 *
 * Applies identically to every session (imported Telegram/Discord and normal).
 * See docs/plans/2026-07-10-telegram-chat-reliability-loop.md Phase 3.
 *
 * Open / first paint (strict):
 *   UI_INITIAL_WINDOW = 160  → bootstrap request + warm-cache first paint cap
 *
 * Scroll paging:
 *   UI_OLDER_PAGE = 100      → legacy hook older/newer page fetches
 *
 * In-memory scroll buffer (headroom, not open contract):
 *   Store WINDOW_SIZE / SLICE_SIZE may be 200 so paging can hold one extra page
 *   before trim. Bootstrap must never force more than UI_INITIAL_WINDOW into the
 *   first paint; the store may grow toward 200 only after scroll/live append.
 */

/** Number of messages loaded on initial chat open (latest/tail). */
export const UI_INITIAL_WINDOW = 160

/** Page size for older/newer history fetches after open. */
export const UI_OLDER_PAGE = 100

/**
 * Soft in-memory buffer ceiling used by the store sliding window.
 * Must be >= UI_INITIAL_WINDOW. Not the open/bootstrap paint size.
 */
export const UI_STORE_WINDOW = 200
