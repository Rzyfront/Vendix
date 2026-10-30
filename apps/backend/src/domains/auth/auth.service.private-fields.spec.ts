import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { toPublicAuthUser } from './utils/public-auth-user.util';
import { GlobalPrismaService as PrismaService } from '../../prisma/services/global-prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../../email/email.service';
import { AuditService } from '../../common/audit/audit.service';
import { OnboardingService } from '../organization/onboarding/onboarding.service';
import { EmailBrandingService } from '../../email/services/email-branding.service';
import { DefaultPanelUIService } from '../../common/services/default-panel-ui.service';
import { CustomersService } from '../store/customers/customers.service';
import { S3Service } from '@common/services/s3.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException } from 'src/common/errors';
import * as bcrypt from 'bcrypt';

/**
 * F-194: el servicio migró de `UnauthorizedException` (Nest) a
 * `VendixHttpException` en `144af5c2f` (2026-08-15, DIAN bus + Anexo 19) sin
 * tocar este spec, que quedó comprobando la clase vieja — 4 de 5 tests caían
 * desde entonces con "Expected constructor: UnauthorizedException / Received
 * constructor: VendixHttpException". No es una regresión del contrato HTTP
 * 401: `AUTH_CREDENTIALS_001.httpStatus === 401` (`error-codes.ts:438`), la
 * respuesta al cliente sigue siendo 401 tal cual — sólo cambió la clase
 * interna que la construye. El fix es este helper: valida clase nueva +
 * status real en vez de la clase retirada.
 */
function expectUnauthorized(error: unknown): void {
  expect(error).toBeInstanceOf(VendixHttpException);
  expect((error as VendixHttpException).getStatus()).toBe(401);
}

