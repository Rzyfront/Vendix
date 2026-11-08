import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import {
  WORKFLOW_EXAMPLE_PURCHASE_APPROVAL,
  validateWorkflowDefinition,
} from '../../../common/workflows/contract';
import { AIToolRegistry } from '../ai-tool-registry';
import { buildToolDocument } from '../tool-catalog';
import { TOOL_DISCOVERY_QUERIES_ES } from '../tool-discovery-queries.es';
import { createWorkflowsTools, WorkflowsToolDeps } from './workflows.tools';
import { WORKFLOW_TEMPLATES } from '../../../domains/store/workflows/templates/workflow-templates.catalog';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
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
    get: jest.fn().mockResolvedValue({
      id: 1,
      key: 'compras',
      name: 'Compras',
      status: 'active',
      is_enabled: true,
      published_version: { version: 3 },
      has_unpublished_changes: true,
    }),
    getDraft: jest.fn().mockResolvedValue({
      id: 1,
      key: 'compras',
      definition: clone(WORKFLOW_EXAMPLE_PURCHASE_APPROVAL),
      draft_updated_at: new Date('2026-11-01T10:00:00.000Z'),
    }),
    saveDraft: jest
      .fn()
      .mockResolvedValue({ id: 1, draft_updated_at: new Date('2026-11-02') }),
    publish: jest.fn().mockResolvedValue({
      unchanged: false,
      version: { version: 4 },
      warnings: [],
    }),
    version: jest.fn().mockResolvedValue({
      definition: {
        fields: [
          { key: 'monto', label: 'Monto' },
          { key: 'motivo', label: 'Motivo' },
        ],
      },
    }),
  };
  const engine = {
    start: jest.fn().mockResolvedValue({
      instance: { id: 77, reference: 'FLU-000077', status: 'active' },
    }),
    completeTask: jest.fn().mockResolvedValue({
      instance: { id: 9, reference: 'FLU-000009', status: 'active' },
      advanced: true,
      replayed: false,
    }),
  };
  const instances = { get: jest.fn() };
  const metrics = { stageMetrics: jest.fn() };
  const deps: WorkflowsToolDeps = {
    definitions: definitions as any,
    instances: instances as any,
    metrics: metrics as any,
    engine: engine as any,
    findInstanceIdByReference: jest.fn().mockResolvedValue(9),
    findInstanceIdByTaskId: jest.fn().mockResolvedValue(9),
    storeTimezone: jest.fn().mockResolvedValue('America/Bogota'),
    storeIndustries: jest.fn().mockResolvedValue(industries),
    ...overrides,
  };
  const tools = createWorkflowsTools(deps);
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { deps, definitions, instances, metrics, engine, tools, tool };
}

const call = async (t: any, args: object = {}) =>
  JSON.parse(await t.handler(args, CTX));

