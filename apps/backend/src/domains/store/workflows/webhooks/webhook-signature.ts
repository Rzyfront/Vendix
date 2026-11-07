import { createHmac, timingSafeEqual } from 'crypto';

export const WEBHOOK_SIGNATURE_HEADER = 'X-Vendix-Signature';
export const WEBHOOK_EVENT_HEADER = 'X-Vendix-Event';
export const WEBHOOK_DELIVERY_HEADER = 'X-Vendix-Delivery';

/** hex(hmac_sha256(secret, `${ts}.${body}`)) */
export function computeWebhookSignature(
  secret: string,
  timestamp: number,
  body: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

/** `t=<unix seconds>,v1=<hex>` */
export function buildSignatureHeader(
  secret: string,
  timestamp: number,
  body: string,
): string {
  return `t=${timestamp},v1=${computeWebhookSignature(secret, timestamp, body)}`;
}

/** Receiver-side check (also used by the docs/tests). Constant time. */
export function verifySignatureHeader(
  secret: string,
  header: string,
  body: string,
  opts: { now?: number; toleranceSeconds?: number } = {},
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const ts = Number(parts['t']);
  const v1 = parts['v1'];
  if (
    !Number.isInteger(ts) ||
    typeof v1 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(v1)
  ) {
    return false;
  }
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (opts.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(
    computeWebhookSignature(secret, ts, body),
    'hex',
  );
  const given = Buffer.from(v1, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
