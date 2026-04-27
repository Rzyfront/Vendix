import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionStateService } from '../../../store/subscriptions/services/subscription-state.service';
import { NotificationsService } from '../../../store/notifications/notifications.service';
import { DunningQueryDto } from '../dto';

@Injectable()
export class DunningService {
  private readonly logger = new Logger(DunningService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
    private readonly notifications: NotificationsService,
    @InjectQueue('subscription-payment-retry')
    private readonly paymentRetryQueue: Queue,
  ) {}

  async findAll(query: DunningQueryDto) {
    const { page = 1, limit = 10, state, organization_id, search, sort_by = 'created_at', sort_order = 'desc' } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.store_subscriptionsWhereInput = {
      state: { in: ['grace_soft', 'grace_hard', 'suspended', 'blocked'] },
    };

    if (state) {
      where.state = state as any;
    }

    if (organization_id) {
      where.store = { organization_id };
    }

    if (search) {
      where.store = {
        ...((where.store as any) || {}),
        name: { contains: search, mode: 'insensitive' },
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.store_subscriptions.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
        include: {
          plan: { select: { id: true, code: true, name: true } },
          store: {
            select: {
              id: true,
              name: true,
              organization_id: true,
              organizations: { select: { id: true, name: true } },
            },
          },
          invoices: {
            where: { state: { in: ['overdue', 'draft'] } },
            take: 1,
            orderBy: { due_at: 'asc' },
            select: { id: true, invoice_number: true, state: true, total: true, due_at: true },
          },
        },
      }),
      this.prisma.store_subscriptions.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async getStats() {
    const [graceSoft, graceHard, suspended, blocked] = await Promise.all([
      this.prisma.store_subscriptions.count({ where: { state: 'grace_soft' } }),
      this.prisma.store_subscriptions.count({ where: { state: 'grace_hard' } }),
      this.prisma.store_subscriptions.count({ where: { state: 'suspended' } }),
      this.prisma.store_subscriptions.count({ where: { state: 'blocked' } }),
    ]);

    return { grace_soft: graceSoft, grace_hard: graceHard, suspended, blocked, total: graceSoft + graceHard + suspended + blocked };
  }

  async sendReminder(subscriptionId: number, triggeredByUserId: number | null) {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: { select: { name: true, code: true } },
        store: { select: { id: true, name: true } },
      },
    });

    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const severity = sub.state === 'grace_hard' ? 'critical' : 'warning';
    const type =
      sub.state === 'grace_hard'
        ? 'subscription_payment_reminder_hard'
        : 'subscription_payment_reminder_soft';

    await this.notifications.createAndBroadcast(
      sub.store_id,
      type,
      'Recordatorio de pago pendiente',
      `Tu suscripción al plan ${sub.plan.name} requiere atención.`,
      {
        severity,
        subscription_id: sub.id,
        state: sub.state,
        plan_code: sub.plan.code,
        triggered_by_user_id: triggeredByUserId,
      },
    );

    await this.prisma.subscription_events.create({
      data: {
        store_subscription_id: sub.id,
        type: 'state_transition',
        from_state: sub.state,
        to_state: sub.state,
        payload: {
          reason: 'manual_reminder_sent',
          notification_type: type,
        } as Prisma.InputJsonValue,
        triggered_by_user_id: triggeredByUserId,
      },
    });

    return { success: true, subscription_id: sub.id, notification_type: type };
  }

  async forceCancel(subscriptionId: number, triggeredByUserId: number | null) {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: subscriptionId },
      select: { id: true, store_id: true, state: true },
    });

    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const result = await this.stateService.transition(sub.store_id, 'cancelled', {
      reason: 'superadmin_force_cancel',
      triggeredByUserId: triggeredByUserId ?? undefined,
    });

    return { success: true, subscription: result };
  }

  async enqueueRetryPayment(subscriptionId: number, triggeredByUserId: number | null = null) {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: subscriptionId },
      include: {
        invoices: {
          where: { state: { in: ['issued', 'overdue', 'partially_paid'] } },
          orderBy: { due_at: 'asc' },
          take: 1,
        },
      },
    });

    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const invoice = sub.invoices[0];
    if (!invoice) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'No pending invoice to retry',
      );
    }

    const job = await this.paymentRetryQueue.add(
      'manual-retry',
      {
        invoiceId: invoice.id,
        subscriptionId: sub.id,
        attempt: 0,
      },
      {
        // No backoff delay — superadmin manual trigger fires immediately
        attempts: 1,
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400 },
      },
    );

    await this.prisma.subscription_events.create({
      data: {
        store_subscription_id: sub.id,
        type: 'state_transition',
        from_state: sub.state,
        to_state: sub.state,
        payload: {
          reason: 'manual_payment_retry_enqueued',
          invoice_id: invoice.id,
          job_id: job.id,
          triggered_by: 'superadmin',
        } as Prisma.InputJsonValue,
        triggered_by_user_id: triggeredByUserId,
      },
    });

    this.logger.log(
      `Enqueued manual payment retry for subscription ${sub.id}, invoice ${invoice.id}, job ${job.id}`,
    );

    return {
      success: true,
      subscription_id: sub.id,
      invoice_id: invoice.id,
      job_id: job.id,
      enqueued_at: new Date().toISOString(),
    };
  }
}
