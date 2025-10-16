export interface EmailTemplateData {
  username: string;
  email: string;
  token?: string;
  verificationUrl?: string;
  resetUrl?: string;
  companyName?: string;
  supportEmail?: string;
  year?: number;
}

export class EmailTemplates {
  private static readonly BASE_URL =
    process.env.FRONTEND_URL || 'http://localhost:4200';
  private static readonly COMPANY_NAME = 'Vendix';
  private static readonly SUPPORT_EMAIL = 'soporte@vendix.com';

  static getVerificationTemplate(data: EmailTemplateData) {
    const verificationUrl = `${this.BASE_URL}/auth/verify-email?token=${data.token}`;

    return {
      subject: `¡Verifica tu cuenta en ${this.COMPANY_NAME}!`,
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verificación de Email</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f8fafc; }
            .container { max-width: 600px; margin: 0 auto; background-color: white; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; }
            .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 600; }
            .content { padding: 40px 20px; }
            .welcome { font-size: 18px; color: #374151; margin-bottom: 20px; }
            .message { color: #6b7280; line-height: 1.6; margin-bottom: 30px; }
            .button { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; text-align: center; }
            .footer { background-color: #f9fafb; padding: 20px; text-align: center; color: #9ca3af; font-size: 14px; }
            .divider { border-top: 1px solid #e5e7eb; margin: 30px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${this.COMPANY_NAME}</h1>
            </div>
            <div class="content">
              <div class="welcome">¡Hola ${data.username}!</div>
              <div class="message">
                Gracias por registrarte en ${this.COMPANY_NAME}. Para completar tu registro y activar tu cuenta, 
                necesitamos verificar tu dirección de email.
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" class="button">Verificar mi Email</a>
              </div>
              <div class="message">
                Este enlace expirará en 24 horas por seguridad. Si no solicitaste esta cuenta, 
                puedes ignorar este email.
              </div>
              <div class="divider"></div>
              <div class="message" style="font-size: 14px;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
                <a href="${verificationUrl}" style="color: #667eea; word-break: break-all;">${verificationUrl}</a>
              </div>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} ${this.COMPANY_NAME}. Todos los derechos reservados.</p>
              <p>¿Necesitas ayuda? Contacta con nosotros en ${this.SUPPORT_EMAIL}</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Hola ${data.username},

        Gracias por registrarte en ${this.COMPANY_NAME}. Para completar tu registro, verifica tu email usando este enlace:

        ${verificationUrl}

        Este enlace expirará en 24 horas.

        Si no solicitaste esta cuenta, puedes ignorar este email.

        Saludos,
        El equipo de ${this.COMPANY_NAME}
        ${this.SUPPORT_EMAIL}
      `,
    };
  }

  static getPasswordResetTemplate(data: EmailTemplateData) {
    const resetUrl = `${this.BASE_URL}/auth/reset-owner-password?token=${data.token}`;

    return {
      subject: `Restablece tu contraseña en ${this.COMPANY_NAME}`,
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Restablecer Contraseña</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f8fafc; }
            .container { max-width: 600px; margin: 0 auto; background-color: white; }
            .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px 20px; text-align: center; }
            .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 600; }
            .content { padding: 40px 20px; }
            .welcome { font-size: 18px; color: #374151; margin-bottom: 20px; }
            .message { color: #6b7280; line-height: 1.6; margin-bottom: 30px; }
            .button { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; text-align: center; }
            .warning { background-color: #fef3c7; border: 1px solid #f59e0b; padding: 16px; border-radius: 8px; color: #92400e; margin: 20px 0; }
            .footer { background-color: #f9fafb; padding: 20px; text-align: center; color: #9ca3af; font-size: 14px; }
            .divider { border-top: 1px solid #e5e7eb; margin: 30px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${this.COMPANY_NAME}</h1>
            </div>
            <div class="content">
              <div class="welcome">Hola ${data.username},</div>
              <div class="message">
                Recibimos una solicitud para restablecer la contraseña de tu cuenta en ${this.COMPANY_NAME}.
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" class="button">Restablecer Contraseña</a>
              </div>
              <div class="warning">
                <strong>⚠️ Importante:</strong> Este enlace expirará en 1 hora por seguridad. 
                Si no solicitaste este cambio, ignora este email y tu contraseña permanecerá sin cambios.
              </div>
              <div class="divider"></div>
              <div class="message" style="font-size: 14px;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
                <a href="${resetUrl}" style="color: #f59e0b; word-break: break-all;">${resetUrl}</a>
              </div>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} ${this.COMPANY_NAME}. Todos los derechos reservados.</p>
              <p>¿Necesitas ayuda? Contacta con nosotros en ${this.SUPPORT_EMAIL}</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Hola ${data.username},

        Recibimos una solicitud para restablecer tu contraseña en ${this.COMPANY_NAME}.

        Usa este enlace para crear una nueva contraseña:
        ${resetUrl}

        Este enlace expirará en 1 hora por seguridad.

        Si no solicitaste este cambio, ignora este email.

        Saludos,
        El equipo de ${this.COMPANY_NAME}
        ${this.SUPPORT_EMAIL}
      `,
    };
  }

  static getWelcomeTemplate(data: EmailTemplateData) {
    const dashboardUrl = `${this.BASE_URL}/dashboard`;

    return {
      subject: `¡Bienvenido a ${this.COMPANY_NAME}! 🎉`,
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Bienvenido</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f8fafc; }
            .container { max-width: 600px; margin: 0 auto; background-color: white; }
            .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 20px; text-align: center; }
            .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 600; }
            .content { padding: 40px 20px; }
            .welcome { font-size: 22px; color: #374151; margin-bottom: 20px; text-align: center; }
            .message { color: #6b7280; line-height: 1.6; margin-bottom: 30px; }
            .button { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; text-align: center; }
            .features { background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin: 30px 0; }
            .feature { margin: 15px 0; }
            .footer { background-color: #f9fafb; padding: 20px; text-align: center; color: #9ca3af; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 ¡Bienvenido!</h1>
            </div>
            <div class="content">
              <div class="welcome">¡Hola ${data.username}!</div>
              <div class="message">
                ¡Tu cuenta en ${this.COMPANY_NAME} está lista! Ahora puedes comenzar a configurar tu negocio 
                y aprovechar todas nuestras herramientas para hacer crecer tu empresa.
              </div>
              <div class="features">
                <h3 style="color: #059669; margin-top: 0;">¿Qué puedes hacer ahora?</h3>
                <div class="feature">✅ Configurar tu organización</div>
                <div class="feature">🏪 Crear y configurar tus tiendas</div>
                <div class="feature">📦 Gestionar tu inventario</div>
                <div class="feature">💰 Procesar pedidos y pagos</div>
                <div class="feature">📊 Ver reportes y analíticas</div>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${dashboardUrl}" class="button">Ir al Dashboard</a>
              </div>
              <div class="message">
                Si tienes preguntas o necesitas ayuda, no dudes en contactarnos. 
                Estamos aquí para ayudarte a tener éxito.
              </div>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} ${this.COMPANY_NAME}. Todos los derechos reservados.</p>
              <p>¿Necesitas ayuda? Contacta con nosotros en ${this.SUPPORT_EMAIL}</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        ¡Hola ${data.username}!

        ¡Bienvenido a ${this.COMPANY_NAME}! Tu cuenta está lista.

        Ahora puedes:
        - Configurar tu organización
        - Crear y configurar tus tiendas
        - Gestionar tu inventario
        - Procesar pedidos y pagos
        - Ver reportes y analíticas

        Comienza ahora: ${dashboardUrl}

        Si tienes preguntas, contactanos en ${this.SUPPORT_EMAIL}

        ¡Bienvenido al equipo!
        ${this.COMPANY_NAME}
      `,
    };
  }

  static getOnboardingTemplate(data: EmailTemplateData & { step: string }) {
    const dashboardUrl = `${this.BASE_URL}/onboarding`;

    const stepMessages = {
      create_organization: {
        title: '🏢 Configura tu Organización',
        message:
          'El siguiente paso es configurar tu organización con tus datos de negocio.',
        action: 'Configurar Organización',
      },
      create_store: {
        title: '🏪 Crea tu Primera Tienda',
        message: 'Ahora puedes crear tu primera tienda y comenzar a vender.',
        action: 'Crear Tienda',
      },
      setup_store: {
        title: '⚙️ Configura tu Tienda',
        message:
          'Configura tu tienda con inventario, métodos de pago y envíos.',
        action: 'Configurar Tienda',
      },
    };

    const stepInfo =
      stepMessages[data.step] || stepMessages['create_organization'];

    return {
      subject: `${stepInfo.title} - Continúa configurando ${this.COMPANY_NAME}`,
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Continúa tu Configuración</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f8fafc; }
            .container { max-width: 600px; margin: 0 auto; background-color: white; }
            .header { background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); padding: 40px 20px; text-align: center; }
            .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 600; }
            .content { padding: 40px 20px; }
            .welcome { font-size: 18px; color: #374151; margin-bottom: 20px; }
            .message { color: #6b7280; line-height: 1.6; margin-bottom: 30px; }
            .button { background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; text-align: center; }
            .progress { background-color: #f3f4f6; height: 8px; border-radius: 4px; margin: 20px 0; }
            .progress-bar { background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); height: 100%; border-radius: 4px; width: 66%; }
            .footer { background-color: #f9fafb; padding: 20px; text-align: center; color: #9ca3af; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${stepInfo.title}</h1>
            </div>
            <div class="content">
              <div class="welcome">¡Hola ${data.username}!</div>
              <div class="message">
                Estás progresando muy bien en la configuración de tu cuenta. 
                ${stepInfo.message}
              </div>
              <div style="margin: 20px 0;">
                <div style="font-size: 14px; color: #6b7280; margin-bottom: 8px;">Progreso de configuración:</div>
                <div class="progress">
                  <div class="progress-bar"></div>
                </div>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${dashboardUrl}" class="button">${stepInfo.action}</a>
              </div>
              <div class="message">
                Una vez completada la configuración, podrás comenzar a usar todas las funciones de ${this.COMPANY_NAME}.
              </div>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} ${this.COMPANY_NAME}. Todos los derechos reservados.</p>
              <p>¿Necesitas ayuda? Contacta con nosotros en ${this.SUPPORT_EMAIL}</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Hola ${data.username},

        ${stepInfo.title}

        ${stepInfo.message}

        Continúa aquí: ${dashboardUrl}

        Saludos,
        El equipo de ${this.COMPANY_NAME}
        ${this.SUPPORT_EMAIL}
      `,
    };
  }
}
