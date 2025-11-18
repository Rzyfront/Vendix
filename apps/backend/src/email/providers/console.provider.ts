import { Injectable, Logger } from '@nestjs/common';
import {
  EmailProvider,
  EmailResult,
  EmailConfig,
} from '../interfaces/email.interface';
import {
  EmailTemplates,
  EmailTemplateData,
} from '../templates/email-templates';

@Injectable()
export class ConsoleProvider implements EmailProvider {
  private readonly logger = new Logger(ConsoleProvider.name);

  constructor(private config: EmailConfig) {
    this.logger.warn(
      'Using Console Email Provider - emails will only be logged to console',
    );
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<EmailResult> {
    this.logger.log('========== EMAIL TO SEND ==========');
    this.logger.log(`From: ${this.config.fromName} <${this.config.fromEmail}>`);
    this.logger.log(`To: ${to}`);
    this.logger.log(`Subject: ${subject}`);
    this.logger.log('Text Content:');
    this.logger.log(text || 'No text content');
    this.logger.log('HTML Content:');
    this.logger.log(html);
    this.logger.log('===================================');

    return {
      success: true,
      messageId: `console-${Date.now()}-${Math.random().toString(36)}`,
    };
  }

  async sendVerificationEmail(
    to: string,
    token: string,
    username: string,
    organizationSlug?: string,
  ): Promise<EmailResult> {
    const templateData: EmailTemplateData = {
      username,
      email: to,
      token,
      vlink: organizationSlug, // vlink is just the organization slug
      companyName: 'Vendix',
      supportEmail: this.config.fromEmail,
      year: new Date().getFullYear(),
    };

    const template = EmailTemplates.getVerificationTemplate(templateData);

    // Log adicional para desarrollo
    this.logger.log(
      `🔗 VERIFICATION LINK: ${process.env.FRONTEND_URL || 'http://localhost:4200'}/auth/verify-email?token=${token}`,
    );

    // Log del vlink para debugging
    if (organizationSlug) {
      this.logger.log(`🏢 ORGANIZATION SLUG (vLink): ${organizationSlug}`);
      this.logger.log(
        `🌐 LOGIN URL: https://${organizationSlug}.vendix.online`,
      );
    } else {
      this.logger.log(`⚠️ NO ORGANIZATION SLUG PROVIDED - Using default URL`);
    }

    return this.sendEmail(to, template.subject, template.html, template.text);
  }

  async sendPasswordResetEmail(
    to: string,
    token: string,
    username: string,
  ): Promise<EmailResult> {
    const templateData: EmailTemplateData = {
      username,
      email: to,
      token,
      companyName: 'Vendix',
      supportEmail: this.config.fromEmail,
      year: new Date().getFullYear(),
    };

    const template = EmailTemplates.getPasswordResetTemplate(templateData);

    // Log adicional para desarrollo
    this.logger.log(
      `🔗 PASSWORD RESET LINK: ${process.env.FRONTEND_URL || 'http://localhost:4200'}/auth/reset-owner-password?token=${token}`,
    );

    return this.sendEmail(to, template.subject, template.html, template.text);
  }

  async sendWelcomeEmail(to: string, username: string): Promise<EmailResult> {
    const templateData: EmailTemplateData = {
      username,
      email: to,
      companyName: 'Vendix',
      supportEmail: this.config.fromEmail,
      year: new Date().getFullYear(),
    };

    const template = EmailTemplates.getWelcomeTemplate(templateData);
    return this.sendEmail(to, template.subject, template.html, template.text);
  }

  async sendOnboardingEmail(
    to: string,
    username: string,
    step: string,
  ): Promise<EmailResult> {
    const templateData: EmailTemplateData & { step: string } = {
      username,
      email: to,
      step,
      companyName: 'Vendix',
      supportEmail: this.config.fromEmail,
      year: new Date().getFullYear(),
    };

    const template = EmailTemplates.getOnboardingTemplate(templateData);
    return this.sendEmail(to, template.subject, template.html, template.text);
  }
}
