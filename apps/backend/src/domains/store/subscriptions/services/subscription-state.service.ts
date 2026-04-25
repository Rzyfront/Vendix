import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Prisma,
  store_subscription_state_enum,
  store_subscriptions,
} from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionAccessService } from './subscription-access.service';

type State = store_subscription_state_enum;

/**
 * Allowed transitions between subscription states. Terminal states
 * (`cancelled`, `expired`) have no outgoing edges.
 */
const TRANSITIONS: Record<State, readonly State[]> = {
  draft: ['trial', 'active'],
  trial: ['active', 'blocked', 'cancelled', 'expired'],
  active: ['grace_soft', 'cancelled', 'expired'],
  grace_soft: ['active', 'grace_hard', 'cancelled'],
  grace_hard: ['active', 'suspended', 'cancelled'],
  suspended: ['active', 'blocked', 'cancelled'],
  blocked: ['active', 'cancelled'],
  cancelled: [],
  expired: [],
};

export interface TransitionOptions {
  reason: string;
  triggeredByUserId?: number;
  triggeredByJob?: string;
  payload?: Record<string, unknown>;
}

/**
 * Mutates `store_subscriptions.state` with a legal transition, writes a
 * `subscription_events` audit row, invalidates access cache, and emits a
 * NestJS event. All inside a Serializable transaction with SELECT FOR UPDATE
 * to prevent TOCTOU races.
 */
@Injectable()
export class SubscriptionStateService {
  private readonly logger = new Logger(SubscriptionStateService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly accessService: SubscriptionAccessService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async transition(
    storeId: number,
    toState: State,
    opts: TransitionOptions,
  ): Promise<store_subscriptions> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }

    const { fromState, updated } = await this.prisma.$transaction(
      async (tx: any) => {
        // FOR UPDATE lock on the subscription row.
        const locked = (await tx.$queryRaw(
          Prisma.sql`SELECT id, state FROM store_subscriptions WHERE store_id = ${storeId} FOR UPDATE`,
        )) as Array<{ id: number; state: State }>;

        if (!locked.length) {
          throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
        }

        const current = locked[0];
        const currentState = current.state;

        if (currentState === toState) {
          // No-op transition — still log event for auditability but skip update.
          const existing = await tx.store_subscriptions.findUniqueOrThrow({
            where: { id: current.id },
          });
          return { fromState: currentState, updated: existing };
        }

        if (!this.isLegalTransition(currentState, toState)) {
          throw new VendixHttpException(
            ErrorCodes.SUBSCRIPTION_010,
            `Illegal transition ${currentState} -> ${toState}`,
          );
        }

        const updatedRow = await tx.store_subscriptions.update({
          where: { id: current.id },
          data: {
            state: toState,
            updated_at: new Date(),
          },
        });

        await tx.subscription_events.create({
          data: {
            store_subscription_id: current.id,
            type: 'state_transition',
            from_state: currentState,
            to_state: toState,
            payload: {
              reason: opts.reason,
              ...(opts.payload ?? {}),
            } as Prisma.InputJsonValue,
            triggered_by_user_id: opts.triggeredByUserId ?? null,
            triggered_by_job: opts.triggeredByJob ?? null,
          },
        });

        return { fromState: currentState, updated: updatedRow };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Post-commit side effects. Failures here must NOT roll back the
    // transition (it already committed). Log + best-effort only.
    try {
      await this.accessService.invalidateCache(storeId);
    } catch (err) {
      this.logger.warn(
        `Post-transition cache invalidation failed for store ${storeId}: ${(err as Error).message}`,
      );
    }

    this.eventEmitter.emit('subscription.state.changed', {
      storeId,
      fromState,
      toState,
      reason: opts.reason,
      triggeredByUserId: opts.triggeredByUserId,
      triggeredByJob: opts.triggeredByJob,
    });

    return updated;
  }

  isLegalTransition(from: State, to: State): boolean {
    return TRANSITIONS[from]?.includes(to) ?? false;
  }
}
