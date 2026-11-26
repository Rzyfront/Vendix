import { createCapabilityTools } from './capability.tools';
import { CapabilityRegistryService } from './capability-registry.service';

function listCapabilities(describeDomain: jest.Mock) {
  const [tool] = createCapabilityTools({
    capabilities: {
      describeDomain,
      listDomains: jest.fn().mockReturnValue([]),
      gaps: jest.fn().mockReturnValue([]),
    } as unknown as CapabilityRegistryService,
  });
  return tool;
}

describe('list_capabilities', () => {
  it('an area without bridge routes points to search_tools, not to guessed routes', async () => {
    const tool = listCapabilities(jest.fn().mockReturnValue([]));
    const answer = JSON.parse(
      await tool.handler!({ domain: 'suppliers' }, {} as never),
    );

    expect(answer.total).toBe(0);
    expect(answer.next_step).toMatch(/search_tools/);
    expect(answer.next_step).toMatch(/no adivines rutas/);
  });

  it('an area with routes keeps asking for the full contract first', async () => {
    const tool = listCapabilities(
      jest.fn().mockReturnValue([
        {
          area: 'store',
          module_hint: 'expenses',
          reads: [{ id: 'expenses.list', fields: [] }],
          writes: [],
        },
      ]),
    );
    const answer = JSON.parse(
      await tool.handler!({ domain: 'expenses' }, {} as never),
    );

    expect(answer.total).toBe(1);
    expect(answer.next_step).toMatch(/list_endpoints/);
  });
});

describe('list_capabilities · herramientas nativas (T7)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createPricingTools } = require('../domains/pricing.tools');
  const pricing = createPricingTools({
    priceTiersService: {},
    productsService: {},
    productsBulkEditService: {},
  }) as Array<{ name: string; domain: string; description: string; readOnly?: boolean }>;
  const native = pricing.map((t) => ({
    name: t.name,
    domain: t.domain,
    description: t.description,
    readOnly: t.readOnly === true,
  }));

  function build(nativeTools = () => native) {
    const [tool] = createCapabilityTools({
      capabilities: {
        describeDomain: jest.fn().mockReturnValue([]),
        listDomains: jest.fn().mockReturnValue([]),
        gaps: jest.fn().mockReturnValue([]),
      } as unknown as CapabilityRegistryService,
      nativeTools,
    });
    return tool;
  }

  it("list_capabilities({domain:'pricing'}) devuelve las tools nativas, no «sin rutas»", async () => {
    const answer = JSON.parse(
      await build().handler!({ domain: 'pricing' }, {} as never),
    );
    const names = answer.herramientas.map((h: any) => h.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'manage_price_tiers',
        'set_product_tier_override',
        'manage_product_price_tiers',
      ]),
    );
    expect(
      answer.herramientas.find((h: any) => h.name === 'preview_product_price_tiers').tipo,
    ).toBe('consulta');
    expect(
      answer.herramientas.find((h: any) => h.name === 'manage_product_price_tiers').tipo,
    ).toBe('cambio');
    expect(answer.next_step).toMatch(/herramientas propias/);
    expect(answer.next_step).not.toMatch(/no tiene rutas del puente/);
  });

  it('sin rutas ni herramientas: una búsqueda y luego decirlo en una frase', async () => {
    const answer = JSON.parse(
      await build(() => []).handler!({ domain: 'pricing' }, {} as never),
    );
    expect(answer.herramientas).toBeUndefined();
    expect(answer.next_step).toMatch(/dile en una frase que no puedes/);
  });

  it('el índice de áreas suma las áreas servidas por herramientas', async () => {
    const answer = JSON.parse(await build().handler!({}, {} as never));
    expect(answer.areas_con_herramientas).toEqual([
      { domain: 'pricing', herramientas: native.length },
    ]);
  });

  it('las tools de andamiaje no aparecen como área', async () => {
    const answer = JSON.parse(
      await build(() => [
        { name: 'search_tools', domain: 'discovery', description: 'x', readOnly: true },
      ]).handler!({}, {} as never),
    );
    expect(answer.areas_con_herramientas).toBeUndefined();
  });
});

