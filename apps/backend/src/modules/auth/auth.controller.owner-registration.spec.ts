import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EnvironmentSwitchService } from './environment-switch.service';
import { ResponseService } from '../../common/responses/response.service';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { Request } from 'express';

describe('AuthController - Owner Registration Flow', () => {
  let controller: AuthController;
  let authService: AuthService;
  let responseService: ResponseService;

  const mockAuthService = {
    registerOwner: jest.fn(),
    verifyEmail: jest.fn(),
    resendEmailVerification: jest.fn(),
  };

  const mockEnvironmentSwitchService = {
    switchEnvironment: jest.fn(),
  };

  const mockResponseService = {
    success: jest.fn(),
    error: jest.fn(),
    created: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        {
          provide: EnvironmentSwitchService,
          useValue: mockEnvironmentSwitchService,
        },
        { provide: ResponseService, useValue: mockResponseService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
    responseService = module.get<ResponseService>(ResponseService);

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

    const mockRequest = {
      headers: {
        'x-forwarded-for': '192.168.1.1',
      },
      ip: '127.0.0.1',
      get: jest.fn((header: string) => {
        if (header === 'user-agent') return 'Test-Agent/1.0';
        return null;
      }),
    } as unknown as Request;

    it('should register owner successfully and return success response', async () => {
      // Arrange
      const expectedResult = {
        user: {
          id: 1,
          email: validOwnerData.email,
          first_name: validOwnerData.first_name,
          last_name: validOwnerData.last_name,
          email_verified: false,
          roles: ['owner'],
        },
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
        wasExistingUser: false,
      };

      mockAuthService.registerOwner.mockResolvedValue(expectedResult);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: expectedResult,
        message: 'Bienvenido a Vendix! Tu organización ha sido creada.',
      });

      // Act
      const result = await controller.registerOwner(
        validOwnerData,
        mockRequest,
      );

      // Assert
      expect(result).toBeDefined();
      expect(mockAuthService.registerOwner).toHaveBeenCalledWith(
        validOwnerData,
        {
          ip_address: '192.168.1.1',
          user_agent: 'Test-Agent/1.0',
        },
      );
      expect(mockResponseService.success).toHaveBeenCalledWith(
        expectedResult,
        'Bienvenido a Vendix! Tu organización ha sido creada.',
      );
    });

    it('should handle existing user registration and return error response', async () => {
      // Arrange
      const conflictError = new ConflictException({
        message: 'Ya tienes un onboarding pendiente',
        pendingOnboarding: { id: 1, name: 'Pending Org' },
        user: { id: 1, email: validOwnerData.email },
      });

      mockAuthService.registerOwner.mockRejectedValue(conflictError);
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Ya tienes un registro pendiente. Completa tu onboarding.',
        error: 'Existing user registration pending',
      });

      // Act
      const result = await controller.registerOwner(
        validOwnerData,
        mockRequest,
      );

      // Assert
      expect(result).toBeDefined();
      expect(mockAuthService.registerOwner).toHaveBeenCalledWith(
        validOwnerData,
        {
          ip_address: '192.168.1.1',
          user_agent: 'Test-Agent/1.0',
        },
      );
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Ya tienes un onboarding pendiente',
        'Ya tienes un onboarding pendiente',
        409,
      );
    });

    it('should handle organization already exists error', async () => {
      // Arrange
      const conflictError = new ConflictException(
        'Una organización con este nombre ya existe.',
      );

      mockAuthService.registerOwner.mockRejectedValue(conflictError);
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Una organización con este nombre ya existe.',
        error: 'Una organización con este nombre ya existe.',
        statusCode: 409,
      });

      // Act
      const result = await controller.registerOwner(
        validOwnerData,
        mockRequest,
      );

      // Assert
      expect(result).toBeDefined();
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Una organización con este nombre ya existe.',
        'Una organización con este nombre ya existe.',
        409,
      );
    });

    it('should handle validation errors properly', async () => {
      // Arrange
      const validationError = new BadRequestException('El email es requerido');

      mockAuthService.registerOwner.mockRejectedValue(validationError);
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'El email es requerido',
        error: 'El email es requerido',
        statusCode: 400,
      });

      const invalidData = { ...validOwnerData, email: '' };

      // Act
      const result = await controller.registerOwner(invalidData, mockRequest);

      // Assert
      expect(result).toBeDefined();
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'El email es requerido',
        'El email es requerido',
        400,
      );
    });

    it('should extract client info correctly when x-forwarded-for is array', async () => {
      // Arrange
      const requestWithArrayIp = {
        headers: {
          'x-forwarded-for': ['192.168.1.100', '10.0.0.1'],
        },
        ip: '127.0.0.1',
        get: jest.fn((header: string) => {
          if (header === 'user-agent') return 'Test-Agent/1.0';
          return null;
        }),
      } as unknown as Request;

      const expectedResult = {
        user: { id: 1, email: validOwnerData.email },
        access_token: 'mock-token',
      };

      mockAuthService.registerOwner.mockResolvedValue(expectedResult);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: expectedResult,
        message: 'Bienvenido a Vendix! Tu organización ha sido creada.',
      });

      // Act
      await controller.registerOwner(validOwnerData, requestWithArrayIp);

      // Assert
      expect(mockAuthService.registerOwner).toHaveBeenCalledWith(
        validOwnerData,
        {
          ip_address: '192.168.1.100', // Should take first IP from array
          user_agent: 'Test-Agent/1.0',
        },
      );
    });

    it('should handle missing IP and user agent gracefully', async () => {
      // Arrange
      const minimalRequest = {
        headers: {},
        ip: null,
        get: jest.fn(() => null),
      } as unknown as Request;

      const expectedResult = {
        user: { id: 1, email: validOwnerData.email },
        access_token: 'mock-token',
      };

      mockAuthService.registerOwner.mockResolvedValue(expectedResult);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: expectedResult,
        message: 'Bienvenido a Vendix! Tu organización ha sido creada.',
      });

      // Act
      await controller.registerOwner(validOwnerData, minimalRequest);

      // Assert
      expect(mockAuthService.registerOwner).toHaveBeenCalledWith(
        validOwnerData,
        {
          ip_address: undefined,
          user_agent: undefined,
        },
      );
    });
  });

  describe('verifyEmail', () => {
    const validToken = 'valid-verification-token';

    it('should verify email successfully and return success response', async () => {
      // Arrange
      const expectedResult = { message: 'Email verificado exitosamente' };

      mockAuthService.verifyEmail.mockResolvedValue(expectedResult);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: expectedResult,
        message: 'Email verificado exitosamente',
      });

      // Act
      const result = await controller.verifyEmail({ token: validToken });

      // Assert
      expect(result).toBeDefined();
      expect(mockAuthService.verifyEmail).toHaveBeenCalledWith(validToken);
      expect(mockResponseService.success).toHaveBeenCalledWith(
        expectedResult,
        'Email verificado exitosamente',
      );
    });

    it('should handle invalid token error', async () => {
      // Arrange
      const error = new BadRequestException('Token de verificación inválido');

      mockAuthService.verifyEmail.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Token de verificación inválido',
        error: 'Token de verificación inválido',
        statusCode: 400,
      });

      // Act
      const result = await controller.verifyEmail({ token: 'invalid-token' });

      // Assert
      expect(result).toBeDefined();
      expect(mockAuthService.verifyEmail).toHaveBeenCalledWith('invalid-token');
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Token de verificación inválido',
        'Token de verificación inválido',
        400,
      );
    });

    it('should handle expired token error', async () => {
      // Arrange
      const error = new BadRequestException('Token expirado');

      mockAuthService.verifyEmail.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Token expirado',
        error: 'Token expirado',
        statusCode: 400,
      });

      // Act
      const result = await controller.verifyEmail({ token: 'expired-token' });

      // Assert
      expect(result).toBeDefined();
      expect(mockAuthService.verifyEmail).toHaveBeenCalledWith('expired-token');
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Token expirado',
        'Token expirado',
        400,
      );
    });
  });

  describe('resendVerification', () => {
    const testEmail = 'owner@test.com';

    it('should resend verification email successfully and return success response', async () => {
      // Arrange
      const expectedResult = { message: 'Email de verificación enviado' };

      mockAuthService.resendEmailVerification.mockResolvedValue(expectedResult);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: expectedResult,
        message: 'Email de verificación enviado',
      });

      // Act
      const result = await controller.resendVerification({ email: testEmail });

      // Assert
      expect(result).toBeDefined();
      expect(mockAuthService.resendEmailVerification).toHaveBeenCalledWith(
        testEmail,
      );
      expect(mockResponseService.success).toHaveBeenCalledWith(
        expectedResult,
        'Email de verificación enviado',
      );
    });

    it('should handle already verified email error', async () => {
      // Arrange
      const error = new BadRequestException('El email ya está verificado');

      mockAuthService.resendEmailVerification.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'El email ya está verificado',
        error: 'El email ya está verificado',
        statusCode: 400,
      });

      // Act
      const result = await controller.resendVerification({ email: testEmail });

      // Assert
      expect(result).toBeDefined();
      expect(mockAuthService.resendEmailVerification).toHaveBeenCalledWith(
        testEmail,
      );
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'El email ya está verificado',
        'El email ya está verificado',
        400,
      );
    });

    it('should handle non-existent email gracefully', async () => {
      // Arrange
      const expectedResult = {
        message:
          'Si el email existe y no está verificado, recibirás un nuevo email de verificación',
      };

      mockAuthService.resendEmailVerification.mockResolvedValue(expectedResult);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: expectedResult,
        message:
          'Si el email existe y no está verificado, recibirás un nuevo email de verificación',
      });

      // Act
      const result = await controller.resendVerification({
        email: 'nonexistent@test.com',
      });

      // Assert
      expect(result).toBeDefined();
      expect(mockAuthService.resendEmailVerification).toHaveBeenCalledWith(
        'nonexistent@test.com',
      );
      expect(mockResponseService.success).toHaveBeenCalledWith(
        expectedResult,
        'Si el email existe y no está verificado, recibirás un nuevo email de verificación',
      );
    });
  });
});
