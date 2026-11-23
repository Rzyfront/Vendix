import { Prisma } from '@prisma/client';
import {
  RESPONSE_SECRET_KEYS,
  SAFE_USER_SELECT,
  SENSITIVE_USER_FIELDS,
} from './safe-user-select.util';

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