describe('frontera de dominio del puente (E2E g09)', () => {
  // Imports diferidos: el resto de este spec usa dobles y no carga el catálogo.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { ApiCatalogService } = require('./api-catalog.service');
  const { createApiBridgeTools } = require('./api-bridge.tools');
  const {
    RequestContextService,
  } = require('../../../common/context/request-context.service');
  const {
    normalizeToolResult,
  } = require('../tool-result.normalizer');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const entry = (path: string, area: string, domain: string) => ({
    path,
    method: 'GET',
    area,
    domain,
    controller: 'C',
    handler: 'h',
    requiredPermissions: ['payroll:read'],
  });

  function setup(context: Record<string, unknown>) {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      permissions: ['payroll:read'],
      access_token: 'synthetic-test-only',
      is_owner: false,
      is_super_admin: false,
      ...context,
    });
    const catalog = new ApiCatalogService({}, {}, {});
    catalog.entries = [
      entry('organization/payroll/settings', 'organization', 'payroll'),
      entry('store/payroll/settings', 'store', 'payroll'),
      {
        ...entry('organization/payroll/settings', 'organization', 'payroll'),
        method: 'PATCH',
        bodySchema: [],
      },
    ];
    const capabilities = new CapabilityRegistryService(catalog);
    const [listCapabilities] = createCapabilityTools({ capabilities });
    const bridge = createApiBridgeTools({ catalog, attachments: {} });
    const tool = (name: string) =>
      bridge.find((t: { name: string }) => t.name === name);
    return { listCapabilities, tool, catalog };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('con token de tienda, list_capabilities no ofrece organization/*', async () => {
    const { listCapabilities } = setup({ app_type: 'STORE_ADMIN', store_id: 7 });
    const areas = JSON.parse(await listCapabilities.handler!({}, {} as never));
    expect(areas.areas).toEqual([
      expect.objectContaining({ domain: 'payroll', scope: 'store' }),
    ]);
    const detail = JSON.parse(
      await listCapabilities.handler!({ domain: 'payroll' }, {} as never),
    );
    const paths = detail.operaciones.map((o: { path: string }) => o.path);
    expect(paths).toEqual(['store/payroll/settings']);
  });

  it('con token de tienda, list_endpoints tampoco lista organization/*', async () => {
    const { tool } = setup({ app_type: 'STORE_ADMIN', store_id: 7 });
    const domains = JSON.parse(
      await tool('list_endpoints').handler({}, {} as never),
    );
    expect(domains.domains).toEqual(['store/payroll']);
    const writes = JSON.parse(
      await tool('list_endpoints').handler(
        { domain: 'payroll', writable_only: true },
        {} as never,
      ),
    );
    expect(writes.total).toBe(0);
  });

  it('call_endpoint rechaza organization/* ANTES de despachar, como recoverable_error', async () => {
    const { tool } = setup({ app_type: 'STORE_ADMIN', store_id: 7 });
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('no debió despacharse'));
    const raw = await tool('call_endpoint').handler(
      { path: 'organization/payroll/settings' },
      {} as never,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    const answer = JSON.parse(raw);
    expect(answer.error).toMatch(/es de la organización/);
    expect(answer.next_step).toMatch(/rutas store\//);
    expect(answer.statusCode).toBeUndefined();
    expect(normalizeToolResult(raw).status).toBe('recoverable_error');
  });

  it('write_endpoint no acuña propuesta para organization/* desde la tienda', async () => {
    const { tool } = setup({ app_type: 'STORE_ADMIN', store_id: 7 });
    const preview = await tool('write_endpoint').preview(
      { path: 'organization/payroll/settings', method: 'PATCH', body: {} },
      {} as never,
    );
    expect(preview.status).toBe('error');
    expect(preview.message).toMatch(/es de la organización/);
  });

  it('la validación de playbooks lee el catálogo completo aunque haya contexto de tienda', () => {
    const { catalog } = setup({ app_type: 'STORE_ADMIN', store_id: 7 });
    const paths = catalog
      .listFor(['payroll:read'], undefined, undefined, undefined, {
        ignoreDomainScope: true,
      })
      .map((e: { path: string }) => e.path);
    expect(paths).toContain('organization/payroll/settings');
  });

  it('un ORG_ADMIN sí ve organization/* y no store/* (misma regla que el guard)', async () => {
    const { listCapabilities } = setup({ app_type: 'ORG_ADMIN' });
    const detail = JSON.parse(
      await listCapabilities.handler!({ domain: 'payroll' }, {} as never),
    );
    const paths = detail.operaciones.map((o: { path: string }) => o.path);
    expect(paths).toContain('organization/payroll/settings');
    expect(paths).not.toContain('store/payroll/settings');
  });
});
