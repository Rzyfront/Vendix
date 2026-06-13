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
  async generateFormat1001(
    organization_id: number,
    store_id: number | null,
    year: number,
  ): Promise<ExogenousLineData[]> {
    // Formato 1001 = pagos y retenciones PRACTICADAS por la empresa a sus
    // proveedores. El tercero es el PROVEEDOR. Solo role='practiced'.
    const where_clause: any = {
      organization_id,
      year,
      role: 'practiced',
    };
    if (store_id) where_clause.store_id = store_id;

    const calculations = await (
      this.prisma as any
    ).withoutScope().withholding_calculations.findMany({
      where: where_clause,
      include: {
        supplier: {
          select: { name: true, tax_id: true, verification_digit: true },
        },
        concept: { select: { code: true, name: true } },
      },
    });

    // Group by supplier NIT
    const grouped = new Map<
      string,
      {
        name: string;
        dv?: string;
        base: number;
        withholding: number;
        concept: string;
      }
    >();

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
      role: 'practiced' as const,
    }));
  }

  /**
   * Formato 1005: IVA descontable y generado
   * Agrupa invoice_taxes con IVA por NIT
   */
  async generateFormat1005(
    organization_id: number,
    store_id: number | null,
    year: number,
  ): Promise<ExogenousLineData[]> {
    const store_filter = store_id ? { store_id } : {};

    const invoices_with_iva = await (
      this.prisma as any
    ).withoutScope().invoices.findMany({
      where: {
        organization_id,
        ...store_filter,
        issue_date: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
        status: { in: ['validated', 'accepted'] },
        invoice_taxes: {
          some: {
            OR: [
              { tax_type: 'iva' },
              { tax_type: null, tax_name: { contains: 'IVA' } },
            ],
          },
        },
      },
      include: {
        invoice_taxes: {
          where: {
            OR: [
              { tax_type: 'iva' },
              { tax_type: null, tax_name: { contains: 'IVA' } },
            ],
          },
        },
      },
    });

    const grouped = new Map<
      string,
      { name: string; iva_generated: number; taxable: number }
    >();

    for (const inv of invoices_with_iva) {
      const nit = inv.customer_tax_id || 'SIN_NIT';
      const existing = grouped.get(nit);
      const iva_total = inv.invoice_taxes.reduce(
        (sum: number, t: any) => sum + Number(t.tax_amount),
        0,
      );
      const taxable_total = inv.invoice_taxes.reduce(
        (sum: number, t: any) => sum + Number(t.taxable_amount),
        0,
      );

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
  async generateFormat1007(
    organization_id: number,
    store_id: number | null,
    year: number,
  ): Promise<ExogenousLineData[]> {
    const store_filter = store_id ? { store_id } : {};

    const invoices = await (this.prisma as any).withoutScope().invoices.findMany({
      where: {
        organization_id,
        ...store_filter,
        invoice_type: 'sales_invoice',
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

    const grouped = new Map<
      string,
      { name: string; subtotal: number; tax: number }
    >();

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
  async generateFormat1008(
    organization_id: number,
    store_id: number | null,
    year: number,
  ): Promise<ExogenousLineData[]> {
    const year_end = new Date(`${year}-12-31T23:59:59`);

    const entries = await (
      this.prisma as any
    ).withoutScope().accounting_entry_lines.findMany({
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
        entry: {
          select: { source_type: true, source_id: true, description: true },
        },
        account: { select: { code: true, name: true } },
      },
    });

    // Aggregate by account code
    const grouped = new Map<
      string,
      { account_name: string; debit: number; credit: number }
    >();

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
      .filter((line) => line.payment_amount !== 0);
  }

  /**
   * Formato 1009: Saldos cuentas por pagar al cierre
   * Query accounting_entry_lines en cuentas 22xx
   */
  /**
   * Formato 1003: Retenciones que me PRACTICARON (role='suffered').
   * La empresa es el sujeto retenido; el tercero NO es un proveedor sino el
   * CLIENTE AGENTE RETENEDOR que practicó la retención. Por eso se agrupa por
   * el identificador fiscal del customer (users.document_number), no por
   * supplier.
   */
  async generateFormat1003(
    organization_id: number,
    store_id: number | null,
    year: number,
  ): Promise<ExogenousLineData[]> {
    const where_clause: any = {
      organization_id,
      year,
      role: 'suffered',
    };
    if (store_id) where_clause.store_id = store_id;

    const calculations = await (
      this.prisma as any
    ).withoutScope().withholding_calculations.findMany({
      where: where_clause,
      include: {
        customer: {
          select: {
            first_name: true,
            last_name: true,
            document_number: true,
          },
        },
        concept: { select: { code: true, name: true } },
      },
    });

    // Group by customer document_number (agente retenedor)
    const grouped = new Map<
      string,
      {
        name: string;
        base: number;
        withholding: number;
        concept: string;
      }
    >();

    for (const calc of calculations) {
      const nit = calc.customer?.document_number || 'SIN_NIT';
      const concept_code = calc.concept?.code || 'RTE_OTROS';
      const key = `${nit}_${concept_code}`;
      const customerName = calc.customer
        ? `${calc.customer.first_name ?? ''} ${calc.customer.last_name ?? ''}`.trim()
        : '';
      const existing = grouped.get(key);

      if (existing) {
        existing.base += Number(calc.base_amount);
        existing.withholding += Number(calc.withholding_amount);
      } else {
        grouped.set(key, {
          name: customerName || 'Sin retenedor',
          base: Number(calc.base_amount),
          withholding: Number(calc.withholding_amount),
          concept: concept_code,
        });
      }
    }

    return Array.from(grouped.entries()).map(([key, data]) => ({
      third_party_nit: key.split('_')[0],
      third_party_name: data.name,
      concept_code: data.concept,
      payment_amount: data.base,
      tax_amount: 0,
      withholding_amount: data.withholding,
      role: 'suffered' as const,
    }));
  }

  /**
   * Formato 1006: IVA en compras a régimen simplificado/SIET
   * Filtra facturas de compra cuyo proveedor pertenece al régimen simple,
   * agrupa IVA asumido por NIT del proveedor
   */
  async generateFormat1006(
    organization_id: number,
    store_id: number | null,
    year: number,
  ): Promise<ExogenousLineData[]> {
    const store_filter = store_id ? { store_id } : {};

    // Facturas de compra con proveedores en régimen simple
    const invoices = await (this.prisma as any).withoutScope().invoices.findMany({
      where: {
        organization_id,
        ...store_filter,
        invoice_type: { in: ['purchase_invoice', 'sales_invoice'] }, // factura de compra y venta
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
        supplier: {
          select: {
            name: true,
            tax_id: true,
            verification_digit: true,
            tax_regime: true,
          },
        },
        invoice_taxes: {
          where: {
            OR: [
              { tax_type: 'iva' },
              { tax_type: null, tax_name: { contains: 'IVA' } },
            ],
          },
        },
      },
    });

    const grouped = new Map<
      string,
      { name: string; dv?: string; iva_assumed: number; taxable: number }
    >();

    for (const inv of invoices) {
      const nit = inv.supplier?.tax_id || inv.customer_tax_id || 'SIN_NIT';
      const existing = grouped.get(nit);
      const iva_total = inv.invoice_taxes.reduce(
        (sum: number, t: any) => sum + Number(t.tax_amount),
        0,
      );
      const taxable_total = inv.invoice_taxes.reduce(
        (sum: number, t: any) => sum + Number(t.taxable_amount),
        0,
      );

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
  async generateFormat1009(
    organization_id: number,
    store_id: number | null,
    year: number,
  ): Promise<ExogenousLineData[]> {
    const year_end = new Date(`${year}-12-31T23:59:59`);

    const entries = await (
      this.prisma as any
    ).withoutScope().accounting_entry_lines.findMany({
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

    const grouped = new Map<
      string,
      { account_name: string; debit: number; credit: number }
    >();

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
      .filter((line) => line.payment_amount !== 0);
  }

  /**
   * Formato 2276: Rentas de trabajo y pensiones (v4).
   *
   * Fuente A: payroll_items de runs del año (period_start dentro del año)
   * aceptados ante DIAN (item.dian_status='accepted') o de runs en estado
   * accepted/paid. Agrega por employee.document_number:
   * - salarios: earnings.base_salary + overtime[].amount + commissions +
   *   bonuses[].taxable
   * - prestaciones: pagos de vacations/disabilities/licenses
   * - aportes_salud / aportes_pension: deductions.health / deductions.pension
   * - retefuente: deductions.retention por empleado.
   *
   * Fuente B: withholding_calculations (role='practiced',
   * counterparty_type='employee', year) es la fuente canónica del TOTAL de
   * retefuente laboral; esas filas no llevan FK al empleado, por lo que la
   * atribución por tercero usa deductions.retention (espejo 1:1 creado por
   * payroll-flow al aceptar DIAN). Si los totales divergen se loguea warning.
   */
  async generateFormat2276(
    organization_id: number,
    store_id: number | null,
    year: number,
  ): Promise<ExogenousLineData[]> {
    const run_filter: any = {
      organization_id,
      period_start: {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${year + 1}-01-01`),
      },
    };
    if (store_id) run_filter.store_id = store_id;

    const items = await (this.prisma as any).withoutScope().payroll_items.findMany({
      where: {
        payroll_run: run_filter,
        OR: [
          { dian_status: 'accepted' },
          { payroll_run: { status: { in: ['accepted', 'paid'] } } },
        ],
      },
      include: {
        employee: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            document_type: true,
            document_number: true,
          },
        },
        payroll_run: { select: { id: true, status: true } },
      },
    });

    const num = (value: unknown): number => {
      if (typeof value === 'number') return isNaN(value) ? 0 : value;
      if (typeof value === 'string') {
        const parsed = Number(value);
        return isNaN(parsed) ? 0 : parsed;
      }
      return 0;
    };

    const grouped = new Map<
      string,
      {
        name: string;
        document_type: string | null;
        salarios: number;
        prestaciones: number;
        aportes_salud: number;
        aportes_pension: number;
        retefuente: number;
      }
    >();

    for (const item of items) {
      const nit = item.employee?.document_number || 'SIN_NIT';
      const name = item.employee
        ? `${item.employee.first_name ?? ''} ${item.employee.last_name ?? ''}`.trim()
        : 'Sin empleado';

      const earnings =
        item.earnings && typeof item.earnings === 'object'
          ? (item.earnings as Record<string, unknown>)
          : {};
      const deductions =
        item.deductions && typeof item.deductions === 'object'
          ? (item.deductions as Record<string, unknown>)
          : {};

      // Salarios: salario base + horas extra + comisiones + bonos salariales
      let salarios = num(earnings.base_salary) || num(item.base_salary);
      if (Array.isArray(earnings.overtime)) {
        for (const entry of earnings.overtime) {
          if (entry && typeof entry === 'object') {
            salarios += num((entry as Record<string, unknown>).amount);
          }
        }
      }
      salarios += num(earnings.commissions);
      if (Array.isArray(earnings.bonuses)) {
        for (const entry of earnings.bonuses) {
          if (entry && typeof entry === 'object') {
            salarios += num((entry as Record<string, unknown>).taxable);
          }
        }
      }

      // Prestaciones: pagos de vacaciones, incapacidades y licencias
      let prestaciones = 0;
      for (const key of ['vacations', 'disabilities', 'licenses']) {
        const entries = earnings[key];
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (entry && typeof entry === 'object') {
              prestaciones += num((entry as Record<string, unknown>).payment);
            }
          }
        }
      }

      const aportes_salud = num(deductions.health);
      const aportes_pension = num(deductions.pension);
      const retefuente = num(deductions.retention);

      const existing = grouped.get(nit);
      if (existing) {
        existing.salarios += salarios;
        existing.prestaciones += prestaciones;
        existing.aportes_salud += aportes_salud;
        existing.aportes_pension += aportes_pension;
        existing.retefuente += retefuente;
      } else {
        grouped.set(nit, {
          name,
          document_type: item.employee?.document_type || null,
          salarios,
          prestaciones,
          aportes_salud,
          aportes_pension,
          retefuente,
        });
      }
    }

    // Fuente B: cross-check contra la fuente canónica de retefuente laboral.
    const wht_where: any = {
      organization_id,
      year,
      role: 'practiced',
      counterparty_type: 'employee',
    };
    if (store_id) wht_where.store_id = store_id;

    const canonical = await (
      this.prisma as any
    ).withoutScope().withholding_calculations.aggregate({
      where: wht_where,
      _sum: { withholding_amount: true },
      _count: true,
    });

    const canonical_total = Number(canonical?._sum?.withholding_amount || 0);
    const items_total = Array.from(grouped.values()).reduce(
      (sum, g) => sum + g.retefuente,
      0,
    );

    if (
      canonical?._count > 0 &&
      Math.abs(canonical_total - items_total) > 1
    ) {
      this.logger.warn(
        `Formato 2276 (org ${organization_id}, año ${year}): retefuente de payroll_items ` +
          `(${items_total.toFixed(2)}) difiere del total canónico en withholding_calculations ` +
          `(${canonical_total.toFixed(2)}). Revise runs aceptados sin calculations o backfills.`,
      );
    }

    return Array.from(grouped.entries()).map(([nit, data]) => ({
      third_party_nit: nit,
      third_party_name: data.name,
      concept_code: 'RENTAS_TRABAJO',
      payment_amount: data.salarios + data.prestaciones,
      tax_amount: 0,
      withholding_amount: data.retefuente,
      line_data: {
        document_type: data.document_type,
        salarios: data.salarios,
        prestaciones: data.prestaciones,
        aportes_salud: data.aportes_salud,
        aportes_pension: data.aportes_pension,
        retefuente: data.retefuente,
      },
    }));
  }
}
