// packages/contracts/src/schemas/aiSchemas.ts

import { z } from "zod";

/* =========================
   Enums
========================= */

export const aiOperationSchema = z.enum([
  "rewrite",
  "summarize",
  "translate",
  "reformat",
]);

export type AIOperation = z.infer<typeof aiOperationSchema>;

export const aiJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export type AIJobStatus = z.infer<typeof aiJobStatusSchema>;

/* =========================
   Create AI Job
========================= */

export const createAIJobRequestSchema = z.object({
  documentId: z.string().min(1),
  operation: aiOperationSchema,
  selection: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }).refine(
    (val) => val.end > val.start,
    { message: "selection.end must be greater than selection.start" }
  ),
  parameters: z.object({
    tone: z.string().optional(),
    language: z.string().optional(),
    formatStyle: z.string().optional(),
  }).optional(),
});

export type CreateAIJobRequest = z.infer<
  typeof createAIJobRequestSchema
>;

/* =========================
   AI Job Response
========================= */

export const aiJobResponseSchema = z.object({
  jobId: z.string(),
  status: aiJobStatusSchema,
  result: z.string().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
  createdAt: z.string(), // ISO date
});

export type AIJobResponse = z.infer<
  typeof aiJobResponseSchema
>;

/* =========================
   Apply AI Job
========================= */

export const applyAIJobRequestSchema = z.object({
  finalText: z.string().min(1),
});

export type ApplyAIJobRequest = z.infer<
  typeof applyAIJobRequestSchema
>;

export const applyAIJobResponseSchema = z.object({
  versionHeadId: z.string(),
  updatedAt: z.string(), // ISO date
});

export type ApplyAIJobResponse = z.infer<
  typeof applyAIJobResponseSchema
>;