import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  PilaCsvExport,
  PilaEmployeeContribution,
  PilaNoveltyFlags,
  PilaPeriodReport,
  PilaPeriodTotals,
} from './interfaces/pila-report.interface';

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

  constructor(private readonly prisma: StorePrismaService) {}

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
    return { filename, content };
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
