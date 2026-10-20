import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainScopeGuard } from './domain-scope.guard';
import { domainScopeDecision } from './domain-scope.rule';

function run(user: Record<string, unknown>, path: string) {
  const guard = new DomainScopeGuard({
    getAllAndOverride: () => undefined,
  } as unknown as Reflector);
  return guard.canActivate({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', path, user }),
    }),
  } as any);
}

describe('domainScopeDecision (regla compartida guard ↔ puente IA)', () => {
  it('STORE_ADMIN no entra a /organization/* y sí a /store/*', () => {
    expect(
      domainScopeDecision(
        { app_type: 'STORE_ADMIN' },
        '/api/organization/payroll/settings',
      ),
    ).toMatchObject({ allowed: false, reason: 'store_admin_org_path' });
    expect(
      domainScopeDecision({ app_type: 'STORE_ADMIN' }, '/api/store/payroll'),
    ).toEqual({ allowed: true });
  });

  it('super-admin y rutas fuera de store/organization pasan', () => {
    expect(
      domainScopeDecision(
        { app_type: 'STORE_ADMIN', is_super_admin: true },
        '/api/organization/x',
      ).allowed,
    ).toBe(true);
    expect(domainScopeDecision({}, '/api/auth/me').allowed).toBe(true);
  });

  it('el guard conserva sus respuestas tras delegar en la regla', () => {
    expect(() =>
      run({ id: 1, app_type: 'STORE_ADMIN' }, '/api/organization/payroll'),
    ).toThrow(
      new ForbiddenException(
        'STORE_ADMIN no puede acceder a endpoints /organization/*',
      ),
    );
    expect(() =>
      run({ id: 1, app_type: 'ORG_ADMIN' }, '/api/store/products'),
    ).toThrow(
      new ForbiddenException('ORG_ADMIN no puede acceder a endpoints /store/*'),
    );
    expect(() => run({ id: 1 }, '/api/store/products')).toThrow(
      new ForbiddenException('Token sin app_type claim. Re-login requerido.'),
    );
    expect(run({ id: 1, app_type: 'STORE_DELIVERY' }, '/api/store/products')).toBe(
      false,
    );
    expect(
      run({ id: 1, app_type: 'STORE_DELIVERY' }, '/api/store/carrier/routes'),
    ).toBe(true);
    expect(
      run({ id: 1, app_type: 'STORE_ECOMMERCE' }, '/api/store/notifications'),
    ).toBe(true);
    expect(() =>
      run({ id: 1, app_type: 'STORE_ECOMMERCE' }, '/api/store/products'),
    ).toThrow(
      new ForbiddenException(
        'Token app_type=STORE_ECOMMERCE no autoriza acceso a endpoints admin',
      ),
    );
    expect(run({ id: 1, app_type: 'STORE_ADMIN' }, '/api/store/products')).toBe(
      true,
    );
  });
});
