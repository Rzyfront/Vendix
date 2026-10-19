/** Preserve SDK transport facts, without matching arbitrary provider prose. */
export function providerFailureMetadata(error: unknown): {
  error_code?: string;
  retryable?: boolean;
} {
  const err = error as { status?: number; code?: string; name?: string };
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
  };
}
