import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
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
import { SENSITIVE_USER_FIELDS } from '@common/utils/safe-user-select.util';

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

describe('AuthService Login Flow', () => {
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
      // QUI-943: la recuperación de staff acepta el V-link de la tienda; como
      // el slug de tienda solo es único dentro de la organización, se leen
      // TODAS las tiendas con ese slug.
      findMany: jest.fn().mockResolvedValue([]),
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
      deleteMany: jest.fn(),
    },
    login_attempts: {
      create: jest.fn(),
    },
    password_reset_tokens: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    email_verification_tokens: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user_roles: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
    },
    // Acepta las dos formas de Prisma: callback interactivo y arreglo de
    // operaciones (resetPassword de staff usa el arreglo).
    $transaction: jest.fn((arg) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(mockPrismaService),
    ),
  };

  const mockJwtService = {
    sign: jest.fn(() => 'token'),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockEmailService = {
    sendPasswordResetEmail: jest.fn().mockResolvedValue({ success: true }),
  };
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

  it('should throw UnauthorizedException if user does not exist (Invalid Email)', async () => {
    mockPrismaService.users.findMany.mockResolvedValue([]);

    try {
      await service.login({ email: 'wrong@email.com', password: '123' });
      throw new Error('Should have thrown UnauthorizedException');
    } catch (error) {
      expectUnauthorized(error);
    }
  });

  it('should throw UnauthorizedException if organization slug does not match user organization', async () => {
    // La única cuenta del email vive en org-a; el cliente pide entrar por org-b.
    mockPrismaService.users.findMany.mockResolvedValue([accountRow()]);
    mockPrismaService.user_settings.findUnique.mockResolvedValue({
      config: {},
    });
    mockPrismaService.organizations.findUnique.mockResolvedValue({
      id: 2,
      slug: 'org-b',
    }); // Different Org ID

    try {
      await service.login({
        email: 'test@test.com',
        password: '123',
        organization_slug: 'org-b',
      });
      throw new Error('Should have thrown UnauthorizedException');
    } catch (error) {
      expectUnauthorized(error);
    }
  });

  it('should throw UnauthorizedException if store belongs to different organization', async () => {
    mockPrismaService.users.findMany.mockResolvedValue([accountRow()]);
    mockPrismaService.user_settings.findUnique.mockResolvedValue({
      config: {},
    });
    // Cuando llega store_slug sin organization_slug, el servicio resuelve la
    // organización desde la tienda con findFirst (el slug de tienda solo es
    // único dentro de su organización).
    mockPrismaService.stores.findFirst.mockResolvedValue({
      id: 10,
      slug: 'store-b',
      organization_id: 2, // Different Org ID
      organizations: { slug: 'org-b' },
    });
    mockPrismaService.stores.findUnique.mockResolvedValue({
      id: 10,
      slug: 'store-b',
      organization_id: 2,
    });

    try {
      await service.login({
        email: 'test@test.com',
        password: '123',
        store_slug: 'store-b',
      });
      throw new Error('Should have thrown UnauthorizedException');
    } catch (error) {
      expectUnauthorized(error);
    }
  });

  it('should allow High Privilege user to access store in same organization without direct link', async () => {
    const user = accountRow({
      email: 'owner@test.com',
      password: await bcrypt.hash('123', 10),
      user_roles: [{ roles: { name: 'owner', role_permissions: [] } }],
    });
    mockPrismaService.users.findMany.mockResolvedValue([user]);
    mockPrismaService.stores.findFirst.mockResolvedValue({
      id: 10,
      slug: 'store-a',
      organization_id: 1,
      organizations: { slug: 'org-a' },
    });
    mockPrismaService.user_settings.findUnique.mockResolvedValue({
      config: {},
    });
    mockPrismaService.stores.findUnique.mockResolvedValue({
      id: 10,
      slug: 'store-a',
      organization_id: 1, // Same Org ID
      is_active: true,
    });
    // No store_users mock needed as it shouldn't be called for high privilege

    // Mock successful login flow
    mockPrismaService.refresh_tokens.create.mockResolvedValue({});
    mockPrismaService.users.update.mockResolvedValue({});
    mockPrismaService.store_users.findFirst.mockResolvedValue({
      store: { organizations: { id: 1 }, id: 10 },
    }); // Mock for later context check

    const result = await service.login({
      email: 'owner@test.com',
      password: '123',
      store_slug: 'store-a',
    });
    expect(result).toBeDefined();
    expect(mockPrismaService.stores.findUnique).toHaveBeenCalledWith({
      where: {
        organization_id_slug: {
          organization_id: user.organization_id,
          slug: 'store-a',
        },
      },
      include: { organizations: true },
    });
  });

  it('should throw UnauthorizedException for Low Privilege user accessing store without direct link', async () => {
    const user = accountRow({
      id: 2,
      email: 'staff@test.com',
      user_roles: [{ roles: { name: 'employee', role_permissions: [] } }],
    });
    mockPrismaService.users.findMany.mockResolvedValue([user]);
    mockPrismaService.stores.findFirst.mockResolvedValue({
      id: 10,
      slug: 'store-a',
      organization_id: 1,
      organizations: { slug: 'org-a' },
    });
    mockPrismaService.user_settings.findUnique.mockResolvedValue({
      config: {},
    });
    mockPrismaService.stores.findUnique.mockResolvedValue({
      id: 10,
      slug: 'store-a',
      organization_id: 1, // Same Org ID
      is_active: true,
    });
    mockPrismaService.store_users.findFirst.mockResolvedValue(null); // No direct link

    try {
      await service.login({
        email: 'staff@test.com',
        password: '123',
        store_slug: 'store-a',
      });
      throw new Error('Should have thrown UnauthorizedException');
    } catch (error) {
      expectUnauthorized(error);
    }
  });

  describe('tiendas inactivas (incidente vendix-centro)', () => {
    // Los mocks son compartidos entre tests: se deja el estado que esperan
    // los tests siguientes (tienda activa store-a con membresía).
    afterEach(() => {
      mockPrismaService.stores.findUnique.mockResolvedValue({
        id: 10,
        slug: 'store-a',
        organization_id: 1,
        is_active: true,
      });
      mockPrismaService.store_users.findFirst.mockResolvedValue({
        store: { organizations: { id: 1 }, id: 10 },
      });
    });

    it('rechaza abrir una tienda inactiva por slug explícito, incluso a un owner', async () => {
      const user = accountRow({
        email: 'owner@test.com',
        password: await bcrypt.hash('123', 10),
        user_roles: [{ roles: { name: 'owner', role_permissions: [] } }],
      });
      mockPrismaService.users.findMany.mockResolvedValue([user]);
      mockPrismaService.stores.findFirst.mockResolvedValue({
        id: 2,
        slug: 'vendix-centro',
        organization_id: 1,
        organizations: { slug: 'org-a' },
      });
      mockPrismaService.user_settings.findUnique.mockResolvedValue({
        config: {},
      });
      mockPrismaService.stores.findUnique.mockResolvedValue({
        id: 2,
        slug: 'vendix-centro',
        organization_id: 1,
        is_active: false,
      });
      mockPrismaService.store_users.create.mockClear();

      await expect(
        service.login({
          email: 'owner@test.com',
          password: '123',
          store_slug: 'vendix-centro',
        }),
      ).rejects.toMatchObject({ errorCode: 'AUTH_STORE_INACTIVE_001' });
      expect(mockPrismaService.store_users.create).not.toHaveBeenCalled();
    });

    it('login sin slug ignora una main_store inactiva y abre la tienda activa', async () => {
      const user = accountRow({
        email: 'rafa@test.com',
        password: await bcrypt.hash('123', 10),
        main_store_id: 2,
        user_roles: [{ roles: { name: 'admin', role_permissions: [] } }],
      });
      mockPrismaService.users.findMany.mockResolvedValue([user]);
      mockPrismaService.user_settings.findUnique.mockResolvedValue({
        id: 1,
        app_type: 'STORE_ADMIN',
        config: {},
      });
      // main_store_id apunta a la tienda inactiva.
      mockPrismaService.stores.findUnique.mockResolvedValue({
        id: 2,
        slug: 'vendix-centro',
        organization_id: 1,
        is_active: false,
      });
      const activeStore = {
        id: 1,
        slug: 'vendix-crm',
        organization_id: 1,
        is_active: true,
        organizations: { id: 1 },
      };
      mockPrismaService.store_users.findFirst.mockReset();
      mockPrismaService.store_users.findFirst.mockResolvedValue({
        store: activeStore,
      });
      mockPrismaService.store_users.create.mockClear();
      mockPrismaService.users.update.mockClear();
      mockPrismaService.refresh_tokens.create.mockResolvedValue({});

      await service.login({ email: 'rafa@test.com', password: '123' });

      // Estrategia 2: solo membresías en tiendas activas, orden determinista.
      expect(mockPrismaService.store_users.findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: {
            user_id: user.id,
            store: { organization_id: 1, is_active: true },
          },
          orderBy: { store_id: 'asc' },
        }),
      );
      // Contexto final: también exige tienda activa.
      expect(mockPrismaService.store_users.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            store: expect.objectContaining({
              slug: 'vendix-crm',
              is_active: true,
            }),
          }),
        }),
      );
      // Nunca se auto-relaciona con la tienda inactiva y el arranque queda en la activa.
      expect(mockPrismaService.store_users.create).not.toHaveBeenCalled();
      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { main_store_id: 1 },
      });
    });

    it('slug de tienda inactiva con contraseña incorrecta: credenciales, sin revelar que está inactiva', async () => {
      const user = accountRow({
        email: 'owner@test.com',
        password: await bcrypt.hash('correcta', 4),
        user_roles: [{ roles: { name: 'owner', role_permissions: [] } }],
      });
      mockPrismaService.users.findMany.mockResolvedValue([user]);
      mockPrismaService.stores.findFirst.mockResolvedValue({
        id: 2,
        slug: 'vendix-centro',
        organization_id: 1,
        organizations: { slug: 'org-a' },
      });
      mockPrismaService.user_settings.findUnique.mockResolvedValue({
        config: {},
      });
      mockPrismaService.stores.findUnique.mockResolvedValue({
        id: 2,
        slug: 'vendix-centro',
        organization_id: 1,
        is_active: false,
      });
      const failed = jest
        .spyOn(service as any, 'handleFailedLogin')
        .mockResolvedValue(undefined);

      await expect(
        service.login({
          email: 'owner@test.com',
          password: 'otra',
          store_slug: 'vendix-centro',
        }),
      ).rejects.toMatchObject({ errorCode: 'AUTH_CREDENTIALS_001' });
      expect(failed).toHaveBeenCalledWith(user.id, undefined);
      failed.mockRestore();
    });

    it('slug de tienda inactiva sin membresía (rol de tienda): credenciales antes que inactiva', async () => {
      const user = accountRow({
        email: 'staff@test.com',
        password: await bcrypt.hash('123', 4),
        user_roles: [{ roles: { name: 'employee', role_permissions: [] } }],
      });
      mockPrismaService.users.findMany.mockResolvedValue([user]);
      mockPrismaService.stores.findFirst.mockResolvedValue({
        id: 2,
        slug: 'vendix-centro',
        organization_id: 1,
        organizations: { slug: 'org-a' },
      });
      mockPrismaService.user_settings.findUnique.mockResolvedValue({
        config: {},
      });
      mockPrismaService.stores.findUnique.mockResolvedValue({
        id: 2,
        slug: 'vendix-centro',
        organization_id: 1,
        is_active: false,
      });
      mockPrismaService.store_users.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.login({
          email: 'staff@test.com',
          password: '123',
          store_slug: 'vendix-centro',
        }),
      ).rejects.toMatchObject({ errorCode: 'AUTH_CREDENTIALS_001' });
    });

    it('owner/admin: la sesión abierta a propósito en una tienda inactiva sí se renueva', async () => {
      mockConfigService.get.mockReturnValue('secret');
      mockJwtService.verify.mockReturnValue({
        sub: 1,
        organization_id: 1,
        store_id: 2,
      });
      mockPrismaService.refresh_tokens.findFirst.mockResolvedValue({
        id: 9,
        user_id: 1,
        users: {
          id: 1,
          organization_id: 1,
          user_roles: [{ roles: { name: 'owner' } }],
        },
      });
      const security = jest
        .spyOn(service as any, 'validateRefreshTokenSecurity')
        .mockResolvedValue(undefined);
      // Se corta justo al emitir: basta con saber que llegó a generar tokens.
      const generate = jest
        .spyOn(service as any, 'generateTokens')
        .mockRejectedValue(new Error('emitido'));
      mockPrismaService.stores.findUnique.mockResolvedValue({
        is_active: false,
      });

      await expect(
        service.refreshToken({ refresh_token: 'rt' } as any),
      ).rejects.toMatchObject({ errorCode: 'AUTH_TOKEN_001' });
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ store_id: 2 }),
      );
      security.mockRestore();
      generate.mockRestore();
      mockConfigService.get.mockReset();
    });

    it('no renueva una sesión abierta en una tienda que se desactivó', async () => {
      mockConfigService.get.mockReturnValue('secret');
      mockJwtService.verify.mockReturnValue({
        sub: 1,
        organization_id: 1,
        store_id: 2,
      });
      mockPrismaService.refresh_tokens.findFirst.mockResolvedValue({
        id: 9,
        user_id: 1,
        users: { id: 1, organization_id: 1, user_roles: [] },
      });
      const security = jest
        .spyOn(service as any, 'validateRefreshTokenSecurity')
        .mockResolvedValue(undefined);
      const generate = jest.spyOn(service as any, 'generateTokens');
      mockPrismaService.stores.findUnique.mockResolvedValue({
        is_active: false,
      });

      await expect(
        service.refreshToken({ refresh_token: 'rt' } as any),
      ).rejects.toMatchObject({ errorCode: 'AUTH_STORE_INACTIVE_001' });
      expect(mockPrismaService.stores.findUnique).toHaveBeenCalledWith({
        where: { id: 2 },
        select: { is_active: true },
      });
      expect(generate).not.toHaveBeenCalled();
      security.mockRestore();
      generate.mockRestore();
      mockConfigService.get.mockReset();
    });
  });

  it.each(['admin@example.com', 'ADMIN@EXAMPLE.COM', ' Admin@Example.com '])(
    'finds a legacy mixed-case staff account for %s',
    async (email) => {
      const legacy = accountRow({
        email: 'Admin@Example.COM',
        user_roles: [{ roles: { name: 'admin', role_permissions: [] } }],
      });
      mockPrismaService.users.findMany.mockImplementation(async ({ where }) => {
        const filter = where.email;
        const matches =
          typeof filter === 'string'
            ? legacy.email === filter
            : filter.mode === 'insensitive' &&
              legacy.email.toLowerCase() === filter.equals;
        return matches ? [legacy] : [];
      });

      const result = await service.findUserAccountsByEmail(email);

      expect(result.matchType).toBe('single_account');
      expect(result.user?.id).toBe(legacy.id);
      expect(mockPrismaService.users.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            email: { equals: 'admin@example.com', mode: 'insensitive' },
            state: { notIn: ['inactive', 'suspended', 'archived'] },
          },
        }),
      );
    },
  );

  it('keeps customer-only accounts out of the staff login after case folding', async () => {
    mockPrismaService.users.findMany.mockResolvedValue([
      accountRow({ user_roles: [{ roles: { name: 'customer' } }] }),
    ]);
    expect(
      (await service.findUserAccountsByEmail(' TEST@TEST.COM ')).matchType,
    ).toBe('not_found');
  });

  it('normalizes recovery lookups without losing organization scope', async () => {
    mockPrismaService.organizations.findUnique.mockResolvedValue({ id: 12 });
    mockPrismaService.users.findFirst.mockResolvedValue(null);

    await service.forgotPassword(' Staff@Example.COM ', 'org-a');

    expect(mockPrismaService.users.findFirst).toHaveBeenLastCalledWith({
      where: {
        email: { equals: 'staff@example.com', mode: 'insensitive' },
        organization_id: 12,
      },
    });
  });

  it('normalizes customer login lookup without widening the tenant', async () => {
    mockPrismaService.stores.findUnique.mockResolvedValue({
      id: 22,
      organization_id: 12,
    });
    mockPrismaService.users.findFirst.mockResolvedValue(null);

    await expect(
      service.loginCustomer({
        email: ' Customer@Example.COM ',
        password: 'incorrect',
        store_id: 22,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(mockPrismaService.users.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          email: { equals: 'customer@example.com', mode: 'insensitive' },
          organization_id: 12,
        },
      }),
    );
  });

  /**
   * QUI-943 — un usuario de tienda pedía recuperar la contraseña con el V-link
   * de su TIENDA (o sin V-link, porque el login de staff ya no lo exige) y el
   * backend solo buscaba organizaciones por slug: respondía el mensaje
   * genérico y nunca enviaba el correo.
   */
  describe('forgotPassword account resolution (QUI-943)', () => {
    const GENERIC =
      'Si el email existe, recibirás instrucciones para restablecer tu contraseña';
    const staff = accountRow({
      id: 41,
      email: 'cajero@tienda.com',
      first_name: 'Ana',
      organization_id: 12,
      user_roles: [{ roles: { name: 'employee' } }],
    });

    beforeEach(() => {
      mockPrismaService.organizations.findUnique.mockReset();
      mockPrismaService.users.findFirst.mockReset();
      mockPrismaService.users.findMany.mockReset().mockResolvedValue([]);
      mockPrismaService.stores.findMany.mockReset().mockResolvedValue([]);
      mockPrismaService.password_reset_tokens.create.mockClear();
      mockEmailService.sendPasswordResetEmail
        .mockReset()
        .mockResolvedValue({ success: true });
      mockAuditService.logAuth.mockClear();
    });

    it('sends the reset email when the V-link is the store slug', async () => {
      mockPrismaService.organizations.findUnique.mockResolvedValue(null);
      mockPrismaService.stores.findMany.mockResolvedValue([
        { organization_id: 12 },
      ]);
      mockPrismaService.users.findMany.mockResolvedValueOnce([staff]);

      const result = await service.forgotPassword(
        'cajero@tienda.com',
        'mi-tienda',
      );

      expect(result).toEqual({ message: GENERIC });
      expect(mockPrismaService.stores.findMany).toHaveBeenCalledWith({
        where: { slug: 'mi-tienda' },
        select: { organization_id: true },
      });
      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith({
        where: {
          email: { equals: 'cajero@tienda.com', mode: 'insensitive' },
          organization_id: { in: [12] },
          state: { in: ['active', 'pending_verification'] },
        },
      });
      expect(
        mockPrismaService.password_reset_tokens.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: 41 }),
        }),
      );
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'cajero@tienda.com',
        expect.any(String),
        'Ana',
        undefined,
      );
      expect(mockAuditService.logAuth).toHaveBeenCalledWith(
        41,
        expect.anything(),
        expect.objectContaining({ email_sent: true }),
        undefined,
        undefined,
      );
    });

    it('sends the reset email without V-link when the email has one staff account', async () => {
      mockPrismaService.users.findMany.mockResolvedValue([staff]);

      const result = await service.forgotPassword('cajero@tienda.com');

      expect(result).toEqual({ message: GENERIC });
      expect(mockPrismaService.organizations.findUnique).not.toHaveBeenCalled();
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'cajero@tienda.com',
        expect.any(String),
        'Ana',
        undefined,
      );
    });

    it('keeps the organization-slug lookup for existing clients', async () => {
      mockPrismaService.organizations.findUnique.mockResolvedValue({ id: 12 });
      mockPrismaService.users.findFirst.mockResolvedValue(staff);

      await service.forgotPassword('cajero@tienda.com', 'org-a');

      expect(mockPrismaService.users.findFirst).toHaveBeenCalledWith({
        where: {
          email: { equals: 'cajero@tienda.com', mode: 'insensitive' },
          organization_id: 12,
        },
      });
      expect(mockPrismaService.stores.findMany).not.toHaveBeenCalled();
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    });

    it('answers the same generic message and sends nothing for an unknown email', async () => {
      mockPrismaService.organizations.findUnique.mockResolvedValue(null);

      const withSlug = await service.forgotPassword('nadie@x.com', 'no-existe');
      const withoutSlug = await service.forgotPassword('nadie@x.com');

      expect(withSlug).toEqual({ message: GENERIC });
      expect(withoutSlug).toEqual({ message: GENERIC });
      expect(
        mockPrismaService.password_reset_tokens.create,
      ).not.toHaveBeenCalled();
      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('does not guess when the email has several staff accounts and no V-link', async () => {
      mockPrismaService.users.findMany.mockResolvedValue([
        staff,
        { ...staff, id: 42, organization_id: 13 },
      ]);

      await service.forgotPassword('cajero@tienda.com');

      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('records email_sent=false and keeps the generic answer when the provider fails', async () => {
      mockPrismaService.users.findMany.mockResolvedValue([staff]);
      mockEmailService.sendPasswordResetEmail.mockResolvedValue({
        success: false,
        error: 'MessageRejected',
      });
      const logError = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      const result = await service.forgotPassword('cajero@tienda.com');

      expect(result).toEqual({ message: GENERIC });
      expect(mockAuditService.logAuth).toHaveBeenCalledWith(
        41,
        expect.anything(),
        expect.objectContaining({ email_sent: false }),
        undefined,
        undefined,
      );
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('user 41'));
      expect(logError).not.toHaveBeenCalledWith(
        expect.stringContaining('cajero@tienda.com'),
      );
    });

    it('records email_sent=false when the provider throws', async () => {
      mockPrismaService.users.findMany.mockResolvedValue([staff]);
      mockEmailService.sendPasswordResetEmail.mockRejectedValue(
        new Error('timeout'),
      );
      jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.forgotPassword('cajero@tienda.com'),
      ).resolves.toEqual({ message: GENERIC });
      expect(mockAuditService.logAuth).toHaveBeenCalledWith(
        41,
        expect.anything(),
        expect.objectContaining({ email_sent: false }),
        undefined,
        undefined,
      );
    });

    it('customer recovery also records the real email_sent result', async () => {
      mockPrismaService.stores.findUnique.mockResolvedValue({
        id: 22,
        organization_id: 12,
        name: 'Mi Tienda',
      });
      mockPrismaService.users.findFirst.mockResolvedValue({
        id: 77,
        email: 'cliente@x.com',
        first_name: 'Luis',
        state: 'active',
        user_roles: [{ roles: { name: 'customer' } }],
        store_users: [],
      });
      mockEmailService.sendPasswordResetEmail.mockResolvedValue({
        success: false,
        error: 'MessageRejected',
      });
      jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.forgotPasswordCustomer('cliente@x.com', 22),
      ).resolves.toEqual({ message: GENERIC });
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'cliente@x.com',
        expect.any(String),
        'Luis',
        expect.objectContaining({ storeName: 'Mi Tienda' }),
      );
      expect(mockAuditService.logAuth).toHaveBeenCalledWith(
        77,
        expect.anything(),
        expect.objectContaining({
          method: 'forgot_password_customer_request',
          email_sent: false,
        }),
        undefined,
        undefined,
      );
    });
  });
  /**
   * QUI-982 — `users.avatar_url` guarda la key de S3. Toda respuesta que
   * alimenta la sesión del frontend debe exponer la URL firmada: una key cruda
   * en `<img src>` se resuelve contra el host del frontend y da 404.
   */
  describe('session user avatar (QUI-982)', () => {
    const AVATAR_KEY = 'organizations/org-a-1/users/1/avatars/123-a.webp';
    const SIGNED = `https://bucket.s3.amazonaws.com/${AVATAR_KEY}?X-Amz-Signature=sig`;

    beforeEach(() => {
      mockS3Service.signUrl.mockImplementation(async (url) =>
        url === AVATAR_KEY ? SIGNED : url,
      );
    });

    afterEach(() => {
      mockS3Service.signUrl.mockImplementation((url) => url);
      mockConfigService.get.mockReset();
      jest.restoreAllMocks();
    });

    async function loginOwner(avatar_url: string | null) {
      mockPrismaService.users.findMany.mockResolvedValue([
        accountRow({
          email: 'owner@test.com',
          password: await bcrypt.hash('123', 4),
          avatar_url,
          user_roles: [{ roles: { name: 'owner', role_permissions: [] } }],
        }),
      ]);
      mockPrismaService.stores.findFirst.mockResolvedValue({
        id: 10,
        slug: 'store-a',
        organization_id: 1,
        organizations: { slug: 'org-a' },
      });
      mockPrismaService.user_settings.findUnique.mockResolvedValue({
        config: {},
      });
      mockPrismaService.stores.findUnique.mockResolvedValue({
        id: 10,
        slug: 'store-a',
        organization_id: 1,
        is_active: true,
      });
      mockPrismaService.store_users.findFirst.mockResolvedValue({
        store: { id: 10, organizations: { id: 1 } },
      });
      mockPrismaService.refresh_tokens.create.mockResolvedValue({});
      mockPrismaService.users.update.mockResolvedValue({});
      return service.login({
        email: 'owner@test.com',
        password: '123',
        store_slug: 'store-a',
      });
    }

    it('login returns the signed storage URL, not the S3 key', async () => {
      const result: any = await loginOwner(AVATAR_KEY);
      expect(result.user.avatar_url).toBe(SIGNED);
    });

    it('login keeps avatar_url null for users without avatar', async () => {
      const result: any = await loginOwner(null);
      expect(result.user.avatar_url).toBeNull();
    });

    it('getCurrentUser (/auth/me) returns the signed avatar URL', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        id: 1,
        password: 'hashed',
        avatar_url: AVATAR_KEY,
      });

      const result: any = await service.getCurrentUser(1, null);

      expect(result.avatar_url).toBe(SIGNED);
      expect(result.password).toBeUndefined();
    });

    it('refreshToken returns the signed avatar URL', async () => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'JWT_REFRESH_SECRET' ? 'refresh-secret' : undefined,
      );
      mockJwtService.verify.mockReturnValue({
        sub: 1,
        organization_id: 1,
        store_id: null,
      });
      mockPrismaService.refresh_tokens.findFirst.mockResolvedValue({
        id: 7,
        users: {
          id: 1,
          organization_id: 1,
          avatar_url: AVATAR_KEY,
          user_roles: [],
        },
      });
      mockPrismaService.refresh_tokens.update.mockResolvedValue({});
      const security = jest
        .spyOn(service as any, 'validateRefreshTokenSecurity')
        .mockResolvedValue(undefined);
      jest.spyOn(service as any, 'generateTokens').mockResolvedValue({
        access_token: 'a',
        refresh_token: 'r',
        token_type: 'Bearer',
        expires_in: 900,
      });

      const result = await service.refreshToken({ refresh_token: 'rt' });

      expect(result.user.avatar_url).toBe(SIGNED);
      expect(result.access_token).toBe('a');
    });
  });

  describe('session user without auth-only columns', () => {
    // An expired lock: login must go through it and still drop the columns.
    const AUTH_ONLY = {
      two_factor_secret: 'JBSWY3DPEHPK3PXP',
      failed_login_attempts: 2,
      locked_until: new Date('2020-01-01T00:00:00Z'),
    };

    function expectNoAuthOnlyColumns(user: object) {
      for (const field of SENSITIVE_USER_FIELDS) {
        expect(user).not.toHaveProperty(field);
      }
    }

    afterEach(() => {
      mockConfigService.get.mockReset();
      jest.restoreAllMocks();
    });

    it('login still checks the password and returns the session without auth-only columns (login non-regression)', async () => {
      mockPrismaService.users.findMany.mockResolvedValue([
        accountRow({
          email: 'owner@test.com',
          password: await bcrypt.hash('123', 4),
          ...AUTH_ONLY,
          user_roles: [{ roles: { name: 'owner', role_permissions: [] } }],
        }),
      ]);
      mockPrismaService.stores.findFirst.mockResolvedValue({
        id: 10,
        slug: 'store-a',
        organization_id: 1,
        organizations: { slug: 'org-a' },
      });
      mockPrismaService.user_settings.findUnique.mockResolvedValue({
        config: {},
      });
      mockPrismaService.stores.findUnique.mockResolvedValue({
        id: 10,
        slug: 'store-a',
        organization_id: 1,
        is_active: true,
      });
      mockPrismaService.store_users.findFirst.mockResolvedValue({
        store: { id: 10, organizations: { id: 1 } },
      });
      mockPrismaService.refresh_tokens.create.mockResolvedValue({});
      mockPrismaService.users.update.mockResolvedValue({});

      const result: any = await service.login({
        email: 'owner@test.com',
        password: '123',
        store_slug: 'store-a',
      });

      expectNoAuthOnlyColumns(result.user);
      expect(result.user).toEqual(
        expect.objectContaining({
          id: 1,
          email: 'owner@test.com',
          roles: ['owner'],
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          access_token: 'token',
          refresh_token: 'token',
          permissions: expect.any(Array),
        }),
      );
    });

    it('login still rejects an account whose lock has not expired', async () => {
      mockPrismaService.users.findMany.mockResolvedValue([
        accountRow({
          email: 'owner@test.com',
          password: await bcrypt.hash('123', 4),
          ...AUTH_ONLY,
          locked_until: new Date(Date.now() + 60 * 60 * 1000),
          user_roles: [{ roles: { name: 'owner', role_permissions: [] } }],
        }),
      ]);
      mockPrismaService.stores.findFirst.mockResolvedValue({
        id: 10,
        slug: 'store-a',
        organization_id: 1,
        organizations: { slug: 'org-a' },
      });
      mockPrismaService.refresh_tokens.create.mockClear();

      await expect(
        service.login({
          email: 'owner@test.com',
          password: '123',
          store_slug: 'store-a',
        }),
      ).rejects.toMatchObject({ errorCode: 'AUTH_VALIDATE_001' });
      expect(mockPrismaService.refresh_tokens.create).not.toHaveBeenCalled();
    });

    it('getCurrentUser (/auth/me) returns the user without auth-only columns', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@test.com',
        password: 'hashed',
        avatar_url: null,
        ...AUTH_ONLY,
      });

      const result: any = await service.getCurrentUser(1, null);

      expectNoAuthOnlyColumns(result);
      expect(result).toEqual(
        expect.objectContaining({ id: 1, email: 'test@test.com' }),
      );
    });

    it('getProfile (/auth/profile) returns the user without auth-only columns', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        id: 1,
        email: 'test@test.com',
        password: 'hashed',
        avatar_url: null,
        addresses: [],
        ...AUTH_ONLY,
      });

      const result: any = await service.getProfile(1, null);

      expectNoAuthOnlyColumns(result);
      expect(result).toEqual(
        expect.objectContaining({ id: 1, addresses: [], user_roles: [] }),
      );
    });

    it('refreshToken returns the user without auth-only columns', async () => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'JWT_REFRESH_SECRET' ? 'refresh-secret' : undefined,
      );
      mockJwtService.verify.mockReturnValue({
        sub: 1,
        organization_id: 1,
        store_id: null,
      });
      mockPrismaService.refresh_tokens.findFirst.mockResolvedValue({
        id: 7,
        users: {
          id: 1,
          organization_id: 1,
          password: 'hashed',
          avatar_url: null,
          user_roles: [],
          ...AUTH_ONLY,
        },
      });
      mockPrismaService.refresh_tokens.update.mockResolvedValue({});
      jest
        .spyOn(service as any, 'validateRefreshTokenSecurity')
        .mockResolvedValue(undefined);
      jest.spyOn(service as any, 'generateTokens').mockResolvedValue({
        access_token: 'a',
        refresh_token: 'r',
        token_type: 'Bearer',
        expires_in: 900,
      });

      const result = await service.refreshToken({ refresh_token: 'rt' });

      expectNoAuthOnlyColumns(result.user);
      expect(result.user).toEqual(expect.objectContaining({ id: 1 }));
    });

    it('loginCustomer returns the customer without auth-only columns', async () => {
      mockPrismaService.stores.findUnique.mockResolvedValue({
        id: 10,
        organization_id: 1,
      });
      mockPrismaService.users.findFirst.mockResolvedValue({
        id: 9,
        email: 'cliente@test.com',
        password: await bcrypt.hash('123', 4),
        state: 'active',
        organization_id: 1,
        user_roles: [{ roles: { name: 'customer' } }],
        store_users: [{ store_id: 10 }],
        user_settings: { id: 1, config: {} },
        ...AUTH_ONLY,
      });
      jest.spyOn(service as any, 'generateTokens').mockResolvedValue({
        access_token: 'a',
        refresh_token: 'r',
        token_type: 'Bearer',
        expires_in: 900,
      });
      jest
        .spyOn(service as any, 'createUserSession')
        .mockResolvedValue(undefined);
      jest.spyOn(service as any, 'logLoginAttempt').mockResolvedValue(undefined);

      const result: any = await service.loginCustomer({
        email: 'cliente@test.com',
        password: '123',
        store_id: 10,
      });

      expectNoAuthOnlyColumns(result.user);
      expect(result.user).toEqual(
        expect.objectContaining({ id: 9, email: 'cliente@test.com' }),
      );
      expect(result.access_token).toBe('a');
    });
  });

  /**
   * QUI-1045 — "Inactivo" tiene que valer en todo el dominio auth: una cuenta
   * desactivada, suspendida o archivada no recibe enlace de recuperación, no
   * se reactiva con un enlace público y no inicia ni renueva sesión.
   * `pending_verification` sigue pudiendo fijar su clave (alta de dueños,
   * empleados y clientes creados por terceros).
   */
  describe('cuentas no activas (QUI-1045)', () => {
    const GENERIC =
      'Si el email existe, recibirás instrucciones para restablecer tu contraseña';
    const BLOCKED = ['inactive', 'suspended', 'archived'];
    const NEW_PASSWORD = 'Nueva#Clave2026';
    let oldHash: string;

    /** Filtra como Postgres: el doble respeta `state: { in | notIn }`. */
    function matchesState(filter: any, state: string): boolean {
      if (!filter) return true;
      if (filter.in) return filter.in.includes(state);
      if (filter.notIn) return !filter.notIn.includes(state);
      return filter === state;
    }

    function staffWithState(state: string) {
      return accountRow({
        id: 41,
        email: 'cajero@tienda.com',
        first_name: 'Ana',
        organization_id: 12,
        state,
        user_roles: [{ roles: { name: 'employee', role_permissions: [] } }],
      });
    }

    /** Deja lista la rama de resolución de `forgotPassword` y devuelve su V-link. */
    function arrangeStaffRecovery(
      branch: 'org' | 'store' | 'none',
      account: Record<string, any>,
    ): string | undefined {
      mockPrismaService.users.findMany.mockImplementation(async ({ where }) =>
        matchesState(where.state, account.state) ? [account] : [],
      );
      if (branch === 'org') {
        mockPrismaService.organizations.findUnique.mockResolvedValue({
          id: 12,
        });
        mockPrismaService.users.findFirst.mockResolvedValue(account);
        return 'org-a';
      }
      if (branch === 'store') {
        mockPrismaService.organizations.findUnique.mockResolvedValue(null);
        mockPrismaService.stores.findMany.mockResolvedValue([
          { organization_id: 12 },
        ]);
        return 'mi-tienda';
      }
      return undefined;
    }

    function arrangeResetToken(state: string, user: Record<string, any> = {}) {
      mockPrismaService.password_reset_tokens.findUnique.mockResolvedValue({
        id: 5,
        token: 'tok',
        used: false,
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        user_id: 41,
        users: {
          id: 41,
          organization_id: 12,
          state,
          email_verified: true,
          password: oldHash,
          ...user,
        },
      });
    }

    function arrangeCustomerRecovery(state: string) {
      mockPrismaService.stores.findUnique.mockResolvedValue({
        id: 22,
        organization_id: 12,
        name: 'Mi Tienda',
      });
      mockPrismaService.users.findFirst.mockResolvedValue({
        id: 77,
        email: 'cliente@x.com',
        first_name: 'Luis',
        state,
        user_roles: [{ roles: { name: 'customer' } }],
        store_users: [],
      });
    }

    beforeAll(async () => {
      oldHash = await bcrypt.hash('Vieja#Clave2025', 4);
    });

    beforeEach(() => {
      mockPrismaService.organizations.findUnique.mockReset();
      mockPrismaService.users.findFirst.mockReset();
      mockPrismaService.users.findMany.mockReset().mockResolvedValue([]);
      mockPrismaService.users.update.mockReset().mockResolvedValue({});
      mockPrismaService.stores.findMany.mockReset().mockResolvedValue([]);
      mockPrismaService.stores.findUnique.mockReset();
      mockPrismaService.store_users.findFirst.mockReset();
      mockPrismaService.user_roles.findFirst.mockReset();
      mockPrismaService.login_attempts.create.mockReset().mockResolvedValue({});
      mockPrismaService.password_reset_tokens.create
        .mockReset()
        .mockResolvedValue({});
      mockPrismaService.password_reset_tokens.updateMany
        .mockReset()
        .mockResolvedValue({ count: 1 });
      mockPrismaService.password_reset_tokens.update
        .mockReset()
        .mockResolvedValue({});
      mockPrismaService.password_reset_tokens.findUnique.mockReset();
      mockPrismaService.email_verification_tokens.findUnique.mockReset();
      mockPrismaService.email_verification_tokens.update
        .mockReset()
        .mockResolvedValue({});
      mockPrismaService.refresh_tokens.findFirst.mockReset();
      mockPrismaService.refresh_tokens.deleteMany
        .mockReset()
        .mockResolvedValue({ count: 0 });
      mockPrismaService.$transaction.mockImplementation((arg) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(mockPrismaService),
      );
      mockEmailService.sendPasswordResetEmail
        .mockReset()
        .mockResolvedValue({ success: true });
      mockAuditService.logAuth.mockClear();
      jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      mockConfigService.get.mockReset();
      jest.restoreAllMocks();
    });

    describe.each(['org', 'store', 'none'] as const)(
      'forgotPassword de staff (rama V-link %s)',
      (branch) => {
        it.each(BLOCKED)(
          '%s: mismo mensaje genérico, sin token ni correo',
          async (state) => {
            const vlink = arrangeStaffRecovery(branch, staffWithState(state));

            const result = await service.forgotPassword(
              'cajero@tienda.com',
              vlink,
            );

            expect(result).toEqual({ message: GENERIC });
            expect(
              mockPrismaService.password_reset_tokens.updateMany,
            ).not.toHaveBeenCalled();
            expect(
              mockPrismaService.password_reset_tokens.create,
            ).not.toHaveBeenCalled();
            expect(
              mockEmailService.sendPasswordResetEmail,
            ).not.toHaveBeenCalled();
            expect(mockAuditService.logAuth).not.toHaveBeenCalled();
          },
        );

        it.each(['active', 'pending_verification'])(
          '%s: sí recibe el enlace',
          async (state) => {
            const vlink = arrangeStaffRecovery(branch, staffWithState(state));

            const result = await service.forgotPassword(
              'cajero@tienda.com',
              vlink,
            );

            expect(result).toEqual({ message: GENERIC });
            expect(
              mockPrismaService.password_reset_tokens.create,
            ).toHaveBeenCalledWith(
              expect.objectContaining({
                data: expect.objectContaining({ user_id: 41 }),
              }),
            );
            expect(
              mockEmailService.sendPasswordResetEmail,
            ).toHaveBeenCalledWith(
              'cajero@tienda.com',
              expect.any(String),
              'Ana',
              undefined,
            );
          },
        );
      },
    );

    it.each(['org', 'store', 'none'] as const)(
      'forgotPassword (rama V-link %s) deja en el log el estado suprimido, sin el correo',
      async (branch) => {
        const vlink = arrangeStaffRecovery(branch, staffWithState('inactive'));
        const warn = (service as any).logger.warn as jest.Mock;

        await service.forgotPassword('cajero@tienda.com', vlink);

        expect(warn).toHaveBeenCalledWith(
          expect.stringMatching(/user 41 .*inactive/),
        );
        expect(warn).not.toHaveBeenCalledWith(
          expect.stringContaining('cajero@tienda.com'),
        );
      },
    );

    it('forgotPassword no registra supresión para un correo desconocido', async () => {
      const warn = (service as any).logger.warn as jest.Mock;

      await expect(service.forgotPassword('nadie@x.com')).resolves.toEqual({
        message: GENERIC,
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it('forgotPassword responde el mensaje genérico aunque falle la consulta del log', async () => {
      mockPrismaService.users.findMany
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.forgotPassword('cajero@tienda.com'),
      ).resolves.toEqual({ message: GENERIC });
    });

    it('resetPassword: pending_verification fija la clave sin cambiar su estado', async () => {
      arrangeResetToken('pending_verification');

      await expect(service.resetPassword('tok', NEW_PASSWORD)).resolves.toEqual(
        { message: 'Contraseña restablecida exitosamente' },
      );
      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { id: 41 },
        data: {
          password: expect.any(String),
          failed_login_attempts: 0,
          locked_until: null,
        },
      });
    });

    it('resetPassword: active sigue fijando la clave', async () => {
      arrangeResetToken('active');

      await expect(service.resetPassword('tok', NEW_PASSWORD)).resolves.toEqual(
        { message: 'Contraseña restablecida exitosamente' },
      );
      expect(mockPrismaService.users.update).toHaveBeenCalledTimes(1);
    });

    it.each(BLOCKED)(
      'resetPassword: %s sigue rechazado con AUTH_FIND_001',
      async (state) => {
        arrangeResetToken(state);

        await expect(
          service.resetPassword('tok', NEW_PASSWORD),
        ).rejects.toMatchObject({ errorCode: 'AUTH_FIND_001' });
        expect(mockPrismaService.users.update).not.toHaveBeenCalled();
      },
    );

    it.each(BLOCKED)(
      'forgotPasswordCustomer: %s no recibe token (mismo mensaje genérico)',
      async (state) => {
        arrangeCustomerRecovery(state);

        await expect(
          service.forgotPasswordCustomer('cliente@x.com', 22),
        ).resolves.toEqual({ message: GENERIC });
        expect(
          mockPrismaService.password_reset_tokens.updateMany,
        ).not.toHaveBeenCalled();
        expect(
          mockPrismaService.password_reset_tokens.create,
        ).not.toHaveBeenCalled();
        expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
      },
    );

    it('forgotPasswordCustomer: el log de supresión no lleva el correo', async () => {
      arrangeCustomerRecovery('inactive');
      const warn = (service as any).logger.warn as jest.Mock;

      await service.forgotPasswordCustomer('cliente@x.com', 22);

      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/user 77 .*inactive/),
      );
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('cliente@x.com'),
      );
    });

    it('forgotPasswordCustomer: pending_verification sí recibe el enlace', async () => {
      arrangeCustomerRecovery('pending_verification');

      await service.forgotPasswordCustomer('cliente@x.com', 22);

      expect(
        mockPrismaService.password_reset_tokens.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: 77 }),
        }),
      );
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    });

    it.each(['inactive', 'suspended'])(
      'resetCustomerPassword: %s no se reactiva y el enlace queda usado',
      async (state) => {
        arrangeResetToken(state, { email_verified: false });
        mockPrismaService.user_roles.findFirst.mockResolvedValue({ id: 1 });

        await expect(
          service.resetCustomerPassword('tok', NEW_PASSWORD, 22),
        ).rejects.toMatchObject({ errorCode: 'AUTH_TOKEN_001' });
        expect(mockPrismaService.users.update).not.toHaveBeenCalled();
        expect(
          mockPrismaService.password_reset_tokens.updateMany,
        ).toHaveBeenCalledWith({
          where: { id: 5, used: false },
          data: { used: true },
        });
      },
    );

    it('resetCustomerPassword: archived conserva AUTH_CUSTOMER_ARCHIVED_001', async () => {
      arrangeResetToken('archived', { email_verified: false });
      mockPrismaService.user_roles.findFirst.mockResolvedValue({ id: 1 });

      await expect(
        service.resetCustomerPassword('tok', NEW_PASSWORD, 22),
      ).rejects.toMatchObject({ errorCode: 'AUTH_CUSTOMER_ARCHIVED_001' });
      expect(mockPrismaService.users.update).not.toHaveBeenCalled();
    });

    it('resetCustomerPassword: pending_verification sí se activa', async () => {
      arrangeResetToken('pending_verification', { email_verified: false });
      mockPrismaService.user_roles.findFirst.mockResolvedValue({ id: 1 });
      mockPrismaService.stores.findUnique.mockResolvedValue({
        organization_id: 12,
      });
      mockPrismaService.store_users.findFirst.mockResolvedValue({ id: 3 });

      await expect(
        service.resetCustomerPassword('tok', NEW_PASSWORD, 22),
      ).resolves.toEqual({
        message: 'Cuenta activada y contraseña restablecida exitosamente',
        activated: true,
      });
      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { id: 41 },
        data: expect.objectContaining({
          state: 'active',
          email_verified: true,
        }),
      });
    });

    it('login: una cuenta inactive no entra, igual que suspended/archived', async () => {
      const inactive = accountRow({
        email: 'owner@test.com',
        password: await bcrypt.hash('123', 4),
        state: 'inactive',
        user_roles: [{ roles: { name: 'owner', role_permissions: [] } }],
      });
      mockPrismaService.users.findMany.mockImplementation(async ({ where }) =>
        matchesState(where.state, inactive.state) ? [inactive] : [],
      );

      await expect(
        service.login({ email: 'owner@test.com', password: '123' }),
      ).rejects.toMatchObject({ errorCode: 'AUTH_CREDENTIALS_001' });
      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            state: { notIn: ['inactive', 'suspended', 'archived'] },
          }),
        }),
      );
    });

    it.each(BLOCKED)(
      'login: la segunda barrera rechaza %s aunque la consulta lo devuelva',
      async (state) => {
        mockPrismaService.users.findMany.mockResolvedValue([
          accountRow({
            email: 'owner@test.com',
            password: await bcrypt.hash('123', 4),
            state,
            user_roles: [{ roles: { name: 'owner', role_permissions: [] } }],
          }),
        ]);
        const generate = jest.spyOn(service as any, 'generateTokens');

        await expect(
          service.login({ email: 'owner@test.com', password: '123' }),
        ).rejects.toMatchObject({ errorCode: 'AUTH_VALIDATE_001' });
        expect(generate).not.toHaveBeenCalled();
      },
    );

    it('login: pending_verification sigue resolviendo su cuenta', async () => {
      const pending = accountRow({
        email: 'owner@test.com',
        state: 'pending_verification',
        user_roles: [{ roles: { name: 'owner', role_permissions: [] } }],
      });
      mockPrismaService.users.findMany.mockImplementation(async ({ where }) =>
        matchesState(where.state, pending.state) ? [pending] : [],
      );

      const lookup = await service.findUserAccountsByEmail('owner@test.com');

      expect(lookup.matchType).toBe('single_account');
      expect(lookup.user?.id).toBe(1);
    });

    it('loginCustomer: inactive con la clave correcta no recibe sesión', async () => {
      mockPrismaService.stores.findUnique.mockResolvedValue({
        id: 22,
        organization_id: 12,
      });
      mockPrismaService.users.findFirst.mockResolvedValue({
        id: 77,
        email: 'cliente@x.com',
        password: await bcrypt.hash('123', 4),
        state: 'inactive',
        user_roles: [{ roles: { name: 'customer' } }],
        store_users: [{ id: 1 }],
        organizations: { domain_settings: [] },
      });
      const generate = jest.spyOn(service as any, 'generateTokens');

      await expect(
        service.loginCustomer({
          email: 'cliente@x.com',
          password: '123',
          store_id: 22,
        }),
      ).rejects.toMatchObject({
        status: 401,
        message: 'Cuenta suspendida o archivada',
      });
      expect(generate).not.toHaveBeenCalled();
    });

    function arrangeRefresh(state: string) {
      mockConfigService.get.mockReturnValue('secret');
      mockJwtService.verify.mockReturnValue({ sub: 41, organization_id: 12 });
      mockPrismaService.refresh_tokens.findFirst.mockResolvedValue({
        id: 9,
        user_id: 41,
        users: { id: 41, organization_id: 12, state, user_roles: [] },
      });
      jest
        .spyOn(service as any, 'validateRefreshTokenSecurity')
        .mockResolvedValue(undefined);
    }

    it.each(BLOCKED)(
      'refreshToken: una sesión de una cuenta %s no se renueva',
      async (state) => {
        arrangeRefresh(state);
        const generate = jest.spyOn(service as any, 'generateTokens');

        await expect(
          service.refreshToken({ refresh_token: 'rt' } as any),
        ).rejects.toMatchObject({ errorCode: 'AUTH_TOKEN_001' });
        expect(generate).not.toHaveBeenCalled();
      },
    );

    it('refreshToken: pending_verification sí renueva', async () => {
      arrangeRefresh('pending_verification');
      // Se corta justo al emitir: basta con saber que llegó a generar tokens.
      const generate = jest
        .spyOn(service as any, 'generateTokens')
        .mockRejectedValue(new Error('emitido'));

      await expect(
        service.refreshToken({ refresh_token: 'rt' } as any),
      ).rejects.toMatchObject({ errorCode: 'AUTH_TOKEN_001' });
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 41 }),
        expect.anything(),
      );
    });

    function arrangeEmailVerification(state: string) {
      mockPrismaService.email_verification_tokens.findUnique.mockResolvedValue({
        id: 3,
        user_id: 41,
        verified: false,
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        users: { id: 41, state },
      });
    }

    it.each(BLOCKED)(
      'verifyEmail: %s verifica el correo pero no se reactiva',
      async (state) => {
        arrangeEmailVerification(state);

        await service.verifyEmail('vt');

        expect(mockPrismaService.users.update).toHaveBeenCalledWith({
          where: { id: 41 },
          data: { email_verified: true },
        });
      },
    );

    it('verifyEmail: pending_verification se activa', async () => {
      arrangeEmailVerification('pending_verification');

      await service.verifyEmail('vt');

      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { id: 41 },
        data: { email_verified: true, state: 'active' },
      });
    });

    function arrangeExistingCustomer(state: string) {
      mockPrismaService.stores.findUnique.mockResolvedValue({
        id: 22,
        organization_id: 12,
      });
      mockPrismaService.users.findFirst.mockResolvedValue({ id: 77, state });
      mockPrismaService.user_roles.findFirst.mockResolvedValue({ id: 1 });
      mockPrismaService.store_users.findFirst.mockResolvedValue(null);
    }

    it.each(BLOCKED)(
      'registerCustomer: un cliente %s no recibe la invitación a reclamar la cuenta',
      async (state) => {
        arrangeExistingCustomer(state);

        await expect(
          service.registerCustomer({
            email: 'cliente@x.com',
            first_name: 'Luis',
            last_name: 'P',
            store_id: 22,
          } as any),
          // AUTH_CUSTOMER_CLAIMABLE_001 también es 409: lo que distingue es la
          // clase (el 409 genérico de "ya existe"), no el status.
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it('registerCustomer: pending_verification sí recibe AUTH_CUSTOMER_CLAIMABLE_001', async () => {
      arrangeExistingCustomer('pending_verification');

      await expect(
        service.registerCustomer({
          email: 'cliente@x.com',
          first_name: 'Luis',
          last_name: 'P',
          store_id: 22,
        } as any),
      ).rejects.toMatchObject({ errorCode: 'AUTH_CUSTOMER_CLAIMABLE_001' });
    });
  });

  describe('updateProfile document_type (identification_type_enum)', () => {
    beforeEach(() => {
      mockPrismaService.users.update.mockReset();
      mockPrismaService.users.update.mockResolvedValue({ id: 7 });
      jest
        .spyOn(service, 'getProfile')
        .mockResolvedValue({ id: 7 } as any);
    });

    afterEach(() => jest.restoreAllMocks());

    it.each(['cc', 'CC', 'Cc', ' cc '])(
      'normalizes %p to CC and saves the whole profile',
      async (document_type) => {
        await service.updateProfile(7, {
          first_name: 'Rafael',
          last_name: 'M',
          phone: '3001234567',
          document_type,
          document_number: '1234567890',
        });

        expect(mockPrismaService.users.update).toHaveBeenCalledWith({
          where: { id: 7 },
          data: {
            first_name: 'Rafael',
            last_name: 'M',
            phone: '3001234567',
            document_type: 'CC',
            document_number: '1234567890',
          },
        });
      },
    );

    it.each(['X', 'C.C.'])(
      'rejects %p with a clear Spanish error and writes nothing',
      async (document_type) => {
        await expect(
          service.updateProfile(7, { document_type }),
        ).rejects.toThrow(
          'Tipo de documento no válido. Usa CC, CE, NIT, TI, RC, PA, PEP, PPT, DIE o NUIP.',
        );
        expect(mockPrismaService.users.update).not.toHaveBeenCalled();
      },
    );

    it.each([null, '', '   '])('clears document_type when sent %p', async (value) => {
      await service.updateProfile(7, {
        document_type: value,
        document_number: value,
      });

      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { document_type: null, document_number: null },
      });
    });
  });
});
