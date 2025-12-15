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
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { EnvironmentSwitchService } from './environment-switch.service';
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
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guards/roles.guard';
import { UserRole } from './enums/user-role.enum';
import { ResponseService } from '@common/responses/response.service';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly environmentSwitchService: EnvironmentSwitchService,
    private readonly responseService: ResponseService,
  ) { }

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
    try {
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
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al registrar el propietario',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
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

    try {
      const result = await this.authService.registerCustomer(
        registerCustomerDto,
        client_info,
      );
      return this.responseService.success(
        result,
        'Cliente registrado exitosamente en la tienda.',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al registrar el cliente',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('register-staff')
  @HttpCode(HttpStatus.CREATED)
  async registerStaff(
    @Body() registerStaffDto: RegisterStaffDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.authService.registerStaff(
        registerStaffDto,
        req.user.id,
      );
      return this.responseService.success(result.user, result.message);
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al registrar el personal',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
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
        error.message || 'Error al iniciar sesión',
        error.response?.message || error.message,
        error.status || 401,
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

    try {
      const result = await this.authService.refreshToken(
        refreshTokenDto,
        client_info,
      );
      return this.responseService.success(
        result,
        'Token refrescado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al refrescar el token',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('profile')
  async getProfile(@Req() req: AuthenticatedRequest) {
    try {
      const profile = await this.authService.getProfile(req.user.id);
      return this.responseService.success(
        profile,
        'Perfil obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener el perfil',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Body() body?: { refresh_token?: string; all_sessions?: boolean },
  ) {
    try {
      const result = await this.authService.logout(
        req.user.id,
        body?.refresh_token,
        body?.all_sessions,
      );
      return this.responseService.success(result.data, result.message);
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al cerrar sesión',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('me')
  async getCurrentUser(@Req() req: AuthenticatedRequest) {
    try {
      return this.responseService.success(
        req.user,
        'Usuario actual obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener el usuario actual',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
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
    @Req() req: AuthenticatedRequest,
    @Body() changeDto: ChangePasswordDto,
  ) {
    try {
      const result = await this.authService.changePassword(
        req.user.id,
        changeDto.current_password,
        changeDto.new_password,
      );
      return this.responseService.success(result, result.message);
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al cambiar la contraseña',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('sessions')
  async getUserSessions(@Req() req: AuthenticatedRequest) {
    try {
      const sessions = await this.authService.getUserSessions(req.user.id);
      return this.responseService.success(
        sessions,
        'Sesiones obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las sesiones',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @Req() req: AuthenticatedRequest,
    @Param('session_id') session_id: string,
  ) {
    try {
      const result = await this.authService.revokeUserSession(
        req.user.id,
        parseInt(session_id),
      );
      return this.responseService.success(result.data, result.message);
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al revocar la sesión',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // ===== RUTAS DE SUPER ADMIN =====

  @Post('super-admin/verify-email/:userId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verificar email de usuario como Super Admin',
    description:
      'Permite a un super administrador marcar el email de cualquier usuario como verificado',
  })
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Email verificado exitosamente',
  })
  @ApiResponse({
    status: 401,
    description: 'No autorizado - se requiere rol de super admin',
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario no encontrado',
  })
  @ApiResponse({
    status: 400,
    description: 'El email ya está verificado',
  })
  async verifyUserEmailAsSuperAdmin(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.authService.verifyUserEmailAsSuperAdmin(
        userId,
        req.user.id,
      );
      return this.responseService.success(result.user, result.message);
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al verificar el email',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // ===== RUTAS DE CAMBIO DE ENTORNO =====

  @Post('switch-environment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cambiar entre entornos de administración',
    description: 'Permite a los usuarios cambiar entre ORG_ADMIN y STORE_ADMIN',
  })
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Cambio de entorno exitoso',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Entorno cambiado exitosamente' },
        data: {
          type: 'object',
          properties: {
            user: { type: 'object' },
            tokens: {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
                refreshToken: { type: 'string' },
              },
            },
            permissions: { type: 'array', items: { type: 'string' } },
            roles: { type: 'array', items: { type: 'string' } },
            updatedEnvironment: { type: 'string' },
          },
        },
      },
    },
  })
  async switchEnvironment(
    @Req() req: AuthenticatedRequest,
    @Body() switchDto: any,
  ) {
    const expressReq = req as any;
    const raw_ip = expressReq.headers['x-forwarded-for'] || expressReq.ip || '';
    const ip_address = Array.isArray(raw_ip) ? raw_ip[0] : String(raw_ip || '');
    const user_agent = expressReq.get('user-agent') || '';
    const client_info = {
      ip_address: ip_address || undefined,
      user_agent: user_agent || undefined,
    };

    try {
      const result = await this.environmentSwitchService.switchEnvironment(
        req.user.id,
        switchDto.target_environment,
        switchDto.store_slug,
        client_info,
      );
      return this.responseService.success(
        result,
        'Entorno cambiado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al cambiar de entorno',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
