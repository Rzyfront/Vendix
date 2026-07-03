import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { EmployeeFiscalProfileDto } from './dto/employee-fiscal-profile.dto';
import { PayrollRulesService } from '../calculation/payroll-rules.service';
import {
  calculateFixedRateSemester,
  MonthlyIncomeForSemesterRate,
} from '../calculation/retefuente-art383';

/**
 * Semestre fiscal vigente en formato `YYYY-1|YYYY-2` (art. 386 ET: el
 * porcentaje fijo se recalcula en junio, para el semestre jul-dic, y en
 * diciembre, para el semestre ene-jun del año siguiente).
 *
 * Meses 1-6 (ene-jun) → semestre "1" del año en curso.
 * Meses 7-12 (jul-dic) → semestre "2" del año en curso.
 * Usa componentes UTC (vendix-date-timezone): esto es cálculo de negocio,
 * no de despliegue visual, pero se evita cualquier corrimiento de día/mes
 * por husos horarios al derivar el semestre de "hoy".
 */
export function resolveCurrentSemester(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1..12
  const half = month <= 6 ? 1 : 2;
  return `${year}-${half}`;
}

@Injectable()
export class EmployeeFiscalProfileService {
  private readonly logger = new Logger(EmployeeFiscalProfileService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly payroll_rules_service: PayrollRulesService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  /**
   * Obtiene el perfil fiscal del empleado. Crea un perfil vacío (defaults
   * proc1 / 0) en la primera lectura si no existe, para que la UI siempre
   * reciba un objeto editable.
   */
  async getOrCreate(employeeId: number) {
    const context = this.getContext();
    const unscoped = this.prisma.withoutScope() as any;

    const employee = await unscoped.employees.findFirst({
      where: { id: employeeId, organization_id: context.organization_id },
      select: { id: true },
    });
    if (!employee) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_FIND_001);
    }

    const existing = await unscoped.employee_fiscal_profiles.findUnique({
      where: { employee_id: employeeId },
    });
    if (existing) {
      return this.toResponse(existing);
    }

