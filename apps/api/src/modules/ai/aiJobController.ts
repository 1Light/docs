// apps/api/src/modules/ai/aiJobController.ts

import type { Request, Response, NextFunction } from "express";
import { ERROR_CODES } from "@repo/contracts";
import { aiJobService } from "./aiJobService";
import { permissionService } from "../permissions/permissionService";
import { config } from "../../config/env";

function apiError(
  code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
  message: string,
  details?: unknown
) {
  return { code, message, ...(details !== undefined ? { details } : {}) };
}

function assertAuth(req: Request) {
  if (!req.authUser) {
    throw apiError(ERROR_CODES.UNAUTHORIZED, "Authentication required");
  }
  return req.authUser;
}

function isValidOperation(
  op: any
): op is "rewrite" | "summarize" | "translate" | "reformat" {
  return (
    op === "rewrite" || op === "summarize" || op === "translate" || op === "reformat"
  );
}

function normalizeSelection(sel: any): { start: number; end: number } {
  const start = Number(sel?.start);
  const end = Number(sel?.end);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw apiError(ERROR_CODES.INVALID_REQUEST, "Invalid selection range", {
      reason: "start/end must be numbers",
    });
  }
  if (start < 0 || end < 0 || end <= start) {
    throw apiError(ERROR_CODES.INVALID_REQUEST, "Invalid selection range", {
      reason: "end must be > start and both must be >= 0",
    });
  }

  const MAX_LEN = 20_000;
  const len = end - start;
  if (len > MAX_LEN) {
    throw apiError(
      ERROR_CODES.INVALID_REQUEST,
      `Selection too large (max ${MAX_LEN} chars)`,
      { max: MAX_LEN, got: len }
    );
  }

  return { start, end };
}

function toJobError(job: { errorMessage?: string | null }) {
  if (!job.errorMessage) return undefined;

  // In development, include full error message. In prod, keep it terse.
  const dev = config.NODE_ENV === "development";

  // Heuristic: if message already contains useful context, expose it in details for debugging.
  // The shared API error shape supports `details`.
  return {
    code: ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
    message: dev ? "AI provider unavailable" : "AI provider unavailable",
    ...(dev ? { details: { providerMessage: job.errorMessage } } : {}),
  };
}

export const aiJobController = {
  /**
   * POST /ai/jobs
   * Body: { documentId, operation, selection, parameters? }
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const user = assertAuth(req);

      const { documentId, operation, selection, parameters } = req.body as {
        documentId: unknown;
        operation: unknown;
        selection: unknown;
        parameters?: unknown;
      };

      if (!documentId || typeof documentId !== "string") {
        throw apiError(ERROR_CODES.INVALID_REQUEST, "documentId is required");
      }
      if (!isValidOperation(operation)) {
        throw apiError(ERROR_CODES.INVALID_REQUEST, "Invalid operation");
      }

      const normalizedSelection = normalizeSelection(selection);

      const role = await permissionService.resolveEffectiveRole({
        documentId,
        userId: user.id,
      });

      if (!role) {
        throw apiError(ERROR_CODES.FORBIDDEN, "No access to this document");
      }

      const job = await aiJobService.createJob({
        documentId,
        requesterId: user.id,
        operation,
        selection: normalizedSelection,
        parameters: (parameters ?? undefined) as any,
      });

      return res.status(201).json({
        jobId: job.id,
        status: job.status,
        result: job.result ?? undefined,
        error: toJobError(job),
        createdAt: job.createdAt.toISOString(),
      });
    } catch (err) {
      return next(err);
    }
  },

  /**
   * GET /ai/jobs/:jobId
   * Must have access to the underlying document.
   */
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const user = assertAuth(req);

      const jobId = req.params.jobId;
      if (!jobId) {
        throw apiError(ERROR_CODES.INVALID_REQUEST, "jobId is required");
      }

      const job = await aiJobService.getJob(jobId);

      const role = await permissionService.resolveEffectiveRole({
        documentId: job.documentId,
        userId: user.id,
      });

      if (!role) {
        throw apiError(ERROR_CODES.FORBIDDEN, "No access to this AI job");
      }

      return res.json({
        jobId: job.id,
        status: job.status,
        result: job.result ?? undefined,
        error: toJobError(job),
        createdAt: job.createdAt.toISOString(),
      });
    } catch (err) {
      return next(err);
    }
  },

  /**
   * POST /ai/jobs/:jobId/apply
   * Body: { finalText }
   * Requires Editor/Owner (enforced in service).
   */
  async apply(req: Request, res: Response, next: NextFunction) {
    try {
      const user = assertAuth(req);

      const jobId = req.params.jobId;
      if (!jobId) {
        throw apiError(ERROR_CODES.INVALID_REQUEST, "jobId is required");
      }

      const { finalText } = req.body as { finalText?: unknown };
      if (typeof finalText !== "string" || finalText.trim().length === 0) {
        throw apiError(ERROR_CODES.INVALID_REQUEST, "finalText is required");
      }

      const result = await aiJobService.applyJob({
        jobId,
        requesterId: user.id,
        finalText,
      });

      return res.json(result);
    } catch (err) {
      return next(err);
    }
  },
};