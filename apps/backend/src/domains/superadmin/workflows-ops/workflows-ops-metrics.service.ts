import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { DISPATCHER_HEARTBEAT_KEY } from '../../store/workflows/engine/workflow-outbox.dispatcher.constants';
import type { DispatcherHeartbeat } from '../../store/workflows/engine/workflow-outbox.dispatcher';
import {
  LAST_ERROR_MAX_CHARS,
  RECENT_DEAD_LIMIT,
  STUCK_PROCESSING_MINUTES,
  TOP_STORES_LIMIT,
} from './workflows-ops.constants';

export interface LatencyPercentiles {
  p50_seconds: number | null;
  p95_seconds: number | null;
  samples: number;
}

export interface StoreCount {
  store_id: number;
  store_name: string;
  count: number;
}

export interface RecentDeadRow {
  id: string;
  store_id: number;
  store_name: string;
  kind: string;
  attempts: number;
  last_error: string | null;
  processed_at: string | null;
}

export interface WorkflowOpsMetrics {
  generated_at: string;
  outbox: {
    by_status: Record<string, number>;
    by_kind: Array<{ kind: string; status: string; count: number }>;
    pending: number;
    processing: number;
    backlog_due: number;
    oldest_due_age_seconds: number | null;
    stuck_processing: number;
    dead_1h: number;
    dead_24h: number;
    latency_1h: LatencyPercentiles;
  };
  webhooks: {
    by_status_24h: Record<string, number>;
    success_rate_24h: number | null;
    latency_24h: LatencyPercentiles;
    dead_total: number;
  };
  inbound: { accepted_24h: number; rejected_24h: number };
  top_stores: { by_backlog: StoreCount[]; by_dead_24h: StoreCount[] };
  recent_dead: RecentDeadRow[];
  dispatcher: (DispatcherHeartbeat & { age_seconds: number }) | null;
}

/** The few numbers the alert rules look at, one cheap pass. */
export interface WorkflowOpsSignals {
  heartbeat_age_seconds: number | null;
  backlog_due: number;
  oldest_due_age_seconds: number | null;
  dead_outbox_1h: number;
  webhooks_1h_total: number;
  webhooks_1h_failed: number;
  webhooks_dead_1h: number;
  latency_p95_seconds: number | null;
}

interface FiguresRow {
  backlog_due: number;
  oldest_due_age_seconds: number | null;
  stuck_processing: number;
  dead_1h: number;
  dead_24h: number;
}

interface LatencyRow {
  p50: number | null;
  p95: number | null;
  samples: number;
}

/** Credentials that slipped into an error text never reach the screen. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [oculto]'],
  [/\b(token|secret|password|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1$2[oculto]'],
];

export function sanitizeLastError(error: string | null): string | null {
  if (error === null) return null;
  let out = error.slice(0, LAST_ERROR_MAX_CHARS);
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

const toNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/**
 * Platform-wide figures of the Flujos queue, webhooks and inbound hooks. Reads
 * every store on purpose: only reachable through the SUPER_ADMIN controller, via
 * the unscoped client.
 */
