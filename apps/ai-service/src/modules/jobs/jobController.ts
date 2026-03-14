// apps/ai-service/src/modules/jobs/jobController.ts

import type { Request, Response, NextFunction } from "express";
import { ERROR_CODES } from "@repo/contracts";
import { runJob } from "./runJob";

function apiError(code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES], message: string, details?: unknown) {
  return { code, message, ...(details !== undefined ? { details } : {}) };
}

function isValidOperation(op: any): op is "rewrite" | "summarize" | "translate" | "reformat" {
  return op === "rewrite" || op === "summarize" || op === "translate" || op === "reformat";
}

export const jobController = {
  /**
   * POST /jobs/run
   * Body: { jobId, operation, selectedText, parameters? }
   * Res: { result }
   */
  async run(req: Request, res: Response, next: NextFunction) {
    try {
      const { jobId, operation, selectedText, parameters } = req.body as {
        jobId?: unknown;
        operation?: unknown;
        selectedText?: unknown;
        parameters?: unknown;
      };

      if (!jobId || typeof jobId !== "string") {
        throw apiError(ERROR_CODES.INVALID_REQUEST, "jobId is required");
      }
      if (!isValidOperation(operation)) {
        throw apiError(ERROR_CODES.INVALID_REQUEST, "Invalid operation");
      }
      if (typeof selectedText !== "string") {
        throw apiError(ERROR_CODES.INVALID_REQUEST, "selectedText is required");
      }

      const trimmed = selectedText.trim();
      if (trimmed.length === 0) {
        throw apiError(ERROR_CODES.INVALID_REQUEST, "selectedText is empty");
      }

      // Safety cap (prevents runaway requests)
      const MAX_SELECTED = 20_000;
      if (selectedText.length > MAX_SELECTED) {
        throw apiError(ERROR_CODES.INVALID_REQUEST, `selectedText too large (max ${MAX_SELECTED} chars)`);
      }

      const out = await runJob({
        jobId,
        operation,
        selectedText,
        parameters: (parameters ?? undefined) as any,
      });

      if (!out?.result || typeof out.result !== "string") {
        throw apiError(ERROR_CODES.AI_PROVIDER_UNAVAILABLE, "Provider returned invalid response");
      }

      return res.json({ result: out.result });
    } catch (err: any) {
      // If provider/runJob threw a structured ApiError, pass through.
      if (err && typeof err === "object" && typeof err.code === "string" && typeof err.message === "string") {
        return next(err);
      }

      // Otherwise normalize to a provider-unavailable error to keep API contract stable.
      return next(
        apiError(ERROR_CODES.AI_PROVIDER_UNAVAILABLE, "AI provider unavailable", {
          originalMessage: err?.message ?? String(err),
        })
      );
    }
  },
};