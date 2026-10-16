import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import {
  AuditResource,
  AuditService,
} from '../../../common/audit/audit.service';
import { S3Service } from '@common/services/s3.service';
import { DefaultPanelUIService } from '@common/services/default-panel-ui.service';
import { StaffProvisioningService } from '@common/services/staff-provisioning.service';
import { UserRoleAssignmentService } from '@common/services/user-role-assignment.service';
import { EmailService } from '../../../email/email.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { ConflictException, BadRequestException } from '@nestjs/common';

// Mock the problematic import
jest.mock('../../../prisma/services/organization-prisma.service', () => ({
  OrganizationPrismaService: jest.fn(),
}));

describe('UsersService', () => {
  let service: UsersService;
  let prismaService: OrganizationPrismaService;
  let auditService: AuditService;
  let emailService: EmailService;

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    roles: { findFirst: jest.fn() },
    organizations: { findUnique: jest.fn() },
    user_roles: { findFirst: jest.fn(), create: jest.fn() },
    email_verification_tokens: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    user_settings: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    withoutScope: jest.fn(),
    $transaction: jest.fn(),
  };
  const mockStaffProvisioning = {
    assertEmailAvailableForStaff: jest.fn(),
    provisionStaffMembership: jest.fn(),
  };

  const mockAuditService = {
    log: jest.fn(),
    logUpdate: jest.fn(),
  };

  const mockEmailService = {
    sendEmailVerificationEmail: jest.fn(),
    sendVerificationEmail: jest.fn(),
    sendInvitationEmail: jest.fn(),
  };

  const mockUser = {
    id: 1,
    email: 'test@example.com',
    first_name: 'John',
    last_name: 'Doe',
    state: 'active',
    organization_id: 1,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: OrganizationPrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        {
          provide: S3Service,
          useValue: { signUrl: jest.fn((url) => url) },
        },
        {
          provide: DefaultPanelUIService,
          useValue: { generatePanelUI: jest.fn().mockReturnValue({}) },
        },
        {
          // Alta de personal: el alcance de tienda y la unicidad del email de
          // staff salieron de UsersService a un servicio compartido, porque la
          // misma regla la aplican el panel de organización y el de tienda.
          provide: StaffProvisioningService,
          useValue: mockStaffProvisioning,
        },
        {
          // La asignación de roles también se centralizó: es la que respeta el
          // unique compuesto (rol, organización) del bug QUI-473.
          provide: UserRoleAssignmentService,
          useValue: {
            assign: jest.fn(),
            remove: jest.fn(),
            listUserRoles: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prismaService = module.get<OrganizationPrismaService>(
      OrganizationPrismaService,
    );
    auditService = module.get<AuditService>(AuditService);
    emailService = module.get<EmailService>(EmailService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('email normalization', () => {
    beforeEach(() => {
      mockStaffProvisioning.assertEmailAvailableForStaff.mockReset();
      mockPrismaService.users.findFirst.mockResolvedValue({
        ...mockUser,
        email: 'Test@Example.COM',
        user_roles: [{ roles: { name: 'employee' } }],
      });
      mockPrismaService.users.create.mockResolvedValue(mockUser);
      mockPrismaService.users.update.mockResolvedValue(mockUser);
      mockPrismaService.roles.findFirst.mockResolvedValue({
        id: 2,
        name: 'owner',
      });
      mockPrismaService.user_roles.findFirst.mockResolvedValue(null);
      mockPrismaService.organizations.findUnique.mockResolvedValue({
        slug: 'org',
      });
      mockPrismaService.withoutScope.mockReturnValue(mockPrismaService);
      mockPrismaService.$transaction.mockImplementation((callback) =>
        callback(mockPrismaService),
      );
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        organization_id: 1,
        is_owner: true,
        is_super_admin: false,
      });
    });

    it('normalizes the staff email before availability checks and create', async () => {
      await service.create({
        first_name: 'John',
        last_name: 'Doe',
        username: 'john',
        email: ' Test@Example.COM ',
        password: 'SecurePassword123!',
        role_id: 2,
      });

      expect(
        mockStaffProvisioning.assertEmailAvailableForStaff,
      ).toHaveBeenCalledWith('test@example.com');
      expect(mockPrismaService.users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'test@example.com' }),
        }),
      );
    });

    it('allows a casing-only edit and excludes the current staff account', async () => {
      await service.update(1, { email: ' TEST@EXAMPLE.com ' });

      expect(
        mockStaffProvisioning.assertEmailAvailableForStaff,
      ).toHaveBeenCalledWith('test@example.com', { excludeUserId: 1 });
      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({ email: 'test@example.com' }),
      });
    });

    it('does not update a staff email when the shared availability guard rejects it', async () => {
      mockStaffProvisioning.assertEmailAvailableForStaff.mockRejectedValueOnce(
        new ConflictException('Email already exists'),
      );

      await expect(
        service.update(1, { email: ' Taken@Example.COM ' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrismaService.users.update).not.toHaveBeenCalled();
    });

    it('keeps customer emails organization-local instead of applying the staff guard', async () => {
      mockPrismaService.users.findFirst.mockResolvedValue({
        ...mockUser,
        user_roles: [{ roles: { name: 'customer' } }],
      });

      await service.update(1, { email: ' Customer@Example.COM ' });

      expect(
        mockStaffProvisioning.assertEmailAvailableForStaff,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({ email: 'customer@example.com' }),
      });
    });

    it('normalizes invitations without changing their app or pending state', async () => {
      await service.invite({
        first_name: 'John',
        last_name: 'Doe',
        email: ' Test@Example.COM ',
        app: 'ORG_ADMIN',
      });

      expect(
        mockStaffProvisioning.assertEmailAvailableForStaff,
      ).toHaveBeenCalledWith('test@example.com');
      expect(mockPrismaService.users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'test@example.com',
            state: 'pending_verification',
          }),
        }),
      );
      expect(mockPrismaService.user_settings.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ app_type: 'ORG_ADMIN' }),
      });
    });
  });

  describe('verifyEmail', () => {
    it('should verify user email successfully', async () => {
      const userId = 1;
      const mockUserWithPendingState = {
        ...mockUser,
        state: 'pending_verification',
      };

      mockPrismaService.users.findUnique.mockResolvedValue(
        mockUserWithPendingState,
      );
      mockPrismaService.users.update.mockResolvedValue({
        ...mockUserWithPendingState,
        state: 'active',
      });
      mockPrismaService.email_verification_tokens.deleteMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.verifyEmail(userId);

      expect(prismaService.users.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });

      expect(prismaService.users.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          state: 'active',
          email_verified: true,
          updated_at: expect.any(Date),
        },
      });

      expect(
        prismaService.email_verification_tokens.deleteMany,
      ).toHaveBeenCalledWith({
        where: { user_id: userId },
      });

      expect(auditService.logUpdate).toHaveBeenCalledWith(
        userId,
        AuditResource.USERS,
        userId,
        { state: 'pending_verification' },
        { state: 'active', email_verified: true },
        {
          action: 'verify_email',
          verified_by: 'admin',
        },
      );

      expect(result).toEqual({
        ...mockUserWithPendingState,
        state: 'active',
      });
    });

    it('should throw ORG_USER_001 when user does not exist', async () => {
      const userId = 999;

      mockPrismaService.users.findUnique.mockResolvedValue(null);

      const result = service.verifyEmail(userId);
      await expect(result).rejects.toBeInstanceOf(VendixHttpException);
      await expect(result).rejects.toMatchObject({
        errorCode: ErrorCodes.ORG_USER_001.code,
      });

      expect(prismaService.users.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });

      expect(prismaService.users.update).not.toHaveBeenCalled();
    });

    it('should verify email for user with active state (idempotent)', async () => {
      const userId = 1;

      mockPrismaService.users.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.users.update.mockResolvedValue(mockUser);

      const result = await service.verifyEmail(userId);

      expect(prismaService.users.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          state: 'active',
          email_verified: true,
          updated_at: expect.any(Date),
        },
      });

      expect(result.state).toBe('active');
    });

    it('should verify email for suspended user', async () => {
      const userId = 1;
      const mockSuspendedUser = {
        ...mockUser,
        state: 'suspended',
      };

      mockPrismaService.users.findUnique.mockResolvedValue(mockSuspendedUser);
      mockPrismaService.users.update.mockResolvedValue({
        ...mockSuspendedUser,
        state: 'suspended', // Should remain suspended
      });

      const result = await service.verifyEmail(userId);

      expect(result.state).toBe('suspended');
    });

    it('should handle database errors gracefully', async () => {
      const userId = 1;

      mockPrismaService.users.findUnique.mockRejectedValue(
        new Error('Database connection failed'),
      );

      await expect(service.verifyEmail(userId)).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('resetPassword', () => {
    const resetPasswordDto = {
      new_password: 'NewSecurePassword123!',
      confirm_password: 'NewSecurePassword123!',
    };

    it('should reset user password successfully', async () => {
      const userId = 1;

      mockPrismaService.users.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.users.update.mockResolvedValue(mockUser);

      const result = await service.resetPassword(userId, resetPasswordDto);

      expect(prismaService.users.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });

      expect(prismaService.users.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          // La columna es `password` (ver `schema.prisma`). Esta aserción decía
          // `password_hash` y por eso pasaba en verde con el servicio roto: el
          // mock de Prisma acepta cualquier `data`, así que el test sólo
          // comprobaba que el servicio y el test coincidieran entre sí, no que
          // la columna existiera.
          password: expect.any(String), // Should be hashed
          updated_at: expect.any(Date),
        },
      });

      expect(auditService.logUpdate).toHaveBeenCalledWith(
        userId,
        AuditResource.USERS,
        userId,
        { password: '[REDACTED]' },
        { password: '[REDACTED]' },
        {
          action: 'reset_password',
          reset_by_admin: true,
        },
      );

      expect(result).toEqual(mockUser);
    });

    it('should throw ORG_USER_001 when user does not exist', async () => {
      const userId = 999;

      mockPrismaService.users.findUnique.mockResolvedValue(null);

      const result = service.resetPassword(userId, resetPasswordDto);
      await expect(result).rejects.toBeInstanceOf(VendixHttpException);
      await expect(result).rejects.toMatchObject({
        errorCode: ErrorCodes.ORG_USER_001.code,
      });

      expect(prismaService.users.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when passwords do not match', async () => {
      const userId = 1;
      const invalidDto = {
        new_password: 'Password123!',
        confirm_password: 'DifferentPassword123!',
      };

      await expect(service.resetPassword(userId, invalidDto)).rejects.toThrow(
        BadRequestException,
      );

      expect(prismaService.users.findUnique).not.toHaveBeenCalled();
      expect(prismaService.users.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when password is too short', async () => {
      const userId = 1;
      const invalidDto = {
        new_password: '123',
        confirm_password: '123',
      };

      await expect(service.resetPassword(userId, invalidDto)).rejects.toThrow(
        BadRequestException,
      );

      expect(prismaService.users.findUnique).not.toHaveBeenCalled();
    });

    it('should reset password for archived user', async () => {
      const userId = 1;
      const mockArchivedUser = {
        ...mockUser,
        state: 'archived',
      };

      mockPrismaService.users.findUnique.mockResolvedValue(mockArchivedUser);
      mockPrismaService.users.update.mockResolvedValue(mockArchivedUser);

      const result = await service.resetPassword(userId, resetPasswordDto);

      expect(result.state).toBe('archived');
      expect(prismaService.users.update).toHaveBeenCalled();
    });

    it('should handle password hashing errors', async () => {
      const userId = 1;

      mockPrismaService.users.findUnique.mockResolvedValue(mockUser);

      // The service imports bcryptjs; replacing bcrypt after importing the
      // service never exercised the hashing failure branch.
      jest
        .spyOn(jest.requireActual('bcryptjs'), 'hash')
        .mockRejectedValueOnce(new Error('Hashing failed'));

      await expect(
        service.resetPassword(userId, resetPasswordDto),
      ).rejects.toThrow('Hashing failed');
    });

    it('should handle database errors during password reset', async () => {
      const userId = 1;

      mockPrismaService.users.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.users.update.mockRejectedValue(
        new Error('Database update failed'),
      );

      await expect(
        service.resetPassword(userId, resetPasswordDto),
      ).rejects.toThrow('Database update failed');
    });
  });

  describe('INTEGRATION TESTS', () => {
    it('should handle verifyEmail and resetPassword for same user', async () => {
      const userId = 1;
      const mockUserWithPendingState = {
        ...mockUser,
        state: 'pending_verification',
      };

      // First verify email
      mockPrismaService.users.findUnique.mockResolvedValue(
        mockUserWithPendingState,
      );
      mockPrismaService.users.update.mockResolvedValue({
        ...mockUserWithPendingState,
        state: 'active',
      });
      mockPrismaService.email_verification_tokens.deleteMany.mockResolvedValue({
        count: 1,
      });

      await service.verifyEmail(userId);

      // Then reset password
      mockPrismaService.users.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.users.update.mockResolvedValue(mockUser);

      const resetPasswordDto = {
        new_password: 'NewSecurePassword123!',
        confirm_password: 'NewSecurePassword123!',
      };

      await service.resetPassword(userId, resetPasswordDto);

      expect(auditService.logUpdate).toHaveBeenCalledTimes(2);
      expect(auditService.logUpdate).toHaveBeenCalledWith(
        userId,
        AuditResource.USERS,
        userId,
        { state: 'pending_verification' },
        { state: 'active', email_verified: true },
        { action: 'verify_email', verified_by: 'admin' },
      );
      expect(auditService.logUpdate).toHaveBeenCalledWith(
        userId,
        AuditResource.USERS,
        userId,
        { password: '[REDACTED]' },
        { password: '[REDACTED]' },
        { action: 'reset_password', reset_by_admin: true },
      );
    });

    it('should handle concurrent operations safely', async () => {
      const userId = 1;

      mockPrismaService.users.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.users.update.mockResolvedValue(mockUser);

      const resetPasswordDto = {
        new_password: 'NewSecurePassword123!',
        confirm_password: 'NewSecurePassword123!',
      };

      // Simulate concurrent password resets
      const [result1, result2] = await Promise.all([
        service.resetPassword(userId, resetPasswordDto),
        service.resetPassword(userId, resetPasswordDto),
      ]);

      expect(result1).toEqual(mockUser);
      expect(result2).toEqual(mockUser);
      expect(prismaService.users.update).toHaveBeenCalledTimes(2);
    });
  });
});
