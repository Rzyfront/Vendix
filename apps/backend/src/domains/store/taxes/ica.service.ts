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
    const ciiu_code: string | null = settings?.ica?.ciiu_code || null;

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
   * Period format: 'YYYY-QN' (quarterly) or 'YYYY-MM' (monthly)
   */
  async getIcaReport(period: string) {
    const date_range = this.parsePeriod(period);

    // Query invoice_taxes where tax_name contains 'ICA'
    const invoice_taxes = await this.store_prisma.invoice_taxes.findMany({
      where: {
        tax_name: { contains: 'ICA', mode: 'insensitive' },
        invoice: {
          invoice_date: {
            gte: date_range.start,
            lt: date_range.end,
          },
        },
      },
      include: {
        invoice: {
          select: {
            id: true,
            invoice_number: true,
            invoice_date: true,
            customer_address: true,
            subtotal: true,
          },
        },
      },
    });

    // Group by municipality
    const municipality_map = new Map<
      string,
      {
        municipality: string;
        municipality_code: string;
        base: number;
        ica_amount: number;
        rate_per_mil: number;
        invoice_count: number;
      }
    >();

    for (const tax of invoice_taxes) {
      const customer_address = tax.invoice?.customer_address as Record<
        string,
        any
      > | null;
      const municipality_code =
        customer_address?.municipality_code || 'unknown';
      const municipality_name =
        customer_address?.municipality_name ||
        customer_address?.city ||
        'Desconocido';

      const existing = municipality_map.get(municipality_code);
      const taxable_amount = Number(tax.taxable_amount || 0);
      const tax_amount = Number(tax.tax_amount || 0);
      const rate = Number(tax.tax_rate || 0);

      if (existing) {
        existing.base += taxable_amount;
        existing.ica_amount += tax_amount;
        existing.invoice_count += 1;
      } else {
        municipality_map.set(municipality_code, {
          municipality: municipality_name,
          municipality_code,
          base: taxable_amount,
          ica_amount: tax_amount,
          rate_per_mil: rate * 1000,
          invoice_count: 1,
        });
      }
    }

    const breakdown = Array.from(municipality_map.values()).map((entry) => ({
      ...entry,
      base: Math.round(entry.base * 100) / 100,
      ica_amount: Math.round(entry.ica_amount * 100) / 100,
    }));

    const total_base = breakdown.reduce((sum, b) => sum + b.base, 0);
    const total_ica = breakdown.reduce((sum, b) => sum + b.ica_amount, 0);

    return {
      period,
      date_range: {
        start: date_range.start.toISOString(),
        end: date_range.end.toISOString(),
      },
      total_base: Math.round(total_base * 100) / 100,
      total_ica: Math.round(total_ica * 100) / 100,
      invoice_count: invoice_taxes.length,
      breakdown,
    };
  }

  /**
   * Parses a period string into a date range.
   * Supports: 'YYYY-QN' (quarterly) or 'YYYY-MM' (monthly)
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

    throw new VendixHttpException(ErrorCodes.ICA_INVALID_PERIOD);
  }
}
