import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, store_subscription_state_enum } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionStateService } from '../../../store/subscriptions/services/subscription-state.service';
import { SubscriptionResolverService } from '../../../store/subscriptions/services/subscription-resolver.service';
import { NotificationsService } from '../../../store/notifications/notifications.service';
import { DunningQueryDto } from '../dto';

/**
 * Side-effect descriptor returned by {@link DunningService.previewTransition}.
 * Mirrors the shape consumed by the super-admin DunningPreviewModal.
 */
export interface PreviewSideEffects {
  emails_to_send: Array<{ key: string; to: string; subject: string }>;
  features_lost: string[];
  features_gained: string[];
  invoices_affected: Array<{
    id: number;
    invoice_number: string;
    state: string;
    total: number;
  }>;
  commissions_affected: Array<{
    id: number;
    partner_org_id: number;
    amount: number;
    state: string;
  }>;
}

export interface PreviewTransitionResult {
  legal: boolean;
  current_state: store_subscription_state_enum;
  target_state: store_subscription_state_enum;
  side_effects: PreviewSideEffects;
  warnings: string[];
}

@Injectable()
export class DunningService {
  private readonly logger = new Logger(DunningService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
    private readonly notifications: NotificationsService,
    @InjectQueue('subscription-payment-retry')
    private readonly paymentRetryQueue: Queue,
    @Optional()
    private readonly resolverService?: SubscriptionResolverService,
  ) {}

