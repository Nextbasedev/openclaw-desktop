export type OpenClawMessage = Record<string, unknown> & {
  role?: string;
  __openclaw?: {
    id?: string;
    seq?: number;
    gatewayId?: string | null;
    gatewaySeq?: number | null;
    segmentId?: string | null;
    runId?: string | null;
    replacedLiveMessageId?: string | null;
    preserveDisplayText?: boolean;
  };
};

export type ProjectedMessage = {
  sessionKey: string;
  segmentId?: string | null;
  sessionId?: string | null;
  gatewaySeq?: number | null;
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
