import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import {
  WORKFLOW_EXAMPLE_PURCHASE_APPROVAL,
  validateWorkflowDefinition,
} from '../../../common/workflows/contract';
import { AIToolRegistry } from '../ai-tool-registry';
import { buildToolDocument } from '../tool-catalog';
import { TOOL_DISCOVERY_QUERIES_ES } from '../tool-discovery-queries.es';
import { createWorkflowsTools, WorkflowsToolDeps } from './workflows.tools';

const CTX = { store_id: 1, organization_id: 1, user_id: 5 };
const VALIDATION_CTX = {
  roleKeys: ['store_manager'],
  groupKeys: ['gerencia'],
  userIds: [],
};

function build(
  overrides: Partial<WorkflowsToolDeps> = {},
  industries: string[] = ['administration'],
) {
  const definitions = {
    list: jest.fn().mockResolvedValue({
      total: 2,
      data: [
        {
          id: 1,
          key: 'compras',
          name: 'Compras',
          status: 'active',
          published_version: { version: 3 },
          has_draft: true,
          secret: 'x',
        },
        {
          id: 2,
          key: 'gastos',
          name: 'Gastos',
          status: 'draft',
          published_version: null,
          has_draft: true,
        },
      ],
    }),
    create: jest
      .fn()
      .mockResolvedValue({
        id: 42,
        key: 'aprobacion_de_compras',
        status: 'draft',
      }),
    validate: jest
      .fn()
      .mockResolvedValue({ valid: true, errors: [], warnings: [] }),
    validateDefinition: jest
      .fn()
      .mockImplementation(async (d: unknown) =>
        validateWorkflowDefinition(d, VALIDATION_CTX),
      ),
    validationContext: jest.fn().mockResolvedValue(VALIDATION_CTX),
  };
  const instances = { get: jest.fn() };
  const metrics = { stageMetrics: jest.fn() };
  const deps: WorkflowsToolDeps = {
    definitions: definitions as any,
    instances: instances as any,
    metrics: metrics as any,
    findInstanceIdByReference: jest.fn().mockResolvedValue(9),
    storeTimezone: jest.fn().mockResolvedValue('America/Bogota'),
    storeIndustries: jest.fn().mockResolvedValue(industries),
    ...overrides,
  };
  const tools = createWorkflowsTools(deps);
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { deps, definitions, instances, metrics, tools, tool };
}

const call = async (t: any, args: object = {}) =>
  JSON.parse(await t.handler(args, CTX));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('registration', () => {
  it('registers the six tools with the right permissions and confirmation only on the draft', () => {
    const { tools } = build();
    const table = Object.fromEntries(
      tools.map((t) => [
        t.name,
        [
          t.requiredPermissions,
          t.requiresConfirmation === true,
          t.readOnly === true,
        ],
      ]),
    );
    expect(table).toEqual({
      workflows_list: [['store:workflows:read'], false, true],
      workflows_schema_reference: [['store:workflows:design'], false, true],
      workflows_validate_definition: [['store:workflows:design'], false, true],
      workflows_draft_from_description: [
        ['store:workflows:design'],
        true,
        false,
      ],
      workflows_explain_instance: [['store:workflows:read'], false, true],
      workflows_bottlenecks: [['store:workflows:read'], false, true],
    });
    const draft = tools.find(
      (t) => t.name === 'workflows_draft_from_description',
    )!;
    expect(draft.irreversible).toBeUndefined();
    expect(typeof draft.preview).toBe('function');
  });

  it('exposes no publish / force / cancel / delete / link / key tool and no plan gate', () => {
    const { tools } = build();
    for (const t of tools) {
      expect(t.name).not.toMatch(
        /publish|force|cancel|delete|archive|public|api_key|webhook/,
      );
      expect(JSON.stringify(t.parameters)).not.toMatch(/publish/i);
    }
  });

  it('is indexable: discovery queries exist and the catalog document builds', () => {
    const { tools } = build();
    for (const t of tools) {
      expect(TOOL_DISCOVERY_QUERIES_ES[t.name]?.length).toBeGreaterThan(0);
      expect(() => buildToolDocument(t)).not.toThrow();
    }
  });

  it('registers in the real registry and hides write tools from users without design', () => {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(build().tools);
    const names = (perms: string[]) =>
      registry
        .getAvailableDefinitions(perms)
        .map((d) => d.function.name)
        .sort();
    expect(names(['store:workflows:read'])).toEqual([
      'workflows_bottlenecks',
      'workflows_explain_instance',
      'workflows_list',
    ]);
    expect(
      names(['store:workflows:read', 'store:workflows:design']),
    ).toHaveLength(6);
    expect(
      registry.get('workflows_draft_from_description')!.requiresConfirmation,
    ).toBe(true);
  });
});