  async findAll(query: DunningQueryDto) {
    const {
      page = 1,
      limit = 10,
      state,
      organization_id,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

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
            select: {
              id: true,
              invoice_number: true,
              state: true,
              total: true,
              due_at: true,
            },
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

    return {
      grace_soft: graceSoft,
      grace_hard: graceHard,
      suspended,
      blocked,
      total: graceSoft + graceHard + suspended + blocked,
    };
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
      `Tu suscripción al plan ${sub.plan?.name ?? 'sin plan'} requiere atención.`,
      {
        severity,
        subscription_id: sub.id,
        state: sub.state,
        plan_code: sub.plan?.code ?? null,
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

    const result = await this.stateService.transition(
      sub.store_id,
      'cancelled',
      {
        reason: 'superadmin_force_cancel',
        triggeredByUserId: triggeredByUserId ?? undefined,
      },
    );

    return { success: true, subscription: result };
  }

  async enqueueRetryPayment(
    subscriptionId: number,
    triggeredByUserId: number | null = null,
  ) {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: subscriptionId },
      include: {
        invoices: {
          where: { state: { in: ['issued', 'overdue'] } },
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

  /**
   * Compute the side-effects of forcing a state transition WITHOUT mutating
   * anything. Used by the super-admin Dunning UI to preview the impact before
   * the operator actually fires the force-transition.
   *
   * Behavior:
   *  - Validates legality against `SubscriptionStateService.isLegalTransition`.
   *    If illegal, returns `legal=false` with a single Spanish warning and an
   *    empty side-effects payload (UI shows the legal next-states list).
   *  - Determines the emails the StateListener would enqueue for the
   *    transition (cancellation / reactivation / etc.). Mirrors the logic in
   *    `SubscriptionStateListener.onStateChanged`.
   *  - Computes feature deltas: features currently enabled (resolved via
   *    `SubscriptionResolverService`) vs. projected feature set in the target
   *    state. Terminal blocking states (cancelled / suspended / blocked /
   *    expired) project to "no features", so all current features become
   *    `features_lost`.
   *  - Reports invoices in `issued|overdue|partially_paid|draft` that would
   *    be affected if the target is `cancelled` (NOTE: per the NO-REFUNDS
   *    policy these are reported but not auto-voided here).
   *  - Reports `accrued|pending_payout` commissions tied to those invoices.
   *  - Always returns Spanish-language `warnings` for the human reviewer.
   */
  async previewTransition(
    subscriptionId: number,
    targetState: store_subscription_state_enum,
  ): Promise<PreviewTransitionResult> {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: { select: { id: true, code: true, name: true } },
        store: {
          select: {
            id: true,
            name: true,
            organization_id: true,
            organizations: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        partner_override: {
          select: {
            id: true,
            organization_id: true,
            custom_name: true,
          },
        },
        invoices: {
          where: {
            state: { in: ['issued', 'overdue', 'draft'] },
          },
          select: {
            id: true,
            invoice_number: true,
            state: true,
            total: true,
            partner_organization_id: true,
            commission: {
              select: {
                id: true,
                partner_organization_id: true,
                amount: true,
                state: true,
              },
            },
          },
        },
      },
    });

    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const fromState = sub.state;
    const legal = this.stateService.isLegalTransition(fromState, targetState);

    const emptySideEffects: PreviewSideEffects = {
      emails_to_send: [],
      features_lost: [],
      features_gained: [],
      invoices_affected: [],
      commissions_affected: [],
    };

    if (!legal) {
      const allowed = this.legalNextStatesFor(fromState);
      return {
        legal: false,
        current_state: fromState,
        target_state: targetState,
        side_effects: emptySideEffects,
        warnings: [
          `Transición ilegal: no se puede pasar de "${fromState}" a "${targetState}".`,
          allowed.length
            ? `Transiciones permitidas desde "${fromState}": ${allowed.join(', ')}.`
            : `El estado "${fromState}" es terminal (no admite transiciones).`,
        ],
      };
    }

    // -- Emails the StateListener would enqueue for this transition --
    const emails: PreviewSideEffects['emails_to_send'] = [];
    const orgEmail = sub.store?.organizations?.email ?? 'sin-email@store.local';
    const storeName = sub.store?.name ?? `store#${sub.store_id}`;

    if (targetState === 'cancelled') {
      emails.push({
        key: 'subscription.cancellation.email',
        to: orgEmail,
        subject: `Suscripción cancelada — ${storeName} (sin reembolso)`,
      });
    } else if (
      targetState === 'active' &&
      (['cancelled', 'expired', 'suspended', 'blocked'] as string[]).includes(
        fromState,
      )
    ) {
      emails.push({
        key: 'subscription.reactivation.email',
        to: orgEmail,
        subject: `Suscripción reactivada — ${storeName}`,
      });
    } else if (
      targetState === 'active' &&
      (fromState === 'draft' || fromState === 'trial')
    ) {
      emails.push({
        key: 'subscription.welcome.email',
        to: orgEmail,
        subject: `Bienvenido al plan ${sub.plan?.name ?? ''}`,
      });
    } else if (targetState === 'suspended') {
      emails.push({
        key: 'subscription.suspension.notice',
        to: orgEmail,
        subject: `Aviso de suspensión — ${storeName}`,
      });
    } else if (targetState === 'grace_soft' || targetState === 'grace_hard') {
      emails.push({
        key: 'subscription.dunning.notice',
        to: orgEmail,
        subject: `Pago pendiente — ${storeName}`,
      });
    }

    // -- Feature deltas --
    let currentFeatures: string[] = [];
    try {
      if (this.resolverService) {
        const resolved = await this.resolverService.resolveSubscription(
          sub.store_id,
        );
        currentFeatures = Object.entries(resolved.features ?? {})
          .filter(([, cfg]) => (cfg as any)?.enabled)
          .map(([key]) => key);
      }
    } catch (err: any) {
      this.logger.warn(
        `previewTransition: failed to resolve current features for store ${sub.store_id}: ${err?.message ?? err}`,
      );
    }

    // Terminal / blocking target states project to "no features".
    const TARGETS_WITH_NO_FEATURES: store_subscription_state_enum[] = [
      'cancelled',
      'expired',
      'suspended',
      'blocked',
    ];
    const TARGETS_WITH_DUNNING_DEGRADATION: store_subscription_state_enum[] = [
      'grace_soft',
      'grace_hard',
    ];

    const projectedFeatures = TARGETS_WITH_NO_FEATURES.includes(targetState)
      ? []
      : currentFeatures;

    const featuresLost = currentFeatures.filter(
      (k) => !projectedFeatures.includes(k),
    );
    const featuresGained = projectedFeatures.filter(
      (k) => !currentFeatures.includes(k),
    );

    // -- Affected invoices & commissions --
    const targetIsCancellation = targetState === 'cancelled';
    const invoicesAffected = targetIsCancellation
      ? sub.invoices.map((inv) => ({
          id: inv.id,
          invoice_number: inv.invoice_number,
          state: inv.state,
          total: Number(inv.total),
        }))
      : [];

    const commissionsAffected = targetIsCancellation
      ? sub.invoices
          .map((inv) => inv.commission)
          .filter(
            (c): c is NonNullable<typeof c> =>
              !!c && (c.state === 'accrued' || c.state === 'pending_payout'),
          )
          .map((c) => ({
            id: c.id,
            partner_org_id: c.partner_organization_id,
            amount: Number(c.amount),
            state: c.state,
          }))
      : [];

    // -- Spanish warnings --
    const warnings: string[] = [];
    if (featuresLost.length > 0) {
      warnings.push(
        `Esta transición desactivará ${featuresLost.length} feature(s): ${featuresLost.join(', ')}.`,
      );
    }
    if (featuresGained.length > 0) {
      warnings.push(
        `Esta transición habilitará ${featuresGained.length} feature(s): ${featuresGained.join(', ')}.`,
      );
    }
    if (invoicesAffected.length > 0) {
      const totalAmount = invoicesAffected.reduce((s, i) => s + i.total, 0);
      warnings.push(
        `Hay ${invoicesAffected.length} factura(s) pendiente(s) por un total de ${totalAmount.toFixed(2)} ${sub.currency ?? 'COP'}. La política NO-REFUNDS sigue vigente: no se emitirán reembolsos automáticos.`,
      );
    }
    if (commissionsAffected.length > 0) {
      const totalCommission = commissionsAffected.reduce(
        (s, c) => s + c.amount,
        0,
      );
      warnings.push(
        `Hay ${commissionsAffected.length} comisión(es) de partner acumulada(s) por ${totalCommission.toFixed(2)} ${sub.currency ?? 'COP'}. Estas comisiones se mantendrán tal cual están — revisa con finanzas si requieren reverso manual.`,
      );
    }
    if (TARGETS_WITH_DUNNING_DEGRADATION.includes(targetState)) {
      warnings.push(
        'El estado destino activa el flujo de dunning: se enviarán recordatorios de pago al cliente.',
      );
    }
    if (targetIsCancellation) {
      warnings.push(
        'Esta acción es irreversible para el cliente: tendrá que crear una nueva suscripción para reactivar el servicio.',
      );
    }
    if (warnings.length === 0) {
      warnings.push(
        'Esta transición no presenta efectos colaterales destacables.',
      );
    }

    return {
      legal: true,
      current_state: fromState,
      target_state: targetState,
      side_effects: {
        emails_to_send: emails,
        features_lost: featuresLost,
        features_gained: featuresGained,
        invoices_affected: invoicesAffected,
        commissions_affected: commissionsAffected,
      },
      warnings,
    };
  }

  /**
   * Reflect the legal targets defined in the SubscriptionStateService
   * TRANSITIONS map. We probe via the public `isLegalTransition` so we don't
   * couple to the private constant.
   */
  private legalNextStatesFor(
    from: store_subscription_state_enum,
  ): store_subscription_state_enum[] {
    const all: store_subscription_state_enum[] = [
      'draft',
      'pending_payment',
      'trial',
      'active',
      'grace_soft',
      'grace_hard',
      'suspended',
      'blocked',
      'cancelled',
      'expired',
    ];
    return all.filter((to) => this.stateService.isLegalTransition(from, to));
  }
}
