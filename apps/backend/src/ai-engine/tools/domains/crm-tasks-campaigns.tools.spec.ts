import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { RegisteredTool } from '../interfaces/tool.interface';
import {
  CrmTaskCampaignToolDeps,
  createCrmTaskCampaignTools,
} from './crm-tasks-campaigns.tools';

/**
 * QUI-1042 (S6 tareas, S7 campañas): permisos, flags, previews con sujeto
 * humano y handlers que nunca lanzan.
 */
describe('crm-tasks-campaigns.tools', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const TASK = {
    id: 5,
    title: 'Llamar a Ana',
    status: 'pending',
    due_at: new Date('2026-11-20T20:00:00.000Z'),
    is_overdue: false,
    customer: { id: 4, first_name: 'Ana', last_name: 'Gómez' },
    assigned_user: { id: 11, first_name: 'Rafa', last_name: 'M' },
  };

  const DRAFT = {
    id: 9,
    name: 'VIP noviembre',
    channel: 'whatsapp',
    status: 'draft',
    segment_id: 3,
    segment: { id: 3, name: 'VIP' },
    scheduled_at: null,
    recipients_total: 0,
    recipients_sent: 0,
    recipients_failed: 0,
    estimated_cost: 1.25,
    metrics: { queued: 0 },
  };

  const ESTIMATE = {
    segment_id: 3,
    channel: 'whatsapp',
    segment_total: 40,
    recipients: 38,
    excluded_no_consent: 2,
    excluded_no_address: 0,
    excluded_duplicate: 0,
    estimated_cost: 1.25,
    currency: 'USD',
    spend_remaining: null,
    exceeds_spend_limit: false,
    max_recipients: 5000,
    exceeds_max_recipients: false,
    template_verified: true,
  };

  function buildTools(overrides: Record<string, unknown> = {}) {
    const deps = {
      crmTasksService: {
        list: jest.fn().mockResolvedValue({
          data: [TASK],
          total: 1,
          page: 1,
          limit: 20,
        }),
        findOne: jest.fn().mockResolvedValue(TASK),
        create: jest.fn().mockResolvedValue(TASK),
        complete: jest.fn().mockResolvedValue({ ...TASK, status: 'done' }),
      },
      crmCampaignsService: {
        estimate: jest.fn().mockResolvedValue(ESTIMATE),
        estimateSaved: jest.fn().mockResolvedValue(ESTIMATE),
        list: jest
          .fn()
          .mockResolvedValue({ data: [DRAFT], total: 1, page: 1, limit: 25 }),
        get: jest.fn().mockResolvedValue(DRAFT),
        create: jest.fn().mockResolvedValue({ ...DRAFT, estimate: ESTIMATE }),
        send: jest.fn().mockResolvedValue({
          ...DRAFT,
          status: 'sending',
          recipients_total: 38,
        }),
      },
      crmSegmentsService: {
        get: jest.fn().mockResolvedValue({ id: 3, name: 'VIP' }),
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
    };
    const tools = createCrmTaskCampaignTools(
      deps as unknown as CrmTaskCampaignToolDeps,
    );
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { deps, tools, byName };
  }

  function run(tool: RegisteredTool, args: Record<string, unknown> = {}) {
    return tool.handler!(args, CONTEXT).then((raw) => JSON.parse(raw));
  }

  function preview(tool: RegisteredTool, args: Record<string, unknown> = {}) {
    return tool.preview!(args, CONTEXT);
  }

  it('expone 6 tools con permisos y flags del controller equivalente', () => {
    const { tools } = buildTools();
    const perms = Object.fromEntries(
      tools.map((t) => [t.name, t.requiredPermissions]),
    );
    expect(perms).toEqual({
      list_crm_tasks: ['store:crm_tasks:manage'],
      create_crm_task: ['store:crm_tasks:manage'],
      complete_crm_task: ['store:crm_tasks:manage'],
      list_crm_campaigns: ['store:crm_campaigns:send'],
      create_crm_campaign_draft: ['store:crm_campaigns:send'],
      send_crm_campaign: ['store:crm_campaigns:send'],
    });
    for (const name of ['list_crm_tasks', 'list_crm_campaigns']) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.readOnly).toBe(true);
      expect(tool.requiresConfirmation).toBeUndefined();
    }
    for (const name of [
      'create_crm_task',
      'complete_crm_task',
      'create_crm_campaign_draft',
      'send_crm_campaign',
    ]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
    }
    expect(tools.filter((t) => t.irreversible).map((t) => t.name)).toEqual([
      'send_crm_campaign',
    ]);
    expect(
      tools.every((t) => t.version === '1' && t.domain === 'customers'),
    ).toBe(true);
  });

  it('list_crm_tasks pasa los filtros al servicio y compacta las filas', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.list_crm_tasks, {
      customer_id: 4,
      status: 'pending',
      due: 'overdue',
      assigned: 'all',
      limit: 10,
    });
    expect(deps.crmTasksService.list).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 4,
        status: 'pending',
        due: 'overdue',
        assigned: 'all',
        limit: 10,
      }),
    );
    expect(out.data.tasks).toEqual([
      {
        id: 5,
        title: 'Llamar a Ana',
        status: 'pending',
        due_at: '2026-11-20T20:00:00.000Z',
        is_overdue: false,
        customer: 'Ana Gómez',
        assigned_to: 'Rafa M',
      },
    ]);
  });

  it('list_crm_tasks rechaza un filtro inválido sin tocar el servicio', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.list_crm_tasks, { due: 'ayer' });
    expect(out.error).toContain('validación');
    expect(deps.crmTasksService.list).not.toHaveBeenCalled();
  });

  it('create_crm_task rechaza en el preview un cliente de otra tienda', async () => {
    const { deps, byName } = buildTools({
      customersService: {
        findCustomerNamesForAgent: jest.fn().mockResolvedValue([]),
      },
    });
    const prev = await preview(byName.create_crm_task, {
      title: 'Llamar',
      customer_id: 99,
    });
    expect(prev.status).toBe('error');
    expect(prev.message).toContain('El cliente 99 no existe en esta tienda');
    const out = await run(byName.create_crm_task, {
      title: 'Llamar',
      customer_id: 99,
    });
    expect(out.error).toContain('El cliente 99 no existe en esta tienda');
    expect(deps.crmTasksService.create).not.toHaveBeenCalled();
  });

  it('create_crm_task nombra al cliente y crea con los args exactos', async () => {
    const { deps, byName } = buildTools();
    const args = {
      title: 'Llamar a Ana',
      customer_id: 4,
      due_at: '2026-11-20T15:00:00-05:00',
    };
    const prev = await preview(byName.create_crm_task, args);
    expect(prev.status).toBe('ok');
    expect(prev.target).toBe('Llamar a Ana');
    expect(prev.changes).toEqual(
      expect.arrayContaining([
        { field: 'customer', label: 'Cliente', from: null, to: 'Ana Gómez' },
        {
          field: 'assigned_user',
          label: 'Responsable',
          from: null,
          to: 'Tú (quien la pide)',
        },
      ]),
    );
    const out = await run(byName.create_crm_task, args);
    expect(out.summary).toBe('Tarea «Llamar a Ana» creada para Ana Gómez.');
    expect(deps.crmTasksService.create).toHaveBeenCalledWith(
      expect.objectContaining(args),
    );
  });

  it('complete_crm_task: preview de error si ya está hecha y no completa', async () => {
    const { deps, byName } = buildTools({
      crmTasksService: {
        findOne: jest.fn().mockResolvedValue({ ...TASK, status: 'done' }),
        complete: jest.fn(),
      },
    });
    const prev = await preview(byName.complete_crm_task, { task_id: 5 });
    expect(prev.status).toBe('error');
    expect(prev.message).toBe(
      'La tarea ya está hecha; no hay nada que completar.',
    );
    const out = await run(byName.complete_crm_task, { task_id: 5 });
    expect(out.error).toBe('La tarea «Llamar a Ana» ya está hecha.');
    expect(deps.crmTasksService.complete).not.toHaveBeenCalled();
  });

  it('complete_crm_task muestra pendiente → hecha y llama complete(id)', async () => {
    const { deps, byName } = buildTools();
    const prev = await preview(byName.complete_crm_task, { task_id: 5 });
    expect(prev.status).toBe('ok');
    expect(prev.target).toBe('Llamar a Ana');
    expect(prev.changes[0]).toEqual({
      field: 'status',
      label: 'Estado',
      from: 'pending',
      to: 'done',
    });
    const out = await run(byName.complete_crm_task, { task_id: 5 });
    expect(out.summary).toBe('Tarea «Llamar a Ana» marcada como hecha.');
    expect(deps.crmTasksService.complete).toHaveBeenCalledWith(5);
  });

  const DRAFT_ARGS = {
    name: 'VIP noviembre',
    segment_id: 3,
    channel: 'whatsapp',
    template: {
      name: 'promo_vip',
      language: 'es_CO',
      variables: ['{first_name}'],
    },
  };

  it('create_crm_campaign_draft previsualiza con la estimación y queda en borrador', async () => {
    const { deps, byName } = buildTools();
    const prev = await preview(byName.create_crm_campaign_draft, DRAFT_ARGS);
    expect(prev.status).toBe('ok');
    expect(prev.target).toBe('VIP noviembre');
    expect(prev.changes).toEqual(
      expect.arrayContaining([
        { field: 'segment', label: 'Segmento', from: null, to: 'VIP' },
        { field: 'recipients', label: 'Destinatarios', from: null, to: 38 },
        {
          field: 'estimated_cost',
          label: 'Costo estimado',
          from: null,
          to: 'US$ 1.2500',
        },
      ]),
    );
    expect(prev.message).toContain(
      'Queda en BORRADOR: no se envía nada hasta que apruebes send_crm_campaign',
    );
    expect(deps.crmSegmentsService.get).toHaveBeenCalledWith(3);
    expect(deps.crmCampaignsService.create).not.toHaveBeenCalled();
  });

  it('create_crm_campaign_draft devuelve next_step con el costo exacto', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.create_crm_campaign_draft, DRAFT_ARGS);
    expect(deps.crmCampaignsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'VIP noviembre', segment_id: 3 }),
    );
    expect(out.data).toEqual(
      expect.objectContaining({
        campaign_id: 9,
        status: 'draft',
        recipients: 38,
        estimated_cost: 1.25,
      }),
    );
    expect(out.next_step).toBe(
      'Para enviarla, pide aprobación y llama send_crm_campaign con campaign_id=9 y confirm_estimated_cost=1.25.',
    );
  });

  it('send_crm_campaign: preview de error si la campaña no es borrador', async () => {
    const { deps, byName } = buildTools({
      crmCampaignsService: {
        get: jest.fn().mockResolvedValue({ ...DRAFT, status: 'sent' }),
        estimateSaved: jest.fn(),
        send: jest.fn(),
      },
    });
    const prev = await preview(byName.send_crm_campaign, {
      campaign_id: 9,
      confirm_estimated_cost: 1.25,
    });
    expect(prev.status).toBe('error');
    expect(prev.message).toBe(
      'La campaña ya no es un borrador (estado: sent); no se puede enviar de nuevo.',
    );
    expect(deps.crmCampaignsService.estimateSaved).not.toHaveBeenCalled();
  });

  it('send_crm_campaign: preview de error si el costo no coincide', async () => {
    const { byName } = buildTools();
    const prev = await preview(byName.send_crm_campaign, {
      campaign_id: 9,
      confirm_estimated_cost: 0.9,
    });
    expect(prev.status).toBe('error');
    expect(prev.message).toContain(
      'El costo estimado actual es US$ 1.2500 y no coincide con el confirmado (US$ 0.9000)',
    );
    expect(prev.message).toContain('Vuelve a leer el costo');
  });

  it('send_crm_campaign: preview ok con destinatarios, costo y aviso de irreversible', async () => {
    const { byName } = buildTools();
    const prev = await preview(byName.send_crm_campaign, {
      campaign_id: 9,
      confirm_estimated_cost: 1.25,
    });
    expect(prev.status).toBe('warning');
    expect(prev.target).toBe('VIP noviembre');
    expect(prev.changes).toEqual(
      expect.arrayContaining([
        { field: 'status', label: 'Estado', from: 'draft', to: 'sending' },
        { field: 'recipients', label: 'Destinatarios', from: null, to: 38 },
        {
          field: 'estimated_cost',
          label: 'Costo estimado',
          from: null,
          to: 'US$ 1.2500',
        },
      ]),
    );
    expect(prev.message).toContain('Se enviará AHORA');
    expect(prev.message).toContain(
      'los mensajes ya entregados no se pueden retirar',
    );
  });

  it('send_crm_campaign: una campaña programada se anuncia como programada', async () => {
    const { byName } = buildTools({
      crmCampaignsService: {
        get: jest.fn().mockResolvedValue({
          ...DRAFT,
          scheduled_at: new Date('2026-12-01T15:00:00.000Z'),
        }),
        estimateSaved: jest.fn().mockResolvedValue(ESTIMATE),
        send: jest.fn(),
      },
    });
    const prev = await preview(byName.send_crm_campaign, {
      campaign_id: 9,
      confirm_estimated_cost: 1.25,
    });
    expect(prev.message).toContain(
      'Se PROGRAMARÁ para 2026-12-01T15:00:00.000Z; no sale ahora.',
    );
    expect(prev.changes[0].to).toBe('scheduled');
  });

  it('send_crm_campaign llama send(id, costo) con los args exactos', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.send_crm_campaign, {
      campaign_id: 9,
      confirm_estimated_cost: 1.25,
    });
    expect(deps.crmCampaignsService.send).toHaveBeenCalledTimes(1);
    expect(deps.crmCampaignsService.send).toHaveBeenCalledWith(9, 1.25);
    expect(out.summary).toBe(
      'Campaña «VIP noviembre» en envío a 38 destinatario(s).',
    );
    // The service already audits the send: the tool adds no second row.
    expect(deps.auditService.log).not.toHaveBeenCalled();
  });

  it('send_crm_campaign exige confirm_estimated_cost sin tocar el servicio', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.send_crm_campaign, { campaign_id: 9 });
    expect(out.error).toContain('confirm_estimated_cost es obligatorio');
    expect(deps.crmCampaignsService.send).not.toHaveBeenCalled();
  });

  it('CRM_CAMPAIGN_003 del servicio se vuelve {error} sin lanzar', async () => {
    const { byName } = buildTools({
      crmCampaignsService: {
        send: jest
          .fn()
          .mockRejectedValue(
            new VendixHttpException(ErrorCodes.CRM_CAMPAIGN_003),
          ),
      },
    });
    const out = await run(byName.send_crm_campaign, {
      campaign_id: 9,
      confirm_estimated_cost: 1.25,
    });
    expect(out.error).toContain('No se pudo enviar la campaña');
    expect(out.error).toContain('CRM_CAMPAIGN_003');
    expect(out.next_step).toBe(
      'Si el costo cambió, vuelve a leerlo con list_crm_campaigns y pide la aprobación otra vez.',
    );
  });

  it('sin tienda en contexto, los handlers se niegan sin llamar servicios', async () => {
    const { deps, byName } = buildTools();
    const raw = await byName.send_crm_campaign.handler!(
      { campaign_id: 9, confirm_estimated_cost: 1.25 },
      { user_id: 11 },
    );
    expect(JSON.parse(raw).error).toContain('Sin tienda en contexto');
    expect(deps.crmCampaignsService.send).not.toHaveBeenCalled();
  });
});
