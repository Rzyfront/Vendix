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

  it('VENDIX_ADMIN: /superadmin sí, dominios de tienda u organización no', () => {
    const p = { app_type: 'VENDIX_ADMIN' };
    expect(domainScopeDecision(p, '/api/superadmin/fiscal').allowed).toBe(true);
    expect(domainScopeDecision(p, '/api/SuperAdmin/fiscal').allowed).toBe(true);
    expect(domainScopeDecision(p, '/api/store/products')).toMatchObject({
      allowed: false,
      reason: 'non_admin_app_type',
    });
    expect(domainScopeDecision(p, '/api/organization/x')).toMatchObject({
      allowed: false,
      reason: 'non_admin_app_type',
    });
  });

  it('sin app_type: 403 solo en rutas de dominio', () => {
    for (const p of [{}, { app_type: null }, { app_type: '' }]) {
      expect(domainScopeDecision(p, '/api/store/x')).toMatchObject({
        allowed: false,
        reason: 'missing_app_type',
      });
      expect(domainScopeDecision(p, '/api/organization/x')).toMatchObject({
        allowed: false,
        reason: 'missing_app_type',
      });
      expect(domainScopeDecision(p, '/api/ecommerce/cart').allowed).toBe(true);
    }
  });

  it('los marcadores llevan barra y se comparan en minúsculas', () => {
    const p = { app_type: 'ORG_ADMIN' };
    expect(domainScopeDecision(p, '/api/STORE/x')).toMatchObject({
      allowed: false,
      reason: 'org_admin_store_path',
    });
    expect(domainScopeDecision(p, '/api/store').allowed).toBe(true);
    expect(domainScopeDecision(p, '/api/organization/x').allowed).toBe(true);
    expect(domainScopeDecision(p, '').allowed).toBe(true);
  });

  it('STORE_DELIVERY solo /store/carrier/', () => {
    const p = { app_type: 'STORE_DELIVERY' };
    expect(domainScopeDecision(p, '/api/store/carrier/routes').allowed).toBe(
      true,
    );
    expect(domainScopeDecision(p, '/api/store/carrierx')).toMatchObject({
      allowed: false,
      reason: 'delivery_outside_carrier',
    });
    // Como prod: STORE_DELIVERY se evalúa antes del bloque de no-admins.
    expect(domainScopeDecision(p, '/api/organization/x')).toMatchObject({
      allowed: false,
      reason: 'delivery_outside_carrier',
    });
  });

  it.each(['STORE_ECOMMERCE', 'CUSTOMER'])(
    'customer %s: campana sí, gestión de campana y resto de /store no',
    (app_type) => {
      const p = { app_type };
      for (const ok of [
        '/api/store/notifications',
        '/api/store/notifications/unread-count',
        '/api/store/notifications/stream',
        '/api/store/notifications/12/read',
      ])
        expect(domainScopeDecision(p, ok).allowed).toBe(true);
      for (const no of [
        '/api/store/notifications/subscriptions',
        '/api/store/notifications/push/vapid',
        '/api/store/products',
        '/api/organization/x',
      ])
        expect(domainScopeDecision(p, no)).toMatchObject({
          allowed: false,
          reason: 'non_admin_app_type',
          message: `Token app_type=${app_type} no autoriza acceso a endpoints admin`,
        });
    },
  );

  it('super-admin pasa incluso sin app_type ni en dominios cruzados', () => {
    expect(
      domainScopeDecision({ is_super_admin: true }, '/api/store/x').allowed,
    ).toBe(true);
    expect(
      domainScopeDecision(
        { app_type: 'STORE_DELIVERY', is_super_admin: true },
        '/api/store/products',
      ).allowed,
    ).toBe(true);
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
    expect(
      run({ id: 1, app_type: 'STORE_DELIVERY' }, '/api/store/products'),
    ).toBe(false);
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
