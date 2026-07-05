import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { PayrollRulesService } from '../calculation/payroll-rules.service';
import {
  PilaCsvExport,
  PilaEmployeeContribution,
  PilaFlatFileResult,
  PilaNoveltyDates,
  PilaNoveltyFlags,
  PilaPeriodReport,
  PilaPeriodTotals,
  PilaSubmissionRecord,
} from './interfaces/pila-report.interface';
import { QueryPilaSubmissionsDto } from './dto/query-pila-submissions.dto';
import {
  PILA_TYPE1_LAYOUT,
  PILA_TYPE1_TOTAL_LENGTH,
  PILA_TYPE2_LAYOUT,
  PILA_TYPE2_TOTAL_LENGTH,
  PilaFieldValue,
  buildPilaRecord,
} from './pila-flat-file.layout';

/**
 * Tipos de novedad que se reflejan como flags PILA.
 * (paternity_leave se agrupa con maternity_leave en la novedad LMA.)
 */
const PILA_NOVELTY_TYPES = [
  'vacation',
  'incapacity_general',
  'incapacity_laboral',
  'leave_unpaid',
  'maternity_leave',
  'paternity_leave',
] as const;

const CSV_SEPARATOR = ';';

/** Piso IBC = 1 SMMLV; techo IBC = 25 SMMLV (art. 5 Ley 797/2003). */
const IBC_CEILING_SMMLV = 25;
/** Umbral de exoneración patronal (Ley 1607/2012): IBC < 10 SMMLV. */
const EXONERATION_THRESHOLD_SMMLV = 10;
/** Días base de un mes de cotización PILA. */
const PILA_DAYS_PER_MONTH = 30;
/**
 * Tipos de documento válidos para el cotizante en el archivo tipo 2
 * (Res. 2388/2016, campo 3 registro tipo 2).
 */
const VALID_COTIZANTE_DOC_TYPES = new Set([
  'CC',
  'CE',
  'TI',
  'PA',
  'CD',
  'SC',
  'RC',
  'PE',
]);

/**
 * Reporte de aportes PILA (Planilla Integrada de Liquidación de Aportes).
 *
 * ALCANCE: reporte de apoyo para la carga MANUAL de la planilla en el
 * operador PILA (aportes en línea, SOI, etc.). La generación del archivo
 * plano oficial según la Resolución 2388/2016 (estructura de registros
 * tipo 1/2 del Ministerio de Salud) está FUERA de alcance.
 *
 * Fuente: payroll_items de los runs cuyo período inicia dentro del mes
 * solicitado (runs draft/cancelled excluidos).
 * - IBC = base_salary + devengos salariales (overtime[].amount + commissions
 *   + bonuses[].taxable). El subsidio de transporte NO hace parte del IBC.
 * - Aportes del empleado desde deductions JSON (health/pension).
 * - Aportes del empleador y parafiscales desde employer_costs JSON
 *   (health/pension/arl/sena/icbf/compensation_fund).
 * - novelty_flags desde payroll_novelties con status='applied' vinculadas a
 *   los runs del mes (vacation, incapacity_general, incapacity_laboral,
 *   leave_unpaid).
 */
@Injectable()
export class PilaReportService {
  private readonly logger = new Logger(PilaReportService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly payrollRules: PayrollRulesService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async getContributionsForPeriod(
    year: number,
    month: number,
    store_id: number | null = null,
  ): Promise<PilaPeriodReport> {
    const period_start = new Date(Date.UTC(year, month - 1, 1));
    const period_end = new Date(Date.UTC(year, month, 1));

    const runs = await this.prisma.payroll_runs.findMany({
      where: {
        period_start: { gte: period_start, lt: period_end },
        status: { notIn: ['draft', 'cancelled'] },
        ...(store_id ? { store_id } : {}),
      },
      select: { id: true },
    });
    const run_ids = runs.map((run: { id: number }) => run.id);

    if (run_ids.length === 0) {
      return { year, month, employees: [], totals: this.emptyTotals() };
    }

    // SMMLV vigente del período: base para topes de IBC y umbral de exoneración.
    const minimum_wage = await this.resolveMinimumWage(year, store_id);

    const [items, novelties, prev_salaries] = await Promise.all([
      this.prisma.payroll_items.findMany({
        where: { payroll_run_id: { in: run_ids } },
        include: {
          employee: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              document_type: true,
              document_number: true,
              arl_risk_level: true,
              salary_type: true,
              hire_date: true,
              termination_date: true,
            },
          },
        },
      }),
      this.prisma.payroll_novelties.findMany({
        where: {
          payroll_run_id: { in: run_ids },
          status: 'applied',
          novelty_type: { in: [...PILA_NOVELTY_TYPES] },
        },
        select: {
          employee_id: true,
          novelty_type: true,
          date_start: true,
          date_end: true,
          days: true,
        },
      }),
      this.getPreviousPeriodBaseSalaries(year, month, store_id),
    ]);

