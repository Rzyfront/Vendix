import { Injectable, NotFoundException } from '@nestjs/common';
import { notification_type_enum, Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { NotificationsSseService } from './notifications-sse.service';
import { NotificationsPushService } from './notifications-push.service';
import {
  NotificationDispatcher,
  NotifyRecipientResult,
} from './notification-dispatcher.service';
import { resolveEffectiveChannels } from './notification-catalog';
import { NotificationQueryDto, UpdateSubscriptionDto } from './dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly global_prisma: GlobalPrismaService,
    private readonly sse_service: NotificationsSseService,
    private readonly push_service: NotificationsPushService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) throw new Error('No request context found');
    return context;
  }

  private get notificationsModel() {
    return (this.prisma as any).notifications;
  }

  private get subscriptionsModel() {
    return (this.prisma as any).notification_subscriptions;
  }

  /**
   * Create notification and broadcast via SSE.
   * Uses GlobalPrismaService to bypass request-context scoping,
   * since this method is called from event listeners that may run
   * in ecommerce/customer contexts (not store-admin context).
   */
  async createAndBroadcast(
    store_id: number,
    type: string | notification_type_enum,
    title: string,
    body: string,
    data?: any,
  ) {
    try {
      const notification = await this.global_prisma.notifications.create({
        data: {
          store_id,
          type: type as notification_type_enum,
          title,
          body,
          data,
        },
      });

      this.sse_service.push(store_id, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        created_at: notification.created_at.toISOString(),
      });

      // Fire-and-forget web push — non-blocking, non-throwing
      this.push_service
        .sendToStore(store_id, type, title, body, data)
        .catch(() => {});

      return notification;
    } catch (error) {
      // Log but don't throw - notifications should never break the main flow
      console.error(
        `[NotificationsService] Failed to create notification: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Create a notification and deliver it to ONE user (not the whole store).
   * Uses `booking_check_in` enum + `data.kind = 'provider_turn'` to flag the
   * provider-turn alert so the frontend can apply a distinctive sound + route.
   *
   * Delegates to `NotificationDispatcher` (odd/tasks/recordatorios-notificaciones.md
   * §3.1a), so every targeted notice now honours the user's preferences: the
   * bell + SSE always, the web push only while their "Dispositivo" preference
   * is on, the e-mail only for catalog types whose "Correo" they turned on.
   * Without a saved row the catalog default applies (push on, e-mail off), so
   * nothing changes for anyone who never configured the type.
   *
   * The recipient must belong to THAT store: active staff, or — only through
   * this legacy entry point — one of its customers (order status, booking
   * reschedule…), who never gets e-mail from here. Anyone else gets nothing.
   *
   * Returns the bell row, or null when nothing was delivered (failure or a
   * recipient outside the store). Never throws.
   */
  async sendToUser(
    store_id: number,
    user_id: number,
    type: string | notification_type_enum,
    title: string,
    body: string,
    data?: any,
  ) {
    const result = await this.sendToUserDetailed(
      store_id,
      user_id,
      type,
      title,
      body,
      data,
    );
    return result?.notification ?? null;
  }

  /**
   * Same as `sendToUser`, but answers the dispatcher outcome so a caller can
   * tell a recipient that was discarded (`skipped`: no longer active staff or
   * customer of the store, nothing to retry) from a failed send (`failed`).
   */
  async sendToUserDetailed(
    store_id: number,
    user_id: number,
    type: string | notification_type_enum,
    title: string,
    body: string,
    data?: any,
  ): Promise<NotifyRecipientResult | null> {
    const [result] = await this.dispatcher.notify({
      store_id,
      user_ids: [user_id],
      type,
      title,
      body,
      data,
      allow_store_customers: true,
    });
    return result ?? null;
  }

  /**
   * Step 3 (QR-mesa) — bell filter. The bell shows every notification
   * that is EITHER a store-wide broadcast (no `data.target_user_id` set
   * or the `data` column itself is SQL NULL) OR directed at the caller
   * (`data.target_user_id === user_id`). Notifications targeted at
   * another user are filtered out so a mesero who is NOT assigned to a
   * table does not see the call-waiter bell.
   *
   * Filtering is done in SQL via the Prisma JSON-path `equals` operator
   * (`data->>'target_user_id' IS NULL` for the broadcast branch and
   * `data->>'target_user_id' = $userId` for the targeted branch) — no
   * in-memory filtering, no pagination regression.
   */
  /**
   * QUI-854 — fail-closed multi-tenant. Un consumidor sin `store_id` resuelto
   * (token de tienda roto o viejo) NO debe ver absolutamente nada, ni
   * broadcasts cross-store ni ítems ajenos. Devuelve un resultado vacío.
   */
  private isStaffContext(): boolean {
    const context = RequestContextService.getContext();
    // STORE_ADMIN / ORG_ADMIN / VENDIX_ADMIN son staff. Todo lo demás
    // (STORE_ECOMMERCE, CUSTOMER, etc.) es cliente: solo ve sus propias
    // notificaciones dirigidas, jamás broadcasts de la tienda.
    return (
      context?.app_type === 'STORE_ADMIN' ||
      context?.app_type === 'ORG_ADMIN' ||
      context?.app_type === 'VENDIX_ADMIN'
    );
  }

  async findAll(user_id: number, query_dto: NotificationQueryDto) {
    const { page = 1, limit = 20, type, is_read } = query_dto;
    const skip = (page - 1) * limit;
    const store_id = RequestContextService.getStoreId();

    // QUI-854 — fail-closed: sin store_id no se consulta nada.
    if (!store_id) {
      return {
        data: [],
        unread_count: 0,
        meta: { total: 0, page, limit, total_pages: 0 },
      };
    }

    // Prisma 7 Json path filter with `equals: null` is broken — use raw SQL.
    const conditions: string[] = [`n.store_id = $${1}`];
    const params: any[] = [store_id];
    let idx = 2;

    if (type) {
      conditions.push(`n.type = $${idx++}`);
      params.push(type);
    }
    if (is_read !== undefined) {
      conditions.push(`n.is_read = $${idx++}`);
      params.push(is_read);
    }

    if (this.isStaffContext()) {
      // Staff: show broadcast OR self-targeted notifications.
      conditions.push(`(
        n.data IS NULL
        OR n.data->>'target_user_id' IS NULL
        OR (n.data->>'target_user_id')::int = $${idx++}
      )`);
      params.push(user_id);
    } else {
      // Cliente: SOLO notificaciones dirigidas a él (/ecommerce uso legítimo:
      // booking reschedule, llamadas de mesa). Nunca broadcasts de la tienda.
      conditions.push(`(n.data->>'target_user_id')::int = $${idx++}`);
      params.push(user_id);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Unread count: same filter + is_read = false
    const unreadConditions = [...conditions, `n.is_read = false`];
    const unreadWhere = `WHERE ${unreadConditions.join(' AND ')}`;

    const [data, totalResult, unreadResult] = await Promise.all([
      this.prisma.$queryRawUnsafe<any>(
        `SELECT n.* FROM notifications n ${where} ORDER BY n.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
        ...params,
        limit,
        skip,
      ),
      this.prisma.$queryRawUnsafe<any>(
        `SELECT COUNT(*)::int as total FROM notifications n ${where}`,
        ...params,
      ),
      this.prisma.$queryRawUnsafe<any>(
        `SELECT COUNT(*)::int as total FROM notifications n ${unreadWhere}`,
        ...params,
      ),
    ]);

    const total = totalResult?.[0]?.total ?? 0;
    const unread_count = unreadResult?.[0]?.total ?? 0;

    return {
      data,
      unread_count,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Step 3 (QR-mesa) — unread count applies the same per-user bell
   * filter as `findAll` so the bell badge doesn't inflate with
   * notifications targeted at other users.
   */
  async getUnreadCount(user_id: number) {
    const store_id = RequestContextService.getStoreId();
    // QUI-854 — fail-closed: sin store_id no se cuenta nada.
    if (!store_id) {
      return { count: 0 };
    }
    // Prisma 7 Json path filter with `equals: null` is broken — use raw SQL.
    const conditions: string[] = ['n.is_read = false', `n.store_id = $${1}`];
    const params: any[] = [store_id];
    let idx = 2;

    if (this.isStaffContext()) {
      conditions.push(`(
        n.data IS NULL
        OR n.data->>'target_user_id' IS NULL
        OR (n.data->>'target_user_id')::int = $${idx++}
      )`);
      params.push(user_id);
    } else {
      conditions.push(`(n.data->>'target_user_id')::int = $${idx++}`);
      params.push(user_id);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const result = await this.prisma.$queryRawUnsafe<any>(
      `SELECT COUNT(*)::int as total FROM notifications n ${where}`,
      ...params,
    );

    return { count: result?.[0]?.total ?? 0 };
  }

  async markRead(id: number) {
    const store_id = RequestContextService.getStoreId();
    const user_id = RequestContextService.getUserId();
    // QUI-854 — fail-closed y scoped: solo se puede marcar leída una
    // notificación de la propia tienda; un cliente solo la propia.
    // Prisma 7 JSON path filters están rotos con equals:null — raw SQL.
    const conditions: string[] = [`n.id = $${1}`, `n.store_id = $${2}`];
    const params: any[] = [id, store_id ?? -1];
    let next = 3;

    if (!this.isStaffContext()) {
      conditions.push(`(n.data->>'target_user_id')::int = $${next++}`);
      params.push(user_id);
    }

    const found = await this.prisma.$queryRawUnsafe<any>(
      `SELECT n.id FROM notifications n WHERE ${conditions.join(' AND ')}`,
      ...params,
    );
    if (found.length === 0) {
      throw new NotFoundException(`Notification #${id} not found`);
    }

    return this.notificationsModel.update({
      where: { id },
      data: { is_read: true, updated_at: new Date() },
    });
  }

  async markAllRead() {
    const store_id = RequestContextService.getStoreId();
    const user_id = RequestContextService.getUserId();
    // QUI-854 — mark-all siempre scoped por tienda; un cliente solo marca
    // sus propias notificaciones dirigidas, nunca broadcasts ni ítems ajenos.
    if (!store_id) {
      return { count: 0 };
    }
    const conditions: string[] = [`n.store_id = $${1}`];
    const params: any[] = [store_id];
    let next = 2;

    if (!this.isStaffContext()) {
      conditions.push(`(n.data->>'target_user_id')::int = $${next++}`);
      params.push(user_id);
    }

    const result = await this.prisma.$executeRawUnsafe(
      `UPDATE notifications n SET is_read = true, updated_at = NOW()
       WHERE ${conditions.join(' AND ')}`,
      ...params,
    );
    return { count: result ?? 0 };
  }

  async getSubscriptions(user_id: number) {
    return this.subscriptionsModel.findMany({
      where: { user_id },
    });
  }

  async updateSubscription(user_id: number, dto: UpdateSubscriptionDto) {
    const context = this.getContext();
    const store_id = context.store_id!;
    const defaults = resolveEffectiveChannels(dto.type);

    return this.subscriptionsModel.upsert({
      where: {
        store_id_user_id_type: {
          store_id,
          user_id,
          type: dto.type,
        },
      },
      update: {
        ...(dto.in_app !== undefined && { in_app: dto.in_app }),
        ...(dto.email !== undefined && { email: dto.email }),
      },
      // The channel the request does not send keeps the value the user had in
      // effect until now: the catalog default (D1: e-mail off).
      create: {
        store_id,
        user_id,
        type: dto.type,
        in_app: dto.in_app ?? defaults.push,
        email: dto.email ?? defaults.email,
      },
    });
  }

  async initDefaultSubscriptions(user_id: number) {
    const context = this.getContext();
    const store_id = context.store_id!;

    const types = [
      'new_order',
      'order_status_change',
      'low_stock',
      'new_customer',
      'payment_received',
      'layaway_payment_received',
      'layaway_payment_reminder',
      'layaway_overdue',
      'layaway_completed',
      'layaway_cancelled',
      'new_review',
      // QUI-647 — vencimientos de Cuentas por Pagar. El cron `ApDueNotificationsJob`
      // ya las emite; sin esta fila el web push las filtraba (sendToStore consulta
      // `notification_subscriptions.in_app`) y el toggle no existía en la UI.
      'ap_installment_due_soon',
      'ap_installment_overdue',
      // Recordatorio de cuota de venta a crédito (`CreditInstallmentRemindersJob`).
      'credit_installment_reminder',
      // Billing-warning detection — opt-in bell row for "no recurring credential
      // persisted" and "automatic charge failed" paths. The
      // `SubscriptionPaymentBillingWarningListener` emits both via
      // `notificationsService.createAndBroadcast` after stamping the
      // `billing_warning_logs` dedupe row.
      'auto_renew_disabled_no_credential',
      'auto_renew_charge_failed',
      // H4.3 — recordatorio de marzo para renovar el RNT del hotel; sin la
      // fila el web push lo filtraría. Se apaga en Configuración → Hotelería.
      'lodging_rnt_renewal',
    ];

    const existing = await this.subscriptionsModel.findMany({
      where: { user_id },
    });

    const existing_types = new Set(existing.map((s: any) => s.type));
    const missing = types.filter((t) => !existing_types.has(t));

    if (missing.length > 0) {
      await this.subscriptionsModel.createMany({
        data: missing.map((type) => ({
          store_id,
          user_id,
          type,
          in_app: true,
          email: false,
        })),
      });
    }

    return this.getSubscriptions(user_id);
  }
}
