import { Workbook } from 'exceljs';
import { RequestContextService } from '@common/context/request-context.service';
import { buildReportBuffer } from '@common/reports/report-builder';
import { WorkflowAnalyticsService } from './workflow-analytics.service';
import { buildWorkflowAnalyticsWorkbook } from './workflow-analytics.xlsx';

const H = 3_600_000;
const d = (iso: string) => new Date(iso);

const STAGES = [
  {
    stage_key: 'jefe',
    name: 'Aprobación jefe',
    wip: 2,
    entered: 4,
    exited: 3,
    avg_hours: 5,
    p90_hours: 9,
    overdue_now: 1,
  },
  {
    stage_key: 'gerente',
    name: 'Gerencia',
    wip: 1,
    entered: 2,
    exited: 1,
    avg_hours: 2.5,
    p90_hours: 2.5,
    overdue_now: 0,
  },
];

function build(opts: { cached?: unknown } = {}) {
  const cacheStore = new Map<string, unknown>();
  if (opts.cached) cacheStore.set('*', opts.cached);
  const cache: any = {
    get: jest.fn(async (k: string) => cacheStore.get(k) ?? cacheStore.get('*')),
    set: jest.fn(async (k: string, v: unknown) => void cacheStore.set(k, v)),
  };
  const prisma: any = {
    store_settings: {
      findFirst: jest.fn().mockResolvedValue({
        settings: {},
        stores: { timezone: 'America/Bogota' },
      }),
    },
    workflow_definitions: {
      findFirst: jest.fn().mockResolvedValue({ id: 7, name: 'Compras' }),
    },
    workflow_instances: {
      findMany: jest.fn().mockResolvedValue([
        // 22:00 Bogota on Oct 3 (= Oct 4 03:00Z): business day is Oct 3.
        {
          id: 1,
          status: 'completed',
          created_at: d('2026-10-04T03:00:00Z'),
          completed_at: new Date(d('2026-10-04T03:00:00Z').getTime() + 10 * H),
        },
        {
          id: 2,
          status: 'completed',
          created_at: d('2026-10-05T15:00:00Z'),
          completed_at: new Date(d('2026-10-05T15:00:00Z').getTime() + 20 * H),
        },
        {
          id: 3,
          status: 'rejected',
          created_at: d('2026-10-06T15:00:00Z'),
          completed_at: d('2026-10-06T18:00:00Z'),
        },
        {
          id: 4,
          status: 'cancelled',
          created_at: d('2026-10-07T15:00:00Z'),
          completed_at: d('2026-10-07T16:00:00Z'),
        },
        {
          id: 5,
          status: 'active',
          created_at: d('2026-10-08T15:00:00Z'),
          completed_at: null,
        },
      ]),
    },
    workflow_tasks: {
      findMany: jest.fn().mockResolvedValue([
        {
          stage_key: 'jefe',
          outcome: 'approve',
          due_at: d('2026-10-05T00:00:00Z'),
          created_at: d('2026-10-04T12:00:00Z'),
          completed_at: d('2026-10-04T14:00:00Z'),
          completed_by_user_id: 11,
        },
        {
          stage_key: 'jefe',
          outcome: 'reject',
          due_at: d('2026-10-05T00:00:00Z'),
          created_at: d('2026-10-04T12:00:00Z'),
          completed_at: d('2026-10-05T06:00:00Z'),
          completed_by_user_id: 11,
        },
        {
          stage_key: 'jefe',
          outcome: 'approve',
          due_at: null,
          created_at: d('2026-10-04T12:00:00Z'),
          completed_at: d('2026-10-04T18:00:00Z'),
          completed_by_user_id: 12,
        },
        {
          stage_key: 'gerente',
          outcome: 'approve',
          due_at: d('2026-10-09T00:00:00Z'),
          created_at: d('2026-10-08T00:00:00Z'),
          completed_at: d('2026-10-08T04:00:00Z'),
          completed_by_user_id: null,
        },
      ]),
    },
    withoutScope: () => ({
      users: {
        findMany: jest.fn().mockResolvedValue([
          { id: 11, first_name: 'Ana', last_name: 'Gómez' },
          { id: 12, first_name: 'Luis', last_name: null },
        ]),
      },
    }),
  };
  const metrics: any = {
    stageMetrics: jest.fn().mockResolvedValue({
      definition_id: 7,
      completed_instances: 25,
      insufficient_data: false,
      stages: STAGES,
      bottleneck_stage_key: 'jefe',
      truncated: false,
    }),
  };
  return {
    prisma,
    metrics,
    cache,
    service: new WorkflowAnalyticsService(prisma, metrics, cache),
  };
}

