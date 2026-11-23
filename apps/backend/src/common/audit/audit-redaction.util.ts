/**
 * Value stored and returned in place of a credential inside the JSON columns
 * of `audit_logs` (`old_values`, `new_values`, `metadata`).
 */
export const AUDIT_REDACTED = '[REDACTED]';

/**
 * Keys whose value is a credential. The audit interceptor stores request
 * bodies as-is, so any of these keys can arrive with a plaintext value
 * (password changes, token or secret settings).
 */
const SECRET_KEY =
  /^(password|passwd|current_password|old_password|new_password|confirm_password|password_confirmation|two_factor_secret|secret|client_secret|api_key|access_token|refresh_token|token)$/i;

export function isAuditSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    let copy: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const next = redact(value[i], seen);
      if (next !== value[i]) {
        copy ??= value.slice();
        copy[i] = next;
      }
    }
    return copy ?? value;
  }
  if (!isPlainObject(value)) return value;
  if (seen.has(value)) return value;
  seen.add(value);
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
  return copy ?? value;
}

/**
 * Copy of an audit payload with every credential value replaced by
 * `AUDIT_REDACTED`, at any depth. Returns the same reference when nothing
 * had to change. Applied when writing a row and again when reading, so rows
 * written before this existed are not exposed either.
 */
export function redactAuditSecrets<T>(value: T): T {
  return redact(value, new WeakSet()) as T;
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
