import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { VendixHttpException } from 'src/common/errors';

/**
 * Superficie de autorización de los 4 permisos `invoicing:profiles:*`
 * (CP-INVOICE-PROFILES-AIU-DIAN, paso B.4).
 *
 * Estos specs no prueban el guard en general: prueban las dos propiedades de las
 * que depende el aislamiento de los perfiles de facturación.
 *
 * 1. Que `/api/store/invoicing` NO franquea `/api/store/invoicing/profiles`.
 *    Es regresión de una fuga real: el `startsWith(permission.path)` que el guard
 *    tenía antes abría TODO `/api/*` GET al rol `customer` porque `system.health`
 *    declaraba `path = '/api'`. Con coincidencia exacta la fuga se cierra, pero es
 *    la clase de arreglo que una «mejora» de matching puede revertir sin que nada
 *    lo note — de ahí el test.
 *
 * 2. Que `set_default` está de verdad separado de `write`. La separación no la da
 *    el nombre: la da el par `(path, method)`, porque el guard autoriza por ruta
 *    ignorando lo que el handler declaró.
 */
describe('PermissionsGuard — superficie invoicing:profiles:*', () => {
  let guard: PermissionsGuard;

  // Las 7 filas tal como quedan sembradas por `permissions-roles.seed.ts`.
  const P = {
    invoicing_read: {
      name: 'invoicing:read',
      path: '/api/store/invoicing',
      method: 'GET',
      status: 'active',
    },
    invoicing_write: {
      name: 'invoicing:write',
      path: '/api/store/invoicing',
      method: 'POST',
      status: 'active',
    },
    profiles_read: {
      name: 'invoicing:profiles:read',
      path: '/api/store/invoicing/profiles',
      method: 'GET',
      status: 'active',
    },
    profiles_write: {
      name: 'invoicing:profiles:write',
      path: '/api/store/invoicing/profiles',
      method: 'POST',
      status: 'active',
    },
    profiles_delete: {
      name: 'invoicing:profiles:delete',
      path: '/api/store/invoicing/profiles/:id',
      method: 'DELETE',
      status: 'active',
    },
    profiles_set_default: {
      name: 'invoicing:profiles:set_default',
      path: '/api/store/invoicing/profiles/:id/set-default',
      method: 'POST',
      status: 'active',
    },
  };

  /**
   * `required` es lo que el handler declara con `@Permissions(...)`.
   * `routePath` es el PATRÓN de Nest (`route.path`), no la URL concreta: una
   * petición a `/api/store/invoicing/profiles/7` llega como
   * `/api/store/invoicing/profiles/:id`, que es exactamente la forma en que el
   * seed declara sus filas.
   */
  function attempt(opts: {
    required: string[];
    routePath: string;
    method: string;
    holds: Array<Record<string, unknown>>;
    roles?: string[];
  }): boolean {
    jest
      .spyOn(Reflector.prototype, 'getAllAndOverride')
      .mockReturnValue(opts.required);

    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { roles: opts.roles ?? ['manager'], permissions: opts.holds },
          method: opts.method,
          route: { path: opts.routePath },
          url: opts.routePath,
        }),
      }),
    } as unknown as ExecutionContext;

    return guard.canActivate(context);
  }

  beforeEach(() => {
    guard = new PermissionsGuard(new Reflector());
  });

  afterEach(() => jest.restoreAllMocks());

  describe('el prefijo no franquea el subárbol', () => {
    it('invoicing:read NO abre GET /api/store/invoicing/profiles', () => {
      expect(() =>
        attempt({
          required: ['invoicing:profiles:read'],
          routePath: '/api/store/invoicing/profiles',
          method: 'GET',
          holds: [P.invoicing_read],
        }),
      ).toThrow(VendixHttpException);
    });

    it('invoicing:write NO abre POST /api/store/invoicing/profiles', () => {
      expect(() =>
        attempt({
          required: ['invoicing:profiles:write'],
          routePath: '/api/store/invoicing/profiles',
          method: 'POST',
          holds: [P.invoicing_write],
        }),
      ).toThrow(VendixHttpException);
    });

    it('control positivo: invoicing:profiles:read SÍ abre GET /profiles', () => {
      expect(
        attempt({
          required: ['invoicing:profiles:read'],
          routePath: '/api/store/invoicing/profiles',
          method: 'GET',
          holds: [P.profiles_read],
        }),
      ).toBe(true);
    });
  });

  describe('set_default está separado de write', () => {
    it('write NO alcanza POST /profiles/:id/set-default', () => {
      expect(() =>
        attempt({
          required: ['invoicing:profiles:set_default'],
          routePath: '/api/store/invoicing/profiles/:id/set-default',
          method: 'POST',
          holds: [P.profiles_write],
        }),
      ).toThrow(VendixHttpException);
    });

    it('control positivo: set_default SÍ alcanza esa ruta', () => {
      expect(
        attempt({
          required: ['invoicing:profiles:set_default'],
          routePath: '/api/store/invoicing/profiles/:id/set-default',
          method: 'POST',
          holds: [P.profiles_set_default],
        }),
      ).toBe(true);
    });

    it('set_default NO alcanza el POST de creación', () => {
      expect(() =>
        attempt({
          required: ['invoicing:profiles:write'],
          routePath: '/api/store/invoicing/profiles',
          method: 'POST',
          holds: [P.profiles_set_default],
        }),
      ).toThrow(VendixHttpException);
    });

    it('read NO alcanza el DELETE del perfil', () => {
      expect(() =>
        attempt({
          required: ['invoicing:profiles:delete'],
          routePath: '/api/store/invoicing/profiles/:id',
          method: 'DELETE',
          holds: [P.profiles_read],
        }),
      ).toThrow(VendixHttpException);
    });

    it('delete NO alcanza el PATCH del perfil (mismo path, otro método)', () => {
      expect(() =>
        attempt({
          required: ['invoicing:profiles:write'],
          routePath: '/api/store/invoicing/profiles/:id',
          method: 'PATCH',
          holds: [P.profiles_delete],
        }),
      ).toThrow(VendixHttpException);
    });
  });

  describe('las rutas secundarias se autorizan por NOMBRE', () => {
    /**
     * `permissions` lleva `@@unique([path, method])`, así que un permiso sólo
     * puede reclamar UN par. Las demás rutas que gobierna —PATCH, clone,
     * activate, deactivate, versions…— no casan por ruta y dependen enteramente
     * de la rama de nombre. Si un controller de la Fase C olvida su
     * `@Permissions(...)`, `requiredPermissions` es `undefined` y el guard
     * devuelve `true` sin mirar nada: la ruta queda abierta a cualquier
     * autenticado. Por eso el decorador es obligatorio en cada handler y no una
     * formalidad.
     */
    it('write autoriza PATCH /profiles/:id por nombre, no por ruta', () => {
      expect(
        attempt({
          required: ['invoicing:profiles:write'],
          routePath: '/api/store/invoicing/profiles/:id',
          method: 'PATCH',
          holds: [P.profiles_write],
        }),
      ).toBe(true);
    });

    it('write autoriza POST /profiles/:id/clone por nombre', () => {
      expect(
        attempt({
          required: ['invoicing:profiles:write'],
          routePath: '/api/store/invoicing/profiles/:id/clone',
          method: 'POST',
          holds: [P.profiles_write],
        }),
      ).toBe(true);
    });

    it('read autoriza GET /profiles/:id/versions por nombre', () => {
      expect(
        attempt({
          required: ['invoicing:profiles:read'],
          routePath: '/api/store/invoicing/profiles/:id/versions',
          method: 'GET',
          holds: [P.profiles_read],
        }),
      ).toBe(true);
    });
  });

  describe('una fila inactiva no concede nada', () => {
    it('status inactive no abre la ruta ni por ruta ni por nombre', () => {
      expect(() =>
        attempt({
          required: ['invoicing:profiles:read'],
          routePath: '/api/store/invoicing/profiles',
          method: 'GET',
          holds: [{ ...P.profiles_read, status: 'inactive' }],
        }),
      ).toThrow(VendixHttpException);
    });
  });

  describe('la rama de ruta ignora lo que el handler declaró', () => {
    /**
     * Hallazgo documentado, no defecto de este plan: `hasPermission` casa las
     * filas del usuario contra la ruta actual **sin consultar
     * `requiredPermissions`**. Quien porte la fila cuyo `(path, method)` sea el
     * de la ruta entra, aunque el handler pida otro permiso.
     *
     * La consecuencia para la Fase C es de diseño de rutas, no de decoradores:
     * el par `(path, method)` de un permiso ES su concesión, así que dos
     * operaciones que deban autorizarse distinto NO pueden compartir ruta y
     * método. Arreglar la disyunción del guard es un cambio de superficie de
     * autorización de todo el repo y queda fuera de este plan.
     */
    it('portar profiles:read entra a GET /profiles aunque el handler pida set_default', () => {
      expect(
        attempt({
          required: ['invoicing:profiles:set_default'],
          routePath: '/api/store/invoicing/profiles',
          method: 'GET',
          holds: [P.profiles_read],
        }),
      ).toBe(true);
    });
  });

  describe('super_admin y ausencia de permisos', () => {
    it('super_admin pasa sin portar ninguna fila', () => {
      expect(
        attempt({
          required: ['invoicing:profiles:set_default'],
          routePath: '/api/store/invoicing/profiles/:id/set-default',
          method: 'POST',
          holds: [],
          roles: ['super_admin'],
        }),
      ).toBe(true);
    });

    it('un usuario sin permisos es rechazado', () => {
      expect(() =>
        attempt({
          required: ['invoicing:profiles:read'],
          routePath: '/api/store/invoicing/profiles',
          method: 'GET',
          holds: [],
        }),
      ).toThrow(VendixHttpException);
    });
  });
});
