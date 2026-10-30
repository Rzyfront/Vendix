/**
 * QUI-966 (S6) — helpers for `PREFIX + sequence` document numbers
 * (`BKG-20261105-0001`, `ORD2610290001`) generated as "max + 1" and protected
 * by a unique index.
 *
 * - The max is numeric, not lexicographic: after `...9999` comes `...10000`,
 *   which sorts BEFORE `...9999` as a string, so `ORDER BY number DESC`
 *   would hand back 9999 again and collide forever.
 * - Concurrent writers can still read the same max; callers retry on the
 *   unique violation (P2002) of their number column.
 */

/**
 * Highest numeric sequence found after `prefix` (0 when none). Values whose
 * suffix is not purely digits are ignored.
 */
export function maxSequenceAfterPrefix(
  numbers: ReadonlyArray<string | null | undefined>,
  prefix: string,
): number {
  let max = 0;
  for (const value of numbers) {
    if (!value || !value.startsWith(prefix)) continue;
    const suffix = value.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const n = Number(suffix);
    if (Number.isSafeInteger(n) && n > max) max = n;
  }
  return max;
}

/** `prefix` + (max + 1), zero-padded to at least 4 digits. */
export function nextSequenceNumber(
  numbers: ReadonlyArray<string | null | undefined>,
  prefix: string,
): string {
  const next = maxSequenceAfterPrefix(numbers, prefix) + 1;
  return `${prefix}${next.toString().padStart(4, '0')}`;
}

/**
 * True when `error` is a Prisma unique violation (P2002) on a constraint that
 * involves `field`. Reads both the classic `meta.target` and the Prisma 7
 * driver-adapter shape (`meta.driverAdapterError.cause.constraint`, either
 * `{ fields: [...] }` or `{ index: '<name>' }`).
 */
export function isUniqueViolationOn(error: unknown, field: string): boolean {
  const err = error as any;
  if (err?.code !== 'P2002') return false;
  const rawTarget = err?.meta?.target;
  const constraint = err?.meta?.driverAdapterError?.cause?.constraint;
  const haystack = [
    Array.isArray(rawTarget) ? rawTarget.join(',') : rawTarget,
    constraint ? JSON.stringify(constraint) : undefined,
    typeof err?.message === 'string' ? err.message : undefined,
  ]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ');
  return haystack.includes(field);
}

/**
 * True when `error` is a Postgres serialization failure / write conflict
 * (Prisma P2034, SQLSTATE 40001) — the transaction can be retried.
 */
export function isSerializationFailure(error: unknown): boolean {
  const err = error as any;
  if (err?.code === 'P2034' || err?.code === '40001') return true;
  if (err?.meta?.code === '40001') return true;
  if (err?.meta?.driverAdapterError?.cause?.originalCode === '40001') {
    return true;
  }
  // Only the Postgres serialization text or the SQLSTATE as its own code
  // token ("code: 40001", "SQLSTATE 40001") — never any "40001" substring
  // (an id, an amount or an order number in an unrelated error message).
  const message = typeof err?.message === 'string' ? err.message : '';
  return /could not serialize access|\b(?:sqlstate|code)\W{0,3}40001\b/i.test(
    message,
  );
}

/** Small jittered pause between retries so racing writers spread out. */
export function retryBackoff(attempt: number): Promise<void> {
  const ms = 5 + Math.floor(Math.random() * 20) * (attempt + 1);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
