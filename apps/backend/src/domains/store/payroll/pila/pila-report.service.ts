import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import {
  PilaCsvExport,
  PilaEmployeeContribution,
  PilaNoveltyFlags,
  PilaPeriodReport,
  PilaPeriodTotals,
  PilaSubmissionRecord,
} from './interfaces/pila-report.interface';
import { QueryPilaSubmissionsDto } from './dto/query-pila-submissions.dto';

/** Tipos de novedad que se reflejan como flags PILA. */
const PILA_NOVELTY_TYPES = [
  'vacation',
  'incapacity_general',
  'incapacity_laboral',
  'leave_unpaid',
] as const;

const CSV_SEPARATOR = ';';

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

    const [items, novelties] = await Promise.all([
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
        select: { employee_id: true, novelty_type: true },
      }),
    ]);

    // Flags de novedad por empleado
    const flags_by_employee = new Map<number, PilaNoveltyFlags>();
    for (const novelty of novelties) {
      const flags =
        flags_by_employee.get(novelty.employee_id) || this.emptyFlags();
      switch (novelty.novelty_type) {
        case 'vacation':
          flags.vacation = true;
          break;
        case 'incapacity_general':
          flags.incapacity_general = true;
          break;
        case 'incapacity_laboral':
          flags.incapacity_laboral = true;
          break;
        case 'leave_unpaid':
          flags.unpaid_leave = true;
          break;
      }
      flags_by_employee.set(novelty.employee_id, flags);
    }

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

      const contribution: PilaEmployeeContribution = by_employee.get(
        employee.id,
      ) || {
        employee_id: employee.id,
        document_type: employee.document_type,
        document_number: employee.document_number,
        full_name:
          `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim(),
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
        novelty_flags: flags_by_employee.get(employee.id) || this.emptyFlags(),
        total: 0,
      };

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
}
