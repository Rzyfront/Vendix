import { Injectable, NotFoundException } from '@nestjs/common';
import { notification_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { NotificationsSseService } from './notifications-sse.service';
import { NotificationsPushService } from './notifications-push.service';
import { NotificationQueryDto, UpdateSubscriptionDto } from './dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly global_prisma: GlobalPrismaService,
    private readonly sse_service: NotificationsSseService,
    private readonly push_service: NotificationsPushService,
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
   * Mirrors `createAndBroadcast` but targets the user's SSE subject and pushes
   * to that user's push subscriptions only — other users in the store do NOT
   * see the bell or get the web push.
   */
  async sendToUser(
    store_id: number,
    user_id: number,
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
          data: { ...data, target_user_id: user_id },
        },
      });

      // Targeted SSE push — only the user subject emits.
      this.sse_service.pushToUser(store_id, user_id, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        created_at: notification.created_at.toISOString(),
      });

      // Targeted web push — only that user's devices.
      this.push_service
        .sendToUser(store_id, user_id, type, title, body, data)
        .catch(() => {});

      return notification;
    } catch (error) {
      console.error(
        `[NotificationsService.sendToUser] Failed: ${error.message}`,
      );
      return null;
    }
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
  async findAll(user_id: number, query_dto: NotificationQueryDto) {
    const { page = 1, limit = 20, type, is_read } = query_dto;
    const skip = (page - 1) * limit;
    const store_id = RequestContextService.getStoreId();

    // Prisma 7 Json path filter with `equals: null` is broken — use raw SQL.
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (store_id) {
      conditions.push(`n.store_id = $${idx++}`);
      params.push(store_id);
    }
    if (type) {
      conditions.push(`n.type = $${idx++}`);
      params.push(type);
    }
    if (is_read !== undefined) {
      conditions.push(`n.is_read = $${idx++}`);
      params.push(is_read);
    }

    // Target-user bell filter: show broadcast OR self-targeted notifications.
    conditions.push(`(
      n.data IS NULL
      OR n.data->>'target_user_id' IS NULL
      OR (n.data->>'target_user_id')::int = $${idx++}
    )`);
    params.push(user_id);

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
    // Prisma 7 Json path filter with `equals: null` is broken — use raw SQL.
    const conditions: string[] = ['n.is_read = false'];
    const params: any[] = [];
    let idx = 1;

    if (store_id) {
      conditions.push(`n.store_id = $${idx++}`);
      params.push(store_id);
    }

    conditions.push(`(
      n.data IS NULL
      OR n.data->>'target_user_id' IS NULL
      OR (n.data->>'target_user_id')::int = $${idx++}
    )`);
    params.push(user_id);

    const where = `WHERE ${conditions.join(' AND ')}`;
    const result = await this.prisma.$queryRawUnsafe<any>(
      `SELECT COUNT(*)::int as total FROM notifications n ${where}`,
      ...params,
    );

    return { count: result?.[0]?.total ?? 0 };
  }

  async markRead(id: number) {
    const notification = await this.notificationsModel.findFirst({
      where: { id },
    });

    if (!notification) {
      throw new NotFoundException(`Notification #${id} not found`);
    }

    return this.notificationsModel.update({
      where: { id },
      data: { is_read: true, updated_at: new Date() },
    });
  }

  async markAllRead() {
    return this.notificationsModel.updateMany({
      where: { is_read: false },
      data: { is_read: true, updated_at: new Date() },
    });
  }

  async getSubscriptions(user_id: number) {
    return this.subscriptionsModel.findMany({
      where: { user_id },
    });
  }

  async updateSubscription(user_id: number, dto: UpdateSubscriptionDto) {
    const context = this.getContext();
    const store_id = context.store_id!;

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
      create: {
        store_id,
        user_id,
        type: dto.type,
        in_app: dto.in_app ?? true,
        email: dto.email ?? false,
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
