import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../../email/email.service';
import { AuditService } from '../audit/audit.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import {
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('AuthService - Owner Registration Flow', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let emailService: EmailService;
  let jwtService: JwtService;
  let auditService: AuditService;

  const mockPrismaService = {
    organizations: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    users: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    roles: {
      findFirst: jest.fn(),
    },
    user_roles: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    user_settings: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    email_verification_tokens: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    refresh_tokens: {
      create: jest.fn(),
    },
    login_attempts: {
      create: jest.fn(),
    },
    store_users: {
      findFirst: jest.fn(),
    },
    stores: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  const mockEmailService = {
    sendVerificationEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(() => 'mock-access-token'),
    verify: jest.fn(() => ({ sub: 1, organization_id: 1, store_id: null })),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config = {
        JWT_SECRET: 'test-secret',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        JWT_REFRESH_EXPIRES_IN: '7d',
      };
      return config[key];
    }),
  };

  const mockAuditService = {
    logCreate: jest.fn(),
    logAuth: jest.fn(),
    logUpdate: jest.fn(),
  };

  const mockOnboardingService = {
    getUserOnboardingStatus: jest.fn(),
  };

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
    emailService = module.get<EmailService>(EmailService);
    jwtService = module.get<JwtService>(JwtService);
    auditService = module.get<AuditService>(AuditService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('registerOwner', () => {
    const validOwnerData = {
      organization_name: 'Test Organization',
      email: 'owner@test.com',
      password: 'Password@123',
      first_name: 'John',
      last_name: 'Doe',
      phone: '+1234567890',
    };

    const clientInfo = {
      ip_address: '127.0.0.1',
      user_agent: 'Test-Agent',
    };

    it('should register owner successfully with complete flow', async () => {
      // Arrange
      const hashedPassword = await bcrypt.hash(validOwnerData.password, 12);
      const mockOrganization = {
        id: 1,
        name: validOwnerData.organization_name,
        slug: 'test-organization',
        email: validOwnerData.email,
        state: 'draft',
      };
      const mockUser = {
        id: 1,
        email: validOwnerData.email,
        first_name: validOwnerData.first_name,
        last_name: validOwnerData.last_name,
        password: hashedPassword,
        email_verified: false,
        organization_id: 1,
        username: 'owner@test.com',
        user_roles: [
          {
            roles: {
              name: 'owner',
              role_permissions: { permissions: [] },
            },
          },
        ],
      };
      const mockUserSettings = {
        user_id: 1,
        config: {
          app: 'ORG_ADMIN',
          panel_ui: {
            stores: true,
            users: true,
            dashboard: true,
            orders: true,
            analytics: true,
            reports: true,
            inventory: true,
            billing: true,
            ecommerce: true,
            audit: true,
            settings: true,
          },
        },
      };
      const mockOwnerRole = { id: 1, name: 'owner' };

      mockPrismaService.organizations.findUnique
        .mockResolvedValueOnce(null) // First call: check if org exists by slug
        .mockResolvedValueOnce({ slug: 'test-organization' }); // Second call: get org for email service
      mockPrismaService.users.findFirst.mockResolvedValue(null); // No existing user
      mockPrismaService.roles.findFirst.mockResolvedValue(mockOwnerRole);
      mockPrismaService.organizations.create.mockResolvedValue(
        mockOrganization,
      );
      mockPrismaService.users.create.mockResolvedValue(mockUser);
      mockPrismaService.user_settings.create.mockResolvedValue(
        mockUserSettings,
      );
      mockPrismaService.user_roles.findFirst.mockResolvedValue(null);
      mockPrismaService.user_roles.create.mockResolvedValue({});
      mockPrismaService.users.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.email_verification_tokens.create.mockResolvedValue({});
      mockPrismaService.refresh_tokens.create.mockResolvedValue({});
      mockPrismaService.login_attempts.create.mockResolvedValue({});
      mockPrismaService.user_settings.findUnique.mockResolvedValue(
        mockUserSettings,
      );

      // Act
      const result = await service.registerOwner(validOwnerData, clientInfo);

      // Assert
      expect(result).toBeDefined();
      expect(result.user.email).toBe(validOwnerData.email);
      expect(result.user.first_name).toBe(validOwnerData.first_name);
      expect(result.user.last_name).toBe(validOwnerData.last_name);
      expect(result.user.email_verified).toBe(false);
      expect(result.user.roles).toContain('owner');
      expect(result.access_token).toBe('mock-access-token');
      expect(result.refresh_token).toBeDefined();
      expect(result.wasExistingUser).toBe(false);

      // Verify service calls
      expect(mockPrismaService.organizations.findUnique).toHaveBeenCalledWith({
        where: { slug: 'test-organization' },
      });
      expect(mockPrismaService.organizations.create).toHaveBeenCalledWith({
        data: {
          name: validOwnerData.organization_name,
          slug: 'test-organization',
          email: validOwnerData.email,
          state: 'draft',
        },
      });
      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledWith(
        validOwnerData.email,
        expect.any(String),
        'John Doe',
        'test-organization',
      );
      expect(mockAuditService.logCreate).toHaveBeenCalledTimes(2);
    });

    it('should throw ConflictException if organization already exists', async () => {
      // Arrange
      const existingOrg = {
        id: 1,
        name: 'Existing Org',
        slug: 'test-organization',
      };
      mockPrismaService.organizations.findUnique.mockResolvedValue(existingOrg);

      // Act & Assert
      await expect(
        service.registerOwner(validOwnerData, clientInfo),
      ).rejects.toThrow(ConflictException);

      expect(mockPrismaService.organizations.findUnique).toHaveBeenCalledWith({
        where: { slug: 'test-organization' },
      });
    });

    it('should throw ConflictException if user has pending onboarding', async () => {
      // Arrange
      const existingUser = {
        id: 1,
        email: validOwnerData.email,
        organization_id: 1,
        user_roles: [{ roles: { name: 'owner' } }],
        organizations: { onboarding: false },
      };
      const existingOrg = {
        id: 1,
        name: 'Pending Org',
        slug: 'pending-org',
        email: validOwnerData.email,
        state: 'draft',
        created_at: new Date(),
      };

      mockPrismaService.organizations.findUnique
        .mockResolvedValueOnce(null) // First call: check if org exists by slug
        .mockResolvedValueOnce(existingOrg); // Second call: get org details for error response
      mockPrismaService.users.findFirst.mockResolvedValue(existingUser);

      // Act & Assert
      await expect(
        service.registerOwner(validOwnerData, clientInfo),
      ).rejects.toThrow(ConflictException);

      expect(mockPrismaService.users.findFirst).toHaveBeenCalledWith({
        where: {
          email: validOwnerData.email,
          organizations: { onboarding: false },
          user_roles: {
            some: { roles: { name: 'owner' } },
          },
        },
        include: {
          user_roles: { include: { roles: true } },
        },
      });
    });

    it('should throw BadRequestException if owner role not found', async () => {
      // Arrange
      mockPrismaService.organizations.findUnique.mockResolvedValue(null);
      mockPrismaService.users.findFirst.mockResolvedValue(null);
      mockPrismaService.roles.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.registerOwner(validOwnerData, clientInfo),
      ).rejects.toThrow(new BadRequestException('Rol de owner no encontrado'));
    });

    it('should handle email service failure gracefully', async () => {
      // Arrange
      const hashedPassword = await bcrypt.hash(validOwnerData.password, 12);
      const mockOrganization = {
        id: 1,
        name: validOwnerData.organization_name,
        slug: 'test-organization',
        email: validOwnerData.email,
        state: 'draft',
      };
      const mockUser = {
        id: 1,
        email: validOwnerData.email,
        first_name: validOwnerData.first_name,
        last_name: validOwnerData.last_name,
        password: hashedPassword,
        email_verified: false,
        organization_id: 1,
        username: 'owner@test.com',
        user_roles: [
          {
            roles: {
              name: 'owner',
              role_permissions: { permissions: [] },
            },
          },
        ],
      };
      const mockUserSettings = {
        user_id: 1,
        config: { app: 'ORG_ADMIN', panel_ui: {} },
      };
      const mockOwnerRole = { id: 1, name: 'owner' };

      mockPrismaService.organizations.findUnique.mockResolvedValue(null);
      mockPrismaService.users.findFirst.mockResolvedValue(null);
      mockPrismaService.roles.findFirst.mockResolvedValue(mockOwnerRole);
      mockPrismaService.organizations.create.mockResolvedValue(
        mockOrganization,
      );
      mockPrismaService.users.create.mockResolvedValue(mockUser);
      mockPrismaService.user_settings.create.mockResolvedValue(
        mockUserSettings,
      );
      mockPrismaService.user_roles.findFirst.mockResolvedValue(null);
      mockPrismaService.user_roles.create.mockResolvedValue({});
      mockPrismaService.users.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.email_verification_tokens.create.mockResolvedValue({});
      mockPrismaService.refresh_tokens.create.mockResolvedValue({});
      mockPrismaService.login_attempts.create.mockResolvedValue({});
      mockPrismaService.user_settings.findUnique.mockResolvedValue(
        mockUserSettings,
      );

      // Mock email service to throw error
      mockEmailService.sendVerificationEmail.mockRejectedValue(
        new Error('Email service failed'),
      );

      // Act
      const result = await service.registerOwner(validOwnerData, clientInfo);

      // Assert - Should still complete registration despite email failure
      expect(result).toBeDefined();
      expect(result.user.email).toBe(validOwnerData.email);
      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    const validToken = 'valid-verification-token';
    const expiredToken = 'expired-verification-token';
    const invalidToken = 'invalid-verification-token';

    it('should verify email successfully', async () => {
      // Arrange
      const mockVerificationToken = {
        id: 1,
        token: validToken,
        user_id: 1,
        verified: false,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
        users: {
          id: 1,
          email: 'owner@test.com',
          state: 'inactive',
        },
      };

      mockPrismaService.email_verification_tokens.findUnique.mockResolvedValue(
        mockVerificationToken,
      );
      mockPrismaService.email_verification_tokens.update.mockResolvedValue({});
      mockPrismaService.users.update.mockResolvedValue({});

      // Act
      const result = await service.verifyEmail(validToken);

      // Assert
      expect(result).toEqual({ message: 'Email verificado exitosamente' });
      expect(
        mockPrismaService.email_verification_tokens.findUnique,
      ).toHaveBeenCalledWith({
        where: { token: validToken },
        include: { users: true },
      });
      expect(
        mockPrismaService.email_verification_tokens.update,
      ).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { verified: true },
      });
      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          email_verified: true,
          state: 'active',
        },
      });
    });

    it('should throw BadRequestException for invalid token', async () => {
      // Arrange
      mockPrismaService.email_verification_tokens.findUnique.mockResolvedValue(
        null,
      );

      // Act & Assert
      await expect(service.verifyEmail(invalidToken)).rejects.toThrow(
        new BadRequestException('Token de verificación inválido'),
      );
    });

    it('should throw BadRequestException for already used token', async () => {
      // Arrange
      const mockVerificationToken = {
        id: 1,
        token: validToken,
        user_id: 1,
        verified: true, // Already used
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        users: { id: 1, email: 'owner@test.com' },
      };

      mockPrismaService.email_verification_tokens.findUnique.mockResolvedValue(
        mockVerificationToken,
      );

      // Act & Assert
      await expect(service.verifyEmail(validToken)).rejects.toThrow(
        new BadRequestException('Token ya utilizado'),
      );
    });

    it('should throw BadRequestException for expired token', async () => {
      // Arrange
      const mockVerificationToken = {
        id: 1,
        token: expiredToken,
        user_id: 1,
        verified: false,
        expires_at: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago (expired)
        users: { id: 1, email: 'owner@test.com' },
      };

      mockPrismaService.email_verification_tokens.findUnique.mockResolvedValue(
        mockVerificationToken,
      );

      // Act & Assert
      await expect(service.verifyEmail(expiredToken)).rejects.toThrow(
        new BadRequestException('Token expirado'),
      );
    });
  });

  describe('resendEmailVerification', () => {
    const testEmail = 'owner@test.com';

    it('should resend verification email successfully', async () => {
      // Arrange
      const mockUser = {
        id: 1,
        email: testEmail,
        first_name: 'John',
        email_verified: false,
        organization_id: 1,
      };

      mockPrismaService.users.findFirst.mockResolvedValue(mockUser);
      mockPrismaService.email_verification_tokens.updateMany.mockResolvedValue(
        {},
      );
      mockPrismaService.email_verification_tokens.create.mockResolvedValue({});
      mockPrismaService.organizations.findUnique.mockResolvedValue({
        slug: 'test-org',
      });
      mockEmailService.sendVerificationEmail.mockResolvedValue({
        success: true,
      });
      mockEmailService.sendWelcomeEmail.mockResolvedValue({ success: true });

      // Mock sendEmailVerification method
      jest.spyOn(service, 'sendEmailVerification').mockResolvedValue(undefined);

      // Act
      const result = await service.resendEmailVerification(testEmail);

      // Assert
      expect(result).toEqual({ message: 'Email de verificación enviado' });
      expect(mockPrismaService.users.findFirst).toHaveBeenCalledWith({
        where: { email: testEmail },
      });
      expect(service.sendEmailVerification).toHaveBeenCalledWith(1);
    });

    it('should return generic message for non-existent email', async () => {
      // Arrange
      mockPrismaService.users.findFirst.mockResolvedValue(null);

      // Act
      const result = await service.resendEmailVerification(
        'nonexistent@test.com',
      );

      // Assert
      expect(result).toEqual({
        message:
          'Si el email existe y no está verificado, recibirás un nuevo email de verificación',
      });
    });

    it('should throw BadRequestException for already verified email', async () => {
      // Arrange
      const mockUser = {
        id: 1,
        email: testEmail,
        email_verified: true, // Already verified
      };

      mockPrismaService.users.findFirst.mockResolvedValue(mockUser);

      // Act & Assert
      await expect(service.resendEmailVerification(testEmail)).rejects.toThrow(
        new BadRequestException('El email ya está verificado'),
      );
    });
  });
});
