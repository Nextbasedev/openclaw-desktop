export type OpenClawMessage = Record<string, unknown> & {
  role?: string;
  __openclaw?: { id?: string; seq?: number };
};

export type ProjectedMessage = {
  sessionKey: string;
  openclawSeq: number;
  messageId: string | null;
  role: string | null;
  data: OpenClawMessage;
  updatedAtMs: number;
};

export type ProjectionEvent = {
  cursor: number;
  sessionKey: string | null;
  eventType: string;
  payload: unknown;
  createdAtMs: number;
};
