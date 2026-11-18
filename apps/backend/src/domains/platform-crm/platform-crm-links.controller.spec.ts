import {
  Controller,
  Get,
  INestApplication,
  Logger,
  Post,
  Type,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ResponseService } from '@common/responses/response.service';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../common/services/platform-org.service';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { DomainScopeGuard } from '../../common/guards/domain-scope.guard';
import { AccessAuditLogger } from '../../common/access/access-audit.logger';
import { AccessGateModeService } from '../../common/access/access-gate-mode.service';
import { PLAN_MODULE_API_ROUTES } from '../../common/access/plan-modules';
import { StoreOperationsGuard } from '../store/subscriptions/guards/store-operations.guard';
import { PlanAccessGuard } from '../store/subscriptions/guards/plan-access.guard';
import { SubscriptionAccessService } from '../store/subscriptions/services/subscription-access.service';
import { SubscriptionGateConfig } from '../store/subscriptions/config/subscription-gate.config';
import { PlanAccessService } from '../store/subscriptions/services/plan-access.service';
import { PlatformCrmLinksController } from './platform-crm-links.controller';
import { PlatformCrmLinksService } from './platform-crm-links.service';
import { PlatformStoreGuard } from './platform-store.guard';

/**
 * Tests del §6 «Guard y controlador» (odd/tasks/vendix-platform-crm-enlace.md).
 *
 * Como dueño de una tienda cualquiera de Vendix, aunque tenga todos los
 * permisos o sea super admin, quiero que las rutas del enlace CRM de Vendix
 * respondan 404 como una ruta inexistente, para que la función no exista
 * fuera de la tienda de Vendix Platform.
 *
 * Como comercial de Vendix en la tienda Vendix Platform, quiero que las rutas
 * respondan 403 si no tengo el permiso y 200 si lo tengo.
 *
 * App Nest REAL con prefijo `api`, el filtro global de `main.ts`
 * (`AllExceptionsFilter`) y la cadena de guards de `app.module.ts` en su orden:
 * `DomainScopeGuard` → `StoreOperationsGuard` (gate de suscripción) →
 * `PlanAccessGuard` → `PlatformStoreGuard` → `PermissionsGuard`. Los servicios
 * de los guards globales son dobles: la tienda ajena tiene la suscripción
 * BLOQUEADA y un plan que no incluye ningún módulo, con el gate en `enforce`.
 * `JwtAuthGuard` lo reemplaza un middleware que deja en `req.user` lo mismo que
 * `JwtStrategy` (el token ya validado). Solo el servicio de negocio es un doble
 * (se comprueba que nunca se alcanza en un rechazo).
 *
 * «Indistinguible» se mide contra una app GEMELA, idéntica pero sin el módulo:
 * cada rechazo debe dar el mismo status, el mismo content-type y el mismo
 * cuerpo (salvo `timestamp`) que esa app da a la misma petición.
 */

const PLATFORM_ORG = 1;
const PLATFORM_STORE = 10;
const PLATFORM_STORE_INACTIVE = 11;
const TENANT_ORG = 7;
const TENANT_STORE = 70;

const LINK_PATH = '/api/store/platform-crm/customers/:customerId/link';
const ALL_PERMISSIONS = [
  { name: 'platform:crm_link:manage', path: LINK_PATH, method: 'POST', status: 'active' },
  { name: 'platform:crm_link:read', path: LINK_PATH, method: 'GET', status: 'active' },
  { name: 'store:customers:read', path: '/api/store/customers', method: 'GET', status: 'active' },
  { name: 'store:customers:update', path: '/api/store/customers/:id', method: 'PATCH', status: 'active' },
];

type TestUser = {
  id: number;
  organization_id: number;
  store_id: number | null;
  app_type: 'STORE_ADMIN' | 'ORG_ADMIN';
  roles: string[];
  permissions: typeof ALL_PERMISSIONS;
};