describe('industry gate (administration only, no plan gate)', () => {
  it('refuses every tool, preview included, for a store without administration', async () => {
    const { tools, deps, definitions, instances, metrics } = build({}, [
      'retail',
    ]);
    for (const t of tools) {
      const out = await call(t, {
        definition_id: 1,
        instance_id: 1,
        name: 'x',
        definition: clone(WORKFLOW_EXAMPLE_PURCHASE_APPROVAL),
      });
      expect(out.error).toMatch(/industria Administración/);
    }
    const preview = await tools.find(
      (t) => t.name === 'workflows_draft_from_description',
    )!.preview!(
      { name: 'x', definition: clone(WORKFLOW_EXAMPLE_PURCHASE_APPROVAL) },
      CTX,
    );
    expect(preview.status).toBe('error');
    expect(preview.message).toMatch(/industria Administración/);
    expect(definitions.list).not.toHaveBeenCalled();
    expect(definitions.create).not.toHaveBeenCalled();
    expect(instances.get).not.toHaveBeenCalled();
    expect(metrics.stageMetrics).not.toHaveBeenCalled();
    expect(deps.storeIndustries).toHaveBeenCalledWith(1);
  });

  it('fails closed when the store is unknown or there is no store in context', async () => {
    const { tool } = build({
      storeIndustries: jest.fn().mockResolvedValue(null),
    });
    expect((await call(tool('workflows_list'))).error).toMatch(
      /Administración/,
    );
    const noStore = await tool('workflows_list').handler!({}, {
      user_id: 1,
    } as any);
    expect(JSON.parse(noStore).error).toMatch(/Sin tienda/);
  });

  it('works for administration', async () => {
    const { tool } = build();
    expect((await call(tool('workflows_list'))).total).toBe(2);
  });
});

describe('workflows_list', () => {
  it('lists up to 50 definitions with status and published version only', async () => {
    const { tool, definitions } = build();
    const out = await call(tool('workflows_list'), { status: 'active' });
    expect(definitions.list).toHaveBeenCalledWith({
      limit: 50,
      page: 1,
      status: 'active',
    });
    expect(out.workflows[0]).toEqual({
      id: 1,
      key: 'compras',
      name: 'Compras',
      status: 'active',
      published_version: 3,
      has_draft: true,
    });
  });
});

describe('workflows_schema_reference', () => {
  it('returns the schema summary, an example and the real role and group keys', async () => {
    const { tool } = build();
    const out = await call(tool('workflows_schema_reference'));
    expect(out.schema).toBe('vendix.workflow/v1');
    expect(out.role_keys).toEqual(['store_manager']);
    expect(out.group_keys).toEqual(['gerencia']);
    expect(out.example.key).toBe('aprobacion-compras');
    expect(out.stage_outcomes.approval).toEqual(['approve', 'reject']);
    expect(out.rules.join(' ')).toMatch(/Nunca inventes roles/);
  });
});

