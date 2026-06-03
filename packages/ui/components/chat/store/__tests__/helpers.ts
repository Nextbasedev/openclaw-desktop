import { applyPatches } from "../applyPatch";
import { emptyChatState, type ChatSessionState } from "../state";
import { SESSION } from "./fixtures";
import type { ChatPatch } from "../../sync/types.contract";

export function base(): ChatSessionState {
  return emptyChatState(SESSION);
}

export function replay(patches: ChatPatch[], start: ChatSessionState = base()): ChatSessionState {
  return applyPatches(start, patches).state;
}
