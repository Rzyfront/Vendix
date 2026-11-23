import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import {
  NotificationPreferenceGroup,
  NotificationPreferencesService,
} from './notification-preferences.service';
import { NotificationsPushService } from './notifications-push.service';
import { NotificationEmailService } from './notification-email.service';
import { NotificationRecipientsService } from './notification-recipients.service';

/** Entre dos pruebas del mismo usuario en la misma tienda. */
export const NOTIFICATION_TEST_COOLDOWN_MS = 30_000;
export const MY_NOTIFICATIONS_ROUTE = '/admin/my-notifications';

export interface MyNotificationsView {
  groups: NotificationPreferenceGroup[];
  /** Maestro de tienda `notifications.email_enabled`. */
  store_email_enabled: boolean;
  /** Correo del usuario enmascarado (`j***@dominio.com`), o null si no tiene. */
  user_email: string | null;
}

export type NotificationTestEmailStatus =
  | 'sent'
  | 'off'
  | 'no_email'
  | 'store_disabled'
  | 'failed';

export interface NotificationTestResult {
  /** `enabled`: tiene al menos un aviso con Dispositivo encendido. */
  push: { enabled: boolean; devices: number };
  email: { status: NotificationTestEmailStatus; to: string | null };
}

/** `juan@correo.com` → `j***@correo.com`. */
export function maskEmail(email: string | null | undefined): string | null {
  const value = email?.trim();
  if (!value) return null;
  const at = value.lastIndexOf('@');
  if (at < 1) return '***';
  return `${value[0]}***${value.slice(at)}`;
}

/**
 * Pantalla "Mis notificaciones" (plan §3.2): lo que ve y prueba cada persona
 * del personal en SU tienda. No requiere permisos de configuración: solo
 * usuario y tienda en contexto.
 */
@Injectable()
export class MyNotificationsService {
  private readonly logger = new Logger(MyNotificationsService.name);
  /** Última prueba por `tienda:usuario` (freno blando por proceso). */
  private readonly lastTest = new Map<string, number>();

  constructor(
    private readonly global_prisma: GlobalPrismaService,
    private readonly preferences: NotificationPreferencesService,
    private readonly push_service: NotificationsPushService,
    private readonly email_service: NotificationEmailService,
    private readonly recipients: NotificationRecipientsService,
  ) {}

  async getView(store_id: number, user_id: number): Promise<MyNotificationsView> {
    const [groups, user, store_email_enabled] = await Promise.all([
      this.preferences.getGroupedForUser(store_id, user_id),
      this.global_prisma.users.findUnique({
        where: { id: user_id },
        select: { email: true },
      }),
      this.email_service.isStoreEmailEnabled(store_id).catch((error: unknown) => {
        this.logger.warn(
          `Store ${store_id} email master unreadable: ${(error as Error)?.message}`,
        );
        return true;
      }),
    ]);
    return { groups, store_email_enabled, user_email: maskEmail(user?.email) };
  }

  /**
   * "Enviarme una prueba": un aviso al propio usuario por los canales que
   * tenga encendidos en al menos un tipo. El correo se envía en el acto (no
   * pasa por la cola) para que la persona vea si llegó o por qué no.
   */
  async sendTest(
    store_id: number,
    user_id: number,
    now: number = Date.now(),
  ): Promise<NotificationTestResult> {
    const key = `${store_id}:${user_id}`;
    const last = this.lastTest.get(key);
    if (last !== undefined && now - last < NOTIFICATION_TEST_COOLDOWN_MS) {
      throw new VendixHttpException(ErrorCodes.NOTIFICATION_TEST_RATE_LIMITED);
    }
    this.lastTest.set(key, now);

    const recipient = (await this.recipients.classify(store_id, [user_id])).get(user_id);
    if (!recipient || recipient.kind !== 'staff') {
      return { push: { enabled: false, devices: 0 }, email: { status: 'off', to: null } };
    }

    const types = (await this.preferences.getGroupedForUser(store_id, user_id)).flatMap(
      (group) => group.types,
    );
    const pushOn = types.some((t) => t.channels.push && t.effective.push);
    const emailOn = types.some((t) => t.channels.email && t.effective.email);
    const title = 'Aviso de prueba';
    const body = 'Así te llegarán los avisos de Vendix.';

    let devices = 0;
    if (pushOn) {
      devices = await this.global_prisma.push_subscriptions.count({
        where: { store_id, user_id },
      });
      if (devices > 0) {
        await this.push_service.sendToUser(store_id, user_id, 'notification_test', title, body, {
          url: MY_NOTIFICATIONS_ROUTE,
        });
      }
    }

    const to = maskEmail(recipient.email);
    let status: NotificationTestEmailStatus;
    if (!emailOn) status = 'off';
    else if (!recipient.email) status = 'no_email';
    else if (!(await this.storeEmailEnabled(store_id))) status = 'store_disabled';
    else {
      const result = await this.email_service.send({
        store_id,
        to: recipient.email,
        first_name: recipient.first_name,
        title,
        body,
        url: MY_NOTIFICATIONS_ROUTE,
      });
      status = result.success ? 'sent' : 'failed';
      if (!result.success) {
        this.logger.warn(`Test e-mail to user ${user_id} (store ${store_id}) failed: ${result.error}`);
      }
    }
    return { push: { enabled: pushOn, devices }, email: { status, to } };
  }

  private async storeEmailEnabled(store_id: number): Promise<boolean> {
    try {
      return await this.email_service.isStoreEmailEnabled(store_id);
    } catch {
      return false;
    }
  }
}
