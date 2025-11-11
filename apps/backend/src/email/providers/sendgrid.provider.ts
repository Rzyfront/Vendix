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
export class SendGridProvider implements EmailProvider {
  private readonly logger = new Logger(SendGridProvider.name);
  private sgMail: any;

  constructor(private config: EmailConfig) {
    this.initializeSendGrid();
  }

  private initializeSendGrid() {
    try {
      // Importación dinámica de SendGrid
      this.sgMail = require('@sendgrid/mail');
      this.sgMail.setApiKey(this.config.apiKey);
      this.logger.log('SendGrid provider initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize SendGrid provider:', error);
      throw new Error('SendGrid provider initialization failed');
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<EmailResult> {
    try {
      const msg = {
        to,
        from: {
          email: this.config.fromEmail,
          name: this.config.fromName,
        },
        subject,
        html,
        text: text || '', // SendGrid requiere texto
      };

      const result = await this.sgMail.send(msg);

      this.logger.log(`Email sent successfully to ${to} via SendGrid`);
      return {
        success: true,
        messageId: result[0]?.headers?.['x-message-id'],
      };
    } catch (error) {
      this.logger.error('SendGrid send error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send email via SendGrid',
      };
    }
  }

  async sendVerificationEmail(
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
