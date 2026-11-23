import { Injectable, Logger } from '@nestjs/common';
import { notification_type_enum, notifications, Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { NotificationsSseService } from './notifications-sse.service';
import { NotificationsPushService } from './notifications-push.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import {
  NotificationRecipient,
  NotificationRecipientsService,
} from './notification-recipients.service';
import { NotificationEmailService } from './notification-email.service';
import { getNotificationCatalogEntry } from './notification-catalog';

export interface NotifyInput {
  store_id: number;
  user_ids: number[];
  type: notification_type_enum | string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  /**
   * Idempotencia de las entregas por canal (hoy el correo): una sola fila por
   * (tienda, usuario, canal, dedupe_key). Sin clave se usa la fila de la
   * campana (`notification:<id>`), única por llamada.
   */
  dedupe_key?: string | null;
  /**
   * Solo el puente legado `sendToUser`: acepta clientes finales vinculados a
   * la tienda (campana + dispositivo, nunca correo). Por defecto, solo
   * personal activo de la tienda.
   */
  allow_store_customers?: boolean;
}

/** Qué pasó con el correo de un destinatario. */
export type NotifyEmailOutcome =
  | 'queued'
  | 'duplicate'
  | 'off'
  | 'not_supported'
  | 'no_email'
  | 'store_disabled'
  | 'failed';

export interface NotifyRecipientResult {
  user_id: number;
  status: 'delivered' | 'skipped' | 'failed';
  /** Por qué no se entregó (status `skipped`/`failed`). */
  reason?: 'not_store_member' | 'error';
  notification: notifications | null;
  push: boolean;
  email: NotifyEmailOutcome | null;
}

/** Contenido de la entrega tal como se mostró en la campana. */
export interface NotificationDeliveryPayload {
  title: string;
  body: string;
  url: string | null;
}

