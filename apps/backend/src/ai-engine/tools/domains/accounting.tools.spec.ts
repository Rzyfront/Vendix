import {
  createAccountingTools,
  AccountingToolDeps,
} from './accounting.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Paso 6 track A — contrato F-1 / F-9 / F-12 (reads P0 contables).
 *
 * Patrón canónico T4: (a) happy/sad con sad sin tocar deps, (b) snapshot de
 * salida con literales (`toEqual`, sin `.snap`), (c) forma
 * `{error, next_step}` en ES en los fallos guiados, (d) permiso declarado por
 * tool, (e) `readOnly: true` en los 3 reads sin `requiresConfirmation`.
 *
 * La familia contable ya traía 8 reads sin spec; esta spec pinnea la lista
 * completa de 11 para que F-2..F-13 (paso 11) extiendan la spec —y no sólo el
 * factory— cuando agreguen writes.
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
      fiscalPeriodsService: {},
      journalEntriesService: { findAll: jest.fn(), findOne: jest.fn() },
      chartOfAccountsService: {},
      fiscalScopeService: {
        findFiscalAccountingEntityId: jest.fn().mockResolvedValue(55),
      },
      prisma: {
        accounting_entities: {
          findFirst: jest.fn().mockResolvedValue(ENTITY_ROW),
        },
      },
      accountMappingService: { getMappings: jest.fn(), getMapping: jest.fn() },
      entryFailureService: { listUnresolved: jest.fn(), findOne: jest.fn() },
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

  describe('registro', () => {
    it('expone exactamente los 11 tools del dominio accounting', () => {
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
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('accounting');
        expect(tool.version).toBe('1');
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
});
