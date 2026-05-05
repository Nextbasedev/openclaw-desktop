import type { ChatComposerSubmit } from "./chatAttachments"

export type ComposerPhase =
  | "idle"
  | "sending"
  | "failed"
  | "stopping"
  | "restarting"

export type ComposerState = {
  phase: ComposerPhase
  pendingText: string
  pendingAttachments: ChatComposerSubmit["attachments"]
  error: string | null
  interrupted: boolean
}

export type ComposerAction =
  | { type: "send_start"; payload: ChatComposerSubmit; generating: boolean }
  | { type: "send_success" }
  | { type: "send_failed"; error: string }
  | { type: "stop_start" }
  | { type: "stop_done" }
  | { type: "restart_start"; payload?: ChatComposerSubmit }
  | { type: "reset_error" }

export const initialComposerState: ComposerState = {
  phase: "idle",
  pendingText: "",
  pendingAttachments: undefined,
  error: null,
  interrupted: false,
}

export function composerReducer(
  state: ComposerState,
  action: ComposerAction,
): ComposerState {
  if (action.type === "send_start") {
    return {
      ...state,
      phase: action.generating ? "restarting" : "sending",
      pendingText: action.payload.text,
      pendingAttachments: action.payload.attachments,
      error: null,
      interrupted: action.generating,
    }
  }

  if (action.type === "send_success") {
    return {
      ...initialComposerState,
      interrupted: false,
    }
  }

  if (action.type === "send_failed") {
    return {
      ...state,
      phase: "failed",
      error: action.error,
    }
  }

  if (action.type === "stop_start") {
    return { ...state, phase: "stopping", error: null }
  }

  if (action.type === "stop_done") {
    return { ...state, phase: "idle", interrupted: false }
  }

  if (action.type === "restart_start") {
    return {
      ...state,
      phase: "restarting",
      pendingText: action.payload?.text ?? state.pendingText,
      pendingAttachments: action.payload?.attachments ?? state.pendingAttachments,
      error: null,
      interrupted: true,
    }
  }

  return { ...state, error: null }
}
