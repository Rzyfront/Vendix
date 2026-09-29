import { RequestContextService } from '@common/context/request-context.service';
import { createFiscalTools, FiscalToolDeps } from './fiscal.tools';
import { AIToolRegistry } from '../ai-tool-registry';
import { RegisteredTool } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';

/**
 * Paso 6 track A — contrato F-14 / F-16 / F-18 (reads P0 fiscal-ops).
 * Paso 11 track A — contrato F-15, F-17, F-19..F-27 (writes + P1 fiscal-ops).
 *
 * Patrón canónico T4: (a) happy/sad con sad sin tocar deps, (b) snapshot de
 * salida con literales (`toEqual`, sin `.snap`), (c) forma
 * `{error, next_step}` en ES en los fallos guiados, (d) permiso declarado por
 * tool, (e) `readOnly: true` en los 7 reads sin `requiresConfirmation`,
 * `requiresConfirmation: true` + `preview` con sujeto humano en los 7 writes,
 * con re-verificación en handler.
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
        findOne: jest.fn(),
        generateForContext: jest.fn(),
      },
      declarationsService: {
        findOne: jest.fn(),
        createDraft: jest.fn(),
        recalculateDraft: jest.fn(),
        approveDraft: jest.fn(),
        markSubmitted: jest.fn(),
      },
      fiscalScopeService: {
        findFiscalAccountingEntityId: jest.fn().mockResolvedValue(55),
      },
      flowStateService: {
        getFlowState: jest.fn(),
      },
      closeService: {
        list: jest.fn(),
        findOne: jest.fn(),
        runChecks: jest.fn(),
        close: jest.fn(),
      },
      checklistService: {
        build: jest.fn(),
      },
      invoicesService: {
        findAll: jest.fn(),
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

  const FISCAL_WRITES = [
    'generate_fiscal_obligations',
    'create_declaration_draft',
    'recalculate_declaration',
    'approve_declaration',
    'mark_declaration_submitted',
    'run_close_checks',
    'close_fiscal_session',
  ];

  const FISCAL_READS_P1 = [
    'get_fiscal_flow_state',
    'list_close_sessions',
    'get_fiscal_checklist',
    'list_invoices',
  ];

  describe('registro', () => {
    it('expone exactamente los 14 tools del dominio fiscal (7 reads + 7 writes)', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'get_fiscal_overview',
        'list_fiscal_obligations',
        'get_declaration_draft',
        'get_fiscal_flow_state',
        'generate_fiscal_obligations',
        'create_declaration_draft',
        'recalculate_declaration',
        'approve_declaration',
        'mark_declaration_submitted',
        'list_close_sessions',
        'run_close_checks',
        'close_fiscal_session',
        'get_fiscal_checklist',
        'list_invoices',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('fiscal');
        expect(tool.version).toBe('1');
        expect(tool.clientSide).toBeUndefined();
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('(e) los 7 writes exigen confirmación + preview, sin readOnly', () => {
      const { tools } = buildTools();
      for (const name of FISCAL_WRITES) {
        const tool = getTool(tools, name);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
        expect(tool.readOnly).toBeUndefined();
      }
    });

    it('(e) los 4 reads P1 son readOnly puros', () => {
      const { tools } = buildTools();
      for (const name of FISCAL_READS_P1) {
        const tool = getTool(tools, name);
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation).toBeUndefined();
        expect(tool.preview).toBeUndefined();
      }
    });

    it('(d) cada tool P1 declara el permiso de su ruta HTTP dueña', () => {
      const { tools } = buildTools();
      const expected: Record<string, string> = {
        get_fiscal_flow_state: 'store:fiscal:dashboard:read',
        generate_fiscal_obligations: 'store:fiscal:obligations:write',
        create_declaration_draft: 'store:fiscal:declarations:write',
        recalculate_declaration: 'store:fiscal:declarations:write',
        approve_declaration: 'store:fiscal:declarations:write',
        mark_declaration_submitted: 'store:fiscal:declarations:write',
        list_close_sessions: 'store:fiscal:close:read',
        run_close_checks: 'store:fiscal:close:write',
        close_fiscal_session: 'store:fiscal:close:write',
        get_fiscal_checklist: 'store:fiscal:dashboard:read',
        list_invoices: 'invoicing:read',
      };
      for (const [name, perm] of Object.entries(expected)) {
        expect(getTool(tools, name).requiredPermissions).toEqual([perm]);
      }
    });

    it('cada write cita su read habilitante en la descripción', () => {
      const { tools } = buildTools();
      const expected: Record<string, string[]> = {
        generate_fiscal_obligations: ['F-16'],
        create_declaration_draft: ['F-16', 'F-18'],
        recalculate_declaration: ['F-18'],
        approve_declaration: ['F-18'],
        mark_declaration_submitted: ['F-18'],
        run_close_checks: ['F-23', 'F-26'],
        close_fiscal_session: ['F-23', 'F-26', 'F-24'],
      };
      for (const [name, markers] of Object.entries(expected)) {
        const description = getTool(tools, name).description;
        for (const marker of markers) {
          expect(description).toContain(marker);
        }
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

  describe('get_fiscal_flow_state (F-15)', () => {
    const STATE = {
      period: {
        year: 2026,
        month: 7,
        start_date: '2026-07-01T00:00:00.000Z',
        end_date: '2026-07-31T23:59:59.999Z',
      },
      flows: {
        sales: {
          stages: [
            {
              key: 'invoiced',
              label: 'Facturado',
              status: 'ok',
              counts: { documents: 40 },
            },
          ],
        },
        purchases: { stages: [] },
        payroll: { stages: [] },
      },
      convergence: {
        journal: {
          key: 'journal',
          label: 'Asientos',
          status: 'warning',
          counts: { draft: 3 },
          detail: '3 asientos en borrador',
        },
        declarations: {
          key: 'declarations',
          label: 'Declaraciones',
          status: 'ok',
          counts: { ready: 1 },
        },
        obligations: {
          key: 'obligations',
          label: 'Obligaciones',
          status: 'ok',
          counts: { pending: 2 },
        },
        close: {
          key: 'close',
          label: 'Cierre',
          status: 'pending',
          counts: {},
        },
      },
    };

    it('(b) happy: pasa periodo + flujos + convergencia con el NIT', async () => {
      const { deps, tools } = buildTools();
      deps.flowStateService.getFlowState.mockResolvedValue(STATE);

      const answer = await run(tools, 'get_fiscal_flow_state', {
        year: 2026,
        month: 7,
      });

      expect(deps.flowStateService.getFlowState).toHaveBeenCalledWith(
        [FISCAL_CTX],
        { year: 2026, month: 7 },
      );
      expect(answer).toEqual({
        accounting_entity: ENTITY_TAG,
        period: STATE.period,
        flows: STATE.flows,
        convergence: STATE.convergence,
      });
    });

    it('(a) sad: month inválido → {error, next_step} y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'get_fiscal_flow_state', {
        year: 2026,
        month: 13,
      });

      expect(answer.error).toContain('month inválido');
      expect(deps.contextResolver.resolveForStore).not.toHaveBeenCalled();
      expect(deps.flowStateService.getFlowState).not.toHaveBeenCalled();
    });
  });

  describe('generate_fiscal_obligations (F-17)', () => {
    it('(b) preview + handler happy con tipos explícitos', async () => {
      const { deps, tools } = buildTools();
      deps.obligationsService.generateForContext.mockResolvedValue([
        {
          id: 31,
          type: 'vat_return',
          status: 'pending',
          period_year: 2026,
          period_month: 7,
          due_date: new Date('2026-09-20'),
        },
      ]);
      const args = {
        period_year: 2026,
        period_month: 7,
        types: ['vat_return'],
      };

      const previewResult = await preview(
        tools,
        'generate_fiscal_obligations',
        args,
      );
      expect(previewResult).toEqual({
        status: 'ok',
        target: 'Obligaciones fiscales 2026-07',
        changes: [
          {
            field: 'types',
            label: 'Tipos a generar',
            from: null,
            to: 'vat_return',
          },
          {
            field: 'force_refresh',
            label: 'Refrescar existentes',
            from: null,
            to: 'no (se conservan)',
          },
        ],
        message: expect.stringContaining('idempotente'),
        domain: 'fiscal',
      });

      const answer = await run(tools, 'generate_fiscal_obligations', args);
      expect(
        deps.obligationsService.generateForContext,
      ).toHaveBeenCalledWith(
        FISCAL_CTX,
        expect.objectContaining({ period_year: 2026, period_month: 7 }),
      );
      expect(answer.summary).toContain('1 obligación(es)');
      expect(answer.obligations[0]).toEqual({
        id: 31,
        type: 'vat_return',
        status: 'pending',
        period_year: 2026,
        period_month: 7,
        due_date: '2026-09-20',
      });
      expect(answer.next_step).toContain('F-16');
    });

    it('mes inválido → preview error, generate intacto', async () => {
      const { deps, tools } = buildTools();

      const result = await preview(tools, 'generate_fiscal_obligations', {
        period_year: 2026,
        period_month: 13,
      });

      expect(result.status).toBe('error');
      expect(
        deps.obligationsService.generateForContext,
      ).not.toHaveBeenCalled();
    });
  });

  describe('create_declaration_draft (F-19)', () => {
    const OBLIGATION = {
      id: 31,
      type: 'vat_return',
      status: 'pending',
    };

    it('(b) preview cita la obligación + handler liquida vía servicio', async () => {
      const { deps, tools } = buildTools();
      deps.obligationsService.findOne.mockResolvedValue(OBLIGATION);
      deps.declarationsService.createDraft.mockResolvedValue({
        id: 12,
        declaration_type: 'vat',
        status: 'ready',
        obligation_id: 31,
        total_payable: 1330000,
        balance_favor: 0,
        lines: [{ id: 1 }, { id: 2 }],
      });
      const args = {
        declaration_type: 'vat',
        period_year: 2026,
        period_month: 7,
        obligation_id: 31,
      };

      const previewResult = await preview(
        tools,
        'create_declaration_draft',
        args,
      );
      expect(previewResult.status).toBe('ok');
      expect(previewResult.target).toBe('Declaración de IVA 2026-07');
      expect(previewResult.changes).toContainEqual({
        field: 'obligation',
        label: 'Obligación asociada',
        from: null,
        to: '#31 vat_return (pending)',
      });

      const answer = await run(tools, 'create_declaration_draft', args);
      expect(deps.declarationsService.createDraft).toHaveBeenCalledWith(
        FISCAL_CTX,
        expect.objectContaining({
          declaration_type: 'vat',
          period_year: 2026,
          obligation_id: 31,
        }),
      );
      expect(answer.created).toEqual({
        id: 12,
        declaration_type: 'vat',
        status: 'ready',
        obligation_id: 31,
        total_payable: 1330000,
        balance_favor: 0,
        lines_count: 2,
      });
      expect(answer.next_step).toContain('draft_id=12');
    });

    it('obligación inexistente → preview error con F-16', async () => {
      const { deps, tools } = buildTools();
      deps.obligationsService.findOne.mockRejectedValue(new Error('nope'));

      const result = await preview(tools, 'create_declaration_draft', {
        declaration_type: 'vat',
        period_year: 2026,
        obligation_id: 999,
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('F-16');
      expect(deps.declarationsService.createDraft).not.toHaveBeenCalled();
    });
  });

  describe('recalculate_declaration (F-20) / approve_declaration (F-21)', () => {
    const READY = {
      id: 12,
      declaration_type: 'vat',
      status: 'ready',
      period_year: 2026,
      period_month: 7,
      total_payable: 1330000,
      balance_favor: 0,
      lines: [{ id: 101 }, { id: 102 }],
    };

    it('F-20 preview + handler happy', async () => {
      const { deps, tools } = buildTools();
      deps.declarationsService.findOne.mockResolvedValue(READY);
      deps.declarationsService.recalculateDraft.mockResolvedValue({
        ...READY,
        total_payable: 1400000,
      });

      const previewResult = await preview(tools, 'recalculate_declaration', {
        draft_id: 12,
      });
      expect(previewResult.status).toBe('ok');
      expect(previewResult.target).toBe(
        'Declaración de IVA 2026-07 (#12, ready)',
      );

      const answer = await run(tools, 'recalculate_declaration', {
        draft_id: 12,
      });
      expect(deps.declarationsService.recalculateDraft).toHaveBeenCalledWith(
        [FISCAL_CTX],
        12,
      );
      expect(answer.recalculated.total_payable).toBe(1400000);
    });

    it('F-20 bloqueado (approved) → error sin recalcular', async () => {
      const { deps, tools } = buildTools();
      deps.declarationsService.findOne.mockResolvedValue({
        ...READY,
        status: 'approved',
      });

      const previewResult = await preview(tools, 'recalculate_declaration', {
        draft_id: 12,
      });
      expect(previewResult.status).toBe('error');
      expect(previewResult.message).toContain('approved');

      const answer = await run(tools, 'recalculate_declaration', {
        draft_id: 12,
      });
      expect(answer.error).toContain('approved');
      expect(answer.next_step).toContain('F-18');
      expect(deps.declarationsService.recalculateDraft).not.toHaveBeenCalled();
    });

    it('F-21 preview warning con consecuencia + handler happy', async () => {
      const { deps, tools } = buildTools();
      deps.declarationsService.findOne.mockResolvedValue(READY);
      deps.declarationsService.approveDraft.mockResolvedValue({
        ...READY,
        status: 'approved',
      });

      const previewResult = await preview(tools, 'approve_declaration', {
        draft_id: 12,
      });
      expect(previewResult).toEqual({
        status: 'warning',
        target: 'Declaración de IVA 2026-07 (#12, ready)',
        changes: [
          { field: 'status', label: 'Estado', from: 'ready', to: 'approved' },
          {
            field: 'totals',
            label: 'A pagar / a favor',
            from: null,
            to: '1330000 / 0',
          },
        ],
        message: expect.stringContaining('congela'),
        domain: 'fiscal',
      });

      const answer = await run(tools, 'approve_declaration', { draft_id: 12 });
      expect(deps.declarationsService.approveDraft).toHaveBeenCalledWith(
        [FISCAL_CTX],
        12,
      );
      expect(answer.approved.status).toBe('approved');
      expect(answer.next_step).toContain('F-22');
    });

    it('F-21 ya aprobada → error que manda a F-22', async () => {
      const { deps, tools } = buildTools();
      deps.declarationsService.findOne.mockResolvedValue({
        ...READY,
        status: 'approved',
      });

      const answer = await run(tools, 'approve_declaration', { draft_id: 12 });

      expect(answer.error).toContain('ya está aprobado');
      expect(answer.next_step).toContain('F-22');
      expect(deps.declarationsService.approveDraft).not.toHaveBeenCalled();
    });

    it('F-21 en draft → error que manda a F-20', async () => {
      const { deps, tools } = buildTools();
      deps.declarationsService.findOne.mockResolvedValue({
        ...READY,
        status: 'draft',
      });

      const answer = await run(tools, 'approve_declaration', { draft_id: 12 });

      expect(answer.error).toContain('solo se aprueban borradores listos');
      expect(answer.next_step).toContain('F-20');
      expect(deps.declarationsService.approveDraft).not.toHaveBeenCalled();
    });
  });

  describe('circuito de confirmación vía registry (F-21)', () => {
    const READY = {
      id: 12,
      declaration_type: 'vat',
      status: 'ready',
      period_year: 2026,
      period_month: 7,
      total_payable: 1330000,
      balance_favor: 0,
      lines: [],
    };

    function buildRegistry(confirmations: {
      issue: jest.Mock;
      redeem: jest.Mock;
    }) {
      const { deps, tools } = buildTools();
      deps.declarationsService.findOne.mockResolvedValue(READY);
      deps.declarationsService.approveDraft.mockResolvedValue({
        ...READY,
        status: 'approved',
      });
      const registry = new AIToolRegistry(confirmations as any);
      registry.register(getTool(tools, 'approve_declaration'));
      return { deps, registry };
    }

    let contextSpy: jest.SpyInstance;
    beforeEach(() => {
      contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({
          ...CONTEXT,
          permissions: ['store:fiscal:declarations:write'],
          roles: [],
        } as any);
    });
    afterEach(() => {
      contextSpy.mockRestore();
    });

    it('sin token → AI_AGENT_005 porta diff + token', async () => {
      const confirmations = {
        issue: jest.fn().mockResolvedValue('tok-9'),
        redeem: jest.fn(),
      };
      const { registry } = buildRegistry(confirmations);

      const failure: VendixHttpException = await registry
        .executeTool('approve_declaration', { draft_id: 12 })
        .catch((error) => error);

      expect(failure).toBeInstanceOf(VendixHttpException);
      expect(failure.errorCode).toBe('AI_AGENT_005');
      const body = failure.getResponse() as any;
      expect(body.details.confirmation_token).toBe('tok-9');
      expect(body.details.preview.status).toBe('warning');
      expect(body.details.preview.target).toContain('Declaración de IVA');
      expect(confirmations.issue).toHaveBeenCalledWith(
        'approve_declaration',
        expect.objectContaining({ draft_id: 12 }),
        11,
      );
    });

    it('doble apply aplica una sola vez', async () => {
      const confirmations = {
        issue: jest.fn(),
        redeem: jest
          .fn()
          .mockResolvedValueOnce('ok')
          .mockResolvedValueOnce('expired'),
      };
      const { deps, registry } = buildRegistry(confirmations);

      const first = await registry.executeTool(
        'approve_declaration',
        { draft_id: 12 },
        { confirmationToken: 'tok-9' },
      );
      expect(JSON.parse(first).approved.status).toBe('approved');

      const failure: VendixHttpException = await registry
        .executeTool('approve_declaration', { draft_id: 12 }, {
          confirmationToken: 'tok-9',
        })
        .catch((error) => error);

      expect(failure.errorCode).toBe('AI_AGENT_005');
      expect(deps.declarationsService.approveDraft).toHaveBeenCalledTimes(1);
    });
  });

  describe('mark_declaration_submitted (F-22)', () => {
    const APPROVED = {
      id: 12,
      declaration_type: 'vat',
      status: 'approved',
      period_year: 2026,
      period_month: 7,
      total_payable: 1330000,
      balance_favor: 0,
    };
    const ARGS = {
      draft_id: 12,
      submitted_at: '2026-09-20T10:00:00.000Z',
      external_reference: 'RAD-2026-8811',
    };

    it('(b) preview + handler happy', async () => {
      const { deps, tools } = buildTools();
      deps.declarationsService.findOne.mockResolvedValue(APPROVED);
      deps.declarationsService.markSubmitted.mockResolvedValue({
        ...APPROVED,
        status: 'submitted',
        submitted_at: '2026-09-20T10:00:00.000Z',
      });

      const previewResult = await preview(
        tools,
        'mark_declaration_submitted',
        ARGS,
      );
      expect(previewResult.status).toBe('ok');
      expect(previewResult.target).toContain('Declaración de IVA 2026-07');
      expect(previewResult.changes).toContainEqual({
        field: 'status',
        label: 'Estado',
        from: 'approved',
        to: 'submitted',
      });

      const answer = await run(tools, 'mark_declaration_submitted', ARGS);
      expect(deps.declarationsService.markSubmitted).toHaveBeenCalledWith(
        [FISCAL_CTX],
        12,
        expect.objectContaining({
          submitted_at: '2026-09-20T10:00:00.000Z',
          external_reference: 'RAD-2026-8811',
        }),
      );
      expect(answer.submitted.status).toBe('submitted');
    });

    it('no aprobada → error que manda a F-21', async () => {
      const { deps, tools } = buildTools();
      deps.declarationsService.findOne.mockResolvedValue({
        ...APPROVED,
        status: 'ready',
      });

      const answer = await run(tools, 'mark_declaration_submitted', ARGS);

      expect(answer.error).toContain('solo se marca como presentada');
      expect(answer.next_step).toContain('F-21');
      expect(deps.declarationsService.markSubmitted).not.toHaveBeenCalled();
    });
  });

  describe('list_close_sessions (F-23)', () => {
    const SESSION = {
      id: 9,
      close_type: 'monthly',
      status: 'checking',
      period_year: 2026,
      period_month: 7,
      period_start: new Date('2026-07-01'),
      period_end: new Date('2026-07-31'),
      fiscal_period_id: 5,
      store: { name: 'Tienda Centro' },
      checks: [
        { check_key: 'draft_entries', status: 'failed', blocking: true },
        { check_key: 'dian_pending', status: 'passed', blocking: true },
        { check_key: 'rounding', status: 'warning', blocking: false },
      ],
      closed_at: null,
    };

    it('(b) happy: sesiones con resumen de checks', async () => {
      const { deps, tools } = buildTools();
      deps.closeService.list.mockResolvedValue([SESSION]);

      const answer = await run(tools, 'list_close_sessions', {});

      expect(deps.closeService.list).toHaveBeenCalledWith(
        [FISCAL_CTX],
        expect.objectContaining({}),
      );
      expect(answer).toEqual({
        accounting_entity: ENTITY_TAG,
        summary: '1 sesión(es) de cierre del NIT',
        filters: { status: null, period_year: null },
        sessions: [
          {
            id: 9,
            close_type: 'monthly',
            status: 'checking',
            period_year: 2026,
            period_month: 7,
            period_start: '2026-07-01',
            period_end: '2026-07-31',
            fiscal_period_id: 5,
            store: 'Tienda Centro',
            checks: {
              total: 3,
              passed: 1,
              failed: 1,
              warnings: 1,
              overridden: 0,
              failed_blocking_keys: ['draft_entries'],
            },
            closed_at: null,
          },
        ],
        sessions_total: 1,
        sessions_omitted: 0,
      });
    });

    it('(a) sad: status inválido → {error, next_step} y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'list_close_sessions', {
        status: 'casi',
      });

      expect(answer.error).toContain('status "casi" inválido');
      expect(deps.contextResolver.resolveForStore).not.toHaveBeenCalled();
      expect(deps.closeService.list).not.toHaveBeenCalled();
    });
  });

  describe('run_close_checks (F-24) / close_fiscal_session (F-25)', () => {
    const SESSION = {
      id: 9,
      close_type: 'monthly',
      status: 'approved',
      period_year: 2026,
      period_month: 7,
      fiscal_period_id: 5,
      checks: [
        {
          check_key: 'draft_entries',
          title: 'Sin borradores',
          status: 'passed',
          blocking: true,
          result_summary: '0 borradores',
        },
      ],
    };

    it('F-24 preview + handler happy', async () => {
      const { deps, tools } = buildTools();
      deps.closeService.findOne.mockResolvedValue(SESSION);
      deps.closeService.runChecks.mockResolvedValue({
        ...SESSION,
        status: 'ready',
      });

      const previewResult = await preview(tools, 'run_close_checks', {
        session_id: 9,
      });
      expect(previewResult.status).toBe('ok');
      expect(previewResult.target).toBe(
        'Cierre fiscal monthly 2026-07 (#9, approved)',
      );

      const answer = await run(tools, 'run_close_checks', { session_id: 9 });
      expect(deps.closeService.runChecks).toHaveBeenCalledWith([FISCAL_CTX], 9);
      expect(answer.evaluated.summary).toEqual({
        total: 1,
        passed: 1,
        failed: 0,
        warnings: 0,
        overridden: 0,
        failed_blocking_keys: [],
      });
      expect(answer.next_step).toContain('F-25');
    });

    it('F-24 sesión cerrada → error, runChecks intacto', async () => {
      const { deps, tools } = buildTools();
      deps.closeService.findOne.mockResolvedValue({
        ...SESSION,
        status: 'closed',
      });

      const answer = await run(tools, 'run_close_checks', { session_id: 9 });

      expect(answer.error).toContain('ya está cerrada');
      expect(deps.closeService.runChecks).not.toHaveBeenCalled();
    });

    it('F-25 preview warning con consecuencia + handler happy', async () => {
      const { deps, tools } = buildTools();
      deps.closeService.findOne.mockResolvedValue(SESSION);
      deps.closeService.close.mockResolvedValue({
        ...SESSION,
        status: 'closed',
        closed_at: new Date('2026-08-05T05:00:00.000Z'),
      });

      const previewResult = await preview(tools, 'close_fiscal_session', {
        session_id: 9,
      });
      expect(previewResult.status).toBe('warning');
      expect(previewResult.message).toContain('irreversible');
      expect(previewResult.changes).toContainEqual({
        field: 'fiscal_period',
        label: 'Periodo fiscal vinculado',
        from: 'open',
        to: 'cerrado (periodo #5)',
      });

      const answer = await run(tools, 'close_fiscal_session', {
        session_id: 9,
      });
      expect(deps.closeService.close).toHaveBeenCalledWith([FISCAL_CTX], 9);
      expect(answer.closed).toEqual({
        id: 9,
        close_type: 'monthly',
        status: 'closed',
        period_year: 2026,
        period_month: 7,
        closed_at: '2026-08-05',
      });
    });

    it('F-25 con bloqueantes fallidos → preview error que los nombra', async () => {
      const { deps, tools } = buildTools();
      deps.closeService.findOne.mockResolvedValue({
        ...SESSION,
        status: 'ready',
        checks: [
          { check_key: 'draft_entries', status: 'failed', blocking: true },
          { check_key: 'dian_pending', status: 'failed', blocking: false },
        ],
      });

      const result = await preview(tools, 'close_fiscal_session', {
        session_id: 9,
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('draft_entries');
      expect(result.message).not.toContain('dian_pending');
      expect(deps.closeService.close).not.toHaveBeenCalled();
    });

    it('F-25 sesión no lista → handler {error, next_step}, close intacto', async () => {
      const { deps, tools } = buildTools();
      deps.closeService.findOne.mockResolvedValue({
        ...SESSION,
        status: 'checking',
      });

      const answer = await run(tools, 'close_fiscal_session', {
        session_id: 9,
      });

      expect(answer.error).toContain('aprobadas o listas');
      expect(answer.next_step).toContain('F-24');
      expect(deps.closeService.close).not.toHaveBeenCalled();
    });
  });

  describe('get_fiscal_checklist (F-26)', () => {
    it('(b) happy: bloqueantes separados con acción', async () => {
      const { deps, tools } = buildTools();
      deps.checklistService.build.mockResolvedValue({
        completion_pct: 75,
        items: [
          {
            key: 'fiscal_identity',
            label: 'Identidad fiscal',
            complete: true,
            severity: 'blocker',
            detail: 'NIT configurado',
          },
          {
            key: 'dian_config',
            label: 'Configuración DIAN',
            complete: false,
            severity: 'blocker',
            detail: 'Falta certificado de firma',
            action: { label: 'Configurar DIAN', navigate: 'dian' },
          },
          {
            key: 'mappings',
            label: 'Mapeos contables',
            complete: false,
            severity: 'required',
            detail: '3 claves sin override',
          },
        ],
      });

      const answer = await run(tools, 'get_fiscal_checklist', {});

      expect(deps.checklistService.build).toHaveBeenCalledWith(FISCAL_CTX);
      expect(answer.accounting_entity).toEqual(ENTITY_TAG);
      expect(answer.completion_pct).toBe(75);
      expect(answer.summary).toContain('1 bloqueante(s)');
      expect(answer.blockers).toEqual([
        {
          key: 'dian_config',
          label: 'Configuración DIAN',
          detail: 'Falta certificado de firma',
          action: { label: 'Configurar DIAN', navigate: 'dian' },
        },
      ]);
      expect(answer.items).toHaveLength(3);
    });
  });

  describe('list_invoices (F-27)', () => {
    const INVOICE = {
      id: 501,
      invoice_number: 'SETP-881',
      prefix: 'SETP',
      invoice_type: 'sales_invoice',
      status: 'accepted',
      issue_date: new Date('2026-09-12'),
      customer_name: 'Cliente Agente SAS',
      customer_tax_id: '900999111',
      subtotal: 1000000,
      tax_amount: 190000,
      total_amount: 1190000,
      dian_status: 'accepted',
      cufe: 'abc123',
    };

    it('(b) happy: filas compactas con adquiriente y DIAN', async () => {
      const { deps, tools } = buildTools();
      deps.invoicesService.findAll.mockResolvedValue({
        data: [INVOICE],
        meta: { total: 1 },
      });

      const answer = await run(tools, 'list_invoices', { status: 'accepted' });

      expect(deps.invoicesService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          limit: 10,
          status: 'accepted',
        }),
      );
      expect(answer).toEqual({
        accounting_entity: ENTITY_TAG,
        summary: '1 documento(s) de 1 que coinciden con el filtro',
        filters: { status: 'accepted', search: null },
        invoices: [
          {
            id: 501,
            number: 'SETP-881',
            prefix: 'SETP',
            invoice_type: 'sales_invoice',
            status: 'accepted',
            issue_date: '2026-09-12',
            customer: 'Cliente Agente SAS',
            customer_tax_id: '900999111',
            subtotal: 1000000,
            tax_amount: 190000,
            total: 1190000,
            dian_status: 'accepted',
            cufe: 'abc123',
          },
        ],
        page: 1,
        limit: 10,
        total_matching: 1,
      });
    });

    it('(a) sad: status inválido → {error, next_step} y cero llamadas', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'list_invoices', { status: 'volando' });

      expect(answer.error).toContain('status "volando" inválido');
      expect(deps.invoicesService.findAll).not.toHaveBeenCalled();
    });
  });
});
