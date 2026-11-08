import { RequestContextService } from '../../../../common/context/request-context.service';
import { WORKFLOW_INSIGHTS_APP_KEY } from './workflow-ai.service';
import { isoWeekKey } from './workflow-insights.content';
import {
  INSIGHTS_NOTIFICATION_TITLE,
  INSIGHTS_URL,
  WorkflowInsightsService,
} from './workflow-insights.service';

const STORE_ID = 10;
// Monday 2026-11-09 08:30 in Bogota (UTC-5)
const MONDAY = new Date('2026-11-09T13:30:00Z');

const DEFS = [
  { id: 1, key: 'pqr', name: 'PQR' },
  { id: 2, key: 'vacaciones', name: 'Vacaciones' },
];

function report(over: Partial<{ started: number; completed: number; active: number; overdue: number }> = {}) {
  return {
    kpis: {
      started: 4,
      completed: 2,
      active: 2,
      overdue: 1,
      cycle_avg_hours: 5.5,
      cycle_p90_hours: 9,
      ...over,
    },
    stages: [{ stage_key: 'jefe', name: 'Aprobación jefe', wip: 2 }],
    bottleneck_stage_key: 'jefe',
    insufficient_data: false,
  };
}

const VALID = {
  headline: 'PQR concentra la demora',
  summary: 'Resumen del mes.',
  flows: [
    { key: 'pqr', text: 'Se traba en jefe.' },
    { key: 'inventado', text: 'No existe.' },
  ],
  recommendations: ['Reasigna la etapa del jefe.'],
};

function build(opts: { defs?: typeof DEFS; reports?: ReturnType<typeof report>; run?: unknown; lastManual?: Date | null; existingWeek?: boolean; lock?: boolean; createError?: unknown } = {}) {
  const created: any[] = [];
  const prisma = {
    store_settings: {
      findFirst: jest.fn().mockResolvedValue({ settings: {}, stores: { timezone: 'America/Bogota' } }),
    },
    workflow_definitions: { findMany: jest.fn().mockResolvedValue(opts.defs ?? DEFS) },
    workflow_ai_summaries: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(async (args: any) => {
        if (args.where.kind === 'manual') return opts.lastManual ? { created_at: opts.lastManual } : null;
        if (args.where.week_key) return opts.existingWeek ? { id: 99 } : null;
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        if (opts.createError) throw opts.createError;
        const row = { id: 500 + created.length, created_at: new Date(), ...data, content: data.content ?? null };
        created.push(row);
        return row;
      }),
    },
  };
  const analytics = { report: jest.fn().mockResolvedValue(opts.reports ?? report()) };
  const ai = {
    run: jest.fn().mockResolvedValue(
      opts.run ?? { status: 'success', content: '{}', json: VALID, model: 'm-1', tokens: { prompt: 10, completion: 5, total: 15 } },
    ),
  };
  const notifications = { createAndBroadcast: jest.fn().mockResolvedValue(undefined) };
  const redis = {
    set: jest.fn().mockResolvedValue(opts.lock === false ? null : 'OK'),
    del: jest.fn().mockResolvedValue(1),
  };
  const service = new WorkflowInsightsService(prisma as any, analytics as any, ai as any, notifications as any, redis as any);
  return { service, prisma, analytics, ai, notifications, redis, created };
}

