import {
  createFinanceOpsTools,
  FinanceOpsToolDeps,
} from './finance-ops.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 12 track B — contrato F-95..F-100 finance-ops (4 reads + 2 writes).
 *
 * Patrón canónico T4: (a) happy/sad con sad sin tocar deps, (b) snapshot de
 * salida con literales (`toEqual`, sin `.snap`), (c) forma
 * `{error, next_step}` en ES en los fallos guiados, (d) permiso declarado por
 * tool, (e) `readOnly: true` en reads y `requiresConfirmation` + `preview`
 * con sujeto humano en writes, con re-verificación en el handler.
 *
 * Pinnea además el contrato finance-ops: cadenas run_depreciation←F-95 y
 * auto_match_bank←F-98, wrappers finos sobre services (ninguna lectura
 * directa a la base en tools) y permisos verificados en controllers contables.
 */
describe('finance-ops.tools · F-95..F-100', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const ASSETS_PAGE = {
    data: [
      {
        id: 1,
        asset_number: 'AF-001',
        name: 'Computador oficina',
        status: 'active',
        acquisition_cost: 2500000,
        accumulated_depreciation: 500000,
        book_value: 2000000,
      },
      {
        id: 2,
        asset_number: 'AF-002',
        name: 'Impresora',
        status: 'active',
        acquisition_cost: 800000,
        accumulated_depreciation: 800000,
        book_value: 0,
      },
    ],
    meta: { total: 2, page: 1, limit: 20, total_pages: 1 },
  };

  const VARIANCE_REPORT = {
    budget: { id: 5, name: 'Presupuesto 2026', fiscal_period_id: 2 },
    month: 3,
    lines: [
      {
        account_id: 101,
        account_code: '4135',
        budgeted: 10000000,
        actual: 8200000,
        variance: 1800000,
        variance_pct: 18,
      },
    ],
  };

  const RECONCILIATION = {
    id: 9,
    bank_account_id: 4,
    bank_account: { id: 4, name: 'Bancolombia *1234' },
    status: 'draft',
    statement_balance: 5000000,
    book_balance: 4950000,
  };

  const SESSION = {
    id: 3,
    status: 'in_progress',
    fiscal_period: { id: 2, name: '2026-03' },
    adjustments: [{ id: 1, debit: 100000, credit: 100000 }],
    _count: { adjustments: 1, intercompany_txns: 2 },
    created_at: '2026-03-10T00:00:00.000Z',
    created_by: { id: 11, first_name: 'Ana', last_name: 'Caja' },
  };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      fixedAssetsService: {
        findAll: jest.fn().mockResolvedValue(ASSETS_PAGE),
        runMonthlyDepreciation: jest.fn().mockResolvedValue({
          processed: 2,
          skipped: 0,
          total_amount: 120000,
          results: [
            { asset_id: 1, asset_number: 'AF-001', amount: 100000 },
            { asset_id: 2, asset_number: 'AF-002', amount: 20000 },
          ],
        }),
      },
      budgetVarianceService: {
        getVarianceReport: jest.fn().mockResolvedValue(VARIANCE_REPORT),
      },
      reconciliationService: {
        findAll: jest.fn().mockResolvedValue({ data: [RECONCILIATION] }),
        findOne: jest.fn().mockResolvedValue(RECONCILIATION),
      },
      reconciliationMatchingService: {
        autoMatch: jest.fn().mockResolvedValue({
          total_matched: 4,
          exact_matches: 3,
          amount_date_matches: 1,
          approximate_matches: 0,
          details: [],
        }),
      },
      consolidationService: {
        findOneSession: jest.fn().mockResolvedValue(SESSION),
        findAllSessions: jest.fn().mockResolvedValue({
          data: [SESSION],
          meta: { total: 1, page: 1, limit: 5, total_pages: 1 },
        }),
      },
      ...overrides,
    } as any;
    const tools = createFinanceOpsTools(deps as FinanceOpsToolDeps);
    return { deps, tools };
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = CONTEXT,
  ) => JSON.parse(await getTool(tools, name).handler!(args, context as any));

  const preview = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = CONTEXT,
  ) => {
    const tool = getTool(tools, name);
    if (!tool.preview) throw new Error(`${name} sin preview`);
    return tool.preview(args, context as any);
  };

  describe('registro', () => {
    it('expone exactamente las 6 tools finance-ops', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'list_fixed_assets',
        'run_depreciation',
        'get_budget_variance',
        'list_reconciliations',
        'auto_match_bank',
        'get_consolidation_status',
      ]);
    });

    it('declara version 1 y dominio en las 6', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.version).toBe('1');
        expect(tool.domain).toBe('finance-ops');
        expect(tool.clientSide).toBeUndefined();
      }
    });

    it('los reads son readOnly y los writes exigen confirmación con preview', () => {
      const { tools } = buildTools();
      for (const name of [
        'list_fixed_assets',
        'get_budget_variance',
        'list_reconciliations',
        'get_consolidation_status',
      ]) {
        const tool = getTool(tools, name);
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation).toBeUndefined();
      }
      for (const name of ['run_depreciation', 'auto_match_bank']) {
        const tool = getTool(tools, name);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
        expect(tool.readOnly).toBeUndefined();
      }
    });

    it('declara los permisos verificados en controllers', () => {
      const { tools } = buildTools();
      const perms = Object.fromEntries(
        tools.map((t) => [t.name, t.requiredPermissions]),
      );
      expect(perms).toEqual({
        list_fixed_assets: ['store:accounting:fixed_assets:read'],
        run_depreciation: ['store:accounting:fixed_assets:write'],
        get_budget_variance: ['store:accounting:budgets:read'],
        list_reconciliations: ['store:accounting:bank_reconciliation:read'],
        auto_match_bank: ['store:accounting:bank_reconciliation:update'],
        get_consolidation_status: ['store:accounting:consolidation:read'],
      });
    });
  });

  describe('F-95 list_fixed_assets', () => {
    it('happy: devuelve la página con defaults de paginación', async () => {
      const { tools, deps } = buildTools();
      expect(await run(tools, 'list_fixed_assets', {})).toEqual(ASSETS_PAGE);
      expect(deps.fixedAssetsService.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
      });
    });

    it('happy: pasa filtros y clamp de limit', async () => {
      const { tools, deps } = buildTools();
      await run(tools, 'list_fixed_assets', {
        search: 'AF-',
        status: 'active',
        category_id: 3,
        page: 2,
        limit: 500,
      });
      expect(deps.fixedAssetsService.findAll).toHaveBeenCalledWith({
        page: 2,
        limit: 100,
        search: 'AF-',
        status: 'active',
        category_id: 3,
      });
    });

    it('sad: el service lanza → {error}', async () => {
      const { tools } = buildTools({
        fixedAssetsService: {
          findAll: jest.fn().mockRejectedValue(new Error('DB_DOWN')),
        },
      });
      const out = await run(tools, 'list_fixed_assets', {});
      expect(out).toEqual({ error: 'DB_DOWN' });
    });
  });

  describe('F-96 run_depreciation', () => {
    it('preview: warning con periodo y activos (cadena F-95)', async () => {
      const { tools, deps } = buildTools();
      const out = await preview(tools, 'run_depreciation', {
        year: 2026,
        month: 3,
      });
      expect(out).toEqual({
        status: 'warning',
        target: 'Depreciación 2026-03 — 2 activo(s)',
        changes: [
          {
            field: 'period',
            label: 'Periodo',
            from: null,
            to: '2026-03',
          },
          {
            field: 'assets',
            label: 'Activos a depreciar',
            from: 0,
            to: 2,
          },
        ],
        message:
          'Se deprecian: AF-001, AF-002. Los periodos ya corridos se omiten sin duplicar.',
        domain: 'finance-ops',
      });
      expect(deps.fixedAssetsService.findAll).toHaveBeenCalledWith({
        status: 'active',
        page: 1,
        limit: 100,
      });
      expect(
        deps.fixedAssetsService.runMonthlyDepreciation,
      ).not.toHaveBeenCalled();
    });

    it('happy: corre el periodo y devuelve resultados', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'run_depreciation', {
        year: 2026,
        month: 3,
      });
      expect(
        deps.fixedAssetsService.runMonthlyDepreciation,
      ).toHaveBeenCalledWith({ year: 2026, month: 3 });
      expect(out).toEqual({
        processed: 2,
        skipped: 0,
        total_amount: 120000,
        results: [
          { asset_id: 1, asset_number: 'AF-001', amount: 100000 },
          { asset_id: 2, asset_number: 'AF-002', amount: 20000 },
        ],
        period: { year: 2026, month: 3 },
      });
    });

    it('sad: periodo inválido → preview error sin leer activos', async () => {
      const { tools, deps } = buildTools();
      const out = await preview(tools, 'run_depreciation', {
        year: 2026,
        month: 13,
      });
      expect(out.status).toBe('error');
      expect(out.message).toMatch('1 y 12');
      expect(deps.fixedAssetsService.findAll).not.toHaveBeenCalled();
    });

    it('sad: sin activos activos → preview error', async () => {
      const { tools } = buildTools({
        fixedAssetsService: {
          findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
          runMonthlyDepreciation: jest.fn(),
        },
      });
      const out = await preview(tools, 'run_depreciation', {
        year: 2026,
        month: 3,
      });
      expect(out.status).toBe('error');
      expect(out.message).toMatch('No hay activos activos');
    });
  });

  describe('F-97 get_budget_variance', () => {
    it('happy: devuelve el reporte del mes', async () => {
      const { tools, deps } = buildTools();
      expect(
        await run(tools, 'get_budget_variance', {
          budget_id: 5,
          month: 3,
        }),
      ).toEqual(VARIANCE_REPORT);
      expect(deps.budgetVarianceService.getVarianceReport).toHaveBeenCalledWith(
        5,
        3,
      );
    });

    it('happy: sin month pide el acumulado (undefined)', async () => {
      const { tools, deps } = buildTools();
      await run(tools, 'get_budget_variance', { budget_id: 5 });
      expect(deps.budgetVarianceService.getVarianceReport).toHaveBeenCalledWith(
        5,
        undefined,
      );
    });

    it('sad: budget_id inválido → {error, next_step} sin tocar deps', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'get_budget_variance', {
        budget_id: 'xx',
      });
      expect(out.error).toMatch('budget_id');
      expect(out.next_step).toMatch('numérico');
      expect(
        deps.budgetVarianceService.getVarianceReport,
      ).not.toHaveBeenCalled();
    });

    it('sad: month inválido → {error, next_step}', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'get_budget_variance', {
        budget_id: 5,
        month: 0,
      });
      expect(out.error).toMatch('month');
      expect(
        deps.budgetVarianceService.getVarianceReport,
      ).not.toHaveBeenCalled();
    });
  });

  describe('F-98 list_reconciliations', () => {
    it('happy: lista con filtros opcionales', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'list_reconciliations', {
        bank_account_id: 4,
        status: 'draft',
      });
      expect(out).toEqual({ data: [RECONCILIATION] });
      expect(deps.reconciliationService.findAll).toHaveBeenCalledWith({
        bank_account_id: 4,
        status: 'draft',
      });
    });

    it('happy: sin filtros pasa query vacía', async () => {
      const { tools, deps } = buildTools();
      await run(tools, 'list_reconciliations', {});
      expect(deps.reconciliationService.findAll).toHaveBeenCalledWith({});
    });

    it('sad: el service lanza → {error}', async () => {
      const { tools } = buildTools({
        reconciliationService: {
          findAll: jest.fn().mockRejectedValue(new Error('DB_DOWN')),
        },
      });
      const out = await run(tools, 'list_reconciliations', {});
      expect(out).toEqual({ error: 'DB_DOWN' });
    });
  });

  describe('F-99 auto_match_bank', () => {
    it('preview: nombra la conciliación y la cuenta (cadena F-98)', async () => {
      const { tools } = buildTools();
      const out = await preview(tools, 'auto_match_bank', {
        reconciliation_id: 9,
      });
      expect(out).toEqual({
        status: 'ok',
        target: 'Conciliación #9 — Bancolombia *1234',
        changes: [
          {
            field: 'auto_match',
            label: 'Cruce automático',
            from: 'pendiente',
            to: 'ejecutado',
          },
        ],
        domain: 'finance-ops',
      });
    });

    it('happy: re-verifica no-completada y cruza', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'auto_match_bank', {
        reconciliation_id: 9,
      });
      expect(deps.reconciliationService.findOne).toHaveBeenCalledWith(9);
      expect(deps.reconciliationMatchingService.autoMatch).toHaveBeenCalledWith(
        9,
      );
      expect(out).toEqual({
        matched: true,
        reconciliation_id: 9,
        total_matched: 4,
        exact_matches: 3,
        amount_date_matches: 1,
        approximate_matches: 0,
        details: [],
      });
    });

    it('sad: conciliación completed → preview error y handler {error, next_step}', async () => {
      const { tools, deps } = buildTools({
        reconciliationService: {
          findAll: jest.fn(),
          findOne: jest
            .fn()
            .mockResolvedValue({ ...RECONCILIATION, status: 'completed' }),
        },
        reconciliationMatchingService: { autoMatch: jest.fn() },
      });
      const p = await preview(tools, 'auto_match_bank', {
        reconciliation_id: 9,
      });
      expect(p.status).toBe('error');
      expect(p.message).toMatch('completada');
      const out = await run(tools, 'auto_match_bank', {
        reconciliation_id: 9,
      });
      expect(out.error).toMatch('completada');
      expect(out.next_step).toMatch('F-98');
      expect(deps.reconciliationMatchingService.autoMatch).not.toHaveBeenCalled();
    });

    it('sad: id inválido → preview error sin leer', async () => {
      const { tools, deps } = buildTools();
      const out = await preview(tools, 'auto_match_bank', {
        reconciliation_id: -1,
      });
      expect(out.status).toBe('error');
      expect(deps.reconciliationService.findOne).not.toHaveBeenCalled();
    });
  });

  describe('F-100 get_consolidation_status', () => {
    it('happy: con session_id detalla la sesión', async () => {
      const { tools, deps } = buildTools();
      expect(
        await run(tools, 'get_consolidation_status', { session_id: 3 }),
      ).toEqual({
        session: {
          id: 3,
          status: 'in_progress',
          fiscal_period: { id: 2, name: '2026-03' },
          adjustments_count: 1,
          intercompany_count: 2,
          adjustments: [{ id: 1, debit: 100000, credit: 100000 }],
          created_at: '2026-03-10T00:00:00.000Z',
          created_by: { id: 11, first_name: 'Ana', last_name: 'Caja' },
        },
      });
      expect(deps.consolidationService.findOneSession).toHaveBeenCalledWith(3);
      expect(
        deps.consolidationService.findAllSessions,
      ).not.toHaveBeenCalled();
    });

    it('happy: sin session_id lista las recientes proyectadas', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'get_consolidation_status', {
        status: 'in_progress',
      });
      expect(out).toEqual({
        sessions: [
          {
            id: 3,
            status: 'in_progress',
            fiscal_period: { id: 2, name: '2026-03' },
            adjustments_count: 1,
            intercompany_count: 2,
            created_at: '2026-03-10T00:00:00.000Z',
            created_by: { id: 11, first_name: 'Ana', last_name: 'Caja' },
          },
        ],
        meta: { total: 1, page: 1, limit: 5, total_pages: 1 },
      });
      expect(deps.consolidationService.findAllSessions).toHaveBeenCalledWith({
        status: 'in_progress',
        page: 1,
        limit: 5,
      });
    });

    it('sad: status desconocido → {error, next_step} sin tocar deps', async () => {
      const { tools, deps } = buildTools();
      const out = await run(tools, 'get_consolidation_status', {
        status: 'cerrada',
      });
      expect(out.error).toMatch('cerrada');
      expect(out.next_step).toMatch('draft');
      expect(deps.consolidationService.findAllSessions).not.toHaveBeenCalled();
    });

    it('sad: el service lanza → {error}', async () => {
      const { tools } = buildTools({
        consolidationService: {
          findOneSession: jest
            .fn()
            .mockRejectedValue(new Error('MULTI_STORE_ONLY')),
        },
      });
      const out = await run(tools, 'get_consolidation_status', {
        session_id: 3,
      });
      expect(out).toEqual({ error: 'MULTI_STORE_ONLY' });
    });
  });
});
