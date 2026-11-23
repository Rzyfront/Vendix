import {
  CUSTOMER_ROLE_NAME,
  isSuperadminAssignableRole,
} from './superadmin-assignable-roles';

describe('isSuperadminAssignableRole', () => {
  it('does not offer the customer role', () => {
    expect(CUSTOMER_ROLE_NAME).toBe('customer');
    expect(isSuperadminAssignableRole({ name: 'customer' })).toBe(false);
  });

  it('keeps offering staff, system and custom roles', () => {
    for (const name of ['owner', 'admin', 'manager', 'super_admin', 'Customer Care']) {
      expect(isSuperadminAssignableRole({ name })).toBe(true);
    }
  });
});
