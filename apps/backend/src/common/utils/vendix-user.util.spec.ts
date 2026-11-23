import {
  CUSTOMER_ROLE_NAME,
  vendixActorAuditSql,
  vendixActorAuditWhere,
  vendixLoginAttemptSql,
  vendixUserSql,
  vendixUserWhere,
  withVendixActor,
  withVendixUser,
} from './vendix-user.util';

describe('vendix-user.util', () => {
  describe('vendixUserWhere', () => {
    it('requires at least one role whose name is not customer', () => {
      expect(CUSTOMER_ROLE_NAME).toBe('customer');
      expect(vendixUserWhere()).toEqual({
        user_roles: {
          some: { roles: { name: { not: 'customer' } } },
        },
      });
    });

    it('returns a fresh object on every call so callers cannot mutate the rule', () => {
      const first = vendixUserWhere();
      (first as Record<string, unknown>).user_roles = undefined;

      expect(vendixUserWhere()).toEqual({
        user_roles: {
          some: { roles: { name: { not: 'customer' } } },
        },
      });
    });
  });

  describe('withVendixUser', () => {
    it('ANDs the rule with the caller filter without overwriting its keys', () => {
      const search = {
        OR: [{ email: { contains: 'ana' } }],
        user_roles: { some: { store_id: 4 } },
      };

      expect(withVendixUser(search)).toEqual({
        AND: [vendixUserWhere(), search],
      });
    });

    it('applies the rule alone when no filter is given', () => {
      expect(withVendixUser()).toEqual({ AND: [vendixUserWhere(), {}] });
    });
  });

  describe('vendixUserSql', () => {
    it('checks for a non-customer role of the qualified column, with the role name as a bound value', () => {
      const fragment = vendixUserSql('al.user_id');

      expect(fragment.text).toBe(
        'EXISTS (SELECT 1 FROM user_roles vu_ur JOIN roles vu_r ON vu_r.id = vu_ur.role_id WHERE vu_ur.user_id = al.user_id AND vu_r.name <> $1)',
      );
      expect(fragment.values).toEqual(['customer']);
    });

    it.each(['user_id', 'al.user_id; DROP TABLE users', 'al.user_id OR 1=1', ''])(
      'rejects %p: only a qualified alias.column may be inlined',
      (column) => {
        expect(() => vendixUserSql(column)).toThrow(/columna calificada/);
      },
    );
  });

  describe('vendixActorAuditWhere / withVendixActor', () => {
    it('keeps system events (no author) and events authored by Vendix users', () => {
      expect(vendixActorAuditWhere()).toEqual({
        OR: [{ user_id: null }, { users: vendixUserWhere() }],
      });
    });

    it('adds the rule to AND without touching the caller top-level keys', () => {
      expect(withVendixActor({ organization_id: 3, store_id: 9 })).toEqual({
        organization_id: 3,
        store_id: 9,
        AND: [vendixActorAuditWhere()],
      });
    });

    it('preserves an AND the caller already had, as array or object', () => {
      expect(withVendixActor({ AND: [{ action: 'LOGIN' }] })).toEqual({
        AND: [{ action: 'LOGIN' }, vendixActorAuditWhere()],
      });
      expect(withVendixActor({ AND: { resource: 'users' } })).toEqual({
        AND: [{ resource: 'users' }, vendixActorAuditWhere()],
      });
    });

    it('has the same meaning in raw SQL', () => {
      const fragment = vendixActorAuditSql('al.user_id');

      expect(fragment.text).toBe(
        '(al.user_id IS NULL OR al.user_id IN (SELECT vu_ur.user_id FROM user_roles vu_ur JOIN roles vu_r ON vu_r.id = vu_ur.role_id WHERE vu_r.name <> $1))',
      );
      expect(fragment.values).toEqual(['customer']);
      expect(() => vendixActorAuditSql('user_id')).toThrow();
    });
  });

  describe('vendixLoginAttemptSql', () => {
    it("matches the attempt email against a Vendix user of the store's organization, or any one without store", () => {
      const fragment = vendixLoginAttemptSql('la');

      expect(fragment.text).toBe(
        'EXISTS (SELECT 1 FROM users vla_u WHERE lower(vla_u.email) = lower(la.email)' +
          ' AND (la.store_id IS NULL OR vla_u.organization_id = (SELECT vla_s.organization_id FROM stores vla_s WHERE vla_s.id = la.store_id))' +
          ` AND ${vendixUserSql('vla_u.id').text})`,
      );
      expect(fragment.values).toEqual(['customer']);
    });

    it('rejects anything that is not a plain alias', () => {
      expect(() => vendixLoginAttemptSql('la.email')).toThrow(/alias SQL/);
      expect(() => vendixLoginAttemptSql('la; --')).toThrow(/alias SQL/);
    });
  });
});
