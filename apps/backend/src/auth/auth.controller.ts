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
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto, @Req() request: Request) {
    const result = await this.authService.register(registerDto);

    // Actualizar sesión con IP y User Agent
    if (result.refresh_token) {
      // Aquí se podría actualizar la sesión con la IP y User Agent del request
      // Para simplificar, lo omitimos por ahora
    }

    return {
      message: 'Usuario registrado exitosamente',
      data: result,
    };
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
  async logout(
    @CurrentUser() user: any,
    @Body() body?: { refresh_token?: string },
  ) {
    const result = await this.authService.logout(user.id, body?.refresh_token);

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
    const result = await this.authService.verifyEmail(verifyEmailDto.token);

    return {
      message: result.message,
    };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() resendDto: { email: string }) {
    const result = await this.authService.resendEmailVerification(
      resendDto.email,
    );

    return {
      message: result.message,
    };
  }

  // ===== RUTAS DE RECUPERACIÓN DE CONTRASEÑA =====

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() forgotDto: { email: string }) {
    const result = await this.authService.forgotPassword(forgotDto.email);

    return {
      message: result.message,
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() resetDto: { token: string; newPassword: string },
  ) {
    const result = await this.authService.resetPassword(
      resetDto.token,
      resetDto.newPassword,
    );

    return {
      message: result.message,
    };
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: any,
    @Body() changeDto: { currentPassword: string; newPassword: string },
  ) {
    const result = await this.authService.changePassword(
      user.id,
      changeDto.currentPassword,
      changeDto.newPassword,
    );

    return {
      message: result.message,
    };
  }

  // ===== RUTAS DE ONBOARDING =====

  @Get('onboarding/status')
  @UseGuards(JwtAuthGuard)
  async getOnboardingStatus(@CurrentUser() user: any) {
    const result = await this.authService.startOnboarding(user.id);

    return {
      message: result.message,
      data: result.data,
    };
  }

  @Post('onboarding/create-organization')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createOrganizationOnboarding(
    @CurrentUser() user: any,
    @Body() organizationData: any,
  ) {
    const result = await this.authService.createOrganizationDuringOnboarding(
      user.id,
      organizationData,
    );

    return {
      message: result.message,
      data: {
        organization: result.organization,
        nextStep: result.nextStep,
      },
    };
  }

  @Post('onboarding/setup-organization/:organizationId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async setupOrganization(
    @CurrentUser() user: any,
    @Param('organizationId') organizationId: string,
    @Body() setupData: any,
  ) {
    const result = await this.authService.setupOrganization(
      user.id,
      parseInt(organizationId),
      setupData,
    );

    return {
      message: result.message,
      data: {
        nextStep: result.nextStep,
      },
    };
  }

  @Post('onboarding/create-store/:organizationId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createStoreOnboarding(
    @CurrentUser() user: any,
    @Param('organizationId') organizationId: string,
    @Body() storeData: any,
  ) {
    const result = await this.authService.createStoreDuringOnboarding(
      user.id,
      parseInt(organizationId),
      storeData,
    );

    return {
      message: result.message,
      data: {
        store: result.store,
        nextStep: result.nextStep,
      },
    };
  }

  @Post('onboarding/setup-store/:storeId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async setupStore(
    @CurrentUser() user: any,
    @Param('storeId') storeId: string,
    @Body() setupData: any,
  ) {
    const result = await this.authService.setupStore(
      user.id,
      parseInt(storeId),
      setupData,
    );

    return {
      message: result.message,
      data: {
        nextStep: result.nextStep,
      },
    };
  }

  @Post('onboarding/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async completeOnboarding(@CurrentUser() user: any) {
    const result = await this.authService.completeOnboarding(user.id);

    return {
      message: result.message,
      data: result.data,
    };
  }
}
