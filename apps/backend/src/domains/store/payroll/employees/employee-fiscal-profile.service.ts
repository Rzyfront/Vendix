import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { EmployeeFiscalProfileDto } from './dto/employee-fiscal-profile.dto';

@Injectable()
export class EmployeeFiscalProfileService {
  constructor(private readonly prisma: StorePrismaService) {}

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