describe('workflows_validate_definition', () => {
  it('returns the deterministic verdict and Spanish messages for an inline definition', async () => {
    const { tool } = build();
    const bad = clone(WORKFLOW_EXAMPLE_PURCHASE_APPROVAL);
    (bad.stages[1].assignee as any).role_key = 'inventado';
    const out = await call(tool('workflows_validate_definition'), {
      definition: bad,
    });
    expect(out.valid).toBe(false);
    expect(out.errors.some((e: any) => e.code === 'ROLE_UNKNOWN')).toBe(true);
    expect(out.messages[0]).toMatch(/^Error: /);
    expect(out.definition_id).toBeNull();
  });

  it('validates a saved draft by id with the definitions service', async () => {
    const { tool, definitions } = build();
    const out = await call(tool('workflows_validate_definition'), {
      definition_id: 7,
    });
    expect(definitions.validate).toHaveBeenCalledWith(7);
    expect(out).toMatchObject({ definition_id: 7, valid: true });
  });

  it('requires exactly one of definition_id / definition', async () => {
    const { tool } = build();
    expect(
      (await call(tool('workflows_validate_definition'), {})).error,
    ).toMatch(/solo uno/);
    expect(
      (
        await call(tool('workflows_validate_definition'), {
          definition_id: 1,
          definition: {},
        })
      ).error,
    ).toMatch(/solo uno/);
  });

  it('turns a service failure into a guided error', async () => {
    const { tool, definitions } = build();
    definitions.validate.mockRejectedValue(
      new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND),
    );
    expect(
      (await call(tool('workflows_validate_definition'), { definition_id: 99 }))
        .error,
    ).toBeTruthy();
  });
});

