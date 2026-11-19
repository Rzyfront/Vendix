import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { RegisteredTool } from '../interfaces/tool.interface';
import {
  createCrmPipelineTools,
  CrmPipelineToolDeps,
} from './crm-pipeline.tools';

/**
 * QUI-1042 · S5 — CRM pipeline tools: permissions/flags, preview projection,
 * exact service args and Spanish refusals that never throw.
 */
describe('crm-pipeline.tools · embudo CRM', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const STAGES = [
    {
      id: 1,
      pipeline_id: 1,
      name: 'Nuevo',
      kind: 'open',
      probability: 10,
      is_active: true,
    },
    {
      id: 2,
      pipeline_id: 1,
      name: 'Negociación',
      kind: 'open',
      probability: 60,
      is_active: true,
    },
    {
      id: 3,
      pipeline_id: 1,
      name: 'Ganado',
      kind: 'won',
      probability: 100,
      is_active: true,
    },
    {
      id: 4,
      pipeline_id: 1,
      name: 'Perdido',
      kind: 'lost',
      probability: 0,
      is_active: true,
    },
    {
      id: 9,
      pipeline_id: 2,
      name: 'Otra etapa',
      kind: 'open',
      probability: 5,
      is_active: true,
    },
  ];
  const PIPELINES = [
    { id: 1, name: 'Ventas', is_default: true, stages: STAGES.slice(0, 4) },
    { id: 2, name: 'Alianzas', is_default: false, stages: [STAGES[4]] },
  ];
  const OPPORTUNITY = {
    id: 40,
    title: 'Pedido mayorista',
    amount: '2000000',
    currency: 'COP',
    status: 'open',
    pipeline_id: 1,
    stage_id: 1,
    stage: STAGES[0],
    customer: { id: 4, first_name: 'Ana', last_name: 'Gómez' },
    owner: { id: 11, first_name: 'Vera', last_name: 'Ruiz' },
    expected_close_date: '2026-12-01',
    lost_reason: null,
  };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      crmPipelineService: {
        listPipelines: jest.fn().mockResolvedValue(PIPELINES),
        board: jest.fn().mockResolvedValue({
          pipeline: { id: 1, name: 'Ventas', is_default: true },
          pipelines: [],
          stages: [
            {
              ...STAGES[0],
              count: 1,
              total_amount: '2000000.00',
              opportunities: [OPPORTUNITY],
            },
            { ...STAGES[1], count: 0, total_amount: '0.00', opportunities: [] },
          ],
          truncated: false,
        }),
        findOne: jest.fn().mockResolvedValue(OPPORTUNITY),
        create: jest.fn().mockResolvedValue({ ...OPPORTUNITY, id: 41 }),
        move: jest
          .fn()
          .mockResolvedValue({ ...OPPORTUNITY, stage_id: 2, stage: STAGES[1] }),
        win: jest.fn().mockResolvedValue({
          ...OPPORTUNITY,
          status: 'won',
          stage_id: 3,
          stage: STAGES[2],
        }),
        lose: jest.fn().mockResolvedValue({
          ...OPPORTUNITY,
          status: 'lost',
          stage_id: 4,
          stage: STAGES[3],
        }),
      },
      customersService: {
        findCustomerNamesForAgent: jest
          .fn()
          .mockResolvedValue([
            { id: 4, first_name: 'Ana', last_name: 'Gómez' },
          ]),
      },
      auditService: { log: jest.fn() },
      ...overrides,
    } as any;
    const tools = createCrmPipelineTools(deps as CrmPipelineToolDeps);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { deps, tools, byName };
  }

  const run = (tool: RegisteredTool, args: Record<string, any> = {}) =>
    tool.handler!(args, CONTEXT).then((raw) => JSON.parse(raw));
  const preview = (tool: RegisteredTool, args: Record<string, any> = {}) =>
    tool.preview!(args, CONTEXT);

  it('expone 5 tools con permisos y flags del controlador', () => {
    const { tools } = buildTools();
    expect(
      Object.fromEntries(
        tools.map((t) => [
          t.name,
          [
            t.requiredPermissions,
            !!t.readOnly,
            !!t.requiresConfirmation,
            !!t.irreversible,
          ],
        ]),
      ),
    ).toEqual({
      get_crm_pipeline: [['store:crm_pipeline:read'], true, false, false],
      list_crm_opportunities: [['store:crm_pipeline:read'], true, false, false],
      create_crm_opportunity: [
        ['store:crm_pipeline:manage'],
        false,
        true,
        false,
      ],
      move_crm_opportunity: [['store:crm_pipeline:manage'], false, true, false],
      set_crm_opportunity_result: [
        ['store:crm_pipeline:manage'],
        false,
        true,
        false,
      ],
    });
    for (const tool of tools) {
      expect(tool.version).toBe('1');
      expect(tool.domain).toBe('customers');
      expect(tool.discovery?.synonyms?.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('get_crm_pipeline resume etapas con conteo y monto del servicio', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.get_crm_pipeline, { pipeline_id: 1 });
    expect(deps.crmPipelineService.board).toHaveBeenCalledWith(
      expect.objectContaining({ pipeline_id: 1 }),
    );
    expect(out.data.stages).toEqual([
      {
        id: 1,
        name: 'Nuevo',
        kind: 'open',
        probability: 10,
        opportunities_count: 1,
        total_amount: '2000000.00',
      },
      {
        id: 2,
        name: 'Negociación',
        kind: 'open',
        probability: 60,
        opportunities_count: 0,
        total_amount: '0.00',
      },
    ]);
    expect(out.data.pipelines).toEqual([
      { id: 1, name: 'Ventas', is_default: true, stages_count: 4 },
      { id: 2, name: 'Alianzas', is_default: false, stages_count: 1 },
    ]);
    expect(out.data.truncated).toBe(false);
    expect(out.next_step).toBeUndefined();
  });

  it('get_crm_pipeline avisa cuando el tablero está truncado', async () => {
    const { deps, byName } = buildTools();
    deps.crmPipelineService.board.mockResolvedValue({
      pipeline: { id: 1, name: 'Ventas', is_default: true },
      stages: [],
      truncated: true,
    });
    const out = await run(byName.get_crm_pipeline);
    expect(out.data.truncated).toBe(true);
    expect(out.next_step).toContain('incompletos');
  });

  it('list_crm_opportunities devuelve filas compactas y filtra por etapa', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.list_crm_opportunities, {
      customer_id: 4,
      status: 'open',
    });
    expect(deps.crmPipelineService.board).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 4, status: 'open' }),
    );
    expect(out.data.opportunities).toEqual([
      {
        id: 40,
        title: 'Pedido mayorista',
        customer: 'Ana Gómez',
        amount: '2000000',
        currency: 'COP',
        stage_id: 1,
        stage: 'Nuevo',
        status: 'open',
        owner: 'Vera Ruiz',
        expected_close_date: '2026-12-01',
      },
    ]);
    const none = await run(byName.list_crm_opportunities, { stage_id: 2 });
    expect(none.data.total).toBe(0);
  });

  it('create preview rechaza un cliente de otra tienda', async () => {
    const { deps, byName } = buildTools();
    deps.customersService.findCustomerNamesForAgent.mockResolvedValue([]);
    const p = await preview(byName.create_crm_opportunity, {
      customer_id: 99,
      title: 'X',
    });
    expect(p.status).toBe('error');
    expect(p.message).toContain('no existe en esta tienda');
    expect(deps.crmPipelineService.listPipelines).not.toHaveBeenCalled();
  });

  it('create preview rechaza una etapa desconocida y nombra la etapa válida', async () => {
    const { byName } = buildTools();
    const bad = await preview(byName.create_crm_opportunity, {
      customer_id: 4,
      title: 'X',
      stage_id: 77,
    });
    expect(bad.status).toBe('error');
    expect(bad.message).toContain('La etapa 77 no existe');

    const ok = await preview(byName.create_crm_opportunity, {
      customer_id: 4,
      title: 'Pedido mayorista',
      amount: 2000000,
      currency: 'cop',
      stage_id: 2,
    });
    expect(ok.status).toBe('ok');
    expect(ok.target).toBe('Pedido mayorista · Ana Gómez');
    expect(ok.changes).toEqual(
      expect.arrayContaining([
        { field: 'customer', label: 'Cliente', from: null, to: 'Ana Gómez' },
        { field: 'amount', label: 'Monto', from: null, to: '2000000 COP' },
        { field: 'stage', label: 'Etapa', from: null, to: 'Negociación' },
      ]),
    );
  });

  it('create handler llama create con el DTO exacto', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.create_crm_opportunity, {
      customer_id: 4,
      title: ' Pedido mayorista ',
      amount: 2000000,
      currency: 'COP',
      stage_id: 1,
      expected_close_date: '2026-12-01',
    });
    expect(deps.crmPipelineService.create).toHaveBeenCalledTimes(1);
    expect(deps.crmPipelineService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 4,
        title: 'Pedido mayorista',
        amount: 2000000,
        currency: 'COP',
        stage_id: 1,
        expected_close_date: '2026-12-01',
      }),
    );
    expect(out.summary).toContain('creada');
    expect(out.data.opportunity.id).toBe(41);
  });

  it('move preview muestra etapa origen y destino', async () => {
    const { byName } = buildTools();
    const p = await preview(byName.move_crm_opportunity, {
      opportunity_id: 40,
      stage_id: 2,
    });
    expect(p.status).toBe('ok');
    expect(p.target).toBe('Pedido mayorista · Ana Gómez');
    expect(p.changes).toEqual([
      { field: 'stage', label: 'Etapa', from: 'Nuevo', to: 'Negociación' },
    ]);
  });

  it('move preview rechaza misma etapa, otro pipeline y pérdida sin motivo', async () => {
    const { byName } = buildTools();
    const same = await preview(byName.move_crm_opportunity, {
      opportunity_id: 40,
      stage_id: 1,
    });
    expect(same.status).toBe('error');
    expect(same.message).toBe('La oportunidad ya está en la etapa "Nuevo".');

    const other = await preview(byName.move_crm_opportunity, {
      opportunity_id: 40,
      stage_id: 9,
    });
    expect(other.status).toBe('error');
    expect(other.message).toContain('no pertenece al pipeline');

    const lost = await preview(byName.move_crm_opportunity, {
      opportunity_id: 40,
      stage_id: 4,
    });
    expect(lost.status).toBe('error');
    expect(lost.message).toContain('lost_reason');
  });

  it('move handler llama move con id y DTO exactos', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.move_crm_opportunity, {
      opportunity_id: 40,
      stage_id: 2,
    });
    expect(deps.crmPipelineService.move).toHaveBeenCalledTimes(1);
    expect(deps.crmPipelineService.move).toHaveBeenCalledWith(
      40,
      expect.objectContaining({ stage_id: 2 }),
    );
    expect(out.summary).toContain('Negociación');
  });

  it('result: won llama win(id) y lost llama lose(id, motivo)', async () => {
    const { deps, byName } = buildTools();
    const won = await run(byName.set_crm_opportunity_result, {
      opportunity_id: 40,
      result: 'won',
    });
    expect(deps.crmPipelineService.win).toHaveBeenCalledWith(40);
    expect(won.summary).toBe(
      'Oportunidad "Pedido mayorista" marcada como ganada.',
    );

    const lost = await run(byName.set_crm_opportunity_result, {
      opportunity_id: 40,
      result: 'lost',
      lost_reason: ' compró con otro ',
    });
    expect(deps.crmPipelineService.lose).toHaveBeenCalledWith(
      40,
      'compró con otro',
    );
    expect(lost.summary).toContain('perdida');
    expect(deps.auditService.log).not.toHaveBeenCalled();
  });

  it('result: lost sin motivo se rechaza sin tocar el servicio', async () => {
    const { deps, byName } = buildTools();
    const p = await preview(byName.set_crm_opportunity_result, {
      opportunity_id: 40,
      result: 'lost',
    });
    expect(p.status).toBe('error');
    expect(p.message).toContain('lost_reason');
    const out = await run(byName.set_crm_opportunity_result, {
      opportunity_id: 40,
      result: 'lost',
    });
    expect(out.error).toContain('lost_reason');
    expect(deps.crmPipelineService.lose).not.toHaveBeenCalled();
  });

  it('result preview muestra título, cliente, monto y etapa destino', async () => {
    const { byName } = buildTools();
    const p = await preview(byName.set_crm_opportunity_result, {
      opportunity_id: 40,
      result: 'won',
    });
    expect(p.status).toBe('ok');
    expect(p.target).toBe('Pedido mayorista · Ana Gómez');
    expect(p.changes).toEqual(
      expect.arrayContaining([
        { field: 'stage', label: 'Etapa', from: 'Nuevo', to: 'Ganado' },
        { field: 'status', label: 'Estado', from: 'abierta', to: 'ganada' },
        {
          field: 'amount',
          label: 'Monto',
          from: '2000000 COP',
          to: '2000000 COP',
        },
      ]),
    );
  });

  it('un código CRM del servicio vuelve como {error} sin lanzar', async () => {
    const { deps, byName } = buildTools();
    deps.crmPipelineService.create.mockRejectedValue(
      new VendixHttpException(ErrorCodes.CRM_ASSIGN_001),
    );
    const out = await run(byName.create_crm_opportunity, {
      customer_id: 4,
      title: 'X',
      owner_user_id: 20,
    });
    expect(out.error).toContain(
      'No se pudo crear la oportunidad (CRM_ASSIGN_001)',
    );

    deps.crmPipelineService.findOne.mockRejectedValue(
      new VendixHttpException(ErrorCodes.CRM_OPPORTUNITY_001),
    );
    const p = await preview(byName.move_crm_opportunity, {
      opportunity_id: 5,
      stage_id: 2,
    });
    expect(p.status).toBe('error');
    const moved = await run(byName.move_crm_opportunity, {
      opportunity_id: 5,
      stage_id: 2,
    });
    deps.crmPipelineService.move.mockRejectedValue(
      new VendixHttpException(ErrorCodes.CRM_OPPORTUNITY_001),
    );
    const failed = await run(byName.move_crm_opportunity, {
      opportunity_id: 5,
      stage_id: 2,
    });
    expect(moved).toBeDefined();
    expect(failed.error).toContain('CRM_OPPORTUNITY_001');
  });

  it('sin tienda en contexto rechaza sin llamar al servicio', async () => {
    const { deps, byName } = buildTools();
    const out = JSON.parse(
      await byName.get_crm_pipeline.handler!({}, { user_id: 1 }),
    );
    expect(out.error).toContain('Sin tienda en contexto');
    expect(deps.crmPipelineService.listPipelines).not.toHaveBeenCalled();
  });
});
