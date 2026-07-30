import {
  EmailBranding,
  WelcomeEmailOptions,
  PasswordResetEmailOptions,
} from './branding.interface';

// Interfaz base para todos los proveedores de email
export interface EmailProvider {
  sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
    /**
     * Optional sender override. When provided, the email is sent FROM this
     * address instead of the default platform `EMAIL_FROM`. Used by
     * notifications emitted on behalf of a store (e.g. reschedule decisions)
     * so the customer sees the store owner's name + email — not the generic
     * Vendix Corp address.
     *
     * Shape mirrors the default `fromName` + `fromEmail` so providers can
     * render `"<name>" <<email>>` directly.
     */
    from?: { name: string; email: string },
  ): Promise<EmailResult>;
  sendEmailWithAttachments(
    to: string,
    subject: string,
    html: string,
    attachments: EmailAttachment[],
    text?: string,
    from?: { name: string; email: string },
  ): Promise<EmailResult>;
  sendVerificationEmail(
    to: string,
    token: string,
    username: string,
    organizationSlug?: string,
  ): Promise<EmailResult>;
  sendPasswordResetEmail(
    to: string,
    token: string,
    username: string,
    options?: PasswordResetEmailOptions,
  ): Promise<EmailResult>;
  sendWelcomeEmail(
    to: string,
    username: string,
    options?: WelcomeEmailOptions,
  ): Promise<EmailResult>;
  sendOnboardingEmail(
    to: string,
    username: string,
    step: string,
  ): Promise<EmailResult>;
  sendInvitationEmail(
    to: string,
    token: string,
    username: string,
    organizationSlug?: string,
    app?: string,
  ): Promise<EmailResult>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailConfig {
  provider: 'resend' | 'sendgrid' | 'ses' | 'mailgun' | 'smtp' | 'console';
  apiKey?: string;
  domain?: string;
  fromEmail: string;
  fromName: string;
  // Configuración específica por proveedor
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  /**
   * Optional Content-ID for inline-embedded images (`<img src="cid:...">`).
   * Only the SES/SMTP provider propagates it today; Resend/SendGrid treat
   * the asset as a regular download attachment and the inline reference
   * renders as a broken image in their clients.
   */
  cid?: string;
}

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}
