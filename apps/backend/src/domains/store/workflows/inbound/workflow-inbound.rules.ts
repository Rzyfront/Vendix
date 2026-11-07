import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';

/** Allowed clock skew between the caller and Vendix, in seconds. */
export const INBOUND_SIGNATURE_WINDOW_SECONDS = 300;
export const INBOUND_MAX_BODY_BYTES = 64 * 1024;
export const INBOUND_DEFAULT_RATE_PER_MINUTE = 60;
export const INBOUND_MAX_RATE_PER_MINUTE = 600;
export const INBOUND_KEY_MAX = 120;
/** Rows kept for rejected calls use this prefix; callers cannot use it as a key. */
export const INBOUND_REJECTED_KEY_PREFIX = '~rejected-';
export const INBOUND_SECRET_PREFIX = 'whin_';
export const INBOUND_PUBLIC_PATH = '/public/workflows/hooks';

export const MAILBOX_LOCAL_PART = /^flujos-[0-9a-f]{32}$/;
export const MAILBOX_ALIAS = /^(flujos-[0-9a-f]{32})@([^@]+)$/;
export const MAILBOX_TEXT_MAX = 10_000;
export const MAILBOX_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** `whin_` + 32 random bytes, base64url. Shown once. */
export function generateInboundSecret(): string {
  return `${INBOUND_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function generateInboundPublicId(): string {
  return `wfh_${randomBytes(16).toString('hex')}`;
}

export function generateMailboxLocalPart(): string {
  return `flujos-${randomBytes(16).toString('hex')}`;
}

/** hex(hmac_sha256(secret, `${timestamp}.${rawBody}`)). */
export function inboundSignature(
  secret: string,
  timestamp: number,
  rawBody: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/**
 * Checks `X-Vendix-Timestamp` (unix seconds, within the window) and
 * `X-Vendix-Signature: sha256=<hex>` in constant time. Any malformed input is
 * simply "invalid": the caller never learns which part failed.
 */
export function verifyInboundSignature(
  secret: string,
  headers: { timestamp?: unknown; signature?: unknown },
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const { timestamp, signature } = headers;
  if (typeof timestamp !== 'string' || typeof signature !== 'string') return false;
  if (!/^\d{1,12}$/.test(timestamp.trim())) return false;
  const ts = Number(timestamp.trim());
  if (Math.abs(nowSeconds - ts) > INBOUND_SIGNATURE_WINDOW_SECONDS) return false;
  const match = /^sha256=([0-9a-f]{64})$/.exec(signature.trim().toLowerCase());
  if (!match) return false;
  const expected = Buffer.from(inboundSignature(secret, ts, rawBody), 'hex');
  const given = Buffer.from(match[1], 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function isValidIdempotencyKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.length >= 1 &&
    key.length <= INBOUND_KEY_MAX &&
    !key.startsWith(INBOUND_REJECTED_KEY_PREFIX)
  );
}

export function declaresTrigger(
  definition: Pick<WorkflowDefinitionV1, 'triggers'>,
  kind: 'webhook' | 'email',
): boolean {
  return (definition.triggers ?? []).some((t) => t.kind === kind);
}

/** `"Ana Pérez" <ana@x.co>` → `Ana Pérez`; no display name → empty string. */
export function displayNameOf(fromHeader: string | null | undefined): string {
  if (!fromHeader) return '';
  const idx = fromHeader.indexOf('<');
  if (idx <= 0) return '';
  return fromHeader
    .slice(0, idx)
    .replace(/["\\]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .trim()
    .slice(0, 160);
}
