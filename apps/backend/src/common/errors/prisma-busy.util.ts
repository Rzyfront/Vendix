import { Prisma } from '@prisma/client';

/**
 * Prisma error codes that mean "the database is saturated right now, retry":
 *
 * - P2028 — interactive transaction expired (or could not start within
 *   `maxWait`). Prisma rolled it back; nothing it wrote survives.
 * - P2024 — timed out waiting for a free connection in the pool.
 *
 * Neither is a bug in the request, so the client gets a 503 `SYS_BUSY_001`
 * with a retry message instead of a generic 500. Services that wrap errors in
 * their own exception must rethrow these untouched so the global filter can
 * map them.
 */
export const PRISMA_BUSY_CODES: ReadonlySet<string> = new Set(['P2028', 'P2024']);

export function isPrismaBusyError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    PRISMA_BUSY_CODES.has(error.code)
  );
}
