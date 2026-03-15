// apps/ai-service/src/providers/geminiProvider.ts

import { GoogleGenAI } from "@google/genai";
import type { LLMProvider, LLMRunParams, LLMRunResult } from "./llmProvider";
import { config } from "../config/env";

function fallbackPrompt(params: LLMRunParams): string {
  const { operation, selectedText, parameters } = params;

  switch (operation) {
    case "summarize": {
      const summaryStyle =
        parameters?.summaryStyle === "bullet_points"
          ? "in 3 bullet points"
          : "as a short paragraph";

      return `Summarize the following text ${summaryStyle}. Do not add new information:\n\n${selectedText}`;
    }

    case "enhance": {
      const style = parameters?.style ? ` in a ${parameters.style} style` : "";
      return `Improve the writing quality of the following text${style}. Preserve meaning and do not add new information:\n\n${selectedText}`;
    }

    case "translate": {
      const language = parameters?.language ?? "English";
      return `Translate the following text to ${language}. Preserve meaning and formatting where possible:\n\n${selectedText}`;
    }

    case "reformat": {
      const formatStyle = parameters?.formatStyle ?? "a clean structured format";
      return `Reformat the following text into ${formatStyle}. Preserve meaning and do not add new information:\n\n${selectedText}`;
    }

    default:
      return selectedText;
  }
}

function normalizeModelName(model: string): string {
  const m = model.trim();
  return m.startsWith("models/") ? m.slice("models/".length) : m;
}

export class GeminiProvider implements LLMProvider {
  async run(params: LLMRunParams): Promise<LLMRunResult> {
    if (!config.LLM_API_KEY) {
      throw new Error("LLM_API_KEY not configured");
    }

    const model = normalizeModelName(config.LLM_MODEL ?? "gemini-2.0-flash");

    const prompt = (
      params.prompt && params.prompt.trim().length > 0
        ? params.prompt
        : fallbackPrompt(params)
    ).trim();

    const ai = new GoogleGenAI({ apiKey: config.LLM_API_KEY });

    try {
      const resp = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const text = resp?.text?.trim();
      if (!text) throw new Error("Gemini returned empty response");

      return { result: text };
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : String(err);
      throw new Error(`Gemini generateContent failed (model=${model}): ${msg}`);
    }
  }
}