    const fiscal_year = new Date().getFullYear();
    const created = await unscoped.employee_fiscal_profiles.create({
      data: {
        employee_id: employeeId,
        organization_id: context.organization_id!,
        certificate_year: fiscal_year,
        dependents_count: 0,
        housing_interest_monthly: new Prisma.Decimal(0),
        prepaid_medicine_monthly: new Prisma.Decimal(0),
        voluntary_pension_monthly: new Prisma.Decimal(0),
        afc_monthly: new Prisma.Decimal(0),
        retention_procedure: 'proc1',
        fixed_retention_rate: null,
        rate_semester: null,
      },
    });
    return this.toResponse(created);
  }

  /**
   * Crea o actualiza el perfil fiscal (upsert por employee_id).
   * Reglas:
   * - Si retention_procedure='proc2', fixed_retention_rate es OBLIGATORIO.
   * - rate_semester debe ser YYYY-1|YYYY-2 (validado en el DTO).
   */
  async upsert(employeeId: number, dto: EmployeeFiscalProfileDto) {
    const context = this.getContext();
    const unscoped = this.prisma.withoutScope() as any;

    const employee = await unscoped.employees.findFirst({
      where: { id: employeeId, organization_id: context.organization_id },
      select: { id: true },
    });
    if (!employee) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_FIND_001);
    }

    if (dto.retention_procedure === 'proc2') {
      if (dto.fixed_retention_rate == null) {
        throw new VendixHttpException(ErrorCodes.PAYROLL_FISCAL_PROFILE_001);
      }
    }

    const data = {
      employee_id: employeeId,
      organization_id: context.organization_id!,
      certificate_year: new Date().getFullYear(),
      dependents_count: dto.dependents_count ?? 0,
      housing_interest_monthly: new Prisma.Decimal(
        dto.housing_interest_monthly ?? 0,
      ),
      prepaid_medicine_monthly: new Prisma.Decimal(
        dto.prepaid_medicine_monthly ?? 0,
      ),
      voluntary_pension_monthly: new Prisma.Decimal(
        dto.voluntary_pension_monthly ?? 0,
      ),
      afc_monthly: new Prisma.Decimal(dto.afc_monthly ?? 0),
      retention_procedure: (dto.retention_procedure ?? 'proc1') as any,
      fixed_retention_rate:
        dto.fixed_retention_rate != null
          ? new Prisma.Decimal(dto.fixed_retention_rate)
          : null,
      rate_semester: dto.rate_semester ?? null,
    };

    const upserted = await unscoped.employee_fiscal_profiles.upsert({
      where: { employee_id: employeeId },
      create: data,
      update: data,
    });
    return this.toResponse(upserted);
  }

  /**
   * Acción de cálculo semestral del porcentaje fijo (Procedimiento 2, art.
   * 386 ET). Invocable manualmente por el agente retenedor (endpoint) en
   * junio/diciembre, o para cualquier semestre indicado explícitamente.
   *
   * Fuente del histórico: `payroll_items` de los últimos 12 meses cerrados
   * (payroll_runs.period_end < inicio del semestre a calcular), leyendo
   * `earnings`/`deductions` YA persistidos — nunca se recalcula la nómina
   * histórica, solo se reconstruye el ingreso gravable (mismo criterio que
   * alimenta el IBC): base_salary + overtime + bonuses(taxable) + commissions,
   * y las deducciones obligatorias de salud/pensión ya persistidas.
   *
   * Si no hay NINGÚN mes de histórico en la ventana, lanza
   * PAYROLL_FISCAL_PROFILE_003 (nunca persistir un porcentaje inventado ni
   * dejar el perfil en un estado ambiguo).
   *
   * Persiste `fixed_retention_rate` (0..100, 2 decimales — misma escala que
   * la captura manual del DTO), `rate_semester` y `last_calculated_at`.
   */
  async calculateSemesterRate(employeeId: number, semester?: string) {
    const context = this.getContext();
    const unscoped = this.prisma.withoutScope() as any;

    const employee = await unscoped.employees.findFirst({
      where: { id: employeeId, organization_id: context.organization_id },
      select: { id: true },
    });
    if (!employee) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_FIND_001);
    }

    const target_semester = semester ?? resolveCurrentSemester();
    const match = /^(\d{4})-([12])$/.exec(target_semester);
    if (!match) {
      // Formato inesperado: solo puede llegar así si el DTO de entrada no
      // valida (defensa en profundidad; el DTO del endpoint ya exige el
      // patrón YYYY-1|YYYY-2 igual que EmployeeFiscalProfileDto.rate_semester).
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_FISCAL_PROFILE_003,
        `rate_semester must match YYYY-1 or YYYY-2 (received "${target_semester}")`,
      );
    }
    const semester_year = Number(match[1]);
    const semester_half = Number(match[2]);
    // El semestre calculado el 30/jun aplica a jul-dic; el calculado el
    // 31/dic aplica a ene-jun del año siguiente. La ventana de 12 meses de
    // histórico se cuenta HACIA ATRÁS desde el inicio del semestre vigente.
    const semester_start_month = semester_half === 1 ? 0 : 6; // 0=ene, 6=jul (UTC month index)
    const semester_start = new Date(
      Date.UTC(semester_year, semester_start_month, 1),
    );
    const lookback_start = new Date(
      Date.UTC(semester_year, semester_start_month - 12, 1),
    );

    const payroll_items = await unscoped.payroll_items.findMany({
      where: {
        employee_id: employeeId,
        payroll_run: {
          period_end: { gte: lookback_start, lt: semester_start },
          // Solo corridas ya cerradas/confirmadas — nunca 'draft', 'rejected'
          // o 'cancelled' (ingresos aún no consolidados o inválidos).
          status: { in: ['calculated', 'approved', 'sent', 'accepted', 'paid'] },
        },
      },
      select: {
        earnings: true,
        deductions: true,
        payroll_run: { select: { period_end: true, accounting_entity_id: true } },
      },
      orderBy: { payroll_run: { period_end: 'asc' } },
    });

    if (!payroll_items.length) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_FISCAL_PROFILE_003);
    }

    const fiscal_year = semester_start.getUTCFullYear();
    const accounting_entity_id =
      payroll_items[payroll_items.length - 1]?.payroll_run
        ?.accounting_entity_id ?? null;
    const uvt_value = await this.payroll_rules_service.getUvtValueForYear(
      fiscal_year,
      accounting_entity_id,
    );
    if (!uvt_value || uvt_value <= 0) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_FISCAL_PROFILE_003,
        `No UVT configured for year ${fiscal_year}; cannot calculate the fixed semester rate.`,
      );
    }

    const months: MonthlyIncomeForSemesterRate[] = payroll_items.map(
      (item: any) => {
        const earnings = (item.earnings ?? {}) as Record<string, any>;
        const deductions = (item.deductions ?? {}) as Record<string, any>;
        const overtime_total = Array.isArray(earnings.overtime)
          ? earnings.overtime.reduce(
              (sum: number, e: any) => sum + Number(e.amount || 0),
              0,
            )
          : 0;
        const bonuses_taxable_total = Array.isArray(earnings.bonuses)
          ? earnings.bonuses.reduce(
              (sum: number, b: any) => sum + Number(b.taxable || 0),
              0,
            )
          : 0;
        const commissions = Number(earnings.commissions || 0);
        const taxable_earnings =
          Number(earnings.base_salary || 0) +
          overtime_total +
          bonuses_taxable_total +
          commissions;

        const retention_details = deductions.retention_details as
          | { deductions_387?: Record<string, number> }
          | undefined;
        const has_387 = !!retention_details?.deductions_387;

        return {
          taxable_earnings,
          health_deduction: Number(deductions.health || 0),
          pension_deduction: Number(deductions.pension || 0),
          ...(has_387
            ? {
                art_387_deductions: {
                  dependents_count: 0, // no persistido individualmente; el monto ya viene neto en el snapshot
                  housing_interest_monthly:
                    retention_details!.deductions_387!.housing_interest ?? 0,
                  prepaid_medicine_monthly:
                    retention_details!.deductions_387!.prepaid_medicine ?? 0,
                  voluntary_pension_monthly: 0,
                  afc_monthly: 0,
                },
              }
            : {}),
        };
      },
    );

    const result = calculateFixedRateSemester(months, uvt_value, fiscal_year);

    // Escala de persistencia: 0..100 con 2 decimales (misma que la captura
    // manual vía DTO / Decimal(5,2) en employee_fiscal_profiles).
    const fixed_rate_pct = Math.round(result.fixed_retention_rate * 10000) / 100;

    const existing = await unscoped.employee_fiscal_profiles.findUnique({
      where: { employee_id: employeeId },
    });
    const base_data = {
      employee_id: employeeId,
      organization_id: context.organization_id!,
      certificate_year: fiscal_year,
      dependents_count: existing?.dependents_count ?? 0,
      housing_interest_monthly:
        existing?.housing_interest_monthly ?? new Prisma.Decimal(0),
      prepaid_medicine_monthly:
        existing?.prepaid_medicine_monthly ?? new Prisma.Decimal(0),
      voluntary_pension_monthly:
        existing?.voluntary_pension_monthly ?? new Prisma.Decimal(0),
      afc_monthly: existing?.afc_monthly ?? new Prisma.Decimal(0),
    };

    const upserted = await unscoped.employee_fiscal_profiles.upsert({
      where: { employee_id: employeeId },
      create: {
        ...base_data,
        retention_procedure: 'proc2',
        fixed_retention_rate: new Prisma.Decimal(fixed_rate_pct),
        rate_semester: target_semester,
        last_calculated_at: new Date(),
      },
      update: {
        retention_procedure: 'proc2',
        fixed_retention_rate: new Prisma.Decimal(fixed_rate_pct),
        rate_semester: target_semester,
        last_calculated_at: new Date(),
      },
    });

    this.logger.log(
      `Calculated proc2 fixed rate for employee #${employeeId}, semester ` +
        `${target_semester}: ${fixed_rate_pct}% (${months.length} months of ` +
        `history, avg taxable earnings ${result.average_taxable_earnings}).`,
    );

    return {
      ...this.toResponse(upserted),
      calculation_detail: {
        months_used: result.months_used,
        average_taxable_earnings: result.average_taxable_earnings,
        average_base_depurada: result.average_base_depurada,
        average_retention_proc1: result.average_retention_proc1,
        marginal_rate: result.marginal_rate,
      },
    };
  }

  private toResponse(row: any) {
    return {
      id: row.id,
      employee_id: row.employee_id,
      certificate_year: row.certificate_year,
      dependents_count: row.dependents_count,
      housing_interest_monthly: Number(row.housing_interest_monthly),
      prepaid_medicine_monthly: Number(row.prepaid_medicine_monthly),
      voluntary_pension_monthly: Number(row.voluntary_pension_monthly),
      afc_monthly: Number(row.afc_monthly),
      retention_procedure: row.retention_procedure,
      fixed_retention_rate:
        row.fixed_retention_rate != null
          ? Number(row.fixed_retention_rate)
          : null,
      rate_semester: row.rate_semester,
      last_calculated_at: row.last_calculated_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