describe('registration', () => {
  it('registers the ten tools with the right permissions and confirmation on the five writes', () => {
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
      workflows_update_draft: [['store:workflows:design'], true, false],
      workflows_publish_definition: [['store:workflows:design'], true, false],
      workflows_start_instance: [['store:workflows:start'], true, false],
      workflows_complete_task: [['store:workflows:task'], true, false],
    });
    const draft = tools.find(
      (t) => t.name === 'workflows_draft_from_description',
    )!;
    expect(draft.irreversible).toBeUndefined();
    expect(typeof draft.preview).toBe('function');
  });

  it('exposes no force / cancel / delete / link / key tool and no plan gate (publish exists, with confirmation)', () => {
    const { tools } = build();
    for (const t of tools) {
      expect(t.name).not.toMatch(
        /force|cancel|delete|archive|public_|api_key|webhook/,
      );
    }
    expect(
      tools.find((t) => t.name === 'workflows_publish_definition')!
        .requiresConfirmation,
    ).toBe(true);
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
    expect(names(['store:workflows:read', 'store:workflows:task'])).toContain(
      'workflows_complete_task',
    );
    expect(names(['store:workflows:read'])).toEqual([
      'workflows_bottlenecks',
      'workflows_explain_instance',
      'workflows_list',
    ]);
    expect(
      names(['store:workflows:read', 'store:workflows:design']),
    ).toHaveLength(8);
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

  it('previews an AI step with its task, the fields it reads and writes, and its reviewer', async () => {
    const { tool, definitions } = build();
    const ctx = { roleKeys: ['employee', 'manager'], groupKeys: [], userIds: [] };
    definitions.validateDefinition.mockImplementation(async (d: unknown) =>
      validateWorkflowDefinition(d, ctx),
    );
    definitions.validationContext.mockResolvedValue(ctx);
    const pqr = WORKFLOW_TEMPLATES.find((t) => t.key === 'pqr')!;
    const preview = await tool('workflows_draft_from_description').preview!(
      { name: 'PQR', definition: clone(pqr.definition) },
      CTX,
    );
    expect(preview.status).toBe('ok');
    const byField = Object.fromEntries(
      preview.changes.map((c) => [c.field, c.to as string]),
    );
    expect(byField['stage:clasificar']).toContain('Tipo: Paso de IA');
    expect(byField['stage:clasificar']).toContain('IA: clasificar');
    expect(byField['stage:clasificar']).toContain('Lee: asunto, detalle');
    expect(byField['stage:clasificar']).toContain('Escribe: tipo');
    expect(byField['stage:clasificar']).not.toContain('Revisa:');
    expect(byField['stage:clasificar']).not.toContain('Responsable:');
    expect(byField['stage:redactar']).toContain('IA: redactar');
    expect(byField['stage:redactar']).toContain('Revisa: Rol «employee»');
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
    expect(definitions.publish).not.toHaveBeenCalled();
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

// ─── P6.2 write tools ────────────────────────────────────────────────────

const STAMP = '2026-11-01T10:00:00.000Z';

function validDefinition() {
  return clone(WORKFLOW_EXAMPLE_PURCHASE_APPROVAL);
}

/** The example definition plus a new automatic-free approval stage is too coupled: rename + retype instead. */
function editedDefinition() {
  const d: any = validDefinition();
  d.fields = [
    ...d.fields,
    { key: 'observaciones', type: 'text', label: 'Observaciones' },
  ];
  d.stages[0].name = 'Radicación nueva';
  return d;
}

const taskDetail = (over: Record<string, unknown> = {}) => ({
  id: 9,
  reference: 'FLU-000009',
  title: 'Vacaciones de Ana',
  status: 'active',
  row_version: 4,
  stage: { key: 'revision', name: 'Revisión del jefe' },
  allowed_outcomes: ['approve', 'reject'],
  tasks: [
    { id: 31, status: 'open', stage_key: 'revision', can_act: true },
    { id: 30, status: 'done', stage_key: 'inicio', can_act: false },
  ],
  ...over,
});

describe('workflows_update_draft', () => {
  it('proposal: shows the Spanish diff and executes nothing', async () => {
    const { tool, definitions } = build();
    const preview = await tool('workflows_update_draft').preview!(
      { definition_id: 1, definition: editedDefinition() },
      CTX,
    );
    expect(preview.status).toBe('ok');
    expect(preview.target).toBe('Borrador del flujo «Compras»');
    const byField = Object.fromEntries(
      preview.changes.map((c) => [c.field, c.to as string]),
    );
    expect(byField.stages_renamed).toContain('→ «Radicación nueva»');
    expect(byField.fields_added).toBe('Observaciones');
    expect(preview.message).toMatch(/BORRADOR/);
    expect(definitions.saveDraft).not.toHaveBeenCalled();
  });

  it('reports stages added, removed and retyped with the Spanish type labels', async () => {
    const { tool, definitions } = build();
    const next: any = validDefinition();
    const removed = next.stages.pop();
    next.stages[0].type = 'review';
    definitions.validateDefinition.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    });
    const preview = await tool('workflows_update_draft').preview!(
      { definition_id: 1, definition: next },
      CTX,
    );
    const byField = Object.fromEntries(
      preview.changes.map((c) => [c.field, c.to as string]),
    );
    expect(byField.stages_removed).toContain(removed.name);
    expect(byField.stages_retyped).toMatch(/→ Revisión/);
  });

  it('execution: saves through saveDraft with the draft stamp captured by the proposal', async () => {
    const { tool, definitions } = build();
    const args = { definition_id: 1, definition: editedDefinition() };
    await tool('workflows_update_draft').preview!(args, CTX);
    definitions.getDraft.mockResolvedValue({
      id: 1,
      key: 'compras',
      definition: validDefinition(),
      draft_updated_at: new Date('2026-11-01T12:00:00.000Z'),
    });
    definitions.saveDraft.mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.WORKFLOW_DRAFT_CONFLICT),
    );
    const out = await call(tool('workflows_update_draft'), args);
    expect(definitions.saveDraft).toHaveBeenCalledWith(1, {
      definition: args.definition,
      expected_draft_updated_at: STAMP,
    });
    expect(out.error).toMatch(/modificó el borrador|recarga/i);
  });

  it('execution after confirmation returns the edit link and never publishes', async () => {
    const { tool, definitions } = build();
    const args = { definition_key: 'compras', definition: editedDefinition() };
    const out = await call(tool('workflows_update_draft'), args);
    expect(definitions.saveDraft).toHaveBeenCalledTimes(1);
    expect(definitions.publish).not.toHaveBeenCalled();
    expect(out.edit_url).toBe('/admin/workflows/1/edit');
    expect(out.message).toMatch(/Borrador de «Compras» actualizado/);
  });

  it('refuses an invalid definition with the validator errors and does not save', async () => {
    const { tool, definitions } = build();
    const bad: any = validDefinition();
    bad.stages[0].assignee = { kind: 'role', role_key: 'inexistente' };
    const args = { definition_id: 1, definition: bad };
    const preview = await tool('workflows_update_draft').preview!(args, CTX);
    expect(preview.status).toBe('error');
    expect(preview.message).toMatch(/no es válida/);
    const out = await call(tool('workflows_update_draft'), args);
    expect(out.error).toMatch(/no es válida/);
    expect(definitions.saveDraft).not.toHaveBeenCalled();
  });

  it('a foreign or unknown flow is not found and nothing is read or saved', async () => {
    const { tool, definitions } = build();
    definitions.get.mockRejectedValue(
      new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND),
    );
    const out = await call(tool('workflows_update_draft'), {
      definition_id: 999,
      definition: validDefinition(),
    });
    expect(out.error).toMatch(/No encontré ese flujo/);
    expect(definitions.saveDraft).not.toHaveBeenCalled();
    const byKey = await call(tool('workflows_update_draft'), {
      definition_key: 'no_existe',
      definition: validDefinition(),
    });
    expect(byKey.error).toMatch(/No encontré ese flujo/);
  });

  it('declares the design permission and is hidden without it', () => {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(build().tools);
    const visible = (perms: string[]) =>
      registry.getAvailableDefinitions(perms).map((d) => d.function.name);
    expect(visible(['store:workflows:read'])).not.toContain(
      'workflows_update_draft',
    );
    expect(visible(['store:workflows:design'])).toContain(
      'workflows_update_draft',
    );
  });
});

