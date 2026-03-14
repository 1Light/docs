// apps/ai-service/src/modules/jobs/templates.ts

import type { LLMOperation } from "../../providers/llmProvider";

/**
 * Centralized prompt templates.
 * Keeps prompt wording decoupled from provider implementation.
 */

type PromptParams = {
  selectedText: string;
  tone?: string;
  language?: string;
  formatStyle?: string;
};

function sanitizeText(text: string): string {
  // Normalize excessive whitespace but preserve formatting lines
  return text.replace(/\r\n/g, "\n").trim();
}

export function buildPrompt(
  operation: LLMOperation,
  params: PromptParams
): string {
  const text = sanitizeText(params.selectedText);
  const tone = params.tone?.trim();
  const language = params.language?.trim();
  const formatStyle = params.formatStyle?.trim();

  switch (operation) {
    case "summarize":
      return `
You are an assistant helping improve a document.

Task:
Summarize the text below clearly and concisely.
Do not add information that is not present.

--- BEGIN TEXT ---
${text}
--- END TEXT ---
`.trim();

    case "rewrite":
      return `
You are an assistant helping improve a document.

Task:
Rewrite the text below${tone ? ` in a ${tone} tone` : ""}.
Do not introduce new information.
Preserve meaning.

--- BEGIN TEXT ---
${text}
--- END TEXT ---
`.trim();

    case "translate":
      return `
You are an assistant helping improve a document.

Task:
Translate the text below to ${language ?? "English"}.
Preserve meaning and formatting.

--- BEGIN TEXT ---
${text}
--- END TEXT ---
`.trim();

    case "reformat":
      return `
You are an assistant helping improve a document.

Task:
Reformat the text below into ${formatStyle ?? "a clean structured format"}.
Do not change meaning.

--- BEGIN TEXT ---
${text}
--- END TEXT ---
`.trim();

    default:
      return text;
  }
}