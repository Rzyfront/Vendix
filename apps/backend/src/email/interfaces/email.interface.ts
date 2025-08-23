// Interfaz base para todos los proveedores de email
export interface EmailProvider {
  sendEmail(to: string, subject: string, html: string, text?: string): Promise<EmailResult>;
  sendVerificationEmail(to: string, token: string, username: string): Promise<EmailResult>;
  sendPasswordResetEmail(to: string, token: string, username: string): Promise<EmailResult>;
  sendWelcomeEmail(to: string, username: string): Promise<EmailResult>;
  sendOnboardingEmail(to: string, username: string, step: string): Promise<EmailResult>;
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

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}