describe('workflows_publish_definition', () => {
  it('proposal: "Publicar «Nombre» como versión N" without publishing', async () => {
    const { tool, definitions } = build();
    const preview = await tool('workflows_publish_definition').preview!(
      { definition_id: 1 },
      CTX,
    );
    expect(preview.status).toBe('ok');
    expect(preview.target).toBe('Publicar «Compras» como versión 4');
    expect(definitions.publish).not.toHaveBeenCalled();
  });

  it('refuses when the draft is invalid, in the proposal and on execution', async () => {
    const { tool, definitions } = build();
    definitions.validate.mockResolvedValue({
      valid: false,
      errors: [
        {
          code: 'X',
          path: 'stages[0]',
          message: 'Etapa sin salida.',
          severity: 'error',
        },
      ],
      warnings: [],
    });
    const preview = await tool('workflows_publish_definition').preview!(
      { definition_id: 1 },
      CTX,
    );
    expect(preview.status).toBe('error');
    expect(preview.message).toContain('Etapa sin salida.');
    const out = await call(tool('workflows_publish_definition'), {
      definition_id: 1,
    });
    expect(out.error).toMatch(/No se puede publicar/);
    expect(definitions.publish).not.toHaveBeenCalled();
  });

  it('execution calls publish and reports the version', async () => {
    const { tool, definitions } = build();
    const out = await call(tool('workflows_publish_definition'), {
      definition_id: 1,
      changelog: 'Paso nuevo',
    });
    expect(definitions.publish).toHaveBeenCalledWith(1, {
      changelog: 'Paso nuevo',
    });
    expect(out.version).toBe(4);
    expect(out.message).toBe(
      '«Compras» publicado como versión 4. Ya se pueden iniciar solicitudes.',
    );
  });

  it('a flow without draft or unknown to the store is refused', async () => {
    const { tool, definitions } = build();
    definitions.getDraft.mockResolvedValue({
      id: 1,
      key: 'compras',
      definition: null,
      draft_updated_at: null,
    });
    expect(
      (await call(tool('workflows_publish_definition'), { definition_id: 1 }))
        .error,
    ).toMatch(/no tiene borrador/);
    definitions.get.mockRejectedValue(new Error('nope'));
    expect(
      (await call(tool('workflows_publish_definition'), { definition_id: 5 }))
        .error,
    ).toMatch(/No encontré ese flujo/);
    expect(definitions.publish).not.toHaveBeenCalled();
  });
});

