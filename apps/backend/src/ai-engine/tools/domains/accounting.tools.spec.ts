import { RequestContextService } from '@common/context/request-context.service';
import {
  createAccountingTools,
  AccountingToolDeps,
} from './accounting.tools';
import { AIToolRegistry } from '../ai-tool-registry';
import { RegisteredTool } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';

/**
 * Paso 6 track A — contrato F-1 / F-9 / F-12 (reads P0 contables).
 * Paso 11 track A — contrato F-2..F-13 (writes contables + P1).
 *
 * Patrón canónico T4: (a) happy/sad con sad sin tocar deps, (b) snapshot de
 * salida con literales (`toEqual`, sin `.snap`), (c) forma
 * `{error, next_step}` en ES en los fallos guiados, (d) permiso declarado por
 * tool, (e) `readOnly: true` en los 11 reads sin `requiresConfirmation`,
 * `requiresConfirmation: true` + `preview` con sujeto humano en los 10
 * writes, con re-verificación en handler (el mundo pudo moverse entre
 * preview y apply).
 */
describe('accounting.tools · F-1 get_journal_entry / F-9 list_account_mappings / F-12 list_entry_failures', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const ENTITY_ROW = {
    id: 55,
    name: 'Tienda Centro',
    legal_name: 'Tienda Centro SAS',
    tax_id: '900123456',
    scope: 'STORE',
    fiscal_scope: 'STORE',
    store_id: 7,
  };

  const ENTITY_TAG = {
    id: 55,
    name: 'Tienda Centro SAS',
    tax_id: '900123456',
    fiscal_scope: 'STORE',
    operating_scope: 'STORE',
    store_id: 7,
  };

  function baseDeps(overrides: Record<string, any> = {}) {
    const deps = {
      reportsService: {},
      fiscalPeriodsService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
        close: jest.fn(),
      },
      journalEntriesService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
      },
      entryFlowService: { post: jest.fn(), void: jest.fn() },
      chartOfAccountsService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        findByCode: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      fiscalScopeService: {
        findFiscalAccountingEntityId: jest.fn().mockResolvedValue(55),
      },
      prisma: {
        accounting_entities: {
          findFirst: jest.fn().mockResolvedValue(ENTITY_ROW),
        },
      },
      accountMappingService: {
        getMappings: jest.fn(),
        getMapping: jest.fn(),
        bulkUpsertMappings: jest.fn(),
        resetToDefaults: jest.fn(),
      },
      entryFailureService: {
        listUnresolved: jest.fn(),
        findOne: jest.fn(),
        enqueueRetry: jest.fn(),
      },
      ...overrides,
    } as any;
    return { deps: deps as AccountingToolDeps, raw: deps };
  }

  function buildTools(overrides: Record<string, any> = {}) {
    const { deps, raw } = baseDeps(overrides);
    return { deps: raw, tools: createAccountingTools(deps) };
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

  const WRITES = [
    'create_journal_entry',
    'post_journal_entry',
    'void_journal_entry',
    'create_fiscal_period',
    'close_fiscal_period',
    'create_puc_account',
    'update_puc_account',
    'update_account_mapping',
    'reset_account_mappings',
    'retry_entry_failure',
  ];

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
    it('expone exactamente los 21 tools del dominio accounting (11 reads + 10 writes)', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'list_fiscal_periods',
        'get_income_statement',
        'get_balance_sheet',
        'get_trial_balance',
        'get_account_ledger',
        'get_vat_summary',
        'get_recent_journal_entries',
        'find_puc_account',
        'get_journal_entry',
        'list_account_mappings',
        'list_entry_failures',
        ...WRITES,
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('accounting');
        expect(tool.version).toBe('1');
      }
    });

    it('(e) los 10 writes exigen confirmación + preview, sin readOnly', () => {
      const { tools } = buildTools();
      for (const name of WRITES) {
        const tool = getTool(tools, name);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
        expect(tool.readOnly).toBeUndefined();
        expect(tool.clientSide).toBeUndefined();
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('(d) cada write declara el permiso de su ruta HTTP dueña', () => {
      const { tools } = buildTools();
      const expected: Record<string, string> = {
        create_journal_entry: 'store:accounting:journal_entries:create',
        post_journal_entry: 'store:accounting:journal_entries:post',
        void_journal_entry: 'store:accounting:journal_entries:void',
        create_fiscal_period: 'store:accounting:fiscal_periods:create',
        close_fiscal_period: 'store:accounting:fiscal_periods:update',
        create_puc_account: 'store:accounting:chart_of_accounts:create',
        update_puc_account: 'store:accounting:chart_of_accounts:update',
        update_account_mapping: 'store:accounting:account_mappings:update',
        reset_account_mappings: 'store:accounting:account_mappings:create',
        retry_entry_failure: 'store:accounting:journal_entries:update',
      };
      for (const [name, perm] of Object.entries(expected)) {
        expect(getTool(tools, name).requiredPermissions).toEqual([perm]);
      }
    });

    it('cada write cita su read habilitante en la descripción', () => {
      const { tools } = buildTools();
      const expected: Record<string, string[]> = {
        create_journal_entry: ['F-9', 'list_fiscal_periods'],
        post_journal_entry: ['F-1'],
        void_journal_entry: ['F-1'],
        create_fiscal_period: ['list_fiscal_periods'],
        close_fiscal_period: ['list_fiscal_periods'],
        create_puc_account: ['find_puc_account'],
        update_puc_account: ['find_puc_account'],
        update_account_mapping: ['F-9'],
        reset_account_mappings: ['F-9'],
        retry_entry_failure: ['F-12'],
      };
      for (const [name, markers] of Object.entries(expected)) {
        const description = getTool(tools, name).description;
        for (const marker of markers) {
          expect(description).toContain(marker);
        }
      }
    });

    it('F-1/F-12 exigen journal_entries:read y F-9 exige account_mappings:read', () => {
      const { tools } = buildTools();
      expect(
        getTool(tools, 'get_journal_entry').requiredPermissions,
      ).toEqual(['store:accounting:journal_entries:read']);
      expect(
        getTool(tools, 'list_entry_failures').requiredPermissions,
      ).toEqual(['store:accounting:journal_entries:read']);
      expect(
        getTool(tools, 'list_account_mappings').requiredPermissions,
      ).toEqual(['store:accounting:account_mappings:read']);
    });

    it('los 3 son reads puros: readOnly sin confirmación ni preview', () => {
      const { tools } = buildTools();
      for (const name of [
        'get_journal_entry',
        'list_account_mappings',
        'list_entry_failures',
      ]) {
        const tool = getTool(tools, name);
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation).toBeUndefined();
        expect(tool.preview).toBeUndefined();
        expect(tool.clientSide).toBeUndefined();
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('solo F-1 declara requerido (entry_id)', () => {
      const { tools } = buildTools();
      expect(getTool(tools, 'get_journal_entry').parameters.required).toEqual([
        'entry_id',
      ]);
      expect(
        getTool(tools, 'list_account_mappings').parameters.required,
      ).toBeUndefined();
      expect(
        getTool(tools, 'list_entry_failures').parameters.required,
      ).toBeUndefined();
    });
  });

  describe('get_journal_entry (F-1)', () => {
    const ENTRY_ROW = {
      id: 901,
      entry_number: 'AE-2026-000114',
      entry_date: new Date('2026-09-15T05:00:00.000Z'),
      entry_type: 'auto_payment',
      status: 'posted',
      description: 'Pago POS multi-medio orden #4821',
      source_type: 'payment.received',
      source_id: 4821,
      store: { name: 'Tienda Centro' },
      fiscal_period: { name: 'Septiembre 2026' },
      total_debit: 33000,
      total_credit: 33000,
      accounting_entry_lines: [
        {
          account: {
            code: '1105',
            name: 'Caja',
            account_type: 'asset',
            nature: 'debit',
          },
          debit_amount: 30000,
          credit_amount: 0,
          description: 'Efectivo orden #4821',
          third_party_name: null,
          third_party_tax_id: null,
        },
        {
          account: {
            code: '1355',
            name: 'Anticipo impuestos retefuente',
            account_type: 'asset',
            nature: 'debit',
          },
          debit_amount: 3000,
          credit_amount: 0,
          description: 'Rete sufrida cliente agente',
          third_party_name: 'Cliente Agente SAS',
          third_party_tax_id: '900999111',
        },
        {
          account: {
            code: '4135',
            name: 'Ventas',
            account_type: 'revenue',
            nature: 'credit',
          },
          debit_amount: 0,
          credit_amount: 33000,
          description: null,
          third_party_name: null,
          third_party_tax_id: null,
        },
      ],
    };

    it('(b) happy: snapshot exacto con balance y tercero', async () => {
      const { deps, tools } = buildTools();
      deps.journalEntriesService.findOne.mockResolvedValue(ENTRY_ROW);

      const answer = await run(tools, 'get_journal_entry', { entry_id: 901 });

      expect(deps.journalEntriesService.findOne).toHaveBeenCalledWith(901);
      expect(answer).toEqual({
        accounting_entity: ENTITY_TAG,
        entry: {
          id: 901,
          entry_number: 'AE-2026-000114',
          entry_date: '2026-09-15',
          entry_type: 'auto_payment',
          status: 'posted',
          description: 'Pago POS multi-medio orden #4821',
          source: { type: 'payment.received', id: 4821 },
          store: 'Tienda Centro',
          fiscal_period: 'Septiembre 2026',
          total_debit: 33000,
          total_credit: 33000,
          is_balanced: true,
          lines: [
            {
              account_code: '1105',
              account_name: 'Caja',
              account_type: 'asset',
              nature: 'debit',
              debit: 30000,
              credit: 0,
              description: 'Efectivo orden #4821',
              third_party: null,
              third_party_tax_id: null,
            },
            {
              account_code: '1355',
              account_name: 'Anticipo impuestos retefuente',
              account_type: 'asset',
              nature: 'debit',
              debit: 3000,
              credit: 0,
              description: 'Rete sufrida cliente agente',
              third_party: 'Cliente Agente SAS',
              third_party_tax_id: '900999111',
            },
            {
              account_code: '4135',
              account_name: 'Ventas',
              account_type: 'revenue',
              nature: 'credit',
              debit: 0,
              credit: 33000,
              description: null,
              third_party: null,
              third_party_tax_id: null,
            },
          ],
          lines_count: 3,
        },
      });
    });

    it('(a) sad: entry_id inválido → {error, next_step} y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'get_journal_entry', {
        entry_id: 'abc',
      });

      expect(answer.error).toContain('entry_id inválido');
      expect(answer.next_step).toContain('get_recent_journal_entries');
      expect(deps.journalEntriesService.findOne).not.toHaveBeenCalled();
    });

    it('(c) asiento inexistente → {error} del guard, sin next_step inventado', async () => {
      const { deps, tools } = buildTools();
      deps.journalEntriesService.findOne.mockRejectedValue(
        new Error('ACC_FIND_002'),
      );

      const answer = await run(tools, 'get_journal_entry', { entry_id: 404 });

      expect(answer).toEqual({ error: 'ACC_FIND_002' });
    });
  });

  describe('list_account_mappings (F-9)', () => {
    const MAPPINGS = [
      {
        mapping_key: 'invoice.validated.vat_payable',
        account_code: '240802',
        account_id: 88,
        description: 'IVA generado en ventas',
        source: 'organization',
      },
      {
        mapping_key: 'payment.received.cash',
        account_code: '110501',
        account_id: 12,
        description: 'Caja general tienda centro',
        source: 'store',
      },
      {
        mapping_key: 'withholding.suffered.retefuente_receivable',
        account_code: '135510',
        account_id: undefined,
        description: 'Anticipo retefuente sufrida',
        source: 'default',
      },
    ];

    it('(b) happy: snapshot con cascada store/organization/default', async () => {
      const { deps, tools } = buildTools();
      deps.accountMappingService.getMappings.mockResolvedValue(MAPPINGS);

      const answer = await run(tools, 'list_account_mappings', {});

      expect(deps.accountMappingService.getMappings).toHaveBeenCalledWith(
        3,
        undefined,
        7,
      );
      expect(answer).toEqual({
        accounting_entity: ENTITY_TAG,
        summary: '3 mapeo(s) efectivo(s)',
        filters: { prefix: null },
        mappings: [
          {
            mapping_key: 'invoice.validated.vat_payable',
            account_code: '240802',
            account_id: 88,
            description: 'IVA generado en ventas',
            source: 'organization',
          },
          {
            mapping_key: 'payment.received.cash',
            account_code: '110501',
            account_id: 12,
            description: 'Caja general tienda centro',
            source: 'store',
          },
          {
            mapping_key: 'withholding.suffered.retefuente_receivable',
            account_code: '135510',
            account_id: null,
            description: 'Anticipo retefuente sufrida',
            source: 'default',
          },
        ],
        mappings_total: 3,
        mappings_omitted: 0,
        notes:
          'source indica la cascada: store = override de tienda, organization = base de organización, default = default del sistema.',
      });
    });

    it('prefix se propaga al service como filtro', async () => {
      const { deps, tools } = buildTools();
      deps.accountMappingService.getMappings.mockResolvedValue([MAPPINGS[0]]);

      const answer = await run(tools, 'list_account_mappings', {
        prefix: 'invoice.',
      });

      expect(deps.accountMappingService.getMappings).toHaveBeenCalledWith(
        3,
        'invoice.',
        7,
      );
      expect(answer.filters).toEqual({ prefix: 'invoice.' });
      expect(answer.mappings).toHaveLength(1);
    });

    it('(a) sad: sin organización → {error, next_step} y cero queries', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(
        tools,
        'list_account_mappings',
        {},
        { store_id: 7 },
      );

      expect(answer.error).toContain('Sin organización en contexto');
      expect(answer.next_step).toBeDefined();
      expect(deps.accountMappingService.getMappings).not.toHaveBeenCalled();
    });
  });

  describe('list_entry_failures (F-12)', () => {
    const FAILURES = [
      {
        id: 77,
        handler_key: 'payment.received',
        source_type: 'payment.received',
        source_id: 4821,
        store_id: 7,
        // Caso QUI-576: rama sin factura debita bruto + DR 1355 → desbalance
        // igual a la retención. La tool lo expone tal cual; el reintento (F-13)
        // lo cita, no lo recalcula.
        error_message:
          'Unbalanced entry: debit=33000, credit=30000, difference=3000',
        attempt_count: 3,
        created_at: new Date('2026-09-15T10:00:00.000Z'),
      },
      {
        id: 78,
        handler_key: 'purchase_order.received',
        source_type: 'purchase_order.received',
        source_id: 55,
        store_id: null,
        error_message: 'No open fiscal period covers entry_date 2026-09-15',
        attempt_count: 1,
        created_at: new Date('2026-09-16T10:00:00.000Z'),
      },
    ];

    it('(b) happy: snapshot con fallo QUI-576 y next_step a F-13', async () => {
      const { deps, tools } = buildTools();
      deps.entryFailureService.listUnresolved.mockResolvedValue({
        data: FAILURES,
        total: 2,
        page: 1,
        limit: 20,
      });

      const answer = await run(tools, 'list_entry_failures', {});

      expect(deps.entryFailureService.listUnresolved).toHaveBeenCalledWith(
        1,
        20,
      );
      expect(answer).toEqual({
        accounting_entity: ENTITY_TAG,
        summary: '2 fallo(s) de contabilización sin resolver',
        failures: [
          {
            id: 77,
            handler_key: 'payment.received',
            source: { type: 'payment.received', id: 4821 },
            store_id: 7,
            error_message:
              'Unbalanced entry: debit=33000, credit=30000, difference=3000',
            attempt_count: 3,
            created_at: '2026-09-15',
          },
          {
            id: 78,
            handler_key: 'purchase_order.received',
            source: { type: 'purchase_order.received', id: 55 },
            store_id: null,
            error_message:
              'No open fiscal period covers entry_date 2026-09-15',
            attempt_count: 1,
            created_at: '2026-09-16',
          },
        ],
        page: 1,
        limit: 20,
        total_unresolved: 2,
        next_step:
          'Para reintentar un fallo usa retry_entry_failure (F-13) citando su id; si el error menciona periodo cerrado o cuenta inexistente, resuelve eso primero.',
      });
    });

    it('sin fallos → summary en cero y sin next_step', async () => {
      const { deps, tools } = buildTools();
      deps.entryFailureService.listUnresolved.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      });

      const answer = await run(tools, 'list_entry_failures', {});

      expect(answer.summary).toContain('No hay fallos');
      expect(answer.failures).toEqual([]);
      expect(answer.next_step).toBeUndefined();
    });
  });

  describe('create_journal_entry (F-2)', () => {
    const PERIOD_OPEN = {
      id: 5,
      name: 'Septiembre 2026',
      start_date: new Date('2026-09-01'),
      end_date: new Date('2026-09-30'),
      status: 'open',
    };
    const ACCOUNTS: Record<string, any> = {
      '1105': {
        id: 12,
        code: '1105',
        name: 'Caja',
        accepts_entries: true,
      },
      '4295': {
        id: 99,
        code: '4295',
        name: 'Ingresos diversos',
        accepts_entries: true,
      },
    };
    const DRAFT_ARGS = {
      fiscal_period_id: 5,
      entry_date: '2026-09-15',
      description: 'Ajuste de caja septiembre',
      lines: [
        { account_code: '1105', debit: 50000, credit: 0 },
        { account_code: '4295', debit: 0, credit: 50000 },
      ],
    };

    function mockHappy(deps: any) {
      deps.fiscalPeriodsService.findOne.mockResolvedValue(PERIOD_OPEN);
      deps.chartOfAccountsService.findByCode.mockImplementation(
        async (code: string) => ACCOUNTS[code] ?? null,
      );
      return deps;
    }

    it('(b) preview happy: sujeto humano + líneas + totales', async () => {
      const { deps, tools } = buildTools();
      mockHappy(deps);

      const result = await preview(tools, 'create_journal_entry', DRAFT_ARGS);

      expect(result).toEqual({
        status: 'ok',
        target: 'Ajuste de caja septiembre',
        changes: [
          {
            field: 'line.1105',
            label: '1105 Caja',
            from: null,
            to: 'Débito 50000',
          },
          {
            field: 'line.4295',
            label: '4295 Ingresos diversos',
            from: null,
            to: 'Crédito 50000',
          },
          {
            field: 'totals',
            label: 'Totales débito = crédito',
            from: null,
            to: '50000 (periodo Septiembre 2026)',
          },
        ],
        message:
          'Se creará en estado borrador: no afecta reportes hasta que se postee con post_journal_entry.',
        domain: 'accounting',
      });
    });

    it('(b) handler happy: crea en borrador vía el servicio dueño', async () => {
      const { deps, tools } = buildTools();
      mockHappy(deps);
      deps.journalEntriesService.create.mockResolvedValue({
        id: 901,
        entry_number: 'MAN-2026-000001',
        entry_date: new Date('2026-09-15T05:00:00.000Z'),
        status: 'draft',
        description: 'Ajuste de caja septiembre',
        total_debit: 50000,
        total_credit: 50000,
      });

      const answer = await run(tools, 'create_journal_entry', DRAFT_ARGS);

      expect(deps.journalEntriesService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fiscal_period_id: 5,
          lines: [
            expect.objectContaining({ account_id: 12, debit_amount: 50000 }),
            expect.objectContaining({ account_id: 99, credit_amount: 50000 }),
          ],
        }),
      );
      expect(answer).toEqual({
        accounting_entity: ENTITY_TAG,
        created: {
          id: 901,
          entry_number: 'MAN-2026-000001',
          entry_date: '2026-09-15',
          status: 'draft',
          description: 'Ajuste de caja septiembre',
          total_debit: 50000,
          total_credit: 50000,
        },
        next_step:
          'Asiento creado en borrador. Para contabilizarlo usa post_journal_entry citando este ID.',
      });
    });

    it('desbalanceado → preview error (sin proponer) y handler {error, next_step} sin crear', async () => {
      const { deps, tools } = buildTools();
      mockHappy(deps);
      const bad = {
        ...DRAFT_ARGS,
        lines: [
          { account_code: '1105', debit: 50000, credit: 0 },
          { account_code: '4295', debit: 0, credit: 49999 },
        ],
      };

      const previewResult = await preview(tools, 'create_journal_entry', bad);
      expect(previewResult.status).toBe('error');
      expect(previewResult.message).toContain('desbalanceado');

      const answer = await run(tools, 'create_journal_entry', bad);
      expect(answer.error).toContain('desbalanceado');
      expect(answer.next_step).toContain('±0.001');
      expect(deps.journalEntriesService.create).not.toHaveBeenCalled();
    });

    it('(c) periodo cerrado → {error, next_step}, sin crear', async () => {
      const { deps, tools } = buildTools();
      mockHappy(deps);
      deps.fiscalPeriodsService.findOne.mockResolvedValue({
        ...PERIOD_OPEN,
        status: 'closed',
      });

      const answer = await run(tools, 'create_journal_entry', DRAFT_ARGS);

      expect(answer.error).toContain('está closed');
      expect(answer.next_step).toContain('list_fiscal_periods');
      expect(deps.journalEntriesService.create).not.toHaveBeenCalled();
    });

    it('(c) cuenta inexistente → {error, next_step} con find_puc_account', async () => {
      const { deps, tools } = buildTools();
      mockHappy(deps);
      deps.chartOfAccountsService.findByCode.mockImplementation(
        async (code: string) =>
          code === '1105' ? ACCOUNTS['1105'] : null,
      );

      const answer = await run(tools, 'create_journal_entry', DRAFT_ARGS);

      expect(answer.error).toContain('4295');
      expect(answer.next_step).toContain('find_puc_account');
      expect(deps.journalEntriesService.create).not.toHaveBeenCalled();
    });

    it('(a) sad: args inválidos no tocan services', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'create_journal_entry', {
        fiscal_period_id: 'x',
        lines: [{ account_code: '1105', debit: 1, credit: 0 }],
      });

      expect(answer.error).toContain('fiscal_period_id inválido');
      expect(deps.fiscalPeriodsService.findOne).not.toHaveBeenCalled();
      expect(
        deps.chartOfAccountsService.findByCode,
      ).not.toHaveBeenCalled();
      expect(deps.journalEntriesService.create).not.toHaveBeenCalled();
    });
  });

  describe('circuito de confirmación vía registry (F-2)', () => {
    const ARGS = {
      fiscal_period_id: 5,
      entry_date: '2026-09-15',
      description: 'Ajuste de caja septiembre',
      lines: [
        { account_code: '1105', debit: 50000, credit: 0 },
        { account_code: '4295', debit: 0, credit: 50000 },
      ],
    };

    function buildRegistry(confirmations: {
      issue: jest.Mock;
      redeem: jest.Mock;
    }) {
      const { deps, tools } = buildTools();
      deps.fiscalPeriodsService.findOne.mockResolvedValue({
        id: 5,
        name: 'Septiembre 2026',
        status: 'open',
      });
      deps.chartOfAccountsService.findByCode.mockImplementation(
        async (code: string) =>
          ({
            '1105': { id: 12, code: '1105', name: 'Caja', accepts_entries: true },
            '4295': {
              id: 99,
              code: '4295',
              name: 'Ingresos diversos',
              accepts_entries: true,
            },
          })[code] ?? null,
      );
      deps.journalEntriesService.create.mockResolvedValue({
        id: 901,
        entry_number: 'MAN-2026-000001',
        entry_date: new Date('2026-09-15T05:00:00.000Z'),
        status: 'draft',
        description: 'Ajuste de caja septiembre',
        total_debit: 50000,
        total_credit: 50000,
      });
      const registry = new AIToolRegistry(confirmations as any);
      registry.register(getTool(tools, 'create_journal_entry'));
      return { deps, registry };
    }

    let contextSpy: jest.SpyInstance;
    beforeEach(() => {
      contextSpy = jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({
          ...CONTEXT,
          permissions: ['store:accounting:journal_entries:create'],
          roles: [],
        } as any);
    });
    afterEach(() => {
      contextSpy.mockRestore();
    });

    it('sin token → AI_AGENT_005 porta diff + token', async () => {
      const confirmations = {
        issue: jest.fn().mockResolvedValue('tok-1'),
        redeem: jest.fn(),
      };
      const { registry } = buildRegistry(confirmations);

      const failure: VendixHttpException = await registry
        .executeTool('create_journal_entry', ARGS)
        .catch((error) => error);

      expect(failure).toBeInstanceOf(VendixHttpException);
      expect(failure.errorCode).toBe('AI_AGENT_005');
      const body = failure.getResponse() as any;
      expect(body.details.confirmation_token).toBe('tok-1');
      expect(body.details.preview.status).toBe('ok');
      expect(body.details.preview.target).toContain('Ajuste de caja');
      expect(confirmations.issue).toHaveBeenCalledWith(
        'create_journal_entry',
        expect.objectContaining({ fiscal_period_id: 5 }),
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

      const first = await registry.executeTool('create_journal_entry', ARGS, {
        confirmationToken: 'tok-1',
      });
      expect(JSON.parse(first).created.id).toBe(901);

      const failure: VendixHttpException = await registry
        .executeTool('create_journal_entry', ARGS, {
          confirmationToken: 'tok-1',
        })
        .catch((error) => error);

      expect(failure.errorCode).toBe('AI_AGENT_005');
      expect(deps.journalEntriesService.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('post_journal_entry (F-3) / void_journal_entry (F-4)', () => {
    const DRAFT = {
      id: 901,
      entry_number: 'MAN-2026-000001',
      status: 'draft',
      description: 'Ajuste de caja septiembre',
      total_debit: 50000,
      total_credit: 50000,
      fiscal_period: { name: 'Septiembre 2026' },
    };
    const POSTED = { ...DRAFT, status: 'posted' };

    it('F-3 preview happy cita número + descripción humana', async () => {
      const { deps, tools } = buildTools();
      deps.journalEntriesService.findOne.mockResolvedValue(DRAFT);

      const result = await preview(tools, 'post_journal_entry', {
        entry_id: 901,
      });

      expect(result).toEqual({
        status: 'ok',
        target: 'MAN-2026-000001 — Ajuste de caja septiembre',
        changes: [
          { field: 'status', label: 'Estado', from: 'draft', to: 'posted' },
          {
            field: 'totals',
            label: 'Totales débito = crédito',
            from: null,
            to: '50000 (Septiembre 2026)',
          },
        ],
        message:
          'Al postear, el asiento empieza a afectar balance, P&G y auxiliares. Solo procede si el periodo sigue abierto.',
        domain: 'accounting',
      });
    });

    it('F-3 handler happy postea vía JournalEntryFlowService', async () => {
      const { deps, tools } = buildTools();
      deps.journalEntriesService.findOne.mockResolvedValue(DRAFT);
      deps.entryFlowService.post.mockResolvedValue(POSTED);

      const answer = await run(tools, 'post_journal_entry', { entry_id: 901 });

      expect(deps.entryFlowService.post).toHaveBeenCalledWith(901);
      expect(answer.posted.status).toBe('posted');
      expect(answer.accounting_entity).toEqual(ENTITY_TAG);
    });

    it('F-3 re-verifica: si ya no es draft → {error, next_step}, post intacto', async () => {
      const { deps, tools } = buildTools();
      deps.journalEntriesService.findOne.mockResolvedValue(POSTED);

      const previewResult = await preview(tools, 'post_journal_entry', {
        entry_id: 901,
      });
      expect(previewResult.status).toBe('error');
      expect(previewResult.message).toContain('posted');

      const answer = await run(tools, 'post_journal_entry', { entry_id: 901 });
      expect(answer.error).toContain('ya no está en borrador');
      expect(answer.next_step).toContain('F-1');
      expect(deps.entryFlowService.post).not.toHaveBeenCalled();
    });

    it('F-4 preview warning: anuncia el asiento de reversión', async () => {
      const { deps, tools } = buildTools();
      deps.journalEntriesService.findOne.mockResolvedValue(POSTED);

      const result = await preview(tools, 'void_journal_entry', {
        entry_id: 901,
      });

      expect(result.status).toBe('warning');
      expect(result.target).toContain('MAN-2026-000001');
      expect(result.changes).toContainEqual(
        expect.objectContaining({
          field: 'reversal',
          to: expect.stringContaining('efecto neto cero'),
        }),
      );
    });

    it('F-4 handler happy anula vía flow y reporta el reverso', async () => {
      const { deps, tools } = buildTools();
      deps.journalEntriesService.findOne.mockResolvedValue(POSTED);
      deps.entryFlowService.void.mockResolvedValue({
        voided_entry: { id: 901, entry_number: 'MAN-2026-000001' },
        reversal_entry: { entry_number: 'AE-2026-000115' },
      });

      const answer = await run(tools, 'void_journal_entry', { entry_id: 901 });

      expect(deps.entryFlowService.void).toHaveBeenCalledWith(901);
      expect(answer.voided).toEqual({
        id: 901,
        entry_number: 'MAN-2026-000001',
        status: 'voided',
        reversal_entry_number: 'AE-2026-000115',
      });
    });

    it('F-4 sad: borrador no se anula → error, void intacto', async () => {
      const { deps, tools } = buildTools();
      deps.journalEntriesService.findOne.mockResolvedValue(DRAFT);

      const answer = await run(tools, 'void_journal_entry', { entry_id: 901 });

      expect(answer.error).toContain('ya no está posteado');
      expect(deps.entryFlowService.void).not.toHaveBeenCalled();
    });
  });

  describe('create_fiscal_period (F-5) / close_fiscal_period (F-6)', () => {
    const PERIOD_ARGS = {
      name: 'Octubre 2026',
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    };

    it('F-5 preview + handler happy', async () => {
      const { deps, tools } = buildTools();
      deps.fiscalPeriodsService.findAll.mockResolvedValue([]);
      deps.fiscalPeriodsService.create.mockResolvedValue({
        id: 10,
        name: 'Octubre 2026',
        start_date: new Date('2026-10-01'),
        end_date: new Date('2026-10-31'),
        status: 'open',
        _count: { accounting_entries: 0 },
      });

      const previewResult = await preview(
        tools,
        'create_fiscal_period',
        PERIOD_ARGS,
      );
      expect(previewResult).toEqual({
        status: 'ok',
        target: 'Periodo fiscal "Octubre 2026"',
        changes: [
          {
            field: 'range',
            label: 'Rango',
            from: null,
            to: '2026-10-01 a 2026-10-31',
          },
          { field: 'status', label: 'Estado inicial', from: null, to: 'open' },
        ],
        domain: 'accounting',
      });

      const answer = await run(tools, 'create_fiscal_period', PERIOD_ARGS);
      expect(deps.fiscalPeriodsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Octubre 2026' }),
      );
      expect(answer.created).toEqual({
        id: 10,
        name: 'Octubre 2026',
        start_date: '2026-10-01',
        end_date: '2026-10-31',
        status: 'open',
        entries_count: 0,
      });
    });

    it('F-5 solape → preview error, create intacto', async () => {
      const { deps, tools } = buildTools();
      deps.fiscalPeriodsService.findAll.mockResolvedValue([
        {
          id: 9,
          name: 'Septiembre 2026',
          start_date: new Date('2026-09-01'),
          end_date: new Date('2026-10-15'),
          status: 'open',
        },
      ]);

      const result = await preview(tools, 'create_fiscal_period', PERIOD_ARGS);

      expect(result.status).toBe('error');
      expect(result.message).toContain('solapa');
      expect(deps.fiscalPeriodsService.create).not.toHaveBeenCalled();
    });

    it('F-6 preview warning con frase de consecuencia + handler happy', async () => {
      const { deps, tools } = buildTools();
      deps.fiscalPeriodsService.findOne.mockResolvedValue({
        id: 5,
        name: 'Septiembre 2026',
        start_date: new Date('2026-09-01'),
        end_date: new Date('2026-09-30'),
        status: 'open',
      });
      deps.journalEntriesService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0 },
      });
      deps.fiscalPeriodsService.close.mockResolvedValue({
        id: 5,
        name: 'Septiembre 2026',
        start_date: new Date('2026-09-01'),
        end_date: new Date('2026-09-30'),
        status: 'closed',
        closed_at: new Date('2026-10-01T05:00:00.000Z'),
        _count: { accounting_entries: 42 },
      });

      const previewResult = await preview(tools, 'close_fiscal_period', {
        fiscal_period_id: 5,
      });
      expect(previewResult.status).toBe('warning');
      expect(previewResult.message).toContain('acto de control');
      expect(previewResult.target).toContain('Septiembre 2026');

      const answer = await run(tools, 'close_fiscal_period', {
        fiscal_period_id: 5,
      });
      expect(deps.fiscalPeriodsService.close).toHaveBeenCalledWith(5);
      expect(answer.closed.status).toBe('closed');
      expect(answer.closed.entries_count).toBe(42);
    });

    it('F-6 con borradores → preview error que cita el conteo', async () => {
      const { deps, tools } = buildTools();
      deps.fiscalPeriodsService.findOne.mockResolvedValue({
        id: 5,
        name: 'Septiembre 2026',
        status: 'open',
      });
      deps.journalEntriesService.findAll.mockResolvedValue({
        data: [{ id: 1 }],
        meta: { total: 3 },
      });

      const result = await preview(tools, 'close_fiscal_period', {
        fiscal_period_id: 5,
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('3 asiento(s) en borrador');
      expect(deps.fiscalPeriodsService.close).not.toHaveBeenCalled();
    });
  });

  describe('create_puc_account (F-7) / update_puc_account (F-8)', () => {
    it('F-7 preview + handler happy', async () => {
      const { deps, tools } = buildTools();
      deps.chartOfAccountsService.findByCode.mockResolvedValue(null);
      deps.chartOfAccountsService.findOne.mockResolvedValue({
        id: 3,
        code: '1105',
        name: 'Caja',
      });
      deps.chartOfAccountsService.create.mockResolvedValue({
        id: 44,
        code: '110505',
        name: 'Caja menor oficina',
        account_type: 'asset',
        nature: 'debit',
        level: 3,
        accepts_entries: true,
        parent: { code: '1105', name: 'Caja' },
      });
      const args = {
        code: '110505',
        name: 'Caja menor oficina',
        account_type: 'asset',
        nature: 'debit',
        parent_id: 3,
        accepts_entries: true,
      };

      const previewResult = await preview(tools, 'create_puc_account', args);
      expect(previewResult.status).toBe('ok');
      expect(previewResult.target).toBe(
        'Cuenta PUC 110505 Caja menor oficina',
      );

      const answer = await run(tools, 'create_puc_account', args);
      expect(deps.chartOfAccountsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: '110505', parent_id: 3 }),
      );
      expect(answer.created).toEqual({
        id: 44,
        code: '110505',
        name: 'Caja menor oficina',
        account_type: 'asset',
        nature: 'debit',
        level: 3,
        accepts_entries: true,
        parent: '1105 Caja',
      });
    });

    it('F-7 código ocupado → preview error, create intacto', async () => {
      const { deps, tools } = buildTools();
      deps.chartOfAccountsService.findByCode.mockResolvedValue({
        id: 12,
        code: '1105',
        name: 'Caja',
      });

      const result = await preview(tools, 'create_puc_account', {
        code: '1105',
        name: 'Otra caja',
        account_type: 'asset',
        nature: 'debit',
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('ya existe');
      expect(deps.chartOfAccountsService.create).not.toHaveBeenCalled();
    });

    it('F-8 preview muestra from→to + handler happy', async () => {
      const { deps, tools } = buildTools();
      deps.chartOfAccountsService.findOne.mockResolvedValue({
        id: 44,
        code: '110505',
        name: 'Caja menor',
        parent_id: 3,
        is_active: true,
        accepts_entries: true,
      });
      deps.chartOfAccountsService.update.mockResolvedValue({
        id: 44,
        code: '110505',
        name: 'Caja menor oficina',
        level: 3,
        is_active: true,
        accepts_entries: true,
      });

      const previewResult = await preview(tools, 'update_puc_account', {
        account_id: 44,
        name: 'Caja menor oficina',
      });
      expect(previewResult).toEqual({
        status: 'ok',
        target: '110505 Caja menor',
        changes: [
          {
            field: 'name',
            label: 'Nombre',
            from: 'Caja menor',
            to: 'Caja menor oficina',
          },
        ],
        domain: 'accounting',
      });

      const answer = await run(tools, 'update_puc_account', {
        account_id: 44,
        name: 'Caja menor oficina',
      });
      expect(deps.chartOfAccountsService.update).toHaveBeenCalledWith(
        44,
        expect.objectContaining({ name: 'Caja menor oficina' }),
      );
      expect(answer.updated.name).toBe('Caja menor oficina');
    });

    it('F-8 sin campos → preview error, update intacto', async () => {
      const { deps, tools } = buildTools();
      deps.chartOfAccountsService.findOne.mockResolvedValue({
        id: 44,
        code: '110505',
        name: 'Caja menor',
      });

      const result = await preview(tools, 'update_puc_account', {
        account_id: 44,
      });

      expect(result.status).toBe('error');
      expect(deps.chartOfAccountsService.update).not.toHaveBeenCalled();
    });
  });

  describe('update_account_mapping (F-10) / reset_account_mappings (F-11)', () => {
    const ACCOUNT = {
      id: 88,
      code: '240802',
      name: 'IVA generado',
      accepts_entries: true,
    };

    it('F-10 preview + handler happy: solo override, defaults intactos', async () => {
      const { deps, tools } = buildTools();
      deps.chartOfAccountsService.findByCode.mockResolvedValue(ACCOUNT);
      deps.accountMappingService.getMapping.mockResolvedValue({
        account_code: '2408',
        source: 'default',
      });
      deps.accountMappingService.bulkUpsertMappings.mockResolvedValue([{}]);
      const args = {
        mapping_key: 'invoice.validated.vat_payable',
        account_code: '240802',
      };

      const previewResult = await preview(
        tools,
        'update_account_mapping',
        args,
      );
      expect(previewResult.status).toBe('ok');
      expect(previewResult.target).toBe(
        'invoice.validated.vat_payable → 240802 IVA generado',
      );
      expect(previewResult.message).toContain('Solo se escribe el override');

      const answer = await run(tools, 'update_account_mapping', args);
      expect(
        deps.accountMappingService.bulkUpsertMappings,
      ).toHaveBeenCalledWith(
        3,
        [{ mapping_key: 'invoice.validated.vat_payable', account_id: 88 }],
        7,
      );
      expect(answer.updated).toEqual({
        mapping_key: 'invoice.validated.vat_payable',
        previous_account_code: '2408',
        previous_source: 'default',
        account_code: '240802',
        account_name: 'IVA generado',
        scope: 'store',
      });
    });

    it('F-10 clave desconocida → preview error con F-9', async () => {
      const { deps, tools } = buildTools();
      deps.chartOfAccountsService.findByCode.mockResolvedValue(ACCOUNT);
      deps.accountMappingService.getMapping.mockResolvedValue(null);

      const result = await preview(tools, 'update_account_mapping', {
        mapping_key: 'inventada.clave',
        account_code: '240802',
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('F-9');
      expect(
        deps.accountMappingService.bulkUpsertMappings,
      ).not.toHaveBeenCalled();
    });

    it('F-10 cuenta no-hoja → warning (aprobable, pero avisa)', async () => {
      const { deps, tools } = buildTools();
      deps.chartOfAccountsService.findByCode.mockResolvedValue({
        ...ACCOUNT,
        accepts_entries: false,
      });
      deps.accountMappingService.getMapping.mockResolvedValue({
        account_code: '2408',
        source: 'default',
      });

      const result = await preview(tools, 'update_account_mapping', {
        mapping_key: 'invoice.validated.vat_payable',
        account_code: '240802',
      });

      expect(result.status).toBe('warning');
      expect(result.message).toContain('no acepta movimientos');
    });

    it('F-11 preview + handler happy: borra overrides, cita claves', async () => {
      const { deps, tools } = buildTools();
      deps.accountMappingService.getMappings.mockResolvedValue([
        {
          mapping_key: 'payment.received.cash',
          account_code: '110501',
          source: 'store',
        },
        {
          mapping_key: 'invoice.validated.vat_payable',
          account_code: '240802',
          source: 'organization',
        },
        {
          mapping_key: 'invoice.validated.revenue',
          account_code: '4135',
          source: 'default',
        },
      ]);
      deps.accountMappingService.resetToDefaults.mockResolvedValue(undefined);

      const previewResult = await preview(
        tools,
        'reset_account_mappings',
        {},
      );
      expect(previewResult.status).toBe('warning');
      expect(previewResult.target).toContain('2 override(s)');
      expect(previewResult.changes).toHaveLength(2);

      const answer = await run(tools, 'reset_account_mappings', {});
      expect(
        deps.accountMappingService.resetToDefaults,
      ).toHaveBeenCalledWith(3, 7);
      expect(answer.reset).toEqual({
        overrides_removed: 2,
        scope: 'store',
        keys: ['payment.received.cash', 'invoice.validated.vat_payable'],
      });
    });

    it('F-11 sin overrides → preview error, reset intacto', async () => {
      const { deps, tools } = buildTools();
      deps.accountMappingService.getMappings.mockResolvedValue([
        {
          mapping_key: 'invoice.validated.revenue',
          account_code: '4135',
          source: 'default',
        },
      ]);

      const result = await preview(tools, 'reset_account_mappings', {});

      expect(result.status).toBe('error');
      expect(result.message).toContain('No hay overrides');
      expect(
        deps.accountMappingService.resetToDefaults,
      ).not.toHaveBeenCalled();
    });
  });

  describe('retry_entry_failure (F-13)', () => {
    const FAILURE = {
      id: 77,
      handler_key: 'payment.received',
      source_type: 'payment.received',
      source_id: 4821,
      error_message: 'Unbalanced entry: debit=33000, credit=30000',
      attempt_count: 3,
      resolved_at: null,
    };

    it('(b) preview + handler happy citan el fallo F-12', async () => {
      const { deps, tools } = buildTools();
      deps.entryFailureService.findOne.mockResolvedValue(FAILURE);
      deps.entryFailureService.enqueueRetry.mockResolvedValue(undefined);

      const previewResult = await preview(tools, 'retry_entry_failure', {
        failure_id: 77,
      });
      expect(previewResult).toEqual({
        status: 'ok',
        target: 'payment.received — payment.received #4821',
        changes: [
          {
            field: 'retry',
            label: 'Reintento',
            from: 'fallido (3 intento(s))',
            to: 'reintento encolado',
          },
        ],
        message: expect.stringContaining('Unbalanced entry'),
        domain: 'accounting',
      });

      const answer = await run(tools, 'retry_entry_failure', {
        failure_id: 77,
      });
      expect(deps.entryFailureService.enqueueRetry).toHaveBeenCalledWith(77);
      expect(answer.enqueued).toEqual({
        failure_id: 77,
        handler_key: 'payment.received',
        source: { type: 'payment.received', id: 4821 },
      });
      expect(answer.next_step).toContain('F-12');
    });

    it('fallo ya resuelto → preview error, enqueue intacto', async () => {
      const { deps, tools } = buildTools();
      deps.entryFailureService.findOne.mockResolvedValue({
        ...FAILURE,
        resolved_at: new Date('2026-09-16'),
      });

      const result = await preview(tools, 'retry_entry_failure', {
        failure_id: 77,
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('ya está resuelto');
      expect(deps.entryFailureService.enqueueRetry).not.toHaveBeenCalled();
    });

    it('(a) sad: failure_id inválido no toca services', async () => {
      const { deps, tools } = buildTools();

      const answer = await run(tools, 'retry_entry_failure', {
        failure_id: -2,
      });

      expect(answer.error).toContain('failure_id inválido');
      expect(answer.next_step).toContain('F-12');
      expect(deps.entryFailureService.findOne).not.toHaveBeenCalled();
      expect(deps.entryFailureService.enqueueRetry).not.toHaveBeenCalled();
    });
  });
});