const asStore = <T>(fn: () => Promise<T>, store_id = 1) =>
  RequestContextService.run(
    {
      store_id,
      organization_id: 1,
      user_id: 1,
      is_super_admin: false,
      is_owner: true,
    } as any,
    fn,
  );

const Q = { from: '2026-10-01', to: '2026-10-10' };

describe('WorkflowAnalyticsService.report', () => {
  it('builds the dataset (kpis, stages, people, daily) in the store timezone', async () => {
    const { service, metrics } = build();
    const r = await asStore(() => service.report(7, Q));

    expect(r.definition).toEqual({ id: 7, name: 'Compras' });
    expect(r.range).toEqual({
      from: '2026-10-01',
      to: '2026-10-10',
      timezone: 'America/Bogota',
    });
    expect(r.kpis).toEqual({
      started: 5,
      completed: 2,
      rejected: 1,
      cancelled: 1,
      active: 3,
      overdue: 1,
      cycle_avg_hours: 15,
      cycle_p90_hours: 20,
      on_time_rate: 0.67, // 2 on time of 3 done tasks that had a deadline
    });
    // Stage window is the local-day boundary, not UTC midnight.
    const win = metrics.stageMetrics.mock.calls[0][1];
    expect(win.from.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(win.to.toISOString()).toBe('2026-10-11T04:59:59.999Z');

    const jefe = r.stages.find((s) => s.stage_key === 'jefe')!;
    expect(jefe).toMatchObject({
      wip: 2,
      avg_hours: 5,
      p90_hours: 9,
      overdue_now: 1,
    });
    expect(jefe.on_time_rate).toBe(0.5); // 1 on time + 1 late (06:00 > 00:00) of 2 with deadline
    expect(jefe.reject_rate).toBe(0.33); // 1 reject / 3 decisions
    expect(r.stages.find((s) => s.stage_key === 'gerente')!.reject_rate).toBe(
      0,
    );

    expect(r.people).toEqual([
      {
        user_id: 11,
        name: 'Ana Gómez',
        tasks_done: 2,
        on_time_rate: 0.5,
        avg_hours: 10,
      },
      {
        user_id: 12,
        name: 'Luis',
        tasks_done: 1,
        on_time_rate: null,
        avg_hours: 6,
      },
    ]);
    expect(r.bottleneck_stage_key).toBe('jefe');
    expect(r.insufficient_data).toBe(false);

    expect(r.daily).toHaveLength(10);
    expect(r.daily[0].date).toBe('2026-10-01');
    // 22:00 Bogota Oct 3 is business day Oct 3, not Oct 4.
    expect(r.daily.find((x) => x.date === '2026-10-03')).toMatchObject({
      started: 1,
    });
    expect(r.daily.find((x) => x.date === '2026-10-04')).toMatchObject({
      started: 0,
      completed: 1,
    });
  });

  it('every query carries the explicit store_id', async () => {
    const { service, prisma } = build();
    await asStore(() => service.report(7, Q), 9);
    for (const t of [
      'workflow_definitions',
      'workflow_instances',
      'workflow_tasks',
    ]) {
      const fn = prisma[t].findFirst ?? prisma[t].findMany;
      for (const [arg] of fn.mock.calls) expect(arg.where.store_id).toBe(9);
    }
  });

  it('caches per store/definition/range for 5 minutes', async () => {
    const { service, prisma, cache } = build();
    const first = await asStore(() => service.report(7, Q), 3);
    const second = await asStore(() => service.report(7, Q), 3);
    expect(second).toBe(first);
    expect(prisma.workflow_instances.findMany).toHaveBeenCalledTimes(1);
    const [key, , ttl] = cache.set.mock.calls[0];
    expect(key).toContain(':3:7:2026-10-01:2026-10-10');
    expect(ttl).toBe(300_000);
    await asStore(() => service.report(7, Q), 4); // other store: other key
    expect(cache.get.mock.calls.at(-1)[0]).toContain(':4:7:');
  });

  it('defaults to the last 30 store days and rejects ranges above 366 days', async () => {
    const { service } = build();
    const r = await asStore(() => service.report(7, { to: '2026-10-31' }));
    expect(r.range.from).toBe('2026-10-02');
    expect(r.daily).toHaveLength(30);
    await expect(
      asStore(() =>
        service.report(7, { from: '2025-01-01', to: '2026-10-31' }),
      ),
    ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
    await expect(
      asStore(() =>
        service.report(7, { from: '2026-10-10', to: '2026-10-01' }),
      ),
    ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });
  });
});

describe('XLSX is built from the same dataset', () => {
  it('cells equal the dataset values', async () => {
    const { service } = build();
    const r = await asStore(() => service.report(7, Q));
    const buffer = await buildReportBuffer(buildWorkflowAnalyticsWorkbook(r));
    const wb = new Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Resumen',
      'Etapas',
      'Personas',
      'Diario',
    ]);

    const sum = wb.getWorksheet('Resumen')!;
    const header = (ws: any) =>
      Array.from(
        { length: ws.columnCount },
        (_: unknown, i: number) => ws.getRow(1).getCell(i + 1).value ?? null,
      );
    const rowOf = (ws: any, n: number) =>
      Array.from(
        { length: ws.columnCount },
        (_: unknown, i: number) => ws.getRow(n).getCell(i + 1).value ?? null,
      );
    expect(header(sum)).toContain('Ciclo p90 (h)');
    const s = Object.fromEntries(
      header(sum).map((h: string, i: number) => [h, rowOf(sum, 2)[i]]),
    );
    expect(s['Flujo']).toBe('Compras');
    expect(s['Iniciadas']).toBe(r.kpis.started);
    expect(s['Completadas']).toBe(r.kpis.completed);
    expect(s['Rechazadas']).toBe(r.kpis.rejected);
    expect(s['Canceladas']).toBe(r.kpis.cancelled);
    expect(s['En curso']).toBe(r.kpis.active);
    expect(s['Vencidas']).toBe(r.kpis.overdue);
    expect(s['Ciclo promedio (h)']).toBe(r.kpis.cycle_avg_hours);
    expect(s['Ciclo p90 (h)']).toBe(r.kpis.cycle_p90_hours);
    expect(s['% dentro del plazo']).toBe(r.kpis.on_time_rate);
    expect(s['Cuello de botella']).toBe('Aprobación jefe');
    expect(sum.getCell('E2').numFmt).toBe('0');
    expect(sum.getCell('K2').numFmt).toBe('0.0');

    const et = wb.getWorksheet('Etapas')!;
    r.stages.forEach((st, i) => {
      const row = rowOf(et, i + 2);
      expect(row).toEqual([
        st.name,
        st.wip,
        st.entered,
        st.exited,
        st.avg_hours,
        st.p90_hours,
        st.overdue_now,
        st.on_time_rate,
        st.reject_rate,
      ]);
    });

    const pe = wb.getWorksheet('Personas')!;
    r.people.forEach((p, i) =>
      expect(rowOf(pe, i + 2)).toEqual([
        p.name,
        p.tasks_done,
        p.on_time_rate,
        p.avg_hours,
      ]),
    );

    const di = wb.getWorksheet('Diario')!;
    expect(di.rowCount).toBe(r.daily.length + 1);
    r.daily.forEach((x, i) => {
      const [date, started, completed] = rowOf(di, i + 2);
      expect(String(date).slice(0, 10)).toBe(x.date);
      expect([started, completed]).toEqual([x.started, x.completed]);
    });
  });
});
