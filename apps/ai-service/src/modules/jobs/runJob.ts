// apps/ai-service/src/modules/jobs/runJob.ts

import { ERROR_CODES } from "@repo/contracts/src/constants/errorCodes";
import type { LLMOperation, LLMProvider } from "../../providers/llmProvider";
import { MockProvider } from "../../providers/mockProvider";
import { GeminiProvider } from "../../providers/geminiProvider";
import { config } from "../../config/env";
import { withRetry } from "../../lib/retry";
import { buildPrompt } from "./promptTemplates";

function apiError(code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES], message: string, details?: unknown) {
  return { code, message, ...(details !== undefined ? { details } : {}) };
}

function getProvider(): LLMProvider {
  switch (config.LLM_PROVIDER) {
    case "gemini":
      return new GeminiProvider();
    case "mock":
    default:
      return new MockProvider();
  }
}

export type RunJobInput = {
  jobId: string;
  operation: LLMOperation;
  selectedText: string;
  parameters?: {
    tone?: string;
    language?: string;
    formatStyle?: string;
  };
};

export async function runJob(input: RunJobInput): Promise<{ result: string }> {
  const provider = getProvider();

  const prompt = buildPrompt(input.operation, {
    selectedText: input.selectedText,
    tone: input.parameters?.tone,
    language: input.parameters?.language,
    formatStyle: input.parameters?.formatStyle,
  });

  const run = async () => {
    return provider.run({
      operation: input.operation,
      selectedText: input.selectedText,
      prompt,
      parameters: input.parameters,
    });
  };

  const result = await withRetry(run, {
    retries: 2,
    baseDelayMs: 400,
    maxDelayMs: 2500,
    shouldRetry: (err) => {
      const msg = (err as any)?.message?.toLowerCase?.() ?? "";
      return (
        msg.includes("timeout") ||
        msg.includes("temporar") ||
        msg.includes("rate") ||
        msg.includes("503") ||
        msg.includes("502") ||
        msg.includes("network")
      );
    },
  });

  if (!result?.result || typeof result.result !== "string") {
    throw apiError(ERROR_CODES.AI_PROVIDER_UNAVAILABLE, "Provider returned invalid response");
  }

  return { result: result.result };
}