/**
 * Única puerta de los avisos personales (odd/tasks/recordatorios-notificaciones.md
 * §3.1a). Por cada destinatario:
 *
 * 1. Lo descarta si no es personal activo de ESA tienda (o cliente de la
 *    tienda, solo con `allow_store_customers`). Nunca avisa a otra tienda.
 * 2. Campana: fila en `notifications` con `data.target_user_id` + SSE a su
 *    subject. Siempre: es el historial.
 * 3. Dispositivo: web push a sus `push_subscriptions` de esa tienda, solo si
 *    su preferencia efectiva de Dispositivo está encendida.
 * 4. Correo: fila en `notification_deliveries` (idempotente por dedupe_key)
 *    solo si su preferencia efectiva de Correo está encendida, tiene correo y
 *    el maestro de tienda no lo apagó. La entrega real la hace
 *    `NotificationDeliveriesJob` con reintentos.
 *
 * Nunca lanza: un aviso jamás rompe el flujo de negocio que lo origina.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly global_prisma: GlobalPrismaService,
    private readonly sse_service: NotificationsSseService,
    private readonly push_service: NotificationsPushService,
    private readonly preferences: NotificationPreferencesService,
    private readonly recipients: NotificationRecipientsService,
    private readonly email_service: NotificationEmailService,
  ) {}

  async notify(input: NotifyInput): Promise<NotifyRecipientResult[]> {
    const type = String(input.type);
    const user_ids = [...new Set(input.user_ids)];
    try {
      const eligible = await this.recipients.classify(input.store_id, user_ids, {
        allow_store_customers: input.allow_store_customers,
      });
      const skipped: NotifyRecipientResult[] = user_ids
        .filter((id) => !eligible.has(id))
        .map((user_id) => ({
          user_id,
          status: 'skipped',
          reason: 'not_store_member',
          notification: null,
          push: false,
          email: null,
        }));
      if (skipped.length > 0) {
        this.logger.debug(
          `[${type}] store ${input.store_id}: skipped users ${skipped
            .map((s) => s.user_id)
            .join(',')} (not active members of the store)`,
        );
      }
      if (eligible.size === 0) return skipped;

      const prefs = await this.preferences.resolveForUsers(
        input.store_id,
        [...eligible.keys()],
        type,
      );
      const emailCapable = getNotificationCatalogEntry(type)?.channels.email ?? false;
      const storeEmail = await this.storeEmailEnabled(
        input.store_id,
        emailCapable && [...eligible.values()].some(
          (r) => r.kind === 'staff' && prefs.get(r.user_id)?.email,
        ),
      );

      const delivered: NotifyRecipientResult[] = [];
      for (const recipient of eligible.values()) {
        delivered.push(
          await this.deliverTo(input, type, recipient, {
            push: prefs.get(recipient.user_id)?.push ?? true,
            email: prefs.get(recipient.user_id)?.email ?? false,
            emailCapable,
            storeEmail,
          }),
        );
      }
      return [...skipped, ...delivered];
    } catch (error) {
      this.logger.error(
        `[${type}] notify failed for store ${input.store_id}: ${(error as Error)?.message}`,
      );
      return user_ids.map((user_id) => ({
        user_id,
        status: 'failed',
        reason: 'error',
        notification: null,
        push: false,
        email: null,
      }));
    }
  }

  /** `null` = no hizo falta mirarlo (nadie pidió correo). */
  private async storeEmailEnabled(
    store_id: number,
    needed: boolean,
  ): Promise<boolean | null> {
    if (!needed) return null;
    try {
      return await this.email_service.isStoreEmailEnabled(store_id);
    } catch (error) {
      // Sin poder leer el maestro no se encola: mejor un correo menos que uno
      // que el dueño apagó.
      this.logger.warn(
        `Store ${store_id} email master unreadable; e-mail not queued: ${(error as Error)?.message}`,
      );
      return false;
    }
  }

  private async deliverTo(
    input: NotifyInput,
    type: string,
    recipient: NotificationRecipient,
    channels: {
      push: boolean;
      email: boolean;
      emailCapable: boolean;
      storeEmail: boolean | null;
    },
  ): Promise<NotifyRecipientResult> {
    const { store_id } = input;
    const user_id = recipient.user_id;
    try {
      const notification = await this.global_prisma.notifications.create({
        data: {
          store_id,
          type: type as notification_type_enum,
          title: input.title,
          body: input.body,
          data: { ...(input.data ?? {}), target_user_id: user_id } as Prisma.InputJsonValue,
        },
      });

      this.sse_service.pushToUser(store_id, user_id, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        created_at: notification.created_at.toISOString(),
      });

      if (channels.push) {
        // Fire-and-forget, igual que antes: el push nunca bloquea ni lanza.
        this.push_service
          .sendToUser(store_id, user_id, type, input.title, input.body, input.data ?? undefined)
          .catch(() => {});
      }

      const email = await this.queueEmail(input, type, recipient, notification, channels);
      return {
        user_id,
        status: 'delivered',
        notification,
        push: channels.push,
        email,
      };
    } catch (error) {
      this.logger.error(
        `[${type}] delivery to user ${user_id} (store ${store_id}) failed: ${(error as Error)?.message}`,
      );
      return {
        user_id,
        status: 'failed',
        reason: 'error',
        notification: null,
        push: false,
        email: null,
      };
    }
  }

  private async queueEmail(
    input: NotifyInput,
    type: string,
    recipient: NotificationRecipient,
    notification: notifications,
    channels: { email: boolean; emailCapable: boolean; storeEmail: boolean | null },
  ): Promise<NotifyEmailOutcome> {
    if (!channels.emailCapable || recipient.kind !== 'staff') return 'not_supported';
    if (!channels.email) return 'off';
    if (!recipient.email) return 'no_email';
    if (channels.storeEmail === false) return 'store_disabled';

    const payload: NotificationDeliveryPayload = {
      title: input.title,
      body: input.body,
      url: extractUrl(input.data),
    };
    try {
      const { count } = await this.global_prisma.notification_deliveries.createMany({
        data: [
          {
            store_id: input.store_id,
            notification_id: notification.id,
            user_id: recipient.user_id,
            channel: 'email',
            type: type as notification_type_enum,
            dedupe_key: (input.dedupe_key || `notification:${notification.id}`).slice(0, 191),
            payload: payload as unknown as Prisma.InputJsonValue,
          },
        ],
        skipDuplicates: true,
      });
      return count > 0 ? 'queued' : 'duplicate';
    } catch (error) {
      this.logger.error(
        `[${type}] e-mail delivery not queued for user ${recipient.user_id} (store ${input.store_id}): ${(error as Error)?.message}`,
      );
      return 'failed';
    }
  }
}

/** Ruta del aviso: `data.url` (CRM, bitácora, Flujos) o `data.route` (reparto). */
function extractUrl(data: NotifyInput['data']): string | null {
  const candidate = data?.url ?? data?.route;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}
