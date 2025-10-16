import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterOwnerDto } from './dto/register-owner.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RegisterStaffDto } from './dto/register-staff.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { ResponseService } from '../../common/responses/response.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('register-owner')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async registerOwner(
    @Body() registerOwnerDto: RegisterOwnerDto,
    @Req() request: Request,
  ) {
    const raw_ip = request.headers['x-forwarded-for'] || request.ip || '';
    const ip_address = Array.isArray(raw_ip) ? raw_ip[0] : String(raw_ip || '');
    const user_agent = request.get('user-agent') || '';
    const client_info = {
      ip_address: ip_address || undefined,
      user_agent: user_agent || undefined,
    };
    const result = await this.authService.registerOwner(
      registerOwnerDto,
      client_info,
    );

    if (result.wasExistingUser) {
      return this.responseService.error(
        'Ya tienes un registro pendiente. Completa tu onboarding.',
        'Existing user registration pending',
      );
    }

    return this.responseService.success(
      result,
      'Bienvenido a Vendix! Tu organización ha sido creada.',
    );
  }

  @Post('register-customer')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async registerCustomer(
    @Body() registerCustomerDto: RegisterCustomerDto,
    @Req() request: Request,
  ) {
    const raw_ip = request.headers['x-forwarded-for'] || request.ip || '';
    const ip_address = Array.isArray(raw_ip) ? raw_ip[0] : String(raw_ip || '');
    const user_agent = request.get('user-agent') || '';
    const client_info = {
      ip_address: ip_address || undefined,
      user_agent: user_agent || undefined,
    };

    const result = await this.authService.registerCustomer(
      registerCustomerDto,
      client_info,
    );
    return this.responseService.success(
      result,
      'Cliente registrado exitosamente en la tienda.',
    );
  }

  @Post('register-staff')
  @HttpCode(HttpStatus.CREATED)
  async registerStaff(
    @Body() registerStaffDto: RegisterStaffDto,
    @CurrentUser() user: any,
  ) {
    const result = await this.authService.registerStaff(
      registerStaffDto,
      user.id,
    );
    return this.responseService.success(result.user, result.message);
  }

  @Public() // ✅ Permitir acceso sin autenticación
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() request: Request) {
    const raw_ip = request.headers['x-forwarded-for'] || request.ip || '';
    const ip_address = Array.isArray(raw_ip) ? raw_ip[0] : String(raw_ip || '');
    const user_agent = request.get('user-agent') || '';
    const client_info = {
      ip_address: ip_address || undefined,
      user_agent: user_agent || undefined,
    };

    try {
      const result = await this.authService.login(loginDto, client_info);
      return this.responseService.success(result, 'Login exitoso');
    } catch (error) {
      return this.responseService.error(
        'Credenciales inválidas',
        'Invalid credentials',
      );
    }
  }

  @Public() // ✅ Permitir renovar token sin autenticación previa
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Req() request: Request,
  ) {
    const raw_ip = request.headers['x-forwarded-for'] || request.ip || '';
    const ip_address = Array.isArray(raw_ip) ? raw_ip[0] : String(raw_ip || '');
    const user_agent = request.get('user-agent') || '';
    const client_info = {
      ip_address: ip_address || undefined,
      user_agent: user_agent || undefined,
    };

    const result = await this.authService.refreshToken(
      refreshTokenDto,
      client_info,
    );
    return this.responseService.success(
      result,
      'Token refrescado exitosamente',
    );
  }

  @Get('profile')
  async getProfile(@CurrentUser() user: any) {
    const profile = await this.authService.getProfile(user.id);
    return this.responseService.success(
      profile,
      'Perfil obtenido exitosamente',
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: any,
    @Body() body?: { refresh_token?: string; all_sessions?: boolean },
  ) {
    const result = await this.authService.logout(
      user.id,
      body?.refresh_token,
      body?.all_sessions,
    );
    return this.responseService.success(result.data, result.message);
  }

  @Get('me')
  async getCurrentUser(@CurrentUser() user: any) {
    return this.responseService.success(
      user,
      'Usuario actual obtenido exitosamente',
    );
  }

  // ===== RUTAS DE VERIFICACIÓN DE EMAIL =====

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() verifyEmailDto: { token: string }) {
    try {
      const result = await this.authService.verifyEmail(verifyEmailDto.token);
      return this.responseService.success(result, result.message);
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al verificar el email',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() resendDto: { email: string }) {
    try {
      const result = await this.authService.resendEmailVerification(
        resendDto.email,
      );
      return this.responseService.success(result, result.message);
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al reenviar la verificación',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // ===== RUTAS DE RECUPERACIÓN DE CONTRASEÑA =====

  @Public()
  @Post('forgot-owner-password')
  @HttpCode(HttpStatus.OK)
  async forgotOwnerPassword(@Body() forgotDto: ForgotPasswordDto) {
    try {
      const result = await this.authService.forgotPassword(
        forgotDto.email,
        forgotDto.organization_slug,
      );
      return this.responseService.success(result, result.message);
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al solicitar recuperación de contraseña',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Public()
  @Post('reset-owner-password')
  @HttpCode(HttpStatus.OK)
  async resetOwnerPassword(@Body() resetDto: ResetPasswordDto) {
    try {
      const result = await this.authService.resetPassword(
        resetDto.token,
        resetDto.new_password,
      );
      return this.responseService.success(result, result.message);
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al restablecer la contraseña',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: any,
    @Body() changeDto: ChangePasswordDto,
  ) {
    const result = await this.authService.changePassword(
      user.id,
      changeDto.current_password,
      changeDto.new_password,
    );
    return this.responseService.success(result, result.message);
  }

  @Get('sessions')
  async getUserSessions(@CurrentUser() user: any) {
    const sessions = await this.authService.getUserSessions(user.id);
    return this.responseService.success(
      sessions,
      'Sesiones obtenidas exitosamente',
    );
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @CurrentUser() user: any,
    @Param('session_id') session_id: string,
  ) {
    const result = await this.authService.revokeUserSession(
      user.id,
      parseInt(session_id),
    );
    return this.responseService.success(result.data, result.message);
  }

  // ===== RUTAS DE ONBOARDING =====

  @Get('onboarding/status')
  async getOnboardingStatus(@CurrentUser() user: any) {
    // Verificar que el usuario sea owner
    const userWithRoles = await this.authService.validateUser(user.id);
    const isOwner = userWithRoles?.user_roles?.some(
      (ur) => ur.roles?.name === 'owner',
    );

    if (!isOwner) {
      return this.responseService.error(
        'Solo los propietarios de organización pueden acceder al estado de onboarding.',
        'Access denied',
      );
    }

    const status = await this.authService.getOnboardingStatus(user.id);
    return this.responseService.success(
      status,
      'Estado de onboarding obtenido exitosamente',
    );
  }

  @Post('onboarding/create-organization')
  @HttpCode(HttpStatus.CREATED)
  async createOrganizationOnboarding(
    @CurrentUser() user: any,
    @Body() organizationData: any,
  ) {
    // Verificar que el usuario sea owner
    const userWithRoles = await this.authService.validateUser(user.id);
    const isOwner = userWithRoles?.user_roles?.some(
      (ur) => ur.roles?.name === 'owner',
    );

    if (!isOwner) {
      return this.responseService.error(
        'Solo los propietarios de organización pueden crear organizaciones durante el onboarding.',
        'Access denied',
      );
    }

    const result = await this.authService.createOrganizationDuringOnboarding(
      user.id,
      organizationData,
    );
    return this.responseService.success(result, result.message);
  }

  @Post('onboarding/setup-organization/:organizationId')
  @HttpCode(HttpStatus.OK)
  async setupOrganization(
    @CurrentUser() user: any,
    @Param('organization_id') organization_id: string,
    @Body() setup_data: any,
  ) {
    // Verificar que el usuario sea owner
    const userWithRoles = await this.authService.validateUser(user.id);
    const isOwner = userWithRoles?.user_roles?.some(
      (ur) => ur.roles?.name === 'owner',
    );

    if (!isOwner) {
      return this.responseService.error(
        'Solo los propietarios de organización pueden configurar organizaciones durante el onboarding.',
        'Access denied',
      );
    }

    const result = await this.authService.setupOrganization(
      user.id,
      parseInt(organization_id),
      setup_data,
    );
    return this.responseService.success(result, result.message);
  }

  @Post('onboarding/create-store/:organizationId')
  @HttpCode(HttpStatus.CREATED)
  async createStoreOnboarding(
    @CurrentUser() user: any,
    @Param('organization_id') organization_id: string,
    @Body() store_data: any,
  ) {
    // Verificar que el usuario sea owner
    const userWithRoles = await this.authService.validateUser(user.id);
    const isOwner = userWithRoles?.user_roles?.some(
      (ur) => ur.roles?.name === 'owner',
    );

    if (!isOwner) {
      return this.responseService.error(
        'Solo los propietarios de organización pueden crear tiendas durante el onboarding.',
        'Access denied',
      );
    }

    const result = await this.authService.createStoreDuringOnboarding(
      user.id,
      parseInt(organization_id),
      store_data,
    );
    return this.responseService.success(result, result.message);
  }

  @Post('onboarding/setup-store/:storeId')
  @HttpCode(HttpStatus.OK)
  async setupStore(
    @CurrentUser() user: any,
    @Param('store_id') store_id: string,
    @Body() setup_data: any,
  ) {
    // Verificar que el usuario sea owner
    const userWithRoles = await this.authService.validateUser(user.id);
    const isOwner = userWithRoles?.user_roles?.some(
      (ur) => ur.roles?.name === 'owner',
    );

    if (!isOwner) {
      return this.responseService.error(
        'Solo los propietarios de organización pueden configurar tiendas durante el onboarding.',
        'Access denied',
      );
    }

    const result = await this.authService.setupStore(
      user.id,
      parseInt(store_id),
      setup_data,
    );
    return this.responseService.success(result, result.message);
  }

  @Post('onboarding/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Completar onboarding del usuario',
    description:
      'Permite a un usuario marcar su proceso de onboarding como completado. Valida que todos los datos requeridos estén configurados antes de permitir la finalización.',
  })
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Onboarding completado exitosamente',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example: 'Onboarding completado exitosamente',
        },
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'number', example: 1 },
                email: { type: 'string', example: 'usuario@email.com' },
                first_name: { type: 'string', example: 'Juan' },
                last_name: { type: 'string', example: 'Pérez' },
                onboarding_completed: { type: 'boolean', example: true },
                state: { type: 'string', example: 'active' },
              },
            },
            organization: {
              type: 'object',
              properties: {
                id: { type: 'number', example: 1 },
                name: { type: 'string', example: 'Mi Organización' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Datos faltantes o validación fallida',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example:
            'Faltan datos requeridos: nombre y descripción de organización, email y teléfono de organización, dirección de organización, al menos una tienda configurada, configuración de dominio',
        },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Usuario no autenticado o email no verificado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Email no verificado' },
        error: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'number', example: 401 },
      },
    },
  })
  async completeOnboarding(@CurrentUser() user: any) {
    try {
      const result = await this.authService.completeOnboarding(user.id);
      return this.responseService.success(result.data, result.message);
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al completar el onboarding',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
