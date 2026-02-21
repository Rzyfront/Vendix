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
      this.push_service.sendToStore(store_id, type as string, title, body, data).catch(() => {});

      return notification;
    } catch (error) {
      // Log but don't throw - notifications should never break the main flow
      console.error(`[NotificationsService] Failed to create notification: ${error.message}`);
      return null;
    }
  }

  async findAll(query_dto: NotificationQueryDto) {
    const { page = 1, limit = 20, type, is_read } = query_dto;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (type) where.type = type;
    if (is_read !== undefined) where.is_read = is_read;

    const [data, total] = await Promise.all([
      this.notificationsModel.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.notificationsModel.count({ where }),
    ]);

    const unread_count = await this.notificationsModel.count({
      where: { is_read: false },
    });

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

  async getUnreadCount() {
    const count = await this.notificationsModel.count({
      where: { is_read: false },
    });
    return { count };
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
