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
import {
  WelcomeEmailOptions,
  PasswordResetEmailOptions,
} from '../interfaces/branding.interface';
import * as nodemailer from 'nodemailer';

@Injectable()
export class SesProvider implements EmailProvider {
  private readonly logger = new Logger(SesProvider.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: EmailConfig) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    try {
      if (!this.config.smtp) {
        throw new Error('SMTP configuration is missing for SES provider');
      }

      this.transporter = nodemailer.createTransport({
        host: this.config.smtp.host,
        port: this.config.smtp.port,
        secure: this.config.smtp.secure, // true for 465, false for other ports
        auth: {
          user: this.config.smtp.auth.user,
          pass: this.config.smtp.auth.pass,
        },
      });

      this.logger.log('SES provider initialized successfully via SMTP');
    } catch (error) {
      this.logger.error('Failed to initialize SES provider:', error);
      throw new Error('SES provider initialization failed');
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
    from?: { name: string; email: string },
  ): Promise<EmailResult> {
    // Appointment redesign phase 2 — SES sender-identity is a per-region
    // allowlist (e.g. `noreply@vendix.online` verified, but personal
    // Gmail like `david0920md@gmail.com` is NOT). SES in sandbox mode
    // rejects `from` addresses outside the allowlist, which would block
    // the email entirely.
    //
    // Resolution: keep `from` = platform-verified address. When the caller
    // passes an override, route it as `Reply-To` (the customer's reply
    // goes to the human who decided) and embed the human's name into
    // the From label so it still surfaces in the inbox preview.
    //   From:    "Andres Meza via Nike" <noreply@vendix.online>
    //   Reply-To: "Andres Meza" <david0920md@gmail.com>
    //
    // Declared outside the `try` so the `catch` can name the sender in its
    // diagnostic — SES rejections are almost always sender-identity issues.
    const fromAddress = from
      ? `"${from.name} via ${this.config.fromName}" <${this.config.fromEmail}>`
      : `"${this.config.fromName}" <${this.config.fromEmail}>`;
    const replyToAddress = from
      ? { name: from.name, address: from.email }
      : undefined;
    try {
      const info = await this.transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html,
        text,
        ...(replyToAddress && { replyTo: replyToAddress.address }),
      });

      this.logger.log(
        `Email sent successfully to ${to}, MessageId: ${info.messageId}, from=${fromAddress} replyTo=${replyToAddress?.address ?? 'n/a'}`,
      );
      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      this.logger.error(
        `SES FAILED: to=${to} from=${fromAddress} error=${error.message}`,
      );
      return {
        success: false,
        error: error.message || 'Failed to send email',
      };
    }
  }

  async sendEmailWithAttachments(
    to: string,
    subject: string,
    html: string,
    attachments: EmailAttachment[],
    text?: string,
  ): Promise<EmailResult> {
    try {
      const info = await this.transporter.sendMail({
        from: `"${this.config.fromName}" <${this.config.fromEmail}>`,
        to,
        subject,
        html,
        text,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
          ...(a.cid ? { cid: a.cid } : {}),
        })),
      });

      this.logger.log(
        `Email with ${attachments.length} attachment(s) sent to ${to}, MessageId: ${info.messageId}`,
      );
      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      this.logger.error('SES send error (with attachments):', error);
      return {
        success: false,
        error: error.message || 'Failed to send email with attachments',
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
      vlink: organizationSlug,
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
    options?: PasswordResetEmailOptions,
  ): Promise<EmailResult> {
    const templateData: EmailTemplateData = {
      username,
      email: to,
      token,
      resetUrl: options?.resetUrl,
      branding: options?.branding,
      storeName: options?.storeName,
      vlink: options?.organizationSlug,
      companyName: 'Vendix',
      supportEmail: this.config.fromEmail,
      year: new Date().getFullYear(),
    };

    const template = EmailTemplates.getPasswordResetTemplate(templateData);
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
    return this.sendEmail(to, template.subject, template.html, template.text);
  }
}
