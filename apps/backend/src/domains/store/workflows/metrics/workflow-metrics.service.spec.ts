import { VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import {
  INSUFFICIENT_DATA_THRESHOLD,
  WorkflowMetricsService,
  nearestRank,
} from './workflow-metrics.service';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const at = (hours: number) => new Date(T0 + hours * H);

const DEFINITION = {
  schema: 'vendix.workflow/v1',
  key: 'compras',
  name: 'Compras',
  fields: [],
  stages: [
    { key: 'solicitud', name: 'Solicitud', type: 'form', start: true },
    { key: 'jefe', name: 'Aprobación jefe', type: 'approval' },
    { key: 'gerente', name: 'Gerencia', type: 'approval' },
    { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
  ],
};

interface Ev {
  instance_id: number;
  seq: number;
  from_stage_key: string | null;
  to_stage_key: string | null;
  occurred_at: Date;
}

/** One finished instance: solicitud -> jefe (jefeHours) -> gerente (gerHours) -> fin. */
function finishedInstance(
  id: number,
  startH: number,
  jefeHours: number,
  gerHours: number,
): Ev[] {
  return [
    {
      instance_id: id,
      seq: 1,
      from_stage_key: null,
      to_stage_key: 'solicitud',
      occurred_at: at(startH),
    },
    {
      instance_id: id,
      seq: 2,
      from_stage_key: 'solicitud',
      to_stage_key: 'jefe',
      occurred_at: at(startH + 1),
    },
    {
      instance_id: id,
      seq: 3,
      from_stage_key: 'jefe',
      to_stage_key: 'gerente',
      occurred_at: at(startH + 1 + jefeHours),
    },
    {
      instance_id: id,
      seq: 4,
      from_stage_key: 'gerente',
      to_stage_key: 'fin',
      occurred_at: at(startH + 1 + jefeHours + gerHours),
    },
  ];
}

function build(opts: {
  events: Ev[];
  completed: number;
  active?: Array<{
    id: number;
    current_stage_key: string;
    stage_due_at: Date | null;
  }>;
  windowInstances?: number[];
  definition?: unknown;
  found?: boolean;
}) {
  const ids = opts.windowInstances ?? [
    ...new Set(opts.events.map((e) => e.instance_id)),
  ];
  const prisma: any = {
    workflow_definitions: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.found === false ? null : { id: 7, draft_definition: null },
        ),
    },
    workflow_versions: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ definition: opts.definition ?? DEFINITION }),
    },
    workflow_instances: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            where.status === 'active'
              ? (opts.active ?? [])
              : ids.map((id) => ({ id })),
          ),
        ),
      count: jest.fn().mockResolvedValue(opts.completed),
    },
    workflow_instance_events: {
      findMany: jest.fn().mockResolvedValue(opts.events),
    },
  };
  return { prisma, service: new WorkflowMetricsService(prisma) };
}

const range = { from: at(-1), to: at(1000) };
const asStore = <T>(fn: () => Promise<T>) =>
  RequestContextService.run(
    {
      store_id: 1,
      organization_id: 1,
      user_id: 1,
      is_super_admin: false,
      is_owner: true,
    } as any,
    fn,
  );

describe('nearestRank', () => {
  it('uses the nearest-rank method', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(nearestRank(v, 0.9)).toBe(9);
    expect(nearestRank([5], 0.9)).toBe(5);
    expect(nearestRank([10, 1, 5], 0.9)).toBe(10);
    expect(nearestRank([], 0.9)).toBeNull();
  });
});

