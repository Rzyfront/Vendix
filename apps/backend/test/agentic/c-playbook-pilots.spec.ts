import 'reflect-metadata';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MetadataScanner, Reflector } from '@nestjs/core';
import type { DiscoveryService } from '@nestjs/core';
import type Redis from 'ioredis';
import {
  RequestContextService,
  type RequestContext,
} from '../../src/common/context/request-context.service';
import { ResponseService } from '../../src/common/responses/response.service';
import { VendixHttpException } from '../../src/common/errors';
import { SessionsController } from '../../src/domains/store/cash-registers/sessions/sessions.controller';
import { VexiConfirmationService } from '../../src/domains/store/vexi/vexi-confirmation.service';
import { AIToolRegistry } from '../../src/ai-engine/tools/ai-tool-registry';
import { ApiCatalogService } from '../../src/ai-engine/tools/bridge/api-catalog.service';
import {
  createApiBridgeTools,
  type ApiBridgeDeps,
} from '../../src/ai-engine/tools/bridge/api-bridge.tools';
import {
  createInventoryTools,
  type InventoryToolServices,
} from '../../src/ai-engine/tools/domains/inventory.tools';
import {
  createOrdersTools,
  type OrdersToolDeps,
} from '../../src/ai-engine/tools/domains/orders.tools';
import {
  createInvoicingTools,
  type InvoicingToolDeps,
} from '../../src/ai-engine/tools/domains/invoicing.tools';
import {
  createCashRegisterTools,
  type CashRegisterToolDeps,
} from '../../src/ai-engine/tools/domains/cash-register.tools';
import {
  createSupplierTools,
  type SupplierToolDeps,
} from '../../src/ai-engine/tools/domains/suppliers.tools';
import { PlaybookLoaderService } from '../../src/ai-engine/playbooks/playbook-loader.service';
import {
  PlaybookService,
  type LoadedPlaybook,
} from '../../src/ai-engine/playbooks/playbook.service';
import { verifyPlaybook } from '../../src/ai-engine/playbooks/playbook-verifiers';
import type { PlaybookObservation } from '../../src/ai-engine/playbooks/playbook.interface';

/**
 * Offline integration, NOT a provider/model trace or live business adjudication.
 * The loader/parser/validator/service, reflected API catalog, actual factories,
 * registry and confirmation fingerprint/redeem implementation are real. Only
 * domain services, Redis transport and internal HTTP transport are fixtures.
 * D2 objective transitions are intentionally outside C and outside this suite.
 */
const PILOTS = ['reponer-inventario', 'facturar-venta', 'cerrar-caja'] as const;
const SCOPE = { organization_id: 3, store_id: 7, user_id: 11 };
const PERMISSIONS = [
  'store:inventory:stock_levels:read',
  'store:inventory:suppliers:read',
  'store:orders:read',
  'invoicing:read',
  'invoicing:write',
  'store:cash_registers:read',
  'store:cash_registers:movements',
  'store:cash_registers:close_session',
];
const CONTEXT: RequestContext = {
  ...SCOPE,
  permissions: PERMISSIONS,
  roles: [],
  is_owner: true,
  is_super_admin: false,
  access_token: 'offline-fixture-not-a-credential',
};
const scoped = <T>(run: () => T, overrides: Partial<RequestContext> = {}) =>
  RequestContextService.runIsolated({ ...CONTEXT, ...overrides }, run);
type Data = Record<string, unknown>;
const data = (value: unknown): Data =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Data)
    : {};

/** Asset adapter selects the three RELEASE files; their content is never mocked. */
class PilotAssetsLoader extends PlaybookLoaderService {
  constructor(
    registry: AIToolRegistry,
    catalog: ApiCatalogService,
    private readonly directory: string,
  ) {
    super(registry, catalog);
  }
  assetDirectory(): string {
    return this.directory;
  }
}

