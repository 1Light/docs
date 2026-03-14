// apps/api/src/modules/documents/exportService.ts

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import HtmlToDocx from "@turbodocx/html-to-docx";
import htmlPdf from "html-pdf-node";

import { ERROR_CODES } from "@repo/contracts";
import { documentRepo } from "./documentRepo";

const EXPORT_DIR = process.env.EXPORT_DIR || path.join(process.cwd(), "exports");
const BASE_URL = process.env.EXPORT_BASE_URL || "http://localhost:4000";

type ExportFormat = "pdf" | "docx";

type HtmlPdfGeneratePdf = (
  file: { content: string },
  options: {
    format: string;
    printBackground: boolean;
    margin: {
      top: string;
      right: string;
      bottom: string;
      left: string;
    };
    args?: string[];
  }
) => Promise<Buffer | Uint8Array | ArrayBuffer>;

type HtmlToDocxFn = (
  html: string,
  headerHtml?: string,
  documentOptions?: {
    title?: string;
    creator?: string;
    margins?: {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };
  },
  footerHtml?: string
) => Promise<Buffer | Uint8Array | ArrayBuffer>;

const generatePdf = (htmlPdf as unknown as { generatePdf: HtmlPdfGeneratePdf }).generatePdf;
const htmlToDocx = HtmlToDocx as unknown as HtmlToDocxFn;

async function ensureExportDir() {
  await fs.mkdir(EXPORT_DIR, { recursive: true });
}

function randomToken() {
  return crypto.randomBytes(16).toString("hex");
}

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeTitle(title: string | null | undefined) {
  const clean = typeof title === "string" ? title.trim() : "";
  return clean.length > 0 ? clean : "document";
}

function toBuffer(value: Buffer | ArrayBuffer | Uint8Array) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapHtmlDocument(params: { title: string; bodyHtml: string }) {
  const title = normalizeTitle(params.title);
  const bodyHtml = typeof params.bodyHtml === "string" ? params.bodyHtml : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page {
        size: A4;
        margin: 20mm 16mm;
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        padding: 0;
        margin: 0;
        background: #ffffff;
        color: #111827;
        font-family: Arial, Helvetica, sans-serif;
        line-height: 1.6;
        font-size: 12pt;
      }

      body {
        padding: 0;
      }

      .document-shell {
        width: 100%;
      }

      .document-content {
        width: 100%;
      }

      .document-content h1,
      .document-content h2,
      .document-content h3,
      .document-content h4,
      .document-content h5,
      .document-content h6 {
        color: #111827;
        line-height: 1.3;
        margin-top: 1.2em;
        margin-bottom: 0.5em;
      }

      .document-content h1 { font-size: 20pt; }
      .document-content h2 { font-size: 17pt; }
      .document-content h3 { font-size: 15pt; }

      .document-content p {
        margin: 0 0 0.9em 0;
      }

      .document-content ul,
      .document-content ol {
        margin: 0 0 1em 1.4em;
        padding: 0;
      }

      .document-content li {
        margin: 0.2em 0;
      }

      .document-content blockquote {
        margin: 1em 0;
        padding: 0.75em 1em;
        border-left: 4px solid #d1d5db;
        background: #f9fafb;
      }

      .document-content pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 12px 14px;
        overflow: hidden;
      }

      .document-content code {
        white-space: pre-wrap;
        word-break: break-word;
      }

      .document-content img {
        max-width: 100%;
        height: auto;
      }

      .document-content table {
        width: 100%;
        border-collapse: collapse;
        margin: 1em 0;
      }

      .document-content th,
      .document-content td {
        border: 1px solid #d1d5db;
        padding: 8px 10px;
        vertical-align: top;
        text-align: left;
      }

      .document-content hr {
        border: 0;
        border-top: 1px solid #e5e7eb;
        margin: 1.25em 0;
      }
    </style>
  </head>
  <body>
    <div class="document-shell">
      <div class="document-content">
        ${bodyHtml}
      </div>
    </div>
  </body>
</html>`;
}

async function buildPdfBuffer(html: string) {
  const file = { content: html };

  const options = {
    format: "A4",
    printBackground: true,
    margin: {
      top: "12mm",
      right: "12mm",
      bottom: "12mm",
      left: "12mm",
    },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };

  const out = await generatePdf(file, options);
  return toBuffer(out);
}

async function buildDocxBuffer(title: string, html: string) {
  const out = await htmlToDocx(
    html,
    undefined,
    {
      title,
      creator: "Collab Editor",
      margins: {
        top: 1440,
        right: 1440,
        bottom: 1440,
        left: 1440,
      },
    },
    undefined
  );

  return toBuffer(out);
}

export const exportService = {
  /**
   * Export a document to PDF or DOCX.
   */
  async exportDocument(params: {
    documentId: string;
    format: ExportFormat;
  }) {
    const doc = await documentRepo.findById(params.documentId);
    if (!doc) {
      throw { code: ERROR_CODES.NOT_FOUND, message: "Document not found" };
    }

    if (params.format !== "pdf" && params.format !== "docx") {
      throw {
        code: ERROR_CODES.INVALID_REQUEST,
        message: "Only pdf and docx export are supported",
        details: { supported: ["pdf", "docx"], requested: params.format },
      };
    }

    await ensureExportDir();

    const safeTitle = sanitizeFilenamePart(doc.title || "document") || "document";
    const token = randomToken();
    const filename = `${safeTitle}_${doc.id}_${token}.${params.format}`;
    const filepath = path.join(EXPORT_DIR, filename);

    const html = wrapHtmlDocument({
      title: normalizeTitle(doc.title),
      bodyHtml: doc.content || "<p></p>",
    });

    const buffer =
      params.format === "pdf"
        ? await buildPdfBuffer(html)
        : await buildDocxBuffer(normalizeTitle(doc.title), html);

    await fs.writeFile(filepath, buffer);

    const downloadUrl = `${BASE_URL}/exports/${filename}`;

    return {
      downloadUrl,
      format: params.format,
      filename,
    };
  },
};