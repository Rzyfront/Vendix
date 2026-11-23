/**
 * Value stored and returned in place of a credential inside the JSON columns
 * of `audit_logs` (`old_values`, `new_values`, `metadata`).
 */
export const AUDIT_REDACTED = '[REDACTED]';

/**
 * Keys whose value is a credential. The audit interceptor stores request
 * bodies as-is, so any of these keys can arrive with a plaintext value
 * (password changes, invoicing PINs and certificates, provider tokens and
 * secrets). Keys are compared in snake_case, so `newPassword` and `apiKey`
 * match too.
 */
const SECRET_KEYS: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'pin',
  'secret',
  'token',
  'api_key',
  'apikey',
  'private_key',
  'technical_key',
  'p12',
  'certificate_base64',
  'certificate_file',
]);

/**
 * Suffixes (and the `password_` prefix) that mark a credential:
 * `certificate_password`, `software_pin_encrypted`, `integrity_secret`,
 * `personal_auth_token`, `password_confirmation`... Counters such as
 * `max_tokens` or `total_tokens` do not match.
 */
const SECRET_PATTERN =
  /(^password_|_password(_encrypted)?$|_pin(_encrypted)?$|_secret$|_token$|_api_key$|_private_key$)/;

function toSnakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function isAuditSecretKey(key: string): boolean {
  const normalized = toSnakeCase(key);
  return SECRET_KEYS.has(normalized) || SECRET_PATTERN.test(normalized);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redact(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value);
    seen.set(value, value);
    let copy: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const next = redact(value[i], seen);
      if (next !== value[i]) {
        copy ??= value.slice();
        copy[i] = next;
      }
    }
    if (copy) seen.set(value, copy);
    return copy ?? value;
  }
  if (!isPlainObject(value)) return value;
  if (seen.has(value)) return seen.get(value);
  seen.set(value, value);
  let copy: Record<string, unknown> | null = null;
  for (const key of Object.keys(value)) {
    const current = value[key];
    const next =
      isAuditSecretKey(key) && current !== null && current !== undefined
        ? AUDIT_REDACTED
        : redact(current, seen);
    if (next !== current) {
      copy ??= { ...value };
      copy[key] = next;
    }
  }
  if (copy) seen.set(value, copy);
  return copy ?? value;
}

/**
 * Copy of an audit payload with every credential value replaced by
 * `AUDIT_REDACTED`, at any depth. Returns the same reference when nothing
 * had to change. Applied when writing a row and again when reading, so rows
 * written before this existed are not exposed either.
 */
export function redactAuditSecrets<T>(value: T): T {
  return redact(value, new WeakMap()) as T;
}

/** Redacts the JSON columns of `audit_logs` rows that are about to be returned. */
export function redactAuditRows<
  T extends { old_values?: unknown; new_values?: unknown; metadata?: unknown },
>(rows: T[]): T[] {
  return rows.map((row) => {
    const old_values = redactAuditSecrets(row.old_values);
    const new_values = redactAuditSecrets(row.new_values);
    const metadata = redactAuditSecrets(row.metadata);
    if (
      old_values === row.old_values &&
      new_values === row.new_values &&
      metadata === row.metadata
    ) {
      return row;
    }
    return { ...row, old_values, new_values, metadata };
  });
}