describe('AuthService — private user fields never leave auth responses (QUI-966 S16)', () => {
  let service: AuthService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    users: {
      // `login` entra por findUserAccountsByEmail, que lee con findMany: un
      // mismo email puede tener cuenta en varias organizaciones, así que primero
      // se resuelven las candidatas y solo después se elige una. findFirst
      // sigue declarado porque otros caminos del servicio lo usan.
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user_settings: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    organizations: {
      findUnique: jest.fn(),
    },
    stores: {
      findUnique: jest.fn(),
      // `login` resuelve la organización a partir del store_slug cuando el
      // cliente no manda organization_slug, y esa lectura es findFirst: el slug
      // de tienda solo es único DENTRO de la organización, no globalmente.
      findFirst: jest.fn(),
    },
    store_users: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    refresh_tokens: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    login_attempts: {
      create: jest.fn(),
    },
    user_roles: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  const mockJwtService = {
    sign: jest.fn(() => 'token'),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockEmailService = {};
  const mockAuditService = {
    logAuth: jest.fn(),
  };
  const mockOnboardingService = {};
  // El login firma el snapshot de sesión: resuelve branding, genera el panel_ui
  // por defecto para el app_type y firma las URLs de avatar/logo. Sin estos
  // dobles el módulo no compila y ninguna aserción de login corre.
  const mockEmailBrandingService = {
    getStoreBranding: jest.fn().mockResolvedValue({}),
    getOrganizationBranding: jest.fn().mockResolvedValue({}),
    getStoreEcommerceUrl: jest.fn().mockResolvedValue('https://tienda.test'),
  };
  const mockDefaultPanelUIService = {
    generatePanelUI: jest.fn().mockReturnValue({}),
  };
  // signUrl devuelve la entrada: la firma de S3 es contrato de S3Service y
  // tiene sus propios tests; una firma falsa solo ensuciaría las aserciones.
  const mockS3Service = {
    signUrl: jest.fn((url) => url),
    sanitizeForStorage: jest.fn((url) => url),
  };
  const mockEventEmitter = { emit: jest.fn() };

  /**
   * Fila de `users` tal como la trae findUserAccountsByEmail: con la
   * organización embebida y `user_roles.roles.role_permissions.permissions`,
   * porque login() deriva los permisos planos desde esa misma consulta en vez de
   * hacer un segundo fetch.
   */
  function accountRow(overrides: Record<string, any> = {}) {
    return {
      id: 1,
      email: 'test@test.com',
      password: 'hashed',
      organization_id: 1,
      state: 'active',
      failed_login_attempts: 0,
      organizations: {
        id: 1,
        name: 'Org A',
        slug: 'org-a',
        logo_url: null,
      },
      user_roles: [],
      ...overrides,
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: OnboardingService, useValue: mockOnboardingService },
        { provide: EmailBrandingService, useValue: mockEmailBrandingService },
        {
          provide: DefaultPanelUIService,
          useValue: mockDefaultPanelUIService,
        },
        { provide: S3Service, useValue: mockS3Service },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        // DEPENDENCIA MUERTA: inyectada en AuthService y nunca usada.
        { provide: CustomersService, useValue: {} },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
  });


  const SECRET = 'JBSWY3DPEHPK3PXP';

  function expectNoPrivateFields(user: any) {
    expect(user).toBeDefined();
    expect(user).not.toHaveProperty('two_factor_secret');
    expect(user).not.toHaveProperty('password');
  }

  it('login: data.user has no two_factor_secret/password and keeps the rest', async () => {
    const user = accountRow({
      email: 'owner@test.com',
      password: await bcrypt.hash('123', 10),
      two_factor_secret: SECRET,
      two_factor_enabled: false,
      locked_until: null,
      user_roles: [{ roles: { name: 'owner', role_permissions: [] } }],
    });
    mockPrismaService.users.findMany.mockResolvedValue([user]);
    mockPrismaService.stores.findFirst.mockResolvedValue({
      id: 10,
      slug: 'store-a',
      organization_id: 1,
      organizations: { slug: 'org-a' },
    });
    mockPrismaService.user_settings.findUnique.mockResolvedValue({ config: {} });
    mockPrismaService.stores.findUnique.mockResolvedValue({
      id: 10,
      slug: 'store-a',
      organization_id: 1,
    });
    mockPrismaService.refresh_tokens.create.mockResolvedValue({});
    mockPrismaService.users.update.mockResolvedValue({});
    mockPrismaService.store_users.findFirst.mockResolvedValue({
      store: { organizations: { id: 1 }, id: 10 },
    });

    const result: any = await service.login({
      email: 'owner@test.com',
      password: '123',
      store_slug: 'store-a',
    });

    expectNoPrivateFields(result.user);
    expect(result.user).toEqual(
      expect.objectContaining({
        id: 1,
        email: 'owner@test.com',
        organization_id: 1,
        state: 'active',
        failed_login_attempts: 0,
        two_factor_enabled: false,
        locked_until: null,
        roles: ['owner'],
      }),
    );
    expect(result.access_token).toBe('token');
  });

  it('loginCustomer: user has no two_factor_secret/password and keeps the rest', async () => {
    mockPrismaService.stores.findUnique.mockResolvedValue({
      id: 22,
      organization_id: 12,
    });
    mockPrismaService.users.findFirst.mockResolvedValue({
      id: 7,
      email: 'customer@example.com',
      password: await bcrypt.hash('123', 10),
      two_factor_secret: SECRET,
      failed_login_attempts: 0,
      organization_id: 12,
      state: 'active',
      user_roles: [{ roles: { name: 'customer' } }],
      user_settings: { id: 3, config: {} },
      organizations: { id: 12, domain_settings: [] },
      store_users: [{ store_id: 22 }],
    });
    mockPrismaService.refresh_tokens.create.mockResolvedValue({});
    mockPrismaService.users.update.mockResolvedValue({});

    const result: any = await service.loginCustomer({
      email: 'customer@example.com',
      password: '123',
      store_id: 22,
    });

    expectNoPrivateFields(result.user);
    expect(result.user).toEqual(
      expect.objectContaining({
        id: 7,
        email: 'customer@example.com',
        failed_login_attempts: 0,
        organization_id: 12,
        user_settings: { id: 3, config: {} },
        store_users: [{ store_id: 22 }],
      }),
    );
    expect(result.user_settings).toEqual({ id: 3, config: {} });
    expect(result.roles).toEqual(['customer']);
  });

  it('refreshToken: user has no two_factor_secret/password and keeps the rest', async () => {
    mockConfigService.get.mockImplementation((key: string) =>
      key === 'JWT_REFRESH_SECRET' ? 'refresh-secret' : undefined,
    );
    mockJwtService.verify.mockReturnValue({
      sub: 1,
      organization_id: 1,
      store_id: null,
      app_type: 'ORG_ADMIN',
    });
    mockPrismaService.refresh_tokens.findFirst.mockResolvedValue({
      id: 5,
      ip_address: null,
      user_agent: null,
      users: {
        id: 1,
        email: 'owner@test.com',
        password: 'hashed',
        two_factor_secret: SECRET,
        organization_id: 1,
        state: 'active',
        failed_login_attempts: 0,
        user_roles: [],
      },
    });
    mockPrismaService.refresh_tokens.update.mockResolvedValue({});

    const result: any = await service.refreshToken({ refresh_token: 'rt' } as any);

    expectNoPrivateFields(result.user);
    expect(result.user).toEqual({
      id: 1,
      email: 'owner@test.com',
      organization_id: 1,
      state: 'active',
      failed_login_attempts: 0,
      user_roles: [],
    });
    mockConfigService.get.mockReset();
  });

  it('getProfile: no two_factor_secret/password, rest unchanged', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      id: 1,
      email: 'owner@test.com',
      password: 'hashed',
      two_factor_secret: SECRET,
      avatar_url: null,
      addresses: [],
    });
    mockPrismaService.user_roles.findMany.mockResolvedValue([]);

    const result: any = await service.getProfile(1, null);

    expectNoPrivateFields(result);
    expect(result).toEqual({
      id: 1,
      email: 'owner@test.com',
      addresses: [],
      user_roles: [],
      avatar_url: null,
    });
  });

  it('validateUser: no two_factor_secret/password, rest unchanged', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      id: 1,
      email: 'owner@test.com',
      password: 'hashed',
      two_factor_secret: SECRET,
      user_roles: [],
    });

    const result: any = await service.validateUser(1);

    expectNoPrivateFields(result);
    expect(result).toEqual({ id: 1, email: 'owner@test.com', user_roles: [] });
  });

  it('getCurrentUser (/auth/me): no two_factor_secret/password, rest unchanged', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      id: 1,
      email: 'owner@test.com',
      password: 'hashed',
      two_factor_secret: SECRET,
      organizations: null,
    });
    mockPrismaService.user_roles.findMany.mockResolvedValue([
      { roles: { name: 'owner' } },
    ]);

    const result: any = await service.getCurrentUser(1, null);

    expectNoPrivateFields(result);
    expect(result).toEqual(
      expect.objectContaining({ id: 1, email: 'owner@test.com', roles: ['owner'] }),
    );
  });

  it('toPublicAuthUser (register owner/customer/staff, super-admin verify): drops only the private columns', () => {
    const row = {
      id: 1,
      email: 'a@b.co',
      password: 'hashed',
      two_factor_secret: SECRET,
      failed_login_attempts: 2,
      locked_until: null,
      roles: ['owner'],
    };
    expect(toPublicAuthUser(row)).toEqual({
      id: 1,
      email: 'a@b.co',
      failed_login_attempts: 2,
      locked_until: null,
      roles: ['owner'],
    });
    expect(toPublicAuthUser({ id: 2 })).toEqual({ id: 2 });
  });
});