describe('workflows_start_instance', () => {
  it('proposal: flow, title and data with Spanish labels, nothing started', async () => {
    const { tool, engine } = build();
    const preview = await tool('workflows_start_instance').preview!(
      {
        definition_id: 1,
        title: 'Vacaciones de Ana',
        data: { monto: 100, motivo: 'Descanso' },
      },
      CTX,
    );
    expect(preview.status).toBe('ok');
    expect(preview.target).toBe('Nueva solicitud de «Compras»');
    expect(preview.changes.map((c) => [c.label, c.to])).toEqual([
      ['Flujo', 'Compras'],
      ['Título', 'Vacaciones de Ana'],
      ['Monto', '100'],
      ['Motivo', 'Descanso'],
    ]);
    expect(preview.message).toMatch(/Nace una solicitud/);
    expect(engine.start).not.toHaveBeenCalled();
  });

  it('execution: starts through the engine with the resolved definition and returns reference and link', async () => {
    const { tool, engine } = build();
    const out = await call(tool('workflows_start_instance'), {
      definition_key: 'compras',
      title: 'Compra',
      data: { monto: 5 },
    });
    expect(engine.start).toHaveBeenCalledTimes(1);
    const input = engine.start.mock.calls[0][0];
    expect(input).toMatchObject({
      definitionId: 1,
      title: 'Compra',
      data: { monto: 5 },
    });
    expect(input.idempotencyKey).toMatch(/^vex-start-/);
    expect(out.reference).toBe('FLU-000077');
    expect(out.url).toBe('/admin/workflows/instances/77');
    expect(out.message).toContain('FLU-000077');
  });

  it('refuses an unpublished flow and a foreign one', async () => {
    const { tool, engine, definitions } = build();
    definitions.get.mockResolvedValueOnce({
      id: 1,
      key: 'compras',
      name: 'Compras',
      status: 'draft',
      published_version: null,
    });
    const out = await call(tool('workflows_start_instance'), {
      definition_id: 1,
    });
    expect(out.error).toMatch(/no está publicado/);
    definitions.get.mockRejectedValue(new Error('not found'));
    expect(
      (await call(tool('workflows_start_instance'), { definition_id: 99 }))
        .error,
    ).toMatch(/No encontré ese flujo/);
    expect(engine.start).not.toHaveBeenCalled();
  });

  it('surfaces the engine refusal (no permission to start) instead of a success', async () => {
    const { tool, engine } = build();
    engine.start.mockRejectedValue(
      new VendixHttpException(ErrorCodes.WORKFLOW_START_FORBIDDEN),
    );
    const out = await call(tool('workflows_start_instance'), {
      definition_id: 1,
    });
    expect(out.error).toBeDefined();
    expect(out.reference).toBeUndefined();
  });

  it('requires the start permission', () => {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(build().tools);
    const names = (perms: string[]) =>
      registry.getAvailableDefinitions(perms).map((d) => d.function.name);
    expect(names(['store:workflows:design'])).not.toContain(
      'workflows_start_instance',
    );
    expect(names(['store:workflows:start'])).toContain(
      'workflows_start_instance',
    );
  });
});

