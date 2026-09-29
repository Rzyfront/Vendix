import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  RegisteredTool,
  ToolExecutionContext,
} from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { PayrollRunsService } from '../../../domains/store/payroll/payroll-runs/payroll-runs.service';
import { PayrollFlowService } from '../../../domains/store/payroll/payroll-runs/payroll-flow.service';
import { PilaReportService } from '../../../domains/store/payroll/pila/pila-report.service';
import { QueryPayrollRunDto } from '../../../domains/store/payroll/payroll-runs/dto/query-payroll-run.dto';
import { QueryPilaReportDto } from '../../../domains/store/payroll/pila/dto/query-pila-report.dto';

export interface PayrollToolDeps {
  payrollRunsService: PayrollRunsService;
  payrollFlowService: PayrollFlowService;
  pilaReportService: PilaReportService;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doctrina de lectura F-50.. (misma que `withholding.tools.ts`: los handlers NO
// lanzan, devuelven `{error, next_step}` en español; cero `prisma.` aquí — toda
// lectura va al service dueño del scope tenant).
//
// Permisos verificados en código (paso 7, sin inventar):
// - `store:payroll:runs:read` existe en `permissions-roles.seed.ts` (path
//   `/api/store/payroll/runs`) y es el `@Permissions` de `PilaReportController`.
//   OJO: `PayrollRunsController` NO declara `@Permissions` hoy (gap heredado);
//   las tools lo exigen igual porque leen el mismo agregado.
// ─────────────────────────────────────────────────────────────────────────────

const PAYROLL_RUNS_READ = 'store:payroll:runs:read';

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

export function createPayrollTools(deps: PayrollToolDeps): RegisteredTool[] {
  const { payrollRunsService, payrollFlowService, pilaReportService } = deps;

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
        'Estado DIAN (DSPNE) de una nómina enviada: consulta con el CUNE almacenado y devuelve el estado actual más la respuesta del proveedor. Solo lectura desde Vexi (misma lectura que GET :id/dian-status; si la DIAN ya respondió, el service dueño sincroniza sent→accepted/rejected como en el HTTP). Habilita send_payroll_dian junto con F-51.',
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
            layout_warning:
              'El layout del archivo plano PILA (Res. 2388/2016) aún no está validado contra un operador certificado (SOI / Aportes en Línea): valida el archivo con el operador antes de usarlo en producción.',
          });
        } catch (error) {
          return readToolError(
            `No pude generar el reporte PILA: ${describeReadError(error)}`,
            'Verifica que existan nóminas calculadas o posteriores en el período.',
          );
        }
      },
    },
  ];
}
