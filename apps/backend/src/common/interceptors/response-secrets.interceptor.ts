import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { RESPONSE_SECRET_KEYS } from '../utils/safe-user-select.util';

const SECRET_KEYS: ReadonlySet<string> = new Set(RESPONSE_SECRET_KEYS);

/**
 * Columns that only a `users` row carries. An object holding one of them is
 * that row (or a copy of it), so its credential keys are removed.
 */
const USER_ROW_MARKERS = [
  'email_verified',
  'two_factor_enabled',
  'two_factor_secret',
  'failed_login_attempts',
  'locked_until',
] as const;

/** Shape of a stored `users.password`: every write hashes it with bcrypt. */
const PASSWORD_HASH = /^\$2[abxy]\$\d{2}\$/;

/**
 * A credential is a `RESPONSE_SECRET_KEYS` key of a `users` row, or a stored
 * password hash under any object. Other `password` keys are business data
 * and stay: the arguments of an AI proposal the user must approve (they come
 * back unchanged on confirmation) or the JSON schema of a tool.
 */
function isUserCredential(
  owner: Record<string, unknown>,
  key: string,
): boolean {
  if (!SECRET_KEYS.has(key)) return false;
  const value = owner[key];
  if (typeof value === 'string' && PASSWORD_HASH.test(value)) return true;
  return USER_ROW_MARKERS.some((marker) =>
    Object.prototype.hasOwnProperty.call(owner, marker),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function strip(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (Array.isArray(value)) {
    const known = seen.get(value);
    if (known !== undefined) return known;
    seen.set(value, value);
    let copy: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const next = strip(value[i], seen);
      if (next !== value[i]) {
        copy ??= value.slice();
        copy[i] = next;
      }
    }
    const result = copy ?? value;
    seen.set(value, result);
    return result;
  }

  if (!isPlainObject(value)) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  seen.set(value, value);

  let copy: Record<string, unknown> | null = null;
  for (const key of Object.keys(value)) {
    if (isUserCredential(value, key)) {
      copy ??= { ...value };
      delete copy[key];
      continue;
    }
    const next = strip(value[key], seen);
    if (next !== value[key]) {
      copy ??= { ...value };
      copy[key] = next;
    }
  }
  const result = copy ?? value;
  seen.set(value, result);
  return result;
}

/**
 * Returns `value` without the credentials of any `users` row it carries, at
 * any depth (see `isUserCredential`).
 *
 * Copy-on-write: the input is never mutated (a cached or shared object keeps
 * its fields for the code that owns it), and branches without secrets are
 * returned by reference. Only arrays and plain objects are walked; `Date`,
 * `Decimal`, `Buffer`, streams and other class instances pass through as is.
 */
export function stripResponseSecrets<T>(value: T): T {
  return strip(value, new WeakMap()) as T;
}

/**
 * Defense in depth for HTTP responses: whatever a handler returns, the
 * credentials of a `users` row (`password`, `two_factor_secret`) never reach
 * the client. The primary control is still the explicit `SAFE_USER_SELECT`
 * in each query; this interceptor only covers a future query that forgets it.
 *
 * It does not remove every `password` key: one outside a `users` row (an AI
 * proposal the user approves, a tool schema) is data the client needs.
 *
 * Request bodies are not touched, so sign-in, registration and password
 * changes keep receiving the password they need.
 */
@Injectable()
export class ResponseSecretsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body) => stripResponseSecrets(body)));
  }
}