const USERS = {
  tenantOwner: {
    id: 700,
    organization_id: TENANT_ORG,
    store_id: TENANT_STORE,
    app_type: 'STORE_ADMIN',
    roles: ['owner'],
    permissions: ALL_PERMISSIONS,
  },
  tenantCashier: {
    id: 700,
    organization_id: TENANT_ORG,
    store_id: TENANT_STORE,
    app_type: 'STORE_ADMIN',
    roles: ['cashier'],
    permissions: ALL_PERMISSIONS.filter((p) => !p.name.startsWith('platform:')),
  },
  superAdminInTenantStore: {
    id: 101,
    organization_id: PLATFORM_ORG,
    store_id: TENANT_STORE,
    app_type: 'STORE_ADMIN',
    roles: ['super_admin'],
    permissions: [],
  },
  tenantUserWithForeignStoreId: {
    id: 700,
    organization_id: TENANT_ORG,
    store_id: PLATFORM_STORE,
    app_type: 'STORE_ADMIN',
    roles: ['owner'],
    permissions: ALL_PERMISSIONS,
  },
  platformUserWithoutPermission: {
    id: 100,
    organization_id: PLATFORM_ORG,
    store_id: PLATFORM_STORE,
    app_type: 'STORE_ADMIN',
    roles: ['seller'],
    permissions: ALL_PERMISSIONS.filter((p) => !p.name.startsWith('platform:')),
  },
  platformReader: {
    id: 102,
    organization_id: PLATFORM_ORG,
    store_id: PLATFORM_STORE,
    app_type: 'STORE_ADMIN',
    roles: ['seller'],
    permissions: ALL_PERMISSIONS.filter((p) => p.name === 'platform:crm_link:read'),
  },
  platformSeller: {
    id: 100,
    organization_id: PLATFORM_ORG,
    store_id: PLATFORM_STORE,
    app_type: 'STORE_ADMIN',
    roles: ['seller'],
    permissions: ALL_PERMISSIONS,
  },
  platformUserInInactiveStore: {
    id: 100,
    organization_id: PLATFORM_ORG,
    store_id: PLATFORM_STORE_INACTIVE,
    app_type: 'STORE_ADMIN',
    roles: ['seller'],
    permissions: ALL_PERMISSIONS,
  },
  platformSellerWithoutStore: {
    id: 100,
    organization_id: PLATFORM_ORG,
    store_id: null,
    app_type: 'STORE_ADMIN',
    roles: ['seller'],
    permissions: ALL_PERMISSIONS,
  },
  /** Solo para comprobar que `DomainScopeGuard` está montado. */
  tenantOrgAdminToken: {
    id: 700,
    organization_id: TENANT_ORG,
    store_id: TENANT_STORE,
    app_type: 'ORG_ADMIN',
    roles: ['owner'],
    permissions: ALL_PERMISSIONS,
  },
} satisfies Record<string, TestUser>;

const ROUTES = [
  { method: 'get', url: '/api/store/platform-crm/organizations/search?q=acme' },
  { method: 'get', url: '/api/store/platform-crm/customers/5/link' },
  { method: 'post', url: '/api/store/platform-crm/customers/5/link', body: { organization_id: 9 } },
  { method: 'delete', url: '/api/store/platform-crm/customers/5/link', body: {} },
] as const;

/** Sondas que prueban que el gate y el plan de verdad bloquean en este test. */
@Controller('store/gate-probe')
class GateProbeController {
  @Post()
  write() {
    return { ok: true };
  }
}

@Controller('store/accounting/plan-probe')
class PlanProbeController {
  @Get()
  read() {
    return { ok: true };
  }
}

