import { createMarketingTools, MarketingToolDeps } from './marketing.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 8 (vex-agent) — contrato marketing: 3 reads + 3 writes.
 *
 * Patrón canónico T4: happy/sad con sad sin tocar deps, literales con
 * `toEqual`, `{error, next_step}` en ES, permiso por tool, `readOnly` en
 * reads y `requiresConfirmation` + `preview` con sujeto humano en writes.
 */
describe('marketing.tools · promociones y cupones', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const PROMO = {
    id: 8,
    name: 'Aniversario 20%',
    type: 'percentage',
    value: 20,
    state: 'draft',
  };
  const COUPON = {
    id: 3,
    code: 'BIENVENIDA10',
    name: 'Bienvenida',
    discount_type: 'PERCENTAGE',
    discount_value: 10,
  };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      promotionsService: {
        findAll: jest.fn().mockResolvedValue({
          data: [PROMO],
          meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
        }),
        findOne: jest.fn().mockResolvedValue(PROMO),
        create: jest.fn().mockResolvedValue({ ...PROMO, id: 9 }),
        activate: jest
          .fn()
          .mockResolvedValue({ ...PROMO, state: 'active' }),
      },
      couponsService: {
        findAll: jest.fn().mockResolvedValue({
          data: [COUPON],
          meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
        }),
        create: jest.fn().mockResolvedValue({ ...COUPON, id: 4 }),
        validate: jest.fn().mockResolvedValue({
          valid: true,
          code: 'BIENVENIDA10',
          discount_amount: 5000,
        }),
      },
      ...overrides,
    } as any;
    const tools = createMarketingTools(deps as MarketingToolDeps);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { deps: deps as any, tools, byName };
  }

  function run(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.handler!(args, CONTEXT).then((raw) => JSON.parse(raw));
  }

  function preview(tool: RegisteredTool, args: Record<string, any> = {}) {
    return tool.preview!(args, CONTEXT);
  }

  it('expone 3 reads + 3 writes con permisos del endpoint equivalente', () => {
    const { tools } = buildTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'activate_promotion',
        'create_coupon',
        'create_promotion',
        'list_coupons',
        'list_promotions',
        'validate_coupon',
      ].sort(),
    );
    const perms = Object.fromEntries(
      tools.map((t) => [t.name, t.requiredPermissions]),
    );
    expect(perms).toEqual({
      list_promotions: ['store:promotions:read'],
      create_promotion: ['store:promotions:create'],
      activate_promotion: ['store:promotions:create'],
      list_coupons: ['store:coupons:read'],
      create_coupon: ['store:coupons:create'],
      validate_coupon: ['store:coupons:validate'],
    });
    for (const name of [
      'list_promotions',
      'list_coupons',
      'validate_coupon',
    ]) {
      expect(tools.find((t) => t.name === name)!.readOnly).toBe(true);
    }
    for (const name of [
      'create_promotion',
      'activate_promotion',
      'create_coupon',
    ]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
    }
  });

  it('list_promotions filtra por estado', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.list_promotions, { state: 'draft' });
    expect(out.data).toEqual([PROMO]);
    expect(deps.promotionsService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'draft' }),
    );
  });

  it('create_promotion previsualiza con sujeto humano y crea', async () => {
    const { deps, byName } = buildTools();
    const args = {
      name: 'Aniversario 20%',
      type: 'percentage',
      value: 20,
      start_date: '2026-10-01',
    };
    const prev = await preview(byName.create_promotion, args);
    expect(prev.status).toBe('ok');
    expect(prev.target).toContain('Aniversario 20%');
    const out = await run(byName.create_promotion, args);
    expect(out.promotion_id).toBe(9);
    expect(deps.promotionsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Aniversario 20%', value: 20 }),
    );
  });

  it('create_promotion rechaza porcentaje mayor de 100 sin tocar deps', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.create_promotion, {
      name: 'x',
      type: 'percentage',
      value: 150,
      start_date: '2026-10-01',
    });
    expect(out.error).toContain('100');
    expect(deps.promotionsService.create).not.toHaveBeenCalled();
  });

  it('activate_promotion advierte y activa', async () => {
    const { deps, byName } = buildTools();
    const prev = await preview(byName.activate_promotion, {
      promotion_id: 8,
    });
    expect(prev.status).toBe('warning');
    expect(prev.target).toContain('Aniversario 20%');
    const out = await run(byName.activate_promotion, { promotion_id: 8 });
    expect(out.resumen).toContain('activada');
    expect(deps.promotionsService.activate).toHaveBeenCalledWith(8);
  });

  it('activate_promotion rechaza promoción ya activa', async () => {
    const { deps, byName } = buildTools({
      promotionsService: {
        findOne: jest
          .fn()
          .mockResolvedValue({ ...PROMO, state: 'active' }),
        activate: jest.fn(),
      },
    });
    const prev = await preview(byName.activate_promotion, {
      promotion_id: 8,
    });
    expect(prev.status).toBe('error');
    expect(prev.message).toContain('activa');
    expect(deps.promotionsService.activate).not.toHaveBeenCalled();
  });

  it('create_coupon previsualiza y crea', async () => {
    const { deps, byName } = buildTools();
    const args = {
      code: 'bienvenida10',
      name: 'Bienvenida',
      discount_type: 'PERCENTAGE',
      discount_value: 10,
      valid_from: '2026-10-01',
      valid_until: '2026-12-31',
    };
    const prev = await preview(byName.create_coupon, args);
    expect(prev.status).toBe('ok');
    expect(prev.target).toContain('BIENVENIDA10');
    const out = await run(byName.create_coupon, args);
    expect(out.coupon_id).toBe(4);
    expect(deps.couponsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'bienvenida10' }),
    );
  });

  it('validate_coupon simula sin consumir usos', async () => {
    const { deps, byName } = buildTools();
    const out = await run(byName.validate_coupon, {
      code: 'BIENVENIDA10',
      cart_subtotal: 50000,
    });
    expect(out).toEqual({
      valid: true,
      code: 'BIENVENIDA10',
      discount_amount: 5000,
    });
    expect(deps.couponsService.validate).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'BIENVENIDA10', cart_subtotal: 50000 }),
    );
  });
});
