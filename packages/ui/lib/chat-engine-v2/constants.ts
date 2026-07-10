/**
 * Shared chat-window constants.
 *
 * Single source of truth for the initial chat window size. Both the UI
 * bootstrap request and the ChatView data-window cap reference this so the
 * "open a chat with N messages" contract is unambiguous and identical for
 * every session — imported (Telegram/Discord) and normal alike.
 */

/** Number of messages loaded on initial chat open (latest/tail). */
export const UI_INITIAL_WINDOW = 160
