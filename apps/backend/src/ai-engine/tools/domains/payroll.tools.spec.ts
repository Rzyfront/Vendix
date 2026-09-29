import { createPayrollTools, PayrollToolDeps } from './payroll.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * F-50/F-51/F-56/F-68 — Spec de contrato de la familia payroll (patrón
 * canónico T4, escrita en el paso 7).
 *
 * (a) validación happy/sad — el sad no toca las deps mockeadas;
 * (b) snapshot JSON exacto de la salida happy (literales con `toEqual`);
 * (c) forma `{error, next_step}` en español en los fallos guiados;
 * (d) permiso declarado por tool;
 * (e) las 4 son reads puras: `readOnly: true`, sin `requiresConfirmation` ni
 *     `preview` — F-56 delega en `getDianStatus`, la misma lectura que
 *     GET :id/dian-status.
 *
 * Permiso blindado: `store:payroll:runs:read` (seed + `@Permissions` de
 * `PilaReportController`; `PayrollRunsController` no declara ninguno — gap
 * heredado documentado en el factory).
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
      },
      pilaReportService: {
        getContributionsForPeriod: jest.fn(),
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

  // ─── (d)+(e) Registro: permisos, categoría y forma ────────────────────
  describe('registro', () => {
    it('expone exactamente los 4 reads P0 de nómina/PILA', () => {
      const { tools } = buildTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        'list_payroll_runs',
        'get_payroll_run',
        'get_payroll_dian_status',
        'get_pila_report',
      ]);
      for (const tool of tools) {
        expect(tool.domain).toBe('payroll');
        expect(tool.version).toBe('1');
        expect(tool.description.length).toBeGreaterThan(20);
      }
    });

    it('cada read exige store:payroll:runs:read', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.requiredPermissions).toEqual(['store:payroll:runs:read']);
      }
    });

    it('las 4 son reads puras sin circuito de escritura', () => {
      const { tools } = buildTools();
      for (const tool of tools) {
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation ?? false).toBe(false);
        expect(tool.preview).toBeUndefined();
        expect(tool.clientSide ?? false).toBe(false);
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
});
