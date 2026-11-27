/**
 * Shared rules for `users.username` (`String @unique @db.VarChar(50)`).
 *
 * The column is unique across the WHOLE `users` table (every organization and
 * store), so any panel that writes it must check the global namespace.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;

/** Format accepted by the store users DTO (`CreateStoreUserDto.username`). */
export const STORE_USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/** Upper bound of counter attempts before falling back to a random suffix. */
const MAX_COUNTER_ATTEMPTS = 100;

/** Input normalization applied before checking or persisting a username. */
export function normalizeUsername(raw: string | null | undefined): string {
  return (raw ?? '').trim();
}

/**
 * Validates the shape of an already-normalized username: 3–50 characters and,
 * when given, the context pattern (store DTO is stricter than org/superadmin).
 */
export function isUsernameFormatValid(
  username: string,
  pattern?: RegExp,
): boolean {
  if (
    username.length < USERNAME_MIN_LENGTH ||
    username.length > USERNAME_MAX_LENGTH
  ) {
    return false;
  }
  return pattern ? pattern.test(username) : true;
}

/**
 * `base` + `suffix` cut so the result never exceeds the column width. The base
 * is truncated (never the suffix) so the uniqueness discriminator survives.
 */
export function fitUsername(base: string, suffix = ''): string {
  const room = Math.max(USERNAME_MAX_LENGTH - suffix.length, 1);
  return `${base.slice(0, room)}${suffix}`;
}

/**
 * Generates a username that `exists` reports as free and that fits in 50
 * characters: `base`, then `base1`, `base2`… and, after 100 collisions,
 * `base_<random>`. `exists` is injected so each caller keeps its own Prisma
 * client (scoped, unscoped or transactional).
 */
export async function generateUniqueUsername(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
  fallbackBase = 'usuario',
): Promise<string> {
  const root = normalizeUsername(base) || fallbackBase;

  let candidate = fitUsername(root);
  for (let counter = 1; counter <= MAX_COUNTER_ATTEMPTS; counter++) {
    if (!(await exists(candidate))) return candidate;
    candidate = fitUsername(root, String(counter));
  }

  // Pathological collision run: a time+random suffix is practically unique.
  // The P2002 safety net of each caller covers the remaining race.
  const randomSuffix = `_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  return fitUsername(root, randomSuffix);
}

/**
 * True when `error` is a Prisma P2002 on `users.username`. With the pg driver
 * adapter the constraint arrives in `meta.driverAdapterError.cause.constraint`
 * instead of `meta.target`, and the message names `users_username_key`.
 */
export function isUsernameUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as {
    code?: unknown;
    message?: unknown;
    meta?: {
      target?: unknown;
      constraint?: unknown;
      driverAdapterError?: { cause?: { constraint?: unknown } };
    };
  };
  if (e.code !== 'P2002') return false;

  const named = JSON.stringify([
    e.meta?.target,
    e.meta?.constraint,
    e.meta?.driverAdapterError?.cause?.constraint,
  ]);
  if (named.includes('username')) return true;
  return typeof e.message === 'string' && e.message.includes('username');
}
