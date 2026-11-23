import { Injectable } from '@nestjs/common';
import { EmailService } from '../../../email/email.service';
import { EmailBrandingService } from '../../../email/services/email-branding.service';
import { EmailResult } from '../../../email/interfaces/email.interface';
import { buildNotificationEmail } from '../../../email/templates/notification-email.template';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

/** Lo que una entrega de correo necesita para armarse (fila de `notification_deliveries`). */
export interface NotificationEmailDelivery {
  store_id: number;
  to: string;
  first_name: string | null;
  title: string;
  body: string;
  /** Ruta del panel admin (`/admin/...`); cualquier otra cosa se ignora. */
  url: string | null;
}

/**
 * Correo de los avisos personales: maestro de tienda, enlace al dominio admin
 * de ESA tienda y plantilla con su branding. Sin contexto de request: la
 * tienda va siempre explícita.
 */
@Injectable()
export class NotificationEmailService {
  constructor(
    private readonly global_prisma: GlobalPrismaService,
    private readonly email: EmailService,
    private readonly branding: EmailBrandingService,
  ) {}

  /**
   * Maestro de tienda `store_settings.notifications.email_enabled` (plan §3.2):
   * solo un `false` explícito apaga el correo interno de la tienda; sin fila o
   * sin la llave vale el default (`true`). Lanza si no puede leerlo: el
   * llamador decide (no encolar / reintentar).
   */
  async isStoreEmailEnabled(store_id: number): Promise<boolean> {
    const row = await this.global_prisma.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    const settings = row?.settings as
      | { notifications?: { email_enabled?: unknown } }
      | null
      | undefined;
    return settings?.notifications?.email_enabled !== false;
  }

  /**
   * URL absoluta del botón: dominio admin activo de la tienda + ruta del aviso.
   * Solo rutas relativas del panel (`/algo`, nunca `//host` ni URLs absolutas):
   * el correo no puede convertirse en un redirector a otro sitio.
   */
  async buildActionUrl(store_id: number, url: string | null): Promise<string | null> {
    if (!url || !url.startsWith('/') || url.startsWith('//') || /\s/.test(url)) {
      return null;
    }
    const domain = await this.global_prisma.domain_settings.findFirst({
      where: { store_id, app_type: 'STORE_ADMIN', status: 'active' },
      orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
      select: { hostname: true },
    });
    return domain?.hostname ? `https://${domain.hostname}${url}` : null;
  }

  async send(delivery: NotificationEmailDelivery): Promise<EmailResult> {
    const [branding, store, actionUrl] = await Promise.all([
      this.branding.getStoreBranding(delivery.store_id),
      this.global_prisma.stores.findUnique({
        where: { id: delivery.store_id },
        select: { name: true },
      }),
      this.buildActionUrl(delivery.store_id, delivery.url),
    ]);
    const message = buildNotificationEmail({
      firstName: delivery.first_name,
      storeName: store?.name ?? branding.store_name ?? branding.company_name ?? null,
      title: delivery.title,
      body: delivery.body,
      actionUrl,
      primaryColor: branding.primary_color ?? null,
      secondaryColor: branding.secondary_color ?? null,
    });
    return this.email.sendEmail(delivery.to, message.subject, message.html, message.text);
  }
}
