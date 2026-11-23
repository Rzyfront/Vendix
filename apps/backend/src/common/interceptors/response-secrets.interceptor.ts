import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { RESPONSE_SECRET_KEYS } from '../utils/safe-user-select.util';

const SECRET_KEYS: ReadonlySet<string> = new Set(RESPONSE_SECRET_KEYS);

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
    if (SECRET_KEYS.has(key)) {
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
 * Returns `value` without any `RESPONSE_SECRET_KEYS` key, at any depth.
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
 * credential keys of `users` (`password`, `two_factor_secret`) never reach
 * the client. The primary control is still the explicit `SAFE_USER_SELECT`
 * in each query; this interceptor only covers a future query that forgets it.
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
