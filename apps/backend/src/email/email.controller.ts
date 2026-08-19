import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { EmailService } from './email.service';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Get('config')
  async getEmailConfig(@Req() req: AuthenticatedRequest) {
    // Solo admins pueden ver la configuración
    if (!req.user.user_roles?.some((ur) => ur.roles?.name === 'admin')) {
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
  async testEmailService(@Req() req: AuthenticatedRequest) {
    // Solo admins pueden testear el servicio
    if (!req.user.user_roles?.some((ur) => ur.roles?.name === 'admin')) {
      return { message: 'Access denied' };
    }

    const result = await this.emailService.testConnection();

    return {
      message: 'Email service test completed',
      data: result,
    };
  }

  @Post('test-template')
  async testEmailTemplate(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      type: 'verification' | 'password-reset' | 'welcome' | 'onboarding';
      email?: string;
      username?: string;
      step?: string;
      organizationSlug?: string; // Optional organization slug for testing
    },
  ) {
    // Solo admins pueden testear templates
    if (!req.user.user_roles?.some((ur) => ur.roles?.name === 'admin')) {
      return { message: 'Access denied' };
    }

    const email = body.email || req.user.email;
    const username = body.username || req.user.first_name || 'Test User';
    const token = 'test-token-' + Date.now();

    let result;

    switch (body.type) {
      case 'verification':
        result = await this.emailService.sendVerificationEmail(
          email,
          token,
          username,
          body.organizationSlug, // Optional organization slug for testing
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
  async switchProvider(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      provider: 'resend' | 'sendgrid' | 'console';
      apiKey?: string;
    },
  ) {
    // Solo admins pueden cambiar proveedores
    if (!req.user.user_roles?.some((ur) => ur.roles?.name === 'admin')) {
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
