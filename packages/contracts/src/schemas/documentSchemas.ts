// packages/contracts/src/schemas/documentSchemas.ts

import { z } from "zod";

/* =========================
   Create Document
========================= */

export const createDocumentRequestSchema = z.object({
  title: z.string().min(1).max(255),
});

export type CreateDocumentRequest = z.infer<
  typeof createDocumentRequestSchema
>;

/* =========================
   Update Document
========================= */

export const updateDocumentRequestSchema = z.object({
  content: z.string(),
});

export type UpdateDocumentRequest = z.infer<
  typeof updateDocumentRequestSchema
>;

/* =========================
   Export Document
========================= */

export const exportDocumentRequestSchema = z.object({
  format: z.enum(["pdf", "docx"]),
});

export type ExportDocumentRequest = z.infer<
  typeof exportDocumentRequestSchema
>;

/* =========================
   Document Response
========================= */

export const documentResponseSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  content: z.string(),
  ownerId: z.string(),
  versionHeadId: z.string(),
  createdAt: z.string(), // ISO date string
  updatedAt: z.string(), // ISO date string
});

export type DocumentResponse = z.infer<
  typeof documentResponseSchema
>;

/* =========================
   Delete Response
========================= */

export const deleteDocumentResponseSchema = z.object({
  deleted: z.boolean(),
});

export type DeleteDocumentResponse = z.infer<
  typeof deleteDocumentResponseSchema
>;