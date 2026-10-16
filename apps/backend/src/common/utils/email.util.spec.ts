import { emailEquals, normalizeEmail } from './email.util';

describe('Identity email canonicalization', () => {
  it('normalizes the entire email without changing plus addressing', () => {
    expect(normalizeEmail('  Cajero+POS@Example.COM  ')).toBe(
      'cajero+pos@example.com',
    );
  });

  it('is idempotent', () => {
    expect(normalizeEmail(normalizeEmail(' User@Example.COM '))).toBe(
      'user@example.com',
    );
  });

  it('also compares the stored value without case sensitivity', () => {
    expect(emailEquals(' User@Example.COM ')).toEqual({
      equals: 'user@example.com',
      mode: 'insensitive',
    });
  });

  it('escapes ILIKE metacharacters without changing the stored canonical email', () => {
    const email = '  User_Name%Tag@Example.COM  ';
    expect(normalizeEmail(email)).toBe('user_name%tag@example.com');
    expect(emailEquals(email)).toEqual({
      equals: 'user\\_name\\%tag@example.com',
      mode: 'insensitive',
    });
    expect(emailEquals('a\\b@example.com').equals).toBe('a\\\\b@example.com');
  });
});
