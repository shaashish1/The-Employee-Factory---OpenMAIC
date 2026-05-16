/**
 * LLM auto-fallback helper with cascade.
 *
 * Wraps callLLM with a multi-provider fallback chain. When the primary model
 * fails with rate limit, content filter, credit exhausted, or generic upstream
 * errors, we walk through a cascade of fallback models trying each in turn.
 *
 * Cascade order (skip primary, skip any without configured API key):
 *   1. anthropic:claude-sonnet-4-6  (best quality if Claude credits available)
 *   2. openai:llama-3.3-70b-versatile  (Groq — free tier, fast, reliable)
 *   3. google:gemini-2.5-flash  (free tier, lowest cost when billing on)
 *
 * Keeps classroom generation alive even when one or two providers exhaust
 * their quota — only fails if every configured provider is down.
 */

import { callLLM } from '@/lib/ai/llm';
import { getModel } from '@/lib/ai/providers';
import { resolveApiKey, resolveBaseUrl } from '@/lib/server/provider-config';
import type { ThinkingConfig, ProviderId } from '@/lib/types/provider';
import { createLogger } from '@/lib/logger';

const log = createLogger('LLMFallback');

const FALLBACK_TRIGGERS = [
  'rate_limit',
  'rate limit',
  'credit balance is too low',
  'insufficient_quota',
  'insufficient quota',
  'exceeded your current quota',
  'content_filter',
  'content management policy',
  'ResponsibleAIPolicyViolation',
  'Overloaded',
  'AI_RetryError',
];

interface FallbackEntry {
  modelString: string;
  providerId: ProviderId;
  modelId: string;
  // For Groq via openai-compat provider, we need a non-default baseUrl
  forceBaseUrl?: string;
}

/** Cascade order — tried left-to-right, skipping the primary. */
const CASCADE: FallbackEntry[] = [
  { modelString: 'anthropic:claude-sonnet-4-6', providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
  { modelString: 'openai:llama-3.3-70b-versatile', providerId: 'openai', modelId: 'llama-3.3-70b-versatile' },
  { modelString: 'google:gemini-2.5-flash', providerId: 'google', modelId: 'gemini-2.5-flash' },
];

function shouldFallback(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const body = (err as { responseBody?: string })?.responseBody ?? '';
  const combined = msg + ' ' + body;
  return FALLBACK_TRIGGERS.some((t) => combined.includes(t));
}

function tryResolveFallbackModel(entry: FallbackEntry) {
  const apiKey = resolveApiKey(entry.providerId, '');
  if (!apiKey) return null;
  try {
    const baseUrl = entry.forceBaseUrl ?? resolveBaseUrl(entry.providerId, undefined);
    const { model } = getModel({
      providerId: entry.providerId,
      modelId: entry.modelId,
      apiKey,
      baseUrl,
    });
    return model;
  } catch {
    return null;
  }
}

/**
 * Call LLM with cascading fallback. Tries primary first, then each fallback
 * in CASCADE order, skipping the primary's modelString and any provider
 * missing an API key.
 */
export async function callLLMWithFallback<T extends Parameters<typeof callLLM>[0]>(
  params: T,
  source: string,
  primaryModelString: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  retryOptions?: any,
  thinking?: ThinkingConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Awaited<ReturnType<typeof callLLM>>> {
  let lastErr: unknown;
  try {
    return await callLLM(params, source, retryOptions, thinking);
  } catch (err) {
    lastErr = err;
    if (!shouldFallback(err)) throw err;
  }

  // Build candidate fallback list — skip primary, skip those with no key
  const candidates = CASCADE.filter((c) => c.modelString !== primaryModelString);

  for (const entry of candidates) {
    const fbModel = tryResolveFallbackModel(entry);
    if (!fbModel) {
      log.info(
        `[${source}] Skipping ${entry.modelString} (no API key configured or resolve failed)`,
      );
      continue;
    }
    const reason = lastErr instanceof Error ? lastErr.message.substring(0, 100) : String(lastErr).substring(0, 100);
    log.warn(
      `[${source}] Cascading fallback ${primaryModelString} → ${entry.modelString}. Last error: ${reason}`,
    );
    try {
      const fbParams = { ...params, model: fbModel };
      return await callLLM(fbParams, `${source}+fallback-${entry.providerId}`, retryOptions, undefined);
    } catch (err) {
      lastErr = err;
      if (!shouldFallback(err)) {
        // Non-retryable upstream error from this fallback — stop cascading and surface
        throw err;
      }
      // continue cascade
    }
  }

  log.error(`[${source}] All fallback providers exhausted. Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  throw lastErr;
}
