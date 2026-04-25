import { Injectable, Logger } from '@nestjs/common';
import { Prisma, partner_commission_state_enum } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

const DECIMAL_ZERO = new Prisma.Decimal(0);

interface PartnerLedgerFilters {
  state?: partner_commission_state_enum;
  period_start?: string;
  period_end?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

@Injectable()
export class PartnerCommissionsService {
  private readonly logger = new Logger(PartnerCommissionsService.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Accrue partner commission from an invoice's split breakdown.
   * Creates a partner_commissions row with state=accrued.
   * Idempotent: skips if a commission already exists for the invoice.
   */
  async accrueCommission(invoiceId: number): Promise<void> {
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
    }

    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
      include: {
        store_subscription: true,
      },
    });

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    if (!invoice.partner_organization_id) {
      // No partner — nothing to accrue.
      return;
    }

    const splitBreakdown = invoice.split_breakdown as Record<string, unknown> | null;
    const partnerShare = splitBreakdown?.partner_share
      ? new Prisma.Decimal(splitBreakdown.partner_share as string)
      : DECIMAL_ZERO;

    if (partnerShare.lessThanOrEqualTo(DECIMAL_ZERO)) {
      return;
    }

    const existing = await this.prisma.partner_commissions.findUnique({
      where: { invoice_id: invoiceId },
    });

    if (existing) {
      this.logger.warn(
        `Commission already exists for invoice ${invoiceId}; skipping accrual`,
      );
      return;
    }

    await this.prisma.partner_commissions.create({
      data: {
        partner_organization_id: invoice.partner_organization_id,
        invoice_id: invoiceId,
        amount: partnerShare,
        currency: invoice.currency,
        state: 'accrued',
        accrued_at: new Date(),
      },
    });
  }

  /**
   * Paginated list of partner commissions for an organization.
   */
  async getPartnerLedger(
    organizationId: number,
    filters: PartnerLedgerFilters = {},
  ) {
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const sort_by = filters.sort_by ?? 'accrued_at';
    const sort_order = filters.sort_order ?? 'desc';
    const skip = (page - 1) * limit;

    const where: Prisma.partner_commissionsWhereInput = {
      partner_organization_id: organizationId,
    };

    if (filters.state) {
      where.state = filters.state;
    }

    if (filters.period_start || filters.period_end) {
      where.accrued_at = {
        ...(filters.period_start && { gte: new Date(filters.period_start) }),
        ...(filters.period_end && { lte: new Date(filters.period_end) }),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.partner_commissions.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          invoice: {
            select: {
              id: true,
              invoice_number: true,
              state: true,
              total: true,
              period_start: true,
              period_end: true,
            },
          },
        },
      }),
      this.prisma.partner_commissions.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Aggregated commission totals by state for an organization.
   */
  async getPartnerSummary(organizationId: number) {
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const [accrued, pending_payout, paid] = await Promise.all([
      this.prisma.partner_commissions.aggregate({
        where: { partner_organization_id: organizationId, state: 'accrued' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.partner_commissions.aggregate({
        where: { partner_organization_id: organizationId, state: 'pending_payout' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.partner_commissions.aggregate({
        where: { partner_organization_id: organizationId, state: 'paid' },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      accrued: {
        total: this.sumToString(accrued._sum.amount),
        count: accrued._count,
      },
      pending_payout: {
        total: this.sumToString(pending_payout._sum.amount),
        count: pending_payout._count,
      },
      paid: {
        total: this.sumToString(paid._sum.amount),
        count: paid._count,
      },
    };
  }

  private sumToString(raw: Prisma.Decimal | null | undefined): string {
    if (!raw) return '0.00';
    const d = new Prisma.Decimal(raw);
    return d.toFixed(2);
  }
}
