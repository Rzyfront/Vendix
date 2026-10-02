import {
  createQuotationTools,
  QuotationToolDeps,
} from './quotations.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 8 (vex-agent) — contrato quotations: 2 reads + 4 writes.
 *
 * Patrón canónico T4: (a) happy/sad con sad sin tocar deps, (b) literales
 * con `toEqual` (sin `.snap`), (c) `{error, next_step}` en ES en fallos
 * guiados, (d) permiso declarado por tool, (e) `readOnly: true` en reads y
 * `requiresConfirmation` + `preview` con sujeto humano en writes, con
 * re-verificación en el handler.
 */
describe('quotations.tools · cotizaciones', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const DRAFT = {
    id: 21,
    quotation_number: 'COT-2026-021',
    status: 'draft',
    customer_id: 4,
    total: 150000,
  };
  const SENT = { ...DRAFT, status: 'sent' };
  const ACCEPTED = { ...DRAFT, status: 'accepted' };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      quotationsService: {
        findAll: jest.fn().mockResolvedValue({
          data: [DRAFT],
          meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
        }),
        findOne: jest.fn().mockResolvedValue(DRAFT),
        create: jest
          .fn()
          .mockResolvedValue({ ...DRAFT, id: 22, quotation_number: 'COT-2026-022' }),
        send: jest.fn().mockResolvedValue(SENT),
        accept: jest.fn().mockResolvedValue(ACCEPTED),
        convertToOrder: jest
          .fn()
          .mockResolvedValue({ order_id: 501, quotation_id: 21 }),
      },
      ...overrides,
    } as any;
    const tools = createQuotationTools(deps as QuotationToolDeps);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { deps: deps as any, tools, byName };
  }

  function run(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.handler!(args, CONTEXT).then((raw) => JSON.parse(raw));
  }

  function preview(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.preview!(args, CONTEXT);
  }

  it('expone 2 reads + 4 writes con permisos del endpoint equivalente', () => {
    const { tools } = buildTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'accept_quotation',
        'convert_quotation_to_order',
        'create_quotation',
        'get_quotation',
        'list_quotations',
        'send_quotation',
      ].sort(),
    );
    const perms = Object.fromEntries(
      tools.map((t) => [t.name, t.requiredPermissions]),
    );
    expect(perms).toEqual({
      list_quotations: ['store:quotations:read'],
      get_quotation: ['store:quotations:read:one'],
      create_quotation: ['store:quotations:create'],
      send_quotation: ['store:quotations:update'],
      accept_quotation: ['store:quotations:update'],
      convert_quotation_to_order: ['store:quotations:convert'],
    });
    for (const name of ['list_quotations', 'get_quotation']) {
      expect(tools.find((t) => t.name === name)!.readOnly).toBe(true);
    }
    for (const name of [
      'create_quotation',
      'send_quotation',
      'accept_quotation',
      'convert_quotation_to_order',
    ]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
    }
  });

  it('list_quotations pagina y filtra por estado', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.list_quotations, {
      status: 'draft',
      page: 2,
      limit: 5,
    });
    expect(out.data).toEqual([DRAFT]);
    expect(deps.quotationsService.findAll).toHaveBeenCalledWith({
      page: 2,
      limit: 5,
      status: 'draft',
    });
  });

  it('list_quotations rechaza customer_id inválido sin tocar deps', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.list_quotations, { customer_id: 'x' });
    expect(out).toEqual({
      error: 'customer_id inválido: x.',
      next_step: 'Pasa el ID numérico del cliente.',
    });
    expect(deps.quotationsService.findAll).not.toHaveBeenCalled();
  });

  it('get_quotation devuelve el detalle', async () => {
    const { byName } = buildTools();
    await expect(run(byName.get_quotation, { quotation_id: 21 })).resolves
      .toEqual(DRAFT);
  });

  it('create_quotation previsualiza con sujeto humano y crea en draft', async () => {
    const { deps, byName } = buildTools();
    const args = {
      customer_id: 4,
      items: [
        {
          product_name: 'Café 500g',
          quantity: 3,
          unit_price: 20000,
          total_price: 60000,
        },
      ],
      notes: 'Entrega el viernes',
    };
    const prev = await preview(byName.create_quotation, args);
    expect(prev.status).toBe('ok');
    expect(prev.target).toContain('1 línea(s)');
    expect(prev.target).toContain('$60000');
    const out = await run(byName.create_quotation, args);
    expect(out.quotation_number).toBe('COT-2026-022');
    expect(deps.quotationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 4, notes: 'Entrega el viernes' }),
    );
  });

  it('create_quotation rechaza items vacíos sin tocar deps', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.create_quotation, { items: [] });
    expect(out.error).toContain('no vacío');
    expect(out.next_step).toBeDefined();
    expect(deps.quotationsService.create).not.toHaveBeenCalled();
  });

  it('send_quotation exige draft en preview y handler', async () => {
    const { deps, byName } = buildTools({
      quotationsService: {
        findOne: jest.fn().mockResolvedValue(SENT),
        send: jest.fn(),
      },
    });
    const prev = await preview(byName.send_quotation, { quotation_id: 21 });
    expect(prev.status).toBe('error');
    expect(prev.message).toContain('draft');
    const out = await run(byName.send_quotation, { quotation_id: 21 });
    expect(out.error).toContain('draft');
    expect(deps.quotationsService.send).not.toHaveBeenCalled();
  });

  it('send_quotation envía desde draft', async () => {
    const { byName } = buildTools();
    const prev = await preview(byName.send_quotation, { quotation_id: 21 });
    expect(prev.status).toBe('ok');
    expect(prev.target).toContain('COT-2026-021');
    const out = await run(byName.send_quotation, { quotation_id: 21 });
    expect(out).toEqual({
      resumen: 'Cotización COT-2026-021 enviada.',
      quotation_id: 21,
      estado: 'sent',
    });
  });

  it('accept_quotation exige sent', async () => {
    const { deps, byName } = buildTools();
    const prev = await preview(byName.accept_quotation, { quotation_id: 21 });
    expect(prev.status).toBe('error');
    expect(prev.message).toContain('sent');
    expect(deps.quotationsService.accept).not.toHaveBeenCalled();
  });

  it('convert_quotation_to_order advierte y convierte desde accepted', async () => {
    const { deps, byName } = buildTools({
      quotationsService: {
        findOne: jest.fn().mockResolvedValue(ACCEPTED),
        convertToOrder: jest
          .fn()
          .mockResolvedValue({ order_id: 501, quotation_id: 21 }),
      },
    });
    const prev = await preview(byName.convert_quotation_to_order, {
      quotation_id: 21,
    });
    expect(prev.status).toBe('warning');
    expect(prev.target).toContain('COT-2026-021');
    const out = await run(byName.convert_quotation_to_order, {
      quotation_id: 21,
    });
    expect(out.resumen).toContain('convertida en orden');
    expect(deps.quotationsService.convertToOrder).toHaveBeenCalledWith(21);
  });

  it('convert_quotation_to_order rechaza fuera de accepted', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.convert_quotation_to_order, {
      quotation_id: 21,
    });
    expect(out.error).toContain('accepted');
    expect(deps.quotationsService.convertToOrder).not.toHaveBeenCalled();
  });
});
