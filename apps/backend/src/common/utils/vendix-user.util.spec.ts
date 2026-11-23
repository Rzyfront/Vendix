import {
  CUSTOMER_ROLE_NAME,
  vendixUserWhere,
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
});
