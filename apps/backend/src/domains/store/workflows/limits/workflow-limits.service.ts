import { Injectable, Logger } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SubscriptionResolverService } from '../../subscriptions/services/subscription-resolver.service';
import type { WorkflowTx } from '../engine/workflow-engine.types';
import {
  WORKFLOW_INSTANCES_NOTICE_TITLE,
  WORKFLOW_LIMIT_DEFAULTS,
  WORKFLOW_LIMIT_KEYS,
  WORKFLOW_USAGE_URL,
  WorkflowCounterMetric,
  WorkflowLimitKey,
  workflowNoticeMetric,
} from './workflow-limits.constants';

/** Effective cap per limit; `null` = unlimited. */
export type WorkflowEffectiveLimits = Record<WorkflowLimitKey, number | null>;

export interface WorkflowLimitUse {
  metric: WorkflowLimitKey;
  allowed: boolean;
  /** Counter value after the call when allowed; current value when refused. */
  used: number;
  cap: number | null;
  /** UTC month, `YYYY-MM`. */
  period: string;
}

/** Who is refused: staff get the plan details (paywall), outsiders a neutral message. */
export type WorkflowLimitAudience = 'staff' | 'outsider';

const GIB = 1024 * 1024 * 1024;

/** UTC month, the period of every counter. */
export function workflowPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatInt(n: number): string {
  return new Intl.NumberFormat('es-CO').format(n);
}

function formatGb(bytes: number): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(bytes / GIB);
}

/**
 * Per-plan limits of Flows (flujos-adm P7.1): requests and HTTP calls per UTC
 * month (atomic counters in `workflow_usage_counters`) and storage (live sum
 * of `stored_files`). The effective caps come from the store's plan row
 * (`subscription_plans.workflow_limits`): NULL = platform defaults, a key set
 * to null = unlimited. AI tokens are not here: they stay with the plan quota
 * of `WorkflowAiService` (D4).
 */
@Injectable()
export class WorkflowLimitsService {
  private readonly logger = new Logger(WorkflowLimitsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly global: GlobalPrismaService,
    private readonly resolver: SubscriptionResolverService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Caps of the plan the store is on (paid plan when paid, trial plan otherwise). */
  async effectiveLimits(storeId: number): Promise<WorkflowEffectiveLimits> {
    const sub = await this.resolver.resolveSubscription(storeId);
    const planId = sub.paidPlanId ?? sub.planId;
    const plan = planId
      ? await this.global.subscription_plans.findUnique({
          where: { id: planId },
          select: { workflow_limits: true },
        })
      : null;
    const stored =
      plan?.workflow_limits && typeof plan.workflow_limits === 'object' && !Array.isArray(plan.workflow_limits)
        ? (plan.workflow_limits as Record<string, unknown>)
        : {};
    const out = {} as WorkflowEffectiveLimits;
    for (const key of WORKFLOW_LIMIT_KEYS) {
      const value = stored[key];
      if (value === null) out[key] = null;
      else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) out[key] = value;
      else out[key] = WORKFLOW_LIMIT_DEFAULTS[key];
    }
    return out;
  }

  /**
   * Counts one use of `metric` in the current month. With `enforce` (default)
   * it is ONE conditional upsert: the row only grows while `count < cap`, so
   * concurrent callers can never pass the cap; no returned row = refused and
   * nothing changed. `enforce: false` always counts (exempt starts). Pass the
   * caller's `tx` so the count commits or rolls back with the work it meters.
   */
  async consume(
    storeId: number,
    metric: WorkflowCounterMetric,
    opts: { enforce?: boolean; tx?: WorkflowTx } = {},
  ): Promise<WorkflowLimitUse> {
    const db: WorkflowTx = opts.tx ?? this.prisma.withoutScope();
    const cap = (await this.effectiveLimits(storeId))[metric];
    const period = workflowPeriod();
    const limited = opts.enforce !== false && cap !== null;
    const count = await this.bump(db, storeId, period, metric, limited ? cap : null);
    if (count !== null) return { metric, allowed: true, used: count, cap, period };
    return { metric, allowed: false, used: await this.counterValue(db, storeId, period, metric), cap, period };
  }

  /** Current value of a counter (0 when it has no row yet). */
  async counterValue(db: WorkflowTx, storeId: number, period: string, metric: string): Promise<number> {
    const row = await db.workflow_usage_counters.findFirst({
      where: { store_id: storeId, period, metric },
      select: { count: true },
    });
    return row?.count ?? 0;
  }