@Injectable()
export class WorkflowsOpsMetricsService {
  private readonly logger = new Logger(WorkflowsOpsMetricsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getMetrics(now = new Date()): Promise<WorkflowOpsMetrics> {
    const [
      statusKind,
      figures,
      latency1h,
      webhookStatus,
      webhookLatency,
      webhookDead,
      inbound,
      byBacklog,
      byDead,
      recentDead,
      heartbeat,
    ] = await Promise.all([
      this.outboxByStatusAndKind(),
      this.outboxFigures(),
      this.outboxLatency(),
      this.webhooksByStatus(),
      this.webhooksLatency(),
      this.webhooksDeadTotal(),
      this.inboundByStatus(),
      this.topStores('backlog'),
      this.topStores('dead'),
      this.recentDeadRows(),
      this.readHeartbeat(now),
    ]);

    const byStatus: Record<string, number> = {};
    for (const r of statusKind) byStatus[r.status] = (byStatus[r.status] ?? 0) + r.count;

    const delivered = webhookStatus.delivered ?? 0;
    const settled = delivered + (webhookStatus.failed ?? 0) + (webhookStatus.dead ?? 0);

    return {
      generated_at: now.toISOString(),
      outbox: {
        by_status: byStatus,
        by_kind: statusKind,
        pending: byStatus.pending ?? 0,
        processing: byStatus.processing ?? 0,
        backlog_due: figures.backlog_due,
        oldest_due_age_seconds: figures.oldest_due_age_seconds,
        stuck_processing: figures.stuck_processing,
        dead_1h: figures.dead_1h,
        dead_24h: figures.dead_24h,
        latency_1h: latency1h,
      },
      webhooks: {
        by_status_24h: webhookStatus,
        success_rate_24h: settled === 0 ? null : delivered / settled,
        latency_24h: webhookLatency,
        dead_total: webhookDead,
      },
      inbound: {
        accepted_24h: inbound.accepted ?? 0,
        rejected_24h: inbound.rejected ?? 0,
      },
      top_stores: { by_backlog: byBacklog, by_dead_24h: byDead },
      recent_dead: recentDead,
      dispatcher: heartbeat,
    };
  }

  async getSignals(now = new Date()): Promise<WorkflowOpsSignals> {
    const [figures, latency, webhooks, heartbeat] = await Promise.all([
      this.outboxFigures(),
      this.outboxLatency(),
      this.webhookHourSignals(),
      this.readHeartbeat(now),
    ]);
    return {
      heartbeat_age_seconds: heartbeat ? heartbeat.age_seconds : null,
      backlog_due: figures.backlog_due,
      oldest_due_age_seconds: figures.oldest_due_age_seconds,
      dead_outbox_1h: figures.dead_1h,
      webhooks_1h_total: webhooks.total,
      webhooks_1h_failed: webhooks.failed,
      webhooks_dead_1h: webhooks.dead,
      latency_p95_seconds: latency.p95_seconds,
    };
  }

  private get db() {
    return this.prisma.withoutScope();
  }

  private async outboxByStatusAndKind() {
    const rows = await this.db.$queryRaw<Array<{ status: string; kind: string; count: number }>>(
      Prisma.sql`
        SELECT status::text AS status, kind, COUNT(*)::int AS count
        FROM workflow_outbox
        WHERE status <> 'done' OR processed_at >= now() - interval '24 hours'
        GROUP BY status, kind
        ORDER BY status, kind`,
    );
    return rows.map((r) => ({ status: r.status, kind: r.kind, count: Number(r.count) }));
  }

  private async outboxFigures(): Promise<FiguresRow> {
    const [row] = await this.db.$queryRaw<FiguresRow[]>(
      Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending' AND available_at <= now())::int AS backlog_due,
          EXTRACT(EPOCH FROM (now() - MIN(available_at)
            FILTER (WHERE status = 'pending' AND available_at <= now())))::float8 AS oldest_due_age_seconds,
          COUNT(*) FILTER (WHERE status = 'processing'
            AND available_at <= now() - ${Prisma.raw(`interval '${STUCK_PROCESSING_MINUTES} minutes'`)})::int AS stuck_processing,
          COUNT(*) FILTER (WHERE status = 'dead' AND processed_at >= now() - interval '1 hour')::int AS dead_1h,
          COUNT(*) FILTER (WHERE status = 'dead' AND processed_at >= now() - interval '24 hours')::int AS dead_24h
        FROM workflow_outbox
        WHERE status IN ('pending', 'processing', 'dead')`,
    );
    return {
      backlog_due: Number(row?.backlog_due ?? 0),
      oldest_due_age_seconds: toNumber(row?.oldest_due_age_seconds),
      stuck_processing: Number(row?.stuck_processing ?? 0),
      dead_1h: Number(row?.dead_1h ?? 0),
      dead_24h: Number(row?.dead_24h ?? 0),
    };
  }

  private async outboxLatency(): Promise<LatencyPercentiles> {
    const [row] = await this.db.$queryRaw<LatencyRow[]>(
      Prisma.sql`
        SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (processed_at - created_at)))::float8 AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (processed_at - created_at)))::float8 AS p95,
          COUNT(*)::int AS samples
        FROM workflow_outbox
        WHERE status = 'done' AND processed_at >= now() - interval '1 hour'`,
    );
    return this.latency(row);
  }

  private latency(row: LatencyRow | undefined): LatencyPercentiles {
    return {
      p50_seconds: toNumber(row?.p50),
      p95_seconds: toNumber(row?.p95),
      samples: Number(row?.samples ?? 0),
    };
  }

  private async webhooksByStatus(): Promise<Record<string, number>> {
    const rows = await this.db.$queryRaw<Array<{ status: string; count: number }>>(
      Prisma.sql`
        SELECT status, COUNT(*)::int AS count
        FROM workflow_webhook_deliveries
        WHERE created_at >= now() - interval '24 hours'
        GROUP BY status`,
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  }

  private async webhooksLatency(): Promise<LatencyPercentiles> {
    const [row] = await this.db.$queryRaw<LatencyRow[]>(
      Prisma.sql`
        SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (delivered_at - created_at)))::float8 AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (delivered_at - created_at)))::float8 AS p95,
          COUNT(*)::int AS samples
        FROM workflow_webhook_deliveries
        WHERE status = 'delivered' AND delivered_at >= now() - interval '24 hours'`,
    );
    return this.latency(row);
  }

  private async webhooksDeadTotal(): Promise<number> {
    const [row] = await this.db.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`SELECT COUNT(*)::int AS count FROM workflow_webhook_deliveries WHERE status = 'dead'`,
    );
    return Number(row?.count ?? 0);
  }

  private async webhookHourSignals(): Promise<{ total: number; failed: number; dead: number }> {
    const [row] = await this.db.$queryRaw<Array<{ total: number; failed: number; dead: number }>>(
      Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE status <> 'pending')::int AS total,
          COUNT(*) FILTER (WHERE status IN ('failed', 'dead'))::int AS failed,
          COUNT(*) FILTER (WHERE status = 'dead')::int AS dead
        FROM workflow_webhook_deliveries
        WHERE created_at >= now() - interval '1 hour'`,
    );
    return {
      total: Number(row?.total ?? 0),
      failed: Number(row?.failed ?? 0),
      dead: Number(row?.dead ?? 0),
    };
  }

  private async inboundByStatus(): Promise<Record<string, number>> {
    const rows = await this.db.$queryRaw<Array<{ status: string; count: number }>>(
      Prisma.sql`
        SELECT status, COUNT(*)::int AS count
        FROM workflow_inbound_requests
        WHERE created_at >= now() - interval '24 hours'
        GROUP BY status`,
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  }

  private async topStores(by: 'backlog' | 'dead'): Promise<StoreCount[]> {
    const filter =
      by === 'backlog'
        ? Prisma.sql`o.status = 'pending' AND o.available_at <= now()`
        : Prisma.sql`o.status = 'dead' AND o.processed_at >= now() - interval '24 hours'`;
    const rows = await this.db.$queryRaw<Array<{ store_id: number; store_name: string; count: number }>>(
      Prisma.sql`
        SELECT o.store_id, s.name AS store_name, COUNT(*)::int AS count
        FROM workflow_outbox o
        JOIN stores s ON s.id = o.store_id
        WHERE ${filter}
        GROUP BY o.store_id, s.name
        ORDER BY count DESC, o.store_id
        LIMIT ${TOP_STORES_LIMIT}::int`,
    );
    return rows.map((r) => ({
      store_id: Number(r.store_id),
      store_name: r.store_name,
      count: Number(r.count),
    }));
  }

  private async recentDeadRows(): Promise<RecentDeadRow[]> {
    const rows = await this.db.$queryRaw<
      Array<{
        id: string;
        store_id: number;
        store_name: string;
        kind: string;
        attempts: number;
        last_error: string | null;
        processed_at: Date | null;
      }>
    >(
      Prisma.sql`
        SELECT o.id::text AS id, o.store_id, s.name AS store_name, o.kind, o.attempts,
               LEFT(o.last_error, ${LAST_ERROR_MAX_CHARS}::int) AS last_error, o.processed_at
        FROM workflow_outbox o
        JOIN stores s ON s.id = o.store_id
        WHERE o.status = 'dead'
        ORDER BY COALESCE(o.processed_at, o.created_at) DESC, o.id DESC
        LIMIT ${RECENT_DEAD_LIMIT}::int`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      store_id: Number(r.store_id),
      store_name: r.store_name,
      kind: r.kind,
      attempts: Number(r.attempts),
      last_error: sanitizeLastError(r.last_error),
      processed_at: r.processed_at ? new Date(r.processed_at).toISOString() : null,
    }));
  }

  private async readHeartbeat(now: Date): Promise<(DispatcherHeartbeat & { age_seconds: number }) | null> {
    try {
      const raw = await this.redis.get(DISPATCHER_HEARTBEAT_KEY);
      if (!raw) return null;
      const beat = JSON.parse(raw) as DispatcherHeartbeat;
      const at = Date.parse(beat.at);
      if (Number.isNaN(at)) return null;
      return { ...beat, age_seconds: Math.max(0, Math.round((now.getTime() - at) / 1000)) };
    } catch (e) {
      this.logger.warn(`Dispatcher heartbeat unreadable: ${(e as Error)?.message}`);
      return null;
    }
  }
}
