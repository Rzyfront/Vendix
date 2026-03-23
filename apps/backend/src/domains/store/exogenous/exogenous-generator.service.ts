import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ExogenousLineData } from './interfaces/exogenous.interface';

@Injectable()
export class ExogenousGeneratorService {
  private readonly logger = new Logger(ExogenousGeneratorService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Formato 1001: Retenciones practicadas a terceros
   * Agrupa withholding_calculations por NIT de proveedor
   */
  async generateFormat1001(organization_id: number, store_id: number | null, year: number): Promise<ExogenousLineData[]> {
    const where_clause: any = {
      organization_id,
      year,
    };
    if (store_id) where_clause.store_id = store_id;

    const calculations = await (this.prisma as any).client.withholding_calculations.findMany({
      where: where_clause,
      include: {
        supplier: { select: { name: true, tax_id: true, verification_digit: true } },
        concept: { select: { code: true, name: true } },
      },
    });

    // Group by supplier NIT
    const grouped = new Map<string, { name: string; dv?: string; base: number; withholding: number; concept: string }>();

    for (const calc of calculations) {
      const nit = calc.supplier?.tax_id || 'SIN_NIT';
      const key = `${nit}_${calc.concept?.code || 'UNKNOWN'}`;
      const existing = grouped.get(key);

      if (existing) {
        existing.base += Number(calc.base_amount);
        existing.withholding += Number(calc.withholding_amount);
      } else {
        grouped.set(key, {
          name: calc.supplier?.name || 'Sin proveedor',
          dv: calc.supplier?.verification_digit || undefined,
          base: Number(calc.base_amount),
          withholding: Number(calc.withholding_amount),
          concept: calc.concept?.code || 'RTE_OTROS',
        });
      }
    }

    return Array.from(grouped.entries()).map(([key, data]) => ({
      third_party_nit: key.split('_')[0],
      third_party_name: data.name,
      third_party_dv: data.dv,
      concept_code: data.concept,
      payment_amount: data.base,
      tax_amount: 0,
      withholding_amount: data.withholding,
    }));
  }

  /**
   * Formato 1005: IVA descontable y generado
   * Agrupa invoice_taxes con IVA por NIT
   */
  async generateFormat1005(organization_id: number, store_id: number | null, year: number): Promise<ExogenousLineData[]> {
    const store_filter = store_id ? { store_id } : {};

    const invoices_with_iva = await (this.prisma as any).client.invoices.findMany({
      where: {
        organization_id,
        ...store_filter,
        issue_date: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
        status: { in: ['validated', 'accepted'] },
        invoice_taxes: { some: { tax_name: { contains: 'IVA' } } },
      },
      include: {
        invoice_taxes: { where: { tax_name: { contains: 'IVA' } } },
      },
    });

    const grouped = new Map<string, { name: string; iva_generated: number; taxable: number }>();

    for (const inv of invoices_with_iva) {
      const nit = inv.customer_tax_id || 'SIN_NIT';
      const existing = grouped.get(nit);
      const iva_total = inv.invoice_taxes.reduce((sum: number, t: any) => sum + Number(t.tax_amount), 0);
      const taxable_total = inv.invoice_taxes.reduce((sum: number, t: any) => sum + Number(t.taxable_amount), 0);

      if (existing) {
        existing.iva_generated += iva_total;
        existing.taxable += taxable_total;
      } else {
        grouped.set(nit, {
          name: inv.customer_name || 'Sin nombre',
          iva_generated: iva_total,
          taxable: taxable_total,
        });
      }
    }

    return Array.from(grouped.entries()).map(([nit, data]) => ({
      third_party_nit: nit,
      third_party_name: data.name,
      concept_code: 'IVA_GENERADO',
      payment_amount: data.taxable,
      tax_amount: data.iva_generated,
      withholding_amount: 0,
    }));
  }

  /**
   * Formato 1007: Ingresos recibidos de terceros
   * Agrupa facturas de venta por NIT de cliente
   */
  async generateFormat1007(organization_id: number, store_id: number | null, year: number): Promise<ExogenousLineData[]> {
    const store_filter = store_id ? { store_id } : {};

    const invoices = await (this.prisma as any).client.invoices.findMany({
      where: {
        organization_id,
        ...store_filter,
        invoice_type: 'FV',
        status: { in: ['validated', 'accepted'] },
        issue_date: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
      },
      select: {
        customer_tax_id: true,
        customer_name: true,
        subtotal_amount: true,
        tax_amount: true,
      },
    });

    const grouped = new Map<string, { name: string; subtotal: number; tax: number }>();

    for (const inv of invoices) {
      const nit = inv.customer_tax_id || 'SIN_NIT';
      const existing = grouped.get(nit);

      if (existing) {
        existing.subtotal += Number(inv.subtotal_amount);
        existing.tax += Number(inv.tax_amount);
      } else {
        grouped.set(nit, {
          name: inv.customer_name || 'Consumidor Final',
          subtotal: Number(inv.subtotal_amount),
          tax: Number(inv.tax_amount),
        });
      }
    }

    return Array.from(grouped.entries()).map(([nit, data]) => ({
      third_party_nit: nit,
      third_party_name: data.name,
      concept_code: 'INGRESOS',
      payment_amount: data.subtotal,
      tax_amount: data.tax,
      withholding_amount: 0,
    }));
  }

  /**
   * Formato 1008: Saldos cuentas por cobrar al cierre
   * Query accounting_entry_lines en cuentas 13xx
   */
  async generateFormat1008(organization_id: number, store_id: number | null, year: number): Promise<ExogenousLineData[]> {
    const year_end = new Date(`${year}-12-31T23:59:59`);

    const entries = await (this.prisma as any).client.accounting_entry_lines.findMany({
      where: {
        entry: {
          organization_id,
          entry_date: { lte: year_end },
          status: 'posted',
        },
        account: {
          code: { startsWith: '13' },
        },
      },
      include: {
        entry: { select: { source_type: true, source_id: true, description: true } },
        account: { select: { code: true, name: true } },
      },
    });

    // Aggregate by account code
    const grouped = new Map<string, { account_name: string; debit: number; credit: number }>();

    for (const line of entries) {
      const code = line.account.code;
      const existing = grouped.get(code);

      if (existing) {
        existing.debit += Number(line.debit_amount);
        existing.credit += Number(line.credit_amount);
      } else {
        grouped.set(code, {
          account_name: line.account.name,
          debit: Number(line.debit_amount),
          credit: Number(line.credit_amount),
        });
      }
    }

    return Array.from(grouped.entries())
      .map(([code, data]) => ({
        third_party_nit: organization_id.toString(),
        third_party_name: data.account_name,
        concept_code: code,
        payment_amount: data.debit - data.credit, // Net balance
        tax_amount: 0,
        withholding_amount: 0,
        line_data: { account_code: code, account_name: data.account_name },
      }))
      .filter(line => line.payment_amount !== 0);
  }

  /**
   * Formato 1009: Saldos cuentas por pagar al cierre
   * Query accounting_entry_lines en cuentas 22xx
   */
  /**
   * Formato 1003: Retenciones recibidas (practicadas por terceros a la empresa)
   * Agrupa withholding_calculations donde la empresa es el sujeto retenido,
   * agrupando por NIT del agente retenedor (supplier)
   */
  async generateFormat1003(organization_id: number, store_id: number | null, year: number): Promise<ExogenousLineData[]> {
    const where_clause: any = {
      organization_id,
      year,
    };
    if (store_id) where_clause.store_id = store_id;

    const calculations = await (this.prisma as any).client.withholding_calculations.findMany({
      where: where_clause,
      include: {
        supplier: { select: { name: true, tax_id: true, verification_digit: true } },
        concept: { select: { code: true, name: true } },
      },
    });

    // Group by supplier NIT (agente retenedor)
    const grouped = new Map<string, { name: string; dv?: string; base: number; withholding: number; concept: string }>();

    for (const calc of calculations) {
      const nit = calc.supplier?.tax_id || 'SIN_NIT';
      const concept_code = calc.concept?.code || 'RTE_OTROS';
      const key = `${nit}_${concept_code}`;
      const existing = grouped.get(key);

      if (existing) {
        existing.base += Number(calc.base_amount);
        existing.withholding += Number(calc.withholding_amount);
      } else {
        grouped.set(key, {
          name: calc.supplier?.name || 'Sin retenedor',
          dv: calc.supplier?.verification_digit || undefined,
          base: Number(calc.base_amount),
          withholding: Number(calc.withholding_amount),
          concept: concept_code,
        });
      }
    }

    return Array.from(grouped.entries()).map(([key, data]) => ({
      third_party_nit: key.split('_')[0],
      third_party_name: data.name,
      third_party_dv: data.dv,
      concept_code: data.concept,
      payment_amount: data.base,
      tax_amount: 0,
      withholding_amount: data.withholding,
    }));
  }

  /**
   * Formato 1006: IVA en compras a régimen simplificado/SIET
   * Filtra facturas de compra cuyo proveedor pertenece al régimen simple,
   * agrupa IVA asumido por NIT del proveedor
   */
  async generateFormat1006(organization_id: number, store_id: number | null, year: number): Promise<ExogenousLineData[]> {
    const store_filter = store_id ? { store_id } : {};

    // Facturas de compra con proveedores en régimen simple
    const invoices = await (this.prisma as any).client.invoices.findMany({
      where: {
        organization_id,
        ...store_filter,
        invoice_type: { in: ['FC', 'FV'] }, // FC = factura de compra
        status: { in: ['validated', 'accepted'] },
        issue_date: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
        supplier: {
          tax_regime: { in: ['regimen_simple', 'simplificado', 'SIET'] },
        },
      },
      include: {
        supplier: { select: { name: true, tax_id: true, verification_digit: true, tax_regime: true } },
        invoice_taxes: { where: { tax_name: { contains: 'IVA' } } },
      },
    });

    const grouped = new Map<string, { name: string; dv?: string; iva_assumed: number; taxable: number }>();

    for (const inv of invoices) {
      const nit = inv.supplier?.tax_id || inv.customer_tax_id || 'SIN_NIT';
      const existing = grouped.get(nit);
      const iva_total = inv.invoice_taxes.reduce((sum: number, t: any) => sum + Number(t.tax_amount), 0);
      const taxable_total = inv.invoice_taxes.reduce((sum: number, t: any) => sum + Number(t.taxable_amount), 0);

      if (existing) {
        existing.iva_assumed += iva_total;
        existing.taxable += taxable_total;
      } else {
        grouped.set(nit, {
          name: inv.supplier?.name || inv.customer_name || 'Sin nombre',
          dv: inv.supplier?.verification_digit || undefined,
          iva_assumed: iva_total,
          taxable: taxable_total,
        });
      }
    }

    return Array.from(grouped.entries()).map(([nit, data]) => ({
      third_party_nit: nit,
      third_party_name: data.name,
      third_party_dv: data.dv,
      concept_code: 'IVA_REGIMEN_SIMPLE',
      payment_amount: data.taxable,
      tax_amount: data.iva_assumed,
      withholding_amount: 0,
    }));
  }

  /**
   * Formato 1009: Saldos cuentas por pagar al cierre
   * Query accounting_entry_lines en cuentas 22xx
   */
  async generateFormat1009(organization_id: number, store_id: number | null, year: number): Promise<ExogenousLineData[]> {
    const year_end = new Date(`${year}-12-31T23:59:59`);

    const entries = await (this.prisma as any).client.accounting_entry_lines.findMany({
      where: {
        entry: {
          organization_id,
          entry_date: { lte: year_end },
          status: 'posted',
        },
        account: {
          code: { startsWith: '22' },
        },
      },
      include: {
        account: { select: { code: true, name: true } },
      },
    });

    const grouped = new Map<string, { account_name: string; debit: number; credit: number }>();

    for (const line of entries) {
      const code = line.account.code;
      const existing = grouped.get(code);

      if (existing) {
        existing.debit += Number(line.debit_amount);
        existing.credit += Number(line.credit_amount);
      } else {
        grouped.set(code, {
          account_name: line.account.name,
          debit: Number(line.debit_amount),
          credit: Number(line.credit_amount),
        });
      }
    }

    return Array.from(grouped.entries())
      .map(([code, data]) => ({
        third_party_nit: organization_id.toString(),
        third_party_name: data.account_name,
        concept_code: code,
        payment_amount: data.credit - data.debit, // Credit balance for payables
        tax_amount: 0,
        withholding_amount: 0,
        line_data: { account_code: code, account_name: data.account_name },
      }))
      .filter(line => line.payment_amount !== 0);
  }
}
