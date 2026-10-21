import { ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { ALLOW_CROSS_DOMAIN_KEY } from '@common/decorators/allow-cross-domain.decorator';
import { DomainScopeGuard } from './domain-scope.guard';

/**
 * Equivalencia del guard global con el de producción.
 *
 * `prodCanActivate` es la matriz de `DomainScopeGuard.canActivate` tal como
 * está en prod (`git show a0b2daec3:apps/backend/src/common/guards/
 * domain-scope.guard.ts`), sin logs. El refactor que extrajo la regla a
 * `domain-scope.rule.ts` (E2E g09) no debe cambiar ninguna respuesta: mismo
 * `true`, mismo `false` (403 genérico de STORE_DELIVERY) y mismo mensaje de
 * `ForbiddenException`. Si el guard cambia a propósito, este oráculo se
 * actualiza en el mismo commit y queda visible en la revisión.
 */
type Outcome = true | false | string;

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

interface Req {
  method?: string;
  path?: string;
  originalUrl?: string;
  user?: Record<string, unknown>;
}

function prodCanActivate(
  meta: { isPublic?: boolean; allowCrossDomain?: boolean },
  req: Req,
): Outcome {
  if (meta.isPublic) return true;
  if (meta.allowCrossDomain) return true;
  if (req.method === 'OPTIONS') return true;
  const user = req.user;
  if (!user) return true;
  if (user.is_super_admin === true) return true;
  const path: string = (req.path || req.originalUrl || '').toLowerCase();
  if (user.app_type === 'VENDIX_ADMIN' && path.includes('/api/superadmin/'))
    return true;
  const isStorePath = path.includes('/store/');
  const isOrgPath = path.includes('/organization/');
  if (!isStorePath && !isOrgPath) return true;
  const appType = user.app_type as string | undefined;
  if (!appType) return 'Token sin app_type claim. Re-login requerido.';
  if (appType === 'ORG_ADMIN' && isStorePath)
    return 'ORG_ADMIN no puede acceder a endpoints /store/*';
  if (appType === 'STORE_ADMIN' && isOrgPath)
    return 'STORE_ADMIN no puede acceder a endpoints /organization/*';
  if (appType === 'STORE_DELIVERY') return path.includes('/store/carrier/');
  if (appType !== 'ORG_ADMIN' && appType !== 'STORE_ADMIN') {
    const isCustomerBellAllowed =
      path.includes('/store/notifications') &&
      !path.includes('/store/notifications/subscriptions') &&
      !path.includes('/store/notifications/push');
    if (isCustomerBellAllowed) return true;
    return `Token app_type=${appType} no autoriza acceso a endpoints admin`;
  }
  return true;
}

function guardFor(meta: { isPublic?: boolean; allowCrossDomain?: boolean }) {
  return new DomainScopeGuard({
    getAllAndOverride: (key: string) =>
      key === IS_PUBLIC_KEY
        ? meta.isPublic
        : key === ALLOW_CROSS_DOMAIN_KEY
          ? meta.allowCrossDomain
          : undefined,
  } as unknown as Reflector);
}

function actual(
  meta: { isPublic?: boolean; allowCrossDomain?: boolean },
  req: Req,
): Outcome {
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
  try {
    return guardFor(meta).canActivate(context);
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    return (error as ForbiddenException).message;
  }
}

const APP_TYPES = [
  undefined,
  null,
  '',
  'STORE_ADMIN',
  'ORG_ADMIN',
  'VENDIX_ADMIN',
  'STORE_DELIVERY',
  'STORE_ECOMMERCE',
  'CUSTOMER',
  'VENDIX_LANDING',
  'ORG_LANDING',
];

const PATHS = [
  '/api/store/products',
  '/api/STORE/Products',
  '/api/organization/payroll/settings',
  '/api/store/carrier/routes',
  '/api/store/carrierx',
  '/api/store/notifications',
  '/api/store/notifications/unread-count',
  '/api/store/notifications/stream',
  '/api/store/notifications/subscriptions',
  '/api/store/notifications/push/vapid',
  '/api/superadmin/fiscal',
  '/api/superadmin/store/x',
  '/api/superadmin/organization/x',
  '/api/auth/me',
  '/api/ecommerce/cart',
  '/api/health',
  '/api/store',
  '',
];

describe('DomainScopeGuard · equivalencia con prod (a0b2daec3)', () => {
  const matrix: [string, Req][] = [];
  for (const app_type of APP_TYPES)
    for (const path of PATHS)
      for (const is_super_admin of [undefined, false, true])
        matrix.push([
          `${String(app_type)} super=${String(is_super_admin)} ${path || '(vacío)'}`,
          { method: 'GET', path, user: { id: 7, app_type, is_super_admin } },
        ]);

  it.each(matrix)('misma respuesta: %s', (_label, req) => {
    expect(actual({}, req)).toEqual(prodCanActivate({}, req));
  });

  it('cae a originalUrl cuando no hay path, como prod', () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/organization/x',
      user: { id: 1, app_type: 'STORE_ADMIN' },
    };
    expect(actual({}, req)).toBe(
      'STORE_ADMIN no puede acceder a endpoints /organization/*',
    );
    expect(actual({}, req)).toEqual(prodCanActivate({}, req));
  });
});