describe('workflows_complete_task', () => {
  it('proposal by reference: request, stage, Spanish outcome and comment; nothing executed', async () => {
    const { tool, engine, instances } = build();
    instances.get.mockResolvedValue(taskDetail());
    const preview = await tool('workflows_complete_task').preview!(
      { reference: 'FLU-000009', outcome: 'approve', comment: 'Adelante' },
      CTX,
    );
    expect(preview.status).toBe('ok');
    expect(preview.target).toBe('Solicitud FLU-000009 · Revisión del jefe');
    expect(preview.changes.map((c) => [c.label, c.to])).toEqual([
      ['Solicitud', 'FLU-000009 · Vacaciones de Ana'],
      ['Etapa', 'Revisión del jefe'],
      ['Decisión', 'Aprobar'],
      ['Comentario', 'Adelante'],
    ]);
    expect(engine.completeTask).not.toHaveBeenCalled();
  });

  it('execution passes the row_version captured by the proposal, not the current one', async () => {
    const { tool, engine, instances } = build();
    instances.get.mockResolvedValue(taskDetail());
    const args = { task_id: 31, outcome: 'reject', comment: 'No procede' };
    await tool('workflows_complete_task').preview!(args, CTX);
    instances.get.mockResolvedValue(taskDetail({ row_version: 6 }));
    engine.completeTask.mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.WORKFLOW_STALE),
    );
    const out = await call(tool('workflows_complete_task'), args);
    expect(engine.completeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 31,
        outcome: 'reject',
        comment: 'No procede',
        expectedRowVersion: 4,
      }),
    );
    expect(out.error).toMatch(/cambió/);
  });

  it('execution after confirmation returns reference, outcome and link', async () => {
    const { tool, engine, instances } = build();
    instances.get.mockResolvedValue(taskDetail());
    const out = await call(tool('workflows_complete_task'), {
      reference: 'FLU-000009',
      stage: 'Revisión del jefe',
      outcome: 'approve',
    });
    expect(engine.completeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 31,
        outcome: 'approve',
        comment: null,
        expectedRowVersion: 4,
        idempotencyKey: 'vex-task-31-approve-4',
      }),
    );
    expect(out.reference).toBe('FLU-000009');
    expect(out.url).toBe('/admin/workflows/instances/9');
    expect(out.message).toMatch(/Aprobar/);
  });

  it('a user who is not the assignee gets the engine refusal, and the card warns up front', async () => {
    const { tool, engine, instances } = build();
    instances.get.mockResolvedValue(
      taskDetail({
        tasks: [{ id: 31, status: 'open', stage_key: 'revision', can_act: false }],
      }),
    );
    const preview = await tool('workflows_complete_task').preview!(
      { task_id: 31, outcome: 'approve' },
      CTX,
    );
    expect(preview.status).toBe('warning');
    engine.completeTask.mockRejectedValue(
      new VendixHttpException(ErrorCodes.WORKFLOW_TASK_FORBIDDEN),
    );
    const out = await call(tool('workflows_complete_task'), {
      task_id: 31,
      outcome: 'approve',
    });
    expect(out.error).toBeDefined();
    expect(out.reference).toBeUndefined();
  });

  it('unknown, foreign or already attended tasks are not found / refused', async () => {
    const { tool, engine, instances, deps } = build();
    (deps.findInstanceIdByTaskId as jest.Mock).mockResolvedValue(null);
    expect(
      (await call(tool('workflows_complete_task'), { task_id: 5, outcome: 'approve' }))
        .error,
    ).toMatch(/No encontré esa tarea/);
    (deps.findInstanceIdByTaskId as jest.Mock).mockResolvedValue(9);
    instances.get.mockRejectedValue(new Error('not a participant'));
    expect(
      (await call(tool('workflows_complete_task'), { task_id: 5, outcome: 'approve' }))
        .error,
    ).toMatch(/No encontré esa tarea/);
    instances.get.mockResolvedValue(taskDetail());
    expect(
      (await call(tool('workflows_complete_task'), { task_id: 30, outcome: 'approve' }))
        .error,
    ).toMatch(/ya fue atendida/);
    expect(engine.completeTask).not.toHaveBeenCalled();
  });

  it('rejects an outcome the stage does not allow, listing the allowed ones', async () => {
    const { tool, engine, instances } = build();
    instances.get.mockResolvedValue(taskDetail());
    const preview = await tool('workflows_complete_task').preview!(
      { task_id: 31, outcome: 'submit' },
      CTX,
    );
    expect(preview.status).toBe('error');
    expect(preview.message).toMatch(/Aprobar, Rechazar/);
    const out = await call(tool('workflows_complete_task'), {
      task_id: 31,
      outcome: 'submit',
    });
    expect(out.error).toMatch(/no está disponible/);
    expect(engine.completeTask).not.toHaveBeenCalled();
  });

  it('requires the task permission', () => {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(build().tools);
    const names = (perms: string[]) =>
      registry.getAvailableDefinitions(perms).map((d) => d.function.name);
    expect(names(['store:workflows:start'])).not.toContain(
      'workflows_complete_task',
    );
    expect(names(['store:workflows:task'])).toContain('workflows_complete_task');
  });
});
