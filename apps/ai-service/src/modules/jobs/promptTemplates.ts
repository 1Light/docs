// apps/ai-service/src/modules/jobs/promptTemplates.ts

import type { LLMOperation } from "../../providers/llmProvider";

/**
 * Centralized prompt templates.
 * Keeps prompt wording decoupled from provider implementation.
 */

type PromptParams = {
  selectedText: string;
  style?: string;
  summaryStyle?: string;
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
  const style = params.style?.trim();
  const summaryStyle = params.summaryStyle?.trim();
  const language = params.language?.trim();
  const formatStyle = params.formatStyle?.trim();

  switch (operation) {
    case "summarize":
      return `
You are an assistant helping improve a document.

Task:
Summarize the text below.

Requirements:
- Preserve the original meaning.
- Do not add new facts.
- Be concise.

Output style:
${summaryStyle === "bullet_points" ? "- 3 bullet points." : "- A short paragraph summary."}

--- BEGIN TEXT ---
${text}
--- END TEXT ---
`.trim();

    case "enhance":
      return `
You are an assistant helping improve a document.

Task:
Improve the writing quality of the text below.

Requirements:
- Preserve meaning and facts.
- Do not add new information.
- Improve clarity and readability.

Style:
${style ?? "clear and professional"}

--- BEGIN TEXT ---
${text}
--- END TEXT ---
`.trim();

    case "translate":
      return `
You are an assistant helping improve a document.

Task:
Translate the text below to ${language ?? "English"}.

Requirements:
- Preserve meaning.
- Preserve formatting where possible.
- Do not add commentary.

--- BEGIN TEXT ---
${text}
--- END TEXT ---
`.trim();

    case "reformat":
      return `
You are an assistant helping improve a document.

Task:
Reformat the text below.

Target format:
${formatStyle ?? "a clean structured format"}

Requirements:
- Preserve the original meaning.
- Do not add new facts.
- Only change structure or presentation.

--- BEGIN TEXT ---
${text}
--- END TEXT ---
`.trim();

    default:
      return text;
  }
}