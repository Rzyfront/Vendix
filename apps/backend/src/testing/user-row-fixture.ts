import { SENSITIVE_USER_FIELDS } from '@common/utils/safe-user-select.util';

/**
 * Every scalar column of a `users` row, credentials included, as Prisma
 * returns it when a query does not narrow the columns.
 */
export function fullUserRow(id: number): Record<string, unknown> {
  return {
    id,
    username: `user${id}`,
    email: `user${id}@tienda.co`,
    password: '$2b$10$abcdefghijklmnopqrstuv',
    state: 'active',
    last_login: null,
    failed_login_attempts: 3,
    locked_until: new Date('2026-11-23T12:00:00Z'),
    email_verified: true,
    two_factor_enabled: false,
    two_factor_secret: 'JBSWY3DPEHPK3PXP',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    first_name: 'Ana',
    last_name: 'Pérez',
    avatar_url: null,
    organization_id: 3,
    phone: null,
    document_number: null,
    document_type: null,
    verification_digit: null,
    legal_name: null,
    tax_regime: null,
    person_type: null,
    is_withholding_agent: false,
    fiscal_responsibilities: [],
    ciiu_code: null,
    main_store_id: null,
    terms_accepted_version: null,
    terms_accepted_at: null,
    requires_terms_update: false,
  };
}

/**
 * Emulates the columns Prisma returns for a `users` relation: the whole row
 * without `select`, only the selected keys with it. Lets a mocked query
 * prove what the response would carry instead of echoing the fixture.
 */
export function projectUserRow(
  row: Record<string, unknown>,
  select?: Record<string, unknown>,
): Record<string, unknown> {
  if (!select) return { ...row };
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => Boolean(select[key])),
  );
}

/** Asserts a response user carries none of the auth-only columns. */
export function expectNoSensitiveUserFields(user: unknown): void {
  for (const field of SENSITIVE_USER_FIELDS) {
    expect(user).not.toHaveProperty(field);
  }
}
