import { Controller, Get, Post, Body, UseGuards, Query } from '@nestjs/common';
import { EmailService } from './email.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../modules/auth/decorators/current-user.decorator';

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Get('config')
  @UseGuards(JwtAuthGuard)
  async getEmailConfig(@CurrentUser() user: any) {
    // Solo admins pueden ver la configuración
    if (!user.roles?.includes('admin')) {
      return { message: 'Access denied' };
    }

    return {
      message: 'Email configuration',
      data: {
        ...this.emailService.getConfig(),
        isConfigured: this.emailService.isConfigured(),
        provider: this.emailService.getProviderName(),
      },
    };
  }

  @Post('test')
  @UseGuards(JwtAuthGuard)
  async testEmailService(@CurrentUser() user: any) {
    // Solo admins pueden testear el servicio
    if (!user.roles?.includes('admin')) {
      return { message: 'Access denied' };
    }

    const result = await this.emailService.testConnection();

    return {
      message: 'Email service test completed',
      data: result,
    };
  }

  @Post('test-template')
  @UseGuards(JwtAuthGuard)
  async testEmailTemplate(
    @CurrentUser() user: any,
    @Body()
    body: {
      type: 'verification' | 'password-reset' | 'welcome' | 'onboarding';
      email?: string;
      username?: string;
      step?: string;
    },
  ) {
    // Solo admins pueden testear templates
    if (!user.roles?.includes('admin')) {
      return { message: 'Access denied' };
    }

    const email = body.email || user.email;
    const username = body.username || user.first_name || 'Test User';
    const token = 'test-token-' + Date.now();

    let result;

    switch (body.type) {
      case 'verification':
        result = await this.emailService.sendVerificationEmail(
          email,
          token,
          username,
        );
        break;
      case 'password-reset':
        result = await this.emailService.sendPasswordResetEmail(
          email,
          token,
          username,
        );
        break;
      case 'welcome':
        result = await this.emailService.sendWelcomeEmail(email, username);
        break;
      case 'onboarding':
        result = await this.emailService.sendOnboardingEmail(
          email,
          username,
          body.step || 'create_organization',
        );
        break;
      default:
        return { message: 'Invalid template type' };
    }

    return {
      message: `${body.type} email template test sent`,
      data: result,
    };
  }

  @Post('switch-provider')
  @UseGuards(JwtAuthGuard)
  async switchProvider(
    @CurrentUser() user: any,
    @Body()
    body: {
      provider: 'resend' | 'sendgrid' | 'console';
      apiKey?: string;
    },
  ) {
    // Solo admins pueden cambiar proveedores
    if (!user.roles?.includes('admin')) {
      return { message: 'Access denied' };
    }

    this.emailService.switchProvider(body.provider, body.apiKey);

    return {
      message: `Email provider switched to ${body.provider}`,
      data: {
        provider: this.emailService.getProviderName(),
        isConfigured: this.emailService.isConfigured(),
      },
    };
  }
}
