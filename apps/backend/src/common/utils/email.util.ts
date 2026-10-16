/** Canonical representation for identity emails, including non-HTTP callers. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Match legacy mixed-case records as well as newly normalized emails. */
export function emailEquals(email: string) {
  // PostgreSQL implements Prisma's insensitive equality with ILIKE. Email
  // characters such as '_' and '%' must stay literal, never act as wildcards.
  const literalEmail = normalizeEmail(email).replace(/[\\%_]/g, '\\$&');
  return { equals: literalEmail, mode: 'insensitive' as const };
}
