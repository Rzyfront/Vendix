import { Prisma } from '@prisma/client';
import { DISPATCHER_HEARTBEAT_KEY } from '../../store/workflows/engine/workflow-outbox.dispatcher.constants';
import {
  WorkflowsOpsMetricsService,
  sanitizeLastError,
} from './workflows-ops-metrics.service';


function build(redisValue: string | null, handlers: Record<string, unknown[]> = {}) {
  const seen: string[] = [];
  const queryRaw = jest.fn(async (query: Prisma.Sql) => {
    const text = query.sql.replace(/\s+/g, ' ');
    seen.push(text);
    for (const [needle, rows] of Object.entries(handlers)) if (text.includes(needle)) return rows;
    return [];
  });
  const redis = { get: jest.fn().mockResolvedValue(redisValue) };
  const service = new WorkflowsOpsMetricsService(
    { withoutScope: () => ({ $queryRaw: queryRaw }) } as never,
    redis as never,
  );
  return { service, seen, redis };
}

const NOW = new Date('2026-11-08T12:00:00.000Z');

describe('WorkflowsOpsMetricsService', () => {
  it('returns the full platform shape with every figure from the queries and the heartbeat age', async () => {
    const beat = { at: '2026-11-08T11:59:00.000Z', processed: 7, batches: 2, duration_ms: 900 };
    const { service, redis } = build(JSON.stringify(beat), {
      'GROUP BY status, kind': [
        { status: 'pending', kind: 'advance', count: 4 },
        { status: 'pending', kind: 'notify', count: 1 },
        { status: 'processing', kind: 'action', count: 2 },
        { status: 'dead', kind: 'action', count: 3 },
      ],
      'AS backlog_due': [
        { backlog_due: 5, oldest_due_age_seconds: 725.5, stuck_processing: 1, dead_1h: 2, dead_24h: 3 },
      ],
      'FROM workflow_outbox WHERE status = \'done\'': [{ p50: 1.5, p95: 9.25, samples: 40 }],
      'FROM workflow_webhook_deliveries WHERE created_at >= now() - interval \'24 hours\' GROUP BY status': [
        { status: 'delivered', count: 8 },
        { status: 'failed', count: 1 },
        { status: 'dead', count: 1 },
      ],
      'FROM workflow_webhook_deliveries WHERE status = \'delivered\'': [{ p50: 0.4, p95: 2, samples: 8 }],
      'FROM workflow_webhook_deliveries WHERE status = \'dead\'': [{ count: 12 }],
      'FROM workflow_inbound_requests': [
        { status: 'accepted', count: 30 },
        { status: 'rejected', count: 2 },
      ],
      'o.status = \'pending\' AND o.available_at <= now() GROUP BY': [
        { store_id: 7, store_name: 'Tienda Siete', count: 4 },
      ],
      'o.status = \'dead\' AND o.processed_at >= now() - interval \'24 hours\' GROUP BY': [
        { store_id: 9, store_name: 'Tienda Nueve', count: 3 },
      ],
      'WHERE o.status = \'dead\' ORDER BY': [
        {
          id: '15', store_id: 9, store_name: 'Tienda Nueve', kind: 'action', attempts: 6,
          last_error: 'connect ECONNREFUSED', processed_at: new Date('2026-11-08T11:30:00.000Z'),
        },
      ],
    });

    const m = await service.getMetrics(NOW);

    expect(redis.get).toHaveBeenCalledWith(DISPATCHER_HEARTBEAT_KEY);
    expect(m.outbox).toMatchObject({
      by_status: { pending: 5, processing: 2, dead: 3 },
      pending: 5,
      processing: 2,
      backlog_due: 5,
      oldest_due_age_seconds: 725.5,
      stuck_processing: 1,
      dead_1h: 2,
      dead_24h: 3,
      latency_1h: { p50_seconds: 1.5, p95_seconds: 9.25, samples: 40 },
    });
    expect(m.outbox.by_kind).toHaveLength(4);
    expect(m.webhooks).toMatchObject({
      by_status_24h: { delivered: 8, failed: 1, dead: 1 },
      success_rate_24h: 0.8,
      latency_24h: { p50_seconds: 0.4, p95_seconds: 2, samples: 8 },
      dead_total: 12,
    });
    expect(m.inbound).toEqual({ accepted_24h: 30, rejected_24h: 2 });
    expect(m.top_stores.by_backlog).toEqual([{ store_id: 7, store_name: 'Tienda Siete', count: 4 }]);
    expect(m.top_stores.by_dead_24h).toEqual([{ store_id: 9, store_name: 'Tienda Nueve', count: 3 }]);
    expect(m.recent_dead).toEqual([
      {
        id: '15', store_id: 9, store_name: 'Tienda Nueve', kind: 'action', attempts: 6,
        last_error: 'connect ECONNREFUSED', processed_at: '2026-11-08T11:30:00.000Z',
      },
    ]);
    expect(m.dispatcher).toEqual({ ...beat, age_seconds: 60 });
    expect(m.generated_at).toBe(NOW.toISOString());
  });

  it('reports nulls, not zeros, when there is no data and no heartbeat', async () => {
    const { service } = build(null);
    const m = await service.getMetrics(NOW);
    expect(m.dispatcher).toBeNull();
    expect(m.outbox.oldest_due_age_seconds).toBeNull();
    expect(m.outbox.latency_1h).toEqual({ p50_seconds: null, p95_seconds: null, samples: 0 });
    expect(m.webhooks.success_rate_24h).toBeNull();
    expect(m.recent_dead).toEqual([]);
  });

  it('caps the stored error text at 300 characters in SQL and hides credentials', async () => {
    const { service, seen } = build(null, {
      'WHERE o.status = \'dead\' ORDER BY': [
        {
          id: '1', store_id: 1, store_name: 'T', kind: 'action', attempts: 6,
          last_error: 'HTTP 401 Authorization: Bearer abc.def.ghi token=xyz', processed_at: null,
        },
      ],
    });
    const m = await service.getMetrics(NOW);
    expect(seen.find((q) => q.includes('LEFT(o.last_error'))).toBeDefined();
    expect(m.recent_dead[0].last_error).not.toMatch(/abc\.def|xyz/);
    expect(sanitizeLastError('x'.repeat(500))).toHaveLength(300);
    expect(sanitizeLastError(null)).toBeNull();
  });

  it('exposes the alert signals with the heartbeat age', async () => {
    const { service } = build(
      JSON.stringify({ at: '2026-11-08T11:50:00.000Z', processed: 0, batches: 1, duration_ms: 5 }),
      {
        'AS backlog_due': [{ backlog_due: 3, oldest_due_age_seconds: 700, stuck_processing: 0, dead_1h: 6, dead_24h: 6 }],
        'FROM workflow_outbox WHERE status = \'done\'': [{ p50: 1, p95: 400, samples: 3 }],
        'FILTER (WHERE status <> \'pending\')': [{ total: 25, failed: 13, dead: 2 }],
      },
    );
    await expect(service.getSignals(NOW)).resolves.toEqual({
      heartbeat_age_seconds: 600,
      backlog_due: 3,
      oldest_due_age_seconds: 700,
      dead_outbox_1h: 6,
      webhooks_1h_total: 25,
      webhooks_1h_failed: 13,
      webhooks_dead_1h: 2,
      latency_p95_seconds: 400,
    });
  });
});
