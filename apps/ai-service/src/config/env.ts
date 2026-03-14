// apps/ai-service/src/utils/config.ts

import { z } from "zod";

/**
 * Environment configuration for AI Service
 * Validates required variables at boot time.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  PORT: z.coerce.number().int().positive().default(4002),

  // Provider selection
  LLM_PROVIDER: z.enum(["gemini", "mock"]).default("mock"),

  // API key (required for gemini)
  LLM_API_KEY: z.string().optional(),

  // Optional model name (recommended to set explicitly in env)
  LLM_MODEL: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(
      "Invalid AI service environment variables:",
      parsed.error.flatten().fieldErrors
    );
    throw new Error("Invalid AI service environment configuration");
  }

  const env = parsed.data;

  if (env.LLM_PROVIDER === "gemini" && !env.LLM_API_KEY) {
    throw new Error("LLM_API_KEY is required when LLM_PROVIDER=gemini");
  }

  return env;
}

const loaded = loadEnv();

export const config = {
  ...loaded,

  // Sensible model defaults: pick one that supports generateContent on the used API version
  LLM_MODEL:
    loaded.LLM_MODEL ??
    (loaded.LLM_PROVIDER === "gemini"
      ? "gemini-2.0-flash"
      : undefined),
};