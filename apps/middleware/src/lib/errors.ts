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
    const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
    reply.status(statusCode).send({
      ok: false,
      error: {
        code,
        message: error.message || "Internal server error",
        ...(error instanceof HttpError && error.details !== undefined ? { details: error.details } : {}),
      },
    });
  });
}
