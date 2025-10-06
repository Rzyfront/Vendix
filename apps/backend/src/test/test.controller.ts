import { Controller, Get, UseGuards, Post, Body } from '@nestjs/common';
import { RolesGuard } from '../modules/auth/guards/roles.guard';
import { PermissionsGuard } from '../modules/auth/guards/permissions.guard';
import { Roles } from '../modules/auth/decorators/roles.decorator';
import { RequirePermissions } from '../modules/auth/decorators/permissions.decorator';
import { CurrentUser } from '../modules/auth/decorators/current-user.decorator';
import { Public } from '../modules/auth/decorators/public.decorator';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('test')
export class TestController {
  constructor(
    private readonly emailService: EmailService,
    private readonly prismaService: PrismaService,
  ) {}

  // ===== RUTAS DE PRUEBA DE EMAIL =====

  @Public()
  @Get('email-config')
  getEmailConfig() {
    return {
      message: 'Email configuration status',
      data: {
        provider: this.emailService.getProviderName(),
        isConfigured: this.emailService.isConfigured(),
        config: this.emailService.getConfig(),
      },
    };
  }

  @Public()
  @Post('email-quick')
  async testQuickEmail(@Body() body: { email: string }) {
    const result = await this.emailService.sendEmail(
      body.email,
      'Prueba Rápida de Vendix',
      '<h1>🎉 ¡Email funcionando!</h1><p>Tu configuración de email con Resend está trabajando perfectamente.</p>',
      'Email funcionando! Tu configuración de email con Resend está trabajando perfectamente.',
    );

    return {
      message: 'Quick email test completed',
      data: result,
    };
  }

  @Public()
  @Post('email-verification-test')
  async testVerificationEmail(
    @Body() body: { email: string; username: string },
  ) {
    // Buscar usuario por email
    const user = await this.prismaService.users.findFirst({
      where: { email: body.email },
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    // Invalidar tokens anteriores
    await this.prismaService.email_verification_tokens.updateMany({
      where: { user_id: user.id, verified: false },
      data: { verified: true },
    });

    // Crear nuevo token de verificación
    const testToken = 'test-token-' + Date.now();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    await this.prismaService.email_verification_tokens.create({
      data: {
        user_id: user.id,
        token: testToken,
        expires_at: expiresAt,
      },
    });

    // Enviar email de verificación
    const result = await this.emailService.sendVerificationEmail(
      body.email,
      testToken,
      body.username,
    );

    return {
      message: 'Verification email test sent and token created in database',
      data: {
        ...result,
        testToken, // Para que puedas usar el token para verificar
        userId: user.id,
      },
    };
  }

  // ===== RUTAS EXISTENTES =====

  @Public()
  @Get('public')
  getPublicData() {
    return {
      message: 'Este endpoint es público - no requiere autenticación',
      data: 'Cualquiera puede acceder a esto',
    };
  }

  @Get('protected')
  getProtectedData(@CurrentUser() user: any) {
    return {
      message: 'Este endpoint requiere autenticación',
      user: {
        id: user.id,
        email: user.email,
        role: user.roles,
      },
    };
  }

  @Get('admin-only')
  @UseGuards(RolesGuard)
  @Roles('admin')
  getAdminData(@CurrentUser() user: any) {
    return {
      message: 'Solo administradores pueden ver esto',
      user: {
        id: user.id,
        email: user.email,
        role: user.roles,
      },
    };
  }

  @Get('users-permission')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.read')
  getUsersData(@CurrentUser() user: any) {
    return {
      message: 'Requiere permiso específico: users.read',
      user: {
        id: user.id,
        email: user.email,
        permissions: user.permissions,
      },
    };
  }

  @Get('manager-or-admin')
  @UseGuards(RolesGuard)
  @Roles('admin', 'manager')
  getManagerData(@CurrentUser() user: any) {
    return {
      message: 'Accesible por administradores y gerentes',
      user: {
        id: user.id,
        email: user.email,
        role: user.roles,
      },
    };
  }

  @Post('send-email')
  async sendEmail(@Body() body: { to: string; subject: string; text: string }) {
    const { to, subject, text } = body;
    await this.emailService.sendEmail(to, subject, text);
    return {
      message: 'Email enviado',
    };
  }
}
