import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainConfigService } from '../common/config/domain.config';
import {
  EmailProvider,
  EmailResult,
  EmailConfig,
} from './interfaces/email.interface';
import { ResendProvider } from './providers/resend.provider';
import { SesProvider } from './providers/ses.provider';
import { SendGridProvider } from './providers/sendgrid.provider';
import { ConsoleProvider } from './providers/console.provider';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private provider: EmailProvider;
  private config: EmailConfig;
  private initialized = false;

  constructor(private configService: ConfigService) {
    // Initial configuration - may be overridden after secrets are loaded
    this.initializeConfig();
    this.initializeProvider();
  }

  /**
   * Called after all modules are initialized.
   * This allows us to reinitialize the email provider after SecretsManagerService
   * has loaded secrets from AWS into process.env.
   */
  async onModuleInit() {
    // Small delay to ensure SecretsManagerService has finished loading
    // This is a workaround for the initialization order issue
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Re-read config from environment (now with secrets loaded)
    const newProvider =
      process.env.EMAIL_PROVIDER ||
      this.configService.get<string>('EMAIL_PROVIDER');

    if (newProvider && newProvider !== this.config.provider) {
      this.logger.log(
        `Reinitializing email service: ${this.config.provider} -> ${newProvider}`,
      );
      this.initializeConfig();
      this.initializeProvider();
    }

    this.initialized = true;
    this.logger.log(
      `Email service ready with provider: ${this.config.provider}`,
    );
  }

  private initializeConfig() {
    // Read from process.env directly first (for secrets loaded dynamically),
    // then fall back to ConfigService (for static .env files)
    this.config = {
      provider: (process.env.EMAIL_PROVIDER ||
        this.configService.get<string>('EMAIL_PROVIDER') ||
        'console') as any,
      apiKey:
        process.env.EMAIL_API_KEY ||
        this.configService.get<string>('EMAIL_API_KEY'),
      domain:
        process.env.EMAIL_DOMAIN ||
        this.configService.get<string>('EMAIL_DOMAIN'),
      fromEmail:
        process.env.EMAIL_FROM ||
        this.configService.get<string>('EMAIL_FROM') ||
        `noreply@${DomainConfigService.getBaseDomain()}`,
      fromName:
        process.env.EMAIL_FROM_NAME ||
        this.configService.get<string>('EMAIL_FROM_NAME') ||
        'Vendix',
      smtp: {
        host:
          process.env.SMTP_HOST ||
          this.configService.get<string>('SMTP_HOST') ||
          '',
        port: parseInt(
          process.env.SMTP_PORT ||
          this.configService.get<string>('SMTP_PORT') ||
          '587',
        ),
        secure:
          (process.env.SMTP_SECURE ||
            this.configService.get<string>('SMTP_SECURE')) === 'true',
        auth: {
          user:
            process.env.SMTP_USER ||
            this.configService.get<string>('SMTP_USER') ||
            '',
          pass:
            process.env.SMTP_PASS ||
            this.configService.get<string>('SMTP_PASS') ||
            '',
        },
      },
    };

    this.logger.log(
      `Email service configured with provider: ${this.config.provider}`,
    );
  }

  private initializeProvider() {
    // En desarrollo, forzar consola si no hay API key válida
    // Para SES/SMTP usamos config.smtp, no necesariamente apiKey
    if (
      process.env.NODE_ENV === 'development' &&
      !this.config.apiKey &&
      this.config.provider !== 'ses' &&
      this.config.provider !== 'smtp'
    ) {
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

      case 'ses':
      case 'smtp':
        if (!this.config.smtp?.host) {
          this.logger.warn(
            'SMTP host not found, falling back to console provider',
          );
          this.provider = new ConsoleProvider(this.config);
        } else {
          try {
            this.provider = new SesProvider(this.config);
          } catch (error) {
            this.logger.error(
              'Failed to initialize SES/SMTP provider, falling back to console:',
              error,
            );
            this.logger.error(error);
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

  async sendWelcomeEmail(
    to: string,
    username: string,
    options?: any,
  ): Promise<EmailResult> {
    this.logger.log(`Sending welcome email to ${to}`);
    return this.provider.sendWelcomeEmail(to, username, options);
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
