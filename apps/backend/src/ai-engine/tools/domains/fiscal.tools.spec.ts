import { createFiscalTools, FiscalToolDeps } from './fiscal.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 6 track A — contrato F-14 / F-16 / F-18 (reads P0 fiscal-ops).
 *
 * Patrón canónico T4: (a) happy/sad con sad sin tocar deps, (b) snapshot de
 * salida con literales (`toEqual`, sin `.snap`), (c) forma
 * `{error, next_step}` en ES en los fallos guiados, (d) permiso declarado por
 * tool, (e) `readOnly: true` en los 3 reads sin `requiresConfirmation`.
 *
 * Pinnea además el contrato fiscal: toda lectura filtra por
 * `accounting_entity_id` resuelto vía `FiscalScopeService` (nunca sólo
 * `store_id`), y el draft llega con líneas agrupadas por familia fiscal
 * (iva/inc/withholding/ica) derivada del prefijo de `line_type`.
 */
describe('fiscal.tools · F-14 get_fiscal_overview / F-16 list_fiscal_obligations / F-18 get_declaration_draft', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const FISCAL_CTX = {
    organization_id: 3,
    store_id: 7,
    fiscal_scope: 'STORE',
    operating_scope: 'STORE',
    accounting_entity_id: 55,
    accounting_entity: {
      id: 55,
      name: 'Tienda Centro',
      legal_name: 'Tienda Centro SAS',
      tax_id: '900123456',
    },
  };

  const ENTITY_TAG = {
    id: 55,
    name: 'Tienda Centro SAS',
    tax_id: '900123456',
    fiscal_scope: 'STORE',
  };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      contextResolver: {
        resolveForStore: jest.fn().mockResolvedValue(FISCAL_CTX),
      },
      obligationsService: {
        getOverview: jest.fn(),
        list: jest.fn(),
      },
      declarationsService: {
        findOne: jest.fn(),
      },
      fiscalScopeService: {
        findFiscalAccountingEntityId: jest.fn().mockResolvedValue(55),
      },
      ...overrides,
    } as any;
    const tools = createFiscalTools(deps as FiscalToolDeps);
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

  describe('registro', () => {
    it('expone exactamente los 3 reads P0 del dominio fiscal', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'get_fiscal_overview',
        'list_fiscal_obligations',
        'get_declaration_draft',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('fiscal');
        expect(tool.version).toBe('1');
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation).toBeUndefined();
        expect(tool.preview).toBeUndefined();
        expect(tool.clientSide).toBeUndefined();
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('declara un permiso de lectura distinto por tool', () => {
      const { tools } = buildTools();
      expect(getTool(tools, 'get_fiscal_overview').requiredPermissions).toEqual(
        ['store:fiscal:dashboard:read'],
      );
      expect(
        getTool(tools, 'list_fiscal_obligations').requiredPermissions,
      ).toEqual(['store:fiscal:obligations:read']);
      expect(
        getTool(tools, 'get_declaration_draft').requiredPermissions,
      ).toEqual(['store:fiscal:declarations:read']);
    });

    it('declara requeridos y enums del JSON Schema', () => {
      const { tools } = buildTools();
      expect(
        getTool(tools, 'get_declaration_draft').parameters.required,
      ).toEqual(['draft_id']);
      const obligations = getTool(tools, 'list_fiscal_obligations').parameters;
      expect(obligations.properties.type.enum).toContain('vat_return');
      expect(obligations.properties.type.enum).toContain('withholding_return');
      expect(obligations.properties.status.enum).toContain('overdue');
      expect(obligations.properties.status.enum).toContain('pending');
    });
  });

  describe('resolución fiscal fail-closed', () => {
    it('sin tienda → {error, next_step} y cero llamadas a services', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'get_fiscal_overview',
        {},
        { organization_id: 3 },
      );

      expect(answer.error).toContain('Sin tienda en contexto');
      expect(answer.next_step).toBeDefined();
      expect(deps.contextResolver.resolveForStore).not.toHaveBeenCalled();
      expect(
        deps.fiscalScopeService.findFiscalAccountingEntityId,
      ).not.toHaveBeenCalled();
      expect(deps.obligationsService.getOverview).not.toHaveBeenCalled();
    });

    it('entidad FiscalScope ≠ contexto → error y el service jamás se llama', async () => {
      const { deps, tools } = buildTools({
        fiscalScopeService: {
          findFiscalAccountingEntityId: jest.fn().mockResolvedValue(999),
        },
      });

      const answer = await run(tools, 'get_fiscal_overview', {});

      expect(answer.error).toContain('no coincide');
      expect(deps.obligationsService.getOverview).not.toHaveBeenCalled();
    });

    it('sin entidad fiscal → error con CTA a configuración, sin cifras', async () => {
      const { deps, tools } = buildTools({
        fiscalScopeService: {
          findFiscalAccountingEntityId: jest.fn().mockResolvedValue(null),
        },
      });

      const answer = await run(tools, 'list_fiscal_obligations', {});

      expect(answer.error).toContain('no tiene entidad contable fiscal');
      expect(answer.next_step).toContain('configuración fiscal');
      expect(deps.obligationsService.list).not.toHaveBeenCalled();
    });
  });

  describe('get_fiscal_overview (F-14)', () => {
    const OVERVIEW = {
      stats: {
        upcoming: 2,
        overdue: 1,
        declarations_ready: 1,
        blocked: 0,
        rejected_documents: 0,
        open_close_sessions: 1,
        estimated_amount: 1250000,
        final_amount: 890000,
      },
      next_obligations: [
        {
          id: 31,
          type: 'vat_return',
          status: 'pending',
          period_year: 2026,
          period_month: 7,
          due_date: new Date('2026-09-20'),
          estimated_amount: 850000,
          final_amount: 0,
        },
        {
          id: 32,
          type: 'withholding_return',
          status: 'overdue',
          period_year: 2026,
          period_month: 8,
          due_date: new Date('2026-09-10'),
          estimated_amount: 400000,
          final_amount: 0,
        },
      ],
    };

    it('(b) happy: snapshot exacto etiquetado con el NIT', async () => {
      const { deps, tools } = buildTools();
      deps.obligationsService.getOverview.mockResolvedValue(OVERVIEW);

      const answer = await run(tools, 'get_fiscal_overview', {});

      expect(
        deps.fiscalScopeService.findFiscalAccountingEntityId,
      ).toHaveBeenCalledWith({ organization_id: 3, store_id: 7 });
      expect(deps.obligationsService.getOverview).toHaveBeenCalledWith([
        FISCAL_CTX,
      ]);
      expect(answer).toEqual({
        accounting_entity: ENTITY_TAG,
        stats: {
          upcoming: 2,
          overdue: 1,
          declarations_ready: 1,
          blocked: 0,
          rejected_documents: 0,
          open_close_sessions: 1,
          estimated_amount: 1250000,
          final_amount: 890000,
        },
        next_obligations: [
          {
            id: 31,
            type: 'vat_return',
            status: 'pending',
            period_year: 2026,
            period_month: 7,
            due_date: '2026-09-20',
            estimated_amount: 850000,
            final_amount: 0,
          },
          {
            id: 32,
            type: 'withholding_return',
            status: 'overdue',
            period_year: 2026,
            period_month: 8,
            due_date: '2026-09-10',
            estimated_amount: 400000,
            final_amount: 0,
          },
        ],
      });
    });
  });

  describe('list_fiscal_obligations (F-16)', () => {
    const OBLIGATION = {
      id: 31,
      type: 'vat_return',
      status: 'pending',
      period_year: 2026,
      period_month: 7,
      period_start: new Date('2026-07-01'),
      period_end: new Date('2026-08-31'),
      due_date: new Date('2026-09-20'),
      estimated_amount: 850000,
      final_amount: 0,
      blocking_reason: null,
    };

    it('(b) happy: filtra por accounting_entity_id del NIT, no solo store', async () => {
      const { deps, tools } = buildTools();
      deps.obligationsService.list.mockResolvedValue({
        data: [OBLIGATION],
        total: 1,
        page: 1,
        limit: 25,
      });

      const answer = await run(tools, 'list_fiscal_obligations', {
        type: 'vat_return',
        status: 'pending',
      });

      expect(deps.obligationsService.list).toHaveBeenCalledWith(
        [FISCAL_CTX],
        expect.objectContaining({
          accounting_entity_id: 55,
          type: 'vat_return',
          status: 'pending',
        }),
      );
      expect(answer).toEqual({
        accounting_entity: ENTITY_TAG,
        summary: '1 obligación(es) fiscal(es) del NIT',
        filters: {
          type: 'vat_return',
          status: 'pending',
          period_year: null,
          period_month: null,
        },
        obligations: [
          {
            id: 31,
            type: 'vat_return',
            status: 'pending',
            period_year: 2026,
            period_month: 7,
            period_start: '2026-07-01',
            period_end: '2026-08-31',
            due_date: '2026-09-20',
            estimated_amount: 850000,
            final_amount: 0,
            blocking_reason: null,
          },
        ],
        page: 1,
        limit: 25,
        total_matching: 1,
      });
    });

    it('(a) sad: type inválido → {error, next_step} y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'list_fiscal_obligations', {
        type: 'iva_trimestral',
      });

      expect(answer.error).toContain('type "iva_trimestral" inválido');
      expect(answer.next_step).toBeDefined();
      expect(deps.contextResolver.resolveForStore).not.toHaveBeenCalled();
      expect(deps.obligationsService.list).not.toHaveBeenCalled();
    });

    it('(a) sad: status inválido → {error, next_step} y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'list_fiscal_obligations', {
        status: 'casi_lista',
      });

      expect(answer.error).toContain('status "casi_lista" inválido');
      expect(deps.obligationsService.list).not.toHaveBeenCalled();
    });
  });

  describe('get_declaration_draft (F-18)', () => {
    const DRAFT = {
      id: 12,
      declaration_type: 'vat',
      status: 'ready',
      obligation_id: 31,
      period_year: 2026,
      period_month: null,
      period_start: new Date('2026-07-01'),
      period_end: new Date('2026-08-31'),
      gross_base_amount: 10000000,
      taxable_base_amount: 9500000,
      exempt_amount: 500000,
      excluded_amount: 0,
      generated_tax_amount: 1805000,
      deductible_tax_amount: 380000,
      withholding_amount: 95000,
      balance_due: 1330000,
      balance_favor: 0,
      total_payable: 1330000,
      lines: [
        {
          id: 101,
          line_type: 'vat_generated',
          concept_code: null,
          description: 'IVA generado ventas 19%',
          base_amount: 9000000,
          tax_amount: 1710000,
          withholding_amount: 0,
          third_party_name: null,
          third_party_tax_id: null,
        },
        {
          id: 102,
          line_type: 'vat_deductible',
          concept_code: null,
          description: 'IVA descontable compras',
          base_amount: 2000000,
          tax_amount: 380000,
          withholding_amount: 0,
          third_party_name: null,
          third_party_tax_id: null,
        },
        {
          id: 103,
          line_type: 'inc_generated',
          concept_code: null,
          description: 'INC restaurante 8%',
          base_amount: 500000,
          tax_amount: 40000,
          withholding_amount: 0,
          third_party_name: null,
          third_party_tax_id: null,
        },
        {
          id: 104,
          line_type: 'withholding_suffered_credit',
          concept_code: 'RTE_COMPRAS',
          description: 'Rete sufrida cliente agente 2.5%',
          base_amount: 3800000,
          tax_amount: 0,
          withholding_amount: 95000,
          third_party_name: 'Cliente Agente SAS',
          third_party_tax_id: '900999111',
        },
      ],
    };

    it('(b) happy: draft con líneas por familia fiscal + NIT resuelto', async () => {
      const { deps, tools } = buildTools();
      deps.declarationsService.findOne.mockResolvedValue(DRAFT);

      const answer = await run(tools, 'get_declaration_draft', {
        draft_id: 12,
      });

      expect(deps.declarationsService.findOne).toHaveBeenCalledWith(
        [FISCAL_CTX],
        12,
      );
      expect(
        deps.fiscalScopeService.findFiscalAccountingEntityId,
      ).toHaveBeenCalledWith({ organization_id: 3, store_id: 7 });
      expect(answer.accounting_entity).toEqual(ENTITY_TAG);
      expect(answer.draft.id).toBe(12);
      expect(answer.draft.declaration_type).toBe('vat');
      expect(answer.draft.status).toBe('ready');
      expect(answer.draft.totals).toEqual({
        gross_base_amount: 10000000,
        taxable_base_amount: 9500000,
        exempt_amount: 500000,
        excluded_amount: 0,
        generated_tax_amount: 1805000,
        deductible_tax_amount: 380000,
        withholding_amount: 95000,
        balance_due: 1330000,
        balance_favor: 0,
        total_payable: 1330000,
      });
      // IVA agrupa generado + descontable; INC y rete van por separado.
      expect(answer.draft.lines_by_tax_type).toEqual({
        iva: { count: 2, base_amount: 11000000, tax_amount: 2090000 },
        inc: { count: 1, base_amount: 500000, tax_amount: 40000 },
        withholding: { count: 1, base_amount: 3800000, tax_amount: 95000 },
        ica: { count: 0, base_amount: 0, tax_amount: 0 },
        other: { count: 0, base_amount: 0, tax_amount: 0 },
      });
      expect(
        answer.draft.lines.map((l: any) => [l.line_type, l.tax_family]),
      ).toEqual([
        ['vat_generated', 'iva'],
        ['vat_deductible', 'iva'],
        ['inc_generated', 'inc'],
        ['withholding_suffered_credit', 'withholding'],
      ]);
      expect(answer.draft.lines[3].third_party_tax_id).toBe('900999111');
      expect(answer.draft.lines_count).toBe(4);
    });

    it('(a) sad: draft_id inválido → {error, next_step} y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'get_declaration_draft', {
        draft_id: 0,
      });

      expect(answer.error).toContain('draft_id inválido');
      expect(answer.next_step).toContain('list_fiscal_obligations');
      expect(deps.contextResolver.resolveForStore).not.toHaveBeenCalled();
      expect(deps.declarationsService.findOne).not.toHaveBeenCalled();
    });
  });
});
