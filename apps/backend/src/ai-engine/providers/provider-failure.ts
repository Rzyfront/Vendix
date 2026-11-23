import type { AIProviderFailureReason } from '../interfaces/ai-provider.interface';

/**
 * Billing refusals that providers report without a 402. Anthropic answers a
 * spent balance with a 400 `invalid_request_error` ("Your credit balance is too
 * low…"); DeepSeek/OpenRouter-style gateways say "Insufficient Balance". These
 * are the only phrases matched: a closed list of billing wording, never a guess
 * about retries (QUI-1020).
 */
const BILLING_PHRASES =
  /credit balance is too low|insufficient[ _](balance|credits?|funds|quota)/i;

function isCreditsExhausted(err: {
  status?: number;
  code?: string;
  type?: string;
  message?: string;
}): boolean {
  if (err?.status === 402) return true;
  if (err?.code === 'insufficient_quota' || err?.type === 'insufficient_quota')
    return true;
  return BILLING_PHRASES.test(err?.message ?? '');
}

/** Preserve SDK transport facts, without matching arbitrary provider prose. */
export function providerFailureMetadata(error: unknown): {
  error_code?: string;
  retryable?: boolean;
  failure_reason?: AIProviderFailureReason;
} {
  const err = error as {
    status?: number;
    code?: string;
    name?: string;
    type?: string;
    message?: string;
  };
  // A spent balance never heals on retry, even when it arrives as a 429
  // (OpenAI `insufficient_quota`): retrying only burns the job's attempts.
  if (isCreditsExhausted(err)) {
    return {
      error_code: 'PROVIDER_FAILURE',
      retryable: false,
      failure_reason: 'credits',
    };
  }
  const transient =
    err?.status === 429 ||
    err?.status === 408 ||
    (err?.status ?? 0) >= 500 ||
    [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'UND_ERR_CONNECT_TIMEOUT',
    ].includes(err?.code ?? '') ||
    ['APIConnectionError', 'APIConnectionTimeoutError'].includes(
      err?.name ?? '',
    );
  return {
    error_code: transient ? 'PROVIDER_TRANSIENT' : 'PROVIDER_FAILURE',
    retryable: transient,
    ...(err?.status === 429 && { failure_reason: 'rate_limited' as const }),
  };
}