describe('WorkflowInsightsService', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(7);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('manual generation', () => {
    it('sends only aggregated metrics of the last 30 store-local days and stores the validated summary', async () => {
      const { service, analytics, ai, created } = build();
      const summary = await service.generateManual(MONDAY);

      expect(analytics.report).toHaveBeenCalledWith(1, { from: '2026-10-11', to: '2026-11-09' });
      expect(analytics.report).toHaveBeenCalledWith(2, { from: '2026-10-11', to: '2026-11-09' });
      const call = ai.run.mock.calls[0][0];
      expect(call).toMatchObject({ appKey: WORKFLOW_INSIGHTS_APP_KEY, purpose: 'insights_summary' });
      const sent = JSON.parse(call.messages[0].content);
      expect(sent.period).toEqual({ from: '2026-10-11', to: '2026-11-09' });
      expect(sent.flows[0]).toEqual({
        key: 'pqr',
        name: 'PQR',
        started: 4,
        completed: 2,
        open: 2,
        completion_rate_percent: 50,
        avg_cycle_hours: 5.5,
        p90_cycle_hours: 9,
        overdue_share_percent: 50,
        slowest_stage: { name: 'Aprobación jefe', open_tasks: 2 },
        insufficient_data: false,
      });
      expect(created[0]).toMatchObject({ kind: 'manual', week_key: null, status: 'ready', tokens_used: 15, model: 'm-1', created_by_user_id: 7 });
      expect(summary).toMatchObject({
        kind: 'manual',
        status: 'ready',
        period_from: '2026-10-11',
        period_to: '2026-11-09',
        week_key: null,
        error: null,
      });
      expect(summary.content).toEqual({
        headline: 'PQR concentra la demora',
        summary: 'Resumen del mes.',
        flows: [{ key: 'pqr', definition_id: 1, name: 'PQR', text: 'Se traba en jefe.' }],
        recommendations: ['Reasigna la etapa del jefe.'],
      });
    });

    it('does not call the AI when there are no published flows', async () => {
      const { service, ai } = build({ defs: [] });
      const summary = await service.generateManual(MONDAY);
      expect(ai.run).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ status: 'ready', tokens_used: 0, model: null });
      expect(summary.content?.summary).toContain('Sin actividad en los últimos 30 días');
    });

    it('does not call the AI when every flow has zero activity', async () => {
      const { service, ai } = build({ reports: report({ started: 0, completed: 0, active: 0, overdue: 0 }) });
      const summary = await service.generateManual(MONDAY);
      expect(ai.run).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ status: 'ready', tokens_used: 0 });
      expect(summary.content?.summary).toContain('Sin actividad en los últimos 30 días');
    });

    it.each([
      ['headline too long', { ...VALID, headline: 'x'.repeat(161) }],
      ['summary too long', { ...VALID, summary: 'x'.repeat(901) }],
      ['flow text too long', { ...VALID, flows: [{ key: 'pqr', text: 'x'.repeat(401) }] }],
      ['more than 4 recommendations', { ...VALID, recommendations: ['a', 'b', 'c', 'd', 'e'] }],
      ['recommendation too long', { ...VALID, recommendations: ['x'.repeat(201)] }],
      ['recommendation not a string', { ...VALID, recommendations: [3] }],
      ['missing headline', { summary: 'x' }],
      ['not an object', 'texto'],
      ['no JSON', null],
    ])('marks the summary failed when the AI answer is invalid (%s)', async (_name, json) => {
      const { service } = build({
        run: { status: 'success', content: 'x', json, model: 'm-1', tokens: { prompt: 1, completion: 1, total: 2 } },
      });
      const summary = await service.generateManual(MONDAY);
      expect(summary).toMatchObject({ status: 'failed', content: null, error: 'La respuesta de la IA no fue válida', tokens_used: 2 });
    });

    it('narrates only the 8 busiest active flows and drops any other key in the answer', async () => {
      // Loads 1..10 by id, plus an idle flow that must never reach the AI.
      const defs = [
        ...Array.from({ length: 10 }, (_, i) => ({ id: i + 1, key: `f${i + 1}`, name: `F${i + 1}` })),
        { id: 11, key: 'idle', name: 'Idle' },
      ];
      const json = { ...VALID, flows: [{ key: 'f10', text: 'El más activo.' }, { key: 'f1', text: 'Fuera del corte.' }] };
      const { service, ai, analytics } = build({
        defs,
        run: { status: 'success', content: 'x', json, model: 'm-1', tokens: { prompt: 1, completion: 1, total: 2 } },
      });
      analytics.report.mockImplementation(async (id: number) =>
        id === 11 ? report({ started: 0, completed: 0, active: 0, overdue: 0 }) : report({ started: id, completed: 0, active: 0, overdue: 0 }),
      );

      const summary = await service.generateManual(MONDAY);

      const sent = JSON.parse(ai.run.mock.calls[0][0].messages[0].content);
      expect(sent.flows.map((f: { key: string }) => f.key)).toEqual(['f10', 'f9', 'f8', 'f7', 'f6', 'f5', 'f4', 'f3']);
      expect(summary).toMatchObject({ status: 'ready' });
      expect(summary.content?.flows).toEqual([{ key: 'f10', definition_id: 10, name: 'F10', text: 'El más activo.' }]);
    });

    it('stores skipped_quota without an error code and with the Spanish message', async () => {
      const { service } = build({ run: { status: 'skipped_quota', quota: {} } });
      await expect(service.generateManual(MONDAY)).resolves.toMatchObject({
        status: 'skipped_quota',
        content: null,
        error: 'No se generó: cupo de IA agotado',
        tokens_used: 0,
      });
    });

    it('stores failed with a Spanish error when the AI call fails', async () => {
      const { service } = build({ run: { status: 'failed', error: 'boom', code: null, retryable: true } });
      const summary = await service.generateManual(MONDAY);
      expect(summary.status).toBe('failed');
      expect(summary.error).toMatch(/No se pudo generar/);
    });

    it('rejects a second manual generation within 60 minutes with WORKFLOW_INSIGHTS_RATE_LIMITED', async () => {
      const { service, ai } = build({ lastManual: new Date(MONDAY.getTime() - 59 * 60_000) });
      await expect(service.generateManual(MONDAY)).rejects.toMatchObject({ errorCode: 'WORKFLOW_INSIGHTS_RATE_LIMITED' });
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('allows a manual generation after 60 minutes', async () => {
      const { service } = build({ lastManual: new Date(MONDAY.getTime() - 61 * 60_000) });
      await expect(service.generateManual(MONDAY)).resolves.toMatchObject({ status: 'ready' });
    });

    it('rejects a double click while another generation holds the lock', async () => {
      const { service, ai, redis } = build({ lock: false });
      await expect(service.generateManual(MONDAY)).rejects.toMatchObject({ errorCode: 'WORKFLOW_INSIGHTS_RATE_LIMITED' });
      expect(redis.set).toHaveBeenCalledWith(`workflows:insights:manual-lock:${STORE_ID}`, '1', 'EX', expect.any(Number), 'NX');
      expect(ai.run).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('releases the lock even when the generation fails', async () => {
      const { service, redis } = build({ createError: new Error('db down') });
      await expect(service.generateManual(MONDAY)).rejects.toThrow('db down');
      expect(redis.del).toHaveBeenCalledWith(`workflows:insights:manual-lock:${STORE_ID}`);
    });
  });

  it('leaves out a flow whose metrics fail and still writes the summary', async () => {
    const { service, analytics, created } = build();
    analytics.report.mockRejectedValueOnce(new Error('metrics down'));
    await expect(service.generateManual(MONDAY)).resolves.toBeDefined();
    expect(created).toHaveLength(1);
    expect(analytics.report).toHaveBeenCalledTimes(DEFS.length);
  });

  describe('weekly generation', () => {
    it('stores the summary under the ISO week of the store-local date and notifies the store', async () => {
      const { service, created, notifications } = build();
      const summary = await service.generateWeekly(MONDAY);
      expect(created[0]).toMatchObject({ kind: 'weekly', week_key: '2026-W46', created_by_user_id: null });
      expect(summary?.week_key).toBe('2026-W46');
      expect(notifications.createAndBroadcast).toHaveBeenCalledWith(
        STORE_ID,
        'workflow_task',
        INSIGHTS_NOTIFICATION_TITLE,
        'PQR concentra la demora',
        { kind: 'workflow_insights', summary_id: summary?.id, url: INSIGHTS_URL },
      );
    });

    it('uses the store-local date for the week (Sunday night in Bogota is still the previous week)', async () => {
      // Mon 2026-11-09 02:00Z = Sun 2026-11-08 21:00 Bogota -> W45
      const { service, created } = build();
      await service.generateWeekly(new Date('2026-11-09T02:00:00Z'));
      expect(created[0].week_key).toBe('2026-W45');
    });

    it('does nothing when the week already has its summary', async () => {
      const { service, ai, created, notifications } = build({ existingWeek: true });
      await expect(service.generateWeekly(MONDAY)).resolves.toBeNull();
      expect(ai.run).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
      expect(notifications.createAndBroadcast).not.toHaveBeenCalled();
    });

    it('treats a duplicate insert (P2002 race) as already generated, without notifying', async () => {
      const { service, notifications } = build({ createError: { code: 'P2002' } });
      await expect(service.generateWeekly(MONDAY)).resolves.toBeNull();
      expect(notifications.createAndBroadcast).not.toHaveBeenCalled();
    });

    it('does not notify when the weekly summary is not ready', async () => {
      const { service, notifications } = build({ run: { status: 'skipped_quota', quota: {} } });
      await expect(service.generateWeekly(MONDAY)).resolves.toMatchObject({ status: 'skipped_quota' });
      expect(notifications.createAndBroadcast).not.toHaveBeenCalled();
    });

    it('does not fail the summary when the notification fails', async () => {
      const { service, notifications } = build();
      notifications.createAndBroadcast.mockRejectedValue(new Error('sse'));
      await expect(service.generateWeekly(MONDAY)).resolves.toMatchObject({ status: 'ready' });
    });
  });

  describe('list', () => {
    const last = new Date(MONDAY.getTime() - 10 * 60_000);

    it('lets a manager generate when there is no recent manual summary', async () => {
      const { service } = build();
      await expect(service.list(12, true, MONDAY)).resolves.toEqual({ items: [], can_generate: true, next_generate_at: null });
    });

    it('blocks generation for an hour after the last manual summary and says when it ends', async () => {
      const { service } = build({ lastManual: last });
      await expect(service.list(12, true, MONDAY)).resolves.toMatchObject({
        can_generate: false,
        next_generate_at: new Date(last.getTime() + 3_600_000).toISOString(),
      });
    });

    it('never offers generation to a user without manage permission', async () => {
      const { service } = build();
      await expect(service.list(12, false, MONDAY)).resolves.toMatchObject({ can_generate: false, next_generate_at: null });
    });

    it('reads only this store newest first with the requested limit', async () => {
      const { service, prisma } = build();
      await service.list(5, true, MONDAY);
      expect(prisma.workflow_ai_summaries.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { store_id: STORE_ID }, take: 5, orderBy: [{ created_at: 'desc' }, { id: 'desc' }] }),
      );
    });
  });

  describe('isoWeekKey', () => {
    it.each([
      [2026, 1, 1, '2026-W01'],
      [2026, 11, 9, '2026-W46'],
      [2027, 1, 1, '2026-W53'],
      [2024, 12, 30, '2025-W01'],
    ])('%i-%i-%i is %s', (y, m, d, expected) => expect(isoWeekKey(y, m, d)).toBe(expected));
  });
});
