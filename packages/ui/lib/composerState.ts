import type { ChatComposerSubmit } from "./chatAttachments"

export type ComposerPhase =
  | "idle"
  | "sending"
  | "failed"
  | "stopping"
  | "restarting"
  | "batched"

export type ComposerState = {
  phase: ComposerPhase
  pendingText: string
  pendingAttachments: ChatComposerSubmit["attachments"]
  batch: ChatComposerSubmit[]
  error: string | null
  interrupted: boolean
}

export type ComposerAction =
  | { type: "send_start"; payload: ChatComposerSubmit; generating: boolean }
  | { type: "batch_add"; payload: ChatComposerSubmit }
  | { type: "batch_flush" }
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
  batch: [],
  error: null,
  interrupted: false,
}

export function composeBatch(batch: ChatComposerSubmit[]): ChatComposerSubmit {
  const text = batch
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n\n")
  const attachments = batch.flatMap((item) => item.attachments ?? [])
  return {
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
  }
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

  if (action.type === "batch_add") {
    return {
      ...state,
      phase: "batched",
      batch: [...state.batch, action.payload],
      pendingText: action.payload.text,
      pendingAttachments: action.payload.attachments,
      error: null,
    }
  }

  if (action.type === "batch_flush") {
    const payload = composeBatch(state.batch)
    return {
      ...state,
      phase: "sending",
      pendingText: payload.text,
      pendingAttachments: payload.attachments,
      batch: [],
      error: null,
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
