import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailProvider,
  EmailResult,
  EmailConfig,
} from './interfaces/email.interface';
import { ResendProvider } from './providers/resend.provider';
import { SendGridProvider } from './providers/sendgrid.provider';
import { ConsoleProvider } from './providers/console.provider';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private provider: EmailProvider;
  private config: EmailConfig;

  constructor(private configService: ConfigService) {
    this.initializeConfig();
    this.initializeProvider();
  }

  private initializeConfig() {
    this.config = {
      provider: (this.configService.get<string>('EMAIL_PROVIDER') ||
        'console') as any,
      apiKey: this.configService.get<string>('EMAIL_API_KEY'),
      domain: this.configService.get<string>('EMAIL_DOMAIN'),
      fromEmail:
        this.configService.get<string>('EMAIL_FROM') || 'noreply@vendix.online',
      fromName: this.configService.get<string>('EMAIL_FROM_NAME') || 'Vendix',
      smtp: {
        host: this.configService.get<string>('SMTP_HOST') || '',
        port: parseInt(this.configService.get<string>('SMTP_PORT') || '587'),
        secure: this.configService.get<string>('SMTP_SECURE') === 'true',
        auth: {
          user: this.configService.get<string>('SMTP_USER') || '',
          pass: this.configService.get<string>('SMTP_PASS') || '',
        },
      },
    };

    this.logger.log(
      `Email service configured with provider: ${this.config.provider}`,
    );
  }

  private initializeProvider() {
    // En desarrollo, forzar consola si no hay API key válida
    if (process.env.NODE_ENV === 'development' && !this.config.apiKey) {
      this.logger.warn(
        'Development environment: forcing console email provider (no API key)',
      );
      this.provider = new ConsoleProvider(this.config);
      return;
    }

    switch (this.config.provider) {
      case 'resend':
        if (!this.config.apiKey) {
          this.logger.warn(
            'Resend API key not found, falling back to console provider',
          );
          this.provider = new ConsoleProvider(this.config);
        } else {
          try {
            this.provider = new ResendProvider(this.config);
          } catch (error) {
            this.logger.error(
              'Failed to initialize Resend provider, falling back to console:',
              error,
            );
            this.provider = new ConsoleProvider(this.config);
          }
        }
        break;

      case 'sendgrid':
        if (!this.config.apiKey) {
          this.logger.warn(
            'SendGrid API key not found, falling back to console provider',
          );
          this.provider = new ConsoleProvider(this.config);
        } else {
          try {
            this.provider = new SendGridProvider(this.config);
          } catch (error) {
            this.logger.error(
              'Failed to initialize SendGrid provider, falling back to console:',
              error,
            );
            this.provider = new ConsoleProvider(this.config);
          }
        }
        break;

      default:
        this.logger.log('Using console email provider for development');
        this.provider = new ConsoleProvider(this.config);
        break;
    }
  }

  // Método para cambiar proveedor en tiempo de ejecución (útil para testing)
  switchProvider(
    newProvider: 'resend' | 'sendgrid' | 'console',
    apiKey?: string,
  ) {
    this.logger.log(`Switching email provider to: ${newProvider}`);

    if (apiKey) {
      this.config.apiKey = apiKey;
    }

    this.config.provider = newProvider;
    this.initializeProvider();
  }

  // Métodos principales del servicio
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<EmailResult> {
    try {
      const result = await this.provider.sendEmail(to, subject, html, text);

      if (result.success) {
        this.logger.log(
          `Email sent successfully to ${to} using ${this.config.provider}`,
        );
      } else {
        this.logger.error(`Failed to send email to ${to}: ${result.error}`);
      }

      return result;
    } catch (error) {
      this.logger.error('Email service error:', error);
      return {
        success: false,
        error: error.message || 'Unknown email service error',
      };
    }
  }

  async sendVerificationEmail(
    to: string,
    token: string,
    username: string,
    organizationSlug?: string,
  ): Promise<EmailResult> {
    this.logger.log(`Sending verification email to ${to}`);
    return this.provider.sendVerificationEmail(
      to,
      token,
      username,
      organizationSlug,
    );
  }

  async sendPasswordResetEmail(
    to: string,
    token: string,
    username: string,
  ): Promise<EmailResult> {
    this.logger.log(`Sending password reset email to ${to}`);
    return this.provider.sendPasswordResetEmail(to, token, username);
  }

  async sendWelcomeEmail(to: string, username: string): Promise<EmailResult> {
    this.logger.log(`Sending welcome email to ${to}`);
    return this.provider.sendWelcomeEmail(to, username);
  }

  async sendOnboardingEmail(
    to: string,
    username: string,
    step: string,
  ): Promise<EmailResult> {
    this.logger.log(`Sending onboarding email to ${to} for step: ${step}`);
    return this.provider.sendOnboardingEmail(to, username, step);
  }

  // Métodos de utilidad
  getConfig(): EmailConfig {
    // Retornar config sin exponer el API key
    return {
      ...this.config,
      apiKey: this.config.apiKey ? '***HIDDEN***' : undefined,
    };
  }

  getProviderName(): string {
    return this.config.provider;
  }

  isConfigured(): boolean {
    if (this.config.provider === 'console') {
      return true;
    }

    return !!(this.config.apiKey && this.config.fromEmail);
  }

  // Método para testing
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const testResult = await this.sendEmail(
        this.config.fromEmail,
        'Test Email - Connection Check',
        '<h1>Test Email</h1><p>This is a test email to verify the email service configuration.</p>',
        'Test Email - This is a test email to verify the email service configuration.',
      );

      return {
        success: testResult.success,
        message: testResult.success
          ? `Email service is working correctly with ${this.config.provider}`
          : `Email service test failed: ${testResult.error}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Email service test error: ${error.message}`,
      };
    }
  }
}