describe('workflows_draft_from_description', () => {
  const valid = () => clone(WORKFLOW_EXAMPLE_PURCHASE_APPROVAL);
  const invalid = () => {
    const d = valid();
    (d.stages[2].assignee as any).group_key = 'no_existe';
    return d;
  };

  it('does not propose when the definition is invalid: returns the issues for one retry', async () => {
    const { tool, definitions } = build();
    const t = tool('workflows_draft_from_description');
    const preview = await t.preview!(
      { name: 'Compras', definition: invalid() },
      CTX,
    );
    expect(preview.status).toBe('error');
    expect(preview.changes).toEqual([]);
    expect(preview.message).toMatch(/GROUP|grupo/i);
    expect(preview.message).toMatch(/UNA sola vez/);
    const out = await call(t, { name: 'Compras', definition: invalid() });
    expect(out.error).toMatch(/no es válida/);
    expect(out.issues.some((i: any) => i.code === 'GROUP_UNKNOWN')).toBe(true);
    expect(definitions.create).not.toHaveBeenCalled();
  });

  it('rejects a missing name or a non-object definition', async () => {
    const { tool } = build();
    const t = tool('workflows_draft_from_description');
    expect((await call(t, { name: '  ', definition: valid() })).error).toMatch(
      /nombre/,
    );
    expect((await call(t, { name: 'x', definition: 'json' })).error).toMatch(
      /objeto JSON/,
    );
  });

  it('previews stages in order with Spanish type, assignee and transitions, plus the fields', async () => {
    const { tool, definitions } = build();
    const preview = await tool('workflows_draft_from_description').preview!(
      {
        name: 'Aprobación de compras',
        description: 'Compras con dos firmas',
        definition: valid(),
      },
      CTX,
    );
    expect(preview.status).toBe('ok');
    expect(preview.target).toBe('Borrador de flujo «Aprobación de compras»');
    const byField = Object.fromEntries(
      preview.changes.map((c) => [c.field, c.to as string]),
    );
    expect(byField.fields).toContain('Monto estimado (money, obligatorio)');
    expect(
      preview.changes
        .filter((c) => c.field.startsWith('stage:'))
        .map((c) => c.label),
    ).toEqual([
      'Etapa 1 · Solicitud',
      'Etapa 2 · Aprobación jefe de tienda',
      'Etapa 3 · Aprobación gerencia',
      'Etapa 4 · Aprobada',
      'Etapa 5 · Rechazada',
    ]);
    expect(byField['stage:solicitud']).toContain(
      'Responsable: Quien inicia la solicitud',
    );
    expect(byField['stage:jefe']).toContain('Tipo: Aprobación');
    expect(byField['stage:jefe']).toContain('Responsable: Rol «store_manager»');
    expect(byField['stage:jefe']).toContain(
      'Aprobar (con condición) → Aprobación gerencia',
    );
    expect(byField['stage:jefe']).toContain('Rechazar → Rechazada');
    expect(byField['stage:gerente']).toContain('Grupo «gerencia»');
    expect(byField['stage:aprobada']).toContain('Resultado: completado');
    expect(preview.message).toMatch(/BORRADOR/);
    expect(definitions.create).not.toHaveBeenCalled();
  });

  it('surfaces validator warnings in the preview', async () => {
    const warn = {
      code: 'UNREACHABLE_STAGE',
      path: 'stages[3]',
      message: 'Etapa sin uso.',
    };
    const { tool } = build({}, ['administration']);
    const t = tool('workflows_draft_from_description');
    const { deps } = build();
    (deps.definitions.validateDefinition as jest.Mock).mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [warn],
    });
    const again = createWorkflowsTools(deps).find((x) => x.name === t.name)!;
    const preview = await again.preview!(
      { name: 'x', definition: valid() },
      CTX,
    );
    expect(preview.status).toBe('warning');
    expect(preview.message).toContain('Etapa sin uso.');
  });

  it('executes by creating a DRAFT through the definitions service and returns the edit url; never publishes', async () => {
    const { tool, definitions } = build();
    const def = valid();
    const out = await call(tool('workflows_draft_from_description'), {
      name: ' Aprobación de compras ',
      description: 'Compras con dos firmas',
      definition: def,
    });
    expect(definitions.create).toHaveBeenCalledTimes(1);
    expect(definitions.create).toHaveBeenCalledWith({
      name: 'Aprobación de compras',
      description: 'Compras con dos firmas',
      definition: def,
    });
    expect(Object.keys(definitions)).not.toContain('publish');
    expect(out).toMatchObject({
      id: 42,
      key: 'aprobacion_de_compras',
      status: 'draft',
      edit_url: '/admin/workflows/42/edit',
    });
    expect(out.warnings).toEqual([]);
    expect(out.note).toMatch(/Publicar/);
  });

  it('keeps the validation warnings in the result', async () => {
    const { deps } = build();
    const warn = {
      code: 'UNREACHABLE_STAGE',
      path: 'stages[3]',
      message: 'Etapa sin uso.',
    };
    (deps.definitions.validateDefinition as jest.Mock).mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [warn],
    });
    const t = createWorkflowsTools(deps).find(
      (x) => x.name === 'workflows_draft_from_description',
    )!;
    const out = JSON.parse(
      (await t.handler!({ name: 'x', definition: valid() }, CTX)) as string,
    );
    expect(out.warnings).toEqual([warn]);
  });

  it('turns a creation failure into a guided error', async () => {
    const { tool, definitions } = build();
    definitions.create.mockRejectedValue(
      new VendixHttpException(ErrorCodes.WORKFLOW_DRAFT_INVALID),
    );
    const out = await call(tool('workflows_draft_from_description'), {
      name: 'x',
      definition: valid(),
    });
    expect(out.error).toBeTruthy();
  });
});

