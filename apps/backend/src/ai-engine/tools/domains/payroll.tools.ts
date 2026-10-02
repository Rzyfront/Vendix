import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { PayrollRunsService } from '../../../domains/store/payroll/payroll-runs/payroll-runs.service';
import { PayrollFlowService } from '../../../domains/store/payroll/payroll-runs/payroll-flow.service';
import { PilaReportService } from '../../../domains/store/payroll/pila/pila-report.service';
import { EmployeesService } from '../../../domains/store/payroll/employees/employees.service';
import { EmployeeFiscalProfileService } from '../../../domains/store/payroll/employees/employee-fiscal-profile.service';
import { NoveltiesService } from '../../../domains/store/payroll/novelties/novelties.service';
import { AdvancesService } from '../../../domains/store/payroll/advances/advances.service';
import { SettlementsService } from '../../../domains/store/payroll/settlements/settlements.service';
import { SettlementFlowService } from '../../../domains/store/payroll/settlements/settlement-flow.service';
import { PayrollBankExportService } from '../../../domains/store/payroll/bank-export/payroll-bank-export.service';
import { QueryPayrollRunDto } from '../../../domains/store/payroll/payroll-runs/dto/query-payroll-run.dto';
import { QueryPilaReportDto } from '../../../domains/store/payroll/pila/dto/query-pila-report.dto';
import { QueryPilaSubmissionsDto } from '../../../domains/store/payroll/pila/dto/query-pila-submissions.dto';
import { QueryEmployeeDto } from '../../../domains/store/payroll/employees/dto/query-employee.dto';
import {
  CreateNoveltyDto,
  NOVELTY_TYPES,
} from '../../../domains/store/payroll/novelties/dto/create-novelty.dto';
import { QueryNoveltyDto } from '../../../domains/store/payroll/novelties/dto/query-novelty.dto';
import { QueryAdvanceDto } from '../../../domains/store/payroll/advances/dto/query-advance.dto';
import { ApproveAdvanceDto } from '../../../domains/store/payroll/advances/dto/approve-advance.dto';
import { CreateSettlementDto } from '../../../domains/store/payroll/settlements/dto/create-settlement.dto';
import { ApproveSettlementDto } from '../../../domains/store/payroll/settlements/dto/approve-settlement.dto';

