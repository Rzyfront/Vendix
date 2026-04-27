import { Injectable, Logger } from '@nestjs/common';
import { Prisma, store_subscriptions } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  ErrorCodes,
  VendixHttpException,
} from '../../../../common/errors';

/**
 * SubscriptionTrialService
 *
 * Bootstraps a trial subscription for the FIRST store of an organization.
 *
 * Auto-trial contract (one-shot per organization in its lifetime):
 *   - `organization_trial_consumptions.organization_id` (UNIQUE) is the
 *     authoritative concurrency-safe enforcement primitive: a second
 *     concurrent INSERT raises P2002 and we surface it as
 *     `SUBSCRIPTION_TRIAL_001`.
 *   - `organizations.has_consumed_trial` is dual-written for one release
 *     of back-compat with services/queries that still read the boolean.
 *     New code MUST query `organization_trial_consumptions` instead.
 *   - If the org has consumed its trial (even after deleting all stores),
 *     this service is a no-op — the caller must purchase a plan instead.
 *   - The `subscription_plans.is_default = true` row is the ONE trial plan
 *     used for the entire platform (no partner-specific defaults).
 *
 * Concurrency:
 *   - The org row is locked with `SELECT ... FOR UPDATE` inside the
 *     transaction so two concurrent first-store creations cannot both
 *     reach the audit INSERT, but the UNIQUE constraint on
 *     `organization_trial_consumptions.organization_id` is the final
 *     defensive layer (covers external writers that bypass FOR UPDATE).
 *
 * Failure semantics:
 *   - In normal operation the method NEVER throws — it returns `null` and
 *     logs the reason (org missing, default plan missing, already consumed).
 *   - When the caller passes its own `tx`, internal Prisma errors are
 *     re-thrown so the caller's transaction rolls back. This is the only
 *     case where the method propagates.
 */