describe('workflows_explain_instance', () => {
  const event = (seq: number) => ({
    seq,
    type: 'transitioned',
    from_stage_key: 'jefe',
    to_stage_key: 'gerente',
    actor_type: 'user',
    actor_name: 'Ana Pérez',
    payload: { outcome: 'approve', note: 'no debe salir' },
    occurred_at: new Date(Date.UTC(2026, 9, 1, 15, 0, seq)),
  });
  const detail = () => ({
    id: 9,
    reference: 'FLU-000009',
    title: 'Compra de laptops',
    status: 'active',
    current_stage_key: 'gerente',
    stage_entered_at: new Date(Date.now() - 5 * 3_600_000),
    stage_due_at: new Date(Date.now() - 2 * 3_600_000),
    created_at: new Date(Date.UTC(2026, 9, 1, 15, 0, 0)),
    completed_at: null,
    started_by: { type: 'user', id: 3, name: 'Luis' },
    definition: { name: 'Compras', version: 2 },
    stage: { key: 'gerente', name: 'Aprobación gerencia', type: 'approval' },
    tasks: [
      {
        kind: 'approval',
        status: 'open',
        assignee: { type: 'group', name: 'Gerencia' },
        due_at: new Date(Date.now() - 2 * 3_600_000),
        can_act: false,
      },
    ],
    pending_requirements: [
      { key: 'cotizacion_adjunta', label: 'Cotización adjunta' },
    ],
    allowed_outcomes: ['approve', 'reject'],
    timeline: Array.from({ length: 25 }, (_, i) => event(i + 1)),
    comments: [{ body: 'secreto' }, { body: 'otro' }],
  });

  it('summarizes stage, holder, time in stage, overdue, requirements and the last 20 events in store time', async () => {
    const { tool, instances } = build();
    instances.get.mockResolvedValue(detail());
    const out = await call(tool('workflows_explain_instance'), {
      instance_id: 9,
    });
    expect(instances.get).toHaveBeenCalledWith(9);
    expect(out).toMatchObject({
      timezone: 'America/Bogota',
      reference: 'FLU-000009',
      status: 'active',
      current_stage: {
        key: 'gerente',
        name: 'Aprobación gerencia',
        type: 'approval',
      },
      created_at: '2026-10-01 10:00',
      comments_count: 2,
      timeline_total: 25,
    });
    expect(out.hours_in_stage).toBeGreaterThanOrEqual(4.9);
    expect(out.due.overdue).toBe(true);
    expect(out.due.hours_overdue).toBeGreaterThanOrEqual(1.9);
    expect(out.who_has_the_task).toEqual([
      expect.objectContaining({
        kind: 'approval',
        assignee: { type: 'group', name: 'Gerencia' },
        can_current_user_act: false,
      }),
    ]);
    expect(out.pending_requirements).toEqual([
      { key: 'cotizacion_adjunta', label: 'Cotización adjunta' },
    ]);
    expect(out.timeline).toHaveLength(20);
    expect(out.timeline[0].seq).toBe(6);
    expect(out.timeline[19]).toEqual({
      seq: 25,
      type: 'transitioned',
      at: '2026-10-01 10:00',
      from_stage: 'jefe',
      to_stage: 'Aprobación gerencia',
      actor: 'Ana Pérez',
      outcome: 'approve',
    });
    expect(JSON.stringify(out)).not.toMatch(/secreto|no debe salir/);
  });

  it('resolves a reference inside the store and then applies the instances visibility rule', async () => {
    const { tool, instances, deps } = build();
    instances.get.mockResolvedValue(detail());
    await call(tool('workflows_explain_instance'), { reference: 'FLU-000009' });
    expect(deps.findInstanceIdByReference).toHaveBeenCalledWith('FLU-000009');
    expect(instances.get).toHaveBeenCalledWith(9);
  });

  it('answers not found for another store, a non-participant or an unknown reference', async () => {
    const { tool, instances, deps } = build();
    instances.get.mockRejectedValue(
      new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND),
    );
    const hidden = await call(tool('workflows_explain_instance'), {
      instance_id: 77,
    });
    expect(hidden.error).toMatch(/no tienes acceso/);
    expect(JSON.stringify(hidden)).not.toMatch(/Compra de laptops/);
    (deps.findInstanceIdByReference as jest.Mock).mockResolvedValue(null);
    instances.get.mockClear();
    const unknown = await call(tool('workflows_explain_instance'), {
      reference: 'FLU-999999',
    });
    expect(unknown.error).toMatch(/No encontré/);
    expect(instances.get).not.toHaveBeenCalled();
    expect((await call(tool('workflows_explain_instance'), {})).error).toMatch(
      /No encontré/,
    );
  });

  it('does not report time in stage or overdue for a closed instance', async () => {
    const { tool, instances } = build();
    instances.get.mockResolvedValue({
      ...detail(),
      status: 'completed',
      completed_at: new Date(),
      tasks: [],
    });
    const out = await call(tool('workflows_explain_instance'), {
      instance_id: 9,
    });
    expect(out.hours_in_stage).toBeNull();
    expect(out.due.overdue).toBe(false);
  });
});