export interface PayrollToolDeps {
  payrollRunsService: PayrollRunsService;
  payrollFlowService: PayrollFlowService;
  pilaReportService: PilaReportService;
  employeesService: EmployeesService;
  employeeFiscalProfileService: EmployeeFiscalProfileService;
  noveltiesService: NoveltiesService;
  advancesService: AdvancesService;
  settlementsService: SettlementsService;
  settlementFlowService: SettlementFlowService;
  payrollBankExportService: PayrollBankExportService;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doctrina de lectura F-50.. (misma que `withholding.tools.ts`: los handlers NO
// lanzan, devuelven `{error, next_step}` en español; cero acceso directo a la
// base de datos aquí — toda lectura va al service dueño del scope tenant).
//
// Permisos verificados en código (paso 7, sin inventar):
// - `store:payroll:runs:read` existe en `permissions-roles.seed.ts` (path
//   `/api/store/payroll/runs`) y es el `@Permissions` de `PilaReportController`.
//   OJO: `PayrollRunsController` NO declara `@Permissions` hoy (gap heredado);
//   las tools lo exigen igual porque leen el mismo agregado.
// ─────────────────────────────────────────────────────────────────────────────

const PAYROLL_RUNS_READ = 'store:payroll:runs:read';
// `store:payroll:runs:manage` existe en `permissions-roles.seed.ts` (path
// `/api/store/payroll/runs`) aunque `PayrollRunsController` no lo declare
// (gap heredado): los writes de runs lo exigen igual.
const PAYROLL_RUNS_MANAGE = 'store:payroll:runs:manage';
// Verificados en los controllers (paso 12, sin inventar):
// - employees: `EmployeesController` (`:id/fiscal-profile` → read).
// - novelties: `NoveltiesController` (GET → read, POST → create).
// - advances: `AdvancesController` (approve/reject → approve, cancel → manage).
// - settlements: `SettlementsController` (POST → create, approve/pay → manage).
const EMPLOYEES_READ = 'store:payroll:employees:read';
const NOVELTIES_READ = 'store:payroll:novelties:read';
const NOVELTIES_CREATE = 'store:payroll:novelties:create';
const ADVANCES_READ = 'store:payroll:advances:read';
const ADVANCES_APPROVE = 'store:payroll:advances:approve';
const ADVANCES_MANAGE = 'store:payroll:advances:manage';
const SETTLEMENTS_CREATE = 'store:payroll:settlements:create';
const SETTLEMENTS_MANAGE = 'store:payroll:settlements:manage';

/**
 * Espejo literal de `IRREVERSIBLE_DOMAINS['payroll']`
 * (`capability-registry.service.ts`, verificado en el paso 12): se copia y
 * no se importa para no arrastrar el grafo del bridge a esta familia; la
 * spec pinnea la igualdad para que no diverjan en silencio.
 */
const PAYROLL_IRREVERSIBLE_PHRASE =
  'Una liquidación de nómina genera obligaciones laborales y aportes de terceros que no se revierten solos.';

const PILA_LAYOUT_WARNING =
  'El layout del archivo plano PILA (Res. 2388/2016) aún no está validado contra un operador certificado (SOI / Aportes en Línea): valida el archivo con el operador antes de usarlo en producción.';

type PayrollRunListItem = Awaited<
  ReturnType<PayrollRunsService['findAll']>
>['data'][number];
type PayrollRunDetail = Awaited<ReturnType<PayrollRunsService['findOne']>>;
type PayrollRunItem = PayrollRunDetail['payroll_items'][number];

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

/**
 * Valida un DTO ya construido como lo haría el `ValidationPipe` global del
 * HTTP (`whitelist` + `forbidNonWhitelisted`): las tools llaman a los
 * servicios directo, sin pasar por el pipe.
 */
function toValidatedDto<T extends object>(
  DtoClass: new () => T,
  plain: Record<string, unknown>,
): { ok: true; dto: T } | { ok: false; message: string } {
  const dto = plainToInstance(DtoClass, plain, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (!errors.length) return { ok: true, dto };
  const details = errors
    .flatMap((entry) => Object.values(entry.constraints ?? {}))
    .join('; ');
  return {
    ok: false,
    message: `Los datos no pasaron la validación: ${details || 'revisa los campos enviados'}.`,
  };
}

/** Traduce una excepción del dominio a texto que el modelo pueda narrar. */
function describeReadError(error: unknown): string {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    return typeof response === 'string'
      ? response
      : (response?.message ?? error.message);
  }
  if (error instanceof HttpException) {
    const response = error.getResponse() as { message?: unknown } | string;
    if (typeof response === 'string') return response;
    const raw = response?.message;
    return Array.isArray(raw)
      ? raw.join('; ')
      : typeof raw === 'string'
        ? raw
        : error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Error desconocido';
}

/** Respuesta de fallo de un handler de lectura. Nunca se lanza. */
function readToolError(message: string, nextStep?: string): string {
  return JSON.stringify({
    error: message,
    ...(nextStep && { next_step: nextStep }),
  });
}

function projectRunTotals(run: {
  total_earnings: unknown;
  total_deductions: unknown;
  total_employer_costs: unknown;
  total_net_pay: unknown;
}) {
  return {
    total_earnings: toNumberOrNull(run.total_earnings),
    total_deductions: toNumberOrNull(run.total_deductions),
    total_employer_costs: toNumberOrNull(run.total_employer_costs),
    total_net_pay: toNumberOrNull(run.total_net_pay),
  };
}

function projectRunListItem(run: PayrollRunListItem) {
  return {
    id: run.id,
    payroll_number: run.payroll_number,
    status: run.status,
    frequency: run.frequency,
    period_start: toIsoDate(run.period_start),
    period_end: toIsoDate(run.period_end),
    payment_date: toIsoDate(run.payment_date),
    dian_status: run.dian_status,
    cune: run.cune,
    totals: projectRunTotals(run),
    store: run.store?.name ?? null,
  };
}

function projectRunItem(item: PayrollRunItem) {
  const employee = item.employee;
  return {
    employee_id: item.employee_id,
    employee_name: employee
      ? `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim() ||
        employee.employee_code
      : null,
    document_number: employee?.document_number ?? null,
    base_salary: toNumberOrNull(item.base_salary),
    total_earnings: toNumberOrNull(item.total_earnings),
    total_deductions: toNumberOrNull(item.total_deductions),
    net_pay: toNumberOrNull(item.net_pay),
    dian_status: item.dian_status,
  };
}

/** Los writes devuelven la misma forma `{error, next_step}` que los reads. */
function writeToolError(message: string, nextStep?: string): string {
  return readToolError(message, nextStep);
}

/** Sujeto humano para previews: nombre del empleado, nunca solo el id. */
function employeeDisplayName(employee: {
  first_name?: unknown;
  last_name?: unknown;
  employee_code?: unknown;
  id?: unknown;
}): string {
  const fullName =
    `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim();
  if (fullName) return fullName;
  if (employee.employee_code) return String(employee.employee_code);
  return `empleado #${String(employee.id ?? '?')}`;
}

function toDateOnly(value: unknown): string | null {
  const iso = toIsoDate(value);
  return iso ? iso.slice(0, 10) : null;
}

function formatPeriod(start: unknown, end: unknown): string {
  return `${toDateOnly(start) ?? '?'} al ${toDateOnly(end) ?? '?'}`;
}

function runSubject(run: {
  payroll_number?: unknown;
  period_start?: unknown;
  period_end?: unknown;
}): string {
  return `Nómina ${run.payroll_number ?? '?'} · período ${formatPeriod(run.period_start, run.period_end)}`;
}

type EmployeeRow = Awaited<ReturnType<EmployeesService['findOne']>>;

function projectEmployeeListItem(employee: EmployeeRow) {
  const stores = (employee.employee_stores ?? []).map((link: any) => ({
    store_id: link.store_id,
    store_name: link.store?.name ?? null,
    is_primary: link.is_primary ?? null,
  }));
  return {
    id: employee.id,
    employee_code: employee.employee_code,
    name: employeeDisplayName(employee),
    document_number: (employee as any).document_number ?? null,
    status: (employee as any).status ?? null,
    contract_type: (employee as any).contract_type ?? null,
    position: (employee as any).position ?? null,
    department: (employee as any).department ?? null,
    base_salary: toNumberOrNull((employee as any).base_salary),
    hire_date: toDateOnly((employee as any).hire_date),
    stores,
  };
}

function projectEmployeeDetail(employee: EmployeeRow) {
  return {
    ...projectEmployeeListItem(employee),
    document_type: (employee as any).document_type ?? null,
    email: (employee as any).email ?? null,
    phone: (employee as any).phone ?? null,
    salary_type: (employee as any).salary_type ?? null,
    contract_end_date: toDateOnly((employee as any).contract_end_date),
    termination_date: toDateOnly((employee as any).termination_date),
    termination_reason: (employee as any).termination_reason ?? null,
    cost_center: (employee as any).cost_center ?? null,
    bank_name: (employee as any).bank_name ?? null,
    bank_account_type: (employee as any).bank_account_type ?? null,
    bank_account_number: (employee as any).bank_account_number ?? null,
  };
}

type NoveltyRow = Awaited<ReturnType<NoveltiesService['findOne']>>;

function projectNovelty(novelty: NoveltyRow) {
  return {
    id: novelty.id,
    employee_id: novelty.employee_id,
    employee_name: novelty.employee
      ? employeeDisplayName(novelty.employee)
      : null,
    novelty_type: novelty.novelty_type,
    status: novelty.status,
    date_start: toDateOnly(novelty.date_start),
    date_end: toDateOnly(novelty.date_end),
    hours: toNumberOrNull(novelty.hours),
    days: toNumberOrNull(novelty.days),
    percentage: toNumberOrNull(novelty.percentage),
    amount: toNumberOrNull(novelty.amount),
    notes: novelty.notes ?? null,
    payroll_run_id: (novelty as any).payroll_run_id ?? null,
    created_at: toIsoDate((novelty as any).created_at),
  };
}

type AdvanceRow = Awaited<ReturnType<AdvancesService['findOne']>>;

function projectAdvance(advance: AdvanceRow) {
  return {
    id: advance.id,
    employee_id: advance.employee_id,
    employee_name: advance.employee
      ? employeeDisplayName(advance.employee)
      : null,
    status: advance.status,
    amount_requested: toNumberOrNull(advance.amount_requested),
    amount_approved: toNumberOrNull(advance.amount_approved),
    amount_paid: toNumberOrNull(advance.amount_paid),
    amount_pending: toNumberOrNull(advance.amount_pending),
    installments: (advance as any).installments ?? null,
    installment_value: toNumberOrNull((advance as any).installment_value),
    frequency: (advance as any).frequency ?? null,
    advance_date: toDateOnly((advance as any).advance_date),
    approved_at: toIsoDate((advance as any).approved_at),
    notes: (advance as any).notes ?? null,
  };
}

type SettlementRow = Awaited<ReturnType<SettlementsService['findOne']>>;

function projectSettlement(settlement: SettlementRow) {
  const row = settlement as any;
  return {
    id: settlement.id,
    settlement_number: row.settlement_number ?? null,
    status: row.status ?? null,
    employee_id: row.employee_id ?? null,
    employee_name: row.employee ? employeeDisplayName(row.employee) : null,
    termination_date: toDateOnly(row.termination_date),
    termination_reason: row.termination_reason ?? null,
    contract_type: row.contract_type ?? null,
    days_worked: row.days_worked ?? null,
    earnings: {
      severance: toNumberOrNull(row.severance),
      severance_interest: toNumberOrNull(row.severance_interest),
      bonus: toNumberOrNull(row.bonus),
      vacation: toNumberOrNull(row.vacation),
      pending_salary: toNumberOrNull(row.pending_salary),
      indemnification: toNumberOrNull(row.indemnification),
    },
    deductions: {
      health: toNumberOrNull(row.health_deduction),
      pension: toNumberOrNull(row.pension_deduction),
      other: toNumberOrNull(row.other_deductions),
      total: toNumberOrNull(row.total_deductions),
    },
    gross_settlement: toNumberOrNull(row.gross_settlement),
    net_settlement: toNumberOrNull(row.net_settlement),
    approved_at: toIsoDate(row.approved_at),
    notes: row.notes ?? null,
  };
}

function projectFiscalProfile(profile: Record<string, any>) {
  return {
    employee_id: profile.employee_id ?? null,
    certificate_year: profile.certificate_year ?? null,
    dependents_count: profile.dependents_count ?? null,
    retention_procedure: profile.retention_procedure ?? null,
    fixed_retention_rate: toNumberOrNull(profile.fixed_retention_rate),
    rate_semester: profile.rate_semester ?? null,
    housing_interest_monthly: toNumberOrNull(
      profile.housing_interest_monthly,
    ),
    prepaid_medicine_monthly: toNumberOrNull(
      profile.prepaid_medicine_monthly,
    ),
    voluntary_pension_monthly: toNumberOrNull(
      profile.voluntary_pension_monthly,
    ),
    afc_monthly: toNumberOrNull(profile.afc_monthly),
  };
}

export function createPayrollTools(deps: PayrollToolDeps): RegisteredTool[] {
  const {
    payrollRunsService,
    payrollFlowService,
    pilaReportService,
    employeesService,
    employeeFiscalProfileService,
    noveltiesService,
    advancesService,
    settlementsService,
    settlementFlowService,
    payrollBankExportService,
  } = deps;

  /**
   * Cadena habilitante de los writes de runs (F-52..F-55): lee la nómina
   * (F-51) y exige el estado previo. La usan `preview` y `handler` por
   * igual porque el preview es proyección, no transacción; la transición
   * real la valida `PayrollFlowService` vía `validateTransition()`.
   */
  const resolveRunGate = async (
    runId: number,
    allowed: string[],
  ): Promise<
    | { ok: true; run: PayrollRunDetail }
    | { ok: false; message: string; next_step: string }
  > => {
    let run: PayrollRunDetail;
    try {
      run = await payrollRunsService.findOne(runId);
    } catch (error) {
      return {
        ok: false,
        message: `No pude leer la nómina #${runId}: ${describeReadError(error)}`,
        next_step: 'Verifica el ID con list_payroll_runs (F-50).',
      };
    }
    if (!allowed.includes(run.status)) {
      return {
        ok: false,
        message:
          `La nómina ${run.payroll_number} está en '${run.status}' y esta ` +
          `operación exige '${allowed.join("' o '")}'.`,
        next_step:
          'Consulta el estado actual con get_payroll_run (F-51) y sigue el flujo draft → calculated → approved → paid.',
      };
    }
    return { ok: true, run };
  };

  return [
    // ─── F-50: list_payroll_runs ─────────────────────────────────────────
    {
      name: 'list_payroll_runs',
      version: '1',
      domain: 'payroll',
      readOnly: true,
      description:
        'Lista las nóminas (payroll_runs) de la tienda con estado, período, estado DIAN y totales. Solo lectura, tenant-scoped. Es el read habilitante de calculate/approve/pay (F-52..F-54): cada write exige el estado previo visible aquí.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description:
              'Filtra por estado: draft, calculated, approved, sent, accepted, rejected, paid, cancelled.',
          },
          frequency: {
            type: 'string',
            description: 'Filtra por frecuencia de la nómina.',
          },
          date_from: {
            type: 'string',
            description: 'Fecha inicial del período (ISO 8601).',
          },
          date_to: {
            type: 'string',
            description: 'Fecha final del período (ISO 8601).',
          },
          search: {
            type: 'string',
            description: 'Busca por número de nómina (payroll_number).',
          },
          page: { type: 'number', description: 'Página (base 1).' },
          limit: { type: 'number', description: 'Registros por página.' },
        },
        required: [],
      },
      requiredPermissions: [PAYROLL_RUNS_READ],
      handler: async (args) => {
        const validated = toValidatedDto(QueryPayrollRunDto, {
          ...(args.status !== undefined && { status: args.status }),
          ...(args.frequency !== undefined && { frequency: args.frequency }),
          ...(args.date_from !== undefined && { date_from: args.date_from }),
          ...(args.date_to !== undefined && { date_to: args.date_to }),
          ...(args.search !== undefined && { search: args.search }),
          ...(args.page !== undefined && { page: args.page }),
          ...(args.limit !== undefined && { limit: args.limit }),
        });
        if (!validated.ok) {
          return readToolError(
            validated.message,
            'Revisa los filtros (status, frequency, date_from/date_to ISO, search, page, limit).',
          );
        }
        try {
          const result = await payrollRunsService.findAll(validated.dto);
          return JSON.stringify({
            data: result.data.map(projectRunListItem),
            meta: result.meta,
          });
        } catch (error) {
          return readToolError(
            `No pude listar las nóminas: ${describeReadError(error)}`,
            'Reintenta sin filtros o con un rango de fechas más amplio.',
          );
        }
      },
    },

    // ─── F-51: get_payroll_run ───────────────────────────────────────────
    {
      name: 'get_payroll_run',
      version: '1',
      domain: 'payroll',
      readOnly: true,
      description:
        'Detalle de una nómina: estado, período, estado DIAN/CUNE y totales (devengos, deducciones, costo empleador, neto a pagar) más el resumen por empleado. Solo lectura. Habilita calculate (draft), approve (calculated) y pay (approved/sent).',
      parameters: {
        type: 'object',
        properties: {
          payroll_run_id: {
            type: 'number',
            description: 'ID de la nómina.',
          },
        },
        required: ['payroll_run_id'],
      },
      requiredPermissions: [PAYROLL_RUNS_READ],
      handler: async (args) => {
        const runId = toPositiveInt(args.payroll_run_id);
        if (!runId) {
          return readToolError(
            'payroll_run_id inválido: debe ser un entero positivo.',
            'Lista las nóminas con list_payroll_runs para obtener el ID.',
          );
        }
        try {
          const run = await payrollRunsService.findOne(runId);
          return JSON.stringify({
            id: run.id,
            payroll_number: run.payroll_number,
            status: run.status,
            frequency: run.frequency,
            period_start: toIsoDate(run.period_start),
            period_end: toIsoDate(run.period_end),
            payment_date: toIsoDate(run.payment_date),
            dian_status: run.dian_status,
            cune: run.cune,
            accounting_status: run.accounting_status,
            totals: projectRunTotals(run),
            employee_count: run.payroll_items.length,
            items: run.payroll_items.map(projectRunItem),
          });
        } catch (error) {
          return readToolError(
            `No pude leer la nómina #${runId}: ${describeReadError(error)}`,
            'Verifica el ID con list_payroll_runs.',
          );
        }
      },
    },

    // ─── F-56: get_payroll_dian_status ───────────────────────────────────
    {
      name: 'get_payroll_dian_status',
      version: '1',
      domain: 'payroll',
      readOnly: true,
      description:
        'Estado DIAN (DSPNE) de una nómina enviada: consulta con el CUNE almacenado y devuelve el estado actual más la respuesta del proveedor. Solo lectura (misma lectura que GET :id/dian-status; si la DIAN ya respondió, el service dueño sincroniza sent→accepted/rejected como en el HTTP). Habilita send_payroll_dian junto con F-51.',
      parameters: {
        type: 'object',
        properties: {
          payroll_run_id: {
            type: 'number',
            description: 'ID de la nómina enviada a la DIAN.',
          },
        },
        required: ['payroll_run_id'],
      },
      requiredPermissions: [PAYROLL_RUNS_READ],
      handler: async (args) => {
        const runId = toPositiveInt(args.payroll_run_id);
        if (!runId) {
          return readToolError(
            'payroll_run_id inválido: debe ser un entero positivo.',
            'Lista las nóminas con list_payroll_runs para obtener el ID.',
          );
        }
        try {
          const status = await payrollFlowService.getDianStatus(runId);
          return JSON.stringify(status);
        } catch (error) {
          return readToolError(
            `No pude consultar el estado DIAN de la nómina #${runId}: ${describeReadError(error)}`,
            'Si la nómina aún no se envió a la DIAN (sin CUNE), consulta primero su estado con get_payroll_run.',
          );
        }
      },
    },

    // ─── F-68: get_pila_report ───────────────────────────────────────────
    {
      name: 'get_pila_report',
      version: '1',
      domain: 'payroll',
      readOnly: true,
      description:
        'Reporte PILA del período (aportes a seguridad social por cotizante + totales): IBC topado, salud/pensión/ARL/parafiscales y novedades. Solo lectura, sin efectos secundarios (no registra en pila_submissions). Advierte que el layout del plano (Res. 2388/2016) no está validado contra un operador certificado.',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'number',
            description: 'Año del período (2020-2099).',
          },
          month: {
            type: 'number',
            description: 'Mes del período (1-12).',
          },
        },
        required: ['year', 'month'],
      },
      requiredPermissions: [PAYROLL_RUNS_READ],
      handler: async (
        args,
        _context: ToolExecutionContext,
      ) => {
        const validated = toValidatedDto(QueryPilaReportDto, {
          year: args.year,
          month: args.month,
        });
        if (!validated.ok) {
          return readToolError(
            validated.message,
            'Indica year (2020-2099) y month (1-12) del período a reportar.',
          );
        }
        try {
          const report = await pilaReportService.getContributionsForPeriod(
            validated.dto.year,
            validated.dto.month,
          );
          return JSON.stringify({
            year: report.year,
            month: report.month,
            employee_count: report.employees.length,
            totals: report.totals,
            employees: report.employees,
            layout_warning: PILA_LAYOUT_WARNING,
          });
        } catch (error) {
          return readToolError(
            `No pude generar el reporte PILA: ${describeReadError(error)}`,
            'Verifica que existan nóminas calculadas o posteriores en el período.',
          );
        }
      },
    },

    // ─── F-52: calculate_payroll (write) ─────────────────────────────────
    {
      name: 'calculate_payroll',
      version: '1',
      domain: 'payroll',
      description:
        'Calcula una nómina en borrador (draft → calculated): liquida IBC, aportes, provisiones y retefuente de cada empleado con las reglas del año. Cadena: exige get_payroll_run (F-51) en draft; la transición la valida el flow service.',
      parameters: {
        type: 'object',
        properties: {
          payroll_run_id: {
            type: 'number',
            description: 'ID de la nómina en borrador a calcular.',
          },
        },
        required: ['payroll_run_id'],
      },
      requiredPermissions: [PAYROLL_RUNS_MANAGE],
      requiresConfirmation: true,
      preview: async (args): Promise<ToolPreview> => {
        const runId = toPositiveInt(args.payroll_run_id);
        if (!runId) {
          return {
            status: 'error',
            target: 'Calcular nómina',
            changes: [],
            message:
              'payroll_run_id inválido: debe ser un entero positivo. Lista las nóminas con list_payroll_runs (F-50).',
          };
        }
        const gate = await resolveRunGate(runId, ['draft']);
        if (!gate.ok) {
          return {
            status: 'error',
            target: 'Calcular nómina',
            changes: [],
            message: `${gate.message} ${gate.next_step}`,
          };
        }
        return {
          status: 'ok',
          target: `Calcular ${runSubject(gate.run)}`,
          changes: [
            { field: 'estado', label: 'Estado', from: 'draft', to: 'calculated' },
            {
              field: 'liquidacion',
              label: 'Liquidación',
              from: null,
              to: 'IBC, salud/pensión/ARL, provisiones y retefuente por empleado',
            },
          ],
          message:
            'Cadena verificada: F-51 (get_payroll_run) en draft. El cálculo congela las reglas del año como snapshot de auditoría.',
          domain: 'payroll',
        };
      },
      handler: async (args) => {
        const runId = toPositiveInt(args.payroll_run_id);
        if (!runId) {
          return writeToolError(
            'payroll_run_id inválido: debe ser un entero positivo.',
            'Lista las nóminas con list_payroll_runs (F-50).',
          );
        }
        const gate = await resolveRunGate(runId, ['draft']);
        if (!gate.ok) {
          return writeToolError(gate.message, gate.next_step);
        }
        try {
          const updated = (await payrollFlowService.calculate(runId)) as any;
          return JSON.stringify({
            id: updated.id,
            payroll_number: updated.payroll_number,
            status: updated.status,
            employee_count: (updated.payroll_items ?? []).length,
            totals: projectRunTotals(updated),
          });
        } catch (error) {
          return writeToolError(
            `No pude calcular la nómina #${runId}: ${describeReadError(error)}`,
            'Revisa el estado con get_payroll_run (F-51); si sigue en draft, reintenta.',
          );
        }
      },
    },

    // ─── F-53: approve_payroll (write) ───────────────────────────────────
    {
      name: 'approve_payroll',
      version: '1',
      domain: 'payroll',
      irreversible: true,
      description:
        'Aprueba una nómina calculada (calculated → approved): estampa aprobador y fecha. Cadena: exige get_payroll_run (F-51) en calculated; la transición la valida el flow service.',
      parameters: {
        type: 'object',
        properties: {
          payroll_run_id: {
            type: 'number',
            description: 'ID de la nómina calculada a aprobar.',
          },
        },
        required: ['payroll_run_id'],
      },
      requiredPermissions: [PAYROLL_RUNS_MANAGE],
      requiresConfirmation: true,
      preview: async (args): Promise<ToolPreview> => {
        const runId = toPositiveInt(args.payroll_run_id);
        if (!runId) {
          return {
            status: 'error',
            target: 'Aprobar nómina',
            changes: [],
            message:
              'payroll_run_id inválido: debe ser un entero positivo. Lista las nóminas con list_payroll_runs (F-50).',
          };
        }
        const gate = await resolveRunGate(runId, ['calculated']);
        if (!gate.ok) {
          return {
            status: 'error',
            target: 'Aprobar nómina',
            changes: [],
            message: `${gate.message} ${gate.next_step}`,
          };
        }
        return {
          status: 'ok',
          target: `Aprobar ${runSubject(gate.run)}`,
          changes: [
            {
              field: 'estado',
              label: 'Estado',
              from: 'calculated',
              to: 'approved',
            },
            {
              field: 'neto_a_pagar',
              label: 'Neto a pagar',
              from: null,
              to: toNumberOrNull(gate.run.total_net_pay),
            },
            {
              field: 'empleados',
              label: 'Empleados',
              from: null,
              to: gate.run.payroll_items.length,
            },
          ],
          message:
            'Cadena verificada: F-51 (get_payroll_run) en calculated. La aprobación estampa tu usuario y la fecha.',
          domain: 'payroll',
        };
      },
      handler: async (args) => {
        const runId = toPositiveInt(args.payroll_run_id);
        if (!runId) {
          return writeToolError(
            'payroll_run_id inválido: debe ser un entero positivo.',
            'Lista las nóminas con list_payroll_runs (F-50).',
          );
        }
        const gate = await resolveRunGate(runId, ['calculated']);
        if (!gate.ok) {
          return writeToolError(gate.message, gate.next_step);
        }
        try {
          const updated = (await payrollFlowService.approve(runId)) as any;
          return JSON.stringify({
            id: updated.id,
            payroll_number: updated.payroll_number,
            status: updated.status,
            approved_at: toIsoDate(updated.approved_at),
            totals: projectRunTotals(updated),
          });
        } catch (error) {
          return writeToolError(
            `No pude aprobar la nómina #${runId}: ${describeReadError(error)}`,
            'Revisa el estado con get_payroll_run (F-51); si sigue en calculated, reintenta.',
          );
        }
      },
    },

    // ─── F-54: pay_payroll (write) ───────────────────────────────────────
    {
      name: 'pay_payroll',
      version: '1',
      domain: 'payroll',
      description:
        'Marca una nómina como pagada (approved/sent → paid): estampa fecha de pago y dispara la contabilización del pago. Cadena: exige get_payroll_run (F-51) en approved o sent.',
      parameters: {
        type: 'object',
        properties: {
          payroll_run_id: {
            type: 'number',
            description: 'ID de la nómina aprobada a marcar como pagada.',
          },
        },
        required: ['payroll_run_id'],
      },
      requiredPermissions: [PAYROLL_RUNS_MANAGE],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args): Promise<ToolPreview> => {
        const runId = toPositiveInt(args.payroll_run_id);
        if (!runId) {
          return {
            status: 'error',
            target: 'Pagar nómina',
            changes: [],
            message:
              'payroll_run_id inválido: debe ser un entero positivo. Lista las nóminas con list_payroll_runs (F-50).',
          };
        }
        const gate = await resolveRunGate(runId, ['approved', 'sent']);
        if (!gate.ok) {
          return {
            status: 'error',
            target: 'Pagar nómina',
            changes: [],
            message: `${gate.message} ${gate.next_step}`,
          };
        }
        return {
          status: 'ok',
          target: `Pagar ${runSubject(gate.run)}`,
          changes: [
            {
              field: 'estado',
              label: 'Estado',
              from: gate.run.status,
              to: 'paid',
            },
            {
              field: 'neto_pagado',
              label: 'Neto pagado',
              from: null,
              to: toNumberOrNull(gate.run.total_net_pay),
            },
            {
              field: 'empleados',
              label: 'Empleados',
              from: null,
              to: gate.run.payroll_items.length,
            },
          ],
          message:
            'Cadena verificada: F-51 (get_payroll_run) en approved/sent. El pago genera el asiento contable del desembolso.',
          domain: 'payroll',
        };
      },
      handler: async (args) => {
        const runId = toPositiveInt(args.payroll_run_id);
        if (!runId) {
          return writeToolError(
            'payroll_run_id inválido: debe ser un entero positivo.',
            'Lista las nóminas con list_payroll_runs (F-50).',
          );
        }
        const gate = await resolveRunGate(runId, ['approved', 'sent']);
        if (!gate.ok) {
          return writeToolError(gate.message, gate.next_step);
        }
        try {
          const updated = (await payrollFlowService.pay(runId)) as any;
          return JSON.stringify({
            id: updated.id,
            payroll_number: updated.payroll_number,
            status: updated.status,
            payment_date: toIsoDate(updated.payment_date),
            totals: projectRunTotals(updated),
          });
        } catch (error) {
          return writeToolError(
            `No pude marcar como pagada la nómina #${runId}: ${describeReadError(error)}`,
            'Revisa el estado con get_payroll_run (F-51); si sigue aprobada, reintenta.',
          );
        }
      },
    },

    // ─── F-55: send_payroll_dian (write, IRREVERSIBLE) ───────────────────
    {
      name: 'send_payroll_dian',
      version: '1',
      domain: 'payroll',
      description:
        'IRREVERSIBLE: transmite una nómina aprobada a la DIAN (DSPNE, Nómina Individual 102) y persiste CUNE por empleado. Cadena: exige get_payroll_run (F-51) en approved/paid con ítems; tras enviar, consulta get_payroll_dian_status (F-56).',
      parameters: {
        type: 'object',
        properties: {
          payroll_run_id: {
            type: 'number',
            description: 'ID de la nómina aprobada a transmitir a la DIAN.',
          },
        },
        required: ['payroll_run_id'],
      },
      requiredPermissions: [PAYROLL_RUNS_MANAGE],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args): Promise<ToolPreview> => {
        const runId = toPositiveInt(args.payroll_run_id);
        if (!runId) {
          return {
            status: 'error',
            target: 'Transmitir nómina a la DIAN',
            changes: [],
            message:
              'payroll_run_id inválido: debe ser un entero positivo. Lista las nóminas con list_payroll_runs (F-50).',
          };
        }
        const gate = await resolveRunGate(runId, ['approved', 'paid']);
        if (!gate.ok) {
          return {
            status: 'error',
            target: 'Transmitir nómina a la DIAN',
            changes: [],
            message: `${gate.message} ${gate.next_step}`,
          };
        }
        if (gate.run.payroll_items.length === 0) {
          return {
            status: 'error',
            target: 'Transmitir nómina a la DIAN',
            changes: [],
            message:
              `La nómina ${gate.run.payroll_number} no tiene ítems liquidados: calcula primero con calculate_payroll (F-52). ` +
              'Consulta el estado con get_payroll_run (F-51).',
          };
        }
        return {
          status: 'warning',
          target: `Transmitir ${runSubject(gate.run)} a la DIAN (${gate.run.payroll_items.length} empleados)`,
          changes: [
            {
              field: 'estado',
              label: 'Estado',
              from: gate.run.status,
              to: 'sent (si la DIAN acepta el envío)',
            },
            {
              field: 'documento',
              label: 'Documento DSPNE',
              from: null,
              to: 'Nómina Individual 102 con CUNE por empleado',
            },
            {
              field: 'neto_reportado',
              label: 'Neto reportado',
              from: null,
              to: toNumberOrNull(gate.run.total_net_pay),
            },
          ],
          message: `${PAYROLL_IRREVERSIBLE_PHRASE} Cadena verificada: F-51 en approved/paid con ítems; tras enviar, verifica con F-56 (get_payroll_dian_status).`,
          domain: 'payroll',
        };
      },
      handler: async (args) => {
        const runId = toPositiveInt(args.payroll_run_id);
        if (!runId) {
          return writeToolError(
            'payroll_run_id inválido: debe ser un entero positivo.',
            'Lista las nóminas con list_payroll_runs (F-50).',
          );
        }
        const gate = await resolveRunGate(runId, ['approved', 'paid']);
        if (!gate.ok) {
          return writeToolError(gate.message, gate.next_step);
        }
        if (gate.run.payroll_items.length === 0) {
          return writeToolError(
            `La nómina ${gate.run.payroll_number} no tiene ítems liquidados.`,
            'Calcula primero con calculate_payroll (F-52).',
          );
        }
        try {
          const result = (await payrollFlowService.sendToDian(runId)) as {
            payroll_run: any;
            dian_summary: {
              total_items: number;
              sent: number;
              failed: number;
              all_success: boolean;
              message?: string;
            };
          };
          return JSON.stringify({
            id: result.payroll_run.id,
            payroll_number: result.payroll_run.payroll_number,
            status: result.payroll_run.status,
            cune: result.payroll_run.cune ?? null,
            dian_summary: {
              total_items: result.dian_summary.total_items,
              sent: result.dian_summary.sent,
              failed: result.dian_summary.failed,
              all_success: result.dian_summary.all_success,
              message: result.dian_summary.message ?? null,
            },
            next_step:
              'Verifica el estado con get_payroll_dian_status (F-56).',
          });
        } catch (error) {
          return writeToolError(
            `No pude transmitir la nómina #${runId} a la DIAN: ${describeReadError(error)}`,
            'Revisa el estado con get_payroll_run (F-51) y F-56 antes de reintentar.',
          );
        }
      },
    },

    // ─── F-57: export_payroll_ach (read) ─────────────────────────────────
    {
      name: 'export_payroll_ach',
      version: '1',
      domain: 'payroll',
      irreversible: true,
      readOnly: true,
      description:
        'Genera el archivo plano ACH de dispersión bancaria de una nómina aprobada/pagada (Bancolombia/Davivienda): valida los datos bancarios de cada empleado y devuelve la URL de descarga. Solo lectura de dominio (genera un archivo como un reporte; el service dueño lo sube al storage, igual que POST :id/export-ach).',
      parameters: {
        type: 'object',
        properties: {
          payroll_run_id: {
            type: 'number',
            description: 'ID de la nómina aprobada o pagada.',
          },
          bank: {
            type: 'string',
            description: 'Banco destino (código del builder, ej. bancolombia).',
          },
          source_account: {
            type: 'string',
            description: 'Cuenta origen del débito (opcional).',
          },
          source_account_type: {
            type: 'string',
            description: 'Tipo de cuenta origen (opcional).',
          },
        },
        required: ['payroll_run_id', 'bank'],
      },
      requiredPermissions: [PAYROLL_RUNS_READ],
      handler: async (args) => {
        const runId = toPositiveInt(args.payroll_run_id);
        if (!runId) {
          return readToolError(
            'payroll_run_id inválido: debe ser un entero positivo.',
            'Lista las nóminas con list_payroll_runs (F-50).',
          );
        }
        if (typeof args.bank !== 'string' || !args.bank.trim()) {
          return readToolError(
            'bank inválido: indica el banco destino.',
            'Consulta los bancos disponibles en el módulo de nómina (exportación bancaria).',
          );
        }
        try {
          const validation =
            await payrollBankExportService.validateEmployeeBankData(runId);
          if (validation.invalid.length > 0) {
            const detail = validation.invalid
              .slice(0, 5)
              .map((entry) => `${entry.name}: ${entry.errors.join(', ')}`)
              .join('; ');
            return readToolError(
              `No se puede generar el ACH: ${validation.invalid.length} empleado(s) con datos bancarios incompletos (${detail}).`,
              'Completa cuenta, tipo de cuenta y banco de cada empleado en su ficha y reintenta.',
            );
          }
          const batch = await payrollBankExportService.exportBatch(
            runId,
            args.bank,
            args.source_account,
            args.source_account_type,
          );
          return JSON.stringify({
            download_url: batch.download_url,
            file_name: batch.file_name,
            record_count: batch.record_count,
            total_amount: batch.total_amount,
            validated_employees: validation.valid.length,
          });
        } catch (error) {
          return readToolError(
            `No pude generar el ACH de la nómina #${runId}: ${describeReadError(error)}`,
            'Verifica con get_payroll_run (F-51) que esté aprobada o pagada y que el banco sea soportado.',
          );
        }
      },
    },

    // ─── F-58: list_employees ────────────────────────────────────────────
    {
      name: 'list_employees',
      version: '1',
      domain: 'payroll',
      readOnly: true,
      description:
        'Lista los empleados de la tienda (tenant-scoped) con código, documento, estado, contrato y salario base. Solo lectura. Habilita get_employee (F-59) y las cadenas de novedades, anticipos y liquidaciones.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Busca por nombre, código o documento.',
          },
          status: {
            type: 'string',
            description: 'Filtra por estado del empleado.',
          },
          department: {
            type: 'string',
            description: 'Filtra por dependencia.',
          },
          page: { type: 'number', description: 'Página (base 1).' },
          limit: { type: 'number', description: 'Registros por página.' },
        },
        required: [],
      },
      requiredPermissions: [EMPLOYEES_READ],
      handler: async (args) => {
        const validated = toValidatedDto(QueryEmployeeDto, {
          ...(args.search !== undefined && { search: args.search }),
          ...(args.status !== undefined && { status: args.status }),
          ...(args.department !== undefined && { department: args.department }),
          ...(args.page !== undefined && { page: args.page }),
          ...(args.limit !== undefined && { limit: args.limit }),
        });
        if (!validated.ok) {
          return readToolError(
            validated.message,
            'Revisa los filtros (search, status, department, page, limit).',
          );
        }
        try {
          const result = await employeesService.findAll(validated.dto);
          return JSON.stringify({
            data: result.data.map(projectEmployeeListItem),
            meta: result.meta,
          });
        } catch (error) {
          return readToolError(
            `No pude listar los empleados: ${describeReadError(error)}`,
            'Reintenta sin filtros.',
          );
        }
      },
    },

    // ─── F-59: get_employee ──────────────────────────────────────────────
    {
      name: 'get_employee',
      version: '1',
      domain: 'payroll',
      readOnly: true,
      description:
        'Ficha completa de un empleado: contrato, salario, fechas, datos bancarios y tiendas. Solo lectura. Habilita calculate/approve/pay_settlement (contrato + termination_reason).',
      parameters: {
        type: 'object',
        properties: {
          employee_id: { type: 'number', description: 'ID del empleado.' },
        },
        required: ['employee_id'],
      },
      requiredPermissions: [EMPLOYEES_READ],
      handler: async (args) => {
        const employeeId = toPositiveInt(args.employee_id);
        if (!employeeId) {
          return readToolError(
            'employee_id inválido: debe ser un entero positivo.',
            'Lista los empleados con list_employees (F-58).',
          );
        }
        try {
          const employee = await employeesService.findOne(employeeId);
          return JSON.stringify(projectEmployeeDetail(employee));
        } catch (error) {
          return readToolError(
            `No pude leer el empleado #${employeeId}: ${describeReadError(error)}`,
            'Verifica el ID con list_employees (F-58).',
          );
        }
      },
    },

    // ─── F-60: get_employee_fiscal_profile ───────────────────────────────
    {
      name: 'get_employee_fiscal_profile',
      version: '1',
      domain: 'payroll',
      readOnly: true,
      description:
        'Perfil fiscal del empleado (art. 387 ET): dependientes, deducciones mensuales (vivienda, medicina prepagada, pensión voluntaria, AFC) y procedimiento de retención. Solo lectura (misma lectura que GET :id/fiscal-profile; si no existe, el service dueño crea el perfil vacío por defecto como en el HTTP).',
      parameters: {
        type: 'object',
        properties: {
          employee_id: { type: 'number', description: 'ID del empleado.' },
        },
        required: ['employee_id'],
      },
      requiredPermissions: [EMPLOYEES_READ],
      handler: async (args) => {
        const employeeId = toPositiveInt(args.employee_id);
        if (!employeeId) {
          return readToolError(
            'employee_id inválido: debe ser un entero positivo.',
            'Lista los empleados con list_employees (F-58).',
          );
        }
        try {
          const profile =
            await employeeFiscalProfileService.getOrCreate(employeeId);
          return JSON.stringify(projectFiscalProfile(profile as any));
        } catch (error) {
          return readToolError(
            `No pude leer el perfil fiscal del empleado #${employeeId}: ${describeReadError(error)}`,
            'Verifica el ID con list_employees (F-58).',
          );
        }
      },
    },

    // ─── F-61: list_payroll_novelties ────────────────────────────────────
    {
      name: 'list_payroll_novelties',
      version: '1',
      domain: 'payroll',
      readOnly: true,
      description:
        'Lista las novedades de nómina (horas extra, recargos, incapacidades, vacaciones, licencias, bonos, deducciones) con estado pending/applied/cancelled. Solo lectura.',
      parameters: {
        type: 'object',
        properties: {
          employee_id: {
            type: 'number',
            description: 'Filtra por empleado.',
          },
          novelty_type: {
            type: 'string',
            description: `Filtra por tipo: ${NOVELTY_TYPES.join(', ')}.`,
          },
          status: {
            type: 'string',
            description: 'Filtra por estado: pending, applied, cancelled.',
          },
          date_from: {
            type: 'string',
            description: 'Fecha inicial (ISO 8601).',
          },
          date_to: {
            type: 'string',
            description: 'Fecha final (ISO 8601).',
          },
          page: { type: 'number', description: 'Página (base 1).' },
          limit: { type: 'number', description: 'Registros por página.' },
        },
        required: [],
      },
      requiredPermissions: [NOVELTIES_READ],
      handler: async (args) => {
        const validated = toValidatedDto(QueryNoveltyDto, {
          ...(args.employee_id !== undefined && {
            employee_id: args.employee_id,
          }),
          ...(args.novelty_type !== undefined && {
            novelty_type: args.novelty_type,
          }),
          ...(args.status !== undefined && { status: args.status }),
          ...(args.date_from !== undefined && { date_from: args.date_from }),
          ...(args.date_to !== undefined && { date_to: args.date_to }),
          ...(args.page !== undefined && { page: args.page }),
          ...(args.limit !== undefined && { limit: args.limit }),
        });
        if (!validated.ok) {
          return readToolError(
            validated.message,
            'Revisa los filtros (employee_id, novelty_type, status, date_from/date_to ISO, page, limit).',
          );
        }
        try {
          const result = await noveltiesService.findAll(validated.dto);
          return JSON.stringify({
            data: result.data.map(projectNovelty),
            meta: result.meta,
          });
        } catch (error) {
          return readToolError(
            `No pude listar las novedades: ${describeReadError(error)}`,
            'Reintenta sin filtros.',
          );
        }
      },
    },

    // ─── F-62: create_payroll_novelty (write) ────────────────────────────
    {
      name: 'create_payroll_novelty',
      version: '1',
      domain: 'payroll',
      description:
        'Registra una novedad de nómina en estado pending para un empleado activo (horas extra, recargos, incapacidades, vacaciones, licencias, bonos, deducciones). El service dueño valida la cantidad según el tipo. Cadena: el empleado debe existir y estar activo (F-59).',
      parameters: {
        type: 'object',
        properties: {
          employee_id: { type: 'number', description: 'ID del empleado.' },
          novelty_type: {
            type: 'string',
            description: `Tipo de novedad: ${NOVELTY_TYPES.join(', ')}.`,
          },
          date_start: {
            type: 'string',
            description: 'Fecha inicial (ISO 8601).',
          },
          date_end: {
            type: 'string',
            description: 'Fecha final (ISO 8601, opcional).',
          },
          hours: {
            type: 'number',
            description: 'Horas (para horas extra/recargos).',
          },
          days: { type: 'number', description: 'Días (para ausencias).' },
          percentage: {
            type: 'number',
            description: 'Sobretasa decimal (0.25 = 25%, opcional).',
          },
          amount: {
            type: 'number',
            description: 'Valor manual (bonos, comisiones, deducciones).',
          },
          notes: { type: 'string', description: 'Notas (opcional).' },
        },
        required: ['employee_id', 'novelty_type', 'date_start'],
      },
      requiredPermissions: [NOVELTIES_CREATE],
      requiresConfirmation: true,
      preview: async (args): Promise<ToolPreview> => {
        const validated = toValidatedDto(CreateNoveltyDto, {
          employee_id: args.employee_id,
          novelty_type: args.novelty_type,
          date_start: args.date_start,
          ...(args.date_end !== undefined && { date_end: args.date_end }),
          ...(args.hours !== undefined && { hours: args.hours }),
          ...(args.days !== undefined && { days: args.days }),
          ...(args.percentage !== undefined && {
            percentage: args.percentage,
          }),
          ...(args.amount !== undefined && { amount: args.amount }),
          ...(args.notes !== undefined && { notes: args.notes }),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Registrar novedad de nómina',
            changes: [],
            message: `${validated.message} Revisa employee_id, novelty_type (${NOVELTY_TYPES.join(', ')}) y date_start ISO.`,
          };
        }
        let employee: EmployeeRow;
        try {
          employee = await employeesService.findOne(
            validated.dto.employee_id,
          );
        } catch (error) {
          return {
            status: 'error',
            target: 'Registrar novedad de nómina',
            changes: [],
            message: `No pude leer el empleado #${validated.dto.employee_id}: ${describeReadError(error)} Verifica el ID con list_employees (F-58).`,
          };
        }
        if ((employee as any).status !== 'active') {
          return {
            status: 'error',
            target: 'Registrar novedad de nómina',
            changes: [],
            message: `${employeeDisplayName(employee)} no está activo (estado '${(employee as any).status}'): las novedades exigen empleado activo. Verifica la ficha con get_employee (F-59).`,
          };
        }
        const dto = validated.dto;
        return {
          status: 'ok',
          target: `Novedad ${dto.novelty_type} para ${employeeDisplayName(employee)}`,
          changes: [
            {
              field: 'novelty_type',
              label: 'Tipo',
              from: null,
              to: dto.novelty_type,
            },
            {
              field: 'periodo',
              label: 'Período',
              from: null,
              to: dto.date_end
                ? `${dto.date_start} al ${dto.date_end}`
                : String(dto.date_start),
            },
            ...(dto.hours != null
              ? [{ field: 'hours', label: 'Horas', from: null, to: dto.hours }]
              : []),
            ...(dto.days != null
              ? [{ field: 'days', label: 'Días', from: null, to: dto.days }]
              : []),
            ...(dto.amount != null
              ? [{ field: 'amount', label: 'Valor', from: null, to: dto.amount }]
              : []),
          ],
          message:
            'Cadena verificada: empleado activo (F-59). La novedad nace en pending y se liquida en la próxima nómina del período.',
          domain: 'payroll',
        };
      },
      handler: async (args) => {
        const validated = toValidatedDto(CreateNoveltyDto, {
          employee_id: args.employee_id,
          novelty_type: args.novelty_type,
          date_start: args.date_start,
          ...(args.date_end !== undefined && { date_end: args.date_end }),
          ...(args.hours !== undefined && { hours: args.hours }),
          ...(args.days !== undefined && { days: args.days }),
          ...(args.percentage !== undefined && {
            percentage: args.percentage,
          }),
          ...(args.amount !== undefined && { amount: args.amount }),
          ...(args.notes !== undefined && { notes: args.notes }),
        });
        if (!validated.ok) {
          return writeToolError(
            validated.message,
            `Revisa employee_id, novelty_type (${NOVELTY_TYPES.join(', ')}) y date_start ISO.`,
          );
        }
        try {
          const employee = await employeesService.findOne(
            validated.dto.employee_id,
          );
          if ((employee as any).status !== 'active') {
            return writeToolError(
              `${employeeDisplayName(employee)} ya no está activo (estado '${(employee as any).status}').`,
              'Verifica la ficha con get_employee (F-59).',
            );
          }
          const created = await noveltiesService.create(validated.dto);
          return JSON.stringify(projectNovelty(created));
        } catch (error) {
          return writeToolError(
            `No pude registrar la novedad: ${describeReadError(error)}`,
            'Verifica el empleado con get_employee (F-59) y la cantidad según el tipo.',
          );
        }
      },
    },

    // ─── F-63: list_employee_advances ────────────────────────────────────
    {
      name: 'list_employee_advances',
      version: '1',
      domain: 'payroll',
      readOnly: true,
      description:
        'Lista los anticipos a empleados con estado (pending/approved/repaying/paid/rejected/cancelled) y saldos solicitado/aprobado/pagado/pendiente. Solo lectura. Habilita approve_advance (F-64).',
      parameters: {
        type: 'object',
        properties: {
          employee_id: {
            type: 'number',
            description: 'Filtra por empleado.',
          },
          status: {
            type: 'string',
            description:
              'Filtra por estado: pending, approved, repaying, paid, rejected, cancelled.',
          },
          date_from: {
            type: 'string',
            description: 'Fecha inicial (ISO 8601).',
          },
          date_to: {
            type: 'string',
            description: 'Fecha final (ISO 8601).',
          },
          page: { type: 'number', description: 'Página (base 1).' },
          limit: { type: 'number', description: 'Registros por página.' },
        },
        required: [],
      },
      requiredPermissions: [ADVANCES_READ],
      handler: async (args) => {
        const validated = toValidatedDto(QueryAdvanceDto, {
          ...(args.employee_id !== undefined && {
            employee_id: args.employee_id,
          }),
          ...(args.status !== undefined && { status: args.status }),
          ...(args.date_from !== undefined && { date_from: args.date_from }),
          ...(args.date_to !== undefined && { date_to: args.date_to }),
          ...(args.page !== undefined && { page: args.page }),
          ...(args.limit !== undefined && { limit: args.limit }),
        });
        if (!validated.ok) {
          return readToolError(
            validated.message,
            'Revisa los filtros (employee_id, status, date_from/date_to ISO, page, limit).',
          );
        }
        try {
          const result = await advancesService.findAll(validated.dto);
          return JSON.stringify({
            data: result.data.map(projectAdvance),
            meta: result.meta,
          });
        } catch (error) {
          return readToolError(
            `No pude listar los anticipos: ${describeReadError(error)}`,
            'Reintenta sin filtros.',
          );
        }
      },
    },

    // ─── F-64: approve_advance (write) ───────────────────────────────────
    {
      name: 'approve_advance',
      version: '1',
      domain: 'payroll',
      description:
        'Decide un anticipo: approve (genera el plan de cuotas), reject o cancel. Cadena: exige list_employee_advances (F-63) en pending para approve/reject; cancel admite anticipos no terminales. El service dueño re-valida la transición (ADV_STATUS_001).',
      parameters: {
        type: 'object',
        properties: {
          advance_id: { type: 'number', description: 'ID del anticipo.' },
          action: {
            type: 'string',
            description: 'Decisión: approve, reject o cancel.',
          },
          amount_approved: {
            type: 'number',
            description:
              'Monto aprobado (approve; por defecto el solicitado).',
          },
          installments: {
            type: 'number',
            description: 'N.º de cuotas (approve; por defecto las pedidas).',
          },
          notes: { type: 'string', description: 'Notas (opcional).' },
        },
        required: ['advance_id', 'action'],
      },
      requiredPermissions: [ADVANCES_APPROVE, ADVANCES_MANAGE],
      requiresConfirmation: true,
      preview: async (args): Promise<ToolPreview> => {
        const advanceId = toPositiveInt(args.advance_id);
        if (!advanceId) {
          return {
            status: 'error',
            target: 'Decidir anticipo',
            changes: [],
            message:
              'advance_id inválido: debe ser un entero positivo. Lista los anticipos con list_employee_advances (F-63).',
          };
        }
        if (!['approve', 'reject', 'cancel'].includes(args.action)) {
          return {
            status: 'error',
            target: 'Decidir anticipo',
            changes: [],
            message:
              'action inválida: usa approve, reject o cancel. Revisa el anticipo con list_employee_advances (F-63).',
          };
        }
        const validated = toValidatedDto(ApproveAdvanceDto, {
          ...(args.amount_approved !== undefined && {
            amount_approved: args.amount_approved,
          }),
          ...(args.installments !== undefined && {
            installments: args.installments,
          }),
          ...(args.notes !== undefined && { notes: args.notes }),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Decidir anticipo',
            changes: [],
            message: `${validated.message} Revisa amount_approved, installments y notes.`,
          };
        }
        let advance: AdvanceRow;
        try {
          advance = await advancesService.findOne(advanceId);
        } catch (error) {
          return {
            status: 'error',
            target: 'Decidir anticipo',
            changes: [],
            message: `No pude leer el anticipo #${advanceId}: ${describeReadError(error)} Verifica el ID con list_employee_advances (F-63).`,
          };
        }
        const needsPending = args.action !== 'cancel';
        const cancellable = ['pending', 'approved', 'repaying'].includes(
          advance.status,
        );
        if ((needsPending && advance.status !== 'pending') || (!needsPending && !cancellable)) {
          return {
            status: 'error',
            target: 'Decidir anticipo',
            changes: [],
            message:
              `El anticipo #${advanceId} está en '${advance.status}' y '${args.action}' ` +
              (needsPending
                ? 'exige pending.'
                : 'exige un anticipo no terminal (pending/approved/repaying).') +
              ' Revisa el estado con list_employee_advances (F-63).',
          };
        }
        const actionLabel =
          args.action === 'approve'
            ? 'Aprobar'
            : args.action === 'reject'
              ? 'Rechazar'
              : 'Anular';
        return {
          status: 'ok',
          target: `${actionLabel} anticipo #${advanceId} · ${advance.employee ? employeeDisplayName(advance.employee) : `empleado #${advance.employee_id}`} · solicitado ${toNumberOrNull(advance.amount_requested)}`,
          changes: [
            {
              field: 'estado',
              label: 'Estado',
              from: advance.status,
              to:
                args.action === 'approve'
                  ? 'approved'
                  : args.action === 'reject'
                    ? 'rejected'
                    : 'cancelled',
            },
            ...(args.action === 'approve'
              ? [
                  {
                    field: 'monto_aprobado',
                    label: 'Monto aprobado',
                    from: null,
                    to:
                      validated.dto.amount_approved ??
                      toNumberOrNull(advance.amount_requested),
                  },
                  {
                    field: 'cuotas',
                    label: 'Cuotas',
                    from: null,
                    to:
                      validated.dto.installments ??
                      (advance as any).installments,
                  },
                ]
              : []),
          ],
          message:
            'Cadena verificada: F-63 (list_employee_advances) en estado válido. Aprobar genera el plan de cuotas para descuento por nómina.',
          domain: 'payroll',
        };
      },
      handler: async (args) => {
        const advanceId = toPositiveInt(args.advance_id);
        if (!advanceId) {
          return writeToolError(
            'advance_id inválido: debe ser un entero positivo.',
            'Lista los anticipos con list_employee_advances (F-63).',
          );
        }
        if (!['approve', 'reject', 'cancel'].includes(args.action)) {
          return writeToolError(
            'action inválida: usa approve, reject o cancel.',
            'Revisa el anticipo con list_employee_advances (F-63).',
          );
        }
        const validated = toValidatedDto(ApproveAdvanceDto, {
          ...(args.amount_approved !== undefined && {
            amount_approved: args.amount_approved,
          }),
          ...(args.installments !== undefined && {
            installments: args.installments,
          }),
          ...(args.notes !== undefined && { notes: args.notes }),
        });
        if (!validated.ok) {
          return writeToolError(
            validated.message,
            'Revisa amount_approved, installments y notes.',
          );
        }
        try {
          const advance = await advancesService.findOne(advanceId);
          const needsPending = args.action !== 'cancel';
          const cancellable = ['pending', 'approved', 'repaying'].includes(
            advance.status,
          );
          if (
            (needsPending && advance.status !== 'pending') ||
            (!needsPending && !cancellable)
          ) {
            return writeToolError(
              `El anticipo #${advanceId} ya está en '${advance.status}': '${args.action}' ya no aplica.`,
              'Revisa el estado con list_employee_advances (F-63).',
            );
          }
          const updated =
            args.action === 'approve'
              ? await advancesService.approve(advanceId, validated.dto)
              : args.action === 'reject'
                ? await advancesService.reject(advanceId)
                : await advancesService.cancel(advanceId);
          return JSON.stringify(projectAdvance(updated));
        } catch (error) {
          return writeToolError(
            `No pude decidir el anticipo #${advanceId}: ${describeReadError(error)}`,
            'Revisa el estado con list_employee_advances (F-63).',
          );
        }
      },
    },

    // ─── F-65: calculate_settlement (write) ──────────────────────────────
    {
      name: 'calculate_settlement',
      version: '1',
      domain: 'payroll',
      description:
        'Crea y calcula la liquidación final de un empleado activo (prestaciones, vacaciones, indemnización si aplica). Cadena: exige get_employee (F-59) activo y sin liquidación abierta; aprobar (F-66) y pagar (F-67) son pasos aparte.',
      parameters: {
        type: 'object',
        properties: {
          employee_id: { type: 'number', description: 'ID del empleado.' },
          termination_date: {
            type: 'string',
            description: 'Fecha de retiro (ISO 8601).',
          },
          termination_reason: {
            type: 'string',
            description:
              'Motivo: voluntary_resignation, just_cause, without_just_cause, mutual_agreement, contract_expiry, retirement, death.',
          },
          pending_salary_days: {
            type: 'number',
            description: 'Días de salario pendientes (opcional).',
          },
          contract_end_date: {
            type: 'string',
            description:
              'Fin del contrato a término fijo, base de indemnización anticipada (ISO 8601, opcional).',
          },
          notes: { type: 'string', description: 'Notas (opcional).' },
        },
        required: ['employee_id', 'termination_date', 'termination_reason'],
      },
      requiredPermissions: [SETTLEMENTS_CREATE],
      requiresConfirmation: true,
      preview: async (args): Promise<ToolPreview> => {
        const validated = toValidatedDto(CreateSettlementDto, {
          employee_id: args.employee_id,
          termination_date: args.termination_date,
          termination_reason: args.termination_reason,
          ...(args.pending_salary_days !== undefined && {
            pending_salary_days: args.pending_salary_days,
          }),
          ...(args.contract_end_date !== undefined && {
            contract_end_date: args.contract_end_date,
          }),
          ...(args.notes !== undefined && { notes: args.notes }),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Liquidar empleado',
            changes: [],
            message: `${validated.message} Revisa employee_id, termination_date ISO y termination_reason.`,
          };
        }
        let employee: EmployeeRow;
        try {
          employee = await employeesService.findOne(
            validated.dto.employee_id,
          );
        } catch (error) {
          return {
            status: 'error',
            target: 'Liquidar empleado',
            changes: [],
            message: `No pude leer el empleado #${validated.dto.employee_id}: ${describeReadError(error)} Verifica el ID con list_employees (F-58).`,
          };
        }
        if ((employee as any).status !== 'active') {
          return {
            status: 'error',
            target: 'Liquidar empleado',
            changes: [],
            message: `${employeeDisplayName(employee)} no está activo (estado '${(employee as any).status}'): solo se liquida personal activo. Verifica la ficha con get_employee (F-59).`,
          };
        }
        const dto = validated.dto;
        return {
          status: 'ok',
          target: `Liquidar a ${employeeDisplayName(employee)} · retiro ${dto.termination_date}`,
          changes: [
            {
              field: 'motivo',
              label: 'Motivo de retiro',
              from: null,
              to: dto.termination_reason,
            },
            {
              field: 'contrato',
              label: 'Contrato',
              from: null,
              to: (employee as any).contract_type ?? null,
            },
            {
              field: 'salario_base',
              label: 'Salario base',
              from: null,
              to: toNumberOrNull((employee as any).base_salary),
            },
          ],
          message:
            'Cadena verificada: empleado activo (F-59). Crea la liquidación calculada; aprobar (F-66) y pagar (F-67) son pasos aparte.',
          domain: 'payroll',
        };
      },
      handler: async (args) => {
        const validated = toValidatedDto(CreateSettlementDto, {
          employee_id: args.employee_id,
          termination_date: args.termination_date,
          termination_reason: args.termination_reason,
          ...(args.pending_salary_days !== undefined && {
            pending_salary_days: args.pending_salary_days,
          }),
          ...(args.contract_end_date !== undefined && {
            contract_end_date: args.contract_end_date,
          }),
          ...(args.notes !== undefined && { notes: args.notes }),
        });
        if (!validated.ok) {
          return writeToolError(
            validated.message,
            'Revisa employee_id, termination_date ISO y termination_reason.',
          );
        }
        try {
          const employee = await employeesService.findOne(
            validated.dto.employee_id,
          );
          if ((employee as any).status !== 'active') {
            return writeToolError(
              `${employeeDisplayName(employee)} ya no está activo (estado '${(employee as any).status}').`,
              'Verifica la ficha con get_employee (F-59).',
            );
          }
          const created = await settlementFlowService.createAndCalculate(
            validated.dto,
          );
          return JSON.stringify(projectSettlement(created));
        } catch (error) {
          return writeToolError(
            `No pude calcular la liquidación: ${describeReadError(error)}`,
            'Verifica que el empleado esté activo y sin liquidación abierta (get_employee F-59).',
          );
        }
      },
    },

    // ─── F-66: approve_settlement (write) ────────────────────────────────
    {
      name: 'approve_settlement',
      version: '1',
      domain: 'payroll',
      irreversible: true,
      description:
        'Aprueba una liquidación calculada (calculated → approved). Cadena: la liquidación debe estar calculada y el contrato/motivo verificados vía get_employee (F-59); la transición la valida el flow service.',
      parameters: {
        type: 'object',
        properties: {
          settlement_id: {
            type: 'number',
            description: 'ID de la liquidación calculada.',
          },
          notes: { type: 'string', description: 'Notas (opcional).' },
        },
        required: ['settlement_id'],
      },
      requiredPermissions: [SETTLEMENTS_MANAGE],
      requiresConfirmation: true,
      preview: async (args): Promise<ToolPreview> => {
        const settlementId = toPositiveInt(args.settlement_id);
        if (!settlementId) {
          return {
            status: 'error',
            target: 'Aprobar liquidación',
            changes: [],
            message:
              'settlement_id inválido: debe ser un entero positivo.',
          };
        }
        let settlement: SettlementRow;
        try {
          settlement = await settlementsService.findOne(settlementId);
        } catch (error) {
          return {
            status: 'error',
            target: 'Aprobar liquidación',
            changes: [],
            message: `No pude leer la liquidación #${settlementId}: ${describeReadError(error)} Calcúlala primero con calculate_settlement (F-65).`,
          };
        }
        const row = settlement as any;
        if (row.status !== 'calculated') {
          return {
            status: 'error',
            target: 'Aprobar liquidación',
            changes: [],
            message: `La liquidación ${row.settlement_number ?? `#${settlementId}`} está en '${row.status}' y aprobar exige 'calculated'. Calcúlala con calculate_settlement (F-65).`,
          };
        }
        return {
          status: 'ok',
          target: `Aprobar liquidación ${row.settlement_number ?? `#${settlementId}`} · ${row.employee ? employeeDisplayName(row.employee) : `empleado #${row.employee_id}`}`,
          changes: [
            {
              field: 'estado',
              label: 'Estado',
              from: 'calculated',
              to: 'approved',
            },
            {
              field: 'neto_a_pagar',
              label: 'Neto a pagar',
              from: null,
              to: toNumberOrNull(row.net_settlement),
            },
            ...(row.indemnification != null &&
            Number(row.indemnification) > 0
              ? [
                  {
                    field: 'indemnizacion',
                    label: 'Indemnización',
                    from: null,
                    to: toNumberOrNull(row.indemnification),
                  },
                ]
              : []),
          ],
          message:
            'Cadena verificada: liquidación calculada (contrato + motivo vía F-59). Pagar (F-67) es el paso siguiente.',
          domain: 'payroll',
        };
      },
      handler: async (args) => {
        const settlementId = toPositiveInt(args.settlement_id);
        if (!settlementId) {
          return writeToolError(
            'settlement_id inválido: debe ser un entero positivo.',
          );
        }
        const validated = toValidatedDto(ApproveSettlementDto, {
          ...(args.notes !== undefined && { notes: args.notes }),
        });
        if (!validated.ok) {
          return writeToolError(validated.message, 'Revisa notes.');
        }
        try {
          const settlement = (await settlementsService.findOne(
            settlementId,
          )) as any;
          if (settlement.status !== 'calculated') {
            return writeToolError(
              `La liquidación ${settlement.settlement_number ?? `#${settlementId}`} ya está en '${settlement.status}': aprobar exige 'calculated'.`,
              'Calcúlala con calculate_settlement (F-65).',
            );
          }
          const updated = await settlementFlowService.approve(
            settlementId,
            validated.dto,
          );
          return JSON.stringify(projectSettlement(updated));
        } catch (error) {
          return writeToolError(
            `No pude aprobar la liquidación #${settlementId}: ${describeReadError(error)}`,
            'Verifica que siga calculada; si cambió, calcúlala de nuevo (F-65).',
          );
        }
      },
    },

    // ─── F-67: pay_settlement (write) ────────────────────────────────────
    {
      name: 'pay_settlement',
      version: '1',
      domain: 'payroll',
      description:
        'Paga una liquidación aprobada (approved → paid) y termina al empleado en la misma transacción. Cadena: la liquidación debe estar aprobada (F-66); la transición la valida el flow service.',
      parameters: {
        type: 'object',
        properties: {
          settlement_id: {
            type: 'number',
            description: 'ID de la liquidación aprobada a pagar.',
          },
        },
        required: ['settlement_id'],
      },
      requiredPermissions: [SETTLEMENTS_MANAGE],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args): Promise<ToolPreview> => {
        const settlementId = toPositiveInt(args.settlement_id);
        if (!settlementId) {
          return {
            status: 'error',
            target: 'Pagar liquidación',
            changes: [],
            message: 'settlement_id inválido: debe ser un entero positivo.',
          };
        }
        let settlement: SettlementRow;
        try {
          settlement = await settlementsService.findOne(settlementId);
        } catch (error) {
          return {
            status: 'error',
            target: 'Pagar liquidación',
            changes: [],
            message: `No pude leer la liquidación #${settlementId}: ${describeReadError(error)} Apruébala primero con approve_settlement (F-66).`,
          };
        }
        const row = settlement as any;
        if (row.status !== 'approved') {
          return {
            status: 'error',
            target: 'Pagar liquidación',
            changes: [],
            message: `La liquidación ${row.settlement_number ?? `#${settlementId}`} está en '${row.status}' y pagar exige 'approved'. Apruébala con approve_settlement (F-66).`,
          };
        }
        return {
          status: 'ok',
          target: `Pagar liquidación ${row.settlement_number ?? `#${settlementId}`} · ${row.employee ? employeeDisplayName(row.employee) : `empleado #${row.employee_id}`}`,
          changes: [
            {
              field: 'estado',
              label: 'Estado',
              from: 'approved',
              to: 'paid',
            },
            {
              field: 'neto_pagado',
              label: 'Neto pagado',
              from: null,
              to: toNumberOrNull(row.net_settlement),
            },
            {
              field: 'empleado',
              label: 'Empleado',
              from: 'active',
              to: 'terminated',
            },
          ],
          message:
            'Cadena verificada: liquidación aprobada (F-66). Al pagar, el empleado queda terminado en la misma transacción.',
          domain: 'payroll',
        };
      },
      handler: async (args) => {
        const settlementId = toPositiveInt(args.settlement_id);
        if (!settlementId) {
          return writeToolError(
            'settlement_id inválido: debe ser un entero positivo.',
          );
        }
        try {
          const settlement = (await settlementsService.findOne(
            settlementId,
          )) as any;
          if (settlement.status !== 'approved') {
            return writeToolError(
              `La liquidación ${settlement.settlement_number ?? `#${settlementId}`} ya está en '${settlement.status}': pagar exige 'approved'.`,
              'Apruébala con approve_settlement (F-66).',
            );
          }
          const updated = await settlementFlowService.pay(settlementId);
          return JSON.stringify(projectSettlement(updated));
        } catch (error) {
          return writeToolError(
            `No pude pagar la liquidación #${settlementId}: ${describeReadError(error)}`,
            'Verifica que siga aprobada; si cambió, apruébala de nuevo (F-66).',
          );
        }
      },
    },

    // ─── F-69: get_pila_flatfile (read) ─────────────────────────────────
    {
      name: 'get_pila_flatfile',
      version: '1',
      domain: 'payroll',
      readOnly: true,
      description:
        'Archivo plano PILA del período (Res. 2388/2016): devuelve filename, contenido de ancho fijo y n.º de cotizantes. Solo lectura (misma generación que GET flat-file; el service dueño registra la exportación en pila_submissions como en el HTTP). Advierte que el layout no está validado contra un operador certificado.',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'number',
            description: 'Año del período (2020-2099).',
          },
          month: {
            type: 'number',
            description: 'Mes del período (1-12).',
          },
        },
        required: ['year', 'month'],
      },
      requiredPermissions: [PAYROLL_RUNS_READ],
      handler: async (args, context: ToolExecutionContext) => {
        const validated = toValidatedDto(QueryPilaReportDto, {
          year: args.year,
          month: args.month,
        });
        if (!validated.ok) {
          return readToolError(
            validated.message,
            'Indica year (2020-2099) y month (1-12) del período.',
          );
        }
        try {
          const flat = await pilaReportService.generateFlatFile(
            validated.dto.year,
            validated.dto.month,
            toPositiveInt(context.store_id),
          );
          return JSON.stringify({
            filename: flat.filename,
            cotizantes: flat.cotizantes,
            content: flat.content,
            layout_warning: PILA_LAYOUT_WARNING,
          });
        } catch (error) {
          return readToolError(
            `No pude generar el plano PILA: ${describeReadError(error)}`,
            'Verifica que existan nóminas calculadas o posteriores en el período.',
          );
        }
      },
    },

    // ─── F-70: list_pila_submissions ─────────────────────────────────────
    {
      name: 'list_pila_submissions',
      version: '1',
      domain: 'payroll',
      readOnly: true,
      description:
        'Historial de planillas PILA generadas/exportadas por período y estado (generated/exported/void), scoped a la entidad contable fiscal. Solo lectura.',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'number',
            description: 'Filtra por año del período (2020-2099).',
          },
          month: {
            type: 'number',
            description: 'Filtra por mes del período (1-12).',
          },
          status: {
            type: 'string',
            description: 'Filtra por estado: generated, exported, void.',
          },
          page: { type: 'number', description: 'Página (base 1).' },
          limit: { type: 'number', description: 'Registros por página.' },
        },
        required: [],
      },
      requiredPermissions: [PAYROLL_RUNS_READ],
      handler: async (args) => {
        const validated = toValidatedDto(QueryPilaSubmissionsDto, {
          ...(args.year !== undefined && { year: args.year }),
          ...(args.month !== undefined && { month: args.month }),
          ...(args.status !== undefined && { status: args.status }),
          ...(args.page !== undefined && { page: args.page }),
          ...(args.limit !== undefined && { limit: args.limit }),
        });
        if (!validated.ok) {
          return readToolError(
            validated.message,
            'Revisa los filtros (year, month, status, page, limit).',
          );
        }
        try {
          const history =
            await pilaReportService.getSubmissionHistory(validated.dto);
          return JSON.stringify(JSON.parse(JSON.stringify(history)));
        } catch (error) {
          return readToolError(
            `No pude listar las planillas PILA: ${describeReadError(error)}`,
            'Reintenta sin filtros.',
          );
        }
      },
    },
  ];
}
