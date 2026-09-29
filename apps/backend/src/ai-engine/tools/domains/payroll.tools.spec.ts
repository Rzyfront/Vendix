import { createPayrollTools, PayrollToolDeps } from './payroll.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * F-50..F-70 — Spec de contrato de la familia payroll (patrón canónico T4;
 * P0 escrita en el paso 7, writes + P1/P2 en el paso 12).
 *
 * (a) validación happy/sad — el sad no toca las deps mockeadas;
 * (b) snapshot JSON exacto de la salida happy (literales con `toEqual`);
 * (c) forma `{error, next_step}` en español en los fallos guiados;
 * (d) permiso declarado por tool;
 * (e) writes con `requiresConfirmation: true` + `preview` con sujeto humano
 *     y re-verificación en `handler`; reads puras con `readOnly: true`.
 *
 * Permisos blindados: `store:payroll:runs:read/manage` (seed;
 * `PayrollRunsController` no declara ninguno — gap heredado documentado en
 * el factory) + employees/novelties/advances/settlements leídos de sus
 * controllers (paso 12).
 */
describe('payroll.tools · contrato canónico T4', () => {
  const STORE_ID = 7;
  const ORG_ID = 3;

  function baseDeps() {
    return {
      payrollRunsService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
      },
      payrollFlowService: {
        getDianStatus: jest.fn(),
        calculate: jest.fn(),
        approve: jest.fn(),
        pay: jest.fn(),
        sendToDian: jest.fn(),
      },
      pilaReportService: {
        getContributionsForPeriod: jest.fn(),
        generateFlatFile: jest.fn(),
        getSubmissionHistory: jest.fn(),
      },
      employeesService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
      },
      employeeFiscalProfileService: {
        getOrCreate: jest.fn(),
      },
      noveltiesService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
      },
      advancesService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        approve: jest.fn(),
        reject: jest.fn(),
        cancel: jest.fn(),
      },
      settlementsService: {
        findOne: jest.fn(),
      },
      settlementFlowService: {
        createAndCalculate: jest.fn(),
        approve: jest.fn(),
        pay: jest.fn(),
      },
      payrollBankExportService: {
        validateEmployeeBankData: jest.fn(),
        exportBatch: jest.fn(),
      },
    } as any satisfies PayrollToolDeps;
  }

  function buildTools(deps = baseDeps()) {
    return { deps, tools: createPayrollTools(deps) };
  }

  function getTool(tools: RegisteredTool[], name: string) {
    const tool = tools.find((registered) => registered.name === name);
    if (!tool) throw new Error(`${name} no registrado`);
    return tool;
  }

  const run = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = {
      store_id: STORE_ID,
      organization_id: ORG_ID,
    },
  ) => {
    const tool = getTool(tools, name);
    if (!tool.handler) throw new Error(`${name} sin handler`);
    return JSON.parse(await tool.handler(args, context as any));
  };

  const preview = async (
    tools: RegisteredTool[],
    name: string,
    args: Record<string, any>,
    context: Record<string, any> = {
      store_id: STORE_ID,
      organization_id: ORG_ID,
    },
  ) => {
    const tool = getTool(tools, name);
    if (!tool.preview) throw new Error(`${name} sin preview`);
    return tool.preview(args, context as any);
  };

  const WRITE_TOOLS = [
    'calculate_payroll',
    'approve_payroll',
    'pay_payroll',
    'send_payroll_dian',
    'create_payroll_novelty',
    'approve_advance',
    'calculate_settlement',
    'approve_settlement',
    'pay_settlement',
  ];

  const READ_TOOLS = [
    'list_payroll_runs',
    'get_payroll_run',
    'get_payroll_dian_status',
    'get_pila_report',
    'export_payroll_ach',
    'list_employees',
    'get_employee',
    'get_employee_fiscal_profile',
    'list_payroll_novelties',
    'list_employee_advances',
    'get_pila_flatfile',
    'list_pila_submissions',
  ];

  // ─── (d)+(e) Registro: permisos, categoría y forma ────────────────────
  describe('registro', () => {
    it('expone exactamente las 21 tools F-50..F-70 de nómina/PILA', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'list_payroll_runs',
        'get_payroll_run',
        'get_payroll_dian_status',
        'get_pila_report',
        'calculate_payroll',
        'approve_payroll',
        'pay_payroll',
        'send_payroll_dian',
        'export_payroll_ach',
        'list_employees',
        'get_employee',
        'get_employee_fiscal_profile',
        'list_payroll_novelties',
        'create_payroll_novelty',
        'list_employee_advances',
        'approve_advance',
        'calculate_settlement',
        'approve_settlement',
        'pay_settlement',
        'get_pila_flatfile',
        'list_pila_submissions',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('payroll');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('cada tool exige su permiso verificado en código', () => {
      const { tools } = buildTools();
      const expected: Record<string, string[]> = {
        list_payroll_runs: ['store:payroll:runs:read'],
        get_payroll_run: ['store:payroll:runs:read'],
        get_payroll_dian_status: ['store:payroll:runs:read'],
        get_pila_report: ['store:payroll:runs:read'],
        calculate_payroll: ['store:payroll:runs:manage'],
        approve_payroll: ['store:payroll:runs:manage'],
        pay_payroll: ['store:payroll:runs:manage'],
        send_payroll_dian: ['store:payroll:runs:manage'],
        export_payroll_ach: ['store:payroll:runs:read'],
        list_employees: ['store:payroll:employees:read'],
        get_employee: ['store:payroll:employees:read'],
        get_employee_fiscal_profile: ['store:payroll:employees:read'],
        list_payroll_novelties: ['store:payroll:novelties:read'],
        create_payroll_novelty: ['store:payroll:novelties:create'],
        list_employee_advances: ['store:payroll:advances:read'],
        approve_advance: [
          'store:payroll:advances:approve',
          'store:payroll:advances:manage',
        ],
        calculate_settlement: ['store:payroll:settlements:create'],
        approve_settlement: ['store:payroll:settlements:manage'],
        pay_settlement: ['store:payroll:settlements:manage'],
        get_pila_flatfile: ['store:payroll:runs:read'],
        list_pila_submissions: ['store:payroll:runs:read'],
      };
      for (const tool of tools) {
        expect(tool.requiredPermissions).toEqual(expected[tool.name]);
      }
    });

    it('los 12 reads son puros sin circuito de escritura', () => {
      const { tools } = buildTools();
      expect(READ_TOOLS).toHaveLength(12);
      for (const name of READ_TOOLS) {
        const tool = getTool(tools, name);
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
        expect(tool.clientSide ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('los 9 writes exigen confirmación con preview real', () => {
      const { tools } = buildTools();
      expect(WRITE_TOOLS).toHaveLength(9);
      for (const name of WRITE_TOOLS) {
        const tool = getTool(tools, name);
        expect(tool.requiresConfirmation).toBe(true);
        expect(typeof tool.preview).toBe('function');
        expect(tool.readOnly ?? false).toBe(false);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('declara requeridos del JSON Schema', () => {
      const { tools } = buildTools();
      expect(getTool(tools, 'list_payroll_runs').parameters.required).toEqual(
        [],
      );
      expect(getTool(tools, 'get_payroll_run').parameters.required).toEqual([
        'payroll_run_id',
      ]);
      expect(
        getTool(tools, 'get_payroll_dian_status').parameters.required,
      ).toEqual(['payroll_run_id']);
      expect(getTool(tools, 'get_pila_report').parameters.required).toEqual([
        'year',
        'month',
      ]);
      expect(getTool(tools, 'calculate_payroll').parameters.required).toEqual([
        'payroll_run_id',
      ]);
      expect(getTool(tools, 'approve_payroll').parameters.required).toEqual([
        'payroll_run_id',
      ]);
      expect(getTool(tools, 'pay_payroll').parameters.required).toEqual([
        'payroll_run_id',
      ]);
      expect(getTool(tools, 'send_payroll_dian').parameters.required).toEqual([
        'payroll_run_id',
      ]);
      expect(getTool(tools, 'export_payroll_ach').parameters.required).toEqual([
        'payroll_run_id',
        'bank',
      ]);
      expect(getTool(tools, 'list_employees').parameters.required).toEqual([]);
      expect(getTool(tools, 'get_employee').parameters.required).toEqual([
        'employee_id',
      ]);
      expect(
        getTool(tools, 'get_employee_fiscal_profile').parameters.required,
      ).toEqual(['employee_id']);
      expect(
        getTool(tools, 'list_payroll_novelties').parameters.required,
      ).toEqual([]);
      expect(
        getTool(tools, 'create_payroll_novelty').parameters.required,
      ).toEqual(['employee_id', 'novelty_type', 'date_start']);
      expect(
        getTool(tools, 'list_employee_advances').parameters.required,
      ).toEqual([]);
      expect(getTool(tools, 'approve_advance').parameters.required).toEqual([
        'advance_id',
        'action',
      ]);
      expect(
        getTool(tools, 'calculate_settlement').parameters.required,
      ).toEqual(['employee_id', 'termination_date', 'termination_reason']);
      expect(getTool(tools, 'approve_settlement').parameters.required).toEqual([
        'settlement_id',
      ]);
      expect(getTool(tools, 'pay_settlement').parameters.required).toEqual([
        'settlement_id',
      ]);
      expect(getTool(tools, 'get_pila_flatfile').parameters.required).toEqual([
        'year',
        'month',
      ]);
      expect(
        getTool(tools, 'list_pila_submissions').parameters.required,
      ).toEqual([]);
    });
  });

  // ─── F-50: list_payroll_runs ───────────────────────────────────────────
  describe('list_payroll_runs (F-50)', () => {
    const runRow = {
      id: 12,
      payroll_number: 'NOM-2026-0012',
      status: 'calculated',
      frequency: 'monthly',
      period_start: new Date('2026-08-01T00:00:00.000Z'),
      period_end: new Date('2026-08-31T00:00:00.000Z'),
      payment_date: null,
      dian_status: 'not_applicable',
      cune: null,
      total_earnings: 5200000,
      total_deductions: 832000,
      total_employer_costs: 1248000,
      total_net_pay: 4368000,
      store: { name: 'Tienda Centro' },
    };

    it('(b) happy: proyecta estado + totales + meta del service', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findAll.mockResolvedValue({
        data: [runRow],
        meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
      });

      const out = await run(tools, 'list_payroll_runs', { status: 'calculated' });

      expect(deps.payrollRunsService.findAll).toHaveBeenCalledTimes(1);
      expect(out).toEqual({
        data: [
          {
            id: 12,
            payroll_number: 'NOM-2026-0012',
            status: 'calculated',
            frequency: 'monthly',
            period_start: '2026-08-01T00:00:00.000Z',
            period_end: '2026-08-31T00:00:00.000Z',
            payment_date: null,
            dian_status: 'not_applicable',
            cune: null,
            totals: {
              total_earnings: 5200000,
              total_deductions: 832000,
              total_employer_costs: 1248000,
              total_net_pay: 4368000,
            },
            store: 'Tienda Centro',
          },
        ],
        meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
      });
    });

    it('(a) sad: filtro con tipo inválido no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(tools, 'list_payroll_runs', {
        date_from: 'no-es-fecha',
      });

      expect(deps.payrollRunsService.findAll).not.toHaveBeenCalled();
      expect(out.error).toMatch(/validación/i);
      expect(typeof out.next_step).toBe('string');
    });

    it('(c) service caído → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findAll.mockRejectedValue(
        new Error('db down'),
      );

      const out = await run(tools, 'list_payroll_runs', {});

      expect(out.error).toMatch(/No pude listar las nóminas/);
      expect(out.next_step).toMatch(/filtros/);
    });
  });

  // ─── F-51: get_payroll_run ─────────────────────────────────────────────
  describe('get_payroll_run (F-51)', () => {
    const detailRow = {
      id: 12,
      payroll_number: 'NOM-2026-0012',
      status: 'approved',
      frequency: 'monthly',
      period_start: new Date('2026-08-01T00:00:00.000Z'),
      period_end: new Date('2026-08-31T00:00:00.000Z'),
      payment_date: new Date('2026-09-05T00:00:00.000Z'),
      dian_status: 'not_applicable',
      cune: null,
      accounting_status: 'blocked',
      total_earnings: '5200000.00',
      total_deductions: '832000.00',
      total_employer_costs: '1248000.00',
      total_net_pay: '4368000.00',
      payroll_items: [
        {
          employee_id: 4,
          base_salary: '2600000.00',
          total_earnings: '2600000.00',
          total_deductions: '416000.00',
          net_pay: '2184000.00',
          dian_status: 'not_applicable',
          employee: {
            first_name: 'Ana',
            last_name: 'Ríos',
            employee_code: 'EMP-004',
            document_number: '12345678',
          },
        },
      ],
    };

    it('(b) happy: estado + totales + resumen por empleado, JSON-safe', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue(detailRow);

      const out = await run(tools, 'get_payroll_run', { payroll_run_id: 12 });

      expect(deps.payrollRunsService.findOne).toHaveBeenCalledWith(12);
      expect(out).toEqual({
        id: 12,
        payroll_number: 'NOM-2026-0012',
        status: 'approved',
        frequency: 'monthly',
        period_start: '2026-08-01T00:00:00.000Z',
        period_end: '2026-08-31T00:00:00.000Z',
        payment_date: '2026-09-05T00:00:00.000Z',
        dian_status: 'not_applicable',
        cune: null,
        accounting_status: 'blocked',
        totals: {
          total_earnings: 5200000,
          total_deductions: 832000,
          total_employer_costs: 1248000,
          total_net_pay: 4368000,
        },
        employee_count: 1,
        items: [
          {
            employee_id: 4,
            employee_name: 'Ana Ríos',
            document_number: '12345678',
            base_salary: 2600000,
            total_earnings: 2600000,
            total_deductions: 416000,
            net_pay: 2184000,
            dian_status: 'not_applicable',
          },
        ],
      });
    });

    it('(a) sad: id inválido no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(tools, 'get_payroll_run', { payroll_run_id: -3 });

      expect(deps.payrollRunsService.findOne).not.toHaveBeenCalled();
      expect(out.error).toMatch(/payroll_run_id inválido/);
      expect(out.next_step).toMatch(/list_payroll_runs/);
    });

    it('(c) nómina inexistente → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockRejectedValue(
        new Error('Payroll run not found'),
      );

      const out = await run(tools, 'get_payroll_run', { payroll_run_id: 999 });

      expect(out.error).toMatch(/#999/);
      expect(out.next_step).toMatch(/list_payroll_runs/);
    });
  });

  // ─── F-56: get_payroll_dian_status ─────────────────────────────────────
  describe('get_payroll_dian_status (F-56)', () => {
    it('(b) happy: transporta estado DIAN + CUNE del flow service', async () => {
      const { deps, tools } = buildTools();
      deps.payrollFlowService.getDianStatus.mockResolvedValue({
        payroll_run_id: 12,
        payroll_number: 'NOM-2026-0012',
        current_status: 'sent',
        dian_status: { status: 'accepted', cune: 'abc123' },
      });

      const out = await run(tools, 'get_payroll_dian_status', {
        payroll_run_id: 12,
      });

      expect(deps.payrollFlowService.getDianStatus).toHaveBeenCalledWith(12);
      expect(out).toEqual({
        payroll_run_id: 12,
        payroll_number: 'NOM-2026-0012',
        current_status: 'sent',
        dian_status: { status: 'accepted', cune: 'abc123' },
      });
    });

    it('(a) sad: id inválido no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(tools, 'get_payroll_dian_status', {
        payroll_run_id: 'x',
      });

      expect(deps.payrollFlowService.getDianStatus).not.toHaveBeenCalled();
      expect(out.error).toMatch(/payroll_run_id inválido/);
      expect(typeof out.next_step).toBe('string');
    });

    it('(c) run sin CUNE → {error, next_step} que pide F-51 primero', async () => {
      const { deps, tools } = buildTools();
      deps.payrollFlowService.getDianStatus.mockRejectedValue(
        new Error('This payroll run has not been sent to DIAN yet'),
      );

      const out = await run(tools, 'get_payroll_dian_status', {
        payroll_run_id: 12,
      });

      expect(out.error).toMatch(/estado DIAN/);
      expect(out.next_step).toMatch(/get_payroll_run/);
    });
  });

  // ─── F-68: get_pila_report ─────────────────────────────────────────────
  describe('get_pila_report (F-68)', () => {
    const report = {
      year: 2026,
      month: 8,
      employees: [
        {
          employee_id: 4,
          document_type: 'CC',
          document_number: '12345678',
          full_name: 'Ana Ríos',
          salary_type: 'ordinary',
          base_salary: 2600000,
          ibc: 2600000,
          worked_days: 30,
          health_employee: 104000,
          health_employer: 0,
          pension_employee: 104000,
          pension_employer: 312000,
          arl: 13572,
          sena: 0,
          icbf: 0,
          compensation_fund: 104000,
          exonerated: true,
        },
      ],
      totals: {
        ibc: 2600000,
        health_employee: 104000,
        health_employer: 0,
        pension_employee: 104000,
        pension_employer: 312000,
        arl: 13572,
        sena: 0,
        icbf: 0,
        compensation_fund: 104000,
        total: 641572,
      },
    };

    it('(b) happy: reporte + totales + advertencia de layout sin validar', async () => {
      const { deps, tools } = buildTools();
      deps.pilaReportService.getContributionsForPeriod.mockResolvedValue(
        report,
      );

      const out = await run(tools, 'get_pila_report', { year: 2026, month: 8 });

      expect(
        deps.pilaReportService.getContributionsForPeriod,
      ).toHaveBeenCalledWith(2026, 8);
      expect(out.year).toBe(2026);
      expect(out.month).toBe(8);
      expect(out.employee_count).toBe(1);
      expect(out.totals).toEqual(report.totals);
      expect(out.employees).toEqual(report.employees);
      expect(out.layout_warning).toMatch(/no está validado contra un operador/);
    });

    it('(a) sad: mes fuera de rango no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(tools, 'get_pila_report', { year: 2026, month: 13 });

      expect(
        deps.pilaReportService.getContributionsForPeriod,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/validación/i);
      expect(out.next_step).toMatch(/year.*month|month.*year/i);
    });

    it('(c) service caído → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.pilaReportService.getContributionsForPeriod.mockRejectedValue(
        new Error('rules missing'),
      );

      const out = await run(tools, 'get_pila_report', { year: 2026, month: 8 });

      expect(out.error).toMatch(/reporte PILA/);
      expect(out.next_step).toMatch(/nóminas/);
    });
  });

  // ─── Helpers del paso 12 ───────────────────────────────────────────────
  const draftRun = {
    id: 12,
    payroll_number: 'NOM-2026-0012',
    status: 'draft',
    frequency: 'monthly',
    period_start: new Date('2026-08-01T00:00:00.000Z'),
    period_end: new Date('2026-08-31T00:00:00.000Z'),
    payment_date: null,
    dian_status: 'not_applicable',
    cune: null,
    total_earnings: 0,
    total_deductions: 0,
    total_employer_costs: 0,
    total_net_pay: 0,
    payroll_items: [],
  };

  const calculatedRun = {
    ...draftRun,
    status: 'calculated',
    total_earnings: '5200000.00',
    total_deductions: '832000.00',
    total_employer_costs: '1248000.00',
    total_net_pay: '4368000.00',
    payroll_items: [
      {
        employee_id: 4,
        base_salary: '2600000.00',
        total_earnings: '2600000.00',
        total_deductions: '416000.00',
        net_pay: '2184000.00',
        dian_status: 'not_applicable',
        employee: {
          first_name: 'Ana',
          last_name: 'Ríos',
          employee_code: 'EMP-004',
          document_number: '12345678',
        },
      },
    ],
  };

  const activeEmployee = {
    id: 4,
    employee_code: 'EMP-004',
    first_name: 'Ana',
    last_name: 'Ríos',
    document_type: 'CC',
    document_number: '12345678',
    status: 'active',
    contract_type: 'indefinite',
    position: 'Cajera',
    department: 'Ventas',
    base_salary: '2600000.00',
    salary_type: 'ordinary',
    hire_date: new Date('2024-02-01T00:00:00.000Z'),
    bank_name: 'Bancolombia',
    bank_account_type: 'savings',
    bank_account_number: '12345678901',
    employee_stores: [
      { store_id: 7, is_primary: true, store: { name: 'Tienda Centro' } },
    ],
  };

  // ─── F-52: calculate_payroll ───────────────────────────────────────────
  describe('calculate_payroll (F-52)', () => {
    it('(e) preview ok con sujeto humano y cadena F-51 draft', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue(draftRun);

      const card = await preview(tools, 'calculate_payroll', {
        payroll_run_id: 12,
      });

      expect(deps.payrollRunsService.findOne).toHaveBeenCalledWith(12);
      expect(deps.payrollFlowService.calculate).not.toHaveBeenCalled();
      expect(card.status).toBe('ok');
      expect(card.target).toContain('NOM-2026-0012');
      expect(card.changes).toEqual([
        { field: 'estado', label: 'Estado', from: 'draft', to: 'calculated' },
        {
          field: 'liquidacion',
          label: 'Liquidación',
          from: null,
          to: 'IBC, salud/pensión/ARL, provisiones y retefuente por empleado',
        },
      ]);
      expect(card.message).toMatch(/F-51.*draft/);
      expect(card.domain).toBe('payroll');
    });

    it('(e) preview error cuando la nómina no está en draft', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue(calculatedRun);

      const card = await preview(tools, 'calculate_payroll', {
        payroll_run_id: 12,
      });

      expect(card.status).toBe('error');
      expect(card.changes).toEqual([]);
      expect(card.message).toMatch(/calculated.*draft|draft.*calculated/);
    });

    it('(b) happy: calcula tras re-verificar draft', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue(draftRun);
      deps.payrollFlowService.calculate.mockResolvedValue(calculatedRun);

      const out = await run(tools, 'calculate_payroll', {
        payroll_run_id: 12,
      });

      expect(deps.payrollFlowService.calculate).toHaveBeenCalledWith(12);
      expect(out).toEqual({
        id: 12,
        payroll_number: 'NOM-2026-0012',
        status: 'calculated',
        employee_count: 1,
        totals: {
          total_earnings: 5200000,
          total_deductions: 832000,
          total_employer_costs: 1248000,
          total_net_pay: 4368000,
        },
      });
    });

    it('(a) sad: el handler re-verifica y no calcula si el estado cambió', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue({
        ...calculatedRun,
        status: 'paid',
      });

      const out = await run(tools, 'calculate_payroll', {
        payroll_run_id: 12,
      });

      expect(deps.payrollFlowService.calculate).not.toHaveBeenCalled();
      expect(out.error).toMatch(/paid/);
      expect(out.next_step).toMatch(/F-51/);
    });
  });

  // ─── F-53: approve_payroll ─────────────────────────────────────────────
  describe('approve_payroll (F-53)', () => {
    it('(e) preview ok cita neto + empleados, cadena F-51 calculated', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue(calculatedRun);

      const card = await preview(tools, 'approve_payroll', {
        payroll_run_id: 12,
      });

      expect(card.status).toBe('ok');
      expect(card.target).toContain('NOM-2026-0012');
      expect(card.changes).toContainEqual({
        field: 'estado',
        label: 'Estado',
        from: 'calculated',
        to: 'approved',
      });
      expect(card.changes).toContainEqual({
        field: 'neto_a_pagar',
        label: 'Neto a pagar',
        from: null,
        to: 4368000,
      });
      expect(card.message).toMatch(/F-51.*calculated/);
    });

    it('(b) happy: aprueba y estampa fecha', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue(calculatedRun);
      deps.payrollFlowService.approve.mockResolvedValue({
        ...calculatedRun,
        status: 'approved',
        approved_at: new Date('2026-09-02T10:00:00.000Z'),
      });

      const out = await run(tools, 'approve_payroll', {
        payroll_run_id: 12,
      });

      expect(deps.payrollFlowService.approve).toHaveBeenCalledWith(12);
      expect(out.status).toBe('approved');
      expect(out.approved_at).toBe('2026-09-02T10:00:00.000Z');
      expect(out.totals.total_net_pay).toBe(4368000);
    });

    it('(c) estado previo inválido → {error, next_step} sin aprobar', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue(draftRun);

      const out = await run(tools, 'approve_payroll', {
        payroll_run_id: 12,
      });

      expect(deps.payrollFlowService.approve).not.toHaveBeenCalled();
      expect(out.error).toMatch(/draft/);
      expect(out.next_step).toMatch(/F-51/);
    });
  });

  // ─── F-54: pay_payroll ─────────────────────────────────────────────────
  describe('pay_payroll (F-54)', () => {
    it('(e) preview ok desde approved, cadena F-51 approved/sent', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue({
        ...calculatedRun,
        status: 'approved',
      });

      const card = await preview(tools, 'pay_payroll', {
        payroll_run_id: 12,
      });

      expect(card.status).toBe('ok');
      expect(card.target).toContain('NOM-2026-0012');
      expect(card.changes).toContainEqual({
        field: 'estado',
        label: 'Estado',
        from: 'approved',
        to: 'paid',
      });
      expect(card.message).toMatch(/F-51.*approved\/sent/);
    });

    it('(b) happy: paga desde sent', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue({
        ...calculatedRun,
        status: 'sent',
      });
      deps.payrollFlowService.pay.mockResolvedValue({
        ...calculatedRun,
        status: 'paid',
        payment_date: new Date('2026-09-05T00:00:00.000Z'),
      });

      const out = await run(tools, 'pay_payroll', { payroll_run_id: 12 });

      expect(deps.payrollFlowService.pay).toHaveBeenCalledWith(12);
      expect(out.status).toBe('paid');
      expect(out.payment_date).toBe('2026-09-05T00:00:00.000Z');
    });

    it('(a) sad: id inválido no toca services', async () => {
      const { deps, tools } = buildTools();

      const out = await run(tools, 'pay_payroll', { payroll_run_id: 0 });

      expect(deps.payrollRunsService.findOne).not.toHaveBeenCalled();
      expect(deps.payrollFlowService.pay).not.toHaveBeenCalled();
      expect(out.error).toMatch(/payroll_run_id inválido/);
    });
  });

  // ─── F-55: send_payroll_dian ───────────────────────────────────────────
  describe('send_payroll_dian (F-55)', () => {
    it('(e) preview warning con frase irreversible + cadena F-56+F-51', async () => {
      const { IRREVERSIBLE_DOMAINS } = await import(
        '../bridge/capability-registry.service'
      );
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue({
        ...calculatedRun,
        status: 'approved',
      });

      const card = await preview(tools, 'send_payroll_dian', {
        payroll_run_id: 12,
      });

      expect(typeof IRREVERSIBLE_DOMAINS.payroll).toBe('string');
      expect(card.status).toBe('warning');
      expect(card.target).toContain('NOM-2026-0012');
      expect(card.target).toContain('1 empleados');
      expect(card.message).toContain(IRREVERSIBLE_DOMAINS.payroll);
      expect(card.message).toMatch(/F-51.*F-56|F-56.*F-51/);
      expect(card.domain).toBe('payroll');
    });

    it('(b) happy: transmite y devuelve resumen DIAN', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue({
        ...calculatedRun,
        status: 'approved',
      });
      deps.payrollFlowService.sendToDian.mockResolvedValue({
        payroll_run: {
          ...calculatedRun,
          status: 'sent',
          cune: 'cune-run-1',
        },
        dian_summary: {
          total_items: 1,
          sent: 1,
          failed: 0,
          all_success: true,
          message: 'Aceptado',
        },
      });

      const out = await run(tools, 'send_payroll_dian', {
        payroll_run_id: 12,
      });

      expect(deps.payrollFlowService.sendToDian).toHaveBeenCalledWith(12);
      expect(out).toEqual({
        id: 12,
        payroll_number: 'NOM-2026-0012',
        status: 'sent',
        cune: 'cune-run-1',
        dian_summary: {
          total_items: 1,
          sent: 1,
          failed: 0,
          all_success: true,
          message: 'Aceptado',
        },
        next_step: 'Verifica el estado con get_payroll_dian_status (F-56).',
      });
    });

    it('(c) sin ítems liquidados → {error, next_step} a F-52', async () => {
      const { deps, tools } = buildTools();
      deps.payrollRunsService.findOne.mockResolvedValue({
        ...draftRun,
        status: 'approved',
      });

      const out = await run(tools, 'send_payroll_dian', {
        payroll_run_id: 12,
      });

      expect(deps.payrollFlowService.sendToDian).not.toHaveBeenCalled();
      expect(out.error).toMatch(/ítems/);
      expect(out.next_step).toMatch(/F-52/);
    });
  });

  // ─── F-57: export_payroll_ach ──────────────────────────────────────────
  describe('export_payroll_ach (F-57)', () => {
    it('(b) happy: valida banco y devuelve el lote', async () => {
      const { deps, tools } = buildTools();
      deps.payrollBankExportService.validateEmployeeBankData.mockResolvedValue(
        { valid: [{ employee_id: 4 }], invalid: [] },
      );
      deps.payrollBankExportService.exportBatch.mockResolvedValue({
        download_url: 'https://s3/ach.txt',
        file_name: 'ach.txt',
        record_count: 1,
        total_amount: 2184000,
      });

      const out = await run(tools, 'export_payroll_ach', {
        payroll_run_id: 12,
        bank: 'bancolombia',
      });

      expect(
        deps.payrollBankExportService.validateEmployeeBankData,
      ).toHaveBeenCalledWith(12);
      expect(deps.payrollBankExportService.exportBatch).toHaveBeenCalledWith(
        12,
        'bancolombia',
        undefined,
        undefined,
      );
      expect(out).toEqual({
        download_url: 'https://s3/ach.txt',
        file_name: 'ach.txt',
        record_count: 1,
        total_amount: 2184000,
        validated_employees: 1,
      });
    });

    it('(c) datos bancarios incompletos → {error, next_step} sin exportar', async () => {
      const { deps, tools } = buildTools();
      deps.payrollBankExportService.validateEmployeeBankData.mockResolvedValue(
        {
          valid: [],
          invalid: [
            {
              employee_id: 4,
              name: 'Ana Ríos',
              errors: ['Missing bank account number'],
            },
          ],
        },
      );

      const out = await run(tools, 'export_payroll_ach', {
        payroll_run_id: 12,
        bank: 'bancolombia',
      });

      expect(deps.payrollBankExportService.exportBatch).not.toHaveBeenCalled();
      expect(out.error).toMatch(/Ana Ríos/);
      expect(out.next_step).toMatch(/ficha/);
    });
  });

  // ─── F-58: list_employees ──────────────────────────────────────────────
  describe('list_employees (F-58)', () => {
    it('(b) happy: proyecta empleado + tiendas + meta', async () => {
      const { deps, tools } = buildTools();
      deps.employeesService.findAll.mockResolvedValue({
        data: [activeEmployee],
        meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
      });

      const out = await run(tools, 'list_employees', { status: 'active' });

      expect(deps.employeesService.findAll).toHaveBeenCalledTimes(1);
      expect(out).toEqual({
        data: [
          {
            id: 4,
            employee_code: 'EMP-004',
            name: 'Ana Ríos',
            document_number: '12345678',
            status: 'active',
            contract_type: 'indefinite',
            position: 'Cajera',
            department: 'Ventas',
            base_salary: 2600000,
            hire_date: '2024-02-01',
            stores: [
              { store_id: 7, store_name: 'Tienda Centro', is_primary: true },
            ],
          },
        ],
        meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
      });
    });

    it('(c) service caído → {error, next_step} guiado', async () => {
      const { deps, tools } = buildTools();
      deps.employeesService.findAll.mockRejectedValue(new Error('db down'));

      const out = await run(tools, 'list_employees', {});

      expect(out.error).toMatch(/No pude listar los empleados/);
      expect(typeof out.next_step).toBe('string');
    });
  });

  // ─── F-59: get_employee ────────────────────────────────────────────────
  describe('get_employee (F-59)', () => {
    it('(b) happy: ficha completa JSON-safe', async () => {
      const { deps, tools } = buildTools();
      deps.employeesService.findOne.mockResolvedValue(activeEmployee);

      const out = await run(tools, 'get_employee', { employee_id: 4 });

      expect(deps.employeesService.findOne).toHaveBeenCalledWith(4);
      expect(out.id).toBe(4);
      expect(out.name).toBe('Ana Ríos');
      expect(out.bank_name).toBe('Bancolombia');
      expect(out.stores).toHaveLength(1);
    });

    it('(a) sad: id inválido no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(tools, 'get_employee', { employee_id: -1 });

      expect(deps.employeesService.findOne).not.toHaveBeenCalled();
      expect(out.error).toMatch(/employee_id inválido/);
      expect(out.next_step).toMatch(/F-58/);
    });
  });

  // ─── F-60: get_employee_fiscal_profile ─────────────────────────────────
  describe('get_employee_fiscal_profile (F-60)', () => {
    it('(b) happy: perfil art. 387 con deducciones numéricas', async () => {
      const { deps, tools } = buildTools();
      deps.employeeFiscalProfileService.getOrCreate.mockResolvedValue({
        employee_id: 4,
        certificate_year: 2026,
        dependents_count: 2,
        retention_procedure: 'proc1',
        fixed_retention_rate: null,
        rate_semester: null,
        housing_interest_monthly: '150000.00',
        prepaid_medicine_monthly: '320000.00',
        voluntary_pension_monthly: '0.00',
        afc_monthly: '0.00',
      });

      const out = await run(tools, 'get_employee_fiscal_profile', {
        employee_id: 4,
      });

      expect(
        deps.employeeFiscalProfileService.getOrCreate,
      ).toHaveBeenCalledWith(4);
      expect(out).toEqual({
        employee_id: 4,
        certificate_year: 2026,
        dependents_count: 2,
        retention_procedure: 'proc1',
        fixed_retention_rate: null,
        rate_semester: null,
        housing_interest_monthly: 150000,
        prepaid_medicine_monthly: 320000,
        voluntary_pension_monthly: 0,
        afc_monthly: 0,
      });
    });

    it('(c) empleado inexistente → {error, next_step} a F-58', async () => {
      const { deps, tools } = buildTools();
      deps.employeeFiscalProfileService.getOrCreate.mockRejectedValue(
        new Error('Employee not found'),
      );

      const out = await run(tools, 'get_employee_fiscal_profile', {
        employee_id: 999,
      });

      expect(out.error).toMatch(/#999/);
      expect(out.next_step).toMatch(/F-58/);
    });
  });

  // ─── F-61: list_payroll_novelties ──────────────────────────────────────
  describe('list_payroll_novelties (F-61)', () => {
    const noveltyRow = {
      id: 31,
      employee_id: 4,
      employee: {
        first_name: 'Ana',
        last_name: 'Ríos',
        employee_code: 'EMP-004',
      },
      novelty_type: 'overtime_diurna',
      status: 'pending',
      date_start: new Date('2026-08-10T00:00:00.000Z'),
      date_end: null,
      hours: '4.00',
      days: null,
      percentage: null,
      amount: null,
      notes: 'Inventario',
      payroll_run_id: null,
      created_at: new Date('2026-08-11T10:00:00.000Z'),
    };

    it('(b) happy: proyecta novedad con nombre de empleado', async () => {
      const { deps, tools } = buildTools();
      deps.noveltiesService.findAll.mockResolvedValue({
        data: [noveltyRow],
        meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
      });

      const out = await run(tools, 'list_payroll_novelties', {
        status: 'pending',
      });

      expect(out.data).toEqual([
        {
          id: 31,
          employee_id: 4,
          employee_name: 'Ana Ríos',
          novelty_type: 'overtime_diurna',
          status: 'pending',
          date_start: '2026-08-10',
          date_end: null,
          hours: 4,
          days: null,
          percentage: null,
          amount: null,
          notes: 'Inventario',
          payroll_run_id: null,
          created_at: '2026-08-11T10:00:00.000Z',
        },
      ]);
      expect(out.meta.total).toBe(1);
    });

    it('(a) sad: tipo inválido no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(tools, 'list_payroll_novelties', {
        novelty_type: 'aguinaldo',
      });

      expect(deps.noveltiesService.findAll).not.toHaveBeenCalled();
      expect(out.error).toMatch(/validación/i);
    });
  });

  // ─── F-62: create_payroll_novelty ──────────────────────────────────────
  describe('create_payroll_novelty (F-62)', () => {
    const noveltyArgs = {
      employee_id: 4,
      novelty_type: 'overtime_diurna',
      date_start: '2026-08-10',
      hours: 4,
    };

    it('(e) preview ok con sujeto humano, cadena empleado activo', async () => {
      const { deps, tools } = buildTools();
      deps.employeesService.findOne.mockResolvedValue(activeEmployee);

      const card = await preview(tools, 'create_payroll_novelty', noveltyArgs);

      expect(deps.noveltiesService.create).not.toHaveBeenCalled();
      expect(card.status).toBe('ok');
      expect(card.target).toContain('Ana Ríos');
      expect(card.target).toContain('overtime_diurna');
      expect(card.changes).toContainEqual({
        field: 'hours',
        label: 'Horas',
        from: null,
        to: 4,
      });
      expect(card.message).toMatch(/F-59/);
    });

    it('(e) preview error con empleado inactivo', async () => {
      const { deps, tools } = buildTools();
      deps.employeesService.findOne.mockResolvedValue({
        ...activeEmployee,
        status: 'terminated',
      });

      const card = await preview(tools, 'create_payroll_novelty', noveltyArgs);

      expect(card.status).toBe('error');
      expect(card.message).toMatch(/Ana Ríos.*terminated|terminated.*Ana Ríos/);
    });

    it('(b) happy: crea tras re-verificar empleado activo', async () => {
      const { deps, tools } = buildTools();
      deps.employeesService.findOne.mockResolvedValue(activeEmployee);
      deps.noveltiesService.create.mockResolvedValue({
        id: 31,
        employee_id: 4,
        employee: { first_name: 'Ana', last_name: 'Ríos' },
        novelty_type: 'overtime_diurna',
        status: 'pending',
        date_start: new Date('2026-08-10T00:00:00.000Z'),
        date_end: null,
        hours: '4.00',
        days: null,
        percentage: null,
        amount: null,
        notes: null,
        payroll_run_id: null,
        created_at: new Date('2026-08-11T10:00:00.000Z'),
      });

      const out = await run(tools, 'create_payroll_novelty', noveltyArgs);

      expect(deps.noveltiesService.create).toHaveBeenCalledTimes(1);
      expect(out.id).toBe(31);
      expect(out.employee_name).toBe('Ana Ríos');
      expect(out.hours).toBe(4);
    });
  });

  // ─── F-63: list_employee_advances ──────────────────────────────────────
  describe('list_employee_advances (F-63)', () => {
    it('(b) happy: proyecta saldos del anticipo', async () => {
      const { deps, tools } = buildTools();
      deps.advancesService.findAll.mockResolvedValue({
        data: [
          {
            id: 9,
            employee_id: 4,
            employee: { first_name: 'Ana', last_name: 'Ríos' },
            status: 'pending',
            amount_requested: '500000.00',
            amount_approved: null,
            amount_paid: '0.00',
            amount_pending: '500000.00',
            installments: 2,
            installment_value: null,
            frequency: 'monthly',
            advance_date: new Date('2026-08-05T00:00:00.000Z'),
            approved_at: null,
            notes: null,
          },
        ],
        meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
      });

      const out = await run(tools, 'list_employee_advances', {
        status: 'pending',
      });

      expect(out.data).toEqual([
        {
          id: 9,
          employee_id: 4,
          employee_name: 'Ana Ríos',
          status: 'pending',
          amount_requested: 500000,
          amount_approved: null,
          amount_paid: 0,
          amount_pending: 500000,
          installments: 2,
          installment_value: null,
          frequency: 'monthly',
          advance_date: '2026-08-05',
          approved_at: null,
          notes: null,
        },
      ]);
    });

    it('(a) sad: estado inválido no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(tools, 'list_employee_advances', {
        status: 'perdido',
      });

      expect(deps.advancesService.findAll).not.toHaveBeenCalled();
      expect(out.error).toMatch(/validación/i);
    });
  });

  // ─── F-64: approve_advance ─────────────────────────────────────────────
  describe('approve_advance (F-64)', () => {
    const pendingAdvance = {
      id: 9,
      employee_id: 4,
      employee: { first_name: 'Ana', last_name: 'Ríos' },
      status: 'pending',
      amount_requested: '500000.00',
      amount_approved: null,
      amount_paid: '0.00',
      amount_pending: '500000.00',
      installments: 2,
      installment_value: null,
      frequency: 'monthly',
      advance_date: new Date('2026-08-05T00:00:00.000Z'),
      approved_at: null,
      notes: null,
    };

    it('(e) preview approve con monto + cuotas y cadena F-63', async () => {
      const { deps, tools } = buildTools();
      deps.advancesService.findOne.mockResolvedValue(pendingAdvance);

      const card = await preview(tools, 'approve_advance', {
        advance_id: 9,
        action: 'approve',
        amount_approved: 400000,
      });

      expect(card.status).toBe('ok');
      expect(card.target).toContain('Ana Ríos');
      expect(card.changes).toContainEqual({
        field: 'estado',
        label: 'Estado',
        from: 'pending',
        to: 'approved',
      });
      expect(card.changes).toContainEqual({
        field: 'monto_aprobado',
        label: 'Monto aprobado',
        from: null,
        to: 400000,
      });
      expect(card.message).toMatch(/F-63/);
    });

    it('(b) happy: aprueba y delega al service dueño', async () => {
      const { deps, tools } = buildTools();
      deps.advancesService.findOne.mockResolvedValue(pendingAdvance);
      deps.advancesService.approve.mockResolvedValue({
        ...pendingAdvance,
        status: 'approved',
        amount_approved: '400000.00',
      });

      const out = await run(tools, 'approve_advance', {
        advance_id: 9,
        action: 'approve',
        amount_approved: 400000,
      });

      expect(deps.advancesService.approve).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ amount_approved: 400000 }),
      );
      expect(out.status).toBe('approved');
      expect(out.amount_approved).toBe(400000);
    });

    it('(b) reject y cancel despachan a su transición', async () => {
      const first = buildTools();
      first.deps.advancesService.findOne.mockResolvedValue(pendingAdvance);
      first.deps.advancesService.reject.mockResolvedValue({
        ...pendingAdvance,
        status: 'rejected',
      });
      const rejected = await run(first.tools, 'approve_advance', {
        advance_id: 9,
        action: 'reject',
      });
      expect(rejected.status).toBe('rejected');

      const second = buildTools();
      second.deps.advancesService.findOne.mockResolvedValue(pendingAdvance);
      second.deps.advancesService.cancel.mockResolvedValue({
        ...pendingAdvance,
        status: 'cancelled',
      });
      const cancelled = await run(second.tools, 'approve_advance', {
        advance_id: 9,
        action: 'cancel',
      });
      expect(cancelled.status).toBe('cancelled');
    });

    it('(a) sad: action inválida no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(tools, 'approve_advance', {
        advance_id: 9,
        action: 'perdonar',
      });

      expect(deps.advancesService.findOne).not.toHaveBeenCalled();
      expect(out.error).toMatch(/approve, reject o cancel/);
    });

    it('(c) anticipo ya decidido → {error, next_step} sin mutar', async () => {
      const { deps, tools } = buildTools();
      deps.advancesService.findOne.mockResolvedValue({
        ...pendingAdvance,
        status: 'paid',
      });

      const out = await run(tools, 'approve_advance', {
        advance_id: 9,
        action: 'approve',
      });

      expect(deps.advancesService.approve).not.toHaveBeenCalled();
      expect(out.error).toMatch(/paid/);
      expect(out.next_step).toMatch(/F-63/);
    });
  });

  // ─── F-65: calculate_settlement ────────────────────────────────────────
  describe('calculate_settlement (F-65)', () => {
    const settlementArgs = {
      employee_id: 4,
      termination_date: '2026-08-31',
      termination_reason: 'voluntary_resignation',
    };

    const calculatedSettlement = {
      id: 5,
      settlement_number: 'LIQ-2026-0005',
      status: 'calculated',
      employee_id: 4,
      employee: { first_name: 'Ana', last_name: 'Ríos' },
      termination_date: new Date('2026-08-31T00:00:00.000Z'),
      termination_reason: 'voluntary_resignation',
      contract_type: 'indefinite',
      days_worked: 942,
      severance: '1300000.00',
      severance_interest: '156000.00',
      bonus: '650000.00',
      vacation: '975000.00',
      pending_salary: '2600000.00',
      indemnification: '0.00',
      health_deduction: '0.00',
      pension_deduction: '0.00',
      other_deductions: '0.00',
      total_deductions: '0.00',
      gross_settlement: '5681000.00',
      net_settlement: '5681000.00',
      approved_at: null,
      notes: null,
    };

    it('(e) preview ok con sujeto humano y contrato, cadena F-59', async () => {
      const { deps, tools } = buildTools();
      deps.employeesService.findOne.mockResolvedValue(activeEmployee);

      const card = await preview(
        tools,
        'calculate_settlement',
        settlementArgs,
      );

      expect(deps.settlementFlowService.createAndCalculate).not.toHaveBeenCalled();
      expect(card.status).toBe('ok');
      expect(card.target).toContain('Ana Ríos');
      expect(card.changes).toContainEqual({
        field: 'motivo',
        label: 'Motivo de retiro',
        from: null,
        to: 'voluntary_resignation',
      });
      expect(card.message).toMatch(/F-59/);
      expect(card.message).toMatch(/F-66.*F-67/);
    });

    it('(b) happy: calcula y proyecta prestaciones + neto', async () => {
      const { deps, tools } = buildTools();
      deps.employeesService.findOne.mockResolvedValue(activeEmployee);
      deps.settlementFlowService.createAndCalculate.mockResolvedValue(
        calculatedSettlement,
      );

      const out = await run(tools, 'calculate_settlement', settlementArgs);

      expect(
        deps.settlementFlowService.createAndCalculate,
      ).toHaveBeenCalledTimes(1);
      expect(out.settlement_number).toBe('LIQ-2026-0005');
      expect(out.status).toBe('calculated');
      expect(out.employee_name).toBe('Ana Ríos');
      expect(out.net_settlement).toBe(5681000);
      expect(out.earnings.severance).toBe(1300000);
    });

    it('(a) sad: motivo inválido no toca services', async () => {
      const { deps, tools } = buildTools();

      const out = await run(tools, 'calculate_settlement', {
        ...settlementArgs,
        termination_reason: 'aburrimiento',
      });

      expect(deps.employeesService.findOne).not.toHaveBeenCalled();
      expect(
        deps.settlementFlowService.createAndCalculate,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/validación/i);
    });
  });

  // ─── F-66: approve_settlement ──────────────────────────────────────────
  describe('approve_settlement (F-66)', () => {
    const calculated = {
      id: 5,
      settlement_number: 'LIQ-2026-0005',
      status: 'calculated',
      employee_id: 4,
      employee: { first_name: 'Ana', last_name: 'Ríos' },
      net_settlement: '5681000.00',
      indemnification: '0.00',
    };

    it('(e) preview ok con neto a pagar', async () => {
      const { deps, tools } = buildTools();
      deps.settlementsService.findOne.mockResolvedValue(calculated);

      const card = await preview(tools, 'approve_settlement', {
        settlement_id: 5,
      });

      expect(card.status).toBe('ok');
      expect(card.target).toContain('LIQ-2026-0005');
      expect(card.target).toContain('Ana Ríos');
      expect(card.changes).toContainEqual({
        field: 'neto_a_pagar',
        label: 'Neto a pagar',
        from: null,
        to: 5681000,
      });
    });

    it('(b) happy: aprueba tras re-verificar calculated', async () => {
      const { deps, tools } = buildTools();
      deps.settlementsService.findOne.mockResolvedValue(calculated);
      deps.settlementFlowService.approve.mockResolvedValue({
        ...calculated,
        status: 'approved',
      });

      const out = await run(tools, 'approve_settlement', {
        settlement_id: 5,
      });

      expect(deps.settlementFlowService.approve).toHaveBeenCalledWith(
        5,
        expect.anything(),
      );
      expect(out.status).toBe('approved');
    });

    it('(c) estado previo inválido → {error, next_step} a F-65', async () => {
      const { deps, tools } = buildTools();
      deps.settlementsService.findOne.mockResolvedValue({
        ...calculated,
        status: 'paid',
      });

      const out = await run(tools, 'approve_settlement', {
        settlement_id: 5,
      });

      expect(deps.settlementFlowService.approve).not.toHaveBeenCalled();
      expect(out.error).toMatch(/paid/);
      expect(out.next_step).toMatch(/F-65/);
    });
  });

  // ─── F-67: pay_settlement ──────────────────────────────────────────────
  describe('pay_settlement (F-67)', () => {
    const approved = {
      id: 5,
      settlement_number: 'LIQ-2026-0005',
      status: 'approved',
      employee_id: 4,
      employee: { first_name: 'Ana', last_name: 'Ríos' },
      net_settlement: '5681000.00',
    };

    it('(e) preview advierte que el pago termina al empleado', async () => {
      const { deps, tools } = buildTools();
      deps.settlementsService.findOne.mockResolvedValue(approved);

      const card = await preview(tools, 'pay_settlement', {
        settlement_id: 5,
      });

      expect(card.status).toBe('ok');
      expect(card.changes).toContainEqual({
        field: 'empleado',
        label: 'Empleado',
        from: 'active',
        to: 'terminated',
      });
      expect(card.message).toMatch(/terminado/);
    });

    it('(b) happy: paga desde approved', async () => {
      const { deps, tools } = buildTools();
      deps.settlementsService.findOne.mockResolvedValue(approved);
      deps.settlementFlowService.pay.mockResolvedValue({
        ...approved,
        status: 'paid',
      });

      const out = await run(tools, 'pay_settlement', { settlement_id: 5 });

      expect(deps.settlementFlowService.pay).toHaveBeenCalledWith(5);
      expect(out.status).toBe('paid');
      expect(out.net_settlement).toBe(5681000);
    });

    it('(c) sin aprobar → {error, next_step} a F-66', async () => {
      const { deps, tools } = buildTools();
      deps.settlementsService.findOne.mockResolvedValue({
        ...approved,
        status: 'calculated',
      });

      const out = await run(tools, 'pay_settlement', { settlement_id: 5 });

      expect(deps.settlementFlowService.pay).not.toHaveBeenCalled();
      expect(out.error).toMatch(/calculated/);
      expect(out.next_step).toMatch(/F-66/);
    });
  });

  // ─── F-69: get_pila_flatfile ───────────────────────────────────────────
  describe('get_pila_flatfile (F-69)', () => {
    it('(b) happy: plano + advertencia de layout sin validar', async () => {
      const { deps, tools } = buildTools();
      deps.pilaReportService.generateFlatFile.mockResolvedValue({
        filename: 'pila_2026_08.txt',
        content: '01HEADER\r\n02DETAIL\r\n',
        cotizantes: 1,
      });

      const out = await run(
        tools,
        'get_pila_flatfile',
        { year: 2026, month: 8 },
      );

      expect(deps.pilaReportService.generateFlatFile).toHaveBeenCalledWith(
        2026,
        8,
        STORE_ID,
      );
      expect(out.filename).toBe('pila_2026_08.txt');
      expect(out.cotizantes).toBe(1);
      expect(out.content).toContain('01HEADER');
      expect(out.layout_warning).toMatch(/no está validado contra un operador/);
    });

    it('(a) sad: mes inválido no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(
        tools,
        'get_pila_flatfile',
        { year: 2026, month: 13 },
      );

      expect(deps.pilaReportService.generateFlatFile).not.toHaveBeenCalled();
      expect(out.error).toMatch(/validación/i);
    });
  });

  // ─── F-70: list_pila_submissions ───────────────────────────────────────
  describe('list_pila_submissions (F-70)', () => {
    it('(b) happy: historial con total y paginación', async () => {
      const { deps, tools } = buildTools();
      deps.pilaReportService.getSubmissionHistory.mockResolvedValue({
        data: [
          {
            id: 3,
            period_year: 2026,
            period_month: 8,
            status: 'exported',
            cotizantes: 1,
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      });

      const out = await run(tools, 'list_pila_submissions', {
        year: 2026,
        status: 'exported',
      });

      expect(
        deps.pilaReportService.getSubmissionHistory,
      ).toHaveBeenCalledTimes(1);
      expect(out.total).toBe(1);
      expect(out.data).toEqual([
        {
          id: 3,
          period_year: 2026,
          period_month: 8,
          status: 'exported',
          cotizantes: 1,
        },
      ]);
    });

    it('(a) sad: estado inválido no toca el service', async () => {
      const { deps, tools } = buildTools();

      const out = await run(tools, 'list_pila_submissions', {
        status: 'enviada',
      });

      expect(
        deps.pilaReportService.getSubmissionHistory,
      ).not.toHaveBeenCalled();
      expect(out.error).toMatch(/validación/i);
    });
  });
});
