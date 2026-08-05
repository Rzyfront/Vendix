import { Test, TestingModule } from '@nestjs/testing';
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
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

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
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  const mockJwtService = {
    sign: jest.fn(() => 'token'),
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

  it('should throw UnauthorizedException if user does not exist (Invalid Email)', async () => {
    mockPrismaService.users.findMany.mockResolvedValue([]);

    try {
      await service.login({ email: 'wrong@email.com', password: '123' });
      throw new Error('Should have thrown UnauthorizedException');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
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
      expect(error).toBeInstanceOf(UnauthorizedException);
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
      expect(error).toBeInstanceOf(UnauthorizedException);
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
      expect(error).toBeInstanceOf(UnauthorizedException);
    }
  });
});
