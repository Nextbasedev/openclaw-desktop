import type { FastifyError, FastifyInstance } from "fastify";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code = "HTTP_ERROR",
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  app.setErrorHandler((error: FastifyError | HttpError, _request, reply) => {
    const statusCode = error instanceof HttpError ? error.statusCode : error.statusCode ?? 500;
    const isPayloadTooLarge = statusCode === 413 || ("code" in error && error.code === "FST_ERR_CTP_BODY_TOO_LARGE");
    const code = error instanceof HttpError
      ? error.code
      : isPayloadTooLarge
        ? "PAYLOAD_TOO_LARGE"
        : "INTERNAL_ERROR";
    const message = isPayloadTooLarge
      ? "Payload too large. Attachments must be 25 MB or smaller."
      : error.message || "Internal server error";
    reply.status(statusCode).send({
      ok: false,
      error: {
        code,
        message,
        ...(error instanceof HttpError && error.details !== undefined ? { details: error.details } : {}),
      },
    });
  });
}
