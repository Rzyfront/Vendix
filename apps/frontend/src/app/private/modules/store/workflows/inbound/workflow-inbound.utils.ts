/** Absolute URL of the hook: the API base plus the path the backend returned. */
export function inboundHookUrl(apiBase: string, path: string): string {
  return `${apiBase.replace(/\/+$/, '')}${path}`;
}

/**
 * Signed `curl` example for the inbound webhook. The secret is not recoverable,
 * so the example reads it from `VENDIX_WEBHOOK_SECRET`. The signature is
 * `hex(hmac_sha256(secret, "<timestamp>.<raw body>"))`.
 */
export function inboundCurlExample(url: string, fieldKeys: readonly string[]): string {
  const sample = Object.fromEntries(fieldKeys.slice(0, 3).map((key) => [key, 'valor']));
  const body = JSON.stringify({ values: sample });
  return [
    `BODY='${body}'`,
    'TS=$(date +%s)',
    `SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$VENDIX_WEBHOOK_SECRET" -hex | sed 's/^.* //')`,
    `curl -X POST '${url}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'Idempotency-Key: pedido-1001' \\`,
    `  -H "X-Vendix-Timestamp: $TS" \\`,
    `  -H "X-Vendix-Signature: sha256=$SIG" \\`,
    `  --data "$BODY"`,
  ].join('\n');
}

/** Whole-number limit within the backend range, or null when it is not valid. */
export function parseRateLimit(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 600 ? n : null;
}