describe('workflows_bottlenecks', () => {
  const metrics = (over: object = {}) => ({
    definition_id: 3,
    completed_instances: 30,
    insufficient_data: false,
    bottleneck_stage_key: 'jefe',
    truncated: false,
    stages: [
      {
        stage_key: 'jefe',
        name: 'Aprobación jefe',
        wip: 4,
        entered: 20,
        exited: 16,
        avg_hours: 30,
        p90_hours: 70,
        overdue_now: 2,
      },
      {
        stage_key: 'gerente',
        name: 'Gerencia',
        wip: 1,
        entered: 10,
        exited: 9,
        avg_hours: 5,
        p90_hours: 9,
        overdue_now: 0,
      },
    ],
    ...over,
  });

  it('returns server-computed stage metrics and the bottleneck, asking for the default 90 days', async () => {
    const { tool, metrics: m } = build();
    m.stageMetrics.mockResolvedValue(metrics());
    const out = await call(tool('workflows_bottlenecks'), { definition_id: 3 });
    const [id, range] = m.stageMetrics.mock.calls[0];
    expect(id).toBe(3);
    expect(Math.round((range.to - range.from) / 86_400_000)).toBe(90);
    expect(out).toMatchObject({
      insufficient_data: false,
      bottleneck_stage_key: 'jefe',
      bottleneck_stage_name: 'Aprobación jefe',
      completed_instances: 30,
      window: { days: 90, timezone: 'America/Bogota' },
    });
    expect(out.stages).toEqual(metrics().stages);
    expect(out.message).toBeUndefined();
  });

  it('says "Datos insuficientes" and gives no bottleneck under 20 completed instances', async () => {
    const { tool, metrics: m } = build();
    m.stageMetrics.mockResolvedValue(
      metrics({
        insufficient_data: true,
        completed_instances: 12,
        bottleneck_stage_key: null,
      }),
    );
    const out = await call(tool('workflows_bottlenecks'), {
      definition_id: 3,
      days: 30,
    });
    expect(out.insufficient_data).toBe(true);
    expect(out.message).toMatch(/^Datos insuficientes/);
    expect(out.bottleneck_stage_key).toBeNull();
    expect(out.bottleneck_stage_name).toBeNull();
    expect(out.stages).toHaveLength(2);
    expect(out.window.days).toBe(30);
  });

  it.each([6, 366, 1.5, 'x'])('rejects a window of %p days', async (days) => {
    const { tool, metrics: m } = build();
    const out = await call(tool('workflows_bottlenecks'), {
      definition_id: 3,
      days,
    });
    expect(out.error).toMatch(/entre 7 y 365/);
    expect(m.stageMetrics).not.toHaveBeenCalled();
  });

  it('requires a definition id and reports a missing flow as a guided error', async () => {
    const { tool, metrics: m } = build();
    expect((await call(tool('workflows_bottlenecks'), {})).error).toMatch(
      /definition_id/,
    );
    m.stageMetrics.mockRejectedValue(
      new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND),
    );
    expect(
      (await call(tool('workflows_bottlenecks'), { definition_id: 99 })).error,
    ).toBeTruthy();
  });
});
