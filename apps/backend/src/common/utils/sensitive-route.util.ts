/** Redact capability credentials carried in service-session URL paths. */
export function redactSensitiveRoute(value: unknown, requestUrl?: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return String(value ?? '');
  let sanitized = value
    .replace(
      /((?:^|\/)ecommerce\/(?:service-sessions|service-proposals)\/)[^/?#]+/gi,
      '$1[REDACTED]',
    )
    .replace(/([?&]token=)[^&#]*/gi, '$1[REDACTED]');
  if (typeof requestUrl === 'string') {
    const match = requestUrl.match(/(?:^|\/)ecommerce\/(?:service-sessions|service-proposals)\/([A-Za-z0-9_-]{43})(?:[/?#]|$)/i);
    if (match?.[1]) sanitized = sanitized.split(match[1]).join('[REDACTED]');
  }
  return sanitized;
}
