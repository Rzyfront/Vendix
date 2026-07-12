import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class IcaService {
  constructor(
    private readonly store_prisma: StorePrismaService,
    private readonly global_prisma: GlobalPrismaService,
  ) {}

  /**
   * Resolves the ICA rate for the current store based on its primary address
   * and CIIU code from store settings.
   */
  async resolveStoreIcaRate(store_id?: number) {
    const context = RequestContextService.getContext();
    const resolved_store_id = store_id || context?.store_id;

    if (!resolved_store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // 1. Get store's primary address
    const primary_address = await this.global_prisma.addresses.findFirst({
      where: {
        store_id: resolved_store_id,
        is_primary: true,
      },
    });

    if (!primary_address?.municipality_code) {
      throw new VendixHttpException(ErrorCodes.ICA_STORE_NO_ADDRESS);
    }

    const municipality_code = primary_address.municipality_code;

    // 2. Get CIIU code from store settings
    const store_settings = await this.global_prisma.store_settings.findFirst({
      where: { store_id: resolved_store_id },
    });

    const settings = store_settings?.settings as Record<string, any> | null;
    // Canonical CIIU lives in fiscal_data.ciiu (written by the fiscal wizard's
    // legal-data step and the settings panel). Fall back to the legacy
    // ica.ciiu_code key for stores configured before the keys were unified.
    const ciiu_code: string | null =
      settings?.fiscal_data?.ciiu || settings?.ica?.ciiu_code || null;

    // 3. Query ica_municipal_rates with ciiu_code
    const now = new Date();
    let rate = await this.global_prisma.ica_municipal_rates.findFirst({
      where: {
        municipality_code,
        ...(ciiu_code ? { ciiu_code } : {}),
        is_active: true,
        effective_date: { lte: now },
        OR: [{ end_date: null }, { end_date: { gt: now } }],
      },
      orderBy: { effective_date: 'desc' },
    });

    // 4. Fallback: query with ciiu_code IS NULL (general rate)
    if (!rate && ciiu_code) {
      rate = await this.global_prisma.ica_municipal_rates.findFirst({
        where: {
          municipality_code,
          ciiu_code: null,
          is_active: true,
          effective_date: { lte: now },
          OR: [{ end_date: null }, { end_date: { gt: now } }],
        },
        orderBy: { effective_date: 'desc' },
      });
    }

    if (!rate) {
      return null;
    }

    return {
      rate_per_mil: Number(rate.rate_per_mil),
      municipality_name: rate.municipality_name,
      municipality_code: rate.municipality_code,
      ciiu_code: rate.ciiu_code,
      ciiu_description: rate.ciiu_description,
    };
  }

  /**
   * Calculates ICA tax for a given amount and municipality.
   */
  async calculateICA(
    amount: number,
    municipality_code: string,
    ciiu_code?: string,
  ) {
    const now = new Date();

    // Find rate with specific CIIU code first
    let rate = await this.global_prisma.ica_municipal_rates.findFirst({
      where: {
        municipality_code,
        ...(ciiu_code ? { ciiu_code } : { ciiu_code: null }),
        is_active: true,
        effective_date: { lte: now },
        OR: [{ end_date: null }, { end_date: { gt: now } }],
      },
      orderBy: { effective_date: 'desc' },
    });

    // Fallback to general rate if specific CIIU not found
    if (!rate && ciiu_code) {
      rate = await this.global_prisma.ica_municipal_rates.findFirst({
        where: {
          municipality_code,
          ciiu_code: null,
          is_active: true,
          effective_date: { lte: now },
          OR: [{ end_date: null }, { end_date: { gt: now } }],
        },
        orderBy: { effective_date: 'desc' },
      });
    }

    if (!rate) {
      throw new VendixHttpException(ErrorCodes.ICA_RATE_NOT_FOUND);
    }

    const rate_per_mil = Number(rate.rate_per_mil);
    const tax_amount = amount * (rate_per_mil / 1000);

    return {
      rate_per_mil,
      tax_amount: Math.round(tax_amount * 100) / 100,
      municipality_name: rate.municipality_name,
      municipality_code: rate.municipality_code,
      ciiu_code: rate.ciiu_code,
    };
  }

  /**
   * Finds all ICA municipal rates with optional filters and pagination.
   */
  async findAllRates(query: {
    municipality_code?: string;
    department_code?: string;
    page?: number;
    limit?: number;
  }) {
    const { municipality_code, department_code, page = 1, limit = 50 } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      is_active: true,
    };

    if (municipality_code) {
      where.municipality_code = municipality_code;
    }

    if (department_code) {
      where.department_code = department_code;
    }

    const [data, total] = await Promise.all([
      this.global_prisma.ica_municipal_rates.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { department_name: 'asc' },
          { municipality_name: 'asc' },
          { ciiu_code: 'asc' },
        ],
      }),
      this.global_prisma.ica_municipal_rates.count({ where }),
    ]);

    return {
      data: data.map((r) => ({
        ...r,
        rate_per_mil: Number(r.rate_per_mil),
      })),
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Generates an ICA tax report for a given period.
   * Period format: 'YYYY-QN' (quarterly), 'YYYY-MM' (monthly) or 'YYYY' (yearly)
   *
   * FUENTE AUTORITATIVA: replica la MISMA lógica que la declaración oficial
   * `TaxDeclarationDraftService.calculateIca`. El ICA es un impuesto
   * AUTOLIQUIDADO que NO se persiste como `invoice_taxes` en ventas B2C, por lo
   * que la implementación anterior (agrupar `invoice_taxes` con tax_name ~ 'ICA'
   * por municipio de la dirección del CLIENTE) devolvía un reporte vacío en
   * producción y, cuando había filas, no cuadraba con la declaración. Ahora:
   *
   *  - Base = suma de `invoices.subtotal_amount` de la TIENDA (municipio donde
   *    se ejerce la actividad), NO de la dirección del cliente. Las notas
   *    crédito restan; se excluyen facturas canceladas/anuladas/rechazadas.
   *  - Tarifa recalculada desde `ica_municipal_rates` con cascada CIIU
   *    store→org→null (match municipio+CIIU → municipio+NULL genérica →
   *    reintento con los primeros 5 dígitos DANE/Divipola del municipio).
   *  - Si no hay municipio configurado o no hay tarifa NO se inventa tarifa: se
   *    emite warning `ICA_RATE_NOT_CONFIGURED` y el municipio no aporta base.
   *
   * Alcance: reporte por-tienda (rama STORE de `calculateIca`). La
   * consolidación multi-municipio a nivel organización la construye
   * `OrgIcaService.getIcaReport` iterando este reporte por cada tienda activa,
   * por lo que aquí basta con un único renglón por el municipio de la tienda.
   */
  async getIcaReport(period: string) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const date_range = this.parsePeriod(period);

    const warnings: Array<{
      code: string;
      store_id?: number | null;
      municipality_code?: string | null;
    }> = [];

    // 1. Municipio + CIIU de la TIENDA (cascada store→org→null).
    const store = await this.global_prisma.stores.findUnique({
      where: { id: store_id },
      select: {
        id: true,
        organization_id: true,
        municipality_code: true,
        ciiu_code: true,
      },
    });

    const organization = store
      ? await this.global_prisma.organizations.findUnique({
          where: { id: store.organization_id },
          select: { ciiu_code: true },
        })
      : null;
    const org_ciiu = organization?.ciiu_code ?? null;
    const store_ciiu = store?.ciiu_code ?? org_ciiu ?? null;

    const municipality_code = store?.municipality_code
      ? String(store.municipality_code).trim()
      : null;
    const municipality_normalized =
      municipality_code && municipality_code.length >= 5
        ? municipality_code.slice(0, 5)
        : municipality_code;

    // 2. Tarifa vigente (cascada CIIU) SIN inventar tarifa.
    const rate = municipality_code
      ? await this.resolveIcaRateForMunicipality(
          municipality_code,
          municipality_normalized,
          store_ciiu,
        )
      : null;

    const date_range_out = {
      start: date_range.start.toISOString(),
      end: date_range.end.toISOString(),
    };

    // Sin municipio o sin tarifa configurada → warning, sin base ni renglón.
    if (!municipality_code || !rate) {
      warnings.push({
        code: 'ICA_RATE_NOT_CONFIGURED',
        store_id,
        municipality_code: municipality_code ?? null,
      });
      return {
        period,
        date_range: date_range_out,
        total_base: 0,
        total_ica: 0,
        invoice_count: 0,
        breakdown: [] as Array<{
          municipality: string;
          municipality_code: string;
          base: number;
          ica_amount: number;
          rate_per_mil: number;
          invoice_count: number;
        }>,
        warnings,
      };
    }

    // 3. Facturas de la tienda en el periodo (auto-scoped por store_id).
    const invoices = await this.store_prisma.invoices.findMany({
      where: {
        invoice_type: { in: ['sales_invoice', 'debit_note', 'credit_note'] },
        status: { notIn: ['cancelled', 'voided', 'rejected'] },
        issue_date: {
          gte: date_range.start,
          lt: date_range.end,
        },
      },
      select: {
        id: true,
        invoice_type: true,
        subtotal_amount: true,
      },
    });

    // 4. Base por municipio de la tienda (notas crédito restan).
    const rate_per_mil = Number(rate.rate_per_mil || 0);
    const base = invoices.reduce((sum, invoice) => {
      const sign = invoice.invoice_type === 'credit_note' ? -1 : 1;
      return sum + Number(invoice.subtotal_amount || 0) * sign;
    }, 0);
    const ica_amount = (base * rate_per_mil) / 1000;

    const base_rounded = Math.round(base * 100) / 100;
    const ica_rounded = Math.round(ica_amount * 100) / 100;

    const breakdown = [
      {
        municipality: rate.municipality_name,
        municipality_code,
        base: base_rounded,
        ica_amount: ica_rounded,
        rate_per_mil,
        invoice_count: invoices.length,
      },
    ];

    return {
      period,
      date_range: date_range_out,
      total_base: base_rounded,
      total_ica: ica_rounded,
      invoice_count: invoices.length,
      breakdown,
      warnings,
    };
  }

  /**
   * Resolves the applicable ICA rate for a municipality using the SAME cascade
   * as the official declaration (`calculateIca`): (municipality+CIIU) →
   * (municipality+NULL generic) → retry with the first 5 DANE/Divipola digits.
   * Returns `null` when no rate is configured — never invents one.
   */
  private async resolveIcaRateForMunicipality(
    municipality_code: string,
    municipality_normalized: string | null,
    ciiu_code: string | null,
  ) {
    const select = {
      rate_per_mil: true,
      municipality_code: true,
      municipality_name: true,
      ciiu_code: true,
      ciiu_description: true,
    };

    // 1) Match exacto (municipio + CIIU).
    let rate = ciiu_code
      ? await this.global_prisma.ica_municipal_rates.findFirst({
          where: { municipality_code, ciiu_code, is_active: true },
          orderBy: { effective_date: 'desc' },
          select,
        })
      : null;

    // 2) Fallback: tarifa genérica municipal (ciiu_code IS NULL).
    if (!rate) {
      rate = await this.global_prisma.ica_municipal_rates.findFirst({
        where: { municipality_code, ciiu_code: null, is_active: true },
        orderBy: { effective_date: 'desc' },
        select,
      });
    }

    // 3) Reintento con los primeros 5 dígitos DANE (Divipola) si difiere.
    if (
      !rate &&
      municipality_normalized &&
      municipality_normalized !== municipality_code
    ) {
      if (ciiu_code) {
        rate = await this.global_prisma.ica_municipal_rates.findFirst({
          where: {
            municipality_code: municipality_normalized,
            ciiu_code,
            is_active: true,
          },
          orderBy: { effective_date: 'desc' },
          select,
        });
      }
      if (!rate) {
        rate = await this.global_prisma.ica_municipal_rates.findFirst({
          where: {
            municipality_code: municipality_normalized,
            ciiu_code: null,
            is_active: true,
          },
          orderBy: { effective_date: 'desc' },
          select,
        });
      }
    }

    return rate;
  }

  /**
   * Parses a period string into a date range.
   * Supports: 'YYYY-QN' (quarterly), 'YYYY-MM' (monthly) or 'YYYY' (full year)
   */
  private parsePeriod(period: string): { start: Date; end: Date } {
    // Quarterly format: '2026-Q1', '2026-Q2', etc.
    const quarterly_match = period.match(/^(\d{4})-Q([1-4])$/i);
    if (quarterly_match) {
      const year = parseInt(quarterly_match[1], 10);
      const quarter = parseInt(quarterly_match[2], 10);
      const start_month = (quarter - 1) * 3;
      const start = new Date(year, start_month, 1);
      const end = new Date(year, start_month + 3, 1);
      return { start, end };
    }

    // Monthly format: '2026-01', '2026-12', etc.
    const monthly_match = period.match(/^(\d{4})-(\d{2})$/);
    if (monthly_match) {
      const year = parseInt(monthly_match[1], 10);
      const month = parseInt(monthly_match[2], 10);
      if (month < 1 || month > 12) {
        throw new VendixHttpException(ErrorCodes.ICA_INVALID_PERIOD);
      }
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);
      return { start, end };
    }

    // Yearly format: '2026' (full year, Jan-Dec)
    const yearly_match = period.match(/^(\d{4})$/);
    if (yearly_match) {
      const year = parseInt(yearly_match[1], 10);
      const start = new Date(year, 0, 1);
      const end = new Date(year + 1, 0, 1);
      return { start, end };
    }

    throw new VendixHttpException(ErrorCodes.ICA_INVALID_PERIOD);
  }
}