function fixture(directory: string) {
  const redisValues = new Map<string, string>();
  const redis = {
    set: jest.fn(async (key: string, value: string) => {
      redisValues.set(key, value);
      return 'OK';
    }),
    eval: jest.fn(
      async (
        _script: string,
        _keys: number,
        key: string,
        fingerprint: string,
        boundFingerprint?: string,
        metadata?: string,
      ) => {
        if (_keys === 2 && _script.includes("redis.call('SET'")) {
          redisValues.set(key, boundFingerprint!);
          redisValues.set(fingerprint, metadata!);
          return 1;
        }
        const stored = redisValues.get(key);
        if (stored === undefined) return 0;
        if (stored !== fingerprint) return -1;
        redisValues.delete(key);
        return 1;
      },
    ),
  };
  const registry = new AIToolRegistry(
    new VexiConfirmationService(redis as unknown as Redis),
  );
  const state = {
    invoice: null as Data | null,
    cash: {
      id: 900020,
      cash_register_id: 900021,
      status: 'open',
      opening_amount: 50,
      pending_orders_tracking_enabled: true,
      register: { id: 900021, name: 'Caja sintética' },
      expected_closing_amount: 100,
      actual_closing_amount: null as number | null,
      difference: null as number | null,
    },
  };
  const inventory = {
    stockLevelsService: {
      findAll: jest.fn(async () => [
        {
          product_id: 900001,
          products: { name: 'Producto sintético', sku: 'SYNTH-1' },
          inventory_locations: { name: 'Bodega sintética', type: 'warehouse' },
          quantity_on_hand: 8,
          quantity_reserved: 3,
          quantity_available: 5,
          reorder_point: 10,
        },
      ]),
      getSourcingSuggestion: jest.fn(async () => ({
        suggestion: 'purchase',
        requested_quantity: 10,
        main_location: {
          id: 900030,
          name: 'Bodega sintética',
          quantity_available: 5,
        },
        other_locations: [],
      })),
    },
    inventoryIntegrationService: {
      getLowStockAlerts: jest.fn(async () => [
        {
          productId: 900001,
          productName: 'Producto sintético',
          locationId: 900030,
          locationName: 'Bodega sintética',
          currentStock: 5,
          reorderPoint: 10,
        },
      ]),
    },
    adjustmentsService: { create: jest.fn() },
    movementsService: { findAll: jest.fn() },
    locationsService: {},
    transfersService: { create: jest.fn() },
  };
  const suppliers = {
    suppliersService: {
      findAll: jest.fn(async () => ({
        data: [{ id: 900002, name: 'Proveedor sintético', state: 'active' }],
        meta: { total: 1 },
      })),
      create: jest.fn(),
    },
  };
  const orders = {
    ordersService: {
      findOne: jest.fn(async () => ({
        id: 900010,
        order_number: 'SYNTHETIC-ORDER',
        state: 'finished',
        currency: 'COP',
        grand_total: 119,
        subtotal_amount: 100,
        tax_amount: 19,
        total_paid: 119,
        order_items: [
          {
            product_id: 900001,
            product_name: 'Producto sintético',
            quantity: 1,
            unit_price: 100,
            total_price: 100,
          },
        ],
        payments: [],
        invoices:
          state.invoice?.status === 'accepted'
            ? [structuredClone(state.invoice)]
            : [],
      })),
    },
  };
  const requireInvoice = () => {
    if (!state.invoice) throw new Error('Factura no encontrada');
    return structuredClone(state.invoice);
  };
  const invoicing = {
    invoicingService: {
      findOne: jest.fn(async () => requireInvoice()),
      createFromOrder: jest.fn(async (orderId: number) => {
        if (orderId !== 900010 || state.invoice)
          throw new Error('Orden inexistente o ya facturada');
        state.invoice = {
          id: 900011,
          status: 'draft',
          order_id: orderId,
          invoice_number: 'SYNTHETIC-FV',
          total_amount: 119,
          subtotal_amount: 100,
          tax_amount: 19,
          cufe: null,
          invoice_items: [{ id: 900012 }],
        };
        return requireInvoice();
      }),
    },
    invoiceFlowService: {
      getEmitReadiness: jest.fn(async () => ({
        invoice_id: 900011,
        emittable: true,
        blockers: [],
      })),
      getIssuerEmissionGate: jest.fn(async () => ({
        can_emit: true,
        vat_responsible: true,
        inc_responsible: false,
        tax_responsibilities: ['O-48'],
      })),
      validate: jest.fn(async () => {
        state.invoice!.status = 'validated';
        return requireInvoice();
      }),
      send: jest.fn(async () => {
        state.invoice!.status = 'sent';
        return requireInvoice();
      }),
    },
    dianEventsService: { findByInvoice: jest.fn(async () => []) },
    resolutionsService: {
      findAll: jest.fn(async () => [
        {
          id: 900040,
          is_active: true,
          to_number: 100,
          current_number: 1,
          prefix: 'SYNTH',
        },
      ]),
    },
    dianConfigService: {
      getDashboard: jest.fn(async () => ({})),
      getEmissionStatus: jest.fn(async () => ({ is_live: true })),
    },
    certificateAdapter: {},
    s3Service: {},
  };
  const cash = {
    sessionsService: {
      getActiveSession: jest.fn(async () =>
        state.cash.status === 'open' ? structuredClone(state.cash) : null,
      ),
      findOne: jest.fn(async (id: number) => {
        if (id !== state.cash.id) throw new Error('Sesión no encontrada');
        return structuredClone(state.cash);
      }),
      getCashSummary: jest.fn(async () => ({ expected_cash_total: 100 })),
      getPendingOrders: jest.fn(async () => ({
        count: 0,
        fingerprint: 'synthetic-empty',
        data: [],
        page: 1,
        limit: 100,
      })),
      closeSession: jest.fn(
        async (id: number, dto: { actual_closing_amount: number }) => {
          if (id !== state.cash.id || state.cash.status !== 'open')
            throw new Error('Sesión no abierta');
          state.cash.status = 'closed';
          state.cash.actual_closing_amount = dto.actual_closing_amount;
          state.cash.difference =
            dto.actual_closing_amount - state.cash.expected_closing_amount;
          return structuredClone(state.cash);
        },
      ),
    },
    movementsService: {
      findBySession: jest.fn(async () => [
        { id: 900050, session_id: state.cash.id, type: 'cash_in', amount: 50 },
      ]),
      createManualMovement: jest.fn(),
    },
  };
  // Discovery sees the actual controller decorators/DTOs, never an invented route map.
  const controller = new SessionsController(
    cash.sessionsService as unknown as ConstructorParameters<
      typeof SessionsController
    >[0],
    cash.movementsService as unknown as ConstructorParameters<
      typeof SessionsController
    >[1],
    new ResponseService(),
  );
  const discovery = {
    getControllers: () => [
      { instance: controller, metatype: SessionsController },
    ],
  };
  const catalog = new ApiCatalogService(
    discovery as unknown as DiscoveryService,
    new MetadataScanner(),
    new Reflector(),
  );
  catalog.onApplicationBootstrap();
  registry.registerMany(
    createInventoryTools(inventory as unknown as InventoryToolServices),
  );
  registry.registerMany(
    createSupplierTools(suppliers as unknown as SupplierToolDeps),
  );
  registry.registerMany(createOrdersTools(orders as unknown as OrdersToolDeps));
  registry.registerMany(
    createInvoicingTools(invoicing as unknown as InvoicingToolDeps),
  );
  registry.registerMany(
    createCashRegisterTools(cash as unknown as CashRegisterToolDeps),
  );
  registry.registerMany(
    createApiBridgeTools({ catalog, attachments: {} } as ApiBridgeDeps),
  );
  const loader = new PilotAssetsLoader(registry, catalog, directory);
  const service = new PlaybookService(loader, registry, catalog);
  const session = () =>
    service.createSession({
      scope: SCOPE,
      authorizedDefinitions: registry.getAvailableDefinitions(PERMISSIONS),
    });

  const fetchMock = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url, options) => {
      expect(options?.method).toBe('GET');
      expect(data(options?.headers).Authorization).toBe(
        'Bearer offline-fixture-not-a-credential',
      );
      const path = new URL(String(url)).pathname.replace(/^\/api\//, '');
      const base = `store/cash-registers/sessions/${state.cash.id}`;
      // Domain controller invocation emulates transport payload ONLY; this is not an HTTP/guards E2E.
      const body =
        path === base
          ? await controller.findOne(String(state.cash.id))
          : path === `${base}/movements`
            ? await controller.getMovements(String(state.cash.id))
            : path === `${base}/cash-summary`
              ? await controller.getCashSummary(String(state.cash.id))
              : path === `${base}/pending-orders`
                ? await controller.getPendingOrders(String(state.cash.id), {})
                : { success: false, statusCode: 404 };
      return new Response(JSON.stringify(body), {
        status: path.startsWith(base) ? 200 : 404,
      });
    });
  const read = async (
    step: string,
    tool: string,
    args: Data,
    afterStep?: string,
  ): Promise<PlaybookObservation> => {
    const result = await registry.executeToolResult(tool, args, {
      evidenceRef: `offline:${step}`,
    });
    const value = data(result.data);
    const domain = value.success === true ? data(value.data) : value;
    const ids: Record<string, string | number> = { ...result.resource_ids };
    for (const key of ['invoice_id', 'order_id', 'session_id']) {
      if (typeof domain[key] === 'number' || typeof domain[key] === 'string')
        ids[key] = domain[key];
    }
    if (
      tool === 'call_endpoint' &&
      typeof domain.id === 'number' &&
      args.path === `store/cash-registers/sessions/${domain.id}`
    )
      ids.session_id = domain.id;
    return {
      step_id: step,
      tool,
      status:
        result.status === 'ok' ||
        result.status === 'unknown_effect' ||
        result.status === 'pending_confirmation'
          ? result.status
          : 'error',
      fresh: result.freshness === 'observed',
      complete:
        result.freshness !== 'truncated' &&
        result.pagination?.complete !== false,
      resource_ids: ids,
      data: result.data,
      arguments: structuredClone(args),
      ...(tool === 'call_endpoint'
        ? { bridge: { method: 'GET' as const, path: String(args.path) } }
        : {}),
      ...(afterStep ? { after_step: afterStep } : {}),
    };
  };
  const propose = async (tool: string, args: Data) => {
    try {
      await registry.executeTool(tool, args);
    } catch (error) {
      if (!(error instanceof VendixHttpException)) throw error;
      expect(error.errorCode).toBe('AI_AGENT_005');
      return data(data(error.getResponse()).details);
    }
    throw new Error(`Expected proposal/refusal for ${tool}`);
  };
  const apply = async (
    step: string,
    tool: string,
    args: Data,
    token: string,
  ): Promise<PlaybookObservation> => {
    const receipt = await registry.executeToolResult(tool, args, {
      confirmationToken: token,
      evidenceRef: `offline:${step}`,
    });
    expect(receipt.status).toBe('ok');
    expect(receipt.effect_status).toBe('applied');
    return {
      step_id: step,
      tool,
      status: 'ok',
      fresh: receipt.freshness === 'observed',
      complete: receipt.freshness !== 'truncated',
      resource_ids: receipt.resource_ids,
      data: receipt.data,
    };
  };
  /** Test-only symbolic binding, NOT a production scheduler or model execution. */
  const releaseStep = (
    id: (typeof PILOTS)[number],
    stepId: string,
    input: Data,
  ) => {
    const document = loader
      .getPlaybooks()
      .find((candidate) => candidate.id === id)!;
    const declared = document.contract.steps.find(
      (step) => step.id === stepId,
    )!;
    expect(declared).toBeDefined();
    // One fresh turn's relevant section, never all workflow bodies at once.
    const loaded = service.load(session(), {
      id,
      version: document.metadata.version,
      section: declared.section,
    }) as LoadedPlaybook;
    expect(loaded.mode).toBe('executable');
    expect(loaded.omitted_steps).toBe(0);
    const step = loaded.section.steps.find(
      (candidate) => candidate.id === stepId,
    )!;
    expect(step).toBeDefined();
    expect(step.tool).toBeDefined();
    const args = Object.fromEntries(
      Object.entries(step.arguments ?? {}).map(([key, value]) => {
        if (typeof value !== 'string') return [key, value];
        const whole = /^\$\{inputs\.([a-z_]+)\}$/.exec(value);
        if (whole) {
          expect(input[whole[1]]).toBeDefined();
          return [key, input[whole[1]]];
        }
        return [
          key,
          value.replace(/\$\{inputs\.([a-z_]+)\}/g, (_match, field: string) => {
            expect(input[field]).toBeDefined();
            return String(input[field]);
          }),
        ];
      }),
    );
    return { step, args };
  };
  const readStep = async (
    id: (typeof PILOTS)[number],
    stepId: string,
    input: Data,
    afterStep?: string,
  ) => {
    const { step, args } = releaseStep(id, stepId, input);
    expect(step.approval).toBe('none');
    return read(step.id, step.tool!, args, afterStep);
  };
  const proposeStep = async (
    id: (typeof PILOTS)[number],
    stepId: string,
    input: Data,
  ) => {
    const { step, args } = releaseStep(id, stepId, input);
    expect(step.approval).toBe('individual');
    return propose(step.tool!, args);
  };
  const applyStep = async (
    id: (typeof PILOTS)[number],
    stepId: string,
    input: Data,
    token: string,
  ) => {
    const { step, args } = releaseStep(id, stepId, input);
    expect(step.approval).toBe('individual');
    return apply(step.id, step.tool!, args, token);
  };
  return {
    registry,
    catalog,
    loader,
    service,
    session,
    state,
    redis,
    redisValues,
    inventory,
    suppliers,
    orders,
    invoicing,
    cash,
    read,
    propose,
    apply,
    readStep,
    proposeStep,
    applyStep,
    fetchMock,
  };
}

