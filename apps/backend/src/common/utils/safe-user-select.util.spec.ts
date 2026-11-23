import { Prisma } from '@prisma/client';
import {
  RESPONSE_SECRET_KEYS,
  SAFE_USER_SELECT,
  SENSITIVE_USER_FIELDS,
  omitSensitiveUserFields,
  omitUserCredentials,
} from './safe-user-select.util';
import { fullUserRow } from '../../testing/user-row-fixture';

describe('SAFE_USER_SELECT', () => {
  const scalarColumns = Object.values(Prisma.UsersScalarFieldEnum);

  it('never selects credentials, lockout counters or relations', () => {
    const selected = Object.keys(SAFE_USER_SELECT);

    for (const field of SENSITIVE_USER_FIELDS) {
      expect(selected).not.toContain(field);
    }
    for (const key of selected) {
      expect(scalarColumns).toContain(key);
    }
  });

  it('selects every other scalar column, so a new column forces a decision here', () => {
    const expected = scalarColumns
      .filter(
        (column) =>
          !(SENSITIVE_USER_FIELDS as readonly string[]).includes(column),
      )
      .sort();

    expect(Object.keys(SAFE_USER_SELECT).sort()).toEqual(expected);
  });

  it('strips in responses only the credential keys, a subset of the sensitive fields', () => {
    expect(RESPONSE_SECRET_KEYS).toEqual(['password', 'two_factor_secret']);
    for (const key of RESPONSE_SECRET_KEYS) {
      expect(SENSITIVE_USER_FIELDS).toContain(key);
    }
  });
});

describe('omitSensitiveUserFields', () => {
  it('returns the loaded user without credentials nor lockout counters, keeping relations', () => {
    const row = { ...fullUserRow(5), user_roles: [{ roles: { name: 'owner' } }] };

    const result = omitSensitiveUserFields(row);

    for (const field of SENSITIVE_USER_FIELDS) {
      expect(result).not.toHaveProperty(field);
    }
    expect(result).toEqual(
      expect.objectContaining({
        id: 5,
        email: 'user5@tienda.co',
        two_factor_enabled: false,
        user_roles: [{ roles: { name: 'owner' } }],
      }),
    );
    expect(row.password).toBe('$2b$10$abcdefghijklmnopqrstuv');
  });
});

describe('omitUserCredentials', () => {
  it('drops password and 2FA secret but keeps the lockout the unlock screen shows', () => {
    const result = omitUserCredentials(fullUserRow(5));

    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('two_factor_secret');
    expect(result).toEqual(
      expect.objectContaining({
        failed_login_attempts: 3,
        locked_until: new Date('2026-11-23T12:00:00Z'),
      }),
    );
  });
});
