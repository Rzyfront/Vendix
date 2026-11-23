import { Prisma } from '@prisma/client';

/**
 * Columns of `users` that only authentication needs: credentials and the
 * lockout counters. No HTTP response carries them; code that must check a
 * password or a lockout reads them with its own explicit `select`.
 */
export const SENSITIVE_USER_FIELDS = [
  'password',
  'two_factor_secret',
  'failed_login_attempts',
  'locked_until',
] as const;

export type SensitiveUserField = (typeof SENSITIVE_USER_FIELDS)[number];

/**
 * Keys that `ResponseSecretsInterceptor` removes from every `users` row of a
 * response body, at any depth. Limited to credentials: the lockout counters
 * are business data for the Super Admin unlock screen, so endpoints that need
 * them keep selecting them explicitly.
 */
export const RESPONSE_SECRET_KEYS = ['password', 'two_factor_secret'] as const;

/**
 * Minimal `select` for a `users` row that is going to be returned to a
 * client: every scalar column except `SENSITIVE_USER_FIELDS`, and no
 * relation (tokens, sessions and keys live in relations and are never
 * selected through it).
 *
 * Use it as `select: SAFE_USER_SELECT` or spread it to add relations:
 * `select: { ...SAFE_USER_SELECT, user_roles: { ... } }`.
 */
export const SAFE_USER_SELECT = {
  id: true,
  username: true,
  email: true,
  state: true,
  last_login: true,
  email_verified: true,
  two_factor_enabled: true,
  created_at: true,
  updated_at: true,
  first_name: true,
  last_name: true,
  avatar_url: true,
  organization_id: true,
  phone: true,
  document_number: true,
  document_type: true,
  verification_digit: true,
  legal_name: true,
  tax_regime: true,
  person_type: true,
  is_withholding_agent: true,
  fiscal_responsibilities: true,
  ciiu_code: true,
  main_store_id: true,
  terms_accepted_version: true,
  terms_accepted_at: true,
  requires_terms_update: true,
} as const satisfies Prisma.usersSelect;

export type SafeUser = Prisma.usersGetPayload<{
  select: typeof SAFE_USER_SELECT;
}>;

type WithUserFields<T> = T & Partial<Record<SensitiveUserField, unknown>>;

/**
 * Copy of an already loaded user object without `SENSITIVE_USER_FIELDS`.
 * For flows that must read the full row (sign-in compares the password hash,
 * lockout counters) and then return that same user: the query stays as is
 * and only the response object is narrowed.
 */
export function omitSensitiveUserFields<T extends object>(
  user: T,
): Omit<T, SensitiveUserField> {
  const {
    password: _password,
    two_factor_secret: _twoFactorSecret,
    failed_login_attempts: _failedLoginAttempts,
    locked_until: _lockedUntil,
    ...rest
  } = user as WithUserFields<T>;
  return rest as Omit<T, SensitiveUserField>;
}

/**
 * Copy of a user object without its credentials (`RESPONSE_SECRET_KEYS`),
 * keeping the lockout counters. Only for Super Admin user management, whose
 * screen shows the lock and offers to unlock it.
 */
export function omitUserCredentials<T extends object>(
  user: T,
): Omit<T, (typeof RESPONSE_SECRET_KEYS)[number]> {
  const {
    password: _password,
    two_factor_secret: _twoFactorSecret,
    ...rest
  } = user as WithUserFields<T>;
  return rest as Omit<T, (typeof RESPONSE_SECRET_KEYS)[number]>;
}