describe('WorkflowMetricsService.stageMetrics', () => {
  it('computes entries, exits, avg and p90 hours from event timestamps', async () => {
    const events = [
      ...finishedInstance(1, 0, 2, 1),
      ...finishedInstance(2, 0, 4, 1),
      ...finishedInstance(3, 0, 6, 1),
    ];
    const { service } = build({ events, completed: 3 });
    const res = await asStore(() => service.stageMetrics(7, range));
    const jefe = res.stages.find((s) => s.stage_key === 'jefe')!;
    expect(jefe).toMatchObject({
      name: 'Aprobación jefe',
      entered: 3,
      exited: 3,
      avg_hours: 4,
      p90_hours: 6,
      wip: 0,
      overdue_now: 0,
    });
    const gerente = res.stages.find((s) => s.stage_key === 'gerente')!;
    expect(gerente).toMatchObject({
      entered: 3,
      exited: 3,
      avg_hours: 1,
      p90_hours: 1,
    });
    expect(res.stages.map((s) => s.stage_key)).toEqual([
      'solicitud',
      'jefe',
      'gerente',
    ]);
  });

  it('flags insufficient data under 20 completed instances: counts yes, bottleneck no', async () => {
    const events = finishedInstance(1, 0, 5, 1);
    const { service } = build({
      events,
      completed: INSUFFICIENT_DATA_THRESHOLD - 1,
      active: [{ id: 9, current_stage_key: 'jefe', stage_due_at: null }],
    });
    const res = await asStore(() => service.stageMetrics(7, range));
    expect(res.insufficient_data).toBe(true);
    expect(res.completed_instances).toBe(19);
    expect(res.bottleneck_stage_key).toBeNull();
    expect(res.stages.find((s) => s.stage_key === 'jefe')).toMatchObject({
      entered: 1,
      exited: 1,
      wip: 1,
    });
  });

  it('picks the bottleneck as max p90 x wip among stages with at least one exit', async () => {
    const events = [
      ...finishedInstance(1, 0, 10, 2),
      ...finishedInstance(2, 0, 10, 2),
      // instances stuck in gerente: entered but never exited
      {
        instance_id: 20,
        seq: 1,
        from_stage_key: null,
        to_stage_key: 'solicitud',
        occurred_at: at(0),
      },
      {
        instance_id: 20,
        seq: 2,
        from_stage_key: 'solicitud',
        to_stage_key: 'jefe',
        occurred_at: at(1),
      },
    ];
    const active = [
      {
        id: 20,
        current_stage_key: 'jefe',
        stage_due_at: new Date('2020-01-01T00:00:00Z'),
      },
      {
        id: 21,
        current_stage_key: 'jefe',
        stage_due_at: new Date('2099-01-01T00:00:00Z'),
      },
      { id: 22, current_stage_key: 'gerente', stage_due_at: null },
      { id: 23, current_stage_key: 'gerente', stage_due_at: null },
      { id: 24, current_stage_key: 'gerente', stage_due_at: null },
    ];
    const { service } = build({ events, completed: 25, active });
    const res = await asStore(() => service.stageMetrics(7, range));
    expect(res.insufficient_data).toBe(false);
    // jefe: p90 10 x wip 2 = 20 ; gerente: p90 2 x wip 3 = 6
    expect(res.bottleneck_stage_key).toBe('jefe');
    expect(res.stages.find((s) => s.stage_key === 'jefe')).toMatchObject({
      wip: 2,
      overdue_now: 1,
    });
    expect(res.stages.find((s) => s.stage_key === 'gerente')!.wip).toBe(3);
  });

  it('never picks a stage without exits even with high wip', async () => {
    const events = [
      {
        instance_id: 1,
        seq: 1,
        from_stage_key: null,
        to_stage_key: 'jefe',
        occurred_at: at(0),
      },
    ];
    const active = [{ id: 1, current_stage_key: 'jefe', stage_due_at: null }];
    const { service } = build({ events, completed: 30, active });
    const res = await asStore(() => service.stageMetrics(7, range));
    expect(res.bottleneck_stage_key).toBeNull();
    expect(res.stages.find((s) => s.stage_key === 'jefe')).toMatchObject({
      exited: 0,
      p90_hours: null,
      avg_hours: null,
    });
  });

  it('counts a looped stage once per visit', async () => {
    const events: Ev[] = [
      {
        instance_id: 1,
        seq: 1,
        from_stage_key: null,
        to_stage_key: 'jefe',
        occurred_at: at(0),
      },
      {
        instance_id: 1,
        seq: 2,
        from_stage_key: 'jefe',
        to_stage_key: 'solicitud',
        occurred_at: at(2),
      },
      {
        instance_id: 1,
        seq: 3,
        from_stage_key: 'solicitud',
        to_stage_key: 'jefe',
        occurred_at: at(3),
      },
      {
        instance_id: 1,
        seq: 4,
        from_stage_key: 'jefe',
        to_stage_key: 'fin',
        occurred_at: at(7),
      },
    ];
    const { service } = build({ events, completed: 1 });
    const res = await asStore(() => service.stageMetrics(7, range));
    expect(res.stages.find((s) => s.stage_key === 'jefe')).toMatchObject({
      entered: 2,
      exited: 2,
      avg_hours: 3,
    });
  });

  it('keeps every query inside the store and the definition', async () => {
    const { service, prisma } = build({
      events: finishedInstance(1, 0, 1, 1),
      completed: 1,
    });
    await asStore(() => service.stageMetrics(7, range));
    expect(
      prisma.workflow_definitions.findFirst.mock.calls[0][0].where,
    ).toEqual({ id: 7, store_id: 1 });
    for (const call of prisma.workflow_instances.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({ store_id: 1, definition_id: 7 });
    }
    expect(
      prisma.workflow_instances.count.mock.calls[0][0].where,
    ).toMatchObject({ store_id: 1, definition_id: 7 });
    expect(
      prisma.workflow_instance_events.findMany.mock.calls[0][0].where,
    ).toMatchObject({ store_id: 1 });
  });

  it('rejects a definition of another store', async () => {
    const { service } = build({ events: [], completed: 0, found: false });
    await expect(
      asStore(() => service.stageMetrics(7, range)),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });
});

describe('WorkflowMetricsService.stageMetrics flow permissions (P7.3)', () => {
  const restricted = (prisma: any) => {
    prisma.workflow_definitions.findFirst.mockResolvedValue({
      id: 7,
      draft_definition: null,
      published_version_id: null,
      access: { view: { roles: ['manager'], user_ids: [] } },
    });
    prisma.user_roles = { findMany: jest.fn().mockResolvedValue([]) };
  };
  const asUser = <T>(fn: () => Promise<T>, extra: Record<string, unknown> = {}) =>
    RequestContextService.run(
      { store_id: 1, organization_id: 1, user_id: 9, is_super_admin: false, is_owner: false, ...extra } as any,
      fn,
    );

  it('answers 404 for someone who may not see the flow, before reading any metric', async () => {
    const { prisma, service } = build({ events: [], completed: 0 });
    restricted(prisma);
    const err = await asUser(() => service.stageMetrics(7, range)).catch((e) => e);
    expect(err).toBeInstanceOf(VendixHttpException);
    expect(err.errorCode).toBe('WORKFLOW_DEFINITION_NOT_FOUND');
    expect(prisma.workflow_instances.findMany).not.toHaveBeenCalled();
  });

  it('serves a holder of the view role and the bypass holders', async () => {
    const { prisma, service } = build({ events: [], completed: 0 });
    restricted(prisma);
    prisma.user_roles.findMany.mockResolvedValue([{ roles: { name: 'manager', organization_id: null } }]);
    await expect(asUser(() => service.stageMetrics(7, range))).resolves.toMatchObject({ definition_id: 7 });
    prisma.user_roles.findMany.mockResolvedValue([]);
    await expect(
      asUser(() => service.stageMetrics(7, range), { permissions: ['store:workflows:manage'] }),
    ).resolves.toMatchObject({ definition_id: 7 });
  });
});
