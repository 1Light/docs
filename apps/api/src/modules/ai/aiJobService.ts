// apps/api/src/modules/ai/aiJobService.ts

import { ERROR_CODES } from "@repo/contracts/src/constants/errorCodes";
import type { AIOperation } from "@repo/contracts/src/types/dtos";
import type { DocumentRole } from "@repo/contracts/src/constants/roles";

import { config } from "../../config/env";
import { documentRepo } from "../documents/documentRepo";
import { aiJobRepo } from "../ai/aiJobRepo";
import { aiJobApplicationRepo } from "../ai/aiJobApplicationRepo";
import { versionRepo } from "../versions/versionRepo";
import { permissionService } from "../permissions/permissionService";
import { aiPolicyService } from "./aiPolicyService";
import { auditLogService } from "../audit/auditLogService";

import { AIJobStatus, AIOperation as PrismaAIOperation } from "@prisma/client";

type CreateJobParams = {
  documentId: string;
  requesterId: string;
  operation: AIOperation;
  selection: { start: number; end: number };
  parameters?: { tone?: string; language?: string; formatStyle?: string };
};

type ApplyJobParams = {
  jobId: string;
  requesterId: string;
  finalText: string;
};

function apiError(code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES], message: string, details?: unknown) {
  return { code, message, ...(details !== undefined ? { details } : {}) };
}

async function callAIServiceRunJob(payload: {
  jobId: string;
  operation: AIOperation;
  selectedText: string;
  parameters?: Record<string, unknown>;
}): Promise<{ result: string }> {
  const url = `${config.AI_SERVICE_URL}/jobs/run`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw apiError(ERROR_CODES.AI_PROVIDER_UNAVAILABLE, "AI service unavailable");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw apiError(ERROR_CODES.AI_PROVIDER_UNAVAILABLE, "AI service error", {
      status: res.status,
      body: text,
    });
  }

  const data = (await res.json().catch(() => null)) as { result?: string } | null;
  if (!data?.result || typeof data.result !== "string") {
    throw apiError(ERROR_CODES.AI_PROVIDER_UNAVAILABLE, "AI service returned invalid response");
  }

  return { result: data.result };
}

function normalizeSelection(selection: { start: number; end: number }, contentLength: number) {
  const start = Number(selection?.start);
  const end = Number(selection?.end);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw apiError(ERROR_CODES.INVALID_REQUEST, "Invalid selection range");
  }
  if (start < 0 || end < 0 || end <= start) {
    throw apiError(ERROR_CODES.INVALID_REQUEST, "Invalid selection range");
  }

  const safeStart = Math.min(start, contentLength);
  const safeEnd = Math.min(end, contentLength);

  if (safeEnd <= safeStart) {
    throw apiError(ERROR_CODES.INVALID_REQUEST, "Selection is out of bounds");
  }

  const MAX_LEN = 20000;
  const len = safeEnd - safeStart;
  if (len > MAX_LEN) {
    throw apiError(ERROR_CODES.INVALID_REQUEST, `Selection too large (max ${MAX_LEN} chars)`);
  }

  return { start: safeStart, end: safeEnd };
}

function replaceRange(base: string, start: number, end: number, insert: string): string {
  const s = Math.max(0, Math.min(start, base.length));
  const e = Math.max(s, Math.min(end, base.length));
  return base.slice(0, s) + insert + base.slice(e);
}

export const aiJobService = {
  async createJob(params: CreateJobParams) {
    const doc = await documentRepo.findById(params.documentId);
    if (!doc) throw apiError(ERROR_CODES.NOT_FOUND, "Document not found");

    const role = await permissionService.resolveEffectiveRole({
      documentId: params.documentId,
      userId: params.requesterId,
    });
    if (!role) throw apiError(ERROR_CODES.FORBIDDEN, "No access to this document");

    const allowedToInvoke: DocumentRole[] = ["Editor", "Owner"];
    if (!allowedToInvoke.includes(role)) {
      throw apiError(ERROR_CODES.FORBIDDEN, "Insufficient role to invoke AI");
    }

    await aiPolicyService.enforceAtJobCreation({
      documentRole: role,
      userId: params.requesterId,
    });

    const normalized = normalizeSelection(params.selection, doc.content.length);
    const selectedText = doc.content.slice(normalized.start, normalized.end);

    const job = await aiJobRepo.create({
      documentId: doc.id,
      userId: params.requesterId,
      operation: params.operation as unknown as PrismaAIOperation,
      selectionStart: normalized.start,
      selectionEnd: normalized.end,
      parameters: params.parameters ?? {},
      basedOnVersionId: doc.headVersionId ?? null,
    });

    await aiJobRepo.updateStatus(job.id, AIJobStatus.running);

    try {
      const { result } = await callAIServiceRunJob({
        jobId: job.id,
        operation: params.operation,
        selectedText,
        parameters: params.parameters ?? {},
      });

      await aiJobRepo.updateStatus(job.id, AIJobStatus.succeeded, { result });
    } catch (err: any) {
      await aiJobRepo.updateStatus(job.id, AIJobStatus.failed, {
        errorMessage: err?.message ?? "AI job failed",
      });
    }

    const updated = await aiJobRepo.findById(job.id);
    if (!updated) throw apiError(ERROR_CODES.INTERNAL_ERROR, "AI job missing after creation");
    return updated;
  },

  async getJob(jobId: string) {
    const job = await aiJobRepo.findById(jobId);
    if (!job) throw apiError(ERROR_CODES.NOT_FOUND, "AI job not found");
    return job;
  },

  async applyJob(params: ApplyJobParams) {
    const job = await aiJobRepo.findById(params.jobId);
    if (!job) throw apiError(ERROR_CODES.NOT_FOUND, "AI job not found");

    if (job.status !== AIJobStatus.succeeded) {
      throw apiError(ERROR_CODES.INVALID_REQUEST, "AI job is not in a succeeded state");
    }

    const doc = await documentRepo.findById(job.documentId);
    if (!doc) throw apiError(ERROR_CODES.NOT_FOUND, "Document not found");

    const role = await permissionService.resolveEffectiveRole({
      documentId: doc.id,
      userId: params.requesterId,
    });
    if (!role) throw apiError(ERROR_CODES.FORBIDDEN, "No access to this document");
    if (!["Editor", "Owner"].includes(role)) {
      throw apiError(ERROR_CODES.FORBIDDEN, "Insufficient role to apply AI suggestion");
    }

    const normalized = normalizeSelection(
      { start: job.selectionStart, end: job.selectionEnd },
      doc.content.length
    );

    const newContent = replaceRange(doc.content, normalized.start, normalized.end, params.finalText);

    const newVersion = await versionRepo.create({
      documentId: doc.id,
      parentVersionId: doc.headVersionId ?? null,
      content: newContent,
      authorId: params.requesterId,
      reason: "ai_application",
    });

    const updatedDoc = await documentRepo.updateContent(doc.id, newContent, newVersion.id);

    await aiJobApplicationRepo.create({
      aiJobId: job.id,
      appliedById: params.requesterId,
      finalText: params.finalText,
      newVersionId: newVersion.id,
    });

    await auditLogService.logAction({
      userId: params.requesterId,
      actionType: "AI_SUGGESTION_APPLIED",
      documentId: doc.id,
      metadata: {
        aiJobId: job.id,
        basedOnVersionId: job.basedOnVersionId,
        newHeadVersionId: newVersion.id,
      },
    });

    return {
      versionHeadId: updatedDoc.headVersionId,
      updatedAt: updatedDoc.updatedAt.toISOString(),
    };
  },
};