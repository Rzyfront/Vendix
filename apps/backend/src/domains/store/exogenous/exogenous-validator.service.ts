import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ExogenousValidationError } from './interfaces/exogenous.interface';

@Injectable()
export class ExogenousValidatorService {
  constructor(private readonly prisma: StorePrismaService) {}

  async validateCompleteness(
    fiscal_year: number,
  ): Promise<ExogenousValidationError[]> {
    const context = RequestContextService.getContext()!;
    const errors: ExogenousValidationError[] = [];

    // Check invoices without customer NIT (sales invoices)
    const invoices_without_nit = await (
      this.prisma as any
    ).withoutScope().invoices.findMany({
      where: {
        organization_id: context.organization_id,
        issue_date: {
          gte: new Date(`${fiscal_year}-01-01`),
          lt: new Date(`${fiscal_year + 1}-01-01`),
        },
        invoice_type: 'sales_invoice',
        status: { in: ['validated', 'accepted'] },
        OR: [{ customer_tax_id: null }, { customer_tax_id: '' }],
      },
      select: { id: true, invoice_number: true, customer_name: true },
      take: 100,
    });

    for (const inv of invoices_without_nit) {
      errors.push({
        type: 'missing_nit',
        resource: 'invoice',
        resource_id: inv.id,
        detail: `Factura ${inv.invoice_number} (${inv.customer_name || 'Sin nombre'}) sin NIT de cliente`,
      });
    }

    // Check invoices without customer name
    const invoices_without_name = await (
      this.prisma as any
    ).withoutScope().invoices.findMany({
      where: {
        organization_id: context.organization_id,
        issue_date: {
          gte: new Date(`${fiscal_year}-01-01`),
          lt: new Date(`${fiscal_year + 1}-01-01`),
        },
        invoice_type: 'sales_invoice',
        status: { in: ['validated', 'accepted'] },
        customer_tax_id: { not: null },
        OR: [{ customer_name: null }, { customer_name: '' }],
      },
      select: { id: true, invoice_number: true, customer_tax_id: true },
      take: 100,
    });

    for (const inv of invoices_without_name) {
      errors.push({
        type: 'missing_name',
        resource: 'invoice',
        resource_id: inv.id,
        detail: `Factura ${inv.invoice_number} (NIT: ${inv.customer_tax_id}) sin nombre de cliente`,
      });
    }

    // Check suppliers without tax_id that have invoices or purchase orders
    const suppliers_without_nit = await (
      this.prisma as any
    ).withoutScope().suppliers.findMany({
      where: {
        organization_id: context.organization_id,
        OR: [{ tax_id: null }, { tax_id: '' }],
        invoices: {
          some: {
            issue_date: {
              gte: new Date(`${fiscal_year}-01-01`),
              lt: new Date(`${fiscal_year + 1}-01-01`),
            },
          },
        },
      },
      select: { id: true, name: true, code: true },
      take: 100,
    });

    for (const sup of suppliers_without_nit) {
      errors.push({
        type: 'missing_nit',
        resource: 'supplier',
        resource_id: sup.id,
        detail: `Proveedor ${sup.name} (${sup.code}) sin NIT/identificación fiscal`,
      });
    }

    // Formato 2276 v4: el detalle del tercero exige dirección y municipio.
    // Empleados con pagos de nómina en el año sin address/city_code generan
    // warning de datos incompletos (el reporte se genera igual).
    const employees_incomplete = await (
      this.prisma as any
    ).withoutScope().employees.findMany({
      where: {
        organization_id: context.organization_id,
        payroll_items: {
          some: {
            payroll_run: {
              period_start: {
                gte: new Date(`${fiscal_year}-01-01`),
                lt: new Date(`${fiscal_year + 1}-01-01`),
              },
            },
          },
        },
        OR: [
          { address: null },
          { address: '' },
          { city_code: null },
          { city_code: '' },
        ],
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        employee_code: true,
        address: true,
        city_code: true,
      },
      take: 100,
    });

    for (const emp of employees_incomplete) {
      const missing: string[] = [];
      if (!emp.address) missing.push('dirección');
      if (!emp.city_code) missing.push('código de municipio');
      errors.push({
        type: 'incomplete_data',
        resource: 'employee',
        resource_id: emp.id,
        detail: `Empleado ${emp.first_name} ${emp.last_name} (${emp.employee_code}) sin ${missing.join(' ni ')} — requerido por el formato 2276 v4`,
      });
    }

    return errors;
  }
}
