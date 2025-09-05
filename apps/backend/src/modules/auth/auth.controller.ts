import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Param,
  NotImplementedException,
  ConflictException,
} from '@nestjs/common';
import { ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterOwnerDto } from './dto/register-owner.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register-owner')
  @HttpCode(HttpStatus.CREATED)
  async registerOwner(
    @Body() registerOwnerDto: RegisterOwnerDto,
    @Req() request: Request,
  ) {
    const rawIp = request.headers['x-forwarded-for'] || request.ip || '';
    const ipAddress = Array.isArray(rawIp) ? rawIp[0] : String(rawIp || '');
    const userAgent = request.get('user-agent') || '';
    const clientInfo = {
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
    };
    const result = await this.authService.registerOwner(registerOwnerDto, clientInfo);
    
    if (result.wasExistingUser) {
      throw new ConflictException({
        message: 'Ya tienes un registro pendiente. Completa tu onboarding.',
        nextStep: 'complete_onboarding',
        organizationId: result.user.organization_id,
        data: result,
      });
    }
    
    return {
      message: 'Bienvenido a Vendix! Tu organización ha sido creada.',
      data: result,
    };
  }

  @Post('register-customer')
  @HttpCode(HttpStatus.CREATED)
  async registerCustomer(
    @Body() registerCustomerDto: RegisterCustomerDto,
    @Req() request: Request,
  ) {
    await this.authService.registerCustomer(registerCustomerDto);
    throw new NotImplementedException('El registro de clientes aún no está implementado.');
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto, @Req() request: Request) {
    await this.authService.register(registerDto);
    throw new NotImplementedException('Esta ruta está obsoleta. Utilice "register-owner" o "register-customer".');
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() request: Request) {
    const result = await this.authService.login(loginDto);
    return {
      message: 'Login exitoso',
      data: result,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    const result = await this.authService.refreshToken(refreshTokenDto);
    return {
      message: 'Token refrescado exitosamente',
      data: result,
    };
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    const profile = await this.authService.getProfile(user.id);
    return {
      message: 'Perfil obtenido exitosamente',
      data: profile,
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: any, @Body() body: RefreshTokenDto) {
    if (!body?.refresh_token) {
      return {
        message: 'El refresh_token es obligatorio para cerrar sesión.',
      };
    }
    const result = await this.authService.logout(user.id, body.refresh_token);
    return {
      message: result.message,
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(@CurrentUser() user: any) {
    return {
      message: 'Usuario actual obtenido exitosamente',
      data: user,
    };
  }

  // ===== RUTAS DE VERIFICACIÓN DE EMAIL =====

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() verifyEmailDto: { token: string }) {
    await this.authService.verifyEmail(verifyEmailDto.token);
    throw new NotImplementedException('La verificación de email aún no está implementada.');
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() resendDto: { email: string }) {
    await this.authService.resendEmailVerification(resendDto.email);
     throw new NotImplementedException('El reenvío de verificación aún no está implementado.');
  }

  // ===== RUTAS DE RECUPERACIÓN DE CONTRASEÑA =====

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() forgotDto: { email: string }) {
    await this.authService.forgotPassword(forgotDto.email);
    throw new NotImplementedException('La recuperación de contraseña aún no está implementada.');
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() resetDto: { token: string; newPassword: string },
  ) {
    await this.authService.resetPassword(
      resetDto.token,
      resetDto.newPassword,
    );
    throw new NotImplementedException('El reseteo de contraseña aún no está implementado.');
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: any,
    @Body() changeDto: { currentPassword: string; newPassword: string },
  ) {
    await this.authService.changePassword(
      user.id,
      changeDto.currentPassword,
      changeDto.newPassword,
    );
    throw new NotImplementedException('El cambio de contraseña aún no está implementado.');
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async getUserSessions(@CurrentUser() user: any) {
    await this.authService.getUserSessions(user.id);
    throw new NotImplementedException('La obtención de sesiones aún no está implementada.');
  }

  // ===== RUTAS DE ONBOARDING =====

  @Get('onboarding/status')
  @UseGuards(JwtAuthGuard)
  async getOnboardingStatus(@CurrentUser() user: any) {
    await this.authService.startOnboarding(user.id);
    throw new NotImplementedException('El onboarding aún no está implementado.');
  }

  @Post('onboarding/create-organization')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createOrganizationOnboarding(
    @CurrentUser() user: any,
    @Body() organizationData: any,
  ) {
    await this.authService.createOrganizationDuringOnboarding(
      user.id,
      organizationData,
    );
    throw new NotImplementedException('El onboarding aún no está implementado.');
  }

  @Post('onboarding/setup-organization/:organizationId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async setupOrganization(
    @CurrentUser() user: any,
    @Param('organizationId') organizationId: string,
    @Body() setupData: any,
  ) {
    await this.authService.setupOrganization(
      user.id,
      parseInt(organizationId),
      setupData,
    );
    throw new NotImplementedException('El onboarding aún no está implementado.');
  }

  @Post('onboarding/create-store/:organizationId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createStoreOnboarding(
    @CurrentUser() user: any,
    @Param('organizationId') organizationId: string,
    @Body() storeData: any,
  ) {
    await this.authService.createStoreDuringOnboarding(
      user.id,
      parseInt(organizationId),
      storeData,
    );
    throw new NotImplementedException('El onboarding aún no está implementado.');
  }

  @Post('onboarding/setup-store/:storeId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async setupStore(
    @CurrentUser() user: any,
    @Param('storeId') storeId: string,
    @Body() setupData: any,
  ) {
    await this.authService.setupStore(
      user.id,
      parseInt(storeId),
      setupData,
    );
    throw new NotImplementedException('El onboarding aún no está implementado.');
  }

  @Post('onboarding/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Completar onboarding del usuario',
    description: 'Permite a un usuario marcar su proceso de onboarding como completado. Valida que todos los datos requeridos estén configurados antes de permitir la finalización.',
  })
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Onboarding completado exitosamente',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Onboarding completado exitosamente' },
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
        message: { type: 'string', example: 'Faltan datos requeridos: nombre y descripción de organización, email y teléfono de organización, dirección de organización, al menos una tienda configurada, configuración de dominio' },
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
    return await this.authService.completeOnboarding(user.id);
  }
}