  /** The new count, or `null` when `cap` is set and already reached. */
  private async bump(
    db: WorkflowTx,
    storeId: number,
    period: string,
    metric: string,
    cap: number | null,
  ): Promise<number | null> {
    if (cap !== null && cap <= 0) return null;
    const rows: Array<{ count: number }> =
      cap === null
        ? await db.$queryRaw`
            INSERT INTO workflow_usage_counters (store_id, period, metric, count, updated_at)
            VALUES (${storeId}, ${period}, ${metric}, 1, now())
            ON CONFLICT (store_id, period, metric) DO UPDATE
              SET count = workflow_usage_counters.count + 1, updated_at = now()
            RETURNING count`
        : await db.$queryRaw`
            INSERT INTO workflow_usage_counters (store_id, period, metric, count, updated_at)
            VALUES (${storeId}, ${period}, ${metric}, 1, now())
            ON CONFLICT (store_id, period, metric) DO UPDATE
              SET count = workflow_usage_counters.count + 1, updated_at = now()
              WHERE workflow_usage_counters.count < ${cap}
            RETURNING count`;
    return rows.length > 0 ? Number(rows[0].count) : null;
  }

  /** Bytes of the store's live files (not deleted, not purged). */
  async storageUsed(storeId: number): Promise<number> {
    const rows = await this.prisma.withoutScope().$queryRaw<Array<{ used: bigint | number | null }>>`
      SELECT COALESCE(SUM(size_bytes), 0) AS used
      FROM stored_files
      WHERE store_id = ${storeId} AND deleted_at IS NULL AND purged_at IS NULL`;
    return Number(rows[0]?.used ?? 0);
  }

  /**
   * Refuses (before any byte is written) a file that would take the store past
   * its storage cap: 402 with the plan details for staff, the neutral
   * `WORKFLOW_INTAKE_UNAVAILABLE` for an outsider. A soft cap: it reads the
   * live sum without a lock, so uploads racing each other may pass the same
   * check and end slightly over it; the next upload is then refused.
   */
  async assertStorage(
    storeId: number,
    incomingBytes: number,
    audience: WorkflowLimitAudience = 'staff',
  ): Promise<void> {
    const cap = (await this.effectiveLimits(storeId)).storage_bytes;
    if (cap === null) return;
    const used = await this.storageUsed(storeId);
    if (used + incomingBytes <= cap) return;
    const use: WorkflowLimitUse = {
      metric: 'storage_bytes',
      allowed: false,
      used,
      cap,
      period: workflowPeriod(),
    };
    throw this.refusal(use, audience);
  }

  /** The exception for a refused use: 402 with details for staff, neutral 503 for an outsider. */
  refusal(use: WorkflowLimitUse, audience: WorkflowLimitAudience = 'staff'): VendixHttpException {
    if (audience === 'outsider') return new VendixHttpException(ErrorCodes.WORKFLOW_INTAKE_UNAVAILABLE);
    const cap = use.cap ?? 0;
    const message =
      use.metric === 'monthly_instances'
        ? `Llegaste al límite de solicitudes de tu plan (${formatInt(use.used)} de ${formatInt(cap)} este mes).`
        : use.metric === 'monthly_http_calls'
          ? `Llegaste al límite de llamadas HTTP de tu plan (${formatInt(use.used)} de ${formatInt(cap)} este mes).`
          : `Llegaste al límite de almacenamiento de tu plan (${formatGb(use.used)} de ${formatGb(cap)} GB).`;
    return new VendixHttpException(ErrorCodes.WORKFLOW_PLAN_LIMIT_REACHED, message, {
      limit: use.metric,
      used: use.used,
      cap: use.cap,
      period: use.period,
    });
  }

  /**
   * Tells the store owners, once per month, that requests are being refused
   * because the plan's monthly requests are used up. The dedupe is a counter
   * row (`notice:monthly_instances`, cap 1) written outside the caller's
   * transaction, so a rolled-back start keeps it. Best-effort: a failed notice
   * never changes the refusal.
   */
  async noticeOnce(storeId: number, use: WorkflowLimitUse, intake: boolean): Promise<void> {
    try {
      const claimed = await this.bump(
        this.prisma.withoutScope(),
        storeId,
        use.period,
        workflowNoticeMetric('monthly_instances'),
        1,
      );
      if (claimed === null) return;
      await this.notifications.createAndBroadcast(
        storeId,
        'workflow_task',
        WORKFLOW_INSTANCES_NOTICE_TITLE,
        intake
          ? 'Los formularios públicos y las entradas externas no reciben solicitudes hasta el próximo mes. Mejora tu plan para retomarlas.'
          : 'Las solicitudes que se inician solas (por evento, horario, correo o fecha) no arrancan hasta el próximo mes. Mejora tu plan para retomarlas.',
        { kind: 'workflow_plan_limit', metric: use.metric, period: use.period, url: WORKFLOW_USAGE_URL },
      );
    } catch (e) {
      this.logger.warn(`Plan limit notice of store ${storeId} failed: ${(e as Error)?.message}`);
    }
  }
}
