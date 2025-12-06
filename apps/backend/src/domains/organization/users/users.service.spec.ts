import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../../../email/email.service';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

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
    },
    email_verification_tokens: {
      deleteMany: jest.fn(),
    },
    user_settings: {
      findFirst: jest.fn(),
    },
  };

  const mockAuditService = {
    log: jest.fn(),
  };

  const mockEmailService = {
    sendEmailVerificationEmail: jest.fn(),
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
          updated_at: expect.any(Date),
        },
      });

      expect(
        prismaService.email_verification_tokens.deleteMany,
      ).toHaveBeenCalledWith({
        where: { user_id: userId },
      });

      expect(auditService.log).toHaveBeenCalledWith(
        'USER_EMAIL_VERIFIED',
        userId,
        expect.objectContaining({
          action: 'verify_email',
          old_state: 'pending_verification',
          new_state: 'active',
        }),
      );

      expect(result).toEqual({
        ...mockUserWithPendingState,
        state: 'active',
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      const userId = 999;

      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.verifyEmail(userId)).rejects.toThrow(
        NotFoundException,
      );

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
          password_hash: expect.any(String), // Should be hashed
          updated_at: expect.any(Date),
        },
      });

      expect(auditService.log).toHaveBeenCalledWith(
        'USER_PASSWORD_RESET',
        userId,
        expect.objectContaining({
          action: 'reset_password',
          reset_by_admin: true,
        }),
      );

      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      const userId = 999;

      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword(userId, resetPasswordDto),
      ).rejects.toThrow(NotFoundException);

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

      // Mock bcrypt to throw an error
      jest.doMock('bcrypt', () => ({
        hash: jest.fn().mockRejectedValue(new Error('Hashing failed')),
      }));

      await expect(
        service.resetPassword(userId, resetPasswordDto),
      ).rejects.toThrow();
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

      expect(auditService.log).toHaveBeenCalledTimes(2);
      expect(auditService.log).toHaveBeenCalledWith(
        'USER_EMAIL_VERIFIED',
        userId,
        expect.any(Object),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        'USER_PASSWORD_RESET',
        userId,
        expect.any(Object),
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
