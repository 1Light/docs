// apps/api/src/middleware/errorHandler.ts

import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { ERROR_CODES, type ApiError as SharedApiError } from "@repo/contracts/src/constants/errorCodes";
import { ApiError as ApiErrorDTO } from "@repo/contracts/src/constants/errorCodes";
// If your monorepo exposes packages/shared as "@repo/contracts", keep that.
// Otherwise adjust imports (e.g. "../../packages/contracts/src/constants/errorCodes").

type KnownError = {
  code?: string;
  status?: number;
  message?: string;
  details?: unknown;
};

/**
 * Map our semantic error codes to HTTP status codes.
 */
function mapErrorCodeToStatus(code?: string): number {
  switch (code) {
    case ERROR_CODES.UNAUTHORIZED:
      return 401;
    case ERROR_CODES.FORBIDDEN:
    case ERROR_CODES.AI_DISABLED_BY_POLICY:
      return 403;
    case ERROR_CODES.INVALID_REQUEST:
      return 400;
    case ERROR_CODES.NOT_FOUND:
      return 404;
    case ERROR_CODES.AI_QUOTA_EXCEEDED:
      return 429;
    case ERROR_CODES.AI_PROVIDER_UNAVAILABLE:
      return 502;
    default:
      return 500;
  }
}

/**
 * Standardized JSON error response emitter.
 */
function sendError(res: Response, payload: { code: string; message: string; details?: unknown }) {
  const status = mapErrorCodeToStatus(payload.code);
  res.status(status).json({
    code: payload.code,
    message: payload.message,
    details: payload.details,
  });
}

/**
 * Express error handling middleware (final).
 */
export default function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // Zod validation errors -> INVALID_REQUEST
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({ path: e.path.join("."), message: e.message }));
    return sendError(res, {
      code: ERROR_CODES.INVALID_REQUEST,
      message: "Invalid request payload",
      details,
    });
  }

  // Prisma errors -> try to give meaningful feedback for common codes
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Example: unique constraint violation
    if (err.code === "P2002") {
      return sendError(res, {
        code: ERROR_CODES.INVALID_REQUEST,
        message: "Unique constraint violation",
        details: { target: err.meta?.target },
      });
    }

    // Fallback for other Prisma known errors
    return sendError(res, {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: "Database error",
      details: { code: err.code, meta: err.meta },
    });
  }

  // If user threw a structured ApiError from shared package (or similar)
  if (typeof err === "object" && err !== null && "code" in err && "message" in (err as KnownError)) {
    const ke = err as KnownError;
    const code = (ke.code as string) ?? ERROR_CODES.INTERNAL_ERROR;
    const message = ke.message ?? "Error";
    return sendError(res, { code, message, details: ke.details });
  }

  // Fallback: unknown / untyped error
  // Log server-side for debugging (do NOT expose full stack in production)
  // eslint-disable-next-line no-console
  console.error("Unhandled error:", err);

  const isDev = process.env.NODE_ENV !== "production";
  return sendError(res, {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: isDev ? (err as Error)?.message ?? "Internal error" : "Internal server error",
    details: isDev ? { stack: (err as Error)?.stack } : undefined,
  });
}