describe('C three playbook pilots: offline real-factory integration', () => {
  let directory: string;
  let h: ReturnType<typeof fixture>;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'vendix-c-pilots-'));
    for (const id of PILOTS)
      copyFileSync(
        resolve(__dirname, '../../src/ai-engine/playbooks/content', `${id}.md`),
        join(directory, `${id}.md`),
      );
  });
  beforeEach(async () => {
    h = fixture(directory);
    await h.loader.initializeRelease();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it.each(PILOTS)(
    '%s bootstraps its unmodified release against real tool/route contracts',
    (id) =>
      scoped(() => {
        const document = h.loader
          .getPlaybooks()
          .find((candidate) => candidate.id === id)!;
        expect(document).toBeDefined();
        expect(document.contract.gaps).toEqual([]);
        expect(document.contract.mode).toBe('executable');
        for (const contract of document.metadata.tool_contracts)
          expect(h.registry.get(contract.name)?.version).toBe(contract.version);
        const loaded = h.service.load(h.session(), {
          id,
          version: document.metadata.version,
          section: 'steps',
        }) as LoadedPlaybook;
        expect(loaded.section.steps.length).toBeGreaterThan(0);
        expect(loaded.omitted_steps).toBe(0);
        expect(
          Buffer.byteLength(JSON.stringify(loaded), 'utf8'),
        ).toBeLessThanOrEqual(2000);
        expect(h.redis.set).not.toHaveBeenCalled();
        expect(
          h.invoicing.invoicingService.createFromOrder,
        ).not.toHaveBeenCalled();
        expect(h.cash.sessionsService.closeSession).not.toHaveBeenCalled();
      }),
  );

  it('prepares replenishment from real stock/reservations/supplier reads without any business mutation', () =>
    scoped(async () => {
      const input = {
        product_id: 900001,
        quantity: 10,
        supplier_query: 'Proveedor sintético',
      };
      const observations = [
        await h.readStep('reponer-inventario', 'alerts', input),
        await h.readStep('reponer-inventario', 'stock', input),
        await h.readStep('reponer-inventario', 'sourcing', input),
        await h.readStep('reponer-inventario', 'supplier', input),
        await h.readStep('reponer-inventario', 'verify', input),
      ];
      expect(data(observations[1].data).data).toEqual([
        expect.objectContaining({ on_hand: 8, reserved: 3, available: 5 }),
      ]);
      expect(
        verifyPlaybook('reponer-inventario', input, observations).verified,
      ).toBe(true);
      expect(
        h.inventory.inventoryIntegrationService.getLowStockAlerts,
      ).toHaveBeenCalledWith(SCOPE.organization_id, undefined);
      expect(h.inventory.adjustmentsService.create).not.toHaveBeenCalled();
      expect(h.inventory.transfersService.create).not.toHaveBeenCalled();
      expect(h.suppliers.suppliersService.create).not.toHaveBeenCalled();
      expect(h.redis.set).not.toHaveBeenCalled();
    }));

  it('cannot verify a purchase proposal when the requested supplier was not found; recovery asks the specific business decision', () =>
    scoped(async () => {
      h.suppliers.suppliersService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0 },
      });
      const input = {
        product_id: 900001,
        quantity: 10,
        supplier_query: 'Proveedor ausente',
      };
      const observations = [
        await h.read('stock', 'get_stock_levels', {
          product_id: input.product_id,
        }),
        await h.read('supplier', 'find_supplier', {
          query: input.supplier_query,
        }),
        await h.read('verify', 'get_sourcing_suggestion', {
          product_id: input.product_id,
          quantity: input.quantity,
        }),
      ];
      expect(data(observations[1].data).candidatos).toEqual([]);
      expect(
        verifyPlaybook('reponer-inventario', input, observations),
      ).toMatchObject({
        verified: false,
        reasons: expect.arrayContaining(['supplier_choice_required']),
      });
      const loaded = h.service.load(h.session(), {
        id: 'reponer-inventario',
        version: '1.0.0',
        section: 'recovery',
      }) as LoadedPlaybook;
      expect(loaded.section.body).toMatch(
        /proveedor.*(?:crear|elegir)|(?:crear|elegir).*proveedor/i,
      );
      expect(loaded.section.body).toMatch(/sin proveedor/i);
      expect(h.suppliers.suppliersService.create).not.toHaveBeenCalled();
      expect(h.inventory.adjustmentsService.create).not.toHaveBeenCalled();
      expect(h.redis.set).not.toHaveBeenCalled();
    }));

  it('refuses close before a human supplied actual_closing_amount; expected cash is not a substitute', () =>
    scoped(async () => {
      const active = await h.read('active', 'get_active_cash_session', {});
      expect(data(active.data).session).toMatchObject({
        id: 900020,
        status: 'open',
      });
      const summary = await h.read('summary', 'call_endpoint', {
        path: 'store/cash-registers/sessions/900020/cash-summary',
      });
      expect(data(data(summary.data).data).expected_cash_total).toBe(100);
      const result = JSON.parse(
        await h.registry.executeTool('close_cash_session', {
          session_id: 900020,
        }),
      );
      expect(result.error).toContain('actual_closing_amount');
      expect(h.redis.set).not.toHaveBeenCalled();
      expect(h.cash.sessionsService.closeSession).not.toHaveBeenCalled();
      expect(h.state.cash.status).toBe('open');
    }));

  it('a proposed cash close does not mutate and binds its individual approval to exact arguments and actor', () =>
    scoped(async () => {
      const args = {
        session_id: 900020,
        actual_closing_amount: 105,
        discrepancy_reviewed: true,
        discrepancy_reason: 'La persona revisó y confirma el conteo.',
      };
      const proposal = await h.propose('close_cash_session', args);
      expect(data(proposal.preview)).toMatchObject({
        status: 'warning',
        changes: expect.arrayContaining([
          expect.objectContaining({ field: 'actual_closing_amount', to: 105 }),
        ]),
      });
      expect(proposal.confirmation_token).toEqual(expect.any(String));
      expect(h.cash.sessionsService.closeSession).not.toHaveBeenCalled();
      expect(h.state.cash.status).toBe('open');
      const options = {
        confirmationToken: String(proposal.confirmation_token),
      };
      await expect(
        h.registry.executeTool(
          'close_cash_session',
          { ...args, actual_closing_amount: 999 },
          options,
        ),
      ).rejects.toMatchObject({ errorCode: 'AI_AGENT_005' });
      await scoped(
        () =>
          expect(
            h.registry.executeTool('close_cash_session', args, options),
          ).rejects.toMatchObject({ errorCode: 'AI_AGENT_005' }),
        { user_id: 12 },
      );
      expect(h.cash.sessionsService.closeSession).not.toHaveBeenCalled();
      await h.registry.executeTool('close_cash_session', args, options);
      expect(h.cash.sessionsService.closeSession).toHaveBeenCalledTimes(1);
      await expect(
        h.registry.executeTool('close_cash_session', args, options),
      ).rejects.toMatchObject({ errorCode: 'AI_AGENT_005' });
      expect(h.cash.sessionsService.closeSession).toHaveBeenCalledTimes(1);
    }));

  it('rechecks current permissions before redeeming a previously issued approval', () =>
    scoped(async () => {
      const args = { session_id: 900020, actual_closing_amount: 105 };
      const proposal = await h.propose('close_cash_session', args);
      await scoped(
        () =>
          expect(
            h.registry.executeTool('close_cash_session', args, {
              confirmationToken: String(proposal.confirmation_token),
            }),
          ).rejects.toMatchObject({ errorCode: 'AI_AGENT_004' }),
        { permissions: ['store:cash_registers:read'] },
      );
      expect(
        h.redis.eval.mock.calls.filter(([script]) =>
          script.includes("redis.call('DEL'"),
        ),
      ).toHaveLength(0);
      expect(h.cash.sessionsService.closeSession).not.toHaveBeenCalled();
    }));

  it('detects a changed cash session after preview instead of forcing the approved close', () =>
    scoped(async () => {
      const args = {
        session_id: 900020,
        actual_closing_amount: 105,
        discrepancy_reviewed: true,
        discrepancy_reason: 'La persona revisó y confirma el conteo.',
      };
      const proposal = await h.propose('close_cash_session', args);
      h.state.cash.status = 'closed'; // Another operator changed the DOMAIN fixture.
      const output = JSON.parse(
        await h.registry.executeTool('close_cash_session', args, {
          confirmationToken: String(proposal.confirmation_token),
        }),
      );
      expect(output.error).toMatch(/ya no está abierta/);
      expect(h.cash.sessionsService.closeSession).not.toHaveBeenCalled();
    }));

  it('pending orders require an explicit decision/fingerprint; the playbook cannot select override', () =>
    scoped(async () => {
      h.cash.sessionsService.getPendingOrders.mockResolvedValue({
        count: 1,
        fingerprint: 'changed-pending',
        data: [{ id: 900060 }] as never[],
        page: 1,
        limit: 100,
      });
      const refusal = await h.propose('close_cash_session', {
        session_id: 900020,
        actual_closing_amount: 105,
      });
      expect(refusal.confirmation_token).toBeUndefined();
      expect(data(refusal.preview).message).toContain('pending_decision');
      expect(h.redis.set).not.toHaveBeenCalled();
      expect(h.cash.sessionsService.closeSession).not.toHaveBeenCalled();
    }));

  it.each([105, 0])(
    'cash close counted=%s changes once and an exact final domain read proves its difference',
    (counted) =>
      scoped(async () => {
        const args = { session_id: 900020, actual_closing_amount: counted };
        const input = { ...args, currency: 'COP' };
        await h.readStep('cerrar-caja', 'active', input);
        await h.readStep('cerrar-caja', 'movements', input);
        await h.readStep('cerrar-caja', 'summary', input);
        await h.readStep('cerrar-caja', 'pending', input);
        // Con diferencia, la ruta del playbook guía antes de proponer: sin
        // revisión ni motivo no hay token, solo la señal de discrepancia.
        const refusal = await h.proposeStep('cerrar-caja', 'close', input);
        expect(refusal.confirmation_token).toBeUndefined();
        expect(data(refusal.preview).discrepancy).toMatchObject({
          signal: 'discrepancy_detected',
          difference: counted - 100,
        });
        const reviewed = {
          ...args,
          discrepancy_reviewed: true,
          discrepancy_reason: 'La persona revisó y confirma el conteo.',
        };
        const proposal = await h.propose('close_cash_session', reviewed);
        expect(h.state.cash.status).toBe('open');
        const close = await h.apply(
          'close',
          'close_cash_session',
          reviewed,
          String(proposal.confirmation_token),
        );
        expect(verifyPlaybook('cerrar-caja', input, [close]).verified).toBe(
          false,
        );
        const inactive = await h.read(
          'verify',
          'get_active_cash_session',
          {},
          'close',
        );
        expect(data(inactive.data).session).toBeNull();
        expect(
          verifyPlaybook('cerrar-caja', input, [close, inactive]).verified,
        ).toBe(false);
        const final = await h.readStep('cerrar-caja', 'verify', input, 'close');
        expect(data(data(final.data).data)).toMatchObject({
          id: 900020,
          status: 'closed',
          actual_closing_amount: counted,
          expected_closing_amount: 100,
          difference: counted - 100,
        });
        expect(
          verifyPlaybook('cerrar-caja', input, [close, final]),
        ).toMatchObject({
          verified: true,
          evidence_step_ids: ['close', 'verify'],
        });
        expect(h.cash.sessionsService.closeSession).toHaveBeenCalledTimes(1);
        expect(h.cash.sessionsService.closeSession).toHaveBeenCalledWith(
          900020,
          {
            actual_closing_amount: counted,
            closing_notes: expect.stringContaining(
              'La persona revisó y confirma el conteo.',
            ),
          },
        );
        await expect(
          h.registry.executeToolResult('close_cash_session', reviewed, {
            confirmationToken: String(proposal.confirmation_token),
          }),
        ).rejects.toMatchObject({ errorCode: 'AI_AGENT_005' });
        expect(h.cash.sessionsService.closeSession).toHaveBeenCalledTimes(1);
      }),
  );

  it('invoice creates, validates and emits with THREE independent approvals; sent is not accepted', () =>
    scoped(async () => {
      const input = { order_id: 900010, invoice_id: 900011 };
      const order = await h.readStep('facturar-venta', 'order', input);
      expect(data(data(order.data).orden).order_id).toBe(input.order_id);
      const createProposal = await h.proposeStep(
        'facturar-venta',
        'create',
        input,
      );
      expect(h.state.invoice).toBeNull();
      const created = await h.applyStep(
        'facturar-venta',
        'create',
        input,
        String(createProposal.confirmation_token),
      );
      expect(created.resource_ids).toEqual({
        invoice_id: input.invoice_id,
        order_id: input.order_id,
      });
      expect(h.invoicing.invoiceFlowService.validate).not.toHaveBeenCalled();
      expect(h.invoicing.invoiceFlowService.send).not.toHaveBeenCalled();
      const invoiceArgs = {
        invoice_id: Number(created.resource_ids.invoice_id),
      };
      await h.readStep('facturar-venta', 'invoice', input);
      await h.readStep('facturar-venta', 'readiness', input);
      await expect(
        h.registry.executeToolResult('validate_invoice', invoiceArgs, {
          confirmationToken: String(createProposal.confirmation_token),
        }),
      ).rejects.toMatchObject({ errorCode: 'AI_AGENT_005' });
      const validateProposal = await h.proposeStep(
        'facturar-venta',
        'validate',
        input,
      );
      expect(h.state.invoice!.status).toBe('draft');
      const validated = await h.applyStep(
        'facturar-venta',
        'validate',
        input,
        String(validateProposal.confirmation_token),
      );
      const preflight = await h.readStep('facturar-venta', 'preflight', input);
      await h.readStep('facturar-venta', 'dian', input);
      await h.readStep('facturar-venta', 'resolution', input);
      const emitProposal = await h.proposeStep('facturar-venta', 'emit', input);
      expect(h.state.invoice!.status).toBe('validated');
      const emitted = await h.applyStep(
        'facturar-venta',
        'emit',
        input,
        String(emitProposal.confirmation_token),
      );
      expect(h.state.invoice!.status).toBe('sent');
      const observations = [created, validated, preflight, emitted];
      const sent = await h.readStep('facturar-venta', 'verify', input, 'emit');
      expect(
        verifyPlaybook('facturar-venta', input, [...observations, sent])
          .verified,
      ).toBe(false);
      // Simulated asynchronous DIAN response at the domain boundary, NOT another agent write.
      h.state.invoice!.status = 'accepted';
      h.state.invoice!.cufe = 'SYNTHETIC-CUFE';
      const orderVerified = await h.readStep(
        'facturar-venta',
        'order-verify',
        input,
        'emit',
      );
      const final = await h.readStep('facturar-venta', 'verify', input, 'emit');
      expect(
        verifyPlaybook('facturar-venta', input, [
          ...observations,
          orderVerified,
          final,
        ]),
      ).toMatchObject({
        verified: true,
        evidence_step_ids: ['create', 'validate', 'emit', 'verify'],
      });
      expect(
        h.redis.eval.mock.calls.filter(([script]) =>
          script.includes("redis.call('SET'"),
        ),
      ).toHaveLength(3);
      expect(
        new Set([
          createProposal.confirmation_token,
          validateProposal.confirmation_token,
          emitProposal.confirmation_token,
        ]).size,
      ).toBe(3);
      expect(
        h.invoicing.invoicingService.createFromOrder,
      ).toHaveBeenCalledTimes(1);
      expect(h.invoicing.invoiceFlowService.validate).toHaveBeenCalledTimes(1);
      expect(h.invoicing.invoiceFlowService.send).toHaveBeenCalledTimes(1);
      for (const [tool, args, token] of [
        [
          'create_invoice_from_order',
          { order_id: input.order_id },
          createProposal.confirmation_token,
        ],
        ['validate_invoice', invoiceArgs, validateProposal.confirmation_token],
        ['send_invoice_dian', invoiceArgs, emitProposal.confirmation_token],
      ] as const)
        await expect(
          h.registry.executeToolResult(tool, args, {
            confirmationToken: String(token),
          }),
        ).rejects.toMatchObject({ errorCode: 'AI_AGENT_005' });
      expect(h.invoicing.invoiceFlowService.send).toHaveBeenCalledTimes(1);
      for (const finalPatch of [
        { fresh: false },
        { artifact: true },
        { complete: false },
        { after_step: 'create' },
        { resource_ids: { invoice_id: 999999 } },
      ])
        expect(
          verifyPlaybook('facturar-venta', input, [
            ...observations,
            orderVerified,
            { ...final, ...finalPatch },
          ]).verified,
        ).toBe(false);
      for (const status of [
        'unknown_effect',
        'pending_confirmation',
      ] as const) {
        expect(
          verifyPlaybook('facturar-venta', input, [
            created,
            validated,
            preflight,
            { ...emitted, status },
            orderVerified,
            final,
          ]).verified,
        ).toBe(false);
      }
    }));

  it('a fiscal preflight changed after proposal prevents emission without automatic retry', () =>
    scoped(async () => {
      h.state.invoice = {
        id: 900011,
        status: 'validated',
        invoice_number: 'SYNTHETIC-FV',
      };
      const args = { invoice_id: 900011 };
      const proposal = await h.propose('send_invoice_dian', args);
      h.invoicing.invoiceFlowService.getIssuerEmissionGate.mockResolvedValue({
        can_emit: false,
        vat_responsible: false,
        inc_responsible: false,
        tax_responsibilities: ['O-49'],
      });
      const result = await h.registry.executeToolResult(
        'send_invoice_dian',
        args,
        { confirmationToken: String(proposal.confirmation_token) },
      );
      expect(result.status).not.toBe('ok');
      expect(result.effect_status).not.toBe('applied');
      expect(h.invoicing.invoiceFlowService.send).not.toHaveBeenCalled();
    }));

  it('does not upgrade ambiguous legacy invoice results to applied based on fallback status/id', () =>
    scoped(async () => {
      h.state.invoice = { id: 900011, status: 'draft' };
      h.invoicing.invoiceFlowService.validate.mockResolvedValue({ id: 900011 });
      const args = { invoice_id: 900011 };
      const proposal = await h.propose('validate_invoice', args);
      const result = await h.registry.executeToolResult(
        'validate_invoice',
        args,
        { confirmationToken: String(proposal.confirmation_token) },
      );
      expect(result).toMatchObject({
        status: 'unknown_effect',
        effect_status: 'unknown',
      });
      expect(data(result.data)).toMatchObject({
        invoice_id: 900011,
        status: 'validated',
      });
      expect(data(result.data).applied).toBeUndefined();
    }));

  it.each([
    ['create_invoice_from_order', {}, 'missing create identity/status'],
    [
      'create_invoice_from_order',
      { id: 900011, status: 'draft', success: false },
      'contradictory create failure',
    ],
    [
      'create_invoice_from_order',
      { id: 900011, status: 'draft', order_id: 999999 },
      'different originating order',
    ],
    [
      'validate_invoice',
      { id: 999999, status: 'validated' },
      'different invoice identity',
    ],
    [
      'validate_invoice',
      { id: 900011, status: 'validated', error: 'domain refused' },
      'explicit validation error',
    ],
    [
      'send_invoice_dian',
      { id: 900011, status: 'rejected' },
      'fiscal rejection is not emission success',
    ],
    [
      'send_invoice_dian',
      { id: 900011 },
      'fallback sent display is not evidence',
    ],
    [
      'close_cash_session',
      {
        id: 900020,
        status: 'closed',
        actual_closing_amount: 105,
        expected_closing_amount: 100,
        difference: 999,
      },
      'inconsistent difference',
    ],
    [
      'close_cash_session',
      { id: 900020, status: 'closed' },
      'missing explicit count/difference',
    ],
    [
      'close_cash_session',
      {
        id: 999999,
        status: 'closed',
        actual_closing_amount: 105,
        expected_closing_amount: 100,
        difference: 5,
      },
      'different session identity',
    ],
  ] as const)('%s never claims applied for %s (%s)', (tool, response) =>
    scoped(async () => {
      const args: Data =
        tool === 'create_invoice_from_order'
          ? { order_id: 900010 }
          : tool === 'close_cash_session'
            ? { session_id: 900020, actual_closing_amount: 105 }
            : { invoice_id: 900011 };
      if (tool === 'create_invoice_from_order')
        h.invoicing.invoicingService.createFromOrder.mockResolvedValue({
          ...response,
        });
      if (tool === 'validate_invoice') {
        h.state.invoice = { id: 900011, status: 'draft' };
        h.invoicing.invoiceFlowService.validate.mockResolvedValue({
          ...response,
        });
      }
      if (tool === 'send_invoice_dian') {
        h.state.invoice = { id: 900011, status: 'validated' };
        h.invoicing.invoiceFlowService.send.mockResolvedValue({ ...response });
      }
      if (tool === 'close_cash_session')
        h.cash.sessionsService.closeSession.mockResolvedValue({
          ...response,
        } as typeof h.state.cash);
      const proposal = await h.propose(tool, args);
      const result = await h.registry.executeToolResult(tool, args, {
        confirmationToken: String(proposal.confirmation_token),
      });
      expect(result.status).not.toBe('ok');
      expect(result.effect_status).not.toBe('applied');
      expect(data(result.data).applied).toBeUndefined();
      expect(result.resource_ids).toEqual({});
    }),
  );

  it.each(PILOTS)(
    '%s exploration-operation reduction is a deterministic fixture proxy, NOT a measured baseline',
    (id) =>
      scoped(() => {
        const document = h.loader
          .getPlaybooks()
          .find((candidate) => candidate.id === id)!;
        // Explicit synthetic workload: rediscover API catalog + authorized tool
        // schemas before EACH business step, versus search + each relevant section.
        // Counters wrap real methods, not a claimed recorded LLM discovery trace.
        // Fresh opaque sessions model progressive turns with exact restored pins;
        // they do not evade the documented cumulative per-turn/active budget.
        const apiLookups = jest.spyOn(h.catalog, 'listFor');
        const toolLookups = jest.spyOn(h.registry, 'getAvailableDefinitions');
        for (const step of document.contract.steps) {
          expect(h.catalog.listFor(PERMISSIONS).length).toBeGreaterThan(0);
          expect(
            h.registry
              .getAvailableDefinitions(PERMISSIONS)
              .some((definition) => definition.function.name === step.tool),
          ).toBe(true);
        }
        const repeatedExplorationOperations =
          apiLookups.mock.calls.length + toolLookups.mock.calls.length;
        apiLookups.mockRestore();
        toolLookups.mockRestore();
        const search = jest.spyOn(h.service, 'search');
        const load = jest.spyOn(h.service, 'load');
        let session = h.session();
        const discovery = h.service.search(session, { query: id });
        expect(discovery).toHaveProperty('results');
        const loadedStepIds: string[] = [];
        for (const section of new Set(
          document.contract.steps.map((step) => step.section),
        )) {
          const loaded = h.service.load(session, {
            id,
            version: document.metadata.version,
            section,
          }) as LoadedPlaybook;
          expect(loaded.omitted_steps).toBe(0);
          expect(
            Buffer.byteLength(JSON.stringify(loaded), 'utf8'),
          ).toBeLessThanOrEqual(2000);
          loadedStepIds.push(...loaded.section.steps.map((step) => step.id));
          session = h.service.createSession({
            scope: SCOPE,
            authorizedDefinitions:
              h.registry.getAvailableDefinitions(PERMISSIONS),
            activePins: h.service.getActivePins(session),
          });
        }
        expect(new Set(loadedStepIds)).toEqual(
          new Set(document.contract.steps.map((step) => step.id)),
        );
        const playbookExplorationOperations =
          search.mock.calls.length + load.mock.calls.length;
        expect(
          (repeatedExplorationOperations - playbookExplorationOperations) /
            repeatedExplorationOperations,
        ).toBeGreaterThanOrEqual(0.3);
        expect(h.redis.set).not.toHaveBeenCalled();
      }),
  );

  it('loading actual release content prunes revoked fiscal writes instead of restoring permissions', () =>
    scoped(() => {
      const session = h.session();
      return scoped(
        () => {
          h.service.refreshAuthorization(
            session,
            h.registry.getAvailableDefinitions([
              'store:orders:read',
              'invoicing:read',
            ]),
          );
          const loaded = h.service.load(session, {
            id: 'facturar-venta',
            version: '1.0.0',
            section: 'steps',
          }) as LoadedPlaybook;
          expect(loaded.mode).toBe('preparation_only');
          expect(
            loaded.section.steps.some((step) =>
              [
                'create_invoice_from_order',
                'validate_invoice',
                'send_invoice_dian',
              ].includes(step.tool ?? ''),
            ),
          ).toBe(false);
          expect(loaded.gaps.join(' ')).toMatch(/tool_unavailable|permission/);
          expect(h.redis.set).not.toHaveBeenCalled();
        },
        { permissions: ['store:orders:read', 'invoicing:read'] },
      );
    }));
});
