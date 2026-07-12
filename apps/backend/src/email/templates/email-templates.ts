import { EmailBranding } from '../interfaces/branding.interface';
import { DomainConfigService } from '../../common/config/domain.config';

export interface EmailTemplateData {
  username: string;
  email: string;
  token?: string;
  verificationUrl?: string;
  resetUrl?: string;
  companyName?: string;
  supportEmail?: string;
  year?: number;
  vlink?: string; // Organization slug for login instructions
  password?: string; // User's password for login instructions
  // Branding fields
  branding?: EmailBranding;
  userType?: 'owner' | 'staff' | 'customer';
  storeName?: string;
  organizationName?: string;
}

export class EmailTemplates {
  public static get BASE_URL() {
    return process.env.FRONTEND_URL || 'http://localhost:4200';
  }
  private static readonly COMPANY_NAME = 'Vendix';
  private static readonly SUPPORT_EMAIL = 'soporte@vendix.com';

  static getVerificationTemplate(data: EmailTemplateData) {
    const verificationUrl = `${this.BASE_URL}/auth/verify-email?token=${data.token}`;
    const loginUrl = data.vlink
      ? `https://${data.vlink}.${DomainConfigService.getBaseDomain()}`
      : this.BASE_URL;

    return {
      subject: `🎉 ¡Bienvenido a ${this.COMPANY_NAME}! Verifica tu cuenta`,
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>¡Bienvenido a Vendix!</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFC; }
            .container { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
            .header { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); padding: 50px 30px; text-align: center; position: relative; }
            .header::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" stroke-width="0.5" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>') repeat; opacity: 0.1; }
            .header h1 { color: #FFFFFF; margin: 0; font-size: 32px; font-weight: 700; position: relative; z-index: 1; }
            .header .subtitle { color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px; position: relative; z-index: 1; }
            .content { padding: 50px 30px; }
            .welcome-section { text-align: center; margin-bottom: 40px; }
            .welcome-emoji { font-size: 48px; margin-bottom: 20px; }
            .welcome-title { font-size: 24px; color: #1F2937; margin-bottom: 15px; font-weight: 700; }
            .welcome-message { color: #4B5563; line-height: 1.7; margin-bottom: 30px; font-size: 16px; }
            .verification-card { background: linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%); border: 2px solid #BBF7D0; border-radius: 12px; padding: 30px; margin: 30px 0; text-align: center; }
            .verification-title { color: #166534; font-size: 18px; font-weight: 600; margin-bottom: 15px; }
            .verification-message { color: #15803D; margin-bottom: 25px; line-height: 1.6; }
            .button { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); color: #FFFFFF; padding: 18px 36px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; text-align: center; border: none; cursor: pointer; font-size: 16px; transition: all 0.3s ease; box-shadow: 0 4px 6px rgba(47, 111, 78, 0.2); }
            .button:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(47, 111, 78, 0.3); }
            .login-info { background-color: #FEF3C7; border-left: 4px solid #F59E0B; border-radius: 8px; padding: 25px; margin: 30px 0; }
            .login-title { color: #92400E; font-size: 18px; font-weight: 600; margin-bottom: 15px; display: flex; align-items: center; gap: 10px; }
            .login-details { background-color: #FFFFFF; border-radius: 6px; padding: 20px; margin: 15px 0; border: 1px solid #FCD34D; }
            .login-item { display: flex; justify-content: space-between; align-items: center; margin: 10px 0; padding: 8px 0; border-bottom: 1px solid #F3F4F6; }
            .login-item:last-child { border-bottom: none; }
            .login-label { color: #6B7280; font-size: 14px; font-weight: 500; }
            .login-value { color: #1F2937; font-weight: 600; font-family: 'Courier New', monospace; }
            .security-note { background-color: #FEE2E2; border-left: 4px solid #DC2626; border-radius: 8px; padding: 20px; margin: 30px 0; }
            .security-title { color: #991B1B; font-size: 16px; font-weight: 600; margin-bottom: 10px; }
            .features { background-color: #F8FAFC; border-radius: 12px; padding: 30px; margin: 30px 0; border: 1px solid #E2E8F0; }
            .features-title { color: #1F2937; font-size: 20px; font-weight: 600; margin-bottom: 20px; text-align: center; }
            .feature-item { display: flex; align-items: center; margin: 15px 0; color: #4B5563; }
            .feature-icon { color: #10B981; font-size: 20px; margin-right: 15px; min-width: 24px; }
            .divider { border-top: 2px solid #E5E7EB; margin: 40px 0; }
            .footer { background-color: #1F2937; padding: 30px; text-align: center; color: #D1D5DB; font-size: 14px; }
            .footer-logo { font-size: 24px; font-weight: 700; color: #7ED7A5; margin-bottom: 15px; }
            .footer-links { margin: 20px 0; }
            .footer-links a { color: #7ED7A5; text-decoration: none; margin: 0 10px; }
            .footer-links a:hover { text-decoration: underline; }
            .copyright { margin-top: 20px; color: #9CA3AF; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 ${this.COMPANY_NAME}</h1>
              <div class="subtitle">Plataforma de Gestión Comercial</div>
            </div>
            <div class="content">
              <div class="welcome-section">
                <div class="welcome-emoji">🚀</div>
                <div class="welcome-title">¡Bienvenido ${data.username}!</div>
                <div class="welcome-message">
                  ¡Estamos increíblemente emocionados de tenerte a bordo! 🎊 Has tomado el primer paso
                  hacia transformar la manera de gestionar tu negocio. ${this.COMPANY_NAME} es tu
                  nueva plataforma para crecer, vender y conquistar mercados.
                </div>
              </div>

              <div class="verification-card">
                <div class="verification-title">📧 Verifica tu correo electrónico</div>
                <div class="verification-message">
                  Antes de comenzar tu aventura, necesitamos confirmar que este correo electrónico te pertenece.
                  Es un paso rápido y importante para mantener tu cuenta segura.
                </div>
                <div style="text-align: center;">
                  <a href="${verificationUrl}" class="button">✅ Verificar mi Correo</a>
                </div>
              </div>

              <div class="login-info">
                <div class="login-title">
                  🔐 ¿Cómo iniciar sesión en ${this.COMPANY_NAME}?
                </div>
                <div class="login-details">
                  <div class="login-item">
                    <span class="login-label">🌐 Tu enlace de acceso (vLink):</span>
                    <span class="login-value">${data.vlink || 'tu-organizacion'}</span>
                  </div>
                  <div class="login-item">
                    <span class="login-label">📧 Tu correo:</span>
                    <span class="login-value">${data.email}</span>
                  </div>
                  ${
                    data.password
                      ? `
                  <div class="login-item">
                    <span class="login-label">🔑 Tu contraseña:</span>
                    <span class="login-value">${'•'.repeat(data.password.length)}</span>
                  </div>
                  `
                      : ''
                  }
                </div>
                <div style="color: #92400E; font-size: 14px; margin-top: 15px;">
                  💡 <strong>Consejo:</strong> Guarda esta información en un lugar seguro.
                  Tu vLink es único y te dará acceso directo a tu organización.
                </div>
              </div>

              <div class="features">
                <div class="features-title">🎯 ¿Qué te espera después de verificar?</div>
                <div class="feature-item">
                  <span class="feature-icon">📊</span>
                  <span><strong>Dashboard en tiempo real:</strong> Visualiza el rendimiento de tu negocio al instante</span>
                </div>
                <div class="feature-item">
                  <span class="feature-icon">🏪</span>
                  <span><strong>Gestión de tiendas:</strong> Administra múltiples ubicaciones desde un solo lugar</span>
                </div>
                <div class="feature-item">
                  <span class="feature-icon">📦</span>
                  <span><strong>Control de inventario:</strong> Nunca más te quedes sin stock</span>
                </div>
                <div class="feature-item">
                  <span class="feature-icon">💳</span>
                  <span><strong>Procesamiento de pagos:</strong> Acepta múltiples métodos de pago</span>
                </div>
                <div class="feature-item">
                  <span class="feature-icon">📈</span>
                  <span><strong>Reportes avanzados:</strong> Toma decisiones basadas en datos</span>
                </div>
              </div>

              <div class="security-note">
                <div class="security-title">⏱️ Importante</div>
                <div style="color: #7F1D1D; line-height: 1.6;">
                  Este enlace de verificación expirará en <strong>24 horas</strong> por tu seguridad.
                  Si no solicitaste crear una cuenta en ${this.COMPANY_NAME}, puedes ignorar este correo electrónico
                  de forma segura.
                </div>
              </div>

              <div class="divider"></div>

              <div style="text-align: center; margin: 30px 0;">
                <div style="color: #6B7280; font-size: 14px; margin-bottom: 15px;">
                  Si el botón no funciona, copia y pega este enlace en tu navegador:
                </div>
                <a href="${verificationUrl}" style="color: #2F6F4E; word-break: break-all; font-family: 'Courier New', monospace; font-size: 12px; background-color: #F3F4F6; padding: 10px; border-radius: 4px; display: inline-block;">
                  ${verificationUrl}
                </a>
              </div>
            </div>
            <div class="footer">
              <div class="footer-logo">${this.COMPANY_NAME}</div>
              <div class="footer-links">
                <a href="https://${DomainConfigService.getBaseDomain()}">Sitio Web</a>
                <a href="mailto:${this.SUPPORT_EMAIL}">Soporte</a>
                <a href="https://help.${DomainConfigService.getBaseDomain()}">Ayuda</a>
              </div>
              <div class="copyright">
                © ${new Date().getFullYear()} ${this.COMPANY_NAME}. Todos los derechos reservados.<br>
                Estás recibiendo este correo porque te registraste en ${this.COMPANY_NAME}
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
🎉 ¡Bienvenido a ${this.COMPANY_NAME}, ${data.username}! 🎊

Estamos súper emocionados de tenerte a bordo. Has tomado el primer paso hacia transformar
la manera de gestionar tu negocio.

📧 PASO 1: VERIFICA TU CORREO ELECTRÓNICO
Antes de comenzar tu aventura, necesitamos confirmar que este correo electrónico te pertenece:

${verificationUrl}

Este enlace expirará en 24 horas por tu seguridad.

🔐 PASO 2: INICIA SESIÓN EN TU CUENTA
Una vez verificado, podrás acceder a tu cuenta con estos datos:

🌐 Tu enlace de acceso (vLink): ${data.vlink || 'tu-organizacion'}
📧 Tu correo: ${data.email}
${data.password ? `🔑 Tu contraseña: ${data.password}` : ''}

💡 CONSEJO: Guarda esta información en un lugar seguro. Tu vLink es único y te dará acceso directo a tu organización.

🎯 ¿QUÉ TE ESPERA DESPUÉS DE VERIFICAR?
📊 Dashboard en tiempo real
🏪 Gestión de tiendas múltiples
📦 Control de inventario inteligente
💳 Procesamiento de pagos
📈 Reportes y analíticas avanzadas

Si tienes preguntas, estamos aquí para ayudarte.
Soporte: ${this.SUPPORT_EMAIL}
Web: https://${DomainConfigService.getBaseDomain()}

¡Bienvenido al futuro del comercio! 🚀

El equipo de ${this.COMPANY_NAME}
      `,
    };
  }

  static getPasswordResetTemplate(data: EmailTemplateData) {
    const resetUrl = `${this.BASE_URL}/auth/reset-owner-password?token=${data.token}`;
    const loginUrl = data.vlink
      ? `https://${data.vlink}.${DomainConfigService.getBaseDomain()}`
      : this.BASE_URL;

    return {
      subject: `🔐 Restablece tu contraseña en ${this.COMPANY_NAME}`,
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Restablecer Contraseña - Vendix</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFC; }
            .container { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
            .header { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); padding: 50px 30px; text-align: center; position: relative; }
            .header::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" stroke-width="0.5" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>') repeat; opacity: 0.1; }
            .header h1 { color: #FFFFFF; margin: 0; font-size: 32px; font-weight: 700; position: relative; z-index: 1; }
            .header .subtitle { color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px; position: relative; z-index: 1; }
            .content { padding: 50px 30px; }
            .reset-icon { font-size: 64px; text-align: center; margin-bottom: 30px; }
            .reset-title { font-size: 24px; color: #1F2937; margin-bottom: 20px; text-align: center; font-weight: 700; }
            .reset-message { color: #4B5563; line-height: 1.7; margin-bottom: 30px; font-size: 16px; text-align: center; }
            .reset-card { background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border: 2px solid #F59E0B; border-radius: 12px; padding: 30px; margin: 30px 0; text-align: center; }
            .reset-button { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); color: #FFFFFF; padding: 18px 36px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; text-align: center; border: none; cursor: pointer; font-size: 16px; transition: all 0.3s ease; box-shadow: 0 4px 6px rgba(47, 111, 78, 0.2); }
            .reset-button:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(47, 111, 78, 0.3); }
            .security-warning { background-color: #FEE2E2; border-left: 4px solid #DC2626; border-radius: 8px; padding: 25px; margin: 30px 0; }
            .security-title { color: #991B1B; font-size: 18px; font-weight: 600; margin-bottom: 15px; display: flex; align-items: center; gap: 10px; }
            .security-message { color: #7F1D1D; line-height: 1.6; }
            .login-info { background-color: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 20px; margin: 30px 0; }
            .login-title { color: #166534; font-size: 16px; font-weight: 600; margin-bottom: 10px; }
            .divider { border-top: 2px solid #E5E7EB; margin: 40px 0; }
            .footer { background-color: #1F2937; padding: 30px; text-align: center; color: #D1D5DB; font-size: 14px; }
            .footer-logo { font-size: 24px; font-weight: 700; color: #7ED7A5; margin-bottom: 15px; }
            .footer-links { margin: 20px 0; }
            .footer-links a { color: #7ED7A5; text-decoration: none; margin: 0 10px; }
            .footer-links a:hover { text-decoration: underline; }
            .copyright { margin-top: 20px; color: #9CA3AF; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 ${this.COMPANY_NAME}</h1>
              <div class="subtitle">Plataforma de Gestión Comercial</div>
            </div>
            <div class="content">
              <div class="reset-icon">🔑</div>
              <div class="reset-title">Restablecer tu Contraseña</div>
              <div class="reset-message">
                Hola ${data.username}, hemos recibido una solicitud para restablecer la contraseña de tu cuenta.
                Si no realizaste esta solicitud, puedes ignorar este correo de forma segura.
              </div>

              <div class="reset-card">
                <div style="color: #92400E; font-size: 18px; font-weight: 600; margin-bottom: 15px;">
                  🔄 Crea tu nueva contraseña
                </div>
                <div style="color: #92400E; margin-bottom: 25px; line-height: 1.6;">
                  Haz clic en el botón de abajo para establecer una nueva contraseña segura.
                </div>
                <div style="text-align: center;">
                  <a href="${resetUrl}" class="reset-button">🔐 Restablecer Contraseña</a>
                </div>
              </div>

              <div class="security-warning">
                <div class="security-title">
                  ⚠️ Información de Seguridad Importante
                </div>
                <div class="security-message">
                  <strong>⏰ Tiempo límite:</strong> Este enlace expirará en <strong>1 hora</strong> por tu seguridad.<br><br>
                  <strong>🛡️ Si no solicitaste este cambio:</strong> Tu contraseña actual permanecerá sin cambios.
                  No necesitas tomar ninguna acción adicional.<br><br>
                  <strong>🔍 Actividad sospechosa:</strong> Si no reconoces esta actividad,
                  contacta inmediatamente con nuestro equipo de soporte.
                </div>
              </div>

              <div class="login-info">
                <div class="login-title">🌐 ¿Dónde iniciar sesión después de cambiar tu contraseña?</div>
                <div style="color: #15803D; font-size: 14px;">
                  Una vez que hayas restablecido tu contraseña, puedes acceder a tu cuenta en:
                  <br><br>
                  <strong>${loginUrl}</strong>
                  <br><br>
                  Usa tu correo electrónico <strong>${data.email}</strong> y tu nueva contraseña.
                </div>
              </div>

              <div class="divider"></div>

              <div style="text-align: center; margin: 30px 0;">
                <div style="color: #6B7280; font-size: 14px; margin-bottom: 15px;">
                  Si el botón no funciona, copia y pega este enlace en tu navegador:
                </div>
                <a href="${resetUrl}" style="color: #2F6F4E; word-break: break-all; font-family: 'Courier New', monospace; font-size: 12px; background-color: #F3F4F6; padding: 10px; border-radius: 4px; display: inline-block;">
                  ${resetUrl}
                </a>
              </div>

              <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #F8FAFC; border-radius: 8px;">
                <div style="color: #6B7280; font-size: 14px;">
                  ¿Necesitas ayuda adicional?<br>
                  📧 <a href="mailto:${this.SUPPORT_EMAIL}" style="color: #2F6F4E;">${this.SUPPORT_EMAIL}</a><br>
                  🌐 <a href="https://help.${DomainConfigService.getBaseDomain()}" style="color: #2F6F4E;">Centro de Ayuda</a>
                </div>
              </div>
            </div>
            <div class="footer">
              <div class="footer-logo">${this.COMPANY_NAME}</div>
              <div class="footer-links">
                <a href="https://${DomainConfigService.getBaseDomain()}">Sitio Web</a>
                <a href="mailto:${this.SUPPORT_EMAIL}">Soporte</a>
                <a href="https://help.${DomainConfigService.getBaseDomain()}">Ayuda</a>
              </div>
              <div class="copyright">
                © ${new Date().getFullYear()} ${this.COMPANY_NAME}. Todos los derechos reservados.<br>
                Este correo fue enviado como respuesta a una solicitud de restablecimiento de contraseña.
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
🔐 Restablecer Contraseña - ${this.COMPANY_NAME}

Hola ${data.username},

Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en ${this.COMPANY_NAME}.

🔗 ENLACE DE RESTABLECIMIENTO:
${resetUrl}

⏰ IMPORTANTE: Este enlace expirará en 1 hora por tu seguridad.

🛡️ SI NO SOLICITASTE ESTE CAMBIO:
No te preocupes, tu contraseña actual permanecerá sin cambios.
Puedes ignorar este correo de forma segura.

🌐 ¿DÓNDE INICIAR SESIÓN DESPUÉS?
Una vez restablecida tu contraseña, accede a:
${loginUrl}
Correo: ${data.email}
Contraseña: [Tu nueva contraseña]

¿NECESITAS AYUDA?
📧 Soporte: ${this.SUPPORT_EMAIL}
🌐 Centro de Ayuda: https://help.${DomainConfigService.getBaseDomain()}

Mantén tu cuenta segura usando contraseñas únicas y complejas.

El equipo de ${this.COMPANY_NAME}
      `,
    };
  }

  static getWelcomeTemplate(data: EmailTemplateData) {
    const dashboardUrl = `${this.BASE_URL}/dashboard`;
    const loginUrl = data.vlink
      ? `https://${data.vlink}.${DomainConfigService.getBaseDomain()}`
      : this.BASE_URL;

    // Dynamic branding with fallback to Vendix defaults
    const companyName =
      data.organizationName ||
      data.storeName ||
      data.companyName ||
      this.COMPANY_NAME;
    const primaryColor = data.branding?.primary_color || '#7ED7A5';
    const secondaryColor = data.branding?.secondary_color || '#2F6F4E';
    const accentColor = data.branding?.accent_color || '#FFFFFF';
    const logoUrl = data.branding?.logo_url;
    const userType = data.userType || 'owner';

    // Personalize content based on user type
    const getWelcomeEmoji = () => {
      switch (userType) {
        case 'staff':
          return '👋';
        case 'customer':
          return '🛍️';
        default:
          return '✨';
      }
    };

    const getWelcomeTitle = () => {
      switch (userType) {
        case 'staff':
          return `¡Bienvenido al equipo de ${companyName}!`;
        case 'customer':
          return `¡Gracias por registrarte en ${companyName}!`;
        default:
          return `¡Bienvenido de nuevo, ${data.username}!`;
      }
    };

    const getSubtitle = () => {
      switch (userType) {
        case 'staff':
          return 'Tu cuenta de staff está lista';
        case 'customer':
          return 'Tu cuenta de cliente está lista';
        default:
          return 'Tu cuenta está lista para despegar';
      }
    };

    const getWelcomeMessage = () => {
      switch (userType) {
        case 'staff':
          return `Tu cuenta de staff ha sido verificada y está completamente lista para usar. 🎉 Estás a punto de comenzar una experiencia increíble gestionando la tienda con las herramientas más modernas.`;
        case 'customer':
          return `Tu cuenta de cliente ha sido verificada y está completamente lista para usar. 🎉 Descubre nuestros productos y disfruta de una experiencia de compra única.`;
        default:
          return `¡Tu cuenta ha sido verificada y está completamente lista para usar! 🎉 Estás a punto de comenzar una increíble experiencia gestionando tu negocio con las herramientas más modernas y eficientes.`;
      }
    };

    const getCardTitle = () => {
      switch (userType) {
        case 'staff':
          return '🏪 Tu Panel de Staff te espera';
        case 'customer':
          return '🛒 Comienza a comprar';
        default:
          return '📊 Tu Dashboard te espera';
      }
    };

    const getCardMessage = () => {
      switch (userType) {
        case 'staff':
          return `Accede ahora al panel de staff y comienza a gestionar ${companyName} con todas las herramientas disponibles.`;
        case 'customer':
          return `Explora nuestro catálogo de productos y comienza a disfrutar de una experiencia de compra única en ${companyName}.`;
        default:
          return `Accede ahora a tu panel de control y comienza a explorar todas las funciones que ${companyName} tiene preparadas para ti.`;
      }
    };

    const getButtonText = () => {
      switch (userType) {
        case 'staff':
          return '🎯 Ir a mi Panel de Staff';
        case 'customer':
          return '🛒 Ir a la Tienda';
        default:
          return '🎯 Ir a mi Dashboard';
      }
    };

    const getFeatureList = () => {
      switch (userType) {
        case 'staff':
          return `
            <div class="feature-grid">
              <div class="feature-item">
                <span class="feature-icon">📦</span>
                <div class="feature-text"><strong>Gestión de inventario</strong><br>Controla tu stock en tiempo real</div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">💳</span>
                <div class="feature-text"><strong>Punto de venta</strong><br>Procesa ventas rápidamente</div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">👥</span>
                <div class="feature-text"><strong>Gestión de clientes</strong><br>Conoce a tus clientes</div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">📊</span>
                <div class="feature-text"><strong>Reportes de ventas</strong><br>Analiza tu desempeño</div>
              </div>
            </div>
          `;
        case 'customer':
          return `
            <div class="feature-grid">
              <div class="feature-item">
                <span class="feature-icon">🛒</span>
                <div class="feature-text"><strong>Carrito de compras</strong><br>Compra fácil y seguro</div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">📦</span>
                <div class="feature-text"><strong>Seguimiento de pedidos</strong><br>Mira tu pedido en vivo</div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">⭐</span>
                <div class="feature-text"><strong>Programa de lealtad</strong><br>Acumula puntos</div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">🎁</span>
                <div class="feature-text"><strong>Ofertas exclusivas</strong><br>Descuentos especiales</div>
              </div>
            </div>
          `;
        default:
          return `
            <div class="feature-grid">
              <div class="feature-item">
                <span class="feature-icon">📊</span>
                <div class="feature-text"><strong>Dashboard en vivo</strong><br>Monitorea tu negocio en tiempo real</div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">🏪</span>
                <div class="feature-text"><strong>Múltiples tiendas</strong><br>Administra todas desde un lugar</div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">📦</span>
                <div class="feature-text"><strong>Inventario inteligente</strong><br>Nunca te quedes sin stock</div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">💳</span>
                <div class="feature-text"><strong>Pagos digitales</strong><br>Acepta múltiples métodos</div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">👥</span>
                <div class="feature-text"><strong>Gestión de clientes</strong><br>Conoce mejor a tus usuarios</div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">📈</span>
                <div class="feature-text"><strong>Reportes avanzados</strong><br>Toma decisiones inteligentes</div>
              </div>
            </div>
          `;
      }
    };

    const getNextSteps = () => {
      if (userType === 'customer') {
        return '';
      }
      return `
        <div class="next-steps">
          <div class="next-steps-title">🎯 Siguientes pasos recomendados</div>
          <div class="step-item">
            <div class="step-number">1</div>
            <span>${userType === 'staff' ? 'Explora el panel de staff' : 'Completa tu perfil de organización'}</span>
          </div>
          <div class="step-item">
            <div class="step-number">2</div>
            <span>${userType === 'staff' ? 'Familiarízate con el inventario' : 'Configura tu primera tienda'}</span>
          </div>
          <div class="step-item">
            <div class="step-number">3</div>
            <span>${userType === 'staff' ? 'Comienza a gestionar ventas' : 'Agrega tus primeros productos'}</span>
          </div>
          <div class="step-item">
            <div class="step-number">4</div>
            <span>${userType === 'staff' ? 'Explora los reportes' : 'Explora el dashboard y reportes'}</span>
          </div>
        </div>
      `;
    };

    const getSubject = () => {
      switch (userType) {
        case 'staff':
          return `🎉 ¡Bienvenido al equipo de ${companyName}!`;
        case 'customer':
          return `🎉 ¡Bienvenido a ${companyName}!`;
        default:
          return `🎉 ¡Tu cuenta ${companyName} está lista! Comienza ahora`;
      }
    };

    return {
      subject: getSubject(),
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>¡Bienvenido!</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFC; }
            .container { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
            .header { background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%); padding: 50px 30px; text-align: center; position: relative; }
            .header::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" stroke-width="0.5" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>') repeat; opacity: 0.1; }
            .logo-container { text-align: center; margin-bottom: 15px; position: relative; z-index: 1; }
            .logo-image { max-height: 60px; }
            .header h1 { color: ${accentColor}; margin: 0; font-size: 32px; font-weight: 700; position: relative; z-index: 1; }
            .header .subtitle { color: ${accentColor}; margin: 10px 0 0 0; font-size: 16px; position: relative; z-index: 1; opacity: 0.9; }
            .content { padding: 50px 30px; }
            .success-section { text-align: center; margin-bottom: 40px; }
            .success-emoji { font-size: 64px; margin-bottom: 20px; }
            .success-title { font-size: 24px; color: #1F2937; margin-bottom: 15px; font-weight: 700; }
            .success-message { color: #4B5563; line-height: 1.7; margin-bottom: 30px; font-size: 16px; }
            .dashboard-card { background: linear-gradient(135deg, #DBEAFE 0%, #BFDBFE 100%); border: 2px solid #3B82F6; border-radius: 12px; padding: 30px; margin: 30px 0; text-align: center; }
            .dashboard-title { color: #1E3A8A; font-size: 18px; font-weight: 600; margin-bottom: 15px; }
            .dashboard-message { color: #1E40AF; margin-bottom: 25px; line-height: 1.6; }
            .button { background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%); color: ${accentColor}; padding: 18px 36px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; text-align: center; border: none; cursor: pointer; font-size: 16px; transition: all 0.3s ease; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2); }
            .button:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3); }
            .login-reminder { background-color: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 20px; margin: 30px 0; }
            .login-title { color: #166534; font-size: 16px; font-weight: 600; margin-bottom: 10px; }
            .features { background-color: #F8FAFC; border-radius: 12px; padding: 30px; margin: 30px 0; border: 1px solid #E2E8F0; }
            .features-title { color: #1F2937; font-size: 20px; font-weight: 600; margin-bottom: 25px; text-align: center; }
            .feature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
            .feature-item { display: flex; align-items: center; padding: 15px; background-color: #FFFFFF; border-radius: 8px; border: 1px solid #E5E7EB; transition: all 0.3s ease; }
            .feature-item:hover { border-color: ${primaryColor}; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
            .feature-icon { font-size: 24px; margin-right: 15px; min-width: 30px; }
            .feature-text { color: #374151; font-size: 14px; line-height: 1.5; }
            .next-steps { background-color: #FEF3C7; border-left: 4px solid #F59E0B; border-radius: 8px; padding: 25px; margin: 30px 0; }
            .next-steps-title { color: #92400E; font-size: 18px; font-weight: 600; margin-bottom: 15px; }
            .step-item { display: flex; align-items: center; margin: 12px 0; color: #92400E; }
            .step-number { background-color: #F59E0B; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12px; margin-right: 15px; }
            .divider { border-top: 2px solid #E5E7EB; margin: 40px 0; }
            .footer { background-color: #1F2937; padding: 30px; text-align: center; color: #D1D5DB; font-size: 14px; }
            .footer-logo { font-size: 24px; font-weight: 700; color: ${primaryColor}; margin-bottom: 15px; }
            .footer-links { margin: 20px 0; }
            .footer-links a { color: ${primaryColor}; text-decoration: none; margin: 0 10px; }
            .footer-links a:hover { text-decoration: underline; }
            .copyright { margin-top: 20px; color: #9CA3AF; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              ${
                logoUrl
                  ? `
                <div class="logo-container">
                  <img src="${logoUrl}" alt="${companyName}" class="logo-image">
                </div>
              `
                  : `
                <h1>${getWelcomeEmoji()} ${companyName}</h1>
              `
              }
              <div class="subtitle">${getSubtitle()}</div>
            </div>
            <div class="content">
              <div class="success-section">
                <div class="success-emoji">${getWelcomeEmoji()}</div>
                <div class="success-title">${getWelcomeTitle()}</div>
                <div class="success-message">
                  ${getWelcomeMessage()}
                </div>
              </div>

              <div class="dashboard-card">
                <div class="dashboard-title">${getCardTitle()}</div>
                <div class="dashboard-message">
                  ${getCardMessage()}
                </div>
                <div style="text-align: center;">
                  <a href="${dashboardUrl}" class="button">${getButtonText()}</a>
                </div>
              </div>

              <div class="login-reminder">
                <div class="login-title">🔐 Recordatorio de acceso</div>
                <div style="color: #15803D; font-size: 14px; line-height: 1.6;">
                  🌐 <strong>Tu enlace de acceso:</strong> <a href="${loginUrl}" style="color: ${secondaryColor};">${loginUrl}</a><br>
                  📧 <strong>Tu correo:</strong> ${data.email}<br>
                  💡 <strong>Consejo:</strong> ¡Guarda este enlace como favorito para acceso rápido!
                </div>
              </div>

              <div class="features">
                <div class="features-title">🎯 Todo lo que puedes hacer ahora</div>
                ${getFeatureList()}
              </div>

              ${getNextSteps()}

              <div style="text-align: center; margin: 40px 0; padding: 25px; background-color: #F8FAFC; border-radius: 12px; border: 1px solid #E2E8F0;">
                <div style="color: #6B7280; font-size: 16px; margin-bottom: 15px;">
                  ${userType === 'customer' ? '¿Tienes preguntas?' : '¿Necesitas ayuda para comenzar?'} Estamos aquí para ti.
                </div>
                <div style="color: #4B5563; font-size: 14px;">
                  📧 <a href="mailto:${this.SUPPORT_EMAIL}" style="color: ${secondaryColor};">${this.SUPPORT_EMAIL}</a><br>
                  🌐 <a href="https://help.${DomainConfigService.getBaseDomain()}" style="color: ${secondaryColor};">Centro de Ayuda</a><br>
                  ${userType !== 'customer' ? '💬 <a href="https://${DomainConfigService.getBaseDomain()}/chat" style="color: ' + secondaryColor + ';">Chat en vivo</a>' : ''}
                </div>
              </div>
            </div>
            <div class="footer">
              <div class="footer-logo">${companyName}</div>
              <div class="footer-links">
                <a href="https://${DomainConfigService.getBaseDomain()}">Sitio Web</a>
                <a href="mailto:${this.SUPPORT_EMAIL}">Soporte</a>
                <a href="https://help.${DomainConfigService.getBaseDomain()}">Ayuda</a>
              </div>
              <div class="copyright">
                © ${new Date().getFullYear()} ${companyName}. Todos los derechos reservados.<br>
                ${
                  userType === 'owner'
                    ? '¡Estás listo para transformar tu negocio! 🚀'
                    : userType === 'staff'
                      ? '¡Bienvenido al equipo! 🎉'
                      : '¡Gracias por elegirnos! 🛍️'
                }
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
🎉 ${getSubject()}

¡Hola ${data.username}!

${getWelcomeMessage()}

🎯 COMIENZA AHORA:
Accede desde:
${dashboardUrl}

🔐 TUS DATOS DE ACCESO:
🌐 Tu enlace: ${loginUrl}
📧 Correo: ${data.email}

✨ ¿QUÉ PUEDES HACER AHORA?
${
  userType === 'staff'
    ? '📦 Gestión de inventario en tiempo real\n💳 Punto de venta rápido\n👥 Gestión de clientes\n📊 Reportes de ventas'
    : userType === 'customer'
      ? '🛒 Carrito de compras fácil\n📦 Seguimiento de pedidos\n⭐ Programa de lealtad\n🎁 Ofertas exclusivas'
      : '📊 Ver tu dashboard en tiempo real\n🏪 Administrar múltiples tiendas\n📦 Controlar inventario inteligente\n💳 Procesar pagos digitales\n👥 Gestionar clientes\n📈 Generar reportes avanzados'
}

${
  userType !== 'customer'
    ? `🎯 SIGUIENTES PASOS RECOMENDADOS:
1. ${userType === 'staff' ? 'Explora el panel de staff' : 'Completa tu perfil de organización'}
2. ${userType === 'staff' ? 'Familiarízate con el inventario' : 'Configura tu primera tienda'}
3. ${userType === 'staff' ? 'Comienza a gestionar ventas' : 'Agrega tus primeros productos'}
4. ${userType === 'staff' ? 'Explora los reportes' : 'Explora el dashboard y reportes'}

`
    : ''
}¿NECESITAS AYUDA?
📧 Soporte: ${this.SUPPORT_EMAIL}
🌐 Ayuda: https://help.${DomainConfigService.getBaseDomain()}
${userType !== 'customer' ? '💬 Chat: https://' + DomainConfigService.getBaseDomain() + '/chat' : ''}

${
  userType === 'owner'
    ? '¡Bienvenido al futuro del comercio! 🚀'
    : userType === 'staff'
      ? '¡Bienvenido al equipo! 🎉'
      : '¡Gracias por elegirnos! 🛍️'
}

El equipo de ${companyName}
      `,
    };
  }

  static getOnboardingTemplate(data: EmailTemplateData & { step: string }) {
    const dashboardUrl = `${this.BASE_URL}/onboarding`;
    const loginUrl = data.vlink
      ? `https://${data.vlink}.${DomainConfigService.getBaseDomain()}`
      : this.BASE_URL;

    const stepMessages = {
      create_organization: {
        title: '🏢 Configura tu Organización',
        message:
          'El siguiente paso es configurar tu organización con tus datos de negocio.',
        action: 'Configurar Organización',
        icon: '🏢',
        color: '#3B82F6',
        bgColor: '#DBEAFE',
        borderColor: '#3B82F6',
        progress: 33,
        benefits: [
          'Establece tu identidad corporativa',
          'Configura preferencias fiscales',
          'Define equipos y permisos',
        ],
      },
      create_store: {
        title: '🏪 Crea tu Primera Tienda',
        message: 'Ahora puedes crear tu primera tienda y comenzar a vender.',
        action: 'Crear Tienda',
        icon: '🏪',
        color: '#10B981',
        bgColor: '#D1FAE5',
        borderColor: '#10B981',
        progress: 66,
        benefits: [
          'Personaliza tu tienda online',
          'Configura métodos de pago',
          'Establece zonas de envío',
        ],
      },
      setup_store: {
        title: '⚙️ Configura tu Tienda',
        message:
          'Configura tu tienda con inventario, métodos de pago y envíos.',
        action: 'Configurar Tienda',
        icon: '⚙️',
        color: '#F59E0B',
        bgColor: '#FEF3C7',
        borderColor: '#F59E0B',
        progress: 90,
        benefits: [
          'Agrega tus primeros productos',
          'Configura tu inventario',
          'Activa notificaciones',
        ],
      },
    };

    const stepInfo =
      stepMessages[data.step] || stepMessages['create_organization'];

    return {
      subject: `${stepInfo.title} - Tu setup ${this.COMPANY_NAME} está casi listo`,
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Onboarding - Vendix</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFC; }
            .container { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
            .header { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); padding: 50px 30px; text-align: center; position: relative; }
            .header::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" stroke-width="0.5" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>') repeat; opacity: 0.1; }
            .header h1 { color: #FFFFFF; margin: 0; font-size: 32px; font-weight: 700; position: relative; z-index: 1; }
            .header .subtitle { color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px; position: relative; z-index: 1; }
            .content { padding: 50px 30px; }
            .onboarding-section { text-align: center; margin-bottom: 40px; }
            .step-icon { font-size: 64px; margin-bottom: 20px; }
            .step-title { font-size: 24px; color: #1F2937; margin-bottom: 15px; font-weight: 700; }
            .step-message { color: #4B5563; line-height: 1.7; margin-bottom: 30px; font-size: 16px; }
            .progress-section { background-color: #F8FAFC; border-radius: 12px; padding: 25px; margin: 30px 0; border: 1px solid #E2E8F0; }
            .progress-title { color: #374151; font-size: 16px; font-weight: 600; margin-bottom: 15px; text-align: center; }
            .progress-container { background-color: #E5E7EB; height: 12px; border-radius: 6px; margin: 15px 0; overflow: hidden; }
            .progress-bar { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); height: 100%; border-radius: 6px; transition: width 0.3s ease; }
            .progress-text { text-align: center; color: #6B7280; font-size: 14px; margin-top: 10px; }
            .action-card { background: linear-gradient(135deg, ${stepInfo.bgColor} 0%, ${stepInfo.bgColor}DD 100%); border: 2px solid ${stepInfo.borderColor}; border-radius: 12px; padding: 30px; margin: 30px 0; text-align: center; }
            .action-title { color: ${stepInfo.color}; font-size: 18px; font-weight: 600; margin-bottom: 15px; }
            .action-message { color: ${stepInfo.color}; margin-bottom: 25px; line-height: 1.6; }
            .button { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); color: #FFFFFF; padding: 18px 36px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; text-align: center; border: none; cursor: pointer; font-size: 16px; transition: all 0.3s ease; box-shadow: 0 4px 6px rgba(47, 111, 78, 0.2); }
            .button:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(47, 111, 78, 0.3); }
            .benefits { background-color: #F0FDF4; border-radius: 12px; padding: 25px; margin: 30px 0; border: 1px solid #BBF7D0; }
            .benefits-title { color: #166534; font-size: 18px; font-weight: 600; margin-bottom: 20px; }
            .benefit-item { display: flex; align-items: center; margin: 12px 0; color: #15803D; }
            .benefit-icon { color: #10B981; font-size: 20px; margin-right: 15px; min-width: 24px; }
            .timeline { display: flex; justify-content: space-between; margin: 30px 0; position: relative; }
            .timeline::before { content: ''; position: absolute; top: 20px; left: 0; right: 0; height: 2px; background-color: #E5E7EB; z-index: 1; }
            .timeline-step { display: flex; flex-direction: column; align-items: center; position: relative; z-index: 2; }
            .timeline-dot { width: 40px; height: 40px; border-radius: 50%; background-color: #E5E7EB; display: flex; align-items: center; justify-content: center; font-size: 14px; margin-bottom: 8px; border: 3px solid #FFFFFF; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
            .timeline-dot.active { background-color: #10B981; color: white; }
            .timeline-label { font-size: 12px; color: #6B7280; text-align: center; max-width: 80px; }
            .login-info { background-color: #FEF3C7; border-left: 4px solid #F59E0B; border-radius: 8px; padding: 20px; margin: 30px 0; }
            .login-title { color: #92400E; font-size: 16px; font-weight: 600; margin-bottom: 10px; }
            .footer { background-color: #1F2937; padding: 30px; text-align: center; color: #D1D5DB; font-size: 14px; }
            .footer-logo { font-size: 24px; font-weight: 700; color: #7ED7A5; margin-bottom: 15px; }
            .footer-links { margin: 20px 0; }
            .footer-links a { color: #7ED7A5; text-decoration: none; margin: 0 10px; }
            .footer-links a:hover { text-decoration: underline; }
            .copyright { margin-top: 20px; color: #9CA3AF; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${stepInfo.icon} ${this.COMPANY_NAME}</h1>
              <div class="subtitle">Configuración guiada - Paso ${stepInfo.progress}% completado</div>
            </div>
            <div class="content">
              <div class="onboarding-section">
                <div class="step-icon">${stepInfo.icon}</div>
                <div class="step-title">${stepInfo.title}</div>
                <div class="step-message">
                  ¡Hola ${data.username}! Estás progresando excelentemente en la configuración de tu cuenta.
                  ${stepInfo.message}
                </div>
              </div>

              <div class="progress-section">
                <div class="progress-title">📊 Progreso de configuración</div>
                <div class="progress-container">
                  <div class="progress-bar" style="width: ${stepInfo.progress}%;"></div>
                </div>
                <div class="progress-text">${stepInfo.progress}% completado - ¡Vas muy bien!</div>
              </div>

              <div class="action-card">
                <div class="action-title">🎯 Completa este paso ahora</div>
                <div class="action-message">
                  Haz clic en el botón de abajo para continuar con la configuración
                  y estar un paso más cerca de tener tu negocio operativo.
                </div>
                <div style="text-align: center;">
                  <a href="${dashboardUrl}" class="button">${stepInfo.action}</a>
                </div>
              </div>

              <div class="benefits">
                <div class="benefits-title">✨ Beneficios de completar este paso</div>
                ${stepInfo.benefits
                  .map(
                    (benefit) => `
                  <div class="benefit-item">
                    <span class="benefit-icon">✓</span>
                    <span>${benefit}</span>
                  </div>
                `,
                  )
                  .join('')}
              </div>

              <div class="timeline">
                <div class="timeline-step">
                  <div class="timeline-dot ${data.step === 'create_organization' ? 'active' : ''}">1</div>
                  <div class="timeline-label">Organización</div>
                </div>
                <div class="timeline-step">
                  <div class="timeline-dot ${data.step === 'create_store' ? 'active' : ''}">2</div>
                  <div class="timeline-label">Tienda</div>
                </div>
                <div class="timeline-step">
                  <div class="timeline-dot ${data.step === 'setup_store' ? 'active' : ''}">3</div>
                  <div class="timeline-label">Configuración</div>
                </div>
                <div class="timeline-step">
                  <div class="timeline-dot">4</div>
                  <div class="timeline-label">¡Listo!</div>
                </div>
              </div>

              <div class="login-info">
                <div class="login-title">🔐 Tu acceso rápido</div>
                <div style="color: #92400E; font-size: 14px; line-height: 1.6;">
                  🌐 <strong>Tu enlace:</strong> <a href="${loginUrl}" style="color: #2F6F4E;">${loginUrl}</a><br>
                  📧 <strong>Tu correo:</strong> ${data.email}<br>
                  💡 <strong>Consejo:</strong> Tu progreso se guarda automáticamente
                </div>
              </div>

              <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #F8FAFC; border-radius: 8px;">
                <div style="color: #6B7280; font-size: 14px;">
                  ¿Necesitas ayuda durante el setup?<br>
                  📧 <a href="mailto:${this.SUPPORT_EMAIL}" style="color: #2F6F4E;">${this.SUPPORT_EMAIL}</a><br>
                  🌐 <a href="https://help.${DomainConfigService.getBaseDomain()}/onboarding" style="color: #2F6F4E;">Guía de onboarding</a><br>
                  💬 <a href="https://${DomainConfigService.getBaseDomain()}/chat" style="color: #2F6F4E;">Chat de soporte</a>
                </div>
              </div>
            </div>
            <div class="footer">
              <div class="footer-logo">${this.COMPANY_NAME}</div>
              <div class="footer-links">
                <a href="https://${DomainConfigService.getBaseDomain()}">Sitio Web</a>
                <a href="mailto:${this.SUPPORT_EMAIL}">Soporte</a>
                <a href="https://help.${DomainConfigService.getBaseDomain()}">Ayuda</a>
              </div>
              <div class="copyright">
                © ${new Date().getFullYear()} ${this.COMPANY_NAME}. Todos los derechos reservados.<br>
                Estamos contigo en cada paso del setup 🚀
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
${stepInfo.icon} ${stepInfo.title} - ${this.COMPANY_NAME}

¡Hola ${data.username}!

¡Excelente progreso! Estás ${stepInfo.progress}% completado en tu configuración.
${stepInfo.message}

📊 PROGRESO: ${stepInfo.progress}% completado

✨ BENEFICIOS DE ESTE PASO:
${stepInfo.benefits.map((benefit) => `✓ ${benefit}`).join('\n')}

🎯 ACCIÓN REQUERIDA:
Continúa tu configuración aquí:
${dashboardUrl}

🔐 TUS DATOS DE ACCESO:
🌐 Tu enlace: ${loginUrl}
📧 Correo: ${data.email}

📈 TIMELINE DEL SETUP:
1. ✓ Configurar Organización
2. ${data.step === 'create_organization' ? '→' : '○'} Crear Tienda
3. ${data.step === 'create_store' ? '→' : '○'} Configurar Tienda
4. ${data.step === 'setup_store' ? '→' : '○'} ¡Comenzar a vender!

¿NECESITAS AYUDA?
📧 Soporte: ${this.SUPPORT_EMAIL}
🌐 Guía: https://help.${DomainConfigService.getBaseDomain()}/onboarding
💬 Chat: https://${DomainConfigService.getBaseDomain()}/chat

Tu progreso se guarda automáticamente. ¡Sigue así! 🚀

El equipo de ${this.COMPANY_NAME}
      `,
    };
  }

  static getInvitationTemplate(data: EmailTemplateData) {
    const invitationUrl = `${this.BASE_URL}/auth/verify-invitation?token=${data.token}`;
    const loginUrl = data.vlink
      ? `https://${data.vlink}.${DomainConfigService.getBaseDomain()}`
      : this.BASE_URL;

    return {
      subject: `📨 Te han invitado a ${this.COMPANY_NAME}!`,
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Invitación - Vendix</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFC; }
            .container { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
            .header { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); padding: 50px 30px; text-align: center; position: relative; }
            .header::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" stroke-width="0.5" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>') repeat; opacity: 0.1; }
            .header h1 { color: #FFFFFF; margin: 0; font-size: 32px; font-weight: 700; position: relative; z-index: 1; }
            .header .subtitle { color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px; position: relative; z-index: 1; }
            .content { padding: 50px 30px; }
            .invitation-icon { font-size: 64px; text-align: center; margin-bottom: 30px; }
            .invitation-title { font-size: 24px; color: #1F2937; margin-bottom: 20px; text-align: center; font-weight: 700; }
            .invitation-message { color: #4B5563; line-height: 1.7; margin-bottom: 30px; font-size: 16px; text-align: center; }
            .invitation-card { background: linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%); border: 2px solid #BBF7D0; border-radius: 12px; padding: 30px; margin: 30px 0; text-align: center; }
            .invitation-title-card { color: #166534; font-size: 18px; font-weight: 600; margin-bottom: 15px; }
            .invitation-message-card { color: #15803D; margin-bottom: 25px; line-height: 1.6; }
            .button { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); color: #FFFFFF; padding: 18px 36px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; text-align: center; border: none; cursor: pointer; font-size: 16px; transition: all 0.3s ease; box-shadow: 0 4px 6px rgba(47, 111, 78, 0.2); }
            .button:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(47, 111, 78, 0.3); }
            .user-info { background-color: #F8FAFC; border-radius: 12px; padding: 25px; margin: 30px 0; border: 1px solid #E2E8F0; }
            .info-item { display: flex; justify-content: space-between; align-items: center; margin: 12px 0; padding: 8px 0; border-bottom: 1px solid #E5E7EB; }
            .info-item:last-child { border-bottom: none; }
            .info-label { color: #6B7280; font-size: 14px; font-weight: 500; }
            .info-value { color: #1F2937; font-weight: 600; }
            .footer { background-color: #1F2937; padding: 30px; text-align: center; color: #D1D5DB; font-size: 14px; }
            .footer-logo { font-size: 24px; font-weight: 700; color: #7ED7A5; margin-bottom: 15px; }
            .footer-links { margin: 20px 0; }
            .footer-links a { color: #7ED7A5; text-decoration: none; margin: 0 10px; }
            .footer-links a:hover { text-decoration: underline; }
            .copyright { margin-top: 20px; color: #9CA3AF; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📨 ${this.COMPANY_NAME}</h1>
              <div class="subtitle">Has recibido una invitación</div>
            </div>
            <div class="content">
              <div class="invitation-icon">🎉</div>
              <div class="invitation-title">¡Hola ${data.username}!</div>
              <div class="invitation-message">
                Has sido invitado/a a unirte a ${this.COMPANY_NAME}.
                Completa tu registro haciendo clic en el botón de abajo.
              </div>

              <div class="invitation-card">
                <div class="invitation-title-card">🎯 Completa tu registro</div>
                <div class="invitation-message-card">
                  Haz clic en el siguiente botón para verificar tu correo y crear tu contraseña.
                </div>
                <div style="text-align: center;">
                  <a href="${invitationUrl}" class="button">✅ Completar Registro</a>
                </div>
              </div>

              <div class="user-info">
                <div class="info-item">
                  <span class="info-label">📧 Tu correo:</span>
                  <span class="info-value">${data.email}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">🌐 Tu organización:</span>
                  <span class="info-value">${data.vlink || 'Por definir'}</span>
                </div>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <div style="color: #6B7280; font-size: 14px; margin-bottom: 15px;">
                  Si el botón no funciona, copia y pega este enlace en tu navegador:
                </div>
                <a href="${invitationUrl}" style="color: #2F6F4E; word-break: break-all; font-family: 'Courier New', monospace; font-size: 12px; background-color: #F3F4F6; padding: 10px; border-radius: 4px; display: inline-block;">
                  ${invitationUrl}
                </a>
              </div>
            </div>
            <div class="footer">
              <div class="footer-logo">${this.COMPANY_NAME}</div>
              <div class="footer-links">
                <a href="https://${DomainConfigService.getBaseDomain()}">Sitio Web</a>
                <a href="mailto:${this.SUPPORT_EMAIL}">Soporte</a>
                <a href="https://help.${DomainConfigService.getBaseDomain()}">Ayuda</a>
              </div>
              <div class="copyright">
                © ${new Date().getFullYear()} ${this.COMPANY_NAME}. Todos los derechos reservados.<br>
                Este enlace de invitación expirará en 7 días.
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
📨 Invitación a ${this.COMPANY_NAME}

¡Hola ${data.username}!

Has sido invitado/a a unirte a ${this.COMPANY_NAME}.
Completa tu registro haciendo clic en el siguiente enlace:

${invitationUrl}

📧 Tu correo: ${data.email}
🌐 Tu organización: ${data.vlink || 'Por definir'}

Este enlace de invitación expirará en 7 días.

El equipo de ${this.COMPANY_NAME}
      `,
    };
  }

  static getPaymentConfirmedTemplate(data: {
    invoiceNumber: string;
    amount: string;
    currency: string;
    planName: string;
    periodStart: string;
    periodEnd: string;
    storeName?: string;
    organizationName?: string;
    paymentMethod?: string;
  }) {
    const companyName = this.COMPANY_NAME;
    const supportEmail = this.SUPPORT_EMAIL;

    return {
      subject: `✅ Pago confirmado – Factura ${data.invoiceNumber}`,
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Pago confirmado</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFC; }
            .container { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
            .header { background: linear-gradient(135deg, #7ED7A5 0%, #2F6F4E 100%); padding: 40px 30px; text-align: center; }
            .header h1 { color: #FFFFFF; margin: 0; font-size: 28px; font-weight: 700; }
            .content { padding: 40px 30px; }
            .title { font-size: 22px; color: #1F2937; margin-bottom: 15px; font-weight: 700; }
            .message { color: #4B5563; line-height: 1.7; margin-bottom: 25px; font-size: 16px; }
            .details { background-color: #F8FAFC; border-radius: 12px; padding: 25px; margin: 25px 0; border: 1px solid #E2E8F0; }
            .detail-item { display: flex; justify-content: space-between; align-items: center; margin: 12px 0; padding: 8px 0; border-bottom: 1px solid #E5E7EB; }
            .detail-item:last-child { border-bottom: none; }
            .detail-label { color: #6B7280; font-size: 14px; font-weight: 500; }
            .detail-value { color: #1F2937; font-weight: 600; }
            .total { font-size: 18px; color: #166534; font-weight: 700; }
            .divider { border-top: 2px solid #E5E7EB; margin: 30px 0; }
            .footer { background-color: #1F2937; padding: 30px; text-align: center; color: #D1D5DB; font-size: 14px; }
            .footer-logo { font-size: 24px; font-weight: 700; color: #7ED7A5; margin-bottom: 15px; }
            .footer-links a { color: #7ED7A5; text-decoration: none; margin: 0 10px; }
            .copyright { margin-top: 20px; color: #9CA3AF; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Pago Confirmado</h1>
            </div>
            <div class="content">
              <div class="title">¡Gracias por tu pago!</div>
              <div class="message">
                Hemos recibido y confirmado el pago de tu suscripción en <strong>${companyName}</strong>.
                A continuación encontrarás los detalles de tu factura:
              </div>

              <div class="details">
                <div class="detail-item">
                  <span class="detail-label">📄 Número de factura</span>
                  <span class="detail-value">${data.invoiceNumber}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">🏪 Tienda</span>
                  <span class="detail-value">${data.storeName || 'N/A'}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">📅 Período</span>
                  <span class="detail-value">${data.periodStart} – ${data.periodEnd}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">💳 Método de pago</span>
                  <span class="detail-value">${data.paymentMethod || 'Wompi'}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">📋 Plan</span>
                  <span class="detail-value">${data.planName}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label total">💰 Total pagado</span>
                  <span class="detail-value total">${data.amount} ${data.currency}</span>
                </div>
              </div>

              <div class="divider"></div>

              <div style="text-align: center; color: #6B7280; font-size: 14px;">
                Si tienes alguna duda, escríbenos a <a href="mailto:${supportEmail}" style="color: #2F6F4E;">${supportEmail}</a>.
              </div>
            </div>
            <div class="footer">
              <div class="footer-logo">${companyName}</div>
              <div class="footer-links">
                <a href="https://${DomainConfigService.getBaseDomain()}">Sitio Web</a>
                <a href="mailto:${supportEmail}">Soporte</a>
              </div>
              <div class="copyright">
                © ${new Date().getFullYear()} ${companyName}. Todos los derechos reservados.
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `Pago confirmado – Factura ${data.invoiceNumber}\n\nGracias por tu pago en ${companyName}.\n\nDetalles:\n- Factura: ${data.invoiceNumber}\n- Tienda: ${data.storeName || 'N/A'}\n- Período: ${data.periodStart} – ${data.periodEnd}\n- Plan: ${data.planName}\n- Total: ${data.amount} ${data.currency}\n\nSi tienes dudas, escríbenos a ${supportEmail}.`,
    };
  }
}
