import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ExogenousValidationError } from './interfaces/exogenous.interface';

@Injectable()
export class ExogenousValidatorService {
  constructor(private readonly prisma: StorePrismaService) {}

  async validateCompleteness(fiscal_year: number): Promise<ExogenousValidationError[]> {
    const context = RequestContextService.getContext()!;
    const errors: ExogenousValidationError[] = [];

    // Check invoices without customer NIT (sales invoices)
    const invoices_without_nit = await (this.prisma as any).client.invoices.findMany({
      where: {
        organization_id: context.organization_id,
        issue_date: {
          gte: new Date(`${fiscal_year}-01-01`),
          lt: new Date(`${fiscal_year + 1}-01-01`),
        },
        invoice_type: 'FV',
        status: { in: ['validated', 'accepted'] },
        OR: [
          { customer_tax_id: null },
          { customer_tax_id: '' },
        ],
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
    const invoices_without_name = await (this.prisma as any).client.invoices.findMany({
      where: {
        organization_id: context.organization_id,
        issue_date: {
          gte: new Date(`${fiscal_year}-01-01`),
          lt: new Date(`${fiscal_year + 1}-01-01`),
        },
        invoice_type: 'FV',
        status: { in: ['validated', 'accepted'] },
        customer_tax_id: { not: null },
        OR: [
          { customer_name: null },
          { customer_name: '' },
        ],
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
    const suppliers_without_nit = await (this.prisma as any).client.suppliers.findMany({
      where: {
        organization_id: context.organization_id,
        OR: [
          { tax_id: null },
          { tax_id: '' },
        ],
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

    return errors;
  }
}