describe('PlatformCrmLinksController · aislamiento por tienda (candados 1, 4 y 5)', () => {
  let app: INestApplication;
  /** La misma app sin `PlatformCrmLinksController`: la vara de «ruta inexistente». */
  let bareApp: INestApplication;
  const ORIGINAL_ENV = process.env.VENDIX_PLATFORM_ORG_ID;
  /** Org que la «base» marca is_platform (lo que lee PlatformOrgService). */
  let platformOrgInDb: number | null;
  let dbFails: boolean;

  const stores: Record<number, unknown> = {
    [PLATFORM_STORE]: {
      id: PLATFORM_STORE,
      is_active: true,
      organization_id: PLATFORM_ORG,
      organizations: { is_platform: true },
    },
    [PLATFORM_STORE_INACTIVE]: {
      id: PLATFORM_STORE_INACTIVE,
      is_active: false,
      organization_id: PLATFORM_ORG,
      organizations: { is_platform: true },
    },
    [TENANT_STORE]: {
      id: TENANT_STORE,
      is_active: true,
      organization_id: TENANT_ORG,
      organizations: { is_platform: false },
    },
  };
  const userOrgs: Record<number, number> = { 100: PLATFORM_ORG, 101: PLATFORM_ORG, 102: PLATFORM_ORG, 700: TENANT_ORG };

  const db = {
    stores: {
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) => {
        if (dbFails) throw new Error('connection reset');
        return stores[where.id] ?? null;
      }),
    },
    users: {
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) =>
        userOrgs[where.id] ? { organization_id: userOrgs[where.id] } : null,
      ),
    },
    organizations: {
      findFirst: jest.fn(async () =>
        platformOrgInDb ? { id: platformOrgInDb } : null,
      ),
    },
  };
  const service = {
    searchOrganizations: jest.fn().mockResolvedValue([]),
    getLink: jest.fn().mockResolvedValue({ link: null, organization: null }),
    link: jest.fn().mockResolvedValue({ link: null, organization: null }),
    unlink: jest.fn().mockResolvedValue({ link: null, organization: null }),
  };
  const serviceCalls = () =>
    Object.values(service).reduce((sum, fn) => sum + fn.mock.calls.length, 0);

  // Guards globales: la tienda ajena tiene la suscripción bloqueada y un plan
  // que no incluye nada, con ambos gates en `enforce`.
  const subscriptionAccess = {
    canUseModule: jest.fn(async (storeId: number) =>
      storeId === TENANT_STORE
        ? {
            allowed: false,
            mode: 'block',
            reason: 'SUBSCRIPTION_004',
            subscription_state: 'blocked',
            plan_id: null,
            has_record: true,
          }
        : { allowed: true, mode: 'allow', subscription_state: 'active', has_record: true },
    ),
  };
  const planAccess = {
    blockedForStore: jest.fn(async (storeId: number) => ({
      current: null,
      blocked: storeId === TENANT_STORE ? Object.keys(PLAN_MODULE_API_ROUTES) : [],
    })),
    denial: jest.fn(async () => ({})),
  };

  async function createApp(controllers: Type<unknown>[]): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [...controllers, GateProbeController, PlanProbeController],
      providers: [
        // Mismo orden que app.module.ts (JwtAuthGuard → middleware de abajo).
        { provide: APP_GUARD, useClass: DomainScopeGuard },
        { provide: APP_GUARD, useClass: StoreOperationsGuard },
        { provide: APP_GUARD, useClass: PlanAccessGuard },
        { provide: SubscriptionAccessService, useValue: subscriptionAccess },
        { provide: SubscriptionGateConfig, useValue: { isEnforce: () => true } },
        { provide: PlanAccessService, useValue: planAccess },
        { provide: AccessGateModeService, useValue: { planModeForStore: async () => 'enforce' } },
        { provide: AccessAuditLogger, useValue: { record: jest.fn() } },
        PlatformStoreGuard,
        PlatformOrgService,
        { provide: GlobalPrismaService, useValue: { withoutScope: () => db } },
        { provide: PlatformCrmLinksService, useValue: service },
        {
          provide: ResponseService,
          useValue: { success: (data: unknown) => ({ success: true, data }) },
        },
      ],
    }).compile();

    const nestApp = moduleRef.createNestApplication();
    nestApp.setGlobalPrefix('api');
    nestApp.useGlobalFilters(new AllExceptionsFilter());
    // Lo que deja JwtStrategy en req.user (el token ya validado).
    nestApp.use((req: any, _res: unknown, next: () => void) => {
      const raw = req.headers['x-test-user'];
      if (typeof raw === 'string') req.user = JSON.parse(raw);
      next();
    });
    nestApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await nestApp.init();
    return nestApp;
  }

  beforeAll(async () => {
    app = await createApp([PlatformCrmLinksController]);
    bareApp = await createApp([]);
  });

  afterAll(async () => {
    await app.close();
    await bareApp.close();
    if (ORIGINAL_ENV === undefined) delete process.env.VENDIX_PLATFORM_ORG_ID;
    else process.env.VENDIX_PLATFORM_ORG_ID = ORIGINAL_ENV;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VENDIX_PLATFORM_ORG_ID = String(PLATFORM_ORG);
    platformOrgInDb = PLATFORM_ORG;
    dbFails = false;
  });

  function call(
    route: (typeof ROUTES)[number],
    user: TestUser,
    target: INestApplication = app,
  ) {
    const req = request(target.getHttpServer())
      [route.method](route.url)
      .set('x-test-user', JSON.stringify(user));
    return 'body' in route ? req.send(route.body) : req;
  }

  /** Todo lo que ve el cliente salvo la hora: status, content-type y cuerpo. */
  function observable(res: request.Response) {
    const { timestamp, ...body } = res.body ?? {};
    expect(typeof timestamp).toBe('string');
    return { status: res.status, contentType: res.headers['content-type'], body };
  }

  /**
   * Cada ruta responde lo MISMO que la app gemela sin el módulo, es decir, el
   * 404 de una ruta inexistente: `Cannot <METHOD> <url>` con el cuerpo que arma
   * `AllExceptionsFilter`. Y el servicio nunca se alcanza.
   */
  async function expectAll404(user: TestUser) {
    for (const route of ROUTES) {
      const label = `${route.method} ${route.url}`;
      const real = await call(route, user);
      const missing = await call(route, user, bareApp);
      expect(missing.status).toBe(404);
      expect(missing.body.message).toBe(`Cannot ${route.method.toUpperCase()} ${route.url}`);
      expect({ label, ...observable(real) }).toEqual({ label, ...observable(missing) });
    }
    expect(serviceCalls()).toBe(0);
  }

  it('los guards globales del test de verdad bloquean (si no, los 404 de abajo no prueban nada)', async () => {
    const probe = (method: 'get' | 'post', url: string, user: TestUser) =>
      request(app.getHttpServer())[method](url).set('x-test-user', JSON.stringify(user));

    // DomainScopeGuard: un token que no es de tienda no entra a /store.
    const scope = await probe('post', '/api/store/gate-probe', USERS.tenantOrgAdminToken);
    expect(scope.status).toBe(403);
    // Gate de suscripción: la tienda ajena está bloqueada para escribir.
    const gate = await probe('post', '/api/store/gate-probe', USERS.tenantOwner);
    expect({ status: gate.status, code: gate.body.error_code }).toEqual({
      status: 403,
      code: 'SUBSCRIPTION_004',
    });
    // Plan: su plan no incluye ningún módulo mapeado.
    const plan = await probe('get', '/api/store/accounting/plan-probe', USERS.tenantOwner);
    expect({ status: plan.status, code: plan.body.error_code }).toEqual({
      status: 403,
      code: 'PLAN_MODULE_NOT_INCLUDED',
    });
  });

  it('tienda ajena con la suscripción bloqueada y un plan sin módulos → el 404 de una ruta inexistente, nunca el error del gate', async () => {
    // Fija `@SkipSubscriptionGate()` y que ningún guard global responda antes
    // que `PlatformStoreGuard`: sin el decorador, POST y DELETE darían el 403
    // SUBSCRIPTION_004 de la sonda de arriba.
    await expectAll404(USERS.tenantOwner);
  });

  it('dueño de una tienda normal con todos los permisos → 404 en las cuatro rutas', async () => {
    await expectAll404(USERS.tenantOwner);
  });

  it('usuario de una tienda normal SIN el permiso → 404, nunca el 403 que delataría la función', async () => {
    // Fija el orden de guards: PlatformStoreGuard antes que PermissionsGuard.
    await expectAll404(USERS.tenantCashier);
  });

  it('super admin con contexto en otra tienda → 404 (sin bypass por rol)', async () => {
    await expectAll404(USERS.superAdminInTenantStore);
  });

  it('usuario de otra org con store_id de la tienda plataforma en el token → 404', async () => {
    await expectAll404(USERS.tenantUserWithForeignStoreId);
  });

  it('usuario plataforma sin tienda en contexto o en una tienda plataforma inactiva → 404', async () => {
    await expectAll404(USERS.platformSellerWithoutStore);
    await expectAll404(USERS.platformUserInInactiveStore);
  });

  it('usuario de la tienda plataforma SIN el permiso → 403 en las cuatro rutas', async () => {
    for (const route of ROUTES) {
      const res = await call(route, USERS.platformUserWithoutPermission);
      expect(res.status).toBe(403);
    }
    expect(serviceCalls()).toBe(0);
  });

  it('usuario de la tienda plataforma CON el permiso → éxito en las cuatro rutas', async () => {
    const statuses: number[] = [];
    for (const route of ROUTES) {
      statuses.push((await call(route, USERS.platformSeller)).status);
    }
    // POST conserva el 201 por defecto de Nest (crea la fila del enlace).
    expect(statuses).toEqual([200, 200, 201, 200]);
    expect(service.searchOrganizations).toHaveBeenCalledWith('acme');
    const ctx = { store_id: PLATFORM_STORE, organization_id: PLATFORM_ORG, user_id: 100 };
    expect(service.getLink).toHaveBeenCalledWith(ctx, 5);
    expect(service.link).toHaveBeenCalledWith(ctx, 5, expect.objectContaining({ organization_id: 9 }));
    expect(service.unlink).toHaveBeenCalledWith(ctx, 5, expect.any(Object));
  });

  it('solo platform:crm_link:read: ve el enlace, no puede buscar, enlazar ni desenlazar', async () => {
    const statuses: number[] = [];
    for (const route of ROUTES) {
      statuses.push((await call(route, USERS.platformReader)).status);
    }
    expect(statuses).toEqual([403, 200, 403, 403]);
  });

  it.each([
    ['ausente', undefined],
    ['distinta', '2'],
    ['no numérica', 'uno'],
    ['cero', '0'],
  ])(
    'VENDIX_PLATFORM_ORG_ID %s → 404 para todos, incluida la tienda plataforma',
    async (_label, value) => {
      if (value === undefined) delete process.env.VENDIX_PLATFORM_ORG_ID;
      else process.env.VENDIX_PLATFORM_ORG_ID = value;

      await expectAll404(USERS.platformSeller);
    },
  );

  it('PlatformOrgService resuelve otra organización → 404', async () => {
    platformOrgInDb = 2;
    await expectAll404(USERS.platformSeller);
  });

  it('un fallo leyendo la base no abre la ruta → 404, y el log guarda el stack', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      dbFails = true;
      await expectAll404(USERS.platformSeller);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('connection reset'),
        expect.stringMatching(/^Error: connection reset\n\s+at /),
      );
    } finally {
      logError.mockRestore();
    }
  });
});