@Injectable()
export class SubscriptionTrialService {
  private readonly logger = new Logger(SubscriptionTrialService.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Create a trial `store_subscriptions` row for the given store.
   *
   * @param storeId        The newly-created store id.
   * @param organizationId The owning organization id (used for the
   *                       `has_consumed_trial` flag).
   * @param tx             Optional Prisma transaction client. When provided,
   *                       this method runs inside the caller's transaction
   *                       (so the FOR UPDATE lock and writes are atomic with
   *                       the surrounding store-creation flow). When omitted,
   *                       this method opens its own `$transaction`.
   * @returns The created `store_subscriptions` row, or `null` when the
   *          trial was skipped (org not found, plan not configured, or trial
   *          already consumed).
   */
  async createTrialForStore(
    storeId: number,
    organizationId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<store_subscriptions | null> {
    this.logger.log(
      `creating trial for store ${storeId} in org ${organizationId}`,
    );

    // When caller passed a tx, run inside it and let errors propagate so the
    // caller's outer transaction rolls back. When no tx, open our own and
    // swallow errors (graceful no-throw contract for store-creation paths).
    if (tx) {
      return this.runInTransaction(tx, storeId, organizationId);
    }

    try {
      return await this.prisma.$transaction(
        async (innerTx: Prisma.TransactionClient) => {
          return this.runInTransaction(innerTx, storeId, organizationId);
        },
      );
    } catch (error) {
      this.logger.error(
        `failed to create trial: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Don't throw — never break store creation on trial bootstrap failure.
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Core trial bootstrap, executed inside an active Prisma transaction.
   *
   * Order matters:
   *   1. `SELECT ... FOR UPDATE` on organizations to serialize concurrent
   *      first-store creations.
   *   2. Skip if `has_consumed_trial = true` (return null silently).
   *   3. Resolve default plan, or fail gracefully if none configured.
   *   4. Resolve trial duration via `platform_settings.findUnique({key:'core'})`.
   *   5. Create the subscription.
   *   6. Write the `subscription_events(trial_started)` state-machine audit.
   *   7. Insert `organization_trial_consumptions` row (UNIQUE check — P2002
   *      maps to SUBSCRIPTION_TRIAL_001).
   *   8. Dual-write `organizations.has_consumed_trial = true` LAST so a
   *      failure earlier rolls back the flag flip too. Kept for one-release
   *      back-compat with legacy readers.
   */
  private async runInTransaction(
    tx: Prisma.TransactionClient,
    storeId: number,
    organizationId: number,
  ): Promise<store_subscriptions | null> {
    // 1. Lock the org row to prevent concurrent trial consumption.
    const lockedRows = (await tx.$queryRaw(
      Prisma.sql`SELECT id, has_consumed_trial FROM organizations WHERE id = ${organizationId} FOR UPDATE`,
    )) as Array<{ id: number; has_consumed_trial: boolean }>;

    if (!lockedRows.length) {
      this.logger.error(
        `organization ${organizationId} not found, cannot bootstrap trial for store ${storeId}`,
      );
      return null;
    }

    const orgRow = lockedRows[0];

    // 2. One-shot per org: skip silently if trial already consumed.
    if (orgRow.has_consumed_trial === true) {
      this.logger.log(
        `trial already consumed for org ${organizationId}, skipping`,
      );
      return null;
    }

    // 3. Resolve the single platform-wide default trial plan.
    const plan = await tx.subscription_plans.findFirst({
      where: {
        is_default: true,
        state: 'active',
        archived_at: null,
      },
    });

    if (!plan) {
      this.logger.error(
        `no default plan available; cannot bootstrap trial for store ${storeId}`,
      );
      return null;
    }

    // 4. Compute trial duration: plan override > platform default > 14.
    //    Migration 20260427000000_platform_settings_seed_core guarantees
    //    that the canonical row with key='core' exists, so we use the
    //    deterministic findUnique() instead of findFirst().
    const platformSettings = await tx.platform_settings.findUnique({
      where: { key: 'core' },
    });
    const platformDefaultTrialDays =
      platformSettings?.default_trial_days ?? 14;
    const trialDays =
      plan.trial_days && plan.trial_days > 0
        ? plan.trial_days
        : platformDefaultTrialDays;
    const now = new Date();
    const trialEndsAt = new Date(
      now.getTime() + trialDays * 24 * 60 * 60 * 1000,
    );

    // 5. Create the trial subscription. Effective price is 0 during trial;
    //    partner_margin remains the schema default. Period mirrors the trial
    //    window so renewal jobs handle the trial->active transition cleanly.
    const subscription = await tx.store_subscriptions.create({
      data: {
        store_id: storeId,
        plan_id: plan.id,
        state: 'trial',
        started_at: now,
        trial_ends_at: trialEndsAt,
        current_period_start: now,
        current_period_end: trialEndsAt,
        next_billing_at: trialEndsAt,
        effective_price: new Prisma.Decimal(0),
        vendix_base_price: new Prisma.Decimal(0),
        currency: plan.currency,
        auto_renew: true,
        resolved_features:
          (plan.ai_feature_flags as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        resolved_at: now,
      },
    });

    // 6. Audit event for the state machine.
    await tx.subscription_events.create({
      data: {
        store_subscription_id: subscription.id,
        type: 'trial_started',
        to_state: 'trial',
        payload: {
          trial_days: trialDays,
          trial_ends_at: trialEndsAt.toISOString(),
          plan_id: plan.id,
          plan_code: plan.code,
        } as Prisma.InputJsonValue,
        triggered_by_job: 'auto-trial-bootstrap',
      },
    });

    // 7. Trial consumption audit row (authoritative one-shot record).
    //    The UNIQUE(organization_id) constraint is the final defensive
    //    layer against concurrent trial consumption — if a second writer
    //    slipped past the FOR UPDATE lock (e.g. external SQL), this INSERT
    //    raises P2002 and we surface it as SUBSCRIPTION_TRIAL_001.
    try {
      await tx.organization_trial_consumptions.create({
        data: {
          organization_id: organizationId,
          store_subscription_id: subscription.id,
          consumed_at: now,
        },
      });
    } catch (e: unknown) {
      const code = (e as { code?: string } | null)?.code;
      if (code === 'P2002') {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_TRIAL_001,
          'Trial ya consumido',
        );
      }
      throw e;
    }

    // 8. Dual-write the legacy boolean flag for back-compat (one-release
    //    transition window). New readers MUST query
    //    `organization_trial_consumptions` instead. Flip happens LAST so a
    //    failure in any earlier step rolls back the flag flip too.
    await tx.organizations.update({
      where: { id: organizationId },
      data: {
        has_consumed_trial: true,
        trial_consumed_at: now,
      },
    });

    this.logger.log(
      `trial created for store ${storeId}, ends at ${trialEndsAt.toISOString()}`,
    );

    return subscription;
  }
}
