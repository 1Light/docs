// apps/ai-service/src/providers/geminiProvider.ts

import { GoogleGenAI } from "@google/genai";
import type { LLMProvider, LLMRunParams, LLMRunResult } from "./llmProvider";
import { config } from "../config/env";

function fallbackPrompt(params: LLMRunParams): string {
  const { operation, selectedText, parameters } = params;

  switch (operation) {
    case "summarize":
      return `Summarize the following text:\n\n${selectedText}`;

    case "rewrite": {
      const tone = parameters?.tone ? ` in a ${parameters.tone} tone` : "";
      return `Rewrite the following text${tone}:\n\n${selectedText}`;
    }

    case "translate": {
      const language = parameters?.language ?? "English";
      return `Translate the following text to ${language}:\n\n${selectedText}`;
    }

    case "reformat": {
      const style = parameters?.formatStyle ?? "a clean format";
      return `Reformat the following text into ${style}:\n\n${selectedText}`;
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

    // NEVER default to 1.5-flash here.
    // Prefer env/config, otherwise use a safer default.
    const model = normalizeModelName(config.LLM_MODEL ?? "gemini-2.0-flash");

    const prompt = (params.prompt && params.prompt.trim().length > 0
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