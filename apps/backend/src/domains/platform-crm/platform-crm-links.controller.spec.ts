import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ResponseService } from '@common/responses/response.service';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../common/services/platform-org.service';
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
 * App Nest REAL con prefijo `api`, `PlatformStoreGuard` y `PermissionsGuard`
 * reales y `PlatformOrgService` real sobre un doble de la base. Solo el
 * servicio de negocio es un doble (se comprueba que nunca se alcanza en un
 * rechazo). `req.user` imita lo que deja `JwtStrategy`.
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
  roles: string[];
  permissions: typeof ALL_PERMISSIONS;
};

const USERS = {
  tenantOwner: {
    id: 700,
    organization_id: TENANT_ORG,
    store_id: TENANT_STORE,
    roles: ['owner'],
    permissions: ALL_PERMISSIONS,
  },
  tenantCashier: {
    id: 700,
    organization_id: TENANT_ORG,
    store_id: TENANT_STORE,
    roles: ['cashier'],
    permissions: ALL_PERMISSIONS.filter((p) => !p.name.startsWith('platform:')),
  },
  superAdminInTenantStore: {
    id: 101,
    organization_id: PLATFORM_ORG,
    store_id: TENANT_STORE,
    roles: ['super_admin'],
    permissions: [],
  },
  tenantUserWithForeignStoreId: {
    id: 700,
    organization_id: TENANT_ORG,
    store_id: PLATFORM_STORE,
    roles: ['owner'],
    permissions: ALL_PERMISSIONS,
  },
  platformUserWithoutPermission: {
    id: 100,
    organization_id: PLATFORM_ORG,
    store_id: PLATFORM_STORE,
    roles: ['seller'],
    permissions: ALL_PERMISSIONS.filter((p) => !p.name.startsWith('platform:')),
  },
  platformReader: {
    id: 102,
    organization_id: PLATFORM_ORG,
    store_id: PLATFORM_STORE,
    roles: ['seller'],
    permissions: ALL_PERMISSIONS.filter((p) => p.name === 'platform:crm_link:read'),
  },
  platformSeller: {
    id: 100,
    organization_id: PLATFORM_ORG,
    store_id: PLATFORM_STORE,
    roles: ['seller'],
    permissions: ALL_PERMISSIONS,
  },
  platformUserInInactiveStore: {
    id: 100,
    organization_id: PLATFORM_ORG,
    store_id: PLATFORM_STORE_INACTIVE,
    roles: ['seller'],
    permissions: ALL_PERMISSIONS,
  },
  platformSellerWithoutStore: {
    id: 100,
    organization_id: PLATFORM_ORG,
    store_id: null,
    roles: ['seller'],
    permissions: ALL_PERMISSIONS,
  },
} satisfies Record<string, TestUser>;

const ROUTES = [
  { method: 'get', url: '/api/store/platform-crm/organizations/search?q=acme' },
  { method: 'get', url: '/api/store/platform-crm/customers/5/link' },
  { method: 'post', url: '/api/store/platform-crm/customers/5/link', body: { organization_id: 9 } },
  { method: 'delete', url: '/api/store/platform-crm/customers/5/link', body: {} },
] as const;

describe('PlatformCrmLinksController · aislamiento por tienda (candados 1, 4 y 5)', () => {
  let app: INestApplication;
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PlatformCrmLinksController],
      providers: [
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

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    // Lo que deja JwtStrategy en req.user (el token ya validado).
    app.use((req: any, _res: unknown, next: () => void) => {
      const raw = req.headers['x-test-user'];
      if (typeof raw === 'string') req.user = JSON.parse(raw);
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (ORIGINAL_ENV === undefined) delete process.env.VENDIX_PLATFORM_ORG_ID;
    else process.env.VENDIX_PLATFORM_ORG_ID = ORIGINAL_ENV;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VENDIX_PLATFORM_ORG_ID = String(PLATFORM_ORG);
    platformOrgInDb = PLATFORM_ORG;
    dbFails = false;
  });

  function call(route: (typeof ROUTES)[number], user: TestUser) {
    const req = request(app.getHttpServer())
      [route.method](route.url)
      .set('x-test-user', JSON.stringify(user));
    return 'body' in route ? req.send(route.body) : req;
  }

  async function expectAll404(user: TestUser) {
    for (const route of ROUTES) {
      const res = await call(route, user);
      expect({ route: `${route.method} ${route.url}`, status: res.status }).toEqual({
        route: `${route.method} ${route.url}`,
        status: 404,
      });
      // Indistinguible de una ruta inexistente: nada menciona la función.
      expect(JSON.stringify(res.body)).not.toMatch(/platform|crm|permis/i);
    }
    expect(serviceCalls()).toBe(0);
  }

  it('a ruta inexistente y una ruta real responden el mismo 404 a una tienda ajena', async () => {
    const missing = await request(app.getHttpServer())
      .get('/api/store/platform-crm/does-not-exist')
      .set('x-test-user', JSON.stringify(USERS.tenantOwner));
    const real = await call(ROUTES[1], USERS.tenantOwner);
    expect(real.status).toBe(missing.status);
    expect(real.body.statusCode).toBe(missing.body.statusCode);
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

  it('un fallo leyendo la base no abre la ruta → 404', async () => {
    dbFails = true;
    await expectAll404(USERS.platformSeller);
  });
});