describe('DomainScopeGuard · ejes', () => {
  const cross = {
    method: 'GET',
    path: '/api/organization/payroll',
    user: { id: 1, app_type: 'STORE_ADMIN' },
  };

  it('@Public pasa aunque cruce dominio', () => {
    expect(actual({ isPublic: true }, cross)).toBe(true);
  });

  it('@AllowCrossDomain salta solo el aislamiento', () => {
    expect(actual({ allowCrossDomain: true }, cross)).toBe(true);
  });

  it('OPTIONS (preflight) pasa', () => {
    expect(actual({}, { ...cross, method: 'OPTIONS' })).toBe(true);
  });

  it('sin user no decide (lo hace JwtAuthGuard)', () => {
    expect(actual({}, { method: 'GET', path: '/api/store/products' })).toBe(
      true,
    );
  });

  it('super admin entra a cualquier dominio', () => {
    expect(
      actual({}, { ...cross, user: { id: 1, is_super_admin: true } }),
    ).toBe(true);
  });

  it('VENDIX_ADMIN entra a /superadmin pero no a /store ni /organization', () => {
    const user = { id: 1, app_type: 'VENDIX_ADMIN' };
    expect(
      actual({}, { method: 'GET', path: '/api/superadmin/fiscal', user }),
    ).toBe(true);
    expect(
      actual({}, { method: 'GET', path: '/api/store/products', user }),
    ).toBe('Token app_type=VENDIX_ADMIN no autoriza acceso a endpoints admin');
    expect(
      actual({}, { method: 'GET', path: '/api/organization/x', user }),
    ).toBe('Token app_type=VENDIX_ADMIN no autoriza acceso a endpoints admin');
  });

  it('marcadores /store/ y /organization/ gobiernan; el resto pasa', () => {
    const user = { id: 1, app_type: 'STORE_ADMIN' };
    expect(actual({}, { method: 'GET', path: '/api/store/x', user })).toBe(
      true,
    );
    expect(actual({}, { method: 'GET', path: '/api/auth/me', user })).toBe(
      true,
    );
    // Sin barra final no es marcador de dominio.
    expect(actual({}, { method: 'GET', path: '/api/store', user })).toBe(true);
  });

  it('sin app_type en ruta de dominio es 403 de re-login', () => {
    expect(
      actual({}, { method: 'GET', path: '/api/store/x', user: { id: 1 } }),
    ).toBe('Token sin app_type claim. Re-login requerido.');
    expect(
      actual({}, { method: 'GET', path: '/api/auth/me', user: { id: 1 } }),
    ).toBe(true);
  });

  it('STORE_DELIVERY solo el namespace carrier, con 403 genérico (false)', () => {
    const user = { id: 1, app_type: 'STORE_DELIVERY' };
    expect(
      actual({}, { method: 'GET', path: '/api/store/carrier/routes', user }),
    ).toBe(true);
    expect(
      actual({}, { method: 'GET', path: '/api/store/products', user }),
    ).toBe(false);
  });

  it('customer: campana sí; suscripciones, push y el resto de /store no', () => {
    const user = { id: 1, app_type: 'STORE_ECOMMERCE' };
    const at = (path: string) => actual({}, { method: 'GET', path, user });
    expect(at('/api/store/notifications')).toBe(true);
    expect(at('/api/store/notifications/unread-count')).toBe(true);
    const denied =
      'Token app_type=STORE_ECOMMERCE no autoriza acceso a endpoints admin';
    expect(at('/api/store/notifications/subscriptions')).toBe(denied);
    expect(at('/api/store/notifications/push/vapid')).toBe(denied);
    expect(at('/api/store/products')).toBe(denied);
  });

  it('rechaza el cruce de dominio entre admins', () => {
    expect(actual({}, cross)).toBe(
      'STORE_ADMIN no puede acceder a endpoints /organization/*',
    );
    expect(
      actual(
        {},
        {
          method: 'GET',
          path: '/api/store/products',
          user: { id: 1, app_type: 'ORG_ADMIN' },
        },
      ),
    ).toBe('ORG_ADMIN no puede acceder a endpoints /store/*');
  });
});
