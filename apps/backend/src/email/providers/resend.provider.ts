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
export class ResendProvider implements EmailProvider {
  private readonly logger = new Logger(ResendProvider.name);
  private resend: any;

  constructor(private config: EmailConfig) {
    this.initializeResend();
  }

  private initializeResend() {
    try {
      // Importación dinámica de Resend
      const { Resend } = require('resend');
      this.resend = new Resend(this.config.apiKey);
      this.logger.log('Resend provider initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Resend provider:', error);
      throw new Error('Resend provider initialization failed');
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<EmailResult> {
    try {
      const result = await this.resend.emails.send({
        from: this.config.fromEmail,
        to: [to],
        subject,
        html,
        text,
      });

      if (result.error) {
        this.logger.error('Resend email error:', result.error);
        return {
          success: false,
          error: result.error.message || 'Failed to send email',
        };
      }

      this.logger.log(
        `Email sent successfully to ${to}, ID: ${result.data?.id}`,
      );
      return {
        success: true,
        messageId: result.data?.id,
      };
    } catch (error) {
      this.logger.error('Resend send error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send email',
      };
    }
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
