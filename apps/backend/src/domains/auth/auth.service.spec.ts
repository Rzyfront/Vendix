import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { GlobalPrismaService as PrismaService } from '../../prisma/services/global-prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../../email/email.service';
import { AuditService } from '../../common/audit/audit.service';
import { OnboardingService } from '../organization/onboarding/onboarding.service';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('AuthService Login Flow', () => {
  let service: AuthService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    users: {
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
    },
    store_users: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    refresh_tokens: {
      create: jest.fn(),
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
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should throw UnauthorizedException if user does not exist (Invalid Email)', async () => {
    mockPrismaService.users.findFirst.mockResolvedValue(null);

    try {
      await service.login({ email: 'wrong@email.com', password: '123' });
      throw new Error('Should have thrown UnauthorizedException');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
    }
  });

  it('should throw UnauthorizedException if organization slug does not match user organization', async () => {
    const user = {
      id: 1,
      email: 'test@test.com',
      password: 'hashed',
      organization_id: 1,
      user_roles: [],
    };
    mockPrismaService.users.findFirst.mockResolvedValue(user);
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
    const user = {
      id: 1,
      email: 'test@test.com',
      password: 'hashed',
      organization_id: 1,
      user_roles: [],
    };
    mockPrismaService.users.findFirst.mockResolvedValue(user);
    mockPrismaService.user_settings.findUnique.mockResolvedValue({
      config: {},
    });
    mockPrismaService.stores.findUnique.mockResolvedValue({
      id: 10,
      slug: 'store-b',
      organization_id: 2, // Different Org ID
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
    const user = {
      id: 1,
      email: 'owner@test.com',
      password: await bcrypt.hash('123', 10),
      organization_id: 1,
      user_roles: [{ roles: { name: 'owner' } }],
      failed_login_attempts: 0,
    };
    mockPrismaService.users.findFirst.mockResolvedValue(user);
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
    const user = {
      id: 2,
      email: 'staff@test.com',
      password: 'hashed',
      organization_id: 1,
      user_roles: [{ roles: { name: 'employee' } }],
    };
    mockPrismaService.users.findFirst.mockResolvedValue(user);
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
