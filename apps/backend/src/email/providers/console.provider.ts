import { Injectable, Logger } from '@nestjs/common';
import {
  EmailProvider,
  EmailResult,
  EmailConfig,
  EmailAttachment,
} from '../interfaces/email.interface';
import {
  EmailTemplates,
  EmailTemplateData,
} from '../templates/email-templates';
import { WelcomeEmailOptions } from '../interfaces/branding.interface';
import { DomainConfigService } from '../../common/config/domain.config';

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
    this.logger.log(`📧 Email to: ${to} | Subject: ${subject}`);

    return {
      success: true,
      messageId: `console-${Date.now()}-${Math.random().toString(36)}`,
    };
  }

  async sendEmailWithAttachments(
    to: string,
    subject: string,
    html: string,
    attachments: EmailAttachment[],
    text?: string,
  ): Promise<EmailResult> {
    const attachmentNames = attachments.map((a) => a.filename).join(', ');
    this.logger.log(
      `📧 Email to: ${to} | Subject: ${subject} | Attachments: [${attachmentNames}]`,
    );

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
      `🔗 VERIFICATION LINK: ${EmailTemplates.BASE_URL}/auth/verify-email?token=${token}`,
    );

    // Log del vlink para debugging
    if (organizationSlug) {
      this.logger.log(`🏢 ORGANIZATION SLUG (vLink): ${organizationSlug}`);
      this.logger.log(
        `🌐 LOGIN URL: https://${organizationSlug}.${DomainConfigService.getBaseDomain()}`,
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
      `🔗 PASSWORD RESET LINK: ${EmailTemplates.BASE_URL}/auth/reset-owner-password?token=${token}`,
    );

    return this.sendEmail(to, template.subject, template.html, template.text);
  }

  async sendWelcomeEmail(
    to: string,
    username: string,
    options?: WelcomeEmailOptions,
  ): Promise<EmailResult> {
    const templateData: EmailTemplateData = {
      username,
      email: to,
      companyName: options?.organizationName || 'Vendix',
      storeName: options?.storeName,
      organizationName: options?.organizationName,
      branding: options?.branding,
      userType: options?.userType || 'owner',
      vlink: options?.organizationSlug,
      supportEmail: this.config.fromEmail,
      year: new Date().getFullYear(),
    };

    const template = EmailTemplates.getWelcomeTemplate(templateData);

    // Log adicional para debugging
    if (options?.userType) {
      this.logger.log(`👤 USER TYPE: ${options.userType}`);
    }
    if (options?.storeName) {
      this.logger.log(`🏪 STORE: ${options.storeName}`);
    }
    if (options?.branding?.logo_url) {
      this.logger.log(`🖼️ LOGO: ${options.branding.logo_url}`);
    }
    if (options?.branding?.primary_color) {
      this.logger.log(`🎨 PRIMARY COLOR: ${options.branding.primary_color}`);
    }

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

  async sendInvitationEmail(
    to: string,
    token: string,
    username: string,
    organizationSlug?: string,
    app?: string,
  ): Promise<EmailResult> {
    const templateData: EmailTemplateData = {
      username,
      email: to,
      token,
      vlink: organizationSlug,
      companyName: 'Vendix',
      supportEmail: this.config.fromEmail,
      year: new Date().getFullYear(),
    };

    const template = EmailTemplates.getInvitationTemplate(templateData);

    this.logger.log(
      `📧 INVITATION EMAIL to: ${to} | Subject: ${template.subject}`,
    );
    this.logger.log(
      `🔗 INVITATION LINK: ${EmailTemplates.BASE_URL}/auth/verify-invitation?token=${token}`,
    );

    return this.sendEmail(to, template.subject, template.html, template.text);
  }
}
