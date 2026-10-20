import "server-only";
import { TIME_RANGES } from "@/types/conflict";

/** Réglages d'AURA : point d'accès OpenAI, plafonds de sortie et limites (bornées par l'environnement). */

export const API_URL = "https://api.openai.com/v1/responses";
export const DEFAULT_MODEL = "gpt-5.6-terra";
export const MAX_SSE_BUFFER_CHARS = 1_000_000;
export const MAX_TOOL_OUTPUT_CHARS = 14_000;
export const MAX_SOURCES = 12;
export const MAX_PROVENANCE = 14;
export const MAX_SPANS_PER_PART = 40;
export const RANGE_KEYS = TIME_RANGES.map((range) => range.key);

function boundedNumber(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : fallback;
}

export function agentLimits() {
  return {
    bodyBytes: 64_000,
    maxMessages: 12,
    maxUserChars: 2000,
    maxAssistantChars: 12_000,
    maxTotalChars: 24_000,
    maxOutputTokens: boundedNumber("AURA_MAX_OUTPUT_TOKENS", 3000, 600, 6000),
    maxBuiltinToolCalls: 4,
    maxRounds: 5,
    maxFunctionCallsPerRound: 4,
    maxFunctionCallsTotal: 8,
    deadlineMs: boundedNumber("AURA_DEADLINE_MS", 90_000, 1000, 300_000),
    idleMs: boundedNumber("AURA_IDLE_MS", 40_000, 500, 120_000),
    toolTimeoutMs: 20_000,
    maxConcurrent: boundedNumber("AURA_MAX_CONCURRENT", 2, 1, 10),
    perClientConcurrent: 1,
    perClientPerMinute: boundedNumber("AURA_CLIENT_PER_MINUTE", 6, 1, 60),
    globalPerMinute: boundedNumber("AURA_GLOBAL_PER_MINUTE", 20, 1, 300),
    dailyRequests: boundedNumber("AURA_DAILY_LIMIT", 300, 1, 5000),
  };
}

export function agentConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}
