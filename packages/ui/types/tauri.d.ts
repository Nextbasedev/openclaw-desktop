/**
 * Tauri global type augmentation.
 *
 * When running inside the Tauri webview, the runtime injects
 * `window.__TAURI_INTERNALS__` before any user script executes.
 * This declaration lets us safely feature-detect without TS errors.
 */
interface Window {
  __TAURI_INTERNALS__?: Record<string, unknown>
}
