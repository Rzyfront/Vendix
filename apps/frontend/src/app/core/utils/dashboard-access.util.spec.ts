import {
  canUserAccessDashboard,
  DASHBOARD_TRUSTED_ROLES,
  DASHBOARD_REQUIRED_PERMISSIONS,
} from './dashboard-access.util';

describe('canUserAccessDashboard', () => {
  function createMockAuth(overrides?: {
    isOwner?: boolean;
    isAdmin?: boolean;
    roles?: string[];
    permissions?: string[];
  }) {
    const roles = overrides?.roles ?? [];
    const permissions = overrides?.permissions ?? [];
    return {
      isOwner: () => overrides?.isOwner ?? false,
      isAdmin: () => overrides?.isAdmin ?? false,
      hasAnyRole: (trusted: string[]) => trusted.some((r) => roles.includes(r)),
      hasAnyPermission: (req: string[]) => req.some((p) => permissions.includes(p)),
    };
  }

  it('permite el acceso si el usuario es owner', () => {
    const auth = createMockAuth({ isOwner: true });
    expect(canUserAccessDashboard(auth)).toBeTrue();
  });

  it('permite el acceso si el usuario es admin', () => {
    const auth = createMockAuth({ isAdmin: true });
    expect(canUserAccessDashboard(auth)).toBeTrue();
  });

  it('permite el acceso si el usuario tiene rol manager', () => {
    const auth = createMockAuth({ roles: ['manager'] });
    expect(canUserAccessDashboard(auth)).toBeTrue();
  });

  it('permite el acceso si el usuario tiene permiso store:dashboard:view', () => {
    const auth = createMockAuth({ permissions: ['store:dashboard:view'] });
    expect(canUserAccessDashboard(auth)).toBeTrue();
  });

  it('permite el acceso si el usuario tiene permiso store:analytics:read', () => {
    const auth = createMockAuth({ permissions: ['store:analytics:read'] });
    expect(canUserAccessDashboard(auth)).toBeTrue();
  });

  it('bloquea el acceso a usuarios operativos (cashier, kitchen, waiter) sin permisos específicos', () => {
    const cashierAuth = createMockAuth({ roles: ['cashier'], permissions: ['store:pos:operate'] });
    expect(canUserAccessDashboard(cashierAuth)).toBeFalse();

    const kitchenAuth = createMockAuth({ roles: ['kitchen'], permissions: ['store:kds:operate'] });
    expect(canUserAccessDashboard(kitchenAuth)).toBeFalse();

    const waiterAuth = createMockAuth({ roles: ['waiter'], permissions: ['store:tables:operate'] });
    expect(canUserAccessDashboard(waiterAuth)).toBeFalse();
  });
});