    // Flags + fechas + días de novedad por empleado.
    const meta_by_employee = this.buildNoveltyMeta(novelties);

    // Agregación por empleado (un run mensual = un item; runs quincenales
    // del mismo mes se suman)
    const by_employee = new Map<number, PilaEmployeeContribution>();

    for (const item of items) {
      const employee = item.employee;
      if (!employee) continue;

      const earnings = this.asRecord(item.earnings);
      const deductions = this.asRecord(item.deductions);
      const employer_costs = this.asRecord(item.employer_costs);

      const ibc = this.calculateIbc(earnings, Number(item.base_salary));

      const meta = meta_by_employee.get(employee.id);
      const contribution: PilaEmployeeContribution = by_employee.get(
        employee.id,
      ) || {
        employee_id: employee.id,
        document_type: employee.document_type,
        document_number: employee.document_number,
        full_name:
          `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim(),
        first_name: employee.first_name ?? '',
        last_name: employee.last_name ?? '',
        salary_type: employee.salary_type === 'integral' ? 'integral' : 'ordinary',
        base_salary: Number(item.base_salary) || 0,
        ibc: 0,
        worked_days: 0,
        arl_risk_level: employee.arl_risk_level ?? null,
        health_employee: 0,
        health_employer: 0,
        pension_employee: 0,
        pension_employer: 0,
        arl: 0,
        sena: 0,
        icbf: 0,
        compensation_fund: 0,
        exonerated: false,
        irl_days: meta?.irl_days ?? 0,
        novelty_flags: meta?.flags ?? this.emptyFlags(),
        novelty_dates: meta?.dates ?? this.emptyDates(),
        total: 0,
      };

      // Novedades derivadas del contrato (una vez por empleado).
      this.applyEmployeeNovelties(
        contribution,
        employee.hire_date,
        employee.termination_date,
        period_start,
        period_end,
        prev_salaries,
      );

      contribution.ibc = this.round(contribution.ibc + ibc);
      contribution.worked_days += item.worked_days || 0;
      contribution.health_employee = this.round(
        contribution.health_employee + this.num(deductions.health),
      );
      contribution.pension_employee = this.round(
        contribution.pension_employee + this.num(deductions.pension),
      );
      contribution.health_employer = this.round(
        contribution.health_employer + this.num(employer_costs.health),
      );
      contribution.pension_employer = this.round(
        contribution.pension_employer + this.num(employer_costs.pension),
      );
      contribution.arl = this.round(
        contribution.arl + this.num(employer_costs.arl),
      );
      contribution.sena = this.round(
        contribution.sena + this.num(employer_costs.sena),
      );
      contribution.icbf = this.round(
        contribution.icbf + this.num(employer_costs.icbf),
      );
      contribution.compensation_fund = this.round(
        contribution.compensation_fund +
          this.num(employer_costs.compensation_fund),
      );
      contribution.total = this.round(
        contribution.health_employee +
          contribution.health_employer +
          contribution.pension_employee +
          contribution.pension_employer +
          contribution.arl +
          contribution.sena +
          contribution.icbf +
          contribution.compensation_fund,
      );

      by_employee.set(employee.id, contribution);
    }

    // Topes de IBC (piso 1 SMMLV prorrateado por días / techo 25 SMMLV) y
    // marca de exoneración patronal, aplicados sobre el IBC mensual
    // consolidado por cotizante (unidad legal del tope en PILA).
    for (const contribution of by_employee.values()) {
      contribution.ibc = this.clampIbc(
        contribution.ibc,
        contribution.worked_days,
        minimum_wage,
      );
      contribution.exonerated =
        minimum_wage > 0 &&
        contribution.ibc < EXONERATION_THRESHOLD_SMMLV * minimum_wage &&
        contribution.sena === 0 &&
        contribution.icbf === 0;
    }

    const employees = Array.from(by_employee.values()).sort((a, b) =>
      a.full_name.localeCompare(b.full_name),
    );

    return { year, month, employees, totals: this.buildTotals(employees) };
  }

  /**
   * Genera el reporte del período y registra el tracking en
   * `pila_submissions` con status `generated`. Punto de entrada del
   * endpoint GET /pila/report (vista en pantalla, no descarga de archivo).
   */
  async generateAndTrack(
    year: number,
    month: number,
    store_id: number | null = null,
  ): Promise<PilaPeriodReport> {
    const report = await this.getContributionsForPeriod(year, month, store_id);

    await this.recordSubmission({
      year,
      month,
      store_id,
      status: 'generated',
      report,
    });

    return report;
  }

  /**
   * Exporta el reporte del período como CSV (separador ';'), una fila por
   * empleado más una fila final de totales. Pensado para diligenciar la
   * planilla manualmente en el operador PILA.
   */
  async exportCsv(
    year: number,
    month: number,
    store_id: number | null = null,
  ): Promise<PilaCsvExport> {
    const report = await this.getContributionsForPeriod(year, month, store_id);

    const header = [
      'tipo_documento',
      'numero_documento',
      'nombre_completo',
      'ibc',
      'dias_cotizados',
      'nivel_riesgo_arl',
      'salud_empleado',
      'salud_empleador',
      'pension_empleado',
      'pension_empleador',
      'arl',
      'sena',
      'icbf',
      'caja_compensacion',
      'nov_vacaciones',
      'nov_incapacidad_general',
      'nov_incapacidad_laboral',
      'nov_licencia_no_remunerada',
      'total_aportes',
    ];

    const rows = report.employees.map((emp) =>
      [
        emp.document_type,
        emp.document_number,
        this.sanitizeCsvField(emp.full_name),
        emp.ibc.toFixed(2),
        String(emp.worked_days),
        emp.arl_risk_level !== null ? String(emp.arl_risk_level) : '',
        emp.health_employee.toFixed(2),
        emp.health_employer.toFixed(2),
        emp.pension_employee.toFixed(2),
        emp.pension_employer.toFixed(2),
        emp.arl.toFixed(2),
        emp.sena.toFixed(2),
        emp.icbf.toFixed(2),
        emp.compensation_fund.toFixed(2),
        emp.novelty_flags.vacation ? 'X' : '',
        emp.novelty_flags.incapacity_general ? 'X' : '',
        emp.novelty_flags.incapacity_laboral ? 'X' : '',
        emp.novelty_flags.unpaid_leave ? 'X' : '',
        emp.total.toFixed(2),
      ].join(CSV_SEPARATOR),
    );

    const totals_row = [
      '',
      '',
      'TOTALES',
      report.totals.ibc.toFixed(2),
      '',
      '',
      report.totals.health_employee.toFixed(2),
      report.totals.health_employer.toFixed(2),
      report.totals.pension_employee.toFixed(2),
      report.totals.pension_employer.toFixed(2),
      report.totals.arl.toFixed(2),
      report.totals.sena.toFixed(2),
      report.totals.icbf.toFixed(2),
      report.totals.compensation_fund.toFixed(2),
      '',
      '',
      '',
      '',
      report.totals.total.toFixed(2),
    ].join(CSV_SEPARATOR);

    const content = [header.join(CSV_SEPARATOR), ...rows, totals_row].join(
      '\r\n',
    );

    const filename = `pila_${year}_${String(month).padStart(2, '0')}.csv`;

    await this.recordSubmission({
      year,
      month,
      store_id,
      status: 'exported',
      report,
    });

    return { filename, content };
  }

  /**
   * Historial de generaciones/exportaciones de planilla PILA para el
   * aportante (accounting_entity) resuelto por el contexto actual.
   */
  async getSubmissionHistory(query: QueryPilaSubmissionsDto): Promise<{
    data: PilaSubmissionRecord[];
    total: number;
    page: number;
    limit: number;
  }> {
    const context = this.getContext();
    const accounting_entity_id =
      await this.fiscalScope.findFiscalAccountingEntityId({
        organization_id: context.organization_id!,
        store_id: context.store_id,
      });

    const page = query.page || 1;
    const limit = query.limit || 10;

    if (!accounting_entity_id) {
      return { data: [], total: 0, page, limit };
    }

    const where = {
      organization_id: context.organization_id!,
      accounting_entity_id,
      ...(query.year ? { period_year: query.year } : {}),
      ...(query.month ? { period_month: query.month } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const client = this.prisma.withoutScope();
    const [rows, total] = await Promise.all([
      client.pila_submissions.findMany({
        where,
        orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      client.pila_submissions.count({ where }),
    ]);

    return {
      data: rows.map((row: any) => this.toSubmissionRecord(row)),
      total,
      page,
      limit,
    };
  }

  /**
   * Registra una generación/exportación de planilla PILA en
   * `pila_submissions`, marcando `void` cualquier fila ACTIVA previa del
   * mismo aportante+período (control de duplicados a nivel de servicio,
   * la tabla no tiene unique constraint). El CSV NO se persiste — es
   * regenerable determinísticamente desde payroll_items/novelties.
   */
  private async recordSubmission(params: {
    year: number;
    month: number;
    store_id: number | null;
    status: 'generated' | 'exported';
    report: PilaPeriodReport;
  }): Promise<void> {
    const context = this.getContext();
    if (!context.organization_id) {
      this.logger.warn(
        'Skipping pila_submissions tracking - no organization_id in context',
      );
      return;
    }

    const accounting_entity = await this.fiscalScope.resolveAccountingEntityForFiscal(
      {
        organization_id: context.organization_id,
        store_id: params.store_id ?? context.store_id,
      },
    );

    const client = this.prisma.withoutScope();
    const now = new Date();

    await client.$transaction(async (tx: any) => {
      // Marcar void cualquier fila ACTIVA previa del mismo aportante+período.
      await tx.pila_submissions.updateMany({
        where: {
          organization_id: context.organization_id,
          accounting_entity_id: accounting_entity.id,
          period_year: params.year,
          period_month: params.month,
          status: { not: 'void' },
        },
        data: {
          status: 'void',
          voided_at: now,
          voided_by_user_id: context.user_id ?? null,
          void_reason: 'Regenerada: nueva generación/exportación del período',
          updated_at: now,
        },
      });

      await tx.pila_submissions.create({
        data: {
          organization_id: context.organization_id,
          accounting_entity_id: accounting_entity.id,
          period_year: params.year,
          period_month: params.month,
          status: params.status,
          employees_count: params.report.employees.length,
          total_earnings: params.report.totals.ibc,
          total_contributions: params.report.totals.total,
          metadata: {
            social_security: {
              health_employee: params.report.totals.health_employee,
              health_employer: params.report.totals.health_employer,
              pension_employee: params.report.totals.pension_employee,
              pension_employer: params.report.totals.pension_employer,
              arl: params.report.totals.arl,
              sena: params.report.totals.sena,
              icbf: params.report.totals.icbf,
              compensation_fund: params.report.totals.compensation_fund,
            },
          },
          exported_at: params.status === 'exported' ? now : null,
          exported_by_user_id:
            params.status === 'exported' ? context.user_id ?? null : null,
          created_by_user_id: context.user_id ?? null,
          created_at: now,
          updated_at: now,
        },
      });
    });
  }

  private toSubmissionRecord(row: any): PilaSubmissionRecord {
    return {
      id: row.id,
      organization_id: row.organization_id,
      accounting_entity_id: row.accounting_entity_id,
      period_year: row.period_year,
      period_month: row.period_month,
      status: row.status,
      employees_count: row.employees_count,
      total_earnings: row.total_earnings?.toString?.() ?? String(row.total_earnings),
      total_contributions:
        row.total_contributions?.toString?.() ?? String(row.total_contributions),
      metadata: row.metadata ?? null,
      exported_at: row.exported_at ? row.exported_at.toISOString() : null,
      exported_by_user_id: row.exported_by_user_id ?? null,
      voided_at: row.voided_at ? row.voided_at.toISOString() : null,
      voided_by_user_id: row.voided_by_user_id ?? null,
      void_reason: row.void_reason ?? null,
      created_by_user_id: row.created_by_user_id ?? null,
      created_at: row.created_at ? row.created_at.toISOString() : null,
      updated_at: row.updated_at ? row.updated_at.toISOString() : null,
    };
  }

  // ═══ Private helpers ═══

  /**
   * IBC = salario base devengado + devengos salariales (horas extra,
   * comisiones, bonos salariales). El subsidio de transporte NO cotiza.
   */
  private calculateIbc(
    earnings: Record<string, unknown>,
    base_salary_fallback: number,
  ): number {
    let ibc = this.num(earnings.base_salary) || base_salary_fallback || 0;

    if (Array.isArray(earnings.overtime)) {
      for (const entry of earnings.overtime) {
        if (entry && typeof entry === 'object') {
          ibc += this.num((entry as Record<string, unknown>).amount);
        }
      }
    }

    ibc += this.num(earnings.commissions);

    if (Array.isArray(earnings.bonuses)) {
      for (const entry of earnings.bonuses) {
        if (entry && typeof entry === 'object') {
          ibc += this.num((entry as Record<string, unknown>).taxable);
        }
      }
    }

    return this.round(ibc);
  }

  private buildTotals(employees: PilaEmployeeContribution[]): PilaPeriodTotals {
    const totals = this.emptyTotals();
    for (const emp of employees) {
      totals.ibc = this.round(totals.ibc + emp.ibc);
      totals.health_employee = this.round(
        totals.health_employee + emp.health_employee,
      );
      totals.health_employer = this.round(
        totals.health_employer + emp.health_employer,
      );
      totals.pension_employee = this.round(
        totals.pension_employee + emp.pension_employee,
      );
      totals.pension_employer = this.round(
        totals.pension_employer + emp.pension_employer,
      );
      totals.arl = this.round(totals.arl + emp.arl);
      totals.sena = this.round(totals.sena + emp.sena);
      totals.icbf = this.round(totals.icbf + emp.icbf);
      totals.compensation_fund = this.round(
        totals.compensation_fund + emp.compensation_fund,
      );
      totals.total = this.round(totals.total + emp.total);
    }
    return totals;
  }

  private emptyTotals(): PilaPeriodTotals {
    return {
      ibc: 0,
      health_employee: 0,
      health_employer: 0,
      pension_employee: 0,
      pension_employer: 0,
      arl: 0,
      sena: 0,
      icbf: 0,
      compensation_fund: 0,
      total: 0,
    };
  }

  private emptyFlags(): PilaNoveltyFlags {
    return {
      vacation: false,
      incapacity_general: false,
      incapacity_laboral: false,
      unpaid_leave: false,
      ingreso: false,
      retiro: false,
      salary_variation_permanent: false,
      salary_variation_transitory: false,
      maternity_leave: false,
    };
  }

  private emptyDates(): PilaNoveltyDates {
    return {
      ingreso: null,
      retiro: null,
      incapacity_general: { start: null, end: null },
      maternity_leave: { start: null, end: null },
      vacation: { start: null, end: null },
      incapacity_laboral: { start: null, end: null },
      unpaid_leave: { start: null, end: null },
      salary_variation_permanent_start: null,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private num(value: unknown): number {
    if (typeof value === 'number') return isNaN(value) ? 0 : value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private sanitizeCsvField(value: string): string {
    return (value || '').replace(/[;\r\n]/g, ' ').trim();
  }

  // ═══ IBC / novedades helpers ═══

  /**
   * Resuelve el SMMLV vigente del período desde las reglas de nómina
   * (store → org → system defaults). Devuelve 0 si no se puede resolver,
   * lo que deshabilita los topes de forma defensiva.
   */
  private async resolveMinimumWage(
    year: number,
    store_id: number | null,
  ): Promise<number> {
    try {
      const rules = await this.payrollRules.getRulesForYear(year, store_id);
      const mw = Number(rules?.minimum_wage);
      return !isFinite(mw) || mw <= 0 ? 0 : mw;
    } catch (error) {
      this.logger.warn(
        `No se pudo resolver el SMMLV ${year}: ${String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Aplica los topes legales de IBC sobre el valor mensual consolidado del
   * cotizante: piso = 1 SMMLV prorrateado por días cotizados (art. 5 Ley
   * 797/2003) y techo = 25 SMMLV.
   */
  private clampIbc(
    raw_ibc: number,
    worked_days: number,
    minimum_wage: number,
  ): number {
    if (minimum_wage <= 0) return this.round(raw_ibc);
    const days = Math.min(Math.max(worked_days, 0), PILA_DAYS_PER_MONTH);
    const floor = this.round((minimum_wage * days) / PILA_DAYS_PER_MONTH);
    const ceiling = minimum_wage * IBC_CEILING_SMMLV;
    return this.round(Math.min(Math.max(raw_ibc, floor), ceiling));
  }

  /**
   * Base salarial del período inmediatamente anterior por empleado, para
   * detectar la novedad VSP (variación permanente de salario).
   */
  private async getPreviousPeriodBaseSalaries(
    year: number,
    month: number,
    store_id: number | null,
  ): Promise<Map<number, number>> {
    const prev_year = month === 1 ? year - 1 : year;
    const prev_month = month === 1 ? 12 : month - 1;
    const start = new Date(Date.UTC(prev_year, prev_month - 1, 1));
    const end = new Date(Date.UTC(prev_year, prev_month, 1));

    const map = new Map<number, number>();
    const runs = await this.prisma.payroll_runs.findMany({
      where: {
        period_start: { gte: start, lt: end },
        status: { notIn: ['draft', 'cancelled'] },
        ...(store_id ? { store_id } : {}),
      },
      select: { id: true },
    });
    const run_ids = runs.map((run: { id: number }) => run.id);
    if (run_ids.length === 0) return map;

    const items = await this.prisma.payroll_items.findMany({
      where: { payroll_run_id: { in: run_ids } },
      select: { employee_id: true, base_salary: true },
    });
    for (const item of items) {
      if (item.employee_id != null) {
        map.set(item.employee_id, Number(item.base_salary) || 0);
      }
    }
    return map;
  }

  /**
   * Construye flags + fechas + días de IRL por empleado a partir de las
   * novedades aplicadas del período.
   */
  private buildNoveltyMeta(
    novelties: Array<{
      employee_id: number;
      novelty_type: string;
      date_start: Date | null;
      date_end: Date | null;
      days: unknown;
    }>,
  ): Map<
    number,
    { flags: PilaNoveltyFlags; dates: PilaNoveltyDates; irl_days: number }
  > {
    const map = new Map<
      number,
      { flags: PilaNoveltyFlags; dates: PilaNoveltyDates; irl_days: number }
    >();

    for (const nov of novelties) {
      let entry = map.get(nov.employee_id);
      if (!entry) {
        entry = {
          flags: this.emptyFlags(),
          dates: this.emptyDates(),
          irl_days: 0,
        };
        map.set(nov.employee_id, entry);
      }

      const start = this.formatDateYmd(nov.date_start);
      const end = this.formatDateYmd(nov.date_end);

      switch (nov.novelty_type) {
        case 'vacation':
          entry.flags.vacation = true;
          entry.dates.vacation = { start, end };
          break;
        case 'incapacity_general':
          entry.flags.incapacity_general = true;
          entry.dates.incapacity_general = { start, end };
          break;
        case 'incapacity_laboral':
          entry.flags.incapacity_laboral = true;
          entry.dates.incapacity_laboral = { start, end };
          entry.irl_days += this.noveltyDays(nov.days);
          break;
        case 'leave_unpaid':
          entry.flags.unpaid_leave = true;
          entry.dates.unpaid_leave = { start, end };
          break;
        case 'maternity_leave':
        case 'paternity_leave':
          entry.flags.maternity_leave = true;
          entry.dates.maternity_leave = { start, end };
          break;
      }
    }
    return map;
  }

  /**
   * Deriva las novedades ING/RET (fechas del contrato dentro del período) y
   * VSP (cambio de salario respecto del período anterior). Idempotente: se
   * invoca por cada item del empleado y produce siempre el mismo resultado.
   */
  private applyEmployeeNovelties(
    contribution: PilaEmployeeContribution,
    hire_date: Date | null,
    termination_date: Date | null,
    period_start: Date,
    period_end: Date,
    prev_salaries: Map<number, number>,
  ): void {
    if (
      hire_date &&
      hire_date >= period_start &&
      hire_date < period_end
    ) {
      contribution.novelty_flags.ingreso = true;
      contribution.novelty_dates.ingreso = this.formatDateYmd(hire_date);
    }
    if (
      termination_date &&
      termination_date >= period_start &&
      termination_date < period_end
    ) {
      contribution.novelty_flags.retiro = true;
      contribution.novelty_dates.retiro = this.formatDateYmd(termination_date);
    }

    const prev = prev_salaries.get(contribution.employee_id);
    if (prev !== undefined && prev !== contribution.base_salary) {
      contribution.novelty_flags.salary_variation_permanent = true;
      contribution.novelty_dates.salary_variation_permanent_start =
        this.formatDateYmd(period_start);
    }
  }

  private noveltyDays(value: unknown): number {
    const n = value == null ? 0 : Number(value);
    return isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  /** Formatea una fecha a 'AAAA-MM-DD' en UTC (evita off-by-one). */
  private formatDateYmd(date: Date | null | undefined): string | null {
    if (!date) return null;
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ═══ Archivo plano oficial PILA (Res. 2388/2016) ═══

  /**
   * Genera el ARCHIVO PLANO oficial PILA (archivo tipo 2): un registro tipo 1
   * (encabezado) + un registro tipo 2 por cotizante, en formato de ancho fijo
   * separado por CRLF. Listo para pago por operador (SOI / Aportes en Línea).
   * Planilla tipo 'E' (empleados). Registra la exportación en
   * `pila_submissions`.
   */
  async generateFlatFile(
    year: number,
    month: number,
    store_id: number | null = null,
  ): Promise<PilaFlatFileResult> {
    const report = await this.getContributionsForPeriod(year, month, store_id);
    const aportante = await this.resolveAportanteIdentity(store_id);

    const header = this.buildType1Record(year, month, report, aportante);
    const details = report.employees.map((emp, index) =>
      this.buildType2Record(emp, index + 1),
    );

    // Archivo de ancho fijo: cada registro en su línea, terminado en CRLF.
    const content = [header, ...details].join('\r\n') + '\r\n';
    const filename = `pila_${year}_${String(month).padStart(2, '0')}.txt`;

    await this.recordSubmission({
      year,
      month,
      store_id,
      status: 'exported',
      report,
    });

    return { filename, content, cotizantes: report.employees.length };
  }

  /**
   * Resuelve la identidad fiscal del APORTANTE (empleador) para el encabezado:
   * razón social, tipo documento (NI = NIT), número y dígito de verificación.
   */
  private async resolveAportanteIdentity(store_id: number | null): Promise<{
    razon_social: string;
    tipo_doc: string;
    numero: string;
    dv: string;
  }> {
    const context = this.getContext();
    let razon_social = '';
    let tax_id = '';

    if (context.organization_id) {
      const entity = await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id: context.organization_id,
        store_id: store_id ?? context.store_id,
      });
      const row = entity as {
        legal_name?: string | null;
        name?: string | null;
        tax_id?: string | null;
      };
      razon_social = row?.legal_name || row?.name || '';
      tax_id = row?.tax_id || '';
    }

    const { numero, dv } = this.parseNit(tax_id);
    return { razon_social, tipo_doc: 'NI', numero, dv };
  }

  private buildType1Record(
    year: number,
    month: number,
    report: PilaPeriodReport,
    aportante: {
      razon_social: string;
      tipo_doc: string;
      numero: string;
      dv: string;
    },
  ): string {
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const values: Record<number, PilaFieldValue> = {
      1: '01', // Tipo de registro
      2: 0, // Modalidad (la asigna el operador)
      3: 1, // Secuencia (inicia en 0001)
      4: (aportante.razon_social || '').toUpperCase(),
      5: aportante.tipo_doc, // NI
      6: aportante.numero,
      7: aportante.dv || 0,
      8: 'E', // Planilla empleados
      9: 0, // Número planilla asociada (blanco/0 para E)
      10: '', // Fecha planilla asociada (blanco para E)
      11: '', // Forma de presentación
      12: '', // Código sucursal
      13: '', // Nombre sucursal
      14: '', // Código ARL
      15: period, // Período pago sistemas diferentes a salud
      16: period, // Período pago salud
      17: 0, // Radicación (la asigna el operador)
      18: '', // Fecha de pago (la asigna el operador)
      19: report.employees.length, // Total cotizantes
      20: Math.round(report.totals.ibc), // Valor total de la nómina (∑ IBC)
      21: 1, // Tipo de aportante (empleador)
      22: 0, // Código del operador (lo asigna el operador)
    };
    return buildPilaRecord(PILA_TYPE1_LAYOUT, PILA_TYPE1_TOTAL_LENGTH, values);
  }

  private buildType2Record(
    emp: PilaEmployeeContribution,
    secuencia: number,
  ): string {
    const ibc = Math.round(emp.ibc);
    const days = Math.min(Math.max(emp.worked_days, 0), PILA_DAYS_PER_MONTH);
    const pension_total = this.round(
      emp.pension_employee + emp.pension_employer,
    );
    const health_total = this.round(emp.health_employee + emp.health_employer);

    const last = this.splitName(emp.last_name);
    const first = this.splitName(emp.first_name);
    const nd = emp.novelty_dates;

    const values: Record<number, PilaFieldValue> = {
      1: '02',
      2: secuencia,
      3: this.mapCotizanteDocType(emp.document_type),
      4: (emp.document_number || '').toUpperCase(),
      5: 1, // Tipo cotizante: 1 = Dependiente
      6: 0, // Subtipo de cotizante: 00 = ninguno
      7: '', // Extranjero no obligado a pensión
      8: '', // Colombiano en el exterior
      9: '', // Depto ubicación laboral
      10: '', // Municipio ubicación laboral
      11: last.primer,
      12: last.segundo,
      13: first.primer,
      14: first.segundo,
      15: emp.novelty_flags.ingreso ? 'X' : '', // ING
      16: emp.novelty_flags.retiro ? 'X' : '', // RET
      17: '', // TDE
      18: '', // TAE
      19: '', // TDP
      20: '', // TAP
      21: emp.novelty_flags.salary_variation_permanent ? 'X' : '', // VSP
      22: '', // Correcciones
      23: emp.novelty_flags.salary_variation_transitory ? 'X' : '', // VST
      24: emp.novelty_flags.unpaid_leave ? 'X' : '', // SLN
      25: emp.novelty_flags.incapacity_general ? 'X' : '', // IGE
      26: emp.novelty_flags.maternity_leave ? 'X' : '', // LMA
      27: emp.novelty_flags.vacation ? 'X' : '', // VAC-LR
      28: '', // AVP
      29: '', // VCT
      30: Math.min(emp.irl_days, PILA_DAYS_PER_MONTH), // IRL (días)
      31: '', // Código admin pensiones (pertenece)
      32: '', // Código admin pensiones (traslado)
      33: '', // Código EPS (pertenece)
      34: '', // Código EPS (traslado)
      35: '', // Código CCF (pertenece)
      36: days, // Días cotizados pensión
      37: days, // Días cotizados salud
      38: days, // Días cotizados riesgos laborales
      39: days, // Días cotizados CCF
      40: Math.round(emp.base_salary), // Salario básico
      41: emp.salary_type === 'integral' ? 'X' : '', // Salario integral
      42: ibc, // IBC pensión
      43: ibc, // IBC salud
      44: ibc, // IBC riesgos laborales
      45: ibc, // IBC CCF
      46: this.computeTarifa(pension_total, ibc), // Tarifa pensión
      47: pension_total, // Cotización obligatoria pensiones
      48: 0, // Aporte voluntario afiliado
      49: 0, // Aporte voluntario aportante
      50: pension_total, // Total cotización pensiones (47+48+49)
      51: 0, // FSP - subcuenta solidaridad
      52: 0, // FSP - subcuenta subsistencia
      53: 0, // Valor no retenido aportes voluntarios
      54: this.computeTarifa(health_total, ibc), // Tarifa salud
      55: health_total, // Cotización obligatoria salud
      56: 0, // UPC adicional
      57: '', // N° autorización incapacidad general
      58: 0, // Valor incapacidad general
      59: '', // N° autorización licencia maternidad
      60: 0, // Valor licencia maternidad
      61: this.computeTarifa(emp.arl, ibc), // Tarifa riesgos laborales
      62: 0, // Centro de trabajo CT
      63: Math.round(emp.arl), // Cotización obligatoria ARL
      64: this.computeTarifa(emp.compensation_fund, ibc), // Tarifa CCF
      65: Math.round(emp.compensation_fund), // Valor aporte CCF
      66: this.computeTarifa(emp.sena, ibc), // Tarifa SENA
      67: Math.round(emp.sena), // Valor aporte SENA
      68: this.computeTarifa(emp.icbf, ibc), // Tarifa ICBF
      69: Math.round(emp.icbf), // Valor aporte ICBF
      70: 0, // Tarifa ESAP
      71: 0, // Valor aporte ESAP
      72: 0, // Tarifa MEN
      73: 0, // Valor aporte MEN
      74: '', // Tipo doc cotizante principal
      75: '', // Número id cotizante principal
      76: emp.exonerated ? 'S' : 'N', // Exonerado salud/SENA/ICBF
      77: '', // Código ARL
      78: emp.arl_risk_level != null ? String(emp.arl_risk_level) : '', // Clase riesgo
      79: '', // Indicador tarifa especial
      80: nd.ingreso ?? '', // Fecha ingreso
      81: nd.retiro ?? '', // Fecha retiro
      82: nd.salary_variation_permanent_start ?? '', // Fecha inicio VSP
      83: nd.unpaid_leave.start ?? '', // Fecha inicio SLN
      84: nd.unpaid_leave.end ?? '', // Fecha fin SLN
      85: nd.incapacity_general.start ?? '', // Fecha inicio IGE
      86: nd.incapacity_general.end ?? '', // Fecha fin IGE
      87: nd.maternity_leave.start ?? '', // Fecha inicio LMA
      88: nd.maternity_leave.end ?? '', // Fecha fin LMA
      89: nd.vacation.start ?? '', // Fecha inicio VAC-LR
      90: nd.vacation.end ?? '', // Fecha fin VAC-LR
      91: '', // Fecha inicio VCT
      92: '', // Fecha fin VCT
      93: nd.incapacity_laboral.start ?? '', // Fecha inicio IRL
      94: nd.incapacity_laboral.end ?? '', // Fecha fin IRL
      95: 0, // IBC otros parafiscales
      96: 0, // Número de horas laboradas
      97: '', // Fecha novedad / dato final
    };
    return buildPilaRecord(PILA_TYPE2_LAYOUT, PILA_TYPE2_TOTAL_LENGTH, values);
  }

  /**
   * Tarifa PILA: porcentaje efectivo del aporte respecto del IBC, expresado
   * como entero con 2 decimales implícitos (p.ej. 16.00% -> 1600, 12.50% ->
   * 1250). El operador revalida la tarifa contra el IBC y el valor aportado.
   * NOTA: la cantidad exacta de decimales por campo debe confirmarse contra
   * datos reales (Step 16); ARL puede requerir mayor precisión.
   */
  private computeTarifa(value: number, ibc: number): number {
    if (ibc <= 0) return 0;
    return Math.round((value / ibc) * 10000);
  }

  /** Separa un nombre compuesto en primer token y resto. */
  private splitName(name: string): { primer: string; segundo: string } {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { primer: '', segundo: '' };
    return { primer: parts[0], segundo: parts.slice(1).join(' ') };
  }

  /**
   * Mapea el tipo de documento del cotizante al catálogo válido del campo 3
   * del registro tipo 2. Si no coincide, usa 'CC' por defecto.
   */
  private mapCotizanteDocType(document_type: string): string {
    const dt = (document_type || '').toUpperCase().trim();
    return VALID_COTIZANTE_DOC_TYPES.has(dt) ? dt : 'CC';
  }

  /**
   * Extrae número de identificación y dígito de verificación del NIT del
   * aportante. Si el tax_id no incluye el DV, lo calcula (algoritmo DIAN).
   */
  private parseNit(tax_id: string): { numero: string; dv: string } {
    const raw = (tax_id || '').trim();
    if (!raw) return { numero: '', dv: '' };
    if (raw.includes('-')) {
      const [n, d] = raw.split('-');
      const numero = (n || '').replace(/\D/g, '');
      const dv = (d || '').replace(/\D/g, '') || this.computeNitDv(numero);
      return { numero, dv: dv.slice(-1) };
    }
    const numero = raw.replace(/\D/g, '');
    return { numero, dv: this.computeNitDv(numero) };
  }

  /** Dígito de verificación de un NIT colombiano (algoritmo módulo 11 DIAN). */
  private computeNitDv(nit: string): string {
    const digits = (nit || '').replace(/\D/g, '');
    if (!digits) return '';
    const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    const reversed = digits.split('').reverse();
    let sum = 0;
    for (let i = 0; i < reversed.length && i < weights.length; i++) {
      sum += Number(reversed[i]) * weights[i];
    }
    const mod = sum % 11;
    return String(mod > 1 ? 11 - mod : mod);
  }
}
