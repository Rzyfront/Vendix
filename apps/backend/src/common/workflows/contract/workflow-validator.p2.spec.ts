import {
  WORKFLOW_SCHEMA_V1,
  WorkflowDefinitionV1,
  validateWorkflowDefinition,
} from './index';

/** Minimal valid flow: form → <middle stages> → end. */
const flow = (middle: any[], extra: Partial<WorkflowDefinitionV1> = {}): any => ({
  schema: WORKFLOW_SCHEMA_V1,
  key: 'ingreso',
  name: 'Ingreso',
  fields: [
    { key: 'monto', type: 'money', label: 'Monto' },
    { key: 'fecha', type: 'date', label: 'Fecha' },
    { key: 'nit', type: 'text', label: 'NIT' },
  ],
  stages: [
    {
      key: 'inicio',
      name: 'Inicio',
      type: 'form',
      start: true,
      assignee: { kind: 'initiator' },
      form: { fields: ['monto'] },
      transitions: [
        { to: 'error', on: 'submit', when: { all: [{ field: 'monto', op: 'lt', value: 0 }] } },
        { to: middle[0]?.key ?? 'fin', on: 'submit' },
      ],
    },
    ...middle,
    { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
    { key: 'error', name: 'Error', type: 'end', outcome: 'rejected' },
  ],
  ...extra,
});
const codes = (d: any, ctx?: any) => validateWorkflowDefinition(d, ctx).errors.map((e) => e.code);
const role = { kind: 'role', role_key: 'admin' };

describe('P2 validator — parallel (P2.1)', () => {
  const par = (cfg: any) => ({
    key: 'alistamiento',
    name: 'Alistamiento',
    type: 'parallel',
    parallel: cfg,
    transitions: [{ to: 'fin', on: 'joined' }],
  });
  const branches = [
    { key: 'ti', name: 'TI', assignee: role },
    { key: 'nomina', name: 'Nómina', assignee: role, form: { fields: ['nit'] } },
    { key: 'dotacion', name: 'Dotación', assignee: role },
  ];

  it('all / any / n_of_m are valid', () => {
    expect(codes(flow([par({ branches, join: 'all' })]))).toEqual([]);
    expect(codes(flow([par({ branches, join: 'any' })]))).toEqual([]);
    expect(codes(flow([par({ branches, join: 'n_of_m', required: 2 })]))).toEqual([]);
  });

  it('rejects one branch, a bad join, N out of range, missing assignee and the stage assignee', () => {
    expect(codes(flow([par({ branches: [branches[0]], join: 'all' })]))).toContain('PARALLEL_INVALID');
    expect(codes(flow([par({ branches, join: 'most' })]))).toContain('PARALLEL_INVALID');
    expect(codes(flow([par({ branches, join: 'n_of_m', required: 4 })]))).toContain('PARALLEL_INVALID');
    expect(
      codes(flow([par({ branches: [{ key: 'a', name: 'A' }, branches[1]], join: 'all' })])),
    ).toContain('ASSIGNEE_MISSING');
    expect(codes(flow([{ ...par({ branches, join: 'all' }), assignee: role }]))).toContain(
      'ASSIGNEE_NOT_ALLOWED',
    );
  });

  it('needs its "joined" transition', () => {
    expect(codes(flow([{ ...par({ branches, join: 'all' }), transitions: [] }]))).toContain(
      'DEFAULT_BRANCH_MISSING',
    );
  });
});

describe('P2 validator — subflow (P2.2)', () => {
  const sub = (cfg: any) => ({
    key: 'alta',
    name: 'Alta de proveedor',
    type: 'subflow',
    subflow: cfg,
    transitions: [
      { to: 'fin', on: 'completed' },
      { to: 'error', on: 'rejected' },
    ],
  });

  it('valid with map, wait and output against the store flows', () => {
    const d = flow([
      sub({
        flows: [{ flow_key: 'alta-proveedor', map: { nombre: '{{fields.nit}} {{instance.reference}}' } }],
        output: { nit: 'alta-proveedor.nit' },
      }),
    ]);
    expect(codes(d, { flowKeys: ['alta-proveedor'] })).toEqual([]);
  });

  it('rejects itself, unknown flows, bad tokens and output without waiting', () => {
    expect(codes(flow([sub({ flows: [{ flow_key: 'ingreso' }] })]))).toContain('SUBFLOW_INVALID');
    expect(codes(flow([sub({ flows: [{ flow_key: 'otro' }] })]), { flowKeys: ['x'] })).toContain(
      'SUBFLOW_INVALID',
    );
    expect(codes(flow([sub({ flows: [{ flow_key: 'otro', map: { a: '{{event.x}}' } }] })]))).toContain(
      'TOKEN_UNKNOWN',
    );
    expect(
      codes(flow([sub({ flows: [{ flow_key: 'otro' }], wait: false, output: { nit: 'otro.nit' } })])),
    ).toContain('SUBFLOW_INVALID');
    expect(codes(flow([sub({ flows: [{ flow_key: 'otro' }], output: { nit: 'x.nit' } })]))).toContain(
      'MAP_INVALID',
    );
  });

  it('a waiting subflow needs "rejected"; a fire-and-forget one only "completed"', () => {
    const waiting = sub({ flows: [{ flow_key: 'otro' }] });
    waiting.transitions = [{ to: 'fin', on: 'completed' }];
    expect(codes(flow([waiting]))).toContain('DEFAULT_BRANCH_MISSING');
    const fire = sub({ flows: [{ flow_key: 'otro' }], wait: false });
    fire.transitions = [{ to: 'fin', on: 'completed' }];
    expect(codes(flow([fire]))).toEqual([]);
  });
});

describe('P2 validator — wait (P2.3)', () => {
  const wait = (cfg: any) => ({
    key: 'espera',
    name: 'Espera',
    type: 'wait',
    wait: cfg,
    transitions: [{ to: 'fin', on: 'elapsed' }],
  });

  it('accepts every kind', () => {
    for (const cfg of [
      { kind: 'duration', days: 3 },
      { kind: 'date', date: '2026-12-01', time: '08:00' },
      { kind: 'field', field: 'fecha', offset_days: 3 },
      { kind: 'business_days', days: 2 },
      { kind: 'day_of_month', day: 5 },
    ]) {
      expect(codes(flow([wait(cfg)]))).toEqual([]);
    }
  });

  it('rejects zero duration, non-date fields, bad times and day 31', () => {
    expect(codes(flow([wait({ kind: 'duration' })]))).toContain('WAIT_INVALID');
    expect(codes(flow([wait({ kind: 'field', field: 'nit' })]))).toContain('WAIT_INVALID');
    expect(codes(flow([wait({ kind: 'date', date: '2026-12-01', time: '25:00' })]))).toContain('WAIT_INVALID');
    expect(codes(flow([wait({ kind: 'day_of_month', day: 31 })]))).toContain('WAIT_INVALID');
    expect(codes(flow([{ ...wait({ kind: 'duration', days: 1 }), wait: undefined }]))).toContain('WAIT_INVALID');
  });
});

describe('P2 validator — loop (P2.4)', () => {
  const loopStages = (max?: number) => [
    {
      key: 'vuelta',
      name: 'Vuelta',
      type: 'loop',
      loop: { while: { all: [{ field: 'monto', op: 'gt', value: 0 }] }, ...(max === undefined ? {} : { max_iterations: max }) },
      transitions: [
        { to: 'paso', on: 'continue' },
        { to: 'fin', on: 'done' },
      ],
    },
    {
      key: 'paso',
      name: 'Paso',
      type: 'automatic',
      on_enter: [{ action: 'set_field', field: 'nit', value: 'x' }],
      transitions: [{ to: 'vuelta', on: 'auto' }],
    },
  ];

  it('the validator demands the hard limit', () => {
    const r = validateWorkflowDefinition(flow(loopStages()));
    expect(r.errors.map((e) => e.code)).toContain('LOOP_LIMIT_MISSING');
    expect(r.errors.map((e) => e.message)).toContain(
      'La etapa "Vuelta": el bucle necesita un límite de vueltas (1 a 100).',
    );
    expect(codes(flow(loopStages(101)))).toContain('LOOP_LIMIT_MISSING');
  });

  it('an automatic cycle is allowed only through a bounded loop', () => {
    expect(codes(flow(loopStages(3)))).toEqual([]);
    const noLoop = flow([
      { key: 'a', name: 'A', type: 'automatic', transitions: [{ to: 'b', on: 'auto' }] },
      {
        key: 'b',
        name: 'B',
        type: 'wait',
        wait: { kind: 'duration', minutes: 1 },
        transitions: [
          { to: 'a', on: 'elapsed', when: { all: [{ field: 'monto', op: 'gt', value: 0 }] } },
          { to: 'fin', on: 'elapsed' },
        ],
      },
    ]);
    expect(codes(noLoop)).toContain('AUTOMATIC_LOOP');
  });
});

describe('P2 validator — guards, hook points, error policy, compute, schedule', () => {
  const approval = (extra: any) => ({
    key: 'aprobacion',
    name: 'Aprobación',
    type: 'approval',
    assignee: role,
    transitions: [
      { to: 'fin', on: 'approve' },
      { to: 'error', on: 'reject' },
    ],
    ...extra,
  });

  it('guards block or redirect to an existing stage', () => {
    const when = { all: [{ field: 'monto', op: 'gt', value: 5000000 }] };
    expect(codes(flow([approval({ guards: [{ when, message: 'Excede el presupuesto' }] })]))).toEqual([]);
    expect(
      codes(flow([approval({ guards: [{ when, message: 'Va a error', redirect_to: 'error' }] })])),
    ).toEqual([]);
    expect(codes(flow([approval({ guards: [{ when, message: '' }] })]))).toContain('GUARD_INVALID');
    expect(
      codes(flow([approval({ guards: [{ when, message: 'x', redirect_to: 'nada' }] })])),
    ).toContain('TRANSITION_TARGET_UNKNOWN');
  });

  it('a guard on a stage nobody submits must redirect (a blocked system stage would stay stuck)', () => {
    const when = { all: [{ field: 'monto', op: 'gt', value: 5000000 }] };
    const auto = (guard: Record<string, unknown>) =>
      flow([
        {
          key: 'auto',
          name: 'Auto',
          type: 'automatic',
          guards: [{ when, ...guard }],
          transitions: [{ to: 'fin', on: 'auto' }],
        },
      ]);
    expect(codes(auto({ message: 'Excede el presupuesto' }))).toContain('GUARD_INVALID');
    expect(codes(auto({ message: 'Va a error', redirect_to: 'error' }))).toEqual([]);
  });

  it('accepts the four hook points; on_submit only where people submit', () => {
    const set = [{ action: 'set_field', field: 'nit', value: '1' }];
    expect(
      codes(flow([approval({ on_enter: set, on_submit: set, on_complete: set, on_exit: set })])),
    ).toEqual([]);
    expect(
      codes(
        flow([
          { key: 'auto', name: 'Auto', type: 'automatic', on_submit: set, transitions: [{ to: 'fin', on: 'auto' }] },
        ]),
      ),
    ).toContain('SHAPE_INVALID');
  });

  it('error policy: retries 0..5, then route needs an existing stage', () => {
    const action = (on_error: any) => ({
      key: 'auto',
      name: 'Auto',
      type: 'automatic',
      on_enter: [{ action: 'vendix.crm_task.create', map: { title: 'x' }, on_error }],
      transitions: [{ to: 'fin', on: 'auto' }],
    });
    expect(codes(flow([action({ retries: 2, then: 'route', route_to: 'error' })]))).toEqual([]);
    expect(codes(flow([action({ retries: 9 })]))).toContain('ERROR_POLICY_INVALID');
    expect(codes(flow([action({ then: 'route' })]))).toContain('ERROR_POLICY_INVALID');
    expect(codes(flow([action({ then: 'continue', route_to: 'error' })]))).toContain('ERROR_POLICY_INVALID');
  });

  it('computed fields: valid formula, unknown refs, cycles, wrong types', () => {
    const withFields = (fields: any[]) => {
      const d = flow([]);
      d.fields.push(...fields);
      return d;
    };
    expect(
      codes(withFields([{ key: 'total_iva', type: 'money', label: 'Total con IVA', compute: 'round(monto * 1.19, 2)' }])),
    ).toEqual([]);
    expect(codes(withFields([{ key: 't', type: 'money', label: 'T', compute: 'nada * 2' }]))).toContain(
      'FIELD_UNKNOWN',
    );
    expect(
      codes(
        withFields([
          { key: 'a', type: 'number', label: 'A', compute: 'b + 1' },
          { key: 'b', type: 'number', label: 'B', compute: 'a + 1' },
        ]),
      ),
    ).toContain('COMPUTE_CYCLE');
    expect(codes(withFields([{ key: 'f', type: 'file', label: 'F', compute: '1' }]))).toContain(
      'EXPRESSION_INVALID',
    );
    expect(codes(withFields([{ key: 't', type: 'text', label: 'T', compute: 'eval(1)' }]))).toContain(
      'EXPRESSION_INVALID',
    );
  });

  it('schedule trigger: cron syntax and no initiator at the start', () => {
    const d = flow([]);
    d.stages[0].assignee = role;
    d.triggers = [{ kind: 'schedule', cron: '0 8 * * 1' }];
    expect(codes(d)).toEqual([]);
    d.triggers = [{ kind: 'schedule', cron: '0 25 * * 1' }];
    expect(codes(d)).toContain('SCHEDULE_INVALID');
    const e = flow([], { triggers: [{ kind: 'schedule', cron: '0 8 * * 1' }] } as never);
    expect(codes(e)).toContain('ASSIGNEE_NOT_ALLOWED');
  